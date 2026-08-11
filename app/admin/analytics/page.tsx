import { CircleDollarSign, PackageCheck, ReceiptText, ShoppingBag } from "lucide-react";
import { requireAdmin } from "@/lib/auth";

export default async function AnalyticsPage() {
  const { supabase } = await requireAdmin();
  const [orders, products, items] = await Promise.all([
    supabase.from("orders").select("id,total_amount,payment_status,created_at").order("created_at", { ascending: false }),
    supabase.from("products").select("id,status"),
    supabase.from("order_items").select("title,quantity,line_amount"),
  ]);
  const paidOrders = orders.data?.filter((order) => order.payment_status === "paid") || [];
  const revenue = paidOrders.reduce((sum, order) => sum + order.total_amount, 0);
  const units = items.data?.reduce((sum, item) => sum + item.quantity, 0) || 0;
  const average = paidOrders.length ? revenue / paidOrders.length : 0;
  const productTotals = new Map<string, number>();
  for (const item of items.data || []) productTotals.set(item.title, (productTotals.get(item.title) || 0) + item.quantity);
  const topProducts = [...productTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const cards = [["Paid revenue", `$${(revenue / 100).toFixed(2)}`, CircleDollarSign], ["Paid orders", paidOrders.length, ReceiptText], ["Average order", `$${(average / 100).toFixed(2)}`, ShoppingBag], ["Units sold", units, PackageCheck]] as const;
  return <><div className="admin-title"><div><p>Performance</p><h1>Analytics</h1></div></div><div className="admin-stat-grid">{cards.map(([label, value, Icon]) => <article key={label}><Icon size={20} /><span>{label}</span><strong>{value}</strong></article>)}</div><section className="admin-panel"><div className="panel-heading"><div><p>Catalog health</p><h2>Operational inventory</h2></div></div><dl className="settings-list"><div><dt>Published products</dt><dd>{products.data?.filter((product) => product.status === "published").length || 0}</dd></div><div><dt>Draft or review</dt><dd>{products.data?.filter((product) => product.status === "draft" || product.status === "review").length || 0}</dd></div><div><dt>Orders recorded</dt><dd>{orders.data?.length || 0}</dd></div></dl></section><section className="admin-panel"><div className="panel-heading"><div><p>Product performance</p><h2>Top units sold</h2></div></div>{topProducts.length ? <ol className="ranked-list">{topProducts.map(([title, quantity]) => <li key={title}><span>{title}</span><b>{quantity} units</b></li>)}</ol> : <p className="admin-empty">Product rankings will appear after real paid orders arrive.</p>}</section></>;
}
