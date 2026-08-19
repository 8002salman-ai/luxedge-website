# Luxedge × Salman OS — AI Integration Contract (FROZEN)

contract_version: 1
Version: 1.0 — Freeze date: 2026-08-19
Status: **FROZEN** — do not rename endpoints or fields without a version bump.
No secrets are documented here. This is the contract the Luxedge repository
integrates against.

Salman OS is the AI control plane. Luxedge is project #1. The SAME backend
supports Himalayan Koh later by registering a project row (no Hermes rewrite).

---

> ## VENDORED COPY METADATA (Luxedge repo)
>
> This is a non-secret vendored copy of the authoritative contract that lives
> in the Salman OS repository (`C:\Users\basco\salman-os`). Luxedge integrates
> against THIS contract; the Salman OS repository remains the source of truth
> and is never modified from Luxedge.
>
> - **Source**: `C:\Users\basco\salman-os\LUXEDGE_AI_CONTRACT.md`
> - **Source commit**: `4ef7e62ce8277f30d5e36439ecc1b34bc719045a` (2026-08-19 11:56:09 -0500)
> - **Contract version**: 1.0 (backend machine value `CONTRACT_VERSION = 1`)
> - **Status**: FROZEN — do not rename endpoints or fields without a version bump
>
> Runtime connection readiness does NOT depend on this file's presence. The
> Luxedge server adapter gates live calls on `SALMAN_OS_BASE_URL` +
> `SALMAN_OS_TOKEN` (server env), then verifies the remote status handshake
> (project registered + `contract_version` match + bridge/scheduler/router
> state). See `src/services/salmanOs/contract.ts`.

## 1. Base URL & config

| Item | Value |
|---|---|
| Salman OS base URL | `https://salman-os-swart.vercel.app` (prod) or local `http://localhost:3003` |
| Project id (URL slug) | `luxedge` (also accepts the project UUID in `:id`) |
| Environment field | `preview` \| `production` — always sent by the caller; never inferred |
| Default environment | `preview` (owner builds on preview; production is separate) |

Preview URL for Luxedge is set via `LUXEDGE_PREVIEW_URL` (env) or the
`projects.preview_url` DB column when the Vercel hash URL is known. Until then
preview health reports `not_configured` — honestly, never a guessed URL.

## 2. Authentication

- Browser/UI: Supabase session (email+password) — enforced by the app proxy.
- Server-to-server: shared secret header `x-internal-secret: <BRIDGE_INTERNAL_SECRET>`
  for `/api/internal/*` only.
- Job endpoints require a browser session; no client-visible credentials exist.

## 3. Endpoints (frozen)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/projects/:id/status` | Project + router + queue + modules status |
| GET | `/api/projects/:id/intelligence` | Completed structured research results |
| GET | `/api/projects/:id/jobs` | Recent jobs for the project |
| POST | `/api/projects/:id/jobs/run` | RUN NOW / pause / resume / run_all / pause_all / scheduler |
| POST | `/api/projects/:id/jobs/:jobId/pause` | Pause one job |
| POST | `/api/projects/:id/jobs/:jobId/resume` | Resume one job |
| GET | `/api/projects/:id/modules` | Module list + pause state |
| GET | `/api/projects/:id/health` | Env-aware site health (preview/production separate) |
| GET | `/api/luxedge/intelligence` | **Compatibility** — legacy, may remain |
| GET | `/api/ops/overview?slug=luxedge` | Main dashboard AI Operations payload |
| GET/POST | `/api/router/policy` | Owner router policy (FREE ONLY / FREE + CRITICAL BACKUP / ALLOW PAID) |

`:id` = slug (`luxedge`) or project UUID — both resolve.

## 4. Job types (frozen module ids)

`product_research`, `seo_research`, `free_marketing`, `free_listing_opportunities`,
`market_research`, `marketing_research`, `ads_intelligence`, `catalog_quality_review`

Each module maps to one Hermes research task type and supports
RUN NOW / PAUSE / RESUME / VIEW RESULTS. `product_research` and
`ads_intelligence` are **critical** (may use paid backup per policy);
the rest are **non-critical** (never spend paid credits).

## 5. POST /api/projects/:id/jobs/run — request schema

