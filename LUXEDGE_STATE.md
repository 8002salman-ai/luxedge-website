# LUXEDGE STATE — Agent Handoff

Updated by the Claude senior review (independent forensic audit of DeepSeek's Phase 0/1 work).

## Current state

- **Current branch:** `luxedge-v2` (development). `main` = production (`luxedge.us`), untouched.
- **Latest commit (before this review):** `3b0a0f0` (DeepSeek, tests)
- **Latest commit (after this review):** see `git log` — Claude review fixes
- **Current phase:** Phase 1 complete (PASS WITH WARNINGS after fixes). Phase 2 not started.
- **Stack:** Vite 7 · React 19 · TypeScript 5.9 · Tailwind 4 · React Router 7 (hash) · Zustand 5 · Vercel (static dist + serverless `/api/*`).

## What DeepSeek implemented (Phase 0/1)

- Branch `luxedge-v2` created; `main` untouched.
- AI provider keys moved out of the browser: `src/features/ai/*` (types, providers, client, importer) proxy through new serverless `/api/ai/*` functions (`generate`, `status`, `test`, `openrouter-credits`) + `/api/fetch-page`. Keys read only from server env vars.
- `src/store/settingsStore.ts` de-scoped to client-safe values only.
- `supabase/migrations/0001_initial_schema.sql` — full V2 schema (30 tables) with RLS.
- `src/services/db.ts` — storage adapter boundary (LocalStorage today, Supabase/PostgREST when env vars set).
- ~45 dead/duplicate files removed (parallel storefront tree, orphan stores, legacy utils) — all verified dead by import graph + tsc.
- Vitest suite: 19 tests. `npm test`, `npx tsc --noEmit`, `npm run build` all green at handoff.
- `.env.example` (names only), `docs/V2_ARCHITECTURE.md`.

## What Claude verified (independent audit)

Regression/deletion audit, security review, serverless API review, migration + RLS review, db adapter honesty, payment safety, test quality, full build/runtime route sweep, bundle secret scan. Details in the review report; conclusions below.

## What Claude changed (fixes)

1. **Supabase migration bug (would fail to apply):** `collection_products` referenced `public.products` before it existed → moved after `product_images`.
2. **RLS missing policy:** `collection_products` had no public read policy (storefront collections would return nothing) → added public select policy (published products + active collections only).
3. **RLS owner flaw:** all 30 admin tables granted full access to ANY `authenticated` user → changed to claim-based `(auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'`, so future customer accounts cannot become owners.
4. **SSRF in `/api/fetch-page`:** arbitrary URL fetch with no private-network protection → added `api/_lib/ssrf.ts` guard (DNS resolve + private/loopback/metadata blocklist, no embedded credentials, http(s) only, standard ports only, per-hop redirect re-validation).
5. **No timeouts on provider calls:** added `AbortSignal.timeout(45s)` to all outbound provider fetches.
6. **Model parameter injection:** `isValidModel()` allowlist regex enforced in `generate`/`test` handlers (Gemini URL was interpolating raw model).
7. **Legacy secrets persist in localStorage:** `luxedge_api_keys` never removed; `luxedge-settings` legacy `apiKeys` (scrapedoKey/openAiKey/openRouterKey/geminiApiKey) never scrubbed → added `scrubLegacySecrets()` in `src/features/ai/providers.ts`, called at startup in `src/main.tsx`, with tests.
8. **`/api/fetch-page` never actually used by the client** (UI claimed scrape.do support): `fetchPageContent` in `src/features/ai/importer.ts` now tries the server proxy first, falls back to public browser-side proxies (dev server has no /api).
9. **Payment honesty:** misleading "256-bit SSL / processed through Stripe or PayPal" claims replaced with an explicit demo notice; card fields (number/expiry/CVC/name) cleared immediately after the demo payment; FAQ corrected. No card data is stored, logged, or transmitted (verified).
10. **Per-instance rate limiting** on `/api/ai/*` and `/api/fetch-page` (30 req/min/IP, in-memory — honest limitation: per warm instance only).
11. **`api/` now typechecked:** added `"api"` to tsconfig include (server code previously escaped tsc). Fixed `sanitizeError` unused param.
12. Stale `@source not` Tailwind directives for deleted files removed from `src/index.css`.

## Known issues (documented, not fixed)

- **No real authentication on `/api/ai/*` or `/api/fetch-page`.** Anyone with the URL can burn the owner's paid AI credits. Mitigations are defense-in-depth only (rate limit per instance, body/prompt caps, model allowlist). Real auth (Supabase Auth + service-role server calls or an admin gateway) is REQUIRED in Phase 3 before autonomous agents go live. Rate limiting is per-instance, not global — global needs Vercel KV/Upstash.
- **Admin auth is still demo** (password stored client-side). Phase 3 must move to hashed server-side auth.
- **Checkout payment is a demo flow** — no processor. Real Stripe/PayPal (server-side, secrets in env) belongs to a later phase. Storefront `placeOrder` writes orders to in-memory state only (not persisted beyond session; cart + session persist to localStorage).
- **Supabase project not provisioned** — `src/services/db.ts` SupabaseAdapter is real PostgREST code but NOT integration-tested against a live project. `getDbMode()` returns `local` until `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` are set at build time.
- **Storefront commerce data is hard-coded** (`INIT_PRODUCTS` in App.tsx) — the schema/adapter exist but nothing migrates existing data yet (Phase 3).
- `vercel.json` deploys `/api/*` functions alongside the static build (standard Vercel convention) — verify on first Vercel deploy of this branch.

## Security status

- No provider secret reaches the browser bundle (verified: `sk-*` values, `luxedge_api_keys` absent from `dist/`; only env-var NAMES appear in admin UI text).
- No secrets committed. `.env.example` has names only. `.gitignore` ignores `*.env.*` — `.env.example` was force-added; keep it that way.
- Server responses never echo keys; provider error bodies are sanitized (`sanitizeError`).
- SSRF guard active on `/api/fetch-page`; model/prompt/body limits on `/api/ai/*`.
- RLS: anon reads only published catalog + approved reviews; admin writes require `app_metadata.role = 'admin'` claim.

## Database status

- Migration `supabase/migrations/0001_initial_schema.sql` (30 tables) fixed and review-passed, but NOT applied anywhere (no Supabase project yet).
- `src/services/db.ts`: `LocalStorageAdapter` (active) / `SupabaseAdapter` (activates when env vars set at build; untested against live project).
- No fake production data introduced.

## Build / test status

- `npm install` ✅ · `npx tsc --noEmit` ✅ 0 errors (includes `api/`) · `npm test` ✅ 34/34 · `npm run build` ✅ (storefront ~398KB, admin lazy ~242KB).
- Runtime route sweep on dev server: `/`, `#/shop`, `#/product/1`, `#/cart`, `#/checkout` (full flow incl. demo payment), `#/login`, `#/blog`, `#/privacy`, `#/admin`, `#/admin/products`, `#/admin/ai`, `#/admin/ai-import`, `#/admin/settings`, `#/admin/marketing-traffic` — all render, zero console errors.

## Credentials genuinely required (later)

1. **Supabase project** → `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (client-safe), `SUPABASE_SERVICE_ROLE_KEY` (server-only). Apply migration.
2. **AI provider keys** (server env only, names in `.env.example`): `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`.
3. **Scraping:** `SCRAPE_DO_TOKEN` (optional).
4. **Payments (Phase 3+):** Stripe/PayPal server keys.

## Exact recommended next task

**Phase 2 — Storefront V2 premium redesign on `luxedge-v2`:** build the Luxedge design system (tokens in `src/index.css`), redesign homepage (premium hero, featured/bestselling/new-arrival sections, category nav, trust/social-proof sections with truthful empty states), product detail page (gallery, variants, shipping estimate, FAQ, reviews, structured data), and mobile-first polish. Preserve existing routes/URLs and the blue identity. Do NOT touch `main`; do NOT deploy to production from this branch. Before Phase 2 starts, Phase 1 must be accepted as PASS/PASS WITH WARNINGS.
