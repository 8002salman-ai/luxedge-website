"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, LockKeyhole, ShieldCheck } from "lucide-react";
import { formatMoney } from "@/lib/commerce/money";
import { useCart } from "./cart-provider";

const StripePaymentPane = dynamic(() => import("./stripe-payment-pane").then((module) => module.StripePaymentPane), { ssr: false, loading: () => <p>Loading secure payment...</p> });
type Order = { id: string; orderNumber: number; subtotalAmount: number; shippingAmount: number; taxAmount: number; totalAmount: number; currency: string };
type ShippingRate = { id: string; amount: string; currency: string; carrier: string; service?: string; estimatedDays?: number };

export function CheckoutClient({ checkoutEnabled, publishableKey }: { checkoutEnabled: boolean; publishableKey: string | null }) {
  const { items, subtotalAmount, hydrated, clearCart } = useCart();
  const [order, setOrder] = useState<Order | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [rates, setRates] = useState<ShippingRate[]>([]);
  const [shippingRateId, setShippingRateId] = useState("");

  async function createOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!checkoutEnabled || !items.length) return;
    setSubmitting(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const guestResponse = await fetch("/api/guest/session", { method: "POST", headers: { "Cache-Control": "no-store" } });
      if (!guestResponse.ok) throw new Error("Guest checkout session could not be secured.");
      const addressTo = { name: form.get("fullName"), street1: form.get("street1"), street2: form.get("street2"), city: form.get("city"), state: form.get("state"), zip: form.get("postalCode"), country: "US", phone: form.get("phone"), email: form.get("email") };
      const requestedItems = items.map(({ variantId, quantity }) => ({ variantId, quantity }));
      if (!shippingRateId) {
        const response = await fetch("/api/shipping/rates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ addressTo, items: requestedItems }) });
        const payload = await response.json();
        if (!response.ok || !Array.isArray(payload.rates) || !payload.rates.length) throw new Error(payload.error || "No shipping rates are available for this address.");
        setRates(payload.rates); setShippingRateId(payload.rates[0].id); return;
      }
      const response = await fetch("/api/orders/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: form.get("email"), phone: form.get("phone"), shippingAddress: { fullName: form.get("fullName"), street1: form.get("street1"), street2: form.get("street2"), city: form.get("city"), state: form.get("state"), postalCode: form.get("postalCode"), country: "US" }, items: requestedItems, shippingRateId }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Order could not be created.");
      setOrder(payload.order);
      const intentResponse = await fetch("/api/payments/intents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: payload.order.id }) });
      const intentPayload = await intentResponse.json();
      if (!intentResponse.ok || !intentPayload.clientSecret) throw new Error(intentPayload.error || "Secure payment could not be prepared.");
      setClientSecret(intentPayload.clientSecret);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Checkout could not continue."); }
    finally { setSubmitting(false); }
  }

  function invalidateRates(event: React.FormEvent<HTMLFormElement>) {
    if ((event.target as HTMLInputElement).name !== "shippingRate" && rates.length) { setRates([]); setShippingRateId(""); }
  }

  if (hydrated && !items.length && !order) return <section className="empty-page"><LockKeyhole size={38} strokeWidth={1.3} /><p className="eyebrow"><span /> Secure checkout</p><h1>Your bag is empty.</h1><Link className="button button-dark" href="/shop">Return to shop</Link></section>;
  return <section className="checkout-page section">
    <div className="checkout-heading"><p className="eyebrow"><span /> Secure checkout</p><h1>Complete your order.</h1><p><LockKeyhole size={15} /> Pricing, shipping, tax and inventory are verified by LuxEdge servers.</p></div>
    {!checkoutEnabled ? <div className="checkout-gate"><ShieldCheck size={28} /><div><strong>Checkout is safely staged, not live.</strong><p>Stripe test keys, Shippo, tax mode, webhook signing, and <code>CHECKOUT_ENABLED=true</code> are required. No charge can happen before every gate opens.</p></div></div> : null}
    {error ? <div className="notice error">{error}</div> : null}
    <div className="checkout-layout"><div className="checkout-panel">{clientSecret && publishableKey && order ? <StripePaymentPane publishableKey={publishableKey} clientSecret={clientSecret} order={order} onPaid={clearCart} /> : <form className="checkout-form" onSubmit={createOrder} onChange={invalidateRates}>
      <h2>Contact</h2><label>Email<input name="email" type="email" autoComplete="email" required maxLength={254} /></label><label>Phone <span>optional</span><input name="phone" type="tel" autoComplete="tel" maxLength={30} /></label>
      <h2>Shipping address</h2><label>Full name<input name="fullName" autoComplete="name" required minLength={2} maxLength={120} /></label><label>Street address<input name="street1" autoComplete="address-line1" required minLength={2} maxLength={160} /></label><label>Apartment, suite <span>optional</span><input name="street2" autoComplete="address-line2" maxLength={160} /></label><div className="checkout-form-row"><label>City<input name="city" autoComplete="address-level2" required /></label><label>State<input name="state" autoComplete="address-level1" required /></label><label>ZIP code<input name="postalCode" autoComplete="postal-code" required minLength={3} maxLength={20} /></label></div>
      {rates.length ? <fieldset className="shipping-rates"><legend>Shipping method</legend>{rates.map((rate) => <label key={rate.id}><input type="radio" name="shippingRate" value={rate.id} checked={shippingRateId === rate.id} onChange={() => setShippingRateId(rate.id)} /><span><b>{rate.carrier} {rate.service || "Standard"}</b><small>{rate.estimatedDays ? `${rate.estimatedDays} estimated business days` : "Delivery estimate at fulfillment"}</small></span><strong>{new Intl.NumberFormat("en-US", { style: "currency", currency: rate.currency }).format(Number(rate.amount))}</strong></label>)}</fieldset> : null}
      <button className="button button-dark" type="submit" disabled={!checkoutEnabled || !hydrated || !items.length || submitting}>{submitting ? "Securing checkout..." : !checkoutEnabled ? "Checkout activation pending" : rates.length ? "Create order and continue to payment" : "Get verified shipping rates"}</button>
    </form>}</div>
      <aside className="checkout-summary"><h2>Order summary</h2>{items.map((item) => <div className="checkout-summary-item" key={item.variantId}><span>{item.title} x {item.quantity}</span><strong>{formatMoney(item.priceAmount * item.quantity, item.currency)}</strong></div>)}{order ? <><div className="checkout-summary-item"><span>Shipping</span><strong>{formatMoney(order.shippingAmount, order.currency)}</strong></div><div className="checkout-summary-item"><span>Tax</span><strong>{formatMoney(order.taxAmount, order.currency)}</strong></div></> : null}<div className="checkout-total"><span>{order ? "Verified total" : "Estimated subtotal"}</span><strong>{formatMoney(order?.totalAmount ?? subtotalAmount, order?.currency ?? items[0]?.currency ?? "usd")}</strong></div><p>Final totals come only from the server-created order, never from browser storage.</p></aside>
    </div><Link className="text-link checkout-back" href="/cart"><ArrowLeft size={15} /> Back to bag</Link>
  </section>;
}
