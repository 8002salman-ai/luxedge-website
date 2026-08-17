# LUXEDGE STATE — Agent Handoff

Updated after **Phase 3B (database completion attempt)** on `luxedge-v2`. Phase 1 security, Phase 2 storefront, and Phase 3A auth/API work remain intact.

## Phase 3B Status — PASS WITH WARNINGS (DB application BLOCKED on owner)

- **Date:** 2026-08-17
- **Branch:** `luxedge-v2` (development). `main` = production (`luxedge.us`), untouched, NOT deployed from this branch.
- **Commit:** see `git log` — Phase 3B commit on top of the Phase 3A closure; `main` still `4d0086d`.
- **What shipped:**
  1. **`supabase/migrations/0004_reconcile_live.sql`** — a single, ordered, idempotent, ADDITIVE SQL package for the **Dashboard → SQL Editor** that reconciles the live project to the V2 schema: adds V2 columns to the existing tables, creates the 22 missing V2 tables, converts legacy enum statuses to text with V2 checks, rebuilds RLS policies (drop-if-exists + create), re-adds grants + default privileges, all without dropping/truncating anything. Safe to run twice.
  2. **`src/services/catalog.ts`** — storefront catalog loader: reads published products + active categories (+ optional images) from Supabase; returns `null` when unconfigured/unreachable/empty so the demo catalog stays. Handles BOTH schemas (V2 `name`/`price` and legacy `title`/`price_amount` integer-cents) defensively.
  3. **`src/services/customer.ts`** — `ensureCustomerProfile()`: creates/links a `customers` row for the signed-in auth user using their OWN JWT (RLS-governed; no service-role; never sends a role). Honest `not-provisioned` result when the table is missing (migration not applied) — signup never breaks.
  4. **`src/App.tsx`** — catalog load wired into `AppProvider` (fire-once; demo data preserved on any failure; mapped products keep `rating:0/reviews:0` so no fabricated ratings).
  5. **`src/store/authStore.ts`** — fire-and-forget customer-profile sync after sign-in/sign-up.
  6. **`src/services/db.ts`** — new `findFirst(table, column, value)` on both adapters (identity lookups for customer sync).
  7. **Tests:** +13 new (catalog loader 6, customer sync 6, adapter `findFirst` 1) → **88/88 pass**.

- **Live database inventory (verified via PostgREST this phase):** the live project has **13 tables, ALL EMPTY**, from an older schema: `categories`, `products`, `product_variants`, `product_images`, `orders`, `order_items`, `addresses`, `inventory`, `profiles`, `admin_email_allowlist`, `supplier_mappings`, `price_history`, `processed_webhook_events`. Money is integer cents; `profiles` (with `user_role` enum incl. `admin`) replaces V2's `customers`; statuses are enums. Anon can SELECT only categories/products/variants/images (all return `[]`); everything else → 42501/403 (missing grants — `0003` fixes).
- **Auth users present:** `admin@luxedge.us` + `8002salman@gmail.com` (both `role=admin`), plus 3 leftover buyer-debug accounts from Phase 3A contract testing (can be deleted by the owner).
- **Migration application:** **BLOCKED ON OWNER CONFIG.** Every direct postgres path was retried and rejected with `password authentication failed for user "postgres"` (direct host, pooler :6543, pooler :5432, ref-suffixed pooler). No Supabase CLI access token is stored. **Apply path:** Dashboard → SQL Editor → paste `0004_reconcile_live.sql` and run. Or provide a correct postgres password.
- **Catalog wiring verified live:** with the DB empty, `loadStorefrontCatalog()` returns null → the storefront correctly keeps the demo catalog (verified in browser: 120 products render, no errors). When the owner applies `0004` and populates products, the storefront switches to DB data automatically.
- **Customer wiring verified:** unit-tested (creates row with user JWT, no role field; existing row = success; missing table = honest `not-provisioned`; unique-race = success). Live end-to-end pending the `customers` table existing.
- **Tests:** 88/88 pass · **Typecheck:** 0 errors · **Build:** pass (storefront ~410.4 KB / gzip ~117.0 KB, admin lazy ~242 KB).

### Credential / security note (unchanged from Phase 3A closure)

A real postgres DB password was previously written into this file (commit `1e21290`) and was **redacted from the working tree**. It remains in git history; the credential was **not rotated** — the owner decides rotation after the project completes. Do not re-print real secret values in this file.

## Current state

- **Current branch:** `luxedge-v2`. `main` untouched (`4d0086d`), NOT deployed from this branch.
- **Current phase:** Phase 3B — app wiring complete (catalog + customer sync + reconcile package); **database application blocked on owner** (see above). Phase 3B "database complete" verdict: NOT yet — schema must be applied for the DB-backed storefront to actually serve data.
- **Stack:** Vite 7 · React 19 · TypeScript 5.9 · Tailwind 4 · React Router 7 (hash) · Zustand 5 · Vercel (static dist + serverless `/api/*`).
- **No new runtime dependencies** — still a thin fetch-based Supabase client; no SDK added.

## Live Supabase project (owner-provided)

