// ============================================================================
// LUXEDGE — BACKGROUND AUTO-SEO JOB STORE
//
// Module-level zustand store so a bulk Auto-SEO run survives SPA navigation:
// the loop lives here (not in the page component), so switching to Blog or
// another admin tab keeps the job running and progress/report state stays
// visible when the user comes back to Products.
//
// The page component owns the *how* (eligibility + generate/save via the
// catalog repository) and injects it per run via `start()`; the store owns
// the *loop* and the progress bookkeeping. Complete SEO is never re-run.
// ============================================================================
import { create } from 'zustand';
import type { CatalogProduct } from './types';

export type SeoStatus = 'complete' | 'incomplete' | 'missing';

export interface SeoJobReport {
  /** Targets that already had complete SEO (never touched). */
  complete: number;
  /** Count successfully generated + saved. */
  updated: number;
  /** Alias of `complete` — skipped because they were already done. */
  skipped: number;
  /** Count that threw while generating/saving. */
  failed: number;
}

export interface StartSeoJobOptions {
  /** The exact products the user selected (bulk bar, toolbar or row menu). */
  targets: CatalogProduct[];
  /** Eligibility: reads the raw persisted SEO columns per product. */
  statusOf: (p: CatalogProduct) => SeoStatus;
  /** Generate + persist SEO for one product (throws → counted as failed). */
  runOne: (p: CatalogProduct) => Promise<void>;
  /** Called once the run finishes — the page refreshes rows if still mounted. */
  onFinished?: () => Promise<void> | void;
}

interface SeoJobState {
  running: boolean;
  done: number;
  total: number;
  current: string;
  errors: number;
  /** Product ids completed in the *current* run — drives per-row "SEO done" marks. */
  doneIds: string[];
  /** Summary of the last finished run (kept until the next run starts). */
  report: SeoJobReport | null;
  /** Start a run. Returns false (and changes nothing) if already running or nothing to do. */
  start: (opts: StartSeoJobOptions) => Promise<boolean>;
  /** Clear the last-run summary. */
  clear: () => void;
  __resetForTests: () => void;
}

async function runLoop(
  work: CatalogProduct[],
  targetCount: number,
  runOne: (p: CatalogProduct) => Promise<void>,
  onFinished?: () => Promise<void> | void,
): Promise<void> {
  let failed = 0;
  for (let i = 0; i < work.length; i++) {
    const p = work[i];
    useSeoJobStore.setState({ current: p.name.slice(0, 60) });
    try {
      await runOne(p);
    } catch {
      failed++;
    }
    useSeoJobStore.setState({
      done: i + 1,
      errors: failed,
      doneIds: useSeoJobStore.getState().doneIds.concat(p.id),
    });
  }
  const skipped = targetCount - work.length;
  const report: SeoJobReport = { complete: skipped, updated: work.length - failed, skipped, failed };
  useSeoJobStore.setState({ running: false, done: 0, total: 0, current: '', errors: 0, doneIds: [], report });
  if (onFinished) await onFinished();
}

export const useSeoJobStore = create<SeoJobState>((set) => ({
  running: false,
  done: 0,
  total: 0,
  current: '',
  errors: 0,
  doneIds: [],
  report: null,

  start: async ({ targets, statusOf, runOne, onFinished }) => {
    if (useSeoJobStore.getState().running) return false;
    const work = targets.filter((p) => p.name.trim() && statusOf(p) !== 'complete');
    if (work.length === 0) return false;
    useSeoJobStore.setState({
      running: true, done: 0, total: work.length, current: 'Starting…', errors: 0, doneIds: [], report: null,
    });
    await runLoop(work, targets.length, runOne, onFinished);
    return true;
  },

  clear: () => set({ report: null }),

  __resetForTests: () => {
    set({ running: false, done: 0, total: 0, current: '', errors: 0, doneIds: [], report: null });
  },
}));