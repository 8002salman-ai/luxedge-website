import { getCurrentUser } from "@/lib/auth";
import { getVerifiedGuestSessionHash } from "@/lib/commerce/guest-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (process.env.CHECKOUT_ENABLED !== "true" || !process.env.STRIPE_SECRET_KEY) return Response.json({ error: "Payments are not configured." }, { status: 503 });
  let body: { orderId?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
  const orderId = typeof body.orderId === "string" && /^[0-9a-f-]{36}$/i.test(body.orderId) ? body.orderId : null;
  if (!orderId) return Response.json({ error: "A valid order ID is required." }, { status: 400 });

  const [user, guestHash] = await Promise.all([getCurrentUser(), getVerifiedGuestSessionHash()]);
  const db = createAdminClient();
  const { data: order, error } = await db.from("orders").select("id,user_id,guest_session_hash,email,total_amount,currency,status,stripe_payment_intent_id,idempotency_key").eq("id", orderId).single();
  if (error || !order) return Response.json({ error: "Order not found." }, { status: 404 });
  const ownsOrder = user?.id === order.user_id || Boolean(guestHash && order.guest_session_hash === guestHash);
  if (!ownsOrder) return Response.json({ error: "Forbidden." }, { status: 403 });
  if (order.status !== "payment_pending" && order.status !== "pending") return Response.json({ error: "Order is not payable." }, { status: 409 });
  if (!Number.isSafeInteger(order.total_amount) || order.total_amount < 50 || !/^[a-z]{3}$/.test(order.currency)) return Response.json({ error: "Order total is not payable." }, { status: 409 });
  if (order.stripe_payment_intent_id) {
    const existing = await getStripe().paymentIntents.retrieve(order.stripe_payment_intent_id);
    const expectedLiveMode = process.env.STRIPE_SECRET_KEY.startsWith("sk_live_");
    if (existing.amount !== order.total_amount || existing.currency !== order.currency || existing.metadata.order_id !== order.id || existing.livemode !== expectedLiveMode || existing.status === "canceled") return Response.json({ error: "Stored payment does not match this order." }, { status: 409 });
    return Response.json({ clientSecret: existing.client_secret, paymentIntentId: existing.id }, { headers: { "Cache-Control": "no-store" } });
  }

  const intent = await getStripe().paymentIntents.create({
    amount: order.total_amount,
    currency: order.currency,
    automatic_payment_methods: { enabled: true },
    receipt_email: order.email,
    metadata: { order_id: order.id },
  }, { idempotencyKey: String(order.idempotency_key) });
  const { error: updateError } = await db.from("orders").update({ stripe_payment_intent_id: intent.id, status: "payment_pending" }).eq("id", order.id).is("stripe_payment_intent_id", null);
  if (updateError) return Response.json({ error: "Payment state could not be saved." }, { status: 500 });
  return Response.json({ clientSecret: intent.client_secret, paymentIntentId: intent.id }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
