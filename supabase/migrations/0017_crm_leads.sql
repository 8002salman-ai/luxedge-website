-- ============================================================================
-- LUXEDGE V2 — 0017 CRM LEADS
--
-- Captures storefront visitors who engage with Luxedge's conversion tools:
--   - welcome popup (email + 10% coupon)
--   - WhatsApp inquiry clicks
--   - AI assistant chats
--
-- Truth rules:
--   - Public visitors may INSERT a row (the welcome form lives on the
--     storefront); they can never read or mutate other leads.
--   - Only the admin role can read/update rows (coupon-used flag etc.).
--   - HubSpot-ready: the row shape maps to HubSpot contact fields so the
--     future CRM sync can import directly (email, name, phone, source,
--     page_url, coupon_code, metadata).
-- ============================================================================

create table if not exists public.crm_leads (
  id text primary key,
  email text,
  name text,
  phone text,
  source text not null default 'welcome_popup' check (source in (
    'welcome_popup', 'whatsapp', 'ai_chat', 'manual')),
  page_url text,
  coupon_code text,
  coupon_used boolean not null default false,
  coupon_used_at timestamptz,
  opted_in boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_leads_email_idx on public.crm_leads (lower(coalesce(email, '')));
create index if not exists crm_leads_created_idx on public.crm_leads (created_at desc);
create index if not exists crm_leads_source_idx on public.crm_leads (source);

alter table public.crm_leads enable row level security;

-- Public storefront visitors may submit a lead (welcome form / whatsapp click).
drop policy if exists "crm public insert" on public.crm_leads;
create policy "crm public insert" on public.crm_leads
  for insert with check (true);

-- Only the admin role may read or update leads.
drop policy if exists "crm admin all" on public.crm_leads;
create policy "crm admin all" on public.crm_leads
  for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
