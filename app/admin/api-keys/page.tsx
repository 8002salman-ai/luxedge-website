import { Check, KeyRound, ShieldAlert, X } from "lucide-react";
import { getIntegrationStatuses } from "@/lib/integrations/status";

export default function ApiKeysPage() {
  const integrations = getIntegrationStatuses();
  return <><div className="admin-title"><div><p>Server integrations</p><h1>API keys</h1></div></div><div className="secret-banner"><ShieldAlert size={20} /><div><b>Secrets never appear here.</b><span>Values are read from server environment variables. This page reveals configuration status only—no readback, browser storage or plaintext database copy.</span></div></div><div className="integration-grid">{integrations.map((integration) => <article className="integration-card" key={integration.name}><div className="integration-heading"><KeyRound size={20} /><div><h2>{integration.name}</h2><p>{integration.purpose}</p></div><span className={`integration-state ${integration.state}`}>{integration.state}</span></div><ul>{integration.checks.map((check) => <li key={check.label}>{check.configured ? <Check size={16} /> : <X size={16} />}<span>{check.label}</span><code>{check.configured ? "•••••••• configured" : "not configured"}</code></li>)}</ul></article>)}</div></>;
}
