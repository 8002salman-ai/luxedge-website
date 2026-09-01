// GET  /api/market-intel/trends/jobs                  — list all Hermes trends jobs (admin)
// POST /api/market-intel/trends/jobs/claim            — claim the oldest queued job (→ running)
// POST /api/market-intel/trends/jobs/:id/result       — ingest returned trends observations
//
// The Google-Trends→Hermes loop §2: researchKeyword() queues
// provider='hermes', intent='google_trends_browser' jobs; Hermes executes the
// browser comparison on the user's machine and posts the observations back
// here. This endpoint is the durable intake — it never browses, never fakes
// a direction from missing data, and a job that stays queued blocks nothing.
//
// SECURITY:
//   - Admin JWT required (same guard as /api/ai/*, /api/fetch-page,
//     /api/hermes/ingest).
//   - Body is strictly validated by trendsIngest.parseTrendsObservations:
//     unknown fields dropped, period values must be finite numbers in
//     -100..100, arrays sanitized/capped.
//   - Reads/writes run as the caller's admin JWT through PostgREST, so RLS
//     (admin-only) governs every mutation.
//   - Never returns credentials, tokens, or provider keys.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, readJsonBody, rateLimited, clientIp } from '../_lib/providers.js';
import { requireAdmin, getBearerToken } from '../_lib/auth.js';
import { parseTrendsObservations, trendEvidenceFromObservations } from '../../src/features/marketIntel/trendsIngest.js';

const TRENDS_INTENT = 'google_trends_browser';

interface TrendJobRow {
  id: string;
  status: string;
  input: unknown;
  output: unknown;
  provider: string | null;
  created_at: string | null;
  started_at: string | null;
  finished_at: string | null;
}

