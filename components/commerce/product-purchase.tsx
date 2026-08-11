"use client";

import { useMemo, useState } from "react";
import { Check, ShoppingBag } from "lucide-react";
import { formatMoney } from "@/lib/commerce/money";
import { useCart } from "./cart-provider";

type Variant = { id: string; sku: string; title: string; priceAmount: number; compareAtAmount: number | null; optionValues: Record<string, string> };
export function ProductPurchase({ product, variants }: { product: { id: string; slug: string; title: string; currency: string; imageUrl: string | null }; variants: Variant[] }) {
  const { addItem } = useCart();
  const [variantId, setVariantId] = useState(variants[0]?.id || "");
  const [added, setAdded] = useState(false);
  const variant = useMemo(() => variants.find((entry) => entry.id === variantId) || variants[0], [variantId, variants]);
  if (!variant) return <p className="notice warning">No purchasable variant is available.</p>;
  return <div className="product-purchase">{variants.length > 1 ? <label>Choose option<select value={variant.id} onChange={(event) => setVariantId(event.target.value)}>{variants.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}{entry.optionValues.color ? ` · ${entry.optionValues.color}` : ""}{entry.optionValues.size ? ` · ${entry.optionValues.size}` : ""}</option>)}</select></label> : null}<div className="product-buy"><span className="product-price">{variant.compareAtAmount && variant.compareAtAmount > variant.priceAmount ? <del>{formatMoney(variant.compareAtAmount, product.currency)}</del> : null}<strong>{formatMoney(variant.priceAmount, product.currency)}</strong></span><button className="button button-dark product-add" type="button" onClick={() => { addItem({ variantId: variant.id, productId: product.id, slug: product.slug, title: product.title, variantTitle: variant.title, sku: variant.sku, priceAmount: variant.priceAmount, currency: product.currency, imageUrl: product.imageUrl }); setAdded(true); window.setTimeout(() => setAdded(false), 1400); }}>{added ? <><Check size={16} /> Added</> : <><ShoppingBag size={16} /> Add to bag</>}</button></div></div>;
}
