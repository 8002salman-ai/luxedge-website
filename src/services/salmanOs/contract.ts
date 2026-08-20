// ============================================================================
// LUXEDGE V2 — SALMAN OS ADAPTER · CONTRACT-GATED CLIENT (SERVER ONLY)
//
// Aligned to the FROZEN Salman OS contract v1.0 — vendored (non-secret) at
// docs/SALMAN_OS_LUXEDGE_AI_CONTRACT.md, source commit
// 4ef7e62ce8277f30d5e36439ecc1b34bc719045a. Salman OS is the PRIMARY AI
// intelligence backend for Luxedge; this module is the ONLY place that talks
// to it.
//
// RUNTIME READINESS does NOT depend on the presence of the contract file.
// Live calls happen ONLY when ALL hold (owner direction, Phase F):
//   1. SALMAN_OS_BASE_URL configured (server env only)
//   2. SALMAN_OS_TOKEN configured (server env only)
//   3. a remote status handshake succeeds
//   4. project "luxedge" is registered on the backend
//   5. the backend contract_version matches CONTRACT_VERSION
//   6. the environment (PREVIEW) is supported
//
// If any gate fails: WAITING / OFFLINE / CONTRACT MISMATCH — never a
// fabricated success. Credentials are read from process.env on the server
// and are NEVER returned to the client, stored in the DB, or logged.
// ============================================================================

import {
  SALMAN_OS_MODULE_IDS,
  SALMAN_OS_KIND_BY_MODULE,
} from './types.js';
import type {
  SalmanOsStatus, SalmanOsLiveState, SalmanOsIntelligenceItem,
  SalmanOsIntelligenceKind, SalmanOsJob, SalmanOsJobKind,
  SalmanOsJobRunResult, SalmanOsJobToggleResult,
} from './types.js';

// Backend machine value (salman-os src/lib/projects/registry.ts).
export const CONTRACT_VERSION = 1;
export const CONTRACT_DOC_VERSION = '1.0';
export const CONTRACT_DOC_PATH = 'docs/SALMAN_OS_LUXEDGE_AI_CONTRACT.md';

export const PROJECT_SLUG = 'luxedge';
const DISPLAY_ENV: 'PREVIEW' | 'PRODUCTION' = process.env.VERCEL_ENV === 'production' ? 'PRODUCTION' : 'PREVIEW';
const REQUEST_ENV = DISPLAY_ENV === 'PRODUCTION' ? 'production' : 'preview';

/** Frozen endpoint paths (contract §3) — centralized for easy adoption. */
const ENDPOINTS = {
  status: '/api/projects/:project/status',
  intelligence: '/api/projects/:project/intelligence',
  jobs: '/api/projects/:project/jobs',
  runJob: '/api/projects/:project/jobs/run',
  overview: '/api/ops/overview',
} as const;

const MODULE_IDS = SALMAN_OS_MODULE_IDS;

function env(name: string): string {
  return (process.env[name] || '').trim();
}

function configReady(): boolean {
  return Boolean(env('SALMAN_OS_BASE_URL') && env('SALMAN_OS_TOKEN'));
}

function costClass(raw: unknown): 'FREE' | 'PAID' | 'UNKNOWN' {
  const s = String(raw || '').toUpperCase();
  return s === 'FREE' || s === 'PAID' ? s : 'UNKNOWN';
}

function endpoint(path: string, project = PROJECT_SLUG): string {
  const base = env('SALMAN_OS_BASE_URL').replace(/\/$/, '');
  return `${base}${path.replace(':project', project)}`;
}

