import Link from "next/link";
import { CircleDollarSign, CreditCard, ReceiptText } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { getIntegrationStatuses } from "@/lib/integrations/status";

export default async function PaymentsPage() {
  const { supabase } = await requireAdmin();
  const stripe = getIntegrationStatuses().find((item) => item.name === "Stripe")!;
  const { data } = await supabase.from("orders").select("payment_status,total_amount");
  const paid = data?.filter((order) => order.payment_status === "paid") || [];
  const revenue = paid.reduce((sum, order) => sum + order.total_amount, 0);
  const cards = [["Stripe", stripe.state, CreditCard], ["Paid orders", paid.length, ReceiptText], ["Captured revenue", `$${(revenue / 100).toFixed(2)}`, CircleDollarSign]] as const;
  return <><div className="admin-title"><div><p>Stripe</p><h1>Payments</h1></div><Link className="admin-primary" href="/admin/api-keys">Configuration</Link></div><div className="admin-stat-grid compact">{cards.map(([label, value, Icon]) => <article key={label}><Icon size={20} /><span>{label}</span><strong>{value}</strong></article>)}</div><section className="admin-panel feature-panel"><CreditCard size={32} /><div><h2>Webhook-authoritative settlement</h2><p>Amounts are rebuilt from database prices. Payment status cannot be edited manually in the admin panel: only a verified Stripe webhook can mark an order paid, preventing false fulfillment.</p><span className={`integration-state ${stripe.state}`}>{stripe.state === "ready" ? "Test checkout ready" : "Keys required before checkout"}</span></div></section></>;
}
