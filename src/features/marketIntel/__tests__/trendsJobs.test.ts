// ============================================================================
// LUXEDGE — GOOGLE TRENDS HERMES JOB LOOP TESTS
//
// Proves the missing half of §2: queued provider=hermes,
// intent=google_trends_browser jobs can be claimed and ingested, a consumed
// job updates TREND_SCORE, partial ingestion never inflates confidence, and
// a job that stays queued blocks nothing.
// ============================================================================

import { describe, it, expect } from 'vitest';
import type { DbAdapter, DbMode } from '../../../services/db';
import { queueHermesFallback } from '../../scout/persist';
import { hermesTrendsTask } from '../trend';
import { parseTrendsObservations, trendEvidenceFromObservations, trendsCoverage } from '../trendsIngest';
import {
  listTrendsJobs, claimTrendsJob, claimNextTrendsJob, ingestTrendsJob, latestTrendsEvidence,
} from '../trendsJobs';

/** Minimal in-memory DbAdapter — list preserves insertion order (oldest first). */
class FakeDb implements DbAdapter {
  readonly mode: DbMode = 'local';
  rows: Record<string, Record<string, unknown>[]> = {};
  constructor(seed?: Record<string, Record<string, unknown>[]>) { this.rows = seed ?? {}; }
  async list<T>(_table: string): Promise<T[]> { return [...((this.rows[_table] || []) as T[])]; }
  async get<T>(table: string, id: string): Promise<T | null> {
    const r = (this.rows[table] || []).find((x) => x.id === id);
    return (r as T) ?? null;
  }
  async findFirst<T>(table: string, column: string, value: string): Promise<T | null> {
    const r = (this.rows[table] || []).find((x) => (x as Record<string, unknown>)[column] === value);
    return (r as T) ?? null;
  }
  async insert<T extends { id: string }>(table: string, row: T): Promise<T> {
    (this.rows[table] = this.rows[table] || []).push(row as Record<string, unknown>);
    return row;
  }
  async insertRaw<T>(table: string, row: T): Promise<T> {
    (this.rows[table] = this.rows[table] || []).push(row as Record<string, unknown>);
    return row;
  }
  async update<T extends { id: string }>(table: string, id: string, patch: Partial<T>): Promise<T | null> {
    const arr = this.rows[table] || [];
    const idx = arr.findIndex((x) => x.id === id);
    if (idx < 0) return null;
    arr[idx] = { ...arr[idx], ...patch };
    return arr[idx] as T;
  }
  async updateBy<T>(table: string, column: string, value: string, patch: Partial<T>): Promise<T | null> {
    const arr = this.rows[table] || [];
    const idx = arr.findIndex((x) => x[column] === value);
    if (idx < 0) return null;
    arr[idx] = { ...arr[idx], ...patch };
    return arr[idx] as T;
  }
  async remove(table: string, id: string): Promise<void> {
    this.rows[table] = (this.rows[table] || []).filter((x) => x.id !== id);
  }
  async testConnection() {
    return { ok: true, mode: 'local' as DbMode, detail: 'fake' };
  }
}

async function queueTrendsJob(db: DbAdapter, keyword: string): Promise<string> {
  const id = await queueHermesFallback(db, 'search', hermesTrendsTask(keyword));
  expect(id).not.toBeNull();
  return id!;
}