/** Generic server-to-server fetch. Never logs credentials or the token. */
async function sFetch(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: unknown }> {
  const token = env('SALMAN_OS_TOKEN');
  const res = await fetch(endpoint(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

/** Safe structured status — never contains credentials. */
export function salmanOsStatus(): SalmanOsStatus {
  const reason = !env('SALMAN_OS_BASE_URL')
    ? 'SALMAN OS BASE URL REQUIRED — SALMAN_OS_BASE_URL is not configured in the server environment. The public HTTPS base URL from the Salman OS contract is required for the Vercel runtime.'
    : !env('SALMAN_OS_TOKEN')
      ? 'SALMAN OS AUTH PENDING — SALMAN_OS_TOKEN is not configured in the server environment (server-side only).'
      : 'CONFIGURED — awaiting live handshake with Salman OS.';
  return {
    state: configReady() ? 'OFFLINE' : 'WAITING',
    project: { project: PROJECT_SLUG, environment: DISPLAY_ENV, freeFirst: true },
    reason,
    live: null,
    contractVersion: CONTRACT_VERSION,
    checkedAt: new Date().toISOString(),
  };
}

function unbox(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  return d && typeof d === 'object' && d.data && typeof d.data === 'object'
    ? (d.data as Record<string, unknown>)
    : null;
}

/** Map the live status + ops/overview payloads into the safe live-state shape. */
function mapLive(statusData: unknown, overviewData: unknown): SalmanOsLiveState {
  const status = unbox(statusData);
  const overview = unbox(overviewData);
  const envBlock = status?.environment && typeof status.environment === 'object' ? status.environment as Record<string, unknown> : null;
  const hermes = status?.hermes && typeof status.hermes === 'object' ? status.hermes as Record<string, unknown> : null;
  const router = overview?.router && typeof overview.router === 'object' ? overview.router as Record<string, unknown> : null;
  const jobs = overview?.jobs && typeof overview.jobs === 'object' ? overview.jobs as Record<string, unknown> : null;
  const modules = Array.isArray(status?.modules) ? status.modules as Record<string, unknown>[] : [];

  const pausedModules = modules.filter((m) => m.paused === true).map((m) => String(m.id || '')).filter(Boolean);
  const scheduler = envBlock?.scheduler_enabled === true ? 'ENABLED' : envBlock?.scheduler_enabled === false ? 'DISABLED' : undefined;

  return {
    bridge: hermes?.agent_registered === true ? String(hermes.status || 'registered') : hermes?.agent_registered === false ? 'not_registered' : undefined,
    scheduler,
    freeModel: router?.current_free_model ? String(router.current_free_model) : null,
    defaultModel: router?.current_free_model ? String(router.current_free_model) : undefined,
    currentTaskModel: null, // only set when the backend reports a distinct dispatch model
    lastTaskModel: router?.last_model_used ? String(router.last_model_used) : null,
    costClass: costClass(router?.last_cost_class),
    fallbackUsed: router?.fallback_used === true,
    fallbackReason: router?.fallback_reason ? String(router.fallback_reason) : null,
    lastSync: jobs?.last_research_at ? String(jobs.last_research_at) : null,
    latestError: jobs?.latest_error ? String(jobs.latest_error) : null,
    pausedModules,
  };
}

// ---------------------------------------------------------------------------
// Adapter boundary — frozen contract methods. All are gated: without the
// server env nothing is called and WAITING is returned.
// ---------------------------------------------------------------------------

export async function getProjectStatus(): Promise<SalmanOsStatus> {
  const base = salmanOsStatus();
  if (base.state === 'WAITING') return base;
  try {
    const [statusRes, overviewRes] = await Promise.all([
      sFetch(ENDPOINTS.status),
      sFetch(`${ENDPOINTS.overview}?slug=${PROJECT_SLUG}&env=preview`),
    ]);
    if (!statusRes.ok) {
      const reason = statusRes.status === 404
        ? 'SALMAN OS answered 404 — project "luxedge" is not registered on the backend. No calls are dispatched until it is.'
        : `SALMAN OS answered HTTP ${statusRes.status} — not reachable right now.`;
      return { ...base, state: 'OFFLINE', reason };
    }
    const status = unbox(statusRes.data);
    const remoteVersion = status?.contract_version;
    if (remoteVersion !== undefined && Number(remoteVersion) !== CONTRACT_VERSION) {
      return {
        ...base,
        state: 'OFFLINE',
        reason: `CONTRACT MISMATCH — Salman OS reports contract_version ${String(remoteVersion)}, Luxedge adapter targets ${CONTRACT_VERSION}. No calls are dispatched until the versions match.`,
      };
    }
    const live = mapLive(statusRes.data, overviewRes.ok ? overviewRes.data : null);
    return {
      ...base,
      state: 'CONNECTED',
      live,
      reason: 'CONNECTED — project "luxedge" registered and contract version matches. Salman OS is authoritative for its model routing.',
    };
  } catch {
    return { ...base, state: 'OFFLINE', reason: 'SALMAN OS is unreachable right now. Commerce continues normally.' };
  }
}

function safeIntelligence(data: unknown, kind?: SalmanOsIntelligenceKind): SalmanOsIntelligenceItem[] {
  const body = unbox(data);
  const items = body?.items;
  if (!Array.isArray(items)) return [];
  const out: SalmanOsIntelligenceItem[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const id = String(r.id || '');
    if (!id) continue;
    const normalized = intelligenceKindFromJobKind(kindFromTaskType(r.task_type));
    if (kind && normalized !== kind) continue;
    const findings = Array.isArray(r.findings) ? r.findings : [];
    const evidence: string[] = [];
    const sources: string[] = [];
    for (const f of findings) {
      if (!f || typeof f !== 'object') continue;
      const fv = f as Record<string, unknown>;
      if (Array.isArray(fv.evidence)) for (const e of fv.evidence) if (typeof e === 'string') evidence.push(e);
      for (const key of ['source_urls', 'sources', 'url']) {
        const v = fv[key];
        if (Array.isArray(v)) for (const s of v) if (typeof s === 'string') sources.push(s);
        else if (typeof v === 'string') sources.push(v);
      }
    }
    out.push({
      id,
      kind: normalized,
      model: r.model ? String(r.model) : null,
      provider: r.provider ? String(r.provider) : null,
      costClass: costClass(r.cost_class),
      fallbackUsed: r.fallback_used === true || r.fallback_used === 'yes',
      evidence,
      inference: r.summary ? String(r.summary) : r.title ? String(r.title) : '',
      unknowns: [],
      confidence: null,
      risk: null,
      sources,
      generatedAt: String(r.completed_at || r.created_at || new Date().toISOString()),
    });
  }
  return out;
}

function intelligenceKindFromJobKind(kind: SalmanOsJobKind): SalmanOsIntelligenceKind {
  const kinds: Record<SalmanOsJobKind, SalmanOsIntelligenceKind> = {
    PRODUCT_RESEARCH: 'PRODUCT',
    SEO: 'SEO',
    FREE_MARKETING: 'FREE_MARKETING',
    FREE_LISTINGS: 'FREE_LISTINGS',
    MARKET_RESEARCH: 'MARKET',
    MARKETING_IDEAS: 'MARKETING',
    ADS_INTELLIGENCE: 'ADS',
    CATALOG_QA: 'CATALOG_QA',
  };
  return kinds[kind];
}

function kindFromTaskType(taskType: unknown, fallback?: SalmanOsJobKind): SalmanOsJobKind {
  const t = String(taskType || '');
  if (t && t in SALMAN_OS_KIND_BY_MODULE) return SALMAN_OS_KIND_BY_MODULE[t];
  const byTask: Record<string, SalmanOsJobKind> = {
    product_discovery: 'PRODUCT_RESEARCH',
    seo_research: 'SEO',
    marketing_research: 'FREE_MARKETING',
    free_listing_opportunities: 'FREE_LISTINGS',
    market_research: 'MARKET_RESEARCH',
    content_research: 'MARKETING_IDEAS',
    ads_research: 'ADS_INTELLIGENCE',
    catalog_quality_review: 'CATALOG_QA',
  };
  return byTask[t] || fallback || 'PRODUCT_RESEARCH';
}

export async function getIntelligence(kind?: SalmanOsIntelligenceKind): Promise<SalmanOsIntelligenceItem[]> {
  const base = salmanOsStatus();
  if (base.state === 'WAITING') return [];
  try {
    const res = await sFetch(ENDPOINTS.intelligence);
    if (!res.ok) return [];
    return safeIntelligence(res.data, kind);
  } catch {
    return [];
  }
}

function taskStatusToJobStatus(status: string): SalmanOsJob['status'] {
  if (status === 'completed') return 'COMPLETED';
  if (status === 'failed') return 'FAILED';
  if (status === 'running' || status === 'planning') return 'RUNNING';
  return 'QUEUED';
}



function modelFromResult(result: unknown): { model: string | null; costClass: 'FREE' | 'PAID' | 'UNKNOWN'; fallbackUsed: boolean } {
  if (!result || typeof result !== 'string') return { model: null, costClass: 'UNKNOWN', fallbackUsed: false };
  try {
    const parsed = JSON.parse(result) as Record<string, unknown>;
    return {
      model: typeof parsed.model === 'string' ? parsed.model : null,
      costClass: costClass(parsed.cost_class),
      fallbackUsed: parsed.fallback_used === true || parsed.fallback_used === 'yes',
    };
  } catch {
    return { model: null, costClass: 'UNKNOWN', fallbackUsed: false };
  }
}

function safeJobs(data: unknown): SalmanOsJob[] {
  const body = unbox(data);
  if (!body) return [];
  const out: SalmanOsJob[] = [];
  const queue = Array.isArray(body.queue) ? body.queue as Record<string, unknown>[] : [];
  for (const raw of queue) {
    const id = String(raw.id || '');
    if (!id) continue;
    out.push({
      id,
      kind: kindFromTaskType(raw.task_type),
      status: taskStatusToJobStatus(String(raw.status || 'pending')),
      createdAt: String(raw.created_at || new Date().toISOString()),
    });
  }
  const completed = body.latest_completed && typeof body.latest_completed === 'object' ? body.latest_completed as Record<string, unknown> : null;
  if (completed && completed.id) {
    const truth = modelFromResult(completed.result);
    out.push({
      id: String(completed.id),
      kind: kindFromTaskType(completed.task_type),
      status: 'COMPLETED',
      model: truth.model,
      costClass: truth.costClass,
      fallbackUsed: truth.fallbackUsed,
      createdAt: String(completed.created_at || new Date().toISOString()),
      completedAt: completed.completed_at ? String(completed.completed_at) : null,
    });
  }
  const failed = body.latest_failed && typeof body.latest_failed === 'object' ? body.latest_failed as Record<string, unknown> : null;
  if (failed && failed.id) {
    out.push({
      id: String(failed.id),
      kind: kindFromTaskType(failed.task_type),
      status: 'FAILED',
      createdAt: String(failed.created_at || new Date().toISOString()),
      error: failed.error ? String(failed.error) : null,
    });
  }
  return out;
}

export async function getJobs(): Promise<SalmanOsJob[]> {
  const base = salmanOsStatus();
  if (base.state === 'WAITING') return [];
  try {
    const [jobsRes, statusRes] = await Promise.all([sFetch(ENDPOINTS.jobs), sFetch(ENDPOINTS.status)]);
    const jobs = jobsRes.ok ? safeJobs(jobsRes.data) : [];
    const status = unbox(statusRes.data);
    const modules = Array.isArray(status?.modules) ? status.modules as Record<string, unknown>[] : [];
    for (const m of modules) {
      if (m.paused !== true) continue;
      const moduleId = String(m.id || '');
      const kind = kindFromTaskType(moduleId);
      const existing = jobs.find((j) => j.kind === kind && j.status === 'PAUSED');
      if (!existing) {
        jobs.push({ id: moduleId, kind, status: 'PAUSED', createdAt: new Date().toISOString() });
      }
    }
    return jobs;
  } catch {
    return [];
  }
}

export async function runJob(kind: SalmanOsJobKind): Promise<SalmanOsJobRunResult> {
  // Dispatch requires a verified handshake (project registered + contract
  // version matches) — never dispatch against a mismatched/unknown contract.
  const handshake = await getProjectStatus();
  if (handshake.state !== 'CONNECTED') return { ok: false, job: null, error: handshake.reason };
  try {
    const moduleId = MODULE_IDS[kind];
    const res = await sFetch(ENDPOINTS.runJob, {
      method: 'POST',
      body: JSON.stringify({ module: moduleId, environment: REQUEST_ENV }),
    });
    if (!res.ok) return { ok: false, job: null, error: `SALMAN OS rejected the job (HTTP ${res.status}).` };
    const body = unbox(res.data);
    const results = Array.isArray(body?.results) ? body.results as Record<string, unknown>[] : [];
    const dispatched = results.find((r) => r.action === 'dispatched');
    if (dispatched) {
      return {
        ok: true,
        job: {
          id: String(dispatched.task_id || ''),
          kind,
          status: 'QUEUED',
          model: dispatched.model ? String(dispatched.model) : null,
          costClass: costClass(dispatched.cost_class),
          fallbackUsed: dispatched.fallback_used === true,
          createdAt: new Date().toISOString(),
        },
        reason: dispatched.reason ? String(dispatched.reason) : null,
      };
    }
    const paused = results.find((r) => r.action === 'paused' || r.action === 'paused_by_owner');
    if (paused) {
      return {
        ok: false,
        paused: true,
        job: null,
        reason: paused.reason ? String(paused.reason) : 'PAUSED — FREE MODEL UNAVAILABLE',
        error: 'PAUSED — FREE MODEL UNAVAILABLE. Non-critical jobs never spend paid credits.',
      };
    }
    const failed = results.find((r) => r.action === 'failed');
    return {
      ok: false,
      job: null,
      error: failed?.reason ? String(failed.reason) : 'SALMAN OS did not dispatch the job (no result).',
    };
  } catch {
    return { ok: false, job: null, error: 'SALMAN OS is unreachable right now.' };
  }
}

async function toggleJob(moduleId: string, action: 'pause' | 'resume'): Promise<SalmanOsJobToggleResult> {
  const handshake = await getProjectStatus();
  if (handshake.state !== 'CONNECTED') return { ok: false, job: null, error: handshake.reason };
  if (!Object.values(MODULE_IDS).includes(moduleId)) {
    return { ok: false, job: null, error: `Unknown Salman OS module: ${moduleId}` };
  }
  try {
    const res = await sFetch(ENDPOINTS.runJob, {
      method: 'POST',
      body: JSON.stringify({ action, module: moduleId }),
    });
    if (!res.ok) return { ok: false, job: null, error: `SALMAN OS rejected ${action} (HTTP ${res.status}).` };
    return { ok: true, job: null };
  } catch {
    return { ok: false, job: null, error: 'SALMAN OS is unreachable right now.' };
  }
}

export function pauseJob(moduleId: string): Promise<SalmanOsJobToggleResult> {
  return toggleJob(moduleId, 'pause');
}

export function resumeJob(moduleId: string): Promise<SalmanOsJobToggleResult> {
  return toggleJob(moduleId, 'resume');
}


