"use client";

import { useState } from "react";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { StripePaymentForm } from "./stripe-payment-form";

type Order = { id: string; orderNumber: number; totalAmount: number; currency: string };

export function StripePaymentPane({ publishableKey, clientSecret, order, onPaid }: { publishableKey: string; clientSecret: string; order: Order; onPaid: () => void }) {
  const [stripePromise] = useState<PromiseLike<Stripe | null>>(() => loadStripe(publishableKey));
  return <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "stripe", variables: { colorPrimary: "#171713", colorText: "#171713", colorBackground: "#fbfaf6", colorDanger: "#9b3525", borderRadius: "0px", fontFamily: "Inter, Segoe UI, Arial" } } }}><StripePaymentForm order={order} onPaid={onPaid} /></Elements>;
}
