# LUXEDGE STATE — Agent Handoff

Updated after Phase 3A **live wiring** (real Supabase project connected, admin auth verified end-to-end). Phase 1 security work and Phase 2 storefront work remain intact.

## Current state

- **Current branch:** `luxedge-v2` (development). `main` = production (`luxedge.us`), untouched, NOT deployed from this branch.
- **Latest commit:** see `git log` — Phase 3A auth + live Supabase wiring.
- **Current phase:** Phase 3A complete (auth live + API protection + Supabase connected). Phase 3B (real catalog + Admin Command Center) not started.
- **Stack:** Vite 7 · React 19 · TypeScript 5.9 · Tailwind 4 · React Router 7 (hash) · Zustand 5 · Vercel (static dist + serverless `/api/*`).
- **No new runtime dependencies** — Supabase Auth is a thin fetch-based client; JWT verification uses `node:crypto`; migrations applied via Supabase CLI/psql path (pending).

## Live Supabase project (owner-provided)

- Project URL: `https://eidujmfbcfrjjleitaqp.supabase.co`
- Keys: new-style `sb_publishable_...` (browser, works as `apikey` ONLY — NOT as a Bearer token) and `sb_secret_...` (server, Auth Admin + privileged PostgREST).
- Local `.env` (gitignored) carries `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Never committed.
- **Admin user created via Auth Admin API:** `admin@luxedge.us`, `app_metadata.role = 'admin'` (the trusted claim). Password was generated once during setup — rotate it from the dashboard if unknown.
- **Verified live (browser):** admin sign-in → dashboard renders; session survives refresh; logout clears session + redirects to `/admin/login`; storefront anon reads work.
- **Verified live (guard):** a real admin access token passes `adminAuth`; garbage token → 401 (Supabase returns 403 `bad_jwt`, mapped to our 401 contract); a valid non-admin token → 403 (unit-tested).

## What Phase 3A changed

### 1. Real authentication (Supabase Auth) — LIVE
- Demo admin password auth REMOVED (`admin123` gone from codebase + bundle, verified by scan).
- `src/services/supabase.ts` — lean fetch-based Supabase Auth client: sign-in, sign-up, refresh-token rotation, session persistence (`luxedge_sb_session`), role mapping from signed JWT. Never stores plaintext passwords.
- `src/store/authStore.ts` — Supabase-backed session store (`user`, `isAuthenticated`, `isAdmin`, `ready`), hydrated at startup in `main.tsx`.
- Login/signup pages show an honest amber notice when Supabase env vars are missing; guest checkout still works. Admin login is fail-closed without configuration.
- `ProtectedRoute` + admin layout gate on the verified JWT role with a `ready` guard (no flash-redirect on refresh).

### 2. API protection (fail closed) — LIVE
- `api/_lib/jwt.ts` — HS256 JWT verification with `node:crypto` (alg=none/RS256 rejected, timing-safe, expiry enforced).
- `api/_lib/auth.ts` — guard: no token → **401**; invalid/expired → **401** (incl. Supabase 403 `bad_jwt` mapped to 401); valid non-admin → **403**; nothing configured → **503**. Two verification modes:
  1. Local HS256 verify when `SUPABASE_JWT_SECRET` is set (fast).
  2. Remote validation via `GET {url}/auth/v1/user` when the JWT secret is absent but `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` are set server-side (works with the owner's current keys; same admin claim).
- Protected: `/api/ai/generate`, `/api/ai/test`, `/api/ai/status`, `/api/ai/openrouter-credits`, `/api/fetch-page`. Browser AI client attaches `Authorization: Bearer <access token>`.
- `.env.example` documents all vars incl. the new-style key formats.

### 3. Rate limiting boundary
- `api/_lib/providers.ts` exposes a `RateLimiter` interface + `InMemoryRateLimiter` (per warm instance). Shared limiter (Upstash/Vercel KV) drops in later without touching endpoints.

### 4. Database adapter honesty
- `src/services/db.ts`: `testConnection()` on both adapters (real probe; `ok:false`, no silent localStorage fallback when Supabase is configured but unreachable). `SupabaseAdapter.setAccessToken()` threads the signed-in user's JWT.
- **Headers fixed for new-style keys:** publishable/anon key goes in `apikey` ONLY; a user access token is added as `Authorization: Bearer` when present (RLS then sees the user's role).

### 5. RLS
- `0002_auth_rls.sql`: customers → `auth.users` (`auth_user_id`), `current_customer_id()` helper, customer-scoped policies (own profile/addresses/orders select+insert/order_items/reviews). Admin tables stay claim-gated; no customer access; no `USING(true)`.

## Database status — PARTIAL SCHEMA, BLOCKED (Phase 3B blocker)

- **The live project has a PARTIAL, OLDER schema:** only 7 tables exist (`categories`, `products`, `product_variants`, `product_images`, `addresses`, `orders`, `order_items`). `customers` is MISSING (PostgREST: `could not find table 'public.customers'`), and most 0001 tables (suppliers, reviews, ai_providers, agent_jobs, candidates, campaigns, …) return 404. The 7 existing tables do not match `0001_initial_schema.sql` exactly.
- **Grants are inconsistent:** anon reads work (200 on categories/products); the secret key gets 42501/403 on some tables (missing `service_role` grants — `0003_role_grants.sql` fixes this) and RLS blocks some inserts.
- **Direct DB access fails:** the provided connection string `postgresql://postgres:Supabase123Supabase@db.<ref>.supabase.co:5432/postgres` returns `password authentication failed for user "postgres"`. Pooler hostname variants were not resolvable. **Owner action needed:** verify the postgres password (Dashboard → Project Settings → Database → Connection string) or apply migrations via the Dashboard SQL editor.
- **Safe next step (SQL editor or psql):** run `0001` (creates the 23 missing tables via `create table if not exists`), `0002` (customer RLS), `0003` (grants + default privileges). Then reconcile the 7 pre-existing tables if column shapes differ.

