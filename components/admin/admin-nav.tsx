"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Boxes, CreditCard, FolderTree, Gauge, KeyRound, PackageCheck, Settings, ShoppingCart, Truck, Users } from "lucide-react";

const items = [
  ["Overview", "/admin", Gauge],
  ["Products", "/admin/products", Boxes],
  ["Categories", "/admin/categories", FolderTree],
  ["Orders", "/admin/orders", ShoppingCart],
  ["Customers", "/admin/customers", Users],
  ["Shipping", "/admin/shipping", Truck],
  ["Payments", "/admin/payments", CreditCard],
  ["Analytics", "/admin/analytics", BarChart3],
  ["API keys", "/admin/api-keys", KeyRound],
  ["Settings", "/admin/settings", Settings],
] as const;

export function AdminNav() {
  const pathname = usePathname();
  return <aside className="admin-sidebar"><Link className="admin-logo" href="/admin">LUX<span>EDGE</span><small>Commerce</small></Link><nav aria-label="Admin navigation">{items.map(([label, href, Icon]) => { const active = href === "/admin" ? pathname === href : pathname.startsWith(href); return <Link aria-current={active ? "page" : undefined} className={active ? "active" : undefined} href={href} key={href}><Icon size={17} />{label}</Link>; })}</nav><Link className="admin-store-link" href="/"><PackageCheck size={17} /> View store</Link></aside>;
}
