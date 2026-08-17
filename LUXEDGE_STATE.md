# LUXEDGE STATE — Agent Handoff

Updated after Phase 3A (real auth + API protection + Supabase foundation). Phase 1 security work and Phase 2 storefront work remain intact.

## Current state

- **Current branch:** `luxedge-v2` (development). `main` = production (`luxedge.us`), untouched, NOT deployed from this branch.
- **Latest commit:** see `git log` — Phase 3A auth work.
- **Current phase:** Phase 3A complete (auth + API protection + Supabase integration FOUNDATION). Phase 3B (real catalog + Admin Command Center) not started.
- **Stack:** Vite 7 · React 19 · TypeScript 5.9 · Tailwind 4 · React Router 7 (hash) · Zustand 5 · Vercel (static dist + serverless `/api/*`).
- **No new runtime dependencies added in Phase 3A** — Supabase Auth is a thin fetch-based client (`src/services/supabase.ts`); JWT verification uses `node:crypto` only.

## What Phase 3A changed

### 1. Real authentication (Supabase Auth)
- **Demo admin password auth REMOVED.** `admin@luxedge.us` / `admin123` is gone from the codebase and the bundle (verified by scan). No demo credential fallback exists.
- New `src/services/supabase.ts` — minimal fetch-based Supabase Auth client (email/password): sign-in, sign-up, refresh-token rotation, sign-out, session persistence in localStorage (`luxedge_sb_session`), role mapping from the signed JWT (`app_metadata.role = 'admin'` → admin, else buyer). Never stores plaintext passwords.
- `src/store/authStore.ts` rewritten — Supabase-backed session store (`user`, `isAuthenticated`, `isAdmin`, `ready`), hydrated at startup in `main.tsx` (`init()`). Session survives refresh, expires with the JWT (auto-refresh near expiry), and logs out cleanly (server revoke + local clear).
- Login/signup pages show an honest amber notice when Supabase env vars are missing; guest checkout still works. Admin login page shows an explicit "not configured" panel — no fake credentials.
- `ProtectedRoute` and the admin layout gate on the verified JWT role (with a `ready` guard so refresh doesn't flash-redirect).

### 2. API protection (fail closed)
- New `api/_lib/jwt.ts` — HS256 JWT verification with `node:crypto` (alg=none/RS256 rejected, timing-safe compare, expiry enforced). No third-party dependency.
- New `api/_lib/auth.ts` — `adminAuth()`/`requireAdmin()` guard: no token → **401**; invalid/expired → **401**; valid non-admin → **403**; `SUPABASE_JWT_SECRET` missing → **503** (never opens up).
- Protected (all require a valid admin JWT): `/api/ai/generate`, `/api/ai/test`, `/api/ai/status`, `/api/ai/openrouter-credits`, `/api/fetch-page`.
- Browser AI client (`src/features/ai/client.ts`) now attaches `Authorization: Bearer <access token>` and surfaces 401/403 as "Admin session required — sign in to the admin dashboard".
- `.env.example` documents `SUPABASE_JWT_SECRET` (server-only) with the fail-closed note.

### 3. Rate limiting boundary
- `api/_lib/providers.ts` now exposes a `RateLimiter` interface + `InMemoryRateLimiter` (per warm instance, honest limitation). A future shared limiter (Upstash/Vercel KV) implements the same interface without touching endpoints.

### 4. Database adapter honesty
- `src/services/db.ts`: both adapters implement `testConnection()` — a REAL probe. `SupabaseAdapter.testConnection()` performs an actual anon read of `categories` and returns `ok:false` (never a silent localStorage fallback) when Supabase is configured but unreachable.
- `SupabaseAdapter.setAccessToken()` — uses the signed-in user's JWT for requests when present (RLS then sees their role).
- Existing behavior preserved: localStorage active until `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` are set.

### 5. RLS — customer scoping (migration `0002_auth_rls.sql`)
- `customers.auth_user_id` links a customer to `auth.users`.
- `public.current_customer_id()` helper resolves the signed-in user.
- Customer policies: own profile (select/insert/update), own addresses (CRUD), own orders (select/insert only — no customer UPDATE/DELETE), own order_items (via owned order), own reviews (insert pending, select own).
- No policies were added on suppliers / AI providers / agent jobs / candidates / creatives / campaigns — RLS denies by default, so customers can never reach admin data. Admin access remains claim-based (`app_metadata.role = 'admin'`).

## Known issues (documented)

- **BLOCKED ON OWNER CONFIG:** no Supabase project credentials exist yet, so:
  - Supabase auth is NOT live-tested against a real project; unit tests mock the Auth REST API.
  - The migration has NOT been applied anywhere.
  - Admin login is locked (fail closed) until `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` are set and an admin user is promoted (`app_metadata.role = 'admin'`, e.g. via Supabase dashboard or `auth.admin.updateUserById` with the service-role key).
- `/api/ai/*` + `/api/fetch-page` now require an admin JWT — the AI Hub "test provider" / "import" features are dormant until Supabase is configured (they were also dormant without provider keys).
- Storefront commerce data is still hard-coded demo data (`INIT_PRODUCTS`/`EXTRA_PRODUCTS`) with stub ratings — Phase 3B replaces with the DB-backed catalog.
- Checkout payment is demo mode (no processor) — explicit notice shown.
- Customers table row creation on signup (to link `auth.uid()` → `customers.id`) is not wired yet — Phase 3B onboarding.
- In-memory per-instance rate limiting only (documented); shared limiter interface ready.

## Security status

- No secrets in bundle/localStorage: verified scan — zero `sk-*`, zero `admin123`, zero `password123`, no `SUPABASE_SERVICE_ROLE` name in client code. `.env.example` is names-only.
- Service-role key + JWT secret exist only as env var names; never referenced in `src/`.
- Server-side: keys read from env only; SSRF guard + timeouts + model allowlist + rate limits + admin JWT guard all active.
- RLS: anon = public reads only; customers = own rows; admin = claim-based; no permissive `USING(true)` policies.

## Database status

- Migration `0001_initial_schema.sql` (30 tables) + `0002_auth_rls.sql` (customer RLS) ready but UNAPPLIED — needs a real Supabase project.
- Adapter: LocalStorage active today; SupabaseAdapter activates when env vars set and fails loudly (no fake success).

## Build / test status

- `npm install` ✅ (no new deps) · `npx tsc --noEmit` ✅ 0 errors · `npm test` ✅ **70/70** (was 34; added JWT verify 9, auth guard 6, Supabase client 9, handler-level 401/403/503 7, db failure behavior 4, +1 db test) · `npm run build` ✅
- Bundle: storefront `index-*.js` ~403.4 KB (gzip ~114.7 KB; +~1 KB over Phase 2 for the lean Supabase client), admin lazy ~242 KB unchanged, split chunks preserved.
- Routes tested live (dev): `/`, `#/shop`, `#/product/1`, `#/product/2` (add to cart), `#/cart`, `#/checkout` (guest + demo notice), `#/login` (honest not-configured banner + guest), `#/admin/login` (not-configured panel, demo creds rejected), `#/admin` (redirects to login when unauthenticated), `#/blog` — zero console errors; AdSense/consent stack loads.

## Credentials genuinely required (owner)

1. Supabase project → `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (browser), `SUPABASE_SERVICE_ROLE_KEY` + `SUPABASE_JWT_SECRET` (server-only). Apply both migrations; promote the admin user (`app_metadata.role = 'admin'`).
2. AI provider keys (server env): `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`.
3. Scraping: `SCRAPE_DO_TOKEN` (optional).
4. Payments (later phase): Stripe/PayPal server keys.

## Exact recommended next task

**Phase 3B — Real catalog + Admin Command Center on `luxedge-v2`:** provision the Supabase project + apply `0001`/`0002` + integration-test `src/services/db.ts` (anon/authenticated/admin roles), create the customers row on signup, replace hard-coded `INIT_PRODUCTS` with DB-backed data, and upgrade the admin UI (products, candidates, suppliers, orders, AI agents, jobs, logs, campaigns with hard spend limits). Do NOT deploy to production from this branch; `main` stays live.
