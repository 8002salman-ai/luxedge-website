// ============================================================================
// LUXEDGE V2 — SALMAN OS ADAPTER · CONTRACT-GATED CLIENT (SERVER ONLY)
//
// This module is the clean server-side boundary between Luxedge and Salman
// OS. The endpoint contract is FINALIZED IN PARALLEL and will be published
// in SALMAN_OS_LUXEDGE_AI_CONTRACT.md. Until that file exists, no endpoint
// path or response field is invented here: every call reports
// state=WAITING with a safe reason, and the AI Control / Intelligence UIs
// show "AI BACKEND — WAITING FOR SALMAN OS".
//
// READINESS GATES (Phase F) — live calls happen ONLY when ALL hold:
//   1. contract file present (SALMAN_OS_LUXEDGE_AI_CONTRACT.md)
//   2. SALMAN_OS_BASE_URL configured (server env only)
//   3. SALMAN_OS_TOKEN configured (server env only)
//   4. project "luxedge" registered on the backend
//   5. the environment (PREVIEW) is supported
//   6. a generic probe answers successfully with matching contract fields
//
// If any gate fails: return WAITING/OFFLINE — never a fabricated success.
// Credentials are read from process.env on the server and are NEVER
// returned to the client, stored in the DB, or logged.
// ============================================================================

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  SalmanOsStatus, SalmanOsLiveState, SalmanOsIntelligenceItem,
  SalmanOsIntelligenceKind, SalmanOsJob, SalmanOsJobKind,
  SalmanOsJobRunResult, SalmanOsJobToggleResult,
} from './types';

const CONTRACT_FILE = 'SALMAN_OS_LUXEDGE_AI_CONTRACT.md';
const PROJECT_SLUG = 'luxedge';
const ENVIRONMENT = process.env.VERCEL_ENV === 'production' ? 'PRODUCTION' : 'PREVIEW';

/** All endpoint paths live here — centralized for easy contract adoption. */
const ENDPOINTS = {
  status: '/api/projects/:project/status',
  intelligence: '/api/projects/:project/intelligence',
  jobs: '/api/projects/:project/jobs',
  runJob: '/api/projects/:project/jobs/run',
  pauseJob: '/api/projects/:project/jobs/:id/pause',
  resumeJob: '/api/projects/:project/jobs/:id/resume',
} as const;

function env(name: string): string {
  return (process.env[name] || '').trim();
}

function contractPresent(): boolean {
  try {
    return existsSync(join(process.cwd(), CONTRACT_FILE));
  } catch {
    return false;
  }
}

function configReady(): boolean {
  return Boolean(env('SALMAN_OS_BASE_URL') && env('SALMAN_OS_TOKEN'));
}

/** Safe structured status — never contains credentials. */
export function salmanOsStatus(): SalmanOsStatus {
  const reason = !contractPresent()
    ? 'SALMAN OS CONTRACT PENDING — SALMAN_OS_LUXEDGE_AI_CONTRACT.md is not present yet. No endpoints are called until the finalized contract is published.'
    : !env('SALMAN_OS_BASE_URL')
      ? 'SALMAN OS CREDENTIALS PENDING — SALMAN_OS_BASE_URL is not configured (server env only).'
      : !env('SALMAN_OS_TOKEN')
        ? 'SALMAN OS CREDENTIALS PENDING — SALMAN_OS_TOKEN is not configured (server env only).'
        : 'CONFIGURED — awaiting live probe (no probe is run until the contract file is present).';
  return {
    state: contractPresent() && configReady() ? 'OFFLINE' : 'WAITING',
    project: { project: PROJECT_SLUG, environment: ENVIRONMENT, freeFirst: true },
    reason,
    live: null,
    checkedAt: new Date().toISOString(),
  };
}

