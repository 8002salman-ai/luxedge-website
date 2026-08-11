import "server-only";

export type IntegrationStatus = {
  name: string;
  purpose: string;
  state: "ready" | "partial" | "missing";
  checks: { label: string; configured: boolean; publicValue?: string }[];
};

const set = (name: string) => Boolean(process.env[name]?.trim());

export function getIntegrationStatuses(): IntegrationStatus[] {
  const supabaseChecks = [
    { label: "Project URL", configured: set("NEXT_PUBLIC_SUPABASE_URL") },
    { label: "Publishable key", configured: set("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") },
    { label: "Server secret key", configured: set("SUPABASE_SECRET_KEY") },
  ];
  const stripeChecks = [
    { label: "Publishable key", configured: set("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY") },
    { label: "Secret key", configured: set("STRIPE_SECRET_KEY") },
    { label: "Webhook signing secret", configured: set("STRIPE_WEBHOOK_SECRET") },
  ];
  const shippoChecks = [
    { label: "API token", configured: set("SHIPPO_API_TOKEN") },
    { label: "Ship-from street", configured: set("SHIPPO_FROM_STREET") },
    { label: "Ship-from city/state/ZIP", configured: set("SHIPPO_FROM_CITY") && set("SHIPPO_FROM_STATE") && set("SHIPPO_FROM_ZIP") },
  ];
  const state = (checks: { configured: boolean }[]): IntegrationStatus["state"] => checks.every((c) => c.configured) ? "ready" : checks.some((c) => c.configured) ? "partial" : "missing";
  return [
    { name: "Supabase", purpose: "Accounts, catalog, orders and protected admin data", checks: supabaseChecks, state: state(supabaseChecks) },
    { name: "Stripe", purpose: "PaymentIntent checkout and signed webhook settlement", checks: stripeChecks, state: state(stripeChecks) },
    { name: "Shippo", purpose: "Address validation, live rates and label purchasing", checks: shippoChecks, state: state(shippoChecks) },
    { name: "Resend", purpose: "Transactional order and account email", checks: [{ label: "API key", configured: set("RESEND_API_KEY") }], state: set("RESEND_API_KEY") ? "ready" : "missing" },
    { name: "OpenRouter", purpose: "Optional assisted catalog copy", checks: [{ label: "API key", configured: set("OPENROUTER_API_KEY") }], state: set("OPENROUTER_API_KEY") ? "ready" : "missing" },
    { name: "HubSpot", purpose: "Optional CRM synchronization", checks: [{ label: "Access token", configured: set("HUBSPOT_ACCESS_TOKEN") }], state: set("HUBSPOT_ACCESS_TOKEN") ? "ready" : "missing" },
  ];
}
