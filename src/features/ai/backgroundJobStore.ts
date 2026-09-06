// ============================================================================
// LUXEDGE — BACKGROUND JOB STORE (generic engine)
//
// One engine behind the Products and Blog "Auto SEO" bulk runs. A run lives
// in a module-level zustand store — not in the page component — so it keeps
// running (and keeps reporting progress) while the user navigates to another
// admin page and back.
//
// The page component owns the *how* (eligibility + generate/save via its own
// repository) and injects it per run via `start()`; the store owns the
// *loop* and the progress bookkeeping. Complete SEO is never re-run.
//
// A running job also checkpoints its scope to localStorage after every item,
// so a FULL page reload (which kills this module and its loop) can offer to
// resume: on boot the freshest checkpoint is restored as `interrupted`, the
// page resolves those ids back to the rows it just loaded, and `resume()`
// re-runs eligibility — items that actually saved before the reload are now
// 'complete' and get skipped, so nothing is ever regenerated or overwritten.
// `start()` supersedes a pending offer; stale checkpoints (older than a day)
// expire silently.
//
// Each caller gets its OWN instance via `createBackgroundJobStore(storageKey)`
// so product and blog runs keep separate state and separate resume offers.
// ============================================================================
import { create } from 'zustand';

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

export interface BackgroundJobOptions<T> {
  /** The exact targets the user selected (bulk bar, toolbar or row menu). */
  targets: T[];
  /** Eligibility: reads the raw persisted SEO columns per target. */
  statusOf: (t: T) => SeoStatus;
  /** Generate + persist SEO for one target (throws → counted as failed). */
  runOne: (t: T) => Promise<void>;
  /** Called once the run finishes — the page refreshes rows if still mounted. */
  onFinished?: () => Promise<void> | void;
  /** Human label for the current target (defaults to `.name`, then the id). */
  label?: (t: T) => string;
}

export interface BackgroundJobState<T> {
  running: boolean;
  done: number;
  total: number;
  current: string;
  errors: number;
  /** Target ids completed in the *current* run — drives per-row "SEO done" marks. */
  doneIds: string[];
  /** Summary of the last finished run (kept until the next run starts). */
  report: SeoJobReport | null;
  /** A run killed by a full page reload (checkpoint restored from localStorage), if fresh. */
  interrupted: SeoJobCheckpoint | null;
  /** Start a run. Returns false (and changes nothing) if already running or nothing to do. */
  start: (opts: BackgroundJobOptions<T>) => Promise<boolean>;
  /** Resume the interrupted run over freshly-resolved targets. False if none is pending. */
  resume: (opts: BackgroundJobOptions<T>) => Promise<boolean>;
  /** Dismiss the interrupted-run offer without resuming (clears the saved checkpoint). */
  dismissInterrupted: () => void;
  /** Clear the last-run summary. */
  clear: () => void;
  __resetForTests: () => void;
}

/** Serializable snapshot of an in-flight run — what a reload must be able to resume. */
export interface SeoJobCheckpoint {
  v: 1;
  /** Every target id the run covered (including ones already complete), in order. */
  ids: string[];
  /** Loop iterations completed before the interruption (failures included). */
  processed: number;
  /** Failures before the interruption. */
  errors: number;
  /** When the checkpoint was last written — stale resume offers expire silently. */
  at: number;
}

const CHECKPOINT_TTL_MS = 24 * 60 * 60 * 1000;

/** Create a dedicated background-job store. Each storageKey is an isolated queue + resume offer. */
export function createBackgroundJobStore<T extends { id: string }>(storageKey: string) {
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
      if (cp) s.setItem(storageKey, JSON.stringify(cp));
      else s.removeItem(storageKey);
    } catch {
      /* quota / serialization — the run keeps working, only reload-resume is lost */
    }
  }

  function loadCheckpoint(): SeoJobCheckpoint | null {
    const s = storage();
    if (!s) return null;
    let raw: string | null = null;
    try {
      raw = s.getItem(storageKey);
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

  function labelOf(t: T, label?: (t: T) => string): string {
    if (label) return label(t);
    const named = t as { name?: unknown };
    return typeof named.name === 'string' && named.name ? named.name : t.id;
  }

  async function runLoop(
    work: T[],
    fullIds: string[],
    opts: BackgroundJobOptions<T>,
  ): Promise<void> {
    const { runOne, onFinished } = opts;
    let failed = 0;
    for (let i = 0; i < work.length; i++) {
      const t = work[i];
      useStore.setState({ current: labelOf(t, opts.label).slice(0, 60) });
      try {
        await runOne(t);
      } catch {
        failed++;
      }
      const done = i + 1;
      useStore.setState({
        done,
        errors: failed,
        doneIds: useStore.getState().doneIds.concat(t.id),
      });
      // Persist after every item so a full reload can offer to resume the rest.
      saveCheckpoint({ v: 1, ids: fullIds, processed: done, errors: failed, at: Date.now() });
    }
    const skipped = fullIds.length - work.length;
    const report: SeoJobReport = { complete: skipped, updated: work.length - failed, skipped, failed };
    useStore.setState({ running: false, done: 0, total: 0, current: '', errors: 0, doneIds: [], report });
    saveCheckpoint(null); // finished — nothing left to resume
    if (onFinished) await onFinished();
  }

  /** Shared begin for `start` and `resume`: filter to non-complete, kick the loop, checkpoint the scope. */
  async function beginRun(opts: BackgroundJobOptions<T>): Promise<boolean> {
    const { targets, statusOf } = opts;
    const work = targets.filter((t) => {
      const named = t as { name?: unknown };
      const hasName = typeof named.name !== 'string' || (named.name as string).trim().length > 0;
      return hasName && statusOf(t) !== 'complete';
    });
    if (work.length === 0) return false;
    const fullIds = targets.map((t) => t.id);
    useStore.setState({
      running: true, done: 0, total: work.length, current: 'Starting…', errors: 0, doneIds: [], report: null,
      interrupted: null, // a fresh run supersedes any pending resume offer
    });
    saveCheckpoint({ v: 1, ids: fullIds, processed: 0, errors: 0, at: Date.now() });
    await runLoop(work, fullIds, opts);
    return true;
  }

  const useStore = create<BackgroundJobState<T>>()((set) => ({
    running: false,
    done: 0,
    total: 0,
    current: '',
    errors: 0,
    doneIds: [],
    report: null,
    interrupted: loadCheckpoint(),

    start: async (opts) => {
      if (useStore.getState().running) return false;
      return beginRun(opts);
    },

    resume: async (opts) => {
      const st = useStore.getState();
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

  return useStore;
}
