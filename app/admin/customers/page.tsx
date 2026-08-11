import { requireAdmin } from "@/lib/auth";

export default async function AdminCustomers() {
  const { supabase } = await requireAdmin();
  const [profiles, orders] = await Promise.all([
    supabase.from("profiles").select("id,email,display_name,phone,role,created_at").order("created_at", { ascending: false }).limit(100),
    supabase.from("orders").select("user_id,total_amount,payment_status"),
  ]);
  const totals = new Map<string, { orders: number; spend: number }>();
  for (const order of orders.data || []) if (order.user_id) { const current = totals.get(order.user_id) || { orders: 0, spend: 0 }; current.orders += 1; if (order.payment_status === "paid") current.spend += order.total_amount; totals.set(order.user_id, current); }
  return <><div className="admin-title"><div><p>Relationships</p><h1>Customers</h1></div></div><section className="admin-panel"><div className="admin-table"><div className="table-row customer-row table-head"><span>Name</span><span>Email</span><span>Phone</span><span>Orders</span><span>Paid spend</span><span>Role</span></div>{profiles.data?.length ? profiles.data.map((profile) => { const total = totals.get(profile.id) || { orders: 0, spend: 0 }; return <div className="table-row customer-row" key={profile.id}><span><b>{profile.display_name || "Customer"}</b><small>Joined {new Date(profile.created_at).toLocaleDateString("en-US")}</small></span><span>{profile.email || "—"}</span><span>{profile.phone || "—"}</span><span>{total.orders}</span><span>${(total.spend / 100).toFixed(2)}</span><span className={`status-pill ${profile.role}`}>{profile.role}</span></div>; }) : <p className="admin-empty">No customer profiles yet.</p>}</div></section></>;
}
