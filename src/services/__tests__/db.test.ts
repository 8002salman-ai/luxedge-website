import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../supabase')>();
  return { ...actual, getSession: vi.fn() };
});
import { getSession } from '../supabase';
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

  it('finds the first row matching a column value (findFirst)', async () => {
    await adapter.insert('customers', { id: 'c1', auth_user_id: 'u1', email: 'a@luxedge.us' });
    await adapter.insert('customers', { id: 'c2', auth_user_id: 'u2', email: 'b@luxedge.us' });
    const hit = await adapter.findFirst<{ id: string }>('customers', 'auth_user_id', 'u2');
    expect(hit?.id).toBe('c2');
    expect(await adapter.findFirst('customers', 'auth_user_id', 'nope')).toBeNull();
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

describe('SupabaseAdapter expired-token recovery (PGRST303 JWT expired)', () => {
  const session = () => ({
    accessToken: 'fresh-token',
    refreshToken: 'r',
    expiresAt: Date.now() + 60_000,
    user: { id: 'u1', email: 'a@b.c', name: 'A', role: 'admin' as const },
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('refreshes once and retries when a signed-in request 401s with JWT expired', async () => {
    vi.mocked(getSession).mockResolvedValue(session() as never);
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const auth = ((init?.headers as Record<string, string> | undefined) || {}).Authorization || '';
      calls.push(auth);
      if (calls.length === 1) {
        return new Response(JSON.stringify({ code: 'PGRST303', message: 'JWT expired' }), { status: 401, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify([{ id: 'row-1' }]), { status: 200, headers: { 'content-type': 'application/json' } });
    }));

    const adapter = new SupabaseAdapter('https://x.supabase.co', 'anon');
    adapter.setAccessToken('stale-token');
    const rows = await adapter.list<{ id: string }>('products');
    expect(rows).toEqual([{ id: 'row-1' }]);
    expect(calls).toEqual(['Bearer stale-token', 'Bearer fresh-token']);
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it('force-refreshes on 401 even when the stored token looked locally valid (server-side revocation)', async () => {
    // The stored session still has far-future expiresAt, so a non-forced
    // getSession() would return the SAME rejected token and the 401 would
    // surface. The adapter must force the refresh regardless of the clock.
    const localValid = { ...session(), accessToken: 'fresh-token-2', expiresAt: Date.now() + 60 * 60 * 1000 };
    vi.mocked(getSession).mockResolvedValue(localValid as never);
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const auth = ((init?.headers as Record<string, string> | undefined) || {}).Authorization || '';
      calls.push(auth);
      if (calls.length === 1) return new Response(JSON.stringify({ code: 'PGRST303', message: 'JWT expired' }), { status: 401 });
      return new Response(JSON.stringify([{ id: 'row-1' }]), { status: 200 });
    }));

    const adapter = new SupabaseAdapter('https://x.supabase.co', 'anon');
    adapter.setAccessToken('stale-token');
    const rows = await adapter.list<{ id: string }>('products');
    expect(rows).toEqual([{ id: 'row-1' }]);
    expect(calls).toEqual(['Bearer stale-token', 'Bearer fresh-token-2']);
    // Forced refresh was requested — the clock alone would have skipped it.
    expect(getSession).toHaveBeenCalledWith(true);
  });

  it('does NOT refresh when the response is not an auth failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: 'ok' }]), { status: 200, headers: { 'content-type': 'application/json' } })));
    const adapter = new SupabaseAdapter('https://x.supabase.co', 'anon');
    adapter.setAccessToken('stale-token');
    await adapter.list('products');
    expect(getSession).not.toHaveBeenCalled();
  });

  it('keeps the failure behavior when NO token is set (anon request 401 surfaces the error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('denied', { status: 401 })));
    const adapter = new SupabaseAdapter('https://x.supabase.co', 'anon');
    await expect(adapter.list('products')).rejects.toThrow(/401/);
    expect(getSession).not.toHaveBeenCalled();
  });

  it('testConnection is a pure anon probe — never sends an (expired) user token', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      seen.push(((init?.headers as Record<string, string> | undefined) || {}).Authorization || '');
      return new Response('[]', { status: 200 });
    }));
    const adapter = new SupabaseAdapter('https://x.supabase.co', 'anon');
    adapter.setAccessToken('stale-token');
    const res = await adapter.testConnection();
    expect(res.ok).toBe(true);
    expect(seen).toEqual(['']);
  });
});
