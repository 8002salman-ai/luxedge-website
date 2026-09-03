# Luxedge Media Hub — /media (YouTube Growth System)

Premium US editorial video hub. The official YouTube channel is the **primary
video host**: every page embeds the official video (click-to-load, never
autoplay) and links back to the channel. Nothing here re-uploads video files.

## Routes

| Route | What it is |
|---|---|
| `/media` | Hub — featured video, latest grid, Shorts strip, category sections, Subscribe CTA |
| `/media/:slug` | Individual video page — player, editorial summary/description, chapters, transcript, FAQ, related products/articles/videos, share buttons, Watch on YouTube + Subscribe CTAs |
| `/video-sitemap.xml` | Google Video sitemap (video:title / thumbnail / player_loc / duration in seconds) |
| `/sitemap.xml` | Dynamic sitemap now includes `/media` + every published video |
| `/admin/media` | Admin Media manager — list, editor, manual add, "Sync from YouTube" |

## How a video appears on the site (two paths)

1. **Automatic — POST /api/media/sync** (Admin → Media Hub → Sync from YouTube).
   Pulls the official channel's uploads via the YouTube Data API, upserts rows
   into `media_videos` keyed on `youtube_video_id`, and publishes immediately.
   Editorial fields (summary, description, chapters, FAQ, featured, related_*,
   custom thumbnail) are **never overwritten** by a re-sync. YouTube responses
   are cached in-process for 10 minutes — no polling, sync only on click.
2. **Manual fallback** — paste a YouTube URL/id into the manager ("Start from
   URL") or click "Add Video" and fill the editorial fields. Use this when
   sync is not configured or a video needs editing before publishing.

Publishing (either path) updates the storefront, the worker SSR SEO, and both
sitemaps **without a redeploy**.

## One-time setup (what Salman must do)

1. **Apply the migration** — open `supabase/migrations/0026_media_videos.sql`
   in the Supabase SQL editor and run it (creates `media_videos` + RLS).
   Until then the hub shows an honest empty state and the manager reports the
   missing table.
2. **Environment variables** (worker secrets, server-side only — never in the
   browser):
   - `YOUTUBE_API_KEY` — Google Cloud API key with **YouTube Data API v3**
     enabled (console.cloud.google.com → APIs & Services → enable → Credentials
     → create API key).
   - `YOUTUBE_CHANNEL_ID` — the official channel's id (`UC…`). Channel About →
     Share → Channel ID. Deploy with `wrangler secret put YOUTUBE_API_KEY` /
     `wrangler secret put YOUTUBE_CHANNEL_ID`, or set in the dashboard.
3. **The channel URL** — resolved and wired (2026-09-03): verified from the
   owner data of the channel's real video `YOBlXCyOh28` — **AI With Salman**,
   `https://www.youtube.com/@TheAIWithSalman` (id `UCPvPDstYz61AebGhKzKS1lw`).
   It lives in `src/media/MediaHub.tsx` (Subscribe CTAs + footer link) and in
   the wrangler vars. Only `YOUTUBE_API_KEY` is still missing.

## Data model (Supabase `media_videos`)

`slug` (unique), `youtube_video_id` (unique, nullable for manual media),
`title`, `summary`, `description`, `seo_title`, `meta_description`,
`thumbnail_url` (YouTube's real thumbnail), `custom_thumbnail_url`
(editorial override), `category` (fixed set: product-education,
pet-animal-care, himalayan-salt, how-to-guides, buying-guides,
behind-the-brand), `is_short`, `featured`, `published_at`, `duration`
(ISO-8601), `transcript`, `chapters` (jsonb `[{t,title}]`), `tags`,
`related_product_ids`, `related_article_slugs`, `related_video_slugs`,
`faq` (jsonb `[{q,a}]`), `status` (draft/published/archived). RLS: public
reads published only; admin full; service role for sync only.

## SEO / schema

- Per-video: SEO title, meta description, canonical, OG + Twitter cards,
  `VideoObject` (name/description/thumbnailUrl/uploadDate/embedUrl/contentUrl/
  duration — **only when real**), `BreadcrumbList` (Home → Media → video),
  `FAQPage` when the FAQ is filled. No thin pages: every video page carries
  its editorial substance, and the worker pre-renders the same content into
  the initial HTML for crawlers.
- `/media` hub: `CollectionPage` JSON-LD + pre-rendered video links.
- Sitemaps: `/media` + video pages in `/sitemap.xml`, full video metadata in
  `/video-sitemap.xml` (referenced from `robots.txt`).

## Performance safeguards

- Click-to-load embeds: **zero YouTube iframes on /media**; the player mounts
  only after the visitor clicks play on the thumbnail (with `autoplay=1` in
  the mount URL). Chapters jump by remounting with `&start=`.
- Lazy thumbnails (`loading="lazy"`), no autoplay, `youtube-nocookie.com`
  embeds, 5-minute client cache + 60s worker cache for media reads.

## Analytics (first-party + GA)

`media_video_play`, `media_watch_youtube_click`, `media_subscribe_click`,
`media_share`, `media_related_product_click`, `media_related_video_click` —
recorded through the existing `recordSiteEvent`/gtag path (no new scripts).

## Copyright notice

Video pages carry: "© Luxedge. Original video content may not be reproduced
or redistributed without permission, except where permitted by applicable
law." (We claim only what Luxedge owns.)