```jsonc
// RUN NOW (single module)
{ "module": "product_research", "environment": "preview" }
// Global controls
{ "action": "run_all", "environment": "preview" }
{ "action": "pause_all" }
{ "action": "resume_all" }
// Per-module control
{ "action": "pause", "module": "seo_research" }
{ "action": "resume", "module": "seo_research" }
// Scheduler
{ "action": "scheduler", "scheduler": true }
```

## 6. Response schema (frozen)

Every job/result exposes:

```jsonc
{
  "success": true,
  "data": {
    "action": "run",
    "environment": "preview",
    "results": [
      {
        "module": "product_research",
        "action": "dispatched" | "paused" | "paused_by_owner" | "failed",
        "task_id": "uuid",
        "duplicate": false,
        "model": "actual model name",        // authoritative for the result
        "cost_class": "FREE" | "PAID" | "UNKNOWN",
        "fallback_used": false,
        "reason": "Free model available — TIER 0 FREE selected (free-first policy)."
      }
    ],
    "dispatched": 1,
    "paused": 0
  },
  "meta": { "policy": "free_critical_backup", "free_available": true, "note": "..." }
}
```

Stored result envelope (in the task's `result` / intelligence items):

```jsonc
{
  "project": "luxedge",
  "environment": "preview",
  "task_type": "product_discovery",
  "model": "deepseek-chat",              // what actually generated it
  "provider": "deepseek",
  "cost_class": "PAID",
  "fallback_used": true,
  "fallback_reason": "Free and Codex unavailable - TIER 2 DEEPSEEK last backup",
  "started_at": "iso", "completed_at": "iso",
  "summary": "...", "findings": [...], "evidence": [...],
  "analysis": "...", "recommendations": [...], "risks": [...],
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "source_urls": ["https://..."],
  "error": null
}
```

Evidence quality is marked per finding: `VERIFIED` | `INFERRED` | `UNKNOWN`.

## 7. Cost / fallback policy (frozen, owner-controlled)

- Default policy: `free_critical_backup` (FREE + CRITICAL BACKUP).
- Routine (non-critical) work: FREE model only. FREE unavailable → **PAUSED**,
  Telegram notification, **no paid spend**.
- Critical work: FREE → Codex (TIER 1) → DeepSeek (TIER 2) → PAUSED if all down.
- Model availability is evidence-based: real quota/rate-limit failures set
  cooldowns in `model_registry`; no infinite retries, no runaway spend.
- Policy modes: `free_only` | `free_critical_backup` | `allow_paid`.
  The owner changes policy via the dashboard or `/api/router/policy` — never silently.

## 8. Error states

| Case | HTTP | Body |
|---|---|---|
| Unknown project | 404 | `{ success:false, error:"Project ... not registered." }` |
| DB not configured | 503 | `{ success:false, error:"Database not configured." }` |
| Bad JSON | 400 | `{ success:false, error:"Invalid JSON body" }` |
| Unknown module | 400 | `{ success:false, error:"Module ... not enabled ..." }` |
| No free model | 200 | `action:"paused"` with reason (NOT an error — policy behavior) |

## 9. Pause / resume semantics

- PAUSE gates future dispatch only. It never kills the bridge, the Hermes
  runtime, other modules, or Luxedge itself.
- RESUME re-enables dispatch.
- `pause_all` / `resume_all` apply to all enabled modules of the project.

## 10. Research security boundary (frozen)

Hermes research may: search/read public evidence, analyze supplied catalog data,
rank, recommend, create structured drafts, notify the owner.
Hermes research may NOT: inspect project repos, execute shell commands, write
source files, modify the catalog, change prices/stock/Stripe, refund, deploy
production, or run paid advertising. Business writes = 0 by design.

## 11. Model display truth (frozen)

- **Default free model** = configured/registered free model.
- **Current task model** = router decision at dispatch.
- **Last completed model** = the model recorded in the completed result —
  authoritative. Provider, cost class, fallback_used, and fallback_reason come
  from the same result envelope.
- No card may claim model X while the stored result reports model Y.

## 12. Telegram owner ops (reusable)

- Generic command routing: `/projects`, `/luxedge status|preview|production`,
  `/luxedge run products|seo|marketing|free-listings`,
  `/luxedge pause|resume <module>`, `/luxedge results|attention`.
- Same parser later serves `/himalayan-koh ...` — no per-project bot.
- One concise daily brief (LUXEDGE DAILY) — no repeated noise.
