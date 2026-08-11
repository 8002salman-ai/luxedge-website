"use client";

import Link from "next/link";
import { ArrowRight, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { formatMoney } from "@/lib/commerce/money";
import { useCart } from "./cart-provider";

export function CartPageClient() {
  const { items, hydrated, subtotalAmount, updateQuantity, removeItem } = useCart();
  if (!hydrated) return <section className="empty-page"><ShoppingBag size={38} strokeWidth={1.3} /><p>Loading your bag…</p></section>;
  if (!items.length) return <section className="empty-page"><ShoppingBag size={38} strokeWidth={1.3} /><p className="eyebrow"><span /> Your bag</p><h1>Your bag is<br />waiting.</h1><p>Explore the LuxEdge collection and add a considered essential.</p><Link className="button button-dark" href="/shop">Shop the collection <ArrowRight size={16} /></Link></section>;
  const currency = items[0].currency;
  return <section className="cart-page section"><p className="eyebrow"><span /> Your bag</p><div className="cart-heading"><h1>Selected with care.</h1><p>Final pricing and availability are verified securely when the order is created.</p></div><div className="cart-layout"><div className="cart-items">{items.map((item) => <article className="cart-item" key={item.variantId}><div className="cart-item-media">{item.imageUrl ? <img src={item.imageUrl} alt="" /> : <ShoppingBag size={28} strokeWidth={1.2} />}</div><div><h2>{item.title}</h2><p>{item.variantTitle} · {item.sku}</p><strong>{formatMoney(item.priceAmount, item.currency)}</strong></div><div className="quantity-control" aria-label={`Quantity for ${item.title}`}><button type="button" onClick={() => updateQuantity(item.variantId, item.quantity - 1)} aria-label="Decrease quantity"><Minus size={14} /></button><span>{item.quantity}</span><button type="button" onClick={() => updateQuantity(item.variantId, item.quantity + 1)} aria-label="Increase quantity"><Plus size={14} /></button></div><button className="remove-item" type="button" onClick={() => removeItem(item.variantId)} aria-label={`Remove ${item.title}`}><Trash2 size={17} /></button></article>)}</div><aside className="cart-summary"><p className="eyebrow"><span /> Summary</p><div><span>Estimated subtotal</span><strong>{formatMoney(subtotalAmount, currency)}</strong></div><p>Shipping and any applicable tax are calculated by the secure server flow. Displayed cart prices are estimates until verified.</p><Link className="button button-dark" href="/checkout">Continue to checkout <ArrowRight size={16} /></Link><Link className="text-link" href="/shop">Continue shopping</Link></aside></div></section>;
}
