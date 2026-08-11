"use client";

import { useState } from "react";
import { Check, ShoppingBag } from "lucide-react";
import type { CartItem } from "./cart-provider";
import { useCart } from "./cart-provider";

export function AddToCartButton({ item }: { item: Omit<CartItem, "quantity"> }) {
  const { addItem } = useCart();
  const [added, setAdded] = useState(false);
  return <button className="button button-dark product-add" type="button" onClick={() => { addItem(item); setAdded(true); window.setTimeout(() => setAdded(false), 1400); }}>{added ? <><Check size={16} /> Added</> : <><ShoppingBag size={16} /> Add to bag</>}</button>;
}