/** PostgREST call as the caller's admin JWT (RLS enforces admin-only access). */
async function rest(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  token: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const base = (process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
  const anonKey = (process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (!base || !anonKey) {
    return { ok: false, status: 503, data: { error: 'Supabase is not configured on this deployment.' } };
  }
  const headers: Record<string, string> = {
    apikey: anonKey,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
    Authorization: `Bearer ${token}`,
  };
  try {
    const res = await fetch(`${base}/rest/v1/${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) return { ok: false, status: res.status, data: { error: 'database request rejected' } };
    return { ok: true, status: res.status, data };
  } catch {
    return { ok: false, status: 502, data: { error: 'Database is unreachable right now.' } };
  }
}

function inputOf(row: TrendJobRow): Record<string, unknown> | null {
  const i = row.input;
  return i && typeof i === 'object' && !Array.isArray(i) ? (i as Record<string, unknown>) : null;
}

function outputOf(row: TrendJobRow): Record<string, unknown> | null {
  const o = row.output;
  return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
}

function isTrendsJob(row: TrendJobRow): boolean {
  if (row.provider !== 'hermes') return false;
  return inputOf(row)?.intent === TRENDS_INTENT;
}

function toJobView(row: TrendJobRow): Record<string, unknown> {
  const input = inputOf(row) || {};
  return {
    id: row.id,
    status: row.status,
    keyword: typeof input.keyword === 'string' ? input.keyword : '',
    country: typeof input.country === 'string' ? input.country : 'US',
    periods: Array.isArray(input.periods) ? input.periods.filter((p): p is string => typeof p === 'string') : [],
    queuedAt: typeof input.queuedAt === 'string' ? input.queuedAt : null,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    output: outputOf(row),
  };
}

function normalizeKeyword(k: string): string {
  return (k || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

async function listJobs(token: string): Promise<{ ok: boolean; status: number; jobs?: TrendJobRow[]; error?: string }> {
  const r = await rest('GET', 'agent_jobs?order=created_at.desc&limit=200', token);
  if (!r.ok) return { ok: false, status: r.status, error: 'Could not read agent_jobs.' };
  const rows = Array.isArray(r.data) ? (r.data as TrendJobRow[]) : [];
  return { ok: true, status: 200, jobs: rows.filter(isTrendsJob) };
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  if (rateLimited(clientIp(req))) {
    sendJson(res, 429, { error: 'Too many requests — slow down.' });
    return;
  }
  if (!(await requireAdmin(req, res))) return;
  const token = getBearerToken(req);

  const path = new URL(req.url || '/', 'http://luxedge.local').pathname;

  // GET /api/market-intel/trends/jobs — list all trends jobs (admin review)
  if (req.method === 'GET' && path === '/api/market-intel/trends/jobs') {
    const l = await listJobs(token);
    if (!l.ok) { sendJson(res, l.status, { error: l.error }); return; }
    sendJson(res, 200, { jobs: (l.jobs || []).map(toJobView) });
    return;
  }

  // POST /api/market-intel/trends/jobs/claim — claim the oldest queued job
  if (req.method === 'POST' && path === '/api/market-intel/trends/jobs/claim') {
    const l = await listJobs(token);
    if (!l.ok) { sendJson(res, l.status, { error: l.error }); return; }
    const queued = (l.jobs || []).filter((j) => j.status === 'queued');
    const job = queued[queued.length - 1]; // newest-first list → oldest queued is last
    if (!job) { sendJson(res, 200, { job: null }); return; }
    const startedAt = new Date().toISOString();
    const up = await rest('PATCH', `agent_jobs?id=eq.${encodeURIComponent(job.id)}`, token, {
      status: 'running',
      started_at: startedAt,
    });
    if (!up.ok) { sendJson(res, up.status, { error: 'Claim failed — could not mark the job running.' }); return; }
    sendJson(res, 200, { job: { ...toJobView(job), status: 'running', startedAt } });
    return;
  }

  // POST /api/market-intel/trends/jobs/:id/result — ingest returned observations
  const resultMatch = path.match(/^\/api\/market-intel\/trends\/jobs\/([^/]+)\/result$/);
  if (req.method === 'POST' && resultMatch) {
    const jobId = decodeURIComponent(resultMatch[1]);
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      sendJson(res, 400, { error: (e as Error).message });
      return;
    }
    const parsed = parseTrendsObservations(body);
    if (!parsed.ok) {
      sendJson(res, 400, { error: 'Invalid trends result payload', errors: parsed.errors });
      return;
    }

    const g = await rest('GET', `agent_jobs?id=eq.${encodeURIComponent(jobId)}`, token);
    if (!g.ok) { sendJson(res, g.status, { error: 'Could not read the trends job.' }); return; }
    const rows = Array.isArray(g.data) ? (g.data as TrendJobRow[]) : [];
    const job = rows[0];
    if (!job) { sendJson(res, 404, { error: 'Trends job not found.' }); return; }
    if (!isTrendsJob(job)) { sendJson(res, 400, { error: 'Not a Hermes Google-Trends job.' }); return; }

    const jobKeyword = typeof inputOf(job)?.keyword === 'string' ? String(inputOf(job)?.keyword) : '';
    if (parsed.observations.keyword && normalizeKeyword(parsed.observations.keyword) !== normalizeKeyword(jobKeyword)) {
      sendJson(res, 400, {
        error: `Keyword mismatch — job is for "${jobKeyword}", result is for "${parsed.observations.keyword}".`,
      });
      return;
    }
    const merged = { ...parsed.observations, keyword: parsed.observations.keyword || jobKeyword };

    // Idempotent: an already-consumed job returns its stored outcome.
    if (job.status === 'completed' || job.status === 'failed') {
      const out = outputOf(job);
      if (out?.trend) {
        sendJson(res, 200, { ok: true, already: true, keyword: merged.keyword, trend: out.trend, coverage: out.coverage ?? 0 });
        return;
      }
    }

    const { evidence, coverage } = trendEvidenceFromObservations(merged);
    const finishedAt = new Date().toISOString();
    const up = await rest('PATCH', `agent_jobs?id=eq.${encodeURIComponent(jobId)}`, token, {
      status: 'completed',
      output: { trend: evidence, keyword: merged.keyword, coverage, ingestedAt: finishedAt },
      finished_at: finishedAt,
      provider: 'hermes',
    });
    if (!up.ok) { sendJson(res, up.status, { error: 'Could not store the ingested result.' }); return; }
    sendJson(res, 200, { ok: true, already: false, keyword: merged.keyword, trend: evidence, coverage });
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
}