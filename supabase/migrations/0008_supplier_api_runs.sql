-- ============================================================================
-- LUXEDGE V2 — 0008: DURABLE SUPPLIER API RUN LEDGER + ATOMIC POINT RESERVATION
--
-- WHY THIS EXISTS
--   Phase 4C's CJ point budget was enforced by an in-memory Map inside a warm
--   serverless instance. That is NOT authoritative across Vercel instances,
--   cold starts, retries or concurrent requests — a run could overspend the
--   hard 250/run cap if two instances served requests for the same run. This
--   migration makes the hard cap DURABLE and ATOMIC in Supabase.
--
-- WHAT IT DOES
--   * supplier_api_runs — one durable row per supplier run, holding the hard
--     budget, reserved points, attempt counters and status. No secrets.
--   * reserve_supplier_api_points(...) — an atomic, security-definer RPC.
--     The server calls it BEFORE every actual paid outbound CJ request
--     (initial attempt AND every paid retry). It reserves points ONLY when
--     reserved_points + cost <= hard_budget; otherwise it increments
--     denied_attempts and returns approved = false — and the CJ HTTP request
--     MUST NOT occur.
--   * Concurrency-safe: the single UPDATE's row lock + re-evaluated WHERE
--     guarantee that when only one concurrent reservation is affordable,
--     exactly ONE succeeds and the other is denied.
--   * Cross-instance / cold-start safe: the ledger is a database row, not
--     process memory. Multiple Vercel instances share ONE budget per run.
--   * ADMIN-ONLY: the RPC refuses non-admin callers (auth.jwt() role check);
--     anon/customers have no policy on the table at all. The server's CJ
--     proxy forwards the admin JWT (never a service key) so RLS + the
--     function's internal check see the admin role.
--   * Usage is labeled AUTHORIZED/RESERVED point consumption — every paid
--     outbound request (incl. paid retries) is represented; CJ's exact
--     supplier billing is not claimed unless CJ itself reports it.
--
-- APPLY: paste into Dashboard → SQL Editor and run. Idempotent + transactional.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Durable run ledger
-- ---------------------------------------------------------------------------
create table if not exists public.supplier_api_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'cj',
  status text not null default 'running',           -- running / completed / failed / exhausted
  requested_budget integer not null default 250,
  hard_budget integer not null default 250,         -- server-clamped hard cap (max 250)
  reserved_points integer not null default 0,       -- authorized/reserved consumption
  list_attempts integer not null default 0,
  detail_attempts integer not null default 0,
  freight_attempts integer not null default 0,
  paid_retries integer not null default 0,
  denied_attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

alter table public.supplier_api_runs enable row level security;

-- Admin-only (same claim the app verifies for every admin route). Anon and
-- customers have no policy at all.
drop policy if exists "admin all supplier_api_runs" on public.supplier_api_runs;
create policy "admin all supplier_api_runs"
  on public.supplier_api_runs
  for all
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- ---------------------------------------------------------------------------
-- 2. Atomic point reservation (concurrency + cross-instance safe)
-- ---------------------------------------------------------------------------
drop function if exists public.reserve_supplier_api_points(uuid, text, text, integer, boolean);
create or replace function public.reserve_supplier_api_points(
  run_id uuid,
  provider text,
  action text,
  cost integer,
  is_retry boolean default false
)
returns table (
  approved boolean,
  run_id uuid,
  provider text,
  status text,
  hard_budget integer,
  reserved_points integer,
  remaining integer,
  list_attempts integer,
  detail_attempts integer,
  freight_attempts integer,
  paid_retries integer,
  denied_attempts integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_approved boolean := false;
begin
  -- Only the admin may reserve supplier API points (anon/customer never).
  if (auth.jwt() -> 'app_metadata' ->> 'role') is distinct from 'admin' then
    raise exception 'permission denied for reserve_supplier_api_points';
  end if;

  -- One atomic UPDATE: row lock + WHERE re-evaluation make concurrent
  -- reservations safe. Points and the attempt/retry counters move together.
  update public.supplier_api_runs r
     set reserved_points  = r.reserved_points + cost,
         list_attempts    = r.list_attempts + case when action = 'list' then 1 else 0 end,
         detail_attempts  = r.detail_attempts + case when action = 'detail' then 1 else 0 end,
         freight_attempts = r.freight_attempts + case when action = 'freight' then 1 else 0 end,
         paid_retries     = r.paid_retries + case when is_retry then 1 else 0 end,
         updated_at       = now()
   where r.id = run_id
     and r.provider = provider
     and r.status = 'running'
     and r.reserved_points + cost <= r.hard_budget
   returning true into v_approved;

  if not v_approved then
    -- Budget would be exceeded (or run finished/missing): record the denial.
    -- The caller MUST NOT issue the paid HTTP request.
    update public.supplier_api_runs
       set denied_attempts = denied_attempts + 1,
           updated_at = now()
     where id = run_id and provider = provider;
  end if;

  return query
    select
      coalesce(v_approved, false) as approved,
      r.id, r.provider, r.status, r.hard_budget, r.reserved_points,
      r.hard_budget - r.reserved_points as remaining,
      r.list_attempts, r.detail_attempts, r.freight_attempts, r.paid_retries, r.denied_attempts
    from public.supplier_api_runs r
    where r.id = run_id and r.provider = provider;
end;
$$;

-- Executable by authenticated (admin-only enforced inside the function) so the
-- admin-JWT CJ proxy can reserve; never anon. Service role is granted too for
-- future ops tooling — the function's internal admin check still applies.
grant execute on function public.reserve_supplier_api_points(uuid, text, text, integer, boolean) to authenticated, service_role;
grant select, insert, update on public.supplier_api_runs to authenticated, service_role;

COMMIT;
