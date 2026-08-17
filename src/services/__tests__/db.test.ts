import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LocalStorageAdapter, SupabaseAdapter, getDbMode, resetDbForTests, __setDbConfigForTests } from '../db';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe('LocalStorageAdapter', () => {
  let adapter: LocalStorageAdapter;

  beforeEach(() => {
    adapter = new LocalStorageAdapter(memoryStorage());
  });

  it('inserts, lists, gets, updates and removes', async () => {
    type P = { id: string; name: string; price: number };
    const row: P = { id: 'p1', name: 'Dog Bed', price: 49.99 };
    await adapter.insert<P>('products', row);
    expect((await adapter.list<P>('products')).length).toBe(1);

    const got = await adapter.get<P>('products', 'p1');
    expect(got?.name).toBe('Dog Bed');

    await adapter.update<P>('products', 'p1', { price: 39.99 });
    const updated = await adapter.get<P>('products', 'p1');
    expect(updated?.price).toBe(39.99);
    expect(updated?.name).toBe('Dog Bed'); // patch merges

    await adapter.remove('products', 'p1');
    expect(await adapter.get<P>('products', 'p1')).toBeNull();
    expect((await adapter.list<P>('products')).length).toBe(0);
  });

  it('returns null for missing rows', async () => {
    expect(await adapter.get('products', 'nope')).toBeNull();
  });

  it('is namespace-isolated per table', async () => {
    await adapter.insert('products', { id: 'x', name: 'X' });
    await adapter.insert('reviews', { id: 'r1', rating: 5 });
    expect((await adapter.list('products')).length).toBe(1);
    expect((await adapter.list('reviews')).length).toBe(1);
  });
});

describe('getDbMode', () => {
  beforeEach(() => {
    resetDbForTests();
    __setDbConfigForTests(undefined);
  });

  it('reports local when Supabase env vars are absent', () => {
    // A local .env may set VITE_SUPABASE_* — force the unconfigured path.
    __setDbConfigForTests(null);
    expect(getDbMode()).toBe('local');
  });
});

describe('SupabaseAdapter failure behavior (no silent fallback)', () => {
  it('throws on a failed insert — never falls back to localStorage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('forbidden', { status: 403 })));
    const adapter = new SupabaseAdapter('https://x.supabase.co', 'anon');
    await expect(adapter.insert('products', { id: 'p1' })).rejects.toThrow(/403/);
  });

  it('throws on a failed list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })));
    const adapter = new SupabaseAdapter('https://x.supabase.co', 'anon');
    await expect(adapter.list('products')).rejects.toThrow(/500/);
  });

  it('testConnection reports ok only when Supabase actually answers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { status: 200 })));
    const adapter = new SupabaseAdapter('https://x.supabase.co', 'anon');
    const ok = await adapter.testConnection();
    expect(ok.ok).toBe(true);
    expect(ok.mode).toBe('supabase');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 502 })));
    const bad = await adapter.testConnection();
    expect(bad.ok).toBe(false);
    expect(bad.mode).toBe('supabase');
  });

  it('testConnection returns ok:false (not a throw) when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const adapter = new SupabaseAdapter('https://x.supabase.co', 'anon');
    const res = await adapter.testConnection();
    expect(res.ok).toBe(false);
    expect(res.detail).toContain('ECONNREFUSED');
  });
});
