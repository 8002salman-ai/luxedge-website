// ============================================================================
// LUXEDGE — /api/adsense ROUTE TESTS
//
// Verifies the server-side AdSense earnings integration:
//   * admin auth is required on every data route (401 without token)
//   * the OAuth auth-url flow builds a Google consent URL with state
//   * the callback validates state and stores the refresh token server-side
//   * sync calls the real AdSense Management API v2 and parses totals
//   * earnings returns cached data without hitting Google per render
//   * failure states are honest (not-connected / reconnect / unavailable)
//   * NO secret (client secret / refresh token / access token) is ever
//     returned in any response body
// ============================================================================
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import handler, { __resetAdsenseForTests } from '../adsense/index.js';

const SUPABASE_URL = 'https://test-project.supabase.co';
const ANON = 'anon-key';
const SR = 'service-role-key';
const CLIENT_ID = 'client-id-123.apps.googleusercontent.com';
const CLIENT_SECRET = 'client-secret-xyz';
const REFRESH = 'refresh-token-abc';
const ACCESS = 'access-token-123';

const original: Record<string, string | undefined> = {
  url: process.env.VITE_SUPABASE_URL,
  anon: process.env.VITE_SUPABASE_ANON_KEY,
  sr: process.env.SUPABASE_SERVICE_ROLE_KEY,
  clientId: process.env.GOOGLE_ADSENSE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_ADSENSE_CLIENT_SECRET,
  redirect: process.env.ADSENSE_REDIRECT_URI,
};

/** Supabase app_settings fetch shim driven by an in-memory map. */
function makeSupabaseShim(store: Map<string, string>) {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/rest/v1/app_settings')) {
      const hasPost = init?.method === 'POST';
      const hasDelete = init?.method === 'DELETE';
      if (hasPost) {
        const body = JSON.parse(String(init?.body)) as { key: string; value: string };
        store.set(body.key, body.value);
        return new Response('{}', { status: 201, headers: { 'Content-Type': 'application/json' } });
      }
      if (hasDelete) {
        const keyMatch = /key=eq\.([^&]+)/.exec(url);
        if (keyMatch) store.delete(decodeURIComponent(keyMatch[1]));
        return new Response('', { status: 204 });
      }
      const keyMatch = /key=eq\.([^&]+)/.exec(url);
      const value = keyMatch ? store.get(decodeURIComponent(keyMatch[1])) : null;
      return new Response(JSON.stringify(value != null ? [{ value }] : []), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  });
}

function reportResult() {
  return {
    headers: [
      { name: 'DATE', type: 'DIMENSION' },
      { name: 'ESTIMATED_EARNINGS', type: 'METRIC_CURRENCY', currencyCode: 'USD' },
      { name: 'PAGE_VIEWS', type: 'METRIC_TALLY' },
      { name: 'IMPRESSIONS', type: 'METRIC_TALLY' },
      { name: 'CLICKS', type: 'METRIC_TALLY' },
      { name: 'PAGE_RPM', type: 'METRIC_CURRENCY', currencyCode: 'USD' },
      { name: 'IMPRESSION_RPM', type: 'METRIC_CURRENCY', currencyCode: 'USD' },
    ],
    totals: { cells: [{ value: '' }, { value: '1.25' }, { value: '120' }, { value: '98' }, { value: '3' }, { value: '10.42' }, { value: '12.76' }] },
    rows: [],
  };
}

function makeReq(method: string, url: string, token?: string, bodyStr = ''): IncomingMessage {
  // EventEmitter-based stream shim matching how the Worker builds the request:
  // the body is delivered lazily once a 'data'/'end' listener attaches, so an
  // awaited requireAdmin() before readJsonBody() never races the body events.
  const req: any = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = token ? { authorization: `Bearer ${token}` } : {};
  req.socket = { remoteAddress: '127.0.0.1' };
  const buf = Buffer.from(bodyStr);
  let emitted = false;
  const origOn = req.on.bind(req);
  req.on = (event: string, fn: (...args: unknown[]) => void) => {
    const result = origOn(event, fn);
    if ((event === 'data' || event === 'end') && !emitted) {
      emitted = true;
      if (buf.length > 0) req.emit('data', buf);
      queueMicrotask(() => req.emit('end'));
    }
    return result;
  };
  return req as IncomingMessage;
}

