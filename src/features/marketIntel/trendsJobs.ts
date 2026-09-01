// ============================================================================
// LUXEDGE — GOOGLE TRENDS JOB CONSUMER (agent_jobs)
//
// The missing half of the §2 Google-Trends→Hermes loop. researchKeyword()
// queues provider='hermes', intent='google_trends_browser' jobs into
// agent_jobs on every research run; this module is what reads, claims and
// ingests them once Hermes returns observations.
//
// Hermes executes the browser side on the user's machine — the code-side
// deliverable is the durable job listing + honest result ingestion, never
// the browsing itself. A job that stays queued blocks nothing: every
// function here is read/claim/ingest per job, and the research pipeline has
// no dependency on a job being consumed.
// ============================================================================

import type { DbAdapter } from '../../services/db';
import type { AgentJobRow } from '../scout/persist';
import { completeJob } from '../scout/persist';
import type { TrendEvidence } from './types';
import { trendEvidenceFromObservations, type TrendsObservations } from './trendsIngest';

const TRENDS_INTENT = 'google_trends_browser';

export interface TrendsJobOutput {
  trend?: TrendEvidence;
  coverage?: number;
  keyword?: string;
  ingestedAt?: string;
}

/** Read-model of a Hermes trends job for admin UI / API responses. */
export interface TrendsJobView {
  id: string;
  status: AgentJobRow['status'];
  keyword: string;
  country: string;
  periods: string[];
  queuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  output: TrendsJobOutput | null;
}

function normalizeKeyword(k: string): string {
  return (k || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function inputOf(row: AgentJobRow): Record<string, unknown> | null {
  const i = row.input;
  return i && typeof i === 'object' && !Array.isArray(i) ? (i as Record<string, unknown>) : null;
}

function outputOf(row: AgentJobRow): TrendsJobOutput | null {
  const o = row.output;
  return o && typeof o === 'object' && !Array.isArray(o) ? (o as TrendsJobOutput) : null;
}

/** True when a job row is a Hermes Google-Trends browser task. */
export function isTrendsJob(row: AgentJobRow): boolean {
  if (row.provider !== 'hermes') return false;
  const input = inputOf(row);
  return input?.intent === TRENDS_INTENT;
}

function toView(row: AgentJobRow): TrendsJobView {
  const input = inputOf(row) || {};
  const output = outputOf(row);
  return {
    id: row.id,
    status: row.status,
    keyword: typeof input.keyword === 'string' ? input.keyword : '',
    country: typeof input.country === 'string' ? input.country : 'US',
    periods: Array.isArray(input.periods) ? input.periods.filter((p): p is string => typeof p === 'string') : [],
    queuedAt: typeof input.queuedAt === 'string' ? input.queuedAt : null,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    output,
  };
}

function sortKey(v: TrendsJobView): string {
  // queuedAt (ISO) sorts deterministically across adapters; id breaks ms ties.
  return v.queuedAt || v.id;
}

/** All Hermes trends jobs (any status), newest first. */
export async function listTrendsJobs(db: DbAdapter): Promise<TrendsJobView[]> {
  const rows = await db.list<AgentJobRow>('agent_jobs', { orderBy: 'created_at.desc' });
  const views = (Array.isArray(rows) ? rows : []).filter(isTrendsJob).map(toView);
  views.sort((a, b) => (sortKey(a) > sortKey(b) ? -1 : sortKey(a) < sortKey(b) ? 1 : 0));
  return views;
}

/**
 * Claim a trends job for processing (queued → running). Idempotent: a
 * running/completed job is returned as-is so a double-claim never corrupts
 * state. Returns null when the job does not exist or is not a trends job.
 */
export async function claimTrendsJob(db: DbAdapter, jobId: string): Promise<TrendsJobView | null> {
  const row = await db.get<AgentJobRow>('agent_jobs', jobId);
  if (!row || !isTrendsJob(row)) return null;
  if (row.status === 'queued') {
    const startedAt = new Date().toISOString();
    await db.update<AgentJobRow>('agent_jobs', jobId, { status: 'running', started_at: startedAt });
    row.status = 'running';
    row.started_at = startedAt;
  }
  return toView(row);
}

/** Claim the oldest still-queued trends job, or null when there is none. */
export async function claimNextTrendsJob(db: DbAdapter): Promise<TrendsJobView | null> {
  const jobs = await listTrendsJobs(db);
  const queued = jobs.filter((j) => j.status === 'queued');
  if (!queued.length) return null;
  // Deterministic: Earliest queuedAt (ISO lexicographic) wins; id breaks ms ties.
  const oldest = [...queued].sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0))[0];
  return claimTrendsJob(db, oldest.id);
}

/**
 * Ingest returned observations into a trends job. The job becomes
 * 'completed' with an honest TREND_SCORE + coverage in its output; a
 * re-ingest of an already-consumed job is idempotent.
 *
 * Returns a typed failure for: unknown job, non-trends job, or a keyword
 * mismatch (cross-contamination guard — the result is for a different
 * keyword than the job, rejected instead of silently attached).
 */
export async function ingestTrendsJob(
  db: DbAdapter,
  jobId: string,
  observations: TrendsObservations
): Promise<
  | { ok: true; already: boolean; keyword: string; trend: TrendEvidence; coverage: number }
  | { ok: false; status: number; error: string }
> {
  const row = await db.get<AgentJobRow>('agent_jobs', jobId);
  if (!row) return { ok: false, status: 404, error: 'Trends job not found.' };
  if (!isTrendsJob(row)) return { ok: false, status: 400, error: 'Not a Hermes Google-Trends job.' };

  const jobKeyword = typeof inputOf(row)?.keyword === 'string' ? String(inputOf(row)?.keyword) : '';
  if (observations.keyword && normalizeKeyword(observations.keyword) !== normalizeKeyword(jobKeyword)) {
    return {
      ok: false,
      status: 400,
      error: `Keyword mismatch — job is for "${jobKeyword}", result is for "${observations.keyword}".`,
    };
  }
  const outKeyword = observations.keyword || jobKeyword;
  const merged: TrendsObservations = { ...observations, keyword: outKeyword };

  // Idempotent: an already-consumed job returns its stored outcome unchanged.
  if (row.status === 'completed' || row.status === 'failed') {
    const out = outputOf(row);
    if (out?.trend) {
      return { ok: true, already: true, keyword: outKeyword, trend: out.trend, coverage: out.coverage ?? 0 };
    }
  }

  const { evidence, coverage } = trendEvidenceFromObservations(merged);
  await completeJob(
    db,
    jobId,
    'completed',
    { trend: evidence, keyword: outKeyword, coverage, ingestedAt: new Date().toISOString() },
    undefined,
    { provider: 'hermes' }
  );
  return { ok: true, already: false, keyword: outKeyword, trend: evidence, coverage };
}

/** Latest completed trends evidence for a keyword, or an honest empty result. */
export async function latestTrendsEvidence(
  db: DbAdapter,
  keyword: string
): Promise<{ keyword: string; trend: TrendEvidence | null; coverage: number }> {
  const jobs = await listTrendsJobs(db);
  const norm = normalizeKeyword(keyword);
  const hit = jobs.find((j) => j.status === 'completed' && normalizeKeyword(j.keyword) === norm);
  if (!hit) return { keyword, trend: null, coverage: 0 };
  return { keyword: hit.keyword, trend: hit.output?.trend ?? null, coverage: hit.output?.coverage ?? 0 };
}