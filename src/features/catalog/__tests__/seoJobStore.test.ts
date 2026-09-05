// Contract for the background Auto-SEO job store.
//   * A run processes only products whose persisted SEO is missing/incomplete —
//     complete SEO is never re-run.
//   * Progress (done/total/current), per-row doneIds and the final report are
//     tracked in the store, so the run survives page unmount (SPA navigation).
//   * Failures are counted and the loop continues; the report splits
//     complete / updated / skipped / failed.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSeoJobStore, type SeoStatus } from '../seoJobStore';
import type { CatalogProduct } from '../types';

const make = (id: string, name = id): CatalogProduct => ({ id, name } as CatalogProduct);

const statusOf = (statuses: Record<string, SeoStatus>) => (p: CatalogProduct) =>
  statuses[p.id] ?? 'missing';

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