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
//
// A running job also checkpoints its scope to localStorage after every
// product, so a FULL page reload (which kills this module and its loop) can
// offer to resume: on boot the freshest checkpoint is restored as
// `interrupted`, the page resolves those ids back to the rows it just
// loaded, and `resume()` re-runs eligibility — products that actually saved
// before the reload are now 'complete' and get skipped, so nothing is ever
// regenerated or overwritten. `start()` supersedes a pending offer; stale
// checkpoints (older than a day) expire silently.
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

/** Serializable snapshot of an in-flight run — what a reload must be able to resume. */
export interface SeoJobCheckpoint {
  v: 1;
  /** Every product id the run targeted (including ones already complete), in order. */
  ids: string[];
  /** Loop iterations completed before the interruption (failures included). */
  processed: number;
  /** Failures before the interruption. */
  errors: number;
  /** When the checkpoint was last written — stale resume offers expire silently. */
  at: number;
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
  /** A run killed by a full page reload (checkpoint restored from localStorage), if fresh. */
  interrupted: SeoJobCheckpoint | null;
  /** Start a run. Returns false (and changes nothing) if already running or nothing to do. */
  start: (opts: StartSeoJobOptions) => Promise<boolean>;
  /** Resume the interrupted run over freshly-resolved targets. False if none is pending. */
  resume: (opts: StartSeoJobOptions) => Promise<boolean>;
  /** Dismiss the interrupted-run offer without resuming (clears the saved checkpoint). */
  dismissInterrupted: () => void;
  /** Clear the last-run summary. */
  clear: () => void;
  __resetForTests: () => void;
}

const STORAGE_KEY = 'luxedge.seoJob.v1';
const CHECKPOINT_TTL_MS = 24 * 60 * 60 * 1000;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // storage disabled (private mode / sandbox) — resume just won't survive reload
  }
}

function saveCheckpoint(cp: SeoJobCheckpoint | null): void {
  const s = storage();
  if (!s) return;
  try {
    if (cp) s.setItem(STORAGE_KEY, JSON.stringify(cp));
    else s.removeItem(STORAGE_KEY);
  } catch {
    /* quota / serialization — background SEO keeps working, only reload-resume is lost */
  }
}

function loadCheckpoint(): SeoJobCheckpoint | null {
  const s = storage();
  if (!s) return null;
  let raw: string | null = null;
  try {
    raw = s.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const cp = JSON.parse(raw) as SeoJobCheckpoint;
    if (cp.v !== 1 || !Array.isArray(cp.ids) || cp.ids.length === 0) {
      saveCheckpoint(null);
      return null;
    }
    if (typeof cp.at !== 'number' || Date.now() - cp.at > CHECKPOINT_TTL_MS) {
      saveCheckpoint(null); // abandoned long ago — don't offer a stale resume
      return null;
    }
    return cp;
  } catch {
    saveCheckpoint(null);
    return null;
  }
}

async function runLoop(
  work: CatalogProduct[],
  fullIds: string[],
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
    const done = i + 1;
    useSeoJobStore.setState({
      done,
      errors: failed,
      doneIds: useSeoJobStore.getState().doneIds.concat(p.id),
    });
    // Persist after every product so a full reload can offer to resume the rest.
    saveCheckpoint({ v: 1, ids: fullIds, processed: done, errors: failed, at: Date.now() });
  }
  const skipped = fullIds.length - work.length;
  const report: SeoJobReport = { complete: skipped, updated: work.length - failed, skipped, failed };
  useSeoJobStore.setState({ running: false, done: 0, total: 0, current: '', errors: 0, doneIds: [], report });
  saveCheckpoint(null); // finished — nothing left to resume
  if (onFinished) await onFinished();
}

/** Shared begin for `start` and `resume`: filter to non-complete, kick the loop, checkpoint the scope. */
async function beginRun(opts: StartSeoJobOptions): Promise<boolean> {
  const { targets, statusOf, runOne, onFinished } = opts;
  const work = targets.filter((p) => p.name.trim() && statusOf(p) !== 'complete');
  if (work.length === 0) return false;
  const fullIds = targets.map((p) => p.id);
  useSeoJobStore.setState({
    running: true, done: 0, total: work.length, current: 'Starting…', errors: 0, doneIds: [], report: null,
    interrupted: null, // a fresh run supersedes any pending resume offer
  });
  saveCheckpoint({ v: 1, ids: fullIds, processed: 0, errors: 0, at: Date.now() });
  await runLoop(work, fullIds, runOne, onFinished);
  return true;
}

export const useSeoJobStore = create<SeoJobState>((set) => ({
  running: false,
  done: 0,
  total: 0,
  current: '',
  errors: 0,
  doneIds: [],
  report: null,
  interrupted: loadCheckpoint(),

  start: async (opts) => {
    if (useSeoJobStore.getState().running) return false;
    return beginRun(opts);
  },

  resume: async (opts) => {
    const st = useSeoJobStore.getState();
    if (st.running || !st.interrupted) return false;
    return beginRun(opts);
  },

  dismissInterrupted: () => {
    saveCheckpoint(null);
    set({ interrupted: null });
  },

  clear: () => set({ report: null }),

  __resetForTests: () => {
    saveCheckpoint(null);
    set({ running: false, done: 0, total: 0, current: '', errors: 0, doneIds: [], report: null, interrupted: null });
  },
}));
