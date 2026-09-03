-- ============================================================================
-- LUXEDGE V2 — 0026: MEDIA HUB (YouTube video collection)
--
-- Single source of truth for the /media hub and /media/:slug video pages.
-- Mirrors the blog_cms security model exactly:
--   * public (anon + any authenticated user) — READ ONLY of published videos;
--     never sees drafts or archived videos; can never create/update/delete.
--   * admin (app_metadata.role = 'admin')     — full access (create/edit/
--     publish/archive/delete).
--   * service role                            — full access server-side for the
--     /api/media/sync YouTube importer (never shipped to the browser).
--
-- Design notes:
--   * youtube_video_id is the canonical key back to the official channel.
--     Manual (non-YouTube) media entries leave it NULL — the admin manager is
--     the manual fallback when automatic sync fails or a video is unlisted.
--   * Every editorial field is optional; structured data (chapters, faq,
--     related_*) is only emitted when actually present — never fabricated.
--   * thumbnail_url is the YouTube-provided real thumbnail; custom_thumbnail_url
--     optionally overrides it per the "custom editorial thumbnail" requirement.
-- ============================================================================

create table if not exists public.media_videos (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique,
  youtube_video_id    text unique,
  title               text not null,
  summary             text,               -- short editorial intro (1-2 sentences)
  description         text,               -- detailed editorial write-up
  seo_title           text,
  meta_description    text,
  thumbnail_url       text,               -- YouTube's real thumbnail (default)
  custom_thumbnail_url text,              -- editorial override when provided
  category            text not null default 'product-education',
  is_short            boolean not null default false,
  featured            boolean not null default false,
  published_at        timestamptz,
  duration            text,               -- ISO-8601 duration (PT1H2M3S) when known
  transcript          text,               -- full transcript when available
  chapters            jsonb not null default '[]',  -- [{ "t": "0:00", "title": "..." }]
  tags                text[] not null default '{}',
  related_product_ids text[] not null default '{}', -- catalog product ids/uids
  related_article_slugs text[] not null default '{}', -- /blog/:slug
  related_video_slugs text[] not null default '{}',   -- /media/:slug
  faq                 jsonb not null default '[]',    -- [{ "q": "...", "a": "..." }]
  source_notes        jsonb,               -- sync provenance (channel id, sync run)

  -- Lifecycle
  status              text not null default 'draft'
                        check (status in ('draft','published','archived')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_media_videos_status_published
  on public.media_videos (status, published_at);
create index if not exists idx_media_videos_slug
  on public.media_videos (slug);
create index if not exists idx_media_videos_featured
  on public.media_videos (featured) where featured = true;

-- Keep updated_at fresh on every content change.
create or replace function public.media_touch_updated_at()
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

drop trigger if exists trg_media_videos_touch_updated on public.media_videos;
create trigger trg_media_videos_touch_updated
  before update or insert on public.media_videos
  for each row execute function public.media_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.media_videos enable row level security;

-- Public: READ published-only. Never sees drafts or archived videos.
create policy "public select published media_videos"
  on public.media_videos
  for select
  using (
    status = 'published'
    and (published_at is null or published_at <= now())
  );

-- Admin: full access to every video.
create policy "admin all media_videos"
  on public.media_videos
  for all
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- ---------------------------------------------------------------------------
-- Role grants (media-scoped — does NOT touch orders/customers/payments).
--   anon/authenticated: SELECT only (RLS enforces published-only).
--   service_role: full access — the sync API is the only service writer.
-- ---------------------------------------------------------------------------
grant select on public.media_videos to anon, authenticated;
grant all on public.media_videos to service_role;