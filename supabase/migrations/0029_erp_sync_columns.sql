-- =============================================================
-- 0029 — ERP sync state on each order row
-- =============================================================
-- Embani ERP sync previously recorded its per-order state in ONE
-- app_settings JSON doc (key ERP_SYNC_STATUS). This migration moves that
-- state onto the luxedge_orders rows themselves so each order carries its
-- own sync record:
--
--   erp_sync_status  text         — 'created' | 'updated' | 'sent' | 'failed'
--                                  (NULL = never attempted / cleared)
--   erp_synced_at    timestamptz  — when the ERP last acknowledged the order
--   erp_sync_error   text         — sanitized failure reason (failed only)
--
-- The /api/admin/erp endpoint auto-detects these columns (5-min probe cache)
-- and switches from the app_settings ledger to per-row state with no deploy
-- needed; before this migration is applied it keeps using the ledger, so the
-- two storage modes never mix.
--
-- Existing ledger entries are backfilled into the new columns so history is
-- preserved across the switch. The migration is idempotent and safe to rerun.
-- =============================================================

alter table public.luxedge_orders
  add column if not exists erp_sync_status text,
  add column if not exists erp_synced_at timestamptz,
  add column if not exists erp_sync_error text;

create index if not exists luxedge_orders_erp_sync_status_idx
  on public.luxedge_orders(erp_sync_status)
  where erp_sync_status is not null;

-- Backfill: copy any existing ERP_SYNC_STATUS ledger entries into the rows
-- (only rows that don't already carry state, so a rerun is a no-op).
do $$
declare
  r record;
  val jsonb;
begin
  select value::jsonb into val
  from public.app_settings
  where key = 'ERP_SYNC_STATUS'
  limit 1;
  if val is not null and jsonb_typeof(val) = 'object' then
    for r in select k.key as order_number, k.value as entry
             from jsonb_each(val) as k
    loop
      update public.luxedge_orders
        set erp_sync_status = coalesce(r.entry->>'status', 'sent'),
            erp_synced_at   = nullif(r.entry->>'synced_at', '')::timestamptz,
            erp_sync_error  = nullif(r.entry->>'error', '')
      where order_number = r.order_number
        and erp_sync_status is null;
    end loop;
  end if;
end $$;

-- Note: the legacy ERP_SYNC_STATUS app_settings row is intentionally kept
-- (harmless once unused) so nothing is lost; it can be deleted after the
-- owner confirms the backfill looks right in the Admin Orders ERP panel.