/** Capture sendJson output via the res shim the worker uses. */
function makeRes() {
  let status = 200;
  let body = '';
  const headers: Record<string, string> = {};
  const res: any = {
    writeHead: (s: number, h?: Record<string, string>) => {
      status = s;
      if (h) {
        for (const [k, v] of Object.entries(h)) headers[String(k).toLowerCase()] = String(v);
      }
    },
    setHeader: (k: string, v: string) => { headers[String(k).toLowerCase()] = String(v); },
    write: (c: string) => { body += c; },
    end: (c?: string) => { if (c !== undefined) body += c; },
  };
  Object.defineProperty(res, 'statusCode', { get: () => status, set: (v: number) => { status = v; } });
  return { res: res as ServerResponse, status: () => status, body: () => JSON.parse(body || 'null'), headers: () => headers };
}

function makeEnv(store: Map<string, string>, token: string) {
  process.env.VITE_SUPABASE_URL = SUPABASE_URL;
  process.env.VITE_SUPABASE_ANON_KEY = ANON;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SR;
  process.env.GOOGLE_ADSENSE_CLIENT_ID = CLIENT_ID;
  process.env.GOOGLE_ADSENSE_CLIENT_SECRET = CLIENT_SECRET;
  process.env.ADSENSE_REDIRECT_URI = 'https://luxedge.us/api/adsense/oauth/callback';
  const fetchMock = makeSupabaseShim(store);
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, token };
}

beforeEach(() => {
  process.env.VITE_SUPABASE_URL = SUPABASE_URL;
  process.env.VITE_SUPABASE_ANON_KEY = ANON;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SR;
  process.env.GOOGLE_ADSENSE_CLIENT_ID = CLIENT_ID;
  process.env.GOOGLE_ADSENSE_CLIENT_SECRET = CLIENT_SECRET;
});
afterEach(() => {
  __resetAdsenseForTests();
  Object.assign(process.env, {
    VITE_SUPABASE_URL: original.url ?? '',
    VITE_SUPABASE_ANON_KEY: original.anon ?? '',
    SUPABASE_SERVICE_ROLE_KEY: original.sr ?? '',
    GOOGLE_ADSENSE_CLIENT_ID: original.clientId ?? '',
    GOOGLE_ADSENSE_CLIENT_SECRET: original.clientSecret ?? '',
    ADSENSE_REDIRECT_URI: original.redirect ?? '',
  });
  vi.unstubAllGlobals();
});

