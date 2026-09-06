// Contract for the background Auto-SEO job store.
//   * A run processes only products whose persisted SEO is missing/incomplete —
//     complete SEO is never re-run.
//   * Progress (done/total/current), per-row doneIds and the final report are
//     tracked in the store, so the run survives page unmount (SPA navigation).
//   * Failures are counted and the loop continues; the report splits
//     complete / updated / skipped / failed.
//   * An in-flight run checkpoints its scope to localStorage after every
//     product; a fresh checkpoint hydrates on reload as `interrupted`, and
//     `resume()` finishes only the products still missing/incomplete.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSeoJobStore, type SeoStatus } from '../seoJobStore';
import type { CatalogProduct } from '../types';

const STORAGE_KEY = 'luxedge.seoJob.v1';

const make = (id: string, name = id): CatalogProduct => ({ id, name } as CatalogProduct);

const statusOf = (statuses: Record<string, SeoStatus>) => (p: CatalogProduct) =>
  statuses[p.id] ?? 'missing';

/** Minimal in-memory Storage for tests running in the node environment. */
class FakeStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  key(index: number): string | null { return [...this.map.keys()][index] ?? null; }
  removeItem(key: string): void { this.map.delete(key); }
  setItem(key: string, value: string): void { this.map.set(key, String(value)); }
}

beforeEach(() => {
  useSeoJobStore.getState().__resetForTests();
});

describe('seoJobStore', () => {
  it('runs missing/incomplete targets, skips complete ones, and reports counts', async () => {
    const targets = [make('p1'), make('p2'), make('p3'), make('p4')];
    const statuses: Record<string, SeoStatus> = { p1: 'complete', p2: 'incomplete', p3: 'missing', p4: 'complete' };
    const runOne = vi.fn(async (_p: CatalogProduct) => {});
    const onFinished = vi.fn(async () => {});

    const started = await useSeoJobStore.getState().start({
      targets, statusOf: statusOf(statuses), runOne, onFinished,
    });

    expect(started).toBe(true);
    expect(runOne).toHaveBeenCalledTimes(2);
    expect(runOne.mock.calls.map((c) => c[0].id).sort()).toEqual(['p2', 'p3']);
    expect(useSeoJobStore.getState().running).toBe(false);
    expect(useSeoJobStore.getState().doneIds).toEqual([]);
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(useSeoJobStore.getState().report).toEqual({ complete: 2, updated: 2, skipped: 2, failed: 0 });
  });

  it('marks each product done as it completes (doneIds during the run)', async () => {
    const targets = [make('a'), make('b')];
    const doneAtStartOfStep: string[][] = [];
    const runOne = vi.fn(async (p: CatalogProduct) => {
      doneAtStartOfStep.push([...useSeoJobStore.getState().doneIds]);
      void p;
    });

    await useSeoJobStore.getState().start({
      targets, statusOf: statusOf({}), runOne,
    });

    // Before 'a' runs nothing is done; before 'b' runs, 'a' is already marked.
    expect(doneAtStartOfStep).toEqual([[], ['a']]);
  });

  it('counts failures and keeps going; updated excludes failed', async () => {
    const targets = [make('ok1'), make('bad'), make('ok2')];
    const runOne = vi.fn(async (p: CatalogProduct) => {
      if (p.id === 'bad') throw new Error('AI down');
    });

    await useSeoJobStore.getState().start({
      targets, statusOf: statusOf({}), runOne,
    });

    expect(useSeoJobStore.getState().report).toEqual({ complete: 0, updated: 2, skipped: 0, failed: 1 });
    expect(useSeoJobStore.getState().running).toBe(false);
  });

  it('returns false and changes nothing when every target is already complete', async () => {
    const targets = [make('p1'), make('p2')];
    const runOne = vi.fn(async () => {});

    const started = await useSeoJobStore.getState().start({
      targets, statusOf: statusOf({ p1: 'complete', p2: 'complete' }), runOne,
    });

    expect(started).toBe(false);
    expect(runOne).not.toHaveBeenCalled();
    expect(useSeoJobStore.getState().running).toBe(false);
    expect(useSeoJobStore.getState().report).toBeNull();
  });

  it('rejects a second run while one is in flight', async () => {
    const targets = [make('p1')];
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    const runOne = vi.fn(() => gate);

    const first = useSeoJobStore.getState().start({
      targets, statusOf: statusOf({}), runOne,
    });
    const second = await useSeoJobStore.getState().start({
      targets, statusOf: statusOf({}), runOne,
    });
    expect(second).toBe(false);
    expect(useSeoJobStore.getState().running).toBe(true);

    release();
    await first;
    expect(useSeoJobStore.getState().running).toBe(false);
  });

  it('preserves the report after a run so it survives navigation back', async () => {
    const targets = [make('p1'), make('p2')];
    await useSeoJobStore.getState().start({
      targets, statusOf: statusOf({}), runOne: async () => {},
    });
    // "Navigate away and back" — the store still holds the summary.
    expect(useSeoJobStore.getState().report).toEqual({ complete: 0, updated: 2, skipped: 0, failed: 0 });
  });
});