- Project URL: `https://eidujmfbcfrjjleitaqp.supabase.co`
- Keys: new-style `sb_publishable_...` (browser, `apikey` ONLY) and `sb_secret_...` (server). Local `.env` (gitignored) carries `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Never committed.
- Admin user: `admin@luxedge.us` (`app_metadata.role='admin'`) — verified live this phase (sign-in, dashboard, refresh survival, logout, protected-route block).
- **Live DB schema state (this phase's full inventory):** 13 tables, all empty, older schema. Full reconciliation matrix recorded during work; `0004_reconcile_live.sql` encodes the fix.

## What Phase 3B changed

1. **`supabase/migrations/0004_reconcile_live.sql`** (NEW) — single SQL-editor package: additive reconcile of the live DB to V2 (columns, tables, status text-conversion, RLS, grants). Idempotent.
2. **`src/services/catalog.ts`** (NEW) — `loadStorefrontCatalog()` with graceful fallback; schema-tolerant mapper.
3. **`src/services/customer.ts`** (NEW) — `ensureCustomerProfile()` (user-JWT insert, no role, honest states).
4. **`src/services/db.ts`** — `findFirst()` added to both adapters.
5. **`src/App.tsx`** — catalog load effect + `mapCatalogProduct`/`mapCatalogCategory` (no fabricated ratings/reviews/dimensions/shipping).
6. **`src/store/authStore.ts`** — `syncCustomerProfile()` after sign-in/sign-up (fire-and-forget, `console.warn` only on real errors).
7. **Tests** — `catalog.test.ts` (6), `customer.test.ts` (6), `db.test.ts` findFirst (1).

## Database status — BLOCKED ON OWNER (migration not yet applied)

- Live project: 13 legacy tables, all EMPTY, older schema (integer-cent money, `profiles` role enum, Stripe/Shippo legacy columns on orders).
- Direct postgres auth fails on every path tried (direct host, both pooler ports, ref-suffixed pooler): `password authentication failed for user "postgres"`. No CLI access token.
- **Owner action (pick one):**
  1. **Dashboard → SQL Editor → run `supabase/migrations/0004_reconcile_live.sql`** (recommended — no password needed), or
  2. Provide a correct postgres password (Project Settings → Database → Connection string) and run `0001` + `0002` + `0003` + `0004` via psql/`supabase db push`.
- After applying: 30 V2 tables + 5 legacy tables exist, grants restored, RLS enforced, data preserved (none exists today). Then seed the catalog (admin UI or SQL inserts) and the storefront switches from demo to DB data automatically.

## Known issues (documented)

- Live DB schema not yet reconciled (blocker above) — storefront still serves the demo catalog until `0004` is applied and products exist.
- `/api/ai/*` + `/api/fetch-page` require an admin JWT (Vercel env vars + AI provider keys needed for actual generation).
- Storefront commerce data is hard-coded demo data until the DB is populated.
- Checkout payment is demo mode (no processor) — explicit notice shown.
- Customer-profile sync is unit-tested but not live-verified end-to-end until the `customers` table exists.
- In-memory per-instance rate limiting only; shared limiter interface ready.

## Security status

- No secrets in bundle/localStorage beyond the user's own session tokens. Re-verified this phase: bundle scan CLEAN (no `sb_secret_`, no `sk-*`, no `admin123`/`password123`, no `SUPABASE_SERVICE_ROLE_KEY`); only the public publishable key is present (correct by design).
- `.env.example` names-only; `.env` gitignored.
- Service-role/secret key + JWT secret are server-only. SSRF guard + timeouts + model allowlist + rate limits + admin JWT guard active.
- New code adds no privilege: catalog reads are anon/RLS; customer insert uses the user's own token and never sets a role.

## Build / test status

- `npm test` ✅ **88/88** · `npx tsc --noEmit` ✅ 0 errors · `npm run build` ✅ (storefront ~410.4 KB / gzip ~117.0 KB, admin lazy ~242 KB).
- Verified live in the browser this phase: admin sign-in → dashboard; refresh survival; logout → redirect + protected-route block; storefront routes (`/`, `#/shop`, `#/category/dog-supplies`, `#/product/1`, `#/cart`, `#/checkout`, `#/login`, `#/blog`, `#/privacy`, `#/admin/login`, `#/admin`) with zero console errors; AdSense + consent intact; catalog fallback keeps 120 demo products with the DB empty.

## Credentials genuinely required (owner)

1. ✅ Supabase project URL + publishable key + secret key — provided, wired locally.
2. ⚠️ Postgres DB password (for direct application) — current one fails; **or use the Dashboard SQL editor with `0004_reconcile_live.sql`**.
3. Optional: `SUPABASE_JWT_SECRET` (remote validation already works without it).
4. AI provider keys (server env): `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`.
5. Scraping: `SCRAPE_DO_TOKEN` (optional). Payments (later): Stripe/PayPal server keys.

## Vercel env vars to add (when deploying this branch)

`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (publishable key), `SUPABASE_SERVICE_ROLE_KEY` (secret key), optional `SUPABASE_JWT_SECRET`, plus AI provider keys. `VITE_*` vars must be exposed to the browser build.

## Exact recommended next task

**Phase 3B completion (owner action, ~5 minutes):** run `supabase/migrations/0004_reconcile_live.sql` in the Dashboard → SQL Editor (or supply a working postgres password). Then verify with `SupabaseAdapter.testConnection()` + a real anon read of `products`. After the schema is applied, the remaining Phase 3B work is: seed the catalog (admin UI / SQL), live-verify `ensureCustomerProfile()` end-to-end (create a buyer, check the `customers` row, check RLS: buyer cannot read other customers), and upgrade the admin UI (products/candidates/suppliers/orders/AI jobs/logs/campaigns with hard spend limits). Do NOT deploy to production from this branch; `main` stays live.
