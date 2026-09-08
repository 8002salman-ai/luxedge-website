import { describe, it, expect, vi, afterEach } from 'vitest';
import { createAutoRefreshScheduler, guarded } from '../useAutoRefresh';

interface FakeWin {
  listeners: Record<string, () => void>;
  intervalMs: number;
  intervalFired: number;
  addEventListener: (t: string, cb: () => void) => void;
  removeEventListener: (t: string, cb: () => void) => void;
  setInterval: (cb: () => void, ms: number) => number;
  clearInterval: (id: number) => void;
  fireFocus: () => void;
  fireInterval: () => void;
}

function fakeWin(): FakeWin {
  const w = {
    listeners: {} as Record<string, () => void>,
    intervalMs: 0,
    intervalFired: 0,
    addEventListener(t: string, cb: () => void) { w.listeners[t] = cb; },
    removeEventListener(t: string) { delete w.listeners[t]; },
    setInterval(cb: () => void, ms: number) { w.intervalMs = ms; w._cb = cb; return 1; },
    clearInterval() { w._cb = undefined; },
    fireFocus() { w.listeners['focus']?.(); },
    fireInterval() { w.intervalFired += 1; w._cb?.(); },
    _cb: undefined as (() => void) | undefined,
  };
  return w;
}

afterEach(() => { vi.restoreAllMocks(); });

describe('guarded', () => {
  it('never runs concurrent refetches — calls while in flight are skipped', async () => {
    let resolveFn: (() => void) | undefined;
    let calls = 0;
    const refresh = guarded(() => {
      calls += 1;
      return new Promise<void>((resolve) => { resolveFn = resolve; });
    });
    refresh();
    refresh();
    refresh();
    expect(calls).toBe(1); // first call in flight, the other two skipped
    resolveFn!();
    await new Promise((r) => setTimeout(r, 0));
    refresh();
    expect(calls).toBe(2); // guard released after completion
  });

  it('releases the guard even when the refetch rejects', async () => {
    let calls = 0;
    const refresh = guarded(() => {
      calls += 1;
      return Promise.reject(new Error('boom'));
    });
    refresh();
    await new Promise((r) => setTimeout(r, 0));
    refresh();
    expect(calls).toBe(2);
  });

  it('returns a stable function identity across calls', () => {
    const refresh = guarded(() => undefined);
    expect(refresh).toBe(refresh);
  });
});

describe('createAutoRefreshScheduler', () => {
  it('refetches on window focus', () => {
    const win = fakeWin();
    const refresh = vi.fn();
    const dispose = createAutoRefreshScheduler(refresh, 50000, win);
    expect(win.listeners['focus']).toBeDefined();
    win.fireFocus();
    expect(refresh).toHaveBeenCalledTimes(1);
    dispose();
    expect(win.listeners['focus']).toBeUndefined();
    win.fireFocus();
    expect(refresh).toHaveBeenCalledTimes(1); // listener removed — no more calls
  });

  it('refetches on the interval and registers the configured period', () => {
    const win = fakeWin();
    const refresh = vi.fn();
    const dispose = createAutoRefreshScheduler(refresh, 45000, win);
    expect(win.intervalMs).toBe(45000);
    win.fireInterval();
    win.fireInterval();
    expect(refresh).toHaveBeenCalledTimes(2);
    dispose();
    win.fireInterval();
    expect(refresh).toHaveBeenCalledTimes(2); // interval cleared — no more calls
  });

  it('cleanup removes focus listener and clears the interval', () => {
    const win = fakeWin();
    const refresh = vi.fn();
    const clearInterval = vi.spyOn(win, 'clearInterval');
    const dispose = createAutoRefreshScheduler(refresh, 50000, win);
    dispose();
    expect(clearInterval).toHaveBeenCalledWith(1);
    expect(win.listeners['focus']).toBeUndefined();
    expect(win.intervalFired).toBe(0);
  });
});