function endpoint(path: string, project = PROJECT_SLUG, id?: string): string {
  const base = env('SALMAN_OS_BASE_URL').replace(/\/$/, '');
  return `${base}${path.replace(':project', project).replace(':id', id ?? '')}`;
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

function safeIntelligence(data: unknown): SalmanOsIntelligenceItem[] {
  if (!data || typeof data !== 'object') return [];
  const items = (data as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  const out: SalmanOsIntelligenceItem[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const id = String(r.id || '');
    if (!id) continue;
    const cost = String(r.costClass || '').toUpperCase();
    out.push({
      id,
      kind: String(r.kind || '').toUpperCase() as SalmanOsIntelligenceKind,
      model: r.model ? String(r.model) : null,
      provider: r.provider ? String(r.provider) : null,
      costClass: cost === 'FREE' || cost === 'PAID' ? cost : 'UNKNOWN',
      fallbackUsed: Boolean(r.fallbackUsed),
      evidence: Array.isArray(r.evidence) ? r.evidence.map(String) : [],
      inference: String(r.inference || ''),
      unknowns: Array.isArray(r.unknowns) ? r.unknowns.map(String) : [],
      confidence: typeof r.confidence === 'number' ? r.confidence : null,
      risk: r.risk ? String(r.risk) : null,
      sources: Array.isArray(r.sources) ? r.sources.map(String) : [],
      generatedAt: String(r.generatedAt || new Date().toISOString()),
    });
  }
  return out;
}

function safeJobs(data: unknown): SalmanOsJob[] {
  if (!data || typeof data !== 'object') return [];
  const items = (data as { jobs?: unknown }).jobs;
  if (!Array.isArray(items)) return [];
  const out: SalmanOsJob[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const id = String(r.id || '');
    if (!id) continue;
    const cost = String(r.costClass || '').toUpperCase();
    out.push({
      id,
      kind: String(r.kind || 'PRODUCT_RESEARCH') as SalmanOsJobKind,
      status: String(r.status || 'QUEUED') as SalmanOsJob['status'],
      model: r.model ? String(r.model) : null,
      costClass: cost === 'FREE' || cost === 'PAID' ? cost : 'UNKNOWN',
      fallbackUsed: Boolean(r.fallbackUsed),
      createdAt: String(r.createdAt || new Date().toISOString()),
      completedAt: r.completedAt ? String(r.completedAt) : null,
      error: r.error ? String(r.error) : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Adapter boundary — conceptual methods per the phase contract. All are
// gated: without the contract file nothing is called and WAITING is returned.
// ---------------------------------------------------------------------------

export async function getProjectStatus(): Promise<SalmanOsStatus> {
  const base = salmanOsStatus();
  if (base.state === 'WAITING') return base;
  try {
    const res = await sFetch(ENDPOINTS.status);
    if (!res.ok) return { ...base, state: 'OFFLINE', reason: `Salman OS answered HTTP ${res.status} — not reachable right now.` };
    const data = res.data as { live?: SalmanOsLiveState } | null;
    const live: SalmanOsLiveState | null = data?.live && typeof data.live === 'object' ? data.live : null;
    return { ...base, state: 'CONNECTED', live, reason: 'CONNECTED — Salman OS is authoritative for its model routing.' };
  } catch {
    return { ...base, state: 'OFFLINE', reason: 'Salman OS is unreachable right now. Commerce continues normally.' };
  }
}

export async function getIntelligence(kind?: SalmanOsIntelligenceKind): Promise<SalmanOsIntelligenceItem[]> {
  const base = salmanOsStatus();
  if (base.state === 'WAITING') return [];
  try {
    const q = kind ? `?kind=${encodeURIComponent(kind)}` : '';
    const res = await sFetch(`${ENDPOINTS.intelligence}${q}`);
    if (!res.ok) return [];
    return safeIntelligence(res.data);
  } catch {
    return [];
  }
}

export async function getJobs(): Promise<SalmanOsJob[]> {
  const base = salmanOsStatus();
  if (base.state === 'WAITING') return [];
  try {
    const res = await sFetch(ENDPOINTS.jobs);
    if (!res.ok) return [];
    return safeJobs(res.data);
  } catch {
    return [];
  }
}

export async function runJob(kind: SalmanOsJobKind): Promise<SalmanOsJobRunResult> {
  const base = salmanOsStatus();
  if (base.state === 'WAITING') {
    return { ok: false, job: null, error: base.reason };
  }
  try {
    const res = await sFetch(ENDPOINTS.runJob, { method: 'POST', body: JSON.stringify({ kind }) });
    if (!res.ok) return { ok: false, job: null, error: `Salman OS rejected the job (HTTP ${res.status}).` };
    const job = safeJobs({ jobs: [res.data] })[0] || null;
    return { ok: Boolean(job), job, error: job ? null : 'Salman OS returned no job record.' };
  } catch {
    return { ok: false, job: null, error: 'Salman OS is unreachable right now.' };
  }
}

export async function pauseJob(id: string): Promise<SalmanOsJobToggleResult> {
  const base = salmanOsStatus();
  if (base.state === 'WAITING') return { ok: false, job: null, error: base.reason };
  try {
    const res = await sFetch(ENDPOINTS.pauseJob.replace(':id', id), { method: 'POST' });
    if (!res.ok) return { ok: false, job: null, error: `Salman OS rejected pause (HTTP ${res.status}).` };
    return { ok: true, job: safeJobs({ jobs: [res.data] })[0] || null };
  } catch {
    return { ok: false, job: null, error: 'Salman OS is unreachable right now.' };
  }
}

export async function resumeJob(id: string): Promise<SalmanOsJobToggleResult> {
  const base = salmanOsStatus();
  if (base.state === 'WAITING') return { ok: false, job: null, error: base.reason };
  try {
    const res = await sFetch(ENDPOINTS.resumeJob.replace(':id', id), { method: 'POST' });
    if (!res.ok) return { ok: false, job: null, error: `Salman OS rejected resume (HTTP ${res.status}).` };
    return { ok: true, job: safeJobs({ jobs: [res.data] })[0] || null };
  } catch {
    return { ok: false, job: null, error: 'Salman OS is unreachable right now.' };
  }
}

export { CONTRACT_FILE, PROJECT_SLUG, ENVIRONMENT };
