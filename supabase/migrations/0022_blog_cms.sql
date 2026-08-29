-- ============================================================================
-- LUXEDGE V2 — 0022: BLOG CMS (independent content operations)
--
-- Separates blog CONTENT from blog DEVELOPMENT. After this migration the
-- production source of truth for blog posts is Supabase, not INIT_BLOGS in
-- src/App.tsx. Salman manages posts from the Admin Blog Manager; n8n/Hermes
-- create/publish through the `/blog-automation` API. Publishing a post updates
-- the storefront, the worker SEO path, and the dynamic sitemap WITHOUT any
-- repository change or deployment.
--
-- SECURITY MODEL (matches 0001/0002):
--   * public (anon + any authenticated user) — READ ONLY of published posts
--     whose scheduled_at has passed (published_at <= now()); NEVER sees drafts,
--     scheduled or archived posts; can never create/update/delete.
--   * admin (app_metadata.role = 'admin')     — full access to all posts +
--     revisions (create/edit/publish/schedule/archive/delete).
--   * service role                            — full access server-side for the
--     automation API (never shipped to the browser; JWT-minted writes use it
--     through the server and are blog-scoped only).
-- Roles are granted per-table here so the automation service can write blogs
-- without any grant touching orders/customers/payments/catalog.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. blog_posts — the single source of truth for blog content
-- ---------------------------------------------------------------------------
create table if not exists public.blog_posts (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique,
  title               text not null,
  excerpt             text,
  content             text not null default '',
  hero_image_url      text,
  hero_image_alt      text,
  tags                text[] not null default '{}',
  author_name         text,
  author_id           text,

  -- Lifecycle
  status              text not null default 'draft'
                        check (status in ('draft','scheduled','published','archived')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  scheduled_at        timestamptz,
  published_at        timestamptz,

  -- SEO
  seo_title           text,
  meta_description    text,
  target_keyword      text,
  secondary_keywords  text[] not null default '{}',
  search_intent       text,

  -- Visible FAQ section; mirrored to FAQPage JSON-LD only when non-empty.
  faq                 jsonb not null default '[]',
  -- Contextual same-domain links authored into the post (blog/category/product).
  internal_links      jsonb not null default '[]',

  -- Automation quality / provenance (Phase K/L/M)
  quality_score       integer,
  source_notes        jsonb,
  generated_by        text,           -- 'manual' | 'automation'
  automation_run_id   uuid,
  automation_locked   boolean not null default false,

  -- Posting metadata fed to the calendar cards and schema
  date_label          text             -- legacy date string (YYYY-MM-DD) if needed
);

create index if not exists idx_blog_posts_status_published
  on public.blog_posts (status, published_at);
create index if not exists idx_blog_posts_slug
  on public.blog_posts (slug);

-- Keep updated_at fresh on every content change.
create or replace function public.blog_touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_blog_posts_touch_updated on public.blog_posts;
create trigger trg_blog_posts_touch_updated
  before update or insert on public.blog_posts
  for each row execute function public.blog_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. blog_revisions — audit / recovery history (soft changes)
-- ---------------------------------------------------------------------------
create table if not exists public.blog_revisions (
  id          uuid primary key default gen_random_uuid(),
  blog_id     uuid not null references public.blog_posts(id) on delete cascade,
  revision    integer not null,
  -- Snapshot of the row BEFORE this change, then AFTER — full rollback support.
  previous    jsonb,
  next        jsonb,
  action      text not null check (action in
                ('create','edit','publish','unpublish','schedule','archive','restore','delete','automation_update')),
  actor       text not null check (actor in ('admin','automation')),
  actor_email text,
  created_at  timestamptz not null default now(),
  unique (blog_id, revision)
);

create index if not exists idx_blog_revisions_blog
  on public.blog_revisions (blog_id, revision);

-- ---------------------------------------------------------------------------
-- 3. Row Level Security
-- ---------------------------------------------------------------------------
alter table public.blog_posts enable row level security;
alter table public.blog_revisions enable row level security;

-- Public: READ published-only (published_at <= now()). Never sees drafts,
-- scheduled or archived posts. No insert/update/delete for any rolenauthed.
create policy "public select published blog_posts"
  on public.blog_posts
  for select
  using (
    status = 'published'
    and (published_at is null or published_at <= now())
  );

-- Admin: full access to every post + revision.
create policy "admin all blog_posts"
  on public.blog_posts
  for all
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "admin all blog_revisions"
  on public.blog_revisions
  for all
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- ---------------------------------------------------------------------------
-- 4. Role grants (blog-scoped — does NOT touch orders/customers/payments).
--    anon/authenticated: SELECT only (RLS enforces published-only).
--    service_role: full access on BLOG tables ONLY — automation writes max
--    impact by construction. No grant grants automation anything else.
-- ---------------------------------------------------------------------------
grant select on public.blog_posts to anon, authenticated;
grant all on public.blog_posts to service_role;

grant all on public.blog_revisions to service_role;
-- Admin signed-in JWT writes to revisions via the authenticated role + RLS.
grant select, insert, delete on public.blog_revisions to authenticated;