import type { Metadata } from "next";
import { CheckoutClient } from "@/components/commerce/checkout-client";

export const metadata: Metadata = { title: "Secure checkout" };

export default function CheckoutPage() {
  const checkoutEnabled = process.env.CHECKOUT_ENABLED === "true" && Boolean(process.env.STRIPE_SECRET_KEY && process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY && process.env.STRIPE_WEBHOOK_SECRET);
  return <CheckoutClient checkoutEnabled={checkoutEnabled} publishableKey={checkoutEnabled ? process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY! : null} />;
}
