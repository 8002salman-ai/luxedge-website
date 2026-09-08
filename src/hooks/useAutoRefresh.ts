import { useEffect, useRef } from 'react';

export type Refetch = () => Promise<unknown> | void;

/**
 * Wrap a refetch so at most one call is in flight: while a previous call's
 * promise is pending, further calls are skipped rather than stacked. The
 * returned function is stable and safe to use as an effect/interval callback.
 */
export function guarded(refetch: Refetch): () => void {
  let inFlight = false;
  return () => {
    if (inFlight) return;
    inFlight = true;
    Promise.resolve(refetch())
      .catch(() => undefined)
      .finally(() => { inFlight = false; });
  };
}

/**
 * Scheduler behind useAutoRefresh — pure and testable without a DOM.
 *
 * Calls the given refresh (already guarded) on window focus and on a fixed
 * interval. Returns a disposer that removes the focus listener and clears the
 * interval.
 */
export function createAutoRefreshScheduler(
  refresh: () => void,
  intervalMs: number,
  win: { addEventListener: (t: string, cb: () => void) => void; removeEventListener: (t: string, cb: () => void) => void; setInterval: (cb: () => void, ms: number) => number; clearInterval: (id: number) => void },
): () => void {
  const id = win.setInterval(refresh, intervalMs);
  win.addEventListener('focus', refresh);
  return () => {
    win.clearInterval(id);
    win.removeEventListener('focus', refresh);
  };
}

/**
 * Near-real-time refetch for admin dashboards.
 *
 * Returns a stable, in-flight-guarded `refresh` for the component to call on
 * mount / filter changes; the returned scheduler then refetches on window
 * focus and every ~50s. Interval + focus listener are cleaned up on unmount.
 */
export function useAutoRefresh(refetch: Refetch, intervalMs = 50000): () => void {
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  const refreshRef = useRef<(() => void) | null>(null);
  if (!refreshRef.current) {
    refreshRef.current = guarded(() => refetchRef.current());
  }
  const refresh = refreshRef.current;

  useEffect(() => {
    const dispose = createAutoRefreshScheduler(refresh, intervalMs, window);
    return dispose;
  }, [refresh, intervalMs]);

  return refresh;
}