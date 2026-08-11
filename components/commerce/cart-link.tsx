"use client";

import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { useCart } from "./cart-provider";

export function CartLink() {
  const { itemCount, hydrated } = useCart();
  return <Link className="cart-link" href="/cart" aria-label={`Shopping bag${hydrated && itemCount ? `, ${itemCount} items` : ""}`}><ShoppingBag size={19} />{hydrated && itemCount > 0 ? <span>{itemCount > 99 ? "99+" : itemCount}</span> : null}</Link>;
}
