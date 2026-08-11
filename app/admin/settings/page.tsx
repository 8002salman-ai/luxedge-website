import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getIntegrationStatuses } from "@/lib/integrations/status";

export default async function SettingsPage() {
  const { user } = await requireAdmin();
  const integrations = getIntegrationStatuses();
  const ready = integrations.filter((item) => item.state === "ready").length;
  return <><div className="admin-title"><div><p>Store controls</p><h1>Settings</h1></div><Link className="admin-primary" href="/account">Account & password</Link></div><section className="admin-panel"><div className="panel-heading"><div><p>Administrator</p><h2>Access control</h2></div></div><dl className="settings-list"><div><dt>Signed-in administrator</dt><dd>{user.email}</dd></div><div><dt>Authorization source</dt><dd>Verified Supabase app metadata; public signup cannot self-promote</dd></div><div><dt>Password management</dt><dd><Link className="text-link" href="/account">Change securely in account</Link></dd></div></dl></section><section className="admin-panel"><div className="panel-heading"><div><p>Launch readiness</p><h2>{ready} of {integrations.length} integrations ready</h2></div><Link className="text-link" href="/admin/api-keys">Open status</Link></div><dl className="settings-list"><div><dt>Currency</dt><dd>USD, stored as integer cents</dd></div><div><dt>Guest checkout</dt><dd>Signed server session; anonymous order reads disabled</dd></div><div><dt>Payment mode</dt><dd>Fails closed until Stripe test verification passes</dd></div><div><dt>Secret storage</dt><dd>Deployment environment only; never database or browser storage</dd></div></dl></section></>;
}
