-- ============================================================================
-- LUXEDGE V2 — 0008: DURABLE SUPPLIER API RUN LEDGER + ATOMIC POINT RESERVATION
-- (MIGRATION SECURITY + FAIL-CLOSED REVISION — safe to apply, owner must run)
--
-- WHY THIS EXISTS
--   Phase 4C's CJ point budget was enforced by an in-memory Map inside a warm
--   serverless instance. That is NOT authoritative across Vercel instances,
--   cold starts, retries or concurrent requests — a run could overspend the
--   hard 250/run cap if two instances served requests for the same run. This
--   migration makes the hard cap DURABLE and ATOMIC in Supabase.
--
-- SECURITY MODEL (owner audit revision)
--   * The DATABASE enforces the hard cap: CHECK constraints bound
--     requested/hard budgets to [50, 250] and keep counters non-negative
--     and reserved_points <= hard_budget. A direct INSERT/UPDATE can never
--     store an out-of-range budget or negative counters.
--   * Authenticated (browser/admin JWT) may only SELECT the ledger through
--     an admin-only RLS policy. INSERT/UPDATE/DELETE are NOT granted to any
--     role — every mutation happens through SECURITY DEFINER RPCs:
--       start_supplier_api_run(...)   — DB derives + stores the hard budget
--       reserve_supplier_api_points(...) — DB derives the point cost from the
--                                         action; the caller can NEVER supply
--                                         cost = 0 / -10 / 1 to bypass it
--       finish_supplier_api_run(...)  — only a running row may finish; allowed
--                                       final statuses only
--   * SECURITY DEFINER functions SET search_path explicitly, verify the admin
--     claim from the forwarded JWT, and have EXECUTE revoked from PUBLIC and
--     granted ONLY to authenticated. NO service_role grants: a service-role
--     JWT carries no app_metadata.role='admin', so the functions' internal
--     check would reject service-role calls — claiming support would be false.
--   * Parameter shadowing is impossible: every parameter is p_-prefixed and
--     every WHERE compares r.id = p_run_id / r.provider = p_provider.
--
-- RESERVATION SEMANTICS
--   The server calls reserve_supplier_api_points BEFORE every actual paid
--   outbound CJ request (initial attempt AND every paid retry). The single
--   UPDATE's row lock + re-evaluated WHERE guarantee that when only one
--   concurrent reservation is affordable, exactly ONE succeeds. When denied,
--   denied_attempts is incremented and the CJ HTTP request MUST NOT occur.
--   Usage is labeled AUTHORIZED/RESERVED point consumption — CJ's exact
--   supplier billing is not claimed unless CJ itself reports it.
--
-- FAIL CLOSED
--   If the ledger cannot be created/read/reserved (unconfigured env, DB
--   unreachable, permission denied), the server refuses every paid CJ call:
--   NO listV2 / product/query / freightCalculate HTTP request may be issued.
--   The client-side CjPointBudget is UX FORECAST ONLY and can never authorize
--   a live paid request.
--
-- APPLY: paste into Dashboard → SQL Editor and run. Idempotent + transactional.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Durable run ledger — DB-enforced hard cap + counter integrity
-- ---------------------------------------------------------------------------
create table if not exists public.supplier_api_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'cj',
  status text not null default 'running',           -- running / completed / failed / exhausted
  requested_budget integer not null default 250,
  hard_budget integer not null default 250,         -- DB-stored hard cap (max 250)
  reserved_points integer not null default 0,       -- authorized/reserved consumption
  list_attempts integer not null default 0,
  detail_attempts integer not null default 0,
  freight_attempts integer not null default 0,
  paid_retries integer not null default 0,
  denied_attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint supplier_api_runs_provider_check check (provider in ('cj')),
  constraint supplier_api_runs_status_check check (status in ('running', 'completed', 'failed', 'exhausted')),
  constraint supplier_api_runs_requested_budget_check check (requested_budget between 50 and 250),
  constraint supplier_api_runs_hard_budget_check check (hard_budget between 50 and 250),
  constraint supplier_api_runs_reserved_points_check check (reserved_points >= 0),
  constraint supplier_api_runs_reserved_le_hard_check check (reserved_points <= hard_budget),
  constraint supplier_api_runs_list_attempts_check check (list_attempts >= 0),
  constraint supplier_api_runs_detail_attempts_check check (detail_attempts >= 0),
  constraint supplier_api_runs_freight_attempts_check check (freight_attempts >= 0),
  constraint supplier_api_runs_paid_retries_check check (paid_retries >= 0),
  constraint supplier_api_runs_denied_attempts_check check (denied_attempts >= 0)
);

