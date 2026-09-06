// The Blog Auto-SEO instance shares the background-job engine with Products
// but must stay fully isolated: its own localStorage checkpoint key and its
// own queue, so a pending Products run never offers itself on the Blog page
// (and vice versa), and the two can never block each other.
import { describe, it, expect, vi, beforeEach } from 'vitest';

class FakeStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  key(index: number): string | null { return [...this.map.keys()][index] ?? null; }
  removeItem(key: string): void { this.map.delete(key); }
  setItem(key: string, value: string): void { this.map.set(key, String(value)); }
}

const cp = (ids: string[]) => JSON.stringify({ v: 1, ids, processed: 0, errors: 0, at: Date.now() });

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('blog job store isolation', () => {
  it('hydrates only from its own checkpoint key, never the products key', async () => {
    vi.resetModules();
    const ls = new FakeStorage();
    // A pending PRODUCTS run exists (its key) — the Blog page must ignore it.
    ls.setItem('luxedge.seoJob.v1', cp(['prod-1']));
    vi.stubGlobal('localStorage', ls);
    try {
      const { useBlogJobStore } = await import('../blogJobStore');
      expect(useBlogJobStore.getState().interrupted).toBeNull();
      expect(ls.getItem('luxedge.blogSeoJob.v1')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('restores its own interrupted checkpoint on reload', async () => {
    vi.resetModules();
    const ls = new FakeStorage();
    ls.setItem('luxedge.blogSeoJob.v1', cp(['post-a', 'post-b']));
    vi.stubGlobal('localStorage', ls);
    try {
      const { useBlogJobStore } = await import('../blogJobStore');
      expect(useBlogJobStore.getState().interrupted).toEqual({ v: 1, ids: ['post-a', 'post-b'], processed: 0, errors: 0, at: expect.any(Number) });

      // The products store in the same app session is untouched.
      const { useSeoJobStore } = await import('../../catalog/seoJobStore');
      expect(useSeoJobStore.getState().interrupted).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('writes its resume checkpoint under its own key and clears it on completion', async () => {
    vi.resetModules();
    const ls = new FakeStorage();
    vi.stubGlobal('localStorage', ls);
    try {
      const { useBlogJobStore } = await import('../blogJobStore');
      let release!: () => void;
      const gate = new Promise<void>((res) => { release = res; });
      const runOne = vi.fn(async (p: { id: string }) => { if (p.id === 'post-a') await gate; });

      const started = useBlogJobStore.getState().start({
        targets: [{ id: 'post-a', title: 'A' }, { id: 'post-b', title: 'B' }] as { id: string }[],
        statusOf: () => 'missing' as const,
        runOne,
        label: (p) => p.id,
      });
      expect(JSON.parse(ls.getItem('luxedge.blogSeoJob.v1')!)).toMatchObject({ ids: ['post-a', 'post-b'] });
      expect(ls.getItem('luxedge.seoJob.v1')).toBeNull(); // never touches the products key

      release();
      await started;
      expect(useBlogJobStore.getState().report).toEqual({ complete: 0, updated: 2, skipped: 0, failed: 0 });
      expect(ls.getItem('luxedge.blogSeoJob.v1')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
