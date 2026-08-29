# Luxedge Blog CMS — Architecture & Automation API

Blog **content** and blog **development** are now permanently separated.

- **Freebuff owns development/code only.**
- **Blog content lives in Supabase** (`blog_posts` + `blog_revisions`).
- Salman manages content from the **Admin → Blog Manager** (`/admin/blogs`) — no code, commit, build or deploy is ever needed for content operations.
- n8n/Hermes create/publish content only through the **`/blog-automation` API**. They never touch the repository, git, or a deployment.
- Publishing (or unpublishing/archiving) instantly updates the storefront, the worker SEO path, and **`/sitemap.xml`** without a redeploy.

## Source of truth

`blog_posts` (Supabase) is the production source of truth for blog content.

`INIT_BLOGS` in `src/App.tsx` is retained **only** as a migration/rollback fallback:
the storefront service (`src/services/blog.ts`) reads published posts from the CMS and
only falls back to `INIT_BLOGS` when the DB is unreachable or not yet migrated. Once
the CMS is seeded (run `node scripts/migrate-blogs-to-cms.mjs` once) the CMS wins.

## Database schema (`supabase/migrations/0022_blog_cms.sql`)

### `blog_posts`
| column | type | notes |
|---|---|---|
| `id` | uuid PK | auto |
| `slug` | text unique | canonical derives as `https://luxedge.us/blog/{slug}` |
| `title` | text not null | |
| `excerpt` | text | card/list text |
| `content` | text not null | markdown-ish (`##`, `#`, `[label](/path)`) |
| `hero_image_url`, `hero_image_alt` | text | |
| `tags` | text[] | |
| `author_name`, `author_id` | text | |
| `status` | text | `draft` \| `scheduled` \| `published` \| `archived` |
| `created_at`,`updated_at` | timestamptz | `updated_at` auto-touched |
| `scheduled_at`, `published_at` | timestamptz | |
| `seo_title`, `meta_description`, `target_keyword`, `secondary_keywords`, `search_intent` | | SEO fields |
| `faq` | jsonb | visible FAQ `[{q,a}]` → FAQPage JSON-LD |
| `internal_links` | jsonb | authored same-domain links |
| `quality_score` | int | automation gate |
| `source_notes` | jsonb | research/provenance |
| `generated_by` | text | `manual` \| `automation` |
| `automation_run_id` | uuid | |
| `automation_locked` | bool | if true automation cannot touch the post |
| `date_label` | text | legacy date string |

### `blog_revisions`
Append-only audit trail: `blog_id, revision, previous, next (jsonb snapshots), action, actor (admin|automation), actor_email, created_at`.
Salman can recover any earlier version (Admin manager → Revisions → Restore). Soft archive preferred; permanent delete needs explicit confirmation.

## RLS / security

- **Public (anon + any authenticated user):** `SELECT` only on `status = 'published' AND published_at <= now()`. Never sees drafts/scheduled/archived; no writes.
- **Admin** (`app_metadata.role = 'admin'`): full access to posts + revisions.
- **service_role:** runs server-side only (automation API). Grants are **blog-scoped** — no grant touches orders/customers/payments/catalog/auth.
- The service-role key and automation secret **never** reach the browser.

## Storefront + SEO (no redeploy)

- `src/services/blog.ts` — `loadPublishedBlogs()` (anon read) powers `/blog` + `/blog/:slug`.
- Admin Blog Manager calls `reloadBlogs()` after a change so the active session reflects the DB immediately.
- `worker/seo-meta.ts` reads published posts straight from `blog_posts` (short TTL) for per-article title/description/canonical/`og:url`/BlogPosting/FAQPage JSON-LD + pre-rendered body. Falls back to static `blog-seo.json` only when the DB is down.
- `worker/sitemap.ts` generates **`/sitemap.xml` at request time** from the live DB (static routes + categories + commerce-ready products + published blogs). Publish → appears; unpublish/archive → removed. Static file is the fallback until the DB is migrated.

## Automation API (`/blog-automation`)

Protected by a shared secret. Send it as:

```
Authorization: Bearer <BLOG_AUTOMATION_SECRET>
# or
x-automation-secret: <BLOG_AUTOMATION_SECRET>
```

If `BLOG_AUTOMATION_SECRET` is unset the endpoint is **fail-closed (503)**.

### `POST /blog-automation/draft`
Create a post as `draft` (always — never publishes).
Body (all optional except `title`):
```json
{
  "title": "…", "slug": "optional-auto-from-title",
  "excerpt": "…", "content": "…", "hero_image_url": "…",
  "tags": ["a","b"], "author_name": "Luxedge",
  "seo_title": "…", "meta_description": "…",
  "target_keyword": "…", "secondary_keywords": ["…"],
  "search_intent": "informational",
  "faq": [{"q":"…","a":"…"}], "internal_links": ["/blog/…","/product/…"],
  "quality_score": 88, "source_notes": {"…": "…"},
  "generated_by": "automation", "automation_run_id": "uuid",
  "scheduled_at": null
}
```
Returns `201 { id, status:"draft", slug }`. Duplicate slug → `409 { available:false }`.

### `POST /blog-automation/publish`
Attempts auto-publish. **Only publishes if every safety gate passes** (Phase L/M); otherwise saves a `draft` (or `scheduled` if only the frequency cap tripped) and returns the rejected reasons. It can never bypass the gate.

Gate (all must pass → publish):
- `quality_score >= 90`
- title ≥10 chars, content ≥300 chars, no lorem ipsum
- no unsupported medical/veterinary/nutritional claims (FDA/cures/treatment/guarantees)
- exactly one search intent and/or target keyword supplied
- every `internal_link` is a valid same-domain `/blog|category|product/<slug>` that resolves to a live row (≤5 links)
- no slug collision; `automation_locked` must be false
- ≤ `BLOG_AUTO_MAX_PER_7D` (default 3) auto-published posts per rolling 7 days

Response: `201 { id, status:"published", slug }`, or `200 { status:"draft", reasons:[…] }` / `202 { status:"scheduled", reasons:[…] }`.

### `PATCH /blog-automation/{id}`
Update fields (same keys as draft). Refused (`409`) if `automation_locked`.

### `GET /blog-automation/posts`
List posts (`id,slug,title,status,quality_score,generated_by,automation_run_id,created_at,updated_at`). Read-only.

### `GET /blog-automation/check-slug?slug=…`
`{ slug, available: bool }`.

Automation is blog-only by construction: the service-role grant covers only `blog_posts`/`blog_revisions`.

## Manual override (Phase M)

The owner always wins:
- Edit any post (including automation drafts) from **Admin → Blog Manager**.
- Publish/schedule/manually. `automation_locked` permanently blocks automation from that post; automation never recreates a post Salman intentionally unpublished/archived.

## Secrets to configure (once)

Server-side only (`wrangler secret put`, environment):

| secret | used for |
|---|---|
| `BLOG_AUTOMATION_SECRET` | Automation API auth (n8n/Hermes present this). |
| `SUPABASE_SERVICE_ROLE_KEY` | Automation + migration writes to `blog_posts`/`blog_revisions`. |
| (already configured) `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | storefront + worker anon reads. |

## n8n / Hermes isolation contract (Phase N)

- **Hermes:** browser research, GSC/Google inspection, live QA, Telegram reporting.
- **n8n:** schedule, orchestration, AI generation, quality gates, **CMS/API calls** (`/blog-automation`), monitoring.
- Neither edits project files, runs git, commits, pushes, or deploys Luxedge. **CMS API owns blog content; Freebuff owns development.**