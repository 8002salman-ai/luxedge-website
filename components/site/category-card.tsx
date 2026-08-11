import Link from "next/link";
import { ArrowUpRight, type LucideIcon } from "lucide-react";

export function CategoryCard({ number, title, copy, icon: Icon }: { number: string; title: string; copy: string; icon: LucideIcon }) {
  return <Link href="/shop" className="category-card"><div className="category-top"><span>{number}</span><Icon size={27} strokeWidth={1.4} /></div><div><h3>{title}</h3><p>{copy}</p></div><ArrowUpRight className="category-arrow" size={20} /></Link>;
}
