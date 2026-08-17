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

## Exact recommended next task

**Phase 4 — Product Scout (prereq: apply `0006` in the SQL editor).** Build the autonomous discovery → scoring → candidate pipeline that writes real, verified pet products into `product_candidates` (evidence-gated), then Phase 3C-style admin UI wiring. Do NOT deploy to production from this branch; `main` stays live.
