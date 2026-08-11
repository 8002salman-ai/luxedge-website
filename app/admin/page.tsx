import Link from "next/link";
import { Boxes, CircleDollarSign, ShoppingCart, Users } from "lucide-react";
import { requireAdmin } from "@/lib/auth";

export default async function AdminDashboard() {
  const { supabase } = await requireAdmin();
  const [products, orders, customers, revenue] = await Promise.all([
    supabase.from("products").select("id", { count: "exact", head: true }),
    supabase.from("orders").select("id", { count: "exact", head: true }),
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("orders").select("total_amount").eq("payment_status", "paid"),
  ]);
  const paidTotal = revenue.data?.reduce((sum, row) => sum + Number(row.total_amount || 0), 0) || 0;
  const cards = [["Products", products.count || 0, Boxes], ["Orders", orders.count || 0, ShoppingCart], ["Customers", customers.count || 0, Users], ["Paid revenue", `$${(paidTotal / 100).toFixed(2)}`, CircleDollarSign]] as const;
  return <><div className="admin-title"><div><p>Dashboard</p><h1>Commerce overview</h1></div><Link className="admin-primary" href="/admin/products#new">Add product</Link></div>
    <div className="admin-stat-grid">{cards.map(([label, value, Icon]) => <article key={label}><Icon size={20} /><span>{label}</span><strong>{value}</strong></article>)}</div>
    <section className="admin-panel"><div className="panel-heading"><div><p>Launch sequence</p><h2>Safe route to first live order</h2></div></div><ol className="launch-list"><li><b>Connect Supabase</b><span>Run migrations and bootstrap the administrator.</span></li><li><b>Add and publish verified products</b><span>Price and inventory remain server-authoritative.</span></li><li><b>Connect Stripe test mode</b><span>Verify PaymentIntent and signed webhook transitions.</span></li><li><b>Connect Shippo test mode</b><span>Validate addresses, rates and labels before live keys.</span></li></ol></section>
  </>;
}
