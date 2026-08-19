// ============================================================================
// LUXEDGE V2 — SALMAN OS BROWSER CLIENT
//
// The browser NEVER talks to Salman OS directly and NEVER sees credentials.
// It only calls Luxedge's own serverless proxy (/api/salman-os/*), which
// requires an admin JWT and returns safe payloads only.
//
// Contract-gated: when Salman OS is not yet live, the proxy answers
// state=WAITING and the UI shows "AI BACKEND — WAITING FOR SALMAN OS".
// All failures degrade to empty/WAITING — commerce never depends on this.
// ============================================================================

import type {
  SalmanOsStatus, SalmanOsIntelligenceItem, SalmanOsIntelligenceKind,
  SalmanOsJob, SalmanOsJobKind,
} from './types';
import { getAccessToken } from '../supabase';

const API_BASE = '/api/salman-os';

function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { headers: { ...authHeaders() } });
    if (!res.ok) return null;
    const data = await res.json();
    return data as T;
  } catch {
    return null;
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(data?.error || `Salman OS request failed (HTTP ${res.status})`);
    }
    const data = await res.json();
    return data as T;
  } catch {
    return null;
  }
}

/** Safe status — WAITING until the server-side contract gates open. */
export async function fetchSalmanOsStatus(): Promise<SalmanOsStatus | null> {
  const data = await getJson<{ status: SalmanOsStatus }>('/status');
  return data?.status ?? null;
}

/** Intelligence items (empty when WAITING — degrade gracefully). */
export async function fetchSalmanOsIntelligence(kind?: SalmanOsIntelligenceKind): Promise<SalmanOsIntelligenceItem[]> {
  const q = kind ? `?kind=${encodeURIComponent(kind)}` : '';
  const data = await getJson<{ items: SalmanOsIntelligenceItem[] }>(`/intelligence${q}`);
  return data?.items ?? [];
}

/** Job list (empty when WAITING). */
export async function fetchSalmanOsJobs(): Promise<SalmanOsJob[]> {
  const data = await getJson<{ jobs: SalmanOsJob[] }>('/jobs');
  return data?.jobs ?? [];
}

/** Run an AI module job — fails closed with a safe message when WAITING. */
export async function runSalmanOsJob(kind: SalmanOsJobKind): Promise<{ ok: boolean; error?: string }> {
  const data = await postJson<{ ok: boolean; job?: SalmanOsJob | null; error?: string | null }>('/jobs', { action: 'run', kind });
  if (!data) return { ok: false, error: 'AI BACKEND — WAITING FOR SALMAN OS' };
  return { ok: data.ok, error: data.error ?? undefined };
}

/** Pause a job — only when the finalized contract supports it. */
export async function pauseSalmanOsJob(id: string): Promise<{ ok: boolean; error?: string }> {
  const data = await postJson<{ ok: boolean; error?: string | null }>('/jobs', { action: 'pause', id });
  if (!data) return { ok: false, error: 'AI BACKEND — WAITING FOR SALMAN OS' };
  return { ok: data.ok, error: data.error ?? undefined };
}

/** Resume a job — only when the finalized contract supports it. */
export async function resumeSalmanOsJob(id: string): Promise<{ ok: boolean; error?: string }> {
  const data = await postJson<{ ok: boolean; error?: string | null }>('/jobs', { action: 'resume', id });
  if (!data) return { ok: false, error: 'AI BACKEND — WAITING FOR SALMAN OS' };
  return { ok: data.ok, error: data.error ?? undefined };
}
