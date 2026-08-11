"use client";

import { useState } from "react";
import { PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { CheckCircle2, LockKeyhole } from "lucide-react";
import { formatMoney } from "@/lib/commerce/money";

type Order = { id: string; orderNumber: number; totalAmount: number; currency: string };

export function StripePaymentForm({ order, onPaid }: { order: Order; onPaid: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);

  async function pay(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true); setError("");
    const result = await stripe.confirmPayment({ elements, confirmParams: { return_url: `${window.location.origin}/checkout?order=${encodeURIComponent(order.id)}` }, redirect: "if_required" });
    if (result.error) setError(result.error.message || "Payment could not be completed.");
    else if (result.paymentIntent?.status === "succeeded" || result.paymentIntent?.status === "processing") { onPaid(); setComplete(true); }
    else setError("Payment needs another step. Please review the payment details.");
    setSubmitting(false);
  }

  if (complete) return <div className="payment-complete"><CheckCircle2 size={34} /><p className="eyebrow"><span /> Order LE-{order.orderNumber}</p><h2>Payment submitted.</h2><p>Stripe accepted the payment. LuxEdge will confirm it through the signed webhook before fulfillment begins.</p></div>;
  return <form className="stripe-payment-form" onSubmit={pay}><div className="payment-heading"><LockKeyhole size={22} /><div><h2>Secure payment</h2><p>Verified total: {formatMoney(order.totalAmount, order.currency)}</p></div></div><PaymentElement options={{ layout: "accordion" }} />{error ? <div className="notice error">{error}</div> : null}<button className="button button-dark" type="submit" disabled={!stripe || !elements || submitting}>{submitting ? "Confirming…" : `Pay ${formatMoney(order.totalAmount, order.currency)}`}</button></form>;
}