// Supabase returns 401 for an invalid/absent JWT when SUPABASE_JWT_SECRET is
// unset (remote verify path). Simulate that.
function anonJwtResponse() {
  return new Response(JSON.stringify({ msg: 'Invalid token' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
}

describe('/api/adsense — auth', () => {
  it('rejects every data route without a valid admin token', async () => {
    for (const [method, path] of [['GET', '/api/adsense/status'], ['GET', '/api/adsense/earnings'], ['GET', '/api/adsense/auth-url'], ['POST', '/api/adsense/sync']] as const) {
      const { res, status } = makeRes();
      const store = new Map<string, string>();
      const { fetchMock } = makeEnv(store, '');
      fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
        if (String(input).includes('/auth/v1/user')) return anonJwtResponse();
        return makeSupabaseShim(store)(input, init);
      });
      await handler(makeReq(method, path), res);
      expect(status()).toBe(401);
    }
  });
});

describe('/api/adsense/auth-url', () => {
  it('returns a Google consent URL with client id, redirect, scope and state', async () => {
    const store = new Map<string, string>();
    const { fetchMock } = makeEnv(store, 'admin-token');
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      if (String(input).includes('/auth/v1/user')) {
        return new Response(JSON.stringify({ id: 'u1', email: 'admin@luxedge.us', app_metadata: { role: 'admin' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return makeSupabaseShim(store)(input, init);
    });

    const { res, status, body } = makeRes();
    await handler(makeReq('GET', '/api/adsense/auth-url', 'admin-token'), res);

    expect(status()).toBe(200);
    const url = new URL(body().authUrl as string);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe('https://luxedge.us/api/adsense/oauth/callback');
    expect(url.searchParams.get('scope')).toContain('adsense.readonly');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('state')).toBeTruthy();
    // State is stored server-side for callback verification.
    expect(store.get('ADSENSE_OAUTH_STATE')).toBe(url.searchParams.get('state'));
    // No secret in the response.
    expect(JSON.stringify(body())).not.toContain(CLIENT_SECRET);
  });

  it('fails closed with 503 when the OAuth client is not configured', async () => {
    const store = new Map<string, string>();
    const { fetchMock } = makeEnv(store, 'admin-token');
    delete process.env.GOOGLE_ADSENSE_CLIENT_ID;
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      if (String(input).includes('/auth/v1/user')) {
        return new Response(JSON.stringify({ id: 'u1', app_metadata: { role: 'admin' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return makeSupabaseShim(store)(input, init);
    });

    const { res, status } = makeRes();
    await handler(makeReq('GET', '/api/adsense/auth-url', 'admin-token'), res);
    expect(status()).toBe(503);
  });
});

describe('/api/adsense/oauth/callback', () => {
  it('exchanges the code, stores the refresh token server-side and redirects to admin', async () => {
    const store = new Map<string, string>([['ADSENSE_OAUTH_STATE', 'state-123']]);
    const { fetchMock } = makeEnv(store, '');
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({ refresh_token: REFRESH, access_token: ACCESS, expires_in: 3600 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return makeSupabaseShim(store)(input, init);
    });

    const { res, status, headers } = makeRes();
    await handler(makeReq('GET', '/api/adsense/oauth/callback?code=the-code&state=state-123'), res);

    expect(status()).toBe(302);
    expect(String(headers().location || '')).toContain('admin/marketing-traffic?adsense=connected');
    expect(store.get('ADSENSE_REFRESH_TOKEN')).toBe(REFRESH);
    expect(store.has('ADSENSE_OAUTH_STATE')).toBe(false);
    // Secrets never in the redirect location or body.
    expect(String(headers().location || '')).not.toContain(CLIENT_SECRET);
    expect(String(headers().location || '')).not.toContain(REFRESH);
  });

  it('rejects a mismatched state nonce', async () => {
    const store = new Map<string, string>([['ADSENSE_OAUTH_STATE', 'state-123']]);
    const { fetchMock } = makeEnv(store, '');
    fetchMock.mockImplementation(makeSupabaseShim(store));

    const { res, status, headers } = makeRes();
    await handler(makeReq('GET', '/api/adsense/oauth/callback?code=the-code&state=WRONG'), res);

    expect(status()).toBe(302);
    expect(String(headers().location || '')).toContain('reason=state');
    expect(store.has('ADSENSE_REFRESH_TOKEN')).toBe(false);
    expect(String(headers().location || '')).not.toContain(CLIENT_SECRET);
  });
});

describe('/api/adsense/sync', () => {
  function googleMocks(fetchMock: ReturnType<typeof vi.fn>, store: Map<string, string>) {
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/auth/v1/user')) {
        return new Response(JSON.stringify({ id: 'u1', app_metadata: { role: 'admin' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({ access_token: ACCESS, expires_in: 3600 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/rest/v1/app_settings')) {
        return makeSupabaseShim(store)(input, init);
      }
      if (url.includes('adsense.googleapis.com/v2/accounts?') || url === 'https://adsense.googleapis.com/v2/accounts') {
        return new Response(JSON.stringify({ accounts: [{ name: 'accounts/pub-5473713135927706' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('reports:generate')) {
        return new Response(JSON.stringify(reportResult()), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('not found', { status: 404 });
    });
  }

  it('syncs real AdSense totals and caches them with a timestamp', async () => {
    const store = new Map<string, string>([[ 'ADSENSE_REFRESH_TOKEN', REFRESH ]]);
    const { fetchMock } = makeEnv(store, 'admin-token');
    googleMocks(fetchMock, store);

    const { res, status, body } = makeRes();
    await handler(makeReq('POST', '/api/adsense/sync', 'admin-token', '{}'), res);

    expect(status()).toBe(200);
    const data = body().data;
    expect(data.currency).toBe('USD');
    expect(data.ranges.today.earnings).toBe(1.25);
    expect(data.ranges.today.pageViews).toBe(120);
    expect(data.ranges.today.impressions).toBe(98);
    expect(data.ranges.today.clicks).toBe(3);
    expect(data.ranges.today.pageRpm).toBe(10.42);
    expect(data.ranges.today.impressionRpm).toBe(12.76);
    expect(data.syncedAt).toBeTruthy();
    // Cached for the dashboard read.
    const cached = JSON.parse(store.get('ADSENSE_EARNINGS_CACHE') || 'null');
    expect(cached.ranges.today.earnings).toBe(1.25);
    // No secrets in the response.
    expect(JSON.stringify(body())).not.toContain(CLIENT_SECRET);
    expect(JSON.stringify(body())).not.toContain(REFRESH);
    expect(JSON.stringify(body())).not.toContain(ACCESS);
  });

  it('reports not-connected honestly when no refresh token is stored', async () => {
    const store = new Map<string, string>();
    const { fetchMock } = makeEnv(store, 'admin-token');
    googleMocks(fetchMock, store);

    const { res, status, body } = makeRes();
    await handler(makeReq('POST', '/api/adsense/sync', 'admin-token', '{}'), res);

    expect(status()).toBe(200);
    expect(body().connected).toBe(false);
    expect(body().error).toBe('not-connected');
  });

  it('reports reconnect when Google rejects the refresh token', async () => {
    const store = new Map<string, string>([[ 'ADSENSE_REFRESH_TOKEN', 'revoked' ]]);
    const { fetchMock } = makeEnv(store, 'admin-token');
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/auth/v1/user')) {
        return new Response(JSON.stringify({ id: 'u1', app_metadata: { role: 'admin' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      return makeSupabaseShim(store)(input, init);
    });

    const { res, status, body } = makeRes();
    await handler(makeReq('POST', '/api/adsense/sync', 'admin-token', '{}'), res);

    expect(status()).toBe(200);
    expect(body().error).toBe('reconnect');
  });
});

describe('/api/adsense/earnings', () => {
  it('serves cached data without calling Google', async () => {
    const cache = JSON.stringify({
      syncedAt: new Date().toISOString(),
      currency: 'USD',
      ranges: { today: { earnings: 0.5, pageViews: 10, impressions: 8, clicks: 1, pageRpm: 50, impressionRpm: 62.5 }, yesterday: {}, last7: {}, thisMonth: {}, prevMonth: {} },
    });
    const store = new Map<string, string>([['ADSENSE_REFRESH_TOKEN', REFRESH], ['ADSENSE_EARNINGS_CACHE', cache]]);
    const { fetchMock } = makeEnv(store, 'admin-token');
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      if (String(input).includes('/auth/v1/user')) {
        return new Response(JSON.stringify({ id: 'u1', app_metadata: { role: 'admin' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return makeSupabaseShim(store)(input, init);
    });

    const { res, status, body } = makeRes();
    await handler(makeReq('GET', '/api/adsense/earnings', 'admin-token'), res);

    expect(status()).toBe(200);
    expect(body().connected).toBe(true);
    expect(body().data.ranges.today.earnings).toBe(0.5);
    // No Google API call was made.
    const calls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes('adsense.googleapis.com'))).toBe(false);
  });

  it('returns connected:false when not connected instead of faking a number', async () => {
    const store = new Map<string, string>();
    const { fetchMock } = makeEnv(store, 'admin-token');
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      if (String(input).includes('/auth/v1/user')) {
        return new Response(JSON.stringify({ id: 'u1', app_metadata: { role: 'admin' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return makeSupabaseShim(store)(input, init);
    });

    const { res, status, body } = makeRes();
    await handler(makeReq('GET', '/api/adsense/earnings', 'admin-token'), res);

    expect(status()).toBe(200);
    expect(body().connected).toBe(false);
    expect(body().data).toBeNull();
  });
});