describe('trends job loop — queue → claim → ingest', () => {
  it('the research queue feeds the consumer: queued hermes trends job is listable', async () => {
    const db = new FakeDb();
    await queueTrendsJob(db, 'dog poop scooper');
    const jobs = await listTrendsJobs(db);
    expect(jobs.length).toBe(1);
    expect(jobs[0].status).toBe('queued');
    expect(jobs[0].keyword).toBe('dog poop scooper');
    expect(jobs[0].country).toBe('US');
    expect(jobs[0].periods).toContain('12 months');
    expect(jobs[0].output).toBeNull();
  });

  it('claim marks a queued job running and is idempotent', async () => {
    const db = new FakeDb();
    const id = await queueTrendsJob(db, 'cat water fountain');
    const claimed = await claimTrendsJob(db, id);
    expect(claimed?.status).toBe('running');
    expect(claimed?.startedAt).not.toBeNull();
    // Second claim does not reset or corrupt state.
    const again = await claimTrendsJob(db, id);
    expect(again?.status).toBe('running');
    expect(again?.startedAt).toBe(claimed?.startedAt);
  });

  it('claimNextTrendsJob claims the oldest queued job', async () => {
    const db = new FakeDb();
    const older = await queueTrendsJob(db, 'dog bed');
    const newer = await queueTrendsJob(db, 'cat tower');
    const claimed = await claimNextTrendsJob(db);
    expect(claimed?.id).toBe(older); // older queued first → claimed first
    const jobs = await listTrendsJobs(db);
    expect(jobs.find((j) => j.id === older)?.status).toBe('running');
    expect(jobs.find((j) => j.id === newer)?.status).toBe('queued');
  });

  it('a consumed job updates TREND_SCORE with verified evidence + provenance', async () => {
    const db = new FakeDb();
    const id = await queueTrendsJob(db, 'dog poop scooper');
    const claimed = await claimTrendsJob(db, id);
    expect(claimed?.status).toBe('running');

    const ing = await ingestTrendsJob(db, id, {
      keyword: 'dog poop scooper',
      d30: 60, d90: 40, d365: 25, yoy: null,
      risingQueries: ['long handled poop scooper'],
      relatedQueries: ['poop scooper for small dogs'],
      usRelevant: true,
    });
    expect(ing.ok).toBe(true);
    if (!ing.ok) return;
    expect(ing.already).toBe(false);
    expect(ing.trend.direction).toBe('STRONGLY_RISING');
    expect(ing.trend.source).toBe('hermes_browser');
    expect(ing.trend.score).not.toBeNull();
    expect(ing.coverage).toBe(0.75);

    // Job is now completed with the evidence stored durably (provenance).
    const jobs = await listTrendsJobs(db);
    const job = jobs.find((j) => j.id === id)!;
    expect(job.status).toBe('completed');
    expect(job.finishedAt).not.toBeNull();
    expect(job.output?.trend?.score).toBe(ing.trend.score);
    expect(job.output?.coverage).toBe(0.75);
    expect(job.output?.ingestedAt).toBeTruthy();

    // The loop's read-side now reports TREND_SCORE for this keyword.
    const latest = await latestTrendsEvidence(db, 'dog poop scooper');
    expect(latest.trend?.direction).toBe('STRONGLY_RISING');
    expect(latest.trend?.score).toBe(ing.trend.score);
    expect(latest.coverage).toBe(0.75);
  });

  it('partial ingestion never inflates: single period → RISING (not STRONGLY), coverage 25%', async () => {
    const db = new FakeDb();
    const id = await queueTrendsJob(db, 'dog grooming vacuum');
    const ing = await ingestTrendsJob(db, id, { keyword: 'dog grooming vacuum', d30: 80, risingQueries: ['x'] });
    expect(ing.ok).toBe(true);
    if (!ing.ok) return;
    // A lone +80 point must NOT claim STRONGLY_RISING.
    expect(ing.trend.direction).toBe('RISING');
    expect(ing.coverage).toBe(0.25);
    const expected = trendEvidenceFromObservations({ keyword: 'dog grooming vacuum', d30: 80, risingQueries: ['x'] });
    expect(ing.trend.score).toBe(expected.evidence.score);
  });

  it('empty observations are honest: INSUFFICIENT_DATA, null score, coverage 0 — no fabrication', async () => {
    const db = new FakeDb();
    const id = await queueTrendsJob(db, 'pet travel bottle');
    const ing = await ingestTrendsJob(db, id, { keyword: 'pet travel bottle' });
    expect(ing.ok).toBe(true);
    if (!ing.ok) return;
    expect(ing.trend.direction).toBe('INSUFFICIENT_DATA');
    expect(ing.trend.score).toBeNull();
    expect(ing.coverage).toBe(0);
    const jobs = await listTrendsJobs(db);
    expect(jobs.find((j) => j.id === id)?.status).toBe('completed'); // consumed honestly
  });

  it('a job that stays queued blocks nothing else', async () => {
    const db = new FakeDb();
    const pending = await queueTrendsJob(db, 'dog leash');
    const other = await queueTrendsJob(db, 'cat tunnel');
    // Ingest only `other` — pending stays queued and everything still works.
    const ing = await ingestTrendsJob(db, other, { keyword: 'cat tunnel', d30: 30, d90: 20 });
    expect(ing.ok).toBe(true);
    const jobs = await listTrendsJobs(db);
    expect(jobs.find((j) => j.id === pending)?.status).toBe('queued');
    expect(jobs.find((j) => j.id === other)?.status).toBe('completed');
    // The pending job can still be claimed afterwards (nothing wedged).
    const claimed = await claimTrendsJob(db, pending);
    expect(claimed?.status).toBe('running');
  });

  it('rejects a keyword-mismatched result — never attached to the wrong job', async () => {
    const db = new FakeDb();
    const id = await queueTrendsJob(db, 'dog bowl');
    const ing = await ingestTrendsJob(db, id, { keyword: 'cat bowl', d30: 90 });
    expect(ing.ok).toBe(false);
    if (ing.ok) return;
    expect(ing.status).toBe(400);
    expect(ing.error).toMatch(/mismatch/i);
    // The job is NOT consumed or failed by a wrong-keyword POST.
    const jobs = await listTrendsJobs(db);
    expect(jobs.find((j) => j.id === id)?.status).toBe('queued');
  });

  it('non-trends jobs and unknown ids are rejected cleanly', async () => {
    const db = new FakeDb();
    const unrelated = await queueHermesFallback(db, 'search', { query: 'any', market: 'US' });
    expect(unrelated).not.toBeNull();
    // queueHermesFallback without hermesTrendsTask still sets provider=hermes
    // but has no google_trends_browser intent → NOT a trends job.
    expect(await listTrendsJobs(db)).toEqual([]);
    expect(await claimTrendsJob(db, unrelated!)).toBeNull();
    const ing = await ingestTrendsJob(db, unrelated!, { d30: 50 });
    expect(ing.ok).toBe(false);
    if (ing.ok) return;
    expect(ing.status).toBe(400);
    expect(ing.error).toMatch(/not a hermes google-trends job/i);
    // Unknown id.
    const miss = await ingestTrendsJob(db, 'nope', { d30: 50 });
    expect(miss.ok).toBe(false);
    if (miss.ok) return;
    expect(miss.status).toBe(404);
  });

  it('re-ingesting an already-consumed job is idempotent', async () => {
    const db = new FakeDb();
    const id = await queueTrendsJob(db, 'bird feeder');
    const first = await ingestTrendsJob(db, id, { keyword: 'bird feeder', d30: 40, d90: 30 });
    const second = await ingestTrendsJob(db, id, { keyword: 'bird feeder', d90: -80, d365: 90 });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.already).toBe(true);
    // Stored outcome wins — the second (conflicting) payload is not applied.
    expect(second.trend.score).toBe(first.ok ? first.trend.score : null);
    if (first.ok) expect(second.trend.direction).toBe(first.trend.direction);
  });
});

