-- ============================================================================
-- LUXEDGE V2 — 0018 APP SETTINGS
--
-- Simple key-value store for server-side configuration that admins can
-- manage from the UI (e.g. CJ API key, supplier tokens).
--
-- SECURITY:
--   - Only admin role can read/write
--   - Sensitive values (API keys) are stored here, never in browser/localStorage
--   - The server-side API routes read from this table as fallback when
--     environment variables are not set
-- ============================================================================

create table if not exists public.app_settings (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Enable RLS
alter table public.app_settings enable row level security;

-- Admin can do everything
create policy "Admin full access on app_settings"
  on public.app_settings
  for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
    )
  );

-- Service role can also access (for server-side API routes)
grant all on public.app_settings to service_role;
grant all on public.app_settings to authenticated;

comment on table public.app_settings is 'Server-side configuration key-value store (admin UI managed)';
comment on column public.app_settings.key is 'Setting name, e.g. CJ_API_KEY, SCRAPE_DO_TOKEN';
comment on column public.app_settings.value is 'Setting value (may be sensitive — never expose to browser)';