## Known issues (documented)

- Partial/older schema on the live project (see above) — Phase 3B must reconcile before DB-backed storefront reads.
- `/api/ai/*` + `/api/fetch-page` now require an admin JWT — on Vercel they work once the Supabase env vars are added there; the AI providers also need their keys to actually generate.
- Storefront commerce data is still hard-coded demo data (`INIT_PRODUCTS`/`EXTRA_PRODUCTS`) with stub ratings — Phase 3B replaces with the DB-backed catalog.
- Checkout payment is demo mode (no processor) — explicit notice shown.
- Customers-row creation on signup (link `auth.uid()` → `customers.id`) not wired yet — Phase 3B onboarding.
- In-memory per-instance rate limiting only; shared limiter interface ready.

## Security status

- No secrets in bundle/localStorage beyond the user's own session tokens. Verified: zero `sk-*`, zero `admin123`, zero `password123`, no `SUPABASE_SERVICE_ROLE_KEY` name in client code. `.env.example` is names-only. `.env` is gitignored.
- The admin password was created via the Auth Admin API and never committed.
- Service-role/secret key + JWT secret exist only as env var names in `src/`; the secret key is used only by the setup scripts (deleted) and future serverless data ops.
- Server-side: keys from env only; SSRF guard + timeouts + model allowlist + rate limits + admin JWT guard active.

## Build / test status

- `npm test` ✅ **77/77** · `npx tsc --noEmit` ✅ 0 errors · `npm run build` ✅ (storefront ~403.5 KB / gzip ~114.8 KB, admin lazy ~242 KB).
- Verified live in the browser: admin sign-in → dashboard, session survival across refresh, logout → redirect, AI Hub renders, storefront routes (home/shop/product/cart/checkout/blog) + AdSense/consent stack with zero console errors.

## Credentials genuinely required (owner)

1. ✅ Supabase project URL + publishable key + secret key — provided, wired locally.
2. ⚠️ Postgres DB password (for direct schema/grants application) — current one fails; or use the Dashboard SQL editor with the three migrations.
3. Optional: `SUPABASE_JWT_SECRET` (local fast verify; remote validation already works without it).
4. AI provider keys (server env): `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`.
5. Scraping: `SCRAPE_DO_TOKEN` (optional). Payments (later phase): Stripe/PayPal server keys.

## Vercel env vars to add (when deploying this branch)

`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (publishable key), `SUPABASE_SERVICE_ROLE_KEY` (secret key), optional `SUPABASE_JWT_SECRET`, plus the AI provider keys. `VITE_*` vars must be exposed to the browser build.

## Exact recommended next task

**Phase 3B — Real catalog + Admin Command Center on `luxedge-v2`:** fix DB access (owner password or SQL editor), apply `0001`+`0002`+`0003`, reconcile the 7 pre-existing tables, integration-test `src/services/db.ts` (anon/authenticated/admin roles), create the customers row on signup, replace hard-coded `INIT_PRODUCTS` with DB-backed data, and upgrade the admin UI (products, candidates, suppliers, orders, AI agents, jobs, logs, campaigns with hard spend limits). Do NOT deploy to production from this branch; `main` stays live.