describe('parseTrendsObservations — strict intake contract', () => {
  it('rejects non-object payloads', () => {
    for (const bad of [null, undefined, 'text', 42, []]) {
      const p = parseTrendsObservations(bad);
      expect(p.ok).toBe(false);
    }
  });

  it('rejects non-numeric and out-of-range period values (never coerced into fake numbers)', () => {
    expect(parseTrendsObservations({ d30: 'rising' }).ok).toBe(false);
    expect(parseTrendsObservations({ d30: 5000 }).ok).toBe(false);
    expect(parseTrendsObservations({ d30: -1000 }).ok).toBe(false);
    expect(parseTrendsObservations({ d30: NaN }).ok).toBe(false);
    expect(parseTrendsObservations({ d30: 50 }).ok).toBe(true);
    expect(parseTrendsObservations({ d30: null, d365: -40 }).ok).toBe(true);
  });

  it('drops unknown fields and sanitizes arrays', () => {
    const p = parseTrendsObservations({
      keyword: '  dog poop scooper  ',
      d30: 50,
      evil: 'dropped',
      risingQueries: ['a', 42, '', '  long handled scooper for small dogs with extra reach  ', 'b'],
      usRelevant: 'yes',
    });
    expect(p.ok).toBe(false); // usRelevant must be boolean
    const p2 = parseTrendsObservations({
      keyword: '  dog poop scooper  ',
      d30: 50,
      evil: 'dropped',
      risingQueries: ['a', 42, '', '  long handle scooper  ', 'b'],
      usRelevant: true,
    });
    expect(p2.ok).toBe(true);
    if (!p2.ok) return;
    expect(p2.observations.keyword).toBe('dog poop scooper');
    expect(p2.observations.risingQueries).toEqual(['a', 'long handle scooper', 'b']);
    expect('evil' in p2.observations).toBe(false);
  });

  it('coverage reflects only actually-observed periods', () => {
    expect(trendsCoverage({}).ratio).toBe(0);
    expect(trendsCoverage({ d30: 50 }).ratio).toBe(0.25);
    expect(trendsCoverage({ d30: 50, d90: null, d365: 10, yoy: -5 }).ratio).toBe(0.75);
  });
});