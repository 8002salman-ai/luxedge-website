# LUXEDGE STATE — Agent Handoff

Updated **2026-08-17** after **Phase 3B FINAL CLOSURE** on `luxedge-v2`. Phase 1 security, Phase 2 storefront, and Phase 3A auth/API work remain intact.

## Phase 3B FINAL STATUS = PASS (closed)

- **Branch:** `luxedge-v2` (development). `main` = production (`luxedge.us`), untouched (`4d0086d`), NOT deployed from this branch.
- **Migrations applied to the REAL Supabase project (owner, Dashboard → SQL Editor):**
  - `0004_reconcile_live.sql` — applied ✅ (reconciled the legacy 13-table DB to the V2 schema)
  - `0005_drop_legacy_currency_checks.sql` — applied ✅ (dropped stale legacy `%_currency_check` / `%_country_check` constraints)
  - `0006_products_status_allow_draft.sql` — **new, owner to apply before Phase 4** (adds `'draft'` to `products_status_check` so bare/draft-status product writes don't fail; verified live that `status='draft'` is currently rejected)
- **Live schema (verified):** **30 V2 tables** all present (customers, suppliers, supplier_products, supplier_variants, supplier_shipping, reviews, ai_providers, agent_jobs, agent_runs, agent_logs, product_candidates, product_scores, creative_assets, creative_jobs, campaigns, ad_creatives, ad_performance, + others) — MISSING: NONE — plus **5 preserved legacy tables** (profiles, admin_email_allowlist, supplier_mappings, price_history, processed_webhook_events) = 35 total.
- **Uppercase USD V2 write verified live:** after 0005, a products write with `currency='USD'` passes (previously 23514 on `products_currency_check`).
- **KONG product normalized:** the one real product now stores `currency='USD'` (PATCH verified, HTTP 200).
- **RLS / grants verified live (probes):** anon reads published catalog only; anon/buyer writes to products/customers/suppliers → 42501 blocked; buyer sees only own `customers` row; admin full access; service role works. RLS enabled and enforced.
- **Customer sync verified live:** real non-admin buyer → sign-in (no admin role claim) → `customers` row created via the user's own JWT with matching `auth_user_id` → own-row isolation → admin-table blocked → refresh survival → logout. Test buyer + row deleted afterward.
- **Real product E2E verified:** **KONG Classic, Durable Natural Rubber Dog Toy** ($11.96, published, slug `kong-classic-dog-toy`, 4 verified images, supplier evidence stored) → storefront **catalog source = SUPABASE** → PDP (title/price/image/"No verified reviews yet") → admin Products → cart (add/qty/subtotal/remove). No paid order placed.
- **Quality gate:** `npm test` ✅ 88/88 · `npx tsc --noEmit` ✅ 0 errors · `npm run build` ✅ (storefront 410.45 KB / gzip 116.97 KB, admin lazy 242.37 KB) · zero console errors.
- **READY FOR PHASE 4 PRODUCT SCOUT: YES** (apply `0006` first so product writes with default/`'draft'` status succeed).

## Migration history (2026-08-17)

1. `0001_initial_schema.sql` / `0002_auth_rls.sql` / `0003_role_grants.sql` — V2 schema + customer RLS + role grants (Phase 1/3A). Not applied directly (postgres password rejected); their content is fully encoded in `0004`.
2. `0004_reconcile_live.sql` — single ordered, transactional, additive package for the SQL editor. First draft had two ordering bugs, both fixed before final apply:
   - `orders.customer_id` / `addresses.customer_id` FKs referenced `customers` before it was created → reordered (create V2 tables first, then FK columns).
   - legacy RLS policies blocked `ALTER COLUMN TYPE` on status enums ("cannot alter type of a column used in a policy definition") → POLICY CLEANUP moved to section 2, before any type change, using `pg_policies` + `to_regclass` (drops unknown legacy names like "Published products are public"). Also: dropped stale enum check constraints, guarded every legacy ALTER, reconciled `inventory` (legacy PK = variant_id), skipped the `updated_at` trigger on `creative_jobs`, wrapped everything in `BEGIN/COMMIT`.
3. `0005_drop_legacy_currency_checks.sql` — applied ✅. Dropped stale `%_currency_check` / `%_country_check` constraints (verified live: `'USD'` now accepted).
4. `0006_products_status_allow_draft.sql` — **owner to apply before Phase 4** (see below).

## Live Supabase project (owner-provided)

- Project URL: `https://eidujmfbcfrjjleitaqp.supabase.co`
- Keys: new-style `sb_publishable_...` (browser, `apikey` ONLY) and `sb_secret_...` (server). Local `.env` (gitignored) carries `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Never committed.
- Admin user: `admin@luxedge.us` (`app_metadata.role='admin'`) — login, dashboard, refresh survival, logout, protected-route block all verified live.
- Live data (all real, seeded this phase): 1 category (Pet Toys), 1 supplier (KONG Company), 1 supplier_product, 1 product_candidate (approved), **1 published product (KONG Classic, USD)**, 4 product_images, 1 customers row (admin@luxedge.us).

## Catalog behavior

- `src/services/catalog.ts` `loadStorefrontCatalog()` reads published products + active categories (+ images) from Supabase; returns `null` when unconfigured/unreachable/no published products → demo catalog stays. With the KONG product published, **catalog source = SUPABASE** (verified in browser: only the KONG product renders; demo products no longer in the catalog).
- Mapped products carry `rating:0/reviews:0` → PDP shows "No verified reviews yet" (no fabricated ratings).
- Legacy schema gaps to remember when seeding via SQL/scripts: `products.title` NOT NULL (V2 writes `name` — set both); `product_images.storage_path`/`public_url` NOT NULL (V2 writes `url` — set both); `addresses.street1` etc. NOT NULL (V2 address writes need both column sets — Phase 3C work); `orders.order_number` is an identity column.

## Known issues / next owner actions

- **Apply `0006_products_status_allow_draft.sql`** in the Dashboard → SQL Editor before Phase 4 (adds `'draft'` to `products_status_check`; verified live that `status='draft'` is currently rejected even though it's 0001's default). Also the seeded KONG product can be left as-is (already `USD`).
- `/api/ai/*` + `/api/fetch-page` require an admin JWT; Vercel env vars + AI provider keys needed for actual generation (never commit them).
- Checkout payment is demo mode (no processor) — explicit notice shown.
- Customer-profile sync verified live; Phase 3C should wire the admin UI (products/candidates/suppliers/orders/AI jobs/campaigns) to the real DB and reconcile legacy address/order column requirements.
- In-memory per-instance rate limiting only; shared limiter interface ready.
- 3 leftover Phase 3A debug buyer auth accounts (`buyer-debug-*`, `buyer-contract-*`) can be deleted by the owner.

## Security status

- No secrets in bundle/localStorage beyond the user's own session tokens. Bundle scan CLEAN of secret values (only env-var NAMES like `DEEPSEEK_API_KEY` appear in the admin AI-settings UI — not values; only the public publishable key is present by design).
- `.env.example` names-only; `.env` gitignored. Service-role/secret key + JWT secret are server-only. SSRF guard + timeouts + model allowlist + rate limits + admin JWT guard active.
- Admin role derives from the verified JWT claim only (`app_metadata.role='admin'`); customer insert uses the user's own token and never sets a role.
- A real postgres DB password was previously written into this file (commit `1e21290`) and is **redacted**; it remains in git history and was **not rotated** — the owner decides rotation after the project completes. Do not re-print real secret values in this file.

## Credentials genuinely required (owner)

1. ✅ Supabase project URL + publishable key + secret key — provided, wired locally.
2. Postgres DB password for direct connection — current one fails; the SQL-editor migration path (0004/0005/0006) is the working path and needs no password.
3. Optional: `SUPABASE_JWT_SECRET` (remote validation already works without it).
4. AI provider keys (server env): `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`.
5. Scraping: `SCRAPE_DO_TOKEN` (optional). Payments (later): Stripe/PayPal server keys.

## Vercel env vars to add (when deploying this branch)

`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (publishable key), `SUPABASE_SERVICE_ROLE_KEY` (secret key), optional `SUPABASE_JWT_SECRET`, plus AI provider keys. `VITE_*` vars must be exposed to the browser build.

## PHASE 4A — PRODUCT SCOUT (CLOSED, PASS)

**What was built** — a real autonomous research pipeline (`src/features/scout/`) + an admin UI (`src/admin/ProductScout.tsx`, route `/admin/scout`, sidebar "Product Scout ⭐"). Pipeline: DISCOVER → VERIFY SOURCE → NORMALIZE → SCORE → REJECT/SHORTLIST → OWNER APPROVAL → PRODUCT DRAFT. No AI credits are consumed — extraction and scoring are deterministic rule-based; no candidate is ever auto-published.

**Engine modules** (all pure/testable): `types.ts` (VERIFIED/INFERRED/UNKNOWN evidence model), `normalize.ts` (slugify, supplier-from-domain, price/rating/review parsing, dedupe keys), `extract.ts` (rule-based page parsing: title/price/availability/shipping/origin/rating/sizes), `margin.ts` (landed cost = supplier + shipping; proposed price = 2.5× landed → .99; margin confidence LOW when shipping unknown → no auto-approve), `reject.ts` (hard filters: counterfeit/IP, medical/veterinary claims, dangerous/regulated, battery/fire, fragile/high-return, misleading claims, unavailable, no price, no images, poor USA delivery, thin margin — each with an exact recorded reason), `score.ts` (exact 100-pt weights from the spec: demand 20, supplier 15, USA delivery 15, margin 15, ratings 10, visual 10, competition 5, upsell 5, return risk 5; shortlist ≥ 75; zero points where evidence is unavailable), `persist.ts` (writes suppliers/supplier_products/product_candidates/product_scores/agent_jobs/agent_runs/agent_logs through the ADMIN JWT — RLS enforces admin-only writes; product draft honors legacy NOT NULL columns and is always `status='draft'`), `engine.ts` (runScoutResearch creates a PRODUCT_RESEARCH job, dedupes by source URL, records failures honestly).

**Admin UI** — real stat cards (row counts, no fabricated numbers), filters (status/source/score/price/margin/USA/days/category), candidates table (image, title, source, price, shipping, landed, suggested, margin %, score/100, USA, evidence status, status, rejection reason), evidence viewer modal (VERIFIED/INFERRED/UNKNOWN badges + unknown fields + risk notes + legacy-row fallback), owner actions: Approve / Reject (with exact reason) / Create Product Draft (status `draft` only). "Run Scout Run" modal with editable source URLs + live progress log.

**First live research run (one controlled test, 2026-08-17)** — 12 verified real pet-product URLs (KONG manufacturer pages + Petco/Chewy retailer pages, each pre-checked fetchable). Results persisted to the real DB: **10 candidates** (2 researchable, 7 rejected, 1 pre-existing approved), e.g. KONG Flyer **54/100** (researching), KONG Extreme **58/100** (approved by owner in test + product draft created at `status='draft'`, USD, inventory 0). Rejections were honest: 404 pages → unavailable; Chewy JS-heavy pages → no extractable price (unclear landed cost). Dedupe skipped the already-known KONG Classic. No candidates auto-published; the draft is invisible on the storefront (verified live — catalog still shows only the published KONG Classic, source=SUPABASE).

**Fixes made during the live run** — (1) `src/features/ai/importer.ts`: the Vite dev server serves `/api/fetch-page` as a **JS module** (`text/javascript` content-type containing local source), which the old HTML-only guard accepted and treated as page content. Now rejects JS/JSON content types + leading `import {` lines so local source can never be misread as a fetched page. (2) `src/features/scout/extract.ts`: strip Jina Reader `Title:` prefix. (3) `ProductScout.tsx`: legacy-evidence rendering + score join by `candidate_id`.

**Tests** — 26 new scout tests (`src/features/scout/__tests__/scout.test.ts`) covering: exact 100-pt weights, evidence-based scoring, zero-points-on-missing-evidence, margin confidence/LOW-shipping, hard-rejection filters (counterfeit/medical/dangerous/battery/unavailable), unknown-evidence handling, dedupe, supplier normalization, candidate/score/supplier persistence via a fake admin-JWT adapter, product draft (never published), approval transitions (owner-only), and RLS simulation (anon/customer writes rejected). **114/114 tests pass, tsc 0 errors, build pass** (storefront 410.46 KB / gzip 116.97 KB, admin lazy 281.55 KB — scout adds ~39 KB to the lazy admin chunk only).

**Security** — scout mutations go through the db adapter with the admin's own JWT (never service-role); RLS `owner all` policies gate suppliers/candidates/scores/jobs; anon/customer have no policies on those tables. Bundle scan CLEAN of secret values (only env-var names in the admin UI, public publishable key by design). No credentials changed.

**DB state after Phase 4A** — `product_candidates`: 10 rows (1 approved legacy KONG Classic + KONG Extreme approved + KONG Flyer researching + 7 rejected with reasons); `product_scores`: 10; `supplier_products`: 10; `suppliers`: 4 (KONG Company, Kongcompany, Petco, Chewy, Outwardhound); `agent_jobs`/`agent_runs`/`agent_logs`: PRODUCT_RESEARCH runs recorded; `products`: KONG Classic (published) + KONG Extreme (**draft**, invisible to storefront).

## Exact recommended next task

**Phase 4B — one-product autonomous listing.** Using the approved KONG Extreme candidate, run listing generation (title/description/specs via the secure server proxy, if AI keys are configured) → QA → owner publish; wire admin Products/orders views to real DB reads; reconcile legacy order/address columns. Do NOT deploy to production from this branch; `main` stays live.
