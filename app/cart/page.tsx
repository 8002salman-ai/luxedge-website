import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ShoppingBag } from "lucide-react";

export const metadata: Metadata = { title: "Bag" };

export default function CartPage() {
  return <section className="empty-page"><ShoppingBag size={38} strokeWidth={1.3} /><p className="eyebrow"><span /> Your bag</p><h1>Ready when the<br />collection is.</h1><p>Approved products will appear here after supplier verification.</p><Link className="button button-dark" href="/shop">View launch status <ArrowRight size={16} /></Link></section>;
}
