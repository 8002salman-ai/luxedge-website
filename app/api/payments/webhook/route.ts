import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret || !process.env.STRIPE_SECRET_KEY) return Response.json({ error: "Webhook is not configured." }, { status: 503 });
  let event: Stripe.Event;
  try { event = getStripe().webhooks.constructEvent(await request.text(), signature, secret); }
  catch { return Response.json({ error: "Invalid webhook signature." }, { status: 400 }); }

  const db = createAdminClient();
  const { error: replayError } = await db.from("processed_webhook_events").insert({ stripe_event_id: event.id, event_type: event.type });
  if (replayError?.code === "23505") return Response.json({ received: true, duplicate: true });
  if (replayError) return Response.json({ error: "Webhook could not be recorded." }, { status: 500 });

  if (event.type === "payment_intent.succeeded" || event.type === "payment_intent.payment_failed") {
    const intent = event.data.object as Stripe.PaymentIntent;
    const orderId = intent.metadata.order_id;
    if (orderId) {
      const update = event.type === "payment_intent.succeeded"
        ? { payment_status: "paid", status: "paid" }
        : { payment_status: "failed", status: "payment_pending" };
      await db.from("orders").update(update).eq("id", orderId).eq("stripe_payment_intent_id", intent.id);
    }
  }
  return Response.json({ received: true });
}
