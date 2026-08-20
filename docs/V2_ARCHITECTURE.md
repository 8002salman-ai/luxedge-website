# Luxedge V2 — Phase 0/1 Architecture

## Repository

- Branch: `luxedge-v2` (development). `main` = production (`luxedge.us`), untouched.
- Stack: Vite 7 · React 19 · TypeScript 5.9 · Tailwind 4 · React Router 7 (hash) · Zustand 5.
- Deploy: Vercel (static `dist/` + serverless `/api/*` functions).

## Audit result

| Class | Files |
|---|---|
| KEEP | Storefront (App.tsx routing + pages), lazy admin (AdminSection.tsx), marketing/AdSense/consent stack, authStore |
| REFACTOR | AI import engine (was inline in App.tsx) → `src/features/ai/*`; provider config (keys removed) |
| REBUILD (later) | Data layer → Supabase (schema shipped, adapter boundary ready) |
| REMOVE | Dead parallel tree: `src/pages/*`, `src/components/store/*`, orphan stores, legacy types/utils (~30 files, none imported by live code) |
| ADD | Server API (`/api/ai/*`, `/api/fetch-page`), `.env.example`, db adapter, vitest suite |

## Security (Phase 1)

**Before:** AI provider keys + scrape.do token lived in browser code and localStorage
(`luxedge_ai_providers`, `luxedge_api_keys`, `luxedge-settings`), and the browser called
OpenAI/DeepSeek/Anthropic/OpenRouter/Gemini directly.

**After:**
- Keys are read ONLY from server env vars by `/api/ai/*` serverless functions.
- Browser calls `/api/ai/generate`, `/api/ai/test`, `/api/ai/status`, `/api/ai/openrouter-credits`.
- Credential-backed scraping runs through `/api/fetch-page` (token = `SCRAPE_DO_TOKEN` env var).
- `sanitizeProvider()` scrubs any legacy keys still present in localStorage.
- Settings UI now shows server-side configuration status; secret inputs removed.
- `.env.example` lists variable NAMES only. No secrets are committed.

## Data foundation

- `supabase/migrations/0001_initial_schema.sql` — full V2 schema (catalog, suppliers,
  inventory, orders, reviews, AI agents/jobs/logs, candidates/scores, creatives,
  campaigns with hard spend-limit columns) with RLS + indexes.
- `src/services/db.ts` — storage adapter boundary: `LocalStorageAdapter` (today),
  `SupabaseAdapter` (activates when `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` set).
- No fake production data is introduced.

## Monolith breakdown

- AI engine extracted from App.tsx (3368 → 3120 lines) into `src/features/ai/`
  (types, providers, client, importer). App.tsx re-exports for compatibility.
- ~30 dead/duplicate files removed; src tree halved in size.

## Tests

- `npm test` — vitest: 19 tests (provider key scrubbing, JSON extraction parsing,
  local storage adapter CRUD, active-provider resolution).

## Not implemented yet (later phases)

- Supabase project provisioning + secrets (owner must create the project).
- Storefront V2 redesign (Phase 2), Admin Command Center upgrade (Phase 3),
  Product Scout / Listing / Creative / QA / Ads agents (Phases 4–8).
- Real payment integration: current checkout collects card details client-side
  without a processor — NOT a production payment flow; must be replaced with
  Stripe/PayPal server-side (documented, not claimed as real).
