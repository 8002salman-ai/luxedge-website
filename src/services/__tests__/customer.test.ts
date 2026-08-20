import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ensureCustomerProfile } from '../customer';
import { resetDbForTests, __setDbConfigForTests } from '../db';

const URL = 'https://project.supabase.co';
const ANON = 'anon-key-123';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => Array.from(map.keys())[i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  };
}

// ensureCustomerProfile reads the session token from localStorage via
// getAccessToken() — seed a minimal stored session first.
function seedSession(token = 'user-jwt-token'): void {
  const w = window as unknown as { localStorage: Storage };
  w.localStorage.setItem('luxedge_sb_session', JSON.stringify({
    accessToken: token,
    refreshToken: 'refresh',
    expiresAt: Date.now() + 3600_000,
    user: { id: 'u1', email: 'buyer@luxedge.us', name: 'Buyer' },
  }));
}

describe('ensureCustomerProfile', () => {
  beforeEach(() => {
    resetDbForTests();
    __setDbConfigForTests({ url: URL, anonKey: ANON });
    vi.stubGlobal('window', { localStorage: memoryStorage() });
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    __setDbConfigForTests(undefined);
    resetDbForTests();
    vi.unstubAllGlobals();
  });

  it('returns not-configured when Supabase env vars are absent', async () => {
    __setDbConfigForTests(null);
    const r = await ensureCustomerProfile({ id: 'u1', email: 'x@luxedge.us', name: 'X' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not-configured');
  });

  it('returns no-session when no access token exists', async () => {
    const r = await ensureCustomerProfile({ id: 'u1', email: 'x@luxedge.us', name: 'X' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no-session');
  });

  it('creates a customers row using the user JWT (no role field sent)', async () => {
    seedSession();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      calls.push({ url, init: init || {} });
      const u = String(url);
      if (u.includes('/customers?auth_user_id')) return Promise.resolve(jsonResponse([]));
      if (u.includes('/customers')) return Promise.resolve(jsonResponse([{ id: 'c1', auth_user_id: 'u1' }], 201));
      return Promise.resolve(jsonResponse([]));
    }));

    const r = await ensureCustomerProfile({ id: 'u1', email: 'buyer@luxedge.us', name: 'Buyer' });
    expect(r.ok).toBe(true);
    expect(r.reason).toBe('created');

    const insert = calls.find((c) => String(c.url).includes('/customers') && c.init.method === 'POST');
    expect(insert).toBeTruthy();
    const body = JSON.parse(String(insert!.init.body));
    expect(body.auth_user_id).toBe('u1');
    expect(body.email).toBe('buyer@luxedge.us');
    expect(body).not.toHaveProperty('role'); // role is never client-supplied
    const authHeader = (insert!.init.headers as Record<string, string>).Authorization;
    expect(authHeader).toContain('user-jwt-token');
  });

  it('treats an existing row as success without inserting again', async () => {
    seedSession();
    const postCalls: string[] = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/customers?auth_user_id')) {
        return Promise.resolve(jsonResponse([{ id: 'c1', auth_user_id: 'u1' }]));
      }
      if (init?.method === 'POST') postCalls.push(u);
      return Promise.resolve(jsonResponse([]));
    }));

    const r = await ensureCustomerProfile({ id: 'u1', email: 'buyer@luxedge.us', name: 'Buyer' });
    expect(r.ok).toBe(true);
    expect(r.reason).toBe('exists');
    expect(postCalls.length).toBe(0);
  });

  it('reports not-provisioned honestly when the customers table is missing', async () => {
    seedSession();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ code: 'PGRST205', message: 'Could not find the table public.customers' }, 404),
    ));
    const r = await ensureCustomerProfile({ id: 'u1', email: 'buyer@luxedge.us', name: 'Buyer' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not-provisioned');
  });

  it('treats a unique-constraint race as success (duplicate auth_user_id)', async () => {
    seedSession();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ code: '23505', message: 'duplicate key value violates unique constraint customers_auth_user_id_key' }, 409),
    ));
    const r = await ensureCustomerProfile({ id: 'u1', email: 'buyer@luxedge.us', name: 'Buyer' });
    expect(r.ok).toBe(true);
    expect(r.reason).toBe('exists');
  });
});
