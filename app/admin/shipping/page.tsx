import Link from "next/link";
import { PackageCheck, Truck } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { getIntegrationStatuses } from "@/lib/integrations/status";

export default async function ShippingPage() {
  const { supabase } = await requireAdmin();
  const shippo = getIntegrationStatuses().find((item) => item.name === "Shippo")!;
  const { data } = await supabase.from("orders").select("status,payment_status,tracking_number");
  const ready = data?.filter((order) => order.payment_status === "paid" && order.status !== "shipped" && order.status !== "delivered").length || 0;
  const inTransit = data?.filter((order) => order.status === "shipped").length || 0;
  const delivered = data?.filter((order) => order.status === "delivered").length || 0;
  return <><div className="admin-title"><div><p>Shippo</p><h1>Shipping</h1></div><Link className="admin-primary" href="/admin/orders">Manage orders</Link></div><div className="admin-stat-grid compact"><article><PackageCheck size={20} /><span>Ready to fulfill</span><strong>{ready}</strong></article><article><Truck size={20} /><span>In transit</span><strong>{inTransit}</strong></article><article><PackageCheck size={20} /><span>Delivered</span><strong>{delivered}</strong></article></div><section className="admin-panel feature-panel"><Truck size={32} /><div><h2>Rates and labels are fail-closed</h2><p>The order schema holds selected Shippo rate, carrier, service, transaction, tracking and label references. Live calls remain disabled until the test token and complete ship-from address are configured.</p><span className={`integration-state ${shippo.state}`}>{shippo.state === "ready" ? "Test shipping ready" : "Configuration incomplete"}</span> <Link className="text-link" href="/admin/api-keys">Review configuration</Link></div></section></>;
}
