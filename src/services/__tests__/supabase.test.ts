import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  signInWithPassword,
  signUp,
  signOut,
  getSession,
  getSessionUser,
  getAccessToken,
  isSupabaseConfigured,
  __setSupabaseConfigForTests,
} from '../supabase';

const URL = 'https://project.supabase.co';
const ANON = 'anon-key-123';
const TEST_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';

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

function authResponseBody(overrides: Record<string, unknown> = {}) {
  return {
    access_token: 'access-token-abc',
    refresh_token: 'refresh-token-xyz',
    expires_in: 3600,
    token_type: 'bearer',
    user: {
      id: 'user-1',
      email: 'admin@luxedge.us',
      user_metadata: { name: 'Admin' },
      app_metadata: { role: 'admin' },
    },
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  __setSupabaseConfigForTests({ url: URL, anonKey: ANON });
  vi.stubGlobal('window', { localStorage: memoryStorage() });
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  __setSupabaseConfigForTests(undefined);
  vi.unstubAllGlobals();
});

describe('isSupabaseConfigured', () => {
  it('is false when env vars are absent', () => {
    __setSupabaseConfigForTests(null);
    expect(isSupabaseConfigured()).toBe(false);
  });
});

describe('signInWithPassword', () => {
  it('signs in, stores the session, and maps the admin role from app_metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(authResponseBody()));
    vi.stubGlobal('fetch', fetchMock);

    const session = await signInWithPassword('admin@luxedge.us', TEST_SECRET);

    expect(session.user.id).toBe('user-1');
    expect(session.user.role).toBe('admin');
    expect(session.user.name).toBe('Admin');
    expect(getSessionUser()?.role).toBe('admin');
    expect(getAccessToken()).toBe('access-token-abc');

    // The password must never be stored anywhere.
    const raw = (window as unknown as { localStorage: Storage }).localStorage.getItem('luxedge_sb_session') || '';
    expect(raw).toContain('access-token-abc');
    expect(raw).not.toContain(TEST_SECRET);
    expect(raw).not.toContain('password');

    // Request went to the token endpoint with grant_type=password.
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/auth/v1/token?grant_type=password');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ email: 'admin@luxedge.us', password: TEST_SECRET });
  });

  it('maps buyer role when app_metadata has no admin claim', async () => {
    const body = authResponseBody({
      user: { id: 'u2', email: 'buyer@luxedge.us', user_metadata: { name: 'Buyer' }, app_metadata: {} },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(body)));
    const session = await signInWithPassword('buyer@luxedge.us', TEST_SECRET);
    expect(session.user.role).toBe('buyer');
  });

  it('throws an honest error on wrong credentials', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ error: 'invalid_grant', error_description: 'Invalid login credentials' }, 400)
      )
    );
    await expect(signInWithPassword('a@b.c', 'wrong')).rejects.toThrow('Invalid login credentials');
  });

  it('throws a clear error when Supabase is not configured', async () => {
    __setSupabaseConfigForTests(null);
    await expect(signInWithPassword('a@b.c', 'x')).rejects.toThrow(/not configured/i);
  });
});

describe('signUp', () => {
  it('creates an account and returns the session user', async () => {
    const body = authResponseBody({ user: { id: 'u3', email: 'new@luxedge.us', user_metadata: { name: 'New' }, app_metadata: {} } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(body)));
    const { session } = await signUp('New', 'new@luxedge.us', TEST_SECRET);
    expect(session?.user.email).toBe('new@luxedge.us');
    expect(session?.user.role).toBe('buyer');
  });
});

describe('session lifecycle', () => {
  it('getSession returns null when no session is stored', async () => {
    expect(await getSession()).toBeNull();
  });

  it('signOut clears the stored session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(authResponseBody())));
    await signInWithPassword('admin@luxedge.us', TEST_SECRET);
    expect(getSessionUser()).not.toBeNull();
    await signOut();
    expect(getSessionUser()).toBeNull();
    expect(getAccessToken()).toBeNull();
    expect(await getSession()).toBeNull();
  });
});

describe('secret isolation', () => {
  it('never stores the plaintext password in localStorage after sign-in', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(authResponseBody())));
    await signInWithPassword('admin@luxedge.us', 'super-secret-password-123');
    const raw = (window as unknown as { localStorage: Storage }).localStorage.getItem('luxedge_sb_session') || '';
    expect(raw).not.toContain('super-secret-password-123');
    expect(raw).not.toContain(TEST_SECRET);
  });
});