describe('seoJobStore — reload resume (localStorage checkpoint)', () => {
  it('checkpoints the run scope to localStorage and clears it on completion', async () => {
    vi.resetModules();
    const ls = new FakeStorage();
    vi.stubGlobal('localStorage', ls);
    try {
      const { useSeoJobStore: store } = await import('../seoJobStore');
      let release!: () => void;
      const gate = new Promise<void>((res) => { release = res; });
      const runOne = vi.fn(async (p: CatalogProduct) => { if (p.id === 'a') await gate; });

      const started = store.getState().start({
        targets: [make('a'), make('b')], statusOf: statusOf({}), runOne,
      });
      // Mid-flight (product 'a' blocked): checkpoint holds the full scope, nothing processed yet.
      expect(JSON.parse(ls.getItem(STORAGE_KEY)!)).toMatchObject({ v: 1, ids: ['a', 'b'], processed: 0, errors: 0 });

      release();
      await started;
      // Finished — checkpoint cleared, nothing offered.
      expect(ls.getItem(STORAGE_KEY)).toBeNull();
      expect(store.getState().interrupted).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('hydrates a fresh checkpoint as interrupted and resume() finishes only the rest', async () => {
    vi.resetModules();
    const ls = new FakeStorage();
    vi.stubGlobal('localStorage', ls);
    try {
      // What the pre-reload session left behind: p1 finished, p2 + p3 pending.
      ls.setItem(STORAGE_KEY, JSON.stringify({ v: 1, ids: ['p1', 'p2', 'p3'], processed: 1, errors: 0, at: Date.now() }));
      const { useSeoJobStore: store } = await import('../seoJobStore');

      expect(store.getState().interrupted).toEqual({ v: 1, ids: ['p1', 'p2', 'p3'], processed: 1, errors: 0, at: expect.any(Number) });
      expect(store.getState().running).toBe(false);

      // Page resolves the ids back to current rows; eligibility re-checks persisted SEO.
      const runOne = vi.fn(async (_p: CatalogProduct) => {});
      const started = await store.getState().resume({
        targets: [make('p1'), make('p2'), make('p3')],
        statusOf: statusOf({ p1: 'complete' }), runOne,
      });

      expect(started).toBe(true);
      // p1 actually saved before the crash → skipped, never re-run.
      expect(runOne.mock.calls.map((c) => c[0].id).sort()).toEqual(['p2', 'p3']);
      expect(store.getState().report).toEqual({ complete: 1, updated: 2, skipped: 1, failed: 0 });
      expect(store.getState().interrupted).toBeNull();
      expect(ls.getItem(STORAGE_KEY)).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('resume() without a pending interrupted job returns false', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', new FakeStorage());
    try {
      const { useSeoJobStore: store } = await import('../seoJobStore');
      const started = await store.getState().resume({
        targets: [make('p1')], statusOf: statusOf({}), runOne: async () => {},
      });
      expect(started).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('dismissInterrupted() clears both the offer and the saved checkpoint', async () => {
    vi.resetModules();
    const ls = new FakeStorage();
    vi.stubGlobal('localStorage', ls);
    try {
      ls.setItem(STORAGE_KEY, JSON.stringify({ v: 1, ids: ['p1'], processed: 0, errors: 0, at: Date.now() }));
      const { useSeoJobStore: store } = await import('../seoJobStore');
      expect(store.getState().interrupted).not.toBeNull();

      store.getState().dismissInterrupted();

      expect(store.getState().interrupted).toBeNull();
      expect(ls.getItem(STORAGE_KEY)).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('expires stale checkpoints silently instead of offering an old resume', async () => {
    vi.resetModules();
    const ls = new FakeStorage();
    vi.stubGlobal('localStorage', ls);
    try {
      ls.setItem(STORAGE_KEY, JSON.stringify({ v: 1, ids: ['p1'], processed: 0, errors: 0, at: Date.now() - 25 * 60 * 60 * 1000 }));
      const { useSeoJobStore: store } = await import('../seoJobStore');

      expect(store.getState().interrupted).toBeNull();
      expect(ls.getItem(STORAGE_KEY)).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a fresh start() supersedes a pending interrupted offer', async () => {
    vi.resetModules();
    const ls = new FakeStorage();
    vi.stubGlobal('localStorage', ls);
    try {
      ls.setItem(STORAGE_KEY, JSON.stringify({ v: 1, ids: ['old1', 'old2'], processed: 0, errors: 0, at: Date.now() }));
      const { useSeoJobStore: store } = await import('../seoJobStore');
      expect(store.getState().interrupted).not.toBeNull();

      let release!: () => void;
      const gate = new Promise<void>((res) => { release = res; });
      const started = store.getState().start({
        targets: [make('new1')], statusOf: statusOf({}), runOne: () => gate,
      });

      // Mid-flight: the pending offer is gone and the checkpoint now tracks the new run.
      expect(store.getState().interrupted).toBeNull();
      expect(JSON.parse(ls.getItem(STORAGE_KEY)!)).toMatchObject({ ids: ['new1'] });

      release();
      await started;
      expect(store.getState().report).toEqual({ complete: 0, updated: 1, skipped: 0, failed: 0 });
      expect(ls.getItem(STORAGE_KEY)).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