alter table public.supplier_api_runs enable row level security;

-- Admin-only SELECT (read visibility). No INSERT/UPDATE/DELETE policy exists:
-- authenticated callers can never write the ledger directly (that would let
-- a browser/admin JWT raise hard_budget, lower reserved_points or reset the
-- attempt counters). All mutation flows through the SECURITY DEFINER RPCs.
drop policy if exists "admin read supplier_api_runs" on public.supplier_api_runs;
create policy "admin read supplier_api_runs"
  on public.supplier_api_runs
  for select
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Explicitly remove any wider grants (including PUBLIC) and grant ONLY SELECT
-- to authenticated. INSERT/UPDATE/DELETE are intentionally NOT granted.
revoke all on public.supplier_api_runs from public;
grant select on public.supplier_api_runs to authenticated;

-- ---------------------------------------------------------------------------
-- 2. START RUN RPC — the DB (not the browser) decides the hard budget
-- ---------------------------------------------------------------------------
drop function if exists public.start_supplier_api_run(text, integer);
create or replace function public.start_supplier_api_run(
  p_provider text,
  p_requested_budget integer
)
returns table (
  run_id uuid,
  provider text,
  status text,
  requested_budget integer,
  hard_budget integer,
  reserved_points integer,
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
  v_requested integer;
  v_hard integer;
  v_row public.supplier_api_runs%rowtype;
begin
  if (auth.jwt() -> 'app_metadata' ->> 'role') is distinct from 'admin' then
    raise exception 'permission denied for start_supplier_api_run';
  end if;
  if p_provider is distinct from 'cj' then
    raise exception 'unsupported supplier provider: %', p_provider;
  end if;
  -- DB — not the caller — stores the final hard budget:
  --   requested 50..250 → accepted as-is; >250 (or <50) clamped into [50, 250].
  v_requested := least(greatest(coalesce(p_requested_budget, 250), 50), 250);
  v_hard := v_requested;
  insert into public.supplier_api_runs (provider, status, requested_budget, hard_budget)
  values (p_provider, 'running', v_requested, v_hard)
  returning * into v_row;
  return query
    select v_row.id, v_row.provider, v_row.status, v_row.requested_budget, v_row.hard_budget,
           v_row.reserved_points, v_row.list_attempts, v_row.detail_attempts,
           v_row.freight_attempts, v_row.paid_retries, v_row.denied_attempts;
end;
$$;

revoke all on function public.start_supplier_api_run(text, integer) from public;
grant execute on function public.start_supplier_api_run(text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. RESERVE RPC — the DB derives the point cost from the action.
--    A caller can NEVER pass cost (no cost parameter exists), so a cost of
--    0 / -10 / 1 can never bypass the budget. Unknown actions are rejected.
-- ---------------------------------------------------------------------------
drop function if exists public.reserve_supplier_api_points(uuid, text, text, integer, boolean);
drop function if exists public.reserve_supplier_api_points(uuid, text, text, boolean);
create or replace function public.reserve_supplier_api_points(
  p_run_id uuid,
  p_provider text,
  p_action text,
  p_is_retry boolean default false
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
  v_cost integer;
  v_approved boolean := false;
begin
  if (auth.jwt() -> 'app_metadata' ->> 'role') is distinct from 'admin' then
    raise exception 'permission denied for reserve_supplier_api_points';
  end if;
  if p_provider is distinct from 'cj' then
    raise exception 'unsupported supplier provider: %', p_provider;
  end if;
  -- Official CJ API V2 point costs — derived INSIDE the database.
  if p_action = 'list' then
    v_cost := 50;
  elsif p_action = 'detail' then
    v_cost := 10;
  elsif p_action = 'freight' then
    v_cost := 10;
  else
    raise exception 'unknown supplier API action: %', p_action;
  end if;

  -- One atomic UPDATE: the row lock + re-evaluated WHERE make concurrent
  -- reservations safe (only one succeeds when only one is affordable).
  update public.supplier_api_runs r
     set reserved_points  = r.reserved_points + v_cost,
         list_attempts    = r.list_attempts + case when p_action = 'list' then 1 else 0 end,
         detail_attempts  = r.detail_attempts + case when p_action = 'detail' then 1 else 0 end,
         freight_attempts = r.freight_attempts + case when p_action = 'freight' then 1 else 0 end,
         paid_retries     = r.paid_retries + case when coalesce(p_is_retry, false) then 1 else 0 end,
         updated_at       = now()
   where r.id = p_run_id
     and r.provider = p_provider
     and r.status = 'running'
     and r.reserved_points + v_cost <= r.hard_budget
   returning true into v_approved;

  if not v_approved then
    -- Budget would be exceeded (or run finished/missing): record the denial.
    -- The caller MUST NOT issue the paid HTTP request.
    update public.supplier_api_runs r
       set denied_attempts = r.denied_attempts + 1,
           updated_at = now()
     where r.id = p_run_id
       and r.provider = p_provider;
  end if;

  return query
    select
      coalesce(v_approved, false) as approved,
      r.id, r.provider, r.status, r.hard_budget, r.reserved_points,
      r.hard_budget - r.reserved_points as remaining,
      r.list_attempts, r.detail_attempts, r.freight_attempts, r.paid_retries, r.denied_attempts
    from public.supplier_api_runs r
    where r.id = p_run_id
      and r.provider = p_provider;
end;
$$;

revoke all on function public.reserve_supplier_api_points(uuid, text, text, boolean) from public;
grant execute on function public.reserve_supplier_api_points(uuid, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. FINISH RUN RPC — allowed final statuses only; only a running row may
--    finish. No arbitrary client PATCH on supplier_api_runs exists.
-- ---------------------------------------------------------------------------
drop function if exists public.finish_supplier_api_run(uuid, text);
create or replace function public.finish_supplier_api_run(
  p_run_id uuid,
  p_status text
)
returns table (
  run_id uuid,
  provider text,
  status text,
  hard_budget integer,
  reserved_points integer,
  finished_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.supplier_api_runs%rowtype;
begin
  if (auth.jwt() -> 'app_metadata' ->> 'role') is distinct from 'admin' then
    raise exception 'permission denied for finish_supplier_api_run';
  end if;
  if p_status is null or p_status not in ('completed', 'failed', 'exhausted') then
    raise exception 'invalid final status: %', p_status;
  end if;
  update public.supplier_api_runs r
     set status = p_status,
         updated_at = now(),
         finished_at = now()
   where r.id = p_run_id
     and r.provider = 'cj'
     and r.status = 'running'
   returning * into v_row;
  if not found then
    raise exception 'supplier run % is not running or does not exist', p_run_id;
  end if;
  return query
    select v_row.id, v_row.provider, v_row.status, v_row.hard_budget,
           v_row.reserved_points, v_row.finished_at;
end;
$$;

revoke all on function public.finish_supplier_api_run(uuid, text) from public;
grant execute on function public.finish_supplier_api_run(uuid, text) to authenticated;

-- NOTE: no grants to service_role anywhere. The RPCs' internal auth.jwt() admin
-- check would reject service-role calls (a service-role JWT has no
-- app_metadata.role='admin'), so service_role support is NOT claimed. The CJ
-- proxy forwards the ADMIN JWT to every RPC; that is the only supported path.

COMMIT;
