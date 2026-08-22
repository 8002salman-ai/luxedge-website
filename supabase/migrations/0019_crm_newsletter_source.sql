-- ============================================================================
-- LUXEDGE V2 — 0019 CRM NEWSLETTER SOURCE
--
-- The storefront footer newsletter form (POST /api/crm/subscribe) persists
-- subscribers into crm_leads with source = 'newsletter'. The 0017 source
-- CHECK constraint only allowed conversion-tool sources, so newsletter
-- inserts were rejected. Add 'newsletter' to the allowed set.
--
-- Truth rules unchanged: public visitors may INSERT, only admin may read.
-- ============================================================================

alter table public.crm_leads
  drop constraint if exists crm_leads_source_check;

alter table public.crm_leads
  add constraint crm_leads_source_check check (source in (
    'welcome_popup', 'whatsapp', 'ai_chat', 'manual', 'newsletter'));
