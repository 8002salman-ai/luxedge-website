import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/server";

export const runtime = "nodejs";

const payableEventTypes = new Set(["payment_intent.succeeded", "payment_intent.payment_failed"]);

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  if (!signature || !secret || !stripeSecret) return Response.json({ error: "Webhook is not configured." }, { status: 503 });
  let event: Stripe.Event;
  try { event = getStripe().webhooks.constructEvent(await request.text(), signature, secret); }
  catch { return Response.json({ error: "Invalid webhook signature." }, { status: 400 }); }

  const db = createAdminClient();
  let order: { id: string; total_amount: number; currency: string; stripe_payment_intent_id: string | null; payment_status: string; stripe_tax_calculation_id: string | null; stripe_tax_transaction_id: string | null } | null = null;
  let intent: Stripe.PaymentIntent | null = null;
  if (payableEventTypes.has(event.type)) {
    intent = event.data.object as Stripe.PaymentIntent;
    const orderId = intent.metadata.order_id;
    if (!orderId || !/^[0-9a-f-]{36}$/i.test(orderId)) return Response.json({ error: "Payment event has no valid order." }, { status: 400 });
    const result = await db.from("orders").select("id,total_amount,currency,stripe_payment_intent_id,payment_status,stripe_tax_calculation_id,stripe_tax_transaction_id").eq("id", orderId).maybeSingle();
    order = result.data;
    const amountMatches = intent.amount === order?.total_amount && (event.type !== "payment_intent.succeeded" || intent.amount_received === order?.total_amount);
    const expectedLiveMode = stripeSecret.startsWith("sk_live_");
    if (result.error || !order || order.stripe_payment_intent_id !== intent.id || !amountMatches || intent.currency !== order.currency || intent.livemode !== expectedLiveMode) return Response.json({ error: "Payment event does not match the stored order." }, { status: 409 });
  }

  const { error: replayError } = await db.from("processed_webhook_events").insert({ stripe_event_id: event.id, event_type: event.type });
  if (replayError?.code === "23505") return Response.json({ received: true, duplicate: true });
  if (replayError) return Response.json({ error: "Webhook could not be recorded." }, { status: 500 });

  if (intent && order) {
    let processingError: unknown = null;
    if (event.type === "payment_intent.succeeded") {
      const finalized = await db.rpc("server_finalize_paid_order", { p_order_id: order.id, p_payment_intent_id: intent.id, p_amount: intent.amount, p_currency: intent.currency });
      processingError = finalized.error;
      if (!processingError && order.stripe_tax_calculation_id && !order.stripe_tax_transaction_id) {
        try {
          const transaction = await getStripe().tax.transactions.createFromCalculation({ calculation: order.stripe_tax_calculation_id, reference: `luxedge-${order.id}`, metadata: { order_id: order.id } }, { idempotencyKey: `luxedge-tax-${order.id}` });
          const saved = await db.from("orders").update({ stripe_tax_transaction_id: transaction.id }).eq("id", order.id).is("stripe_tax_transaction_id", null);
          processingError = saved.error;
        } catch (caught) { processingError = caught; }
      }
    } else {
      const failed = await db.from("orders").update({ payment_status: "failed", status: "payment_pending" }).eq("id", order.id).eq("stripe_payment_intent_id", intent.id);
      processingError = failed.error;
    }
    if (processingError) {
      await db.from("processed_webhook_events").delete().eq("stripe_event_id", event.id);
      return Response.json({ error: "Order payment state could not be updated." }, { status: 500 });
    }
  }
  return Response.json({ received: true });
}
