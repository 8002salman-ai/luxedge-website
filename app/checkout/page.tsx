import type { Metadata } from "next";
import { CheckoutClient } from "@/components/commerce/checkout-client";

export const metadata: Metadata = { title: "Secure checkout" };

export default function CheckoutPage() {
  const taxReady = process.env.TAX_MODE === "none" || process.env.TAX_MODE === "stripe";
  const checkoutEnabled = process.env.CHECKOUT_ENABLED === "true" && taxReady && Boolean(process.env.SHIPPO_API_TOKEN && process.env.STRIPE_SECRET_KEY && process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY && process.env.STRIPE_WEBHOOK_SECRET);
  return <CheckoutClient checkoutEnabled={checkoutEnabled} publishableKey={checkoutEnabled ? process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY! : null} />;
}
