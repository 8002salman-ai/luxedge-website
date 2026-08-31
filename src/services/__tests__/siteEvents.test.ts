// Regression contract for the first-party site-events recorder + admin reader.
// Guards the concrete defects fixed:
//   * fetchSiteEvents must keep the NEWEST events (order=desc) so the 50k cap
//     never truncates to stale data at scale.
//   * Unconfigured Supabase throws an honest error instead of a silent [] that
//     renders as "No traffic recorded yet".
//   * Admin paths are never recorded; item_ids are extracted from items[].
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { recordSiteEvent, fetchSiteEvents, __resetSiteEventsForTests } from '../siteEvents';
import { __setSupabaseConfigForTests } from '../supabase';

const URL = 'https://project.supabase.co';
const ANON = 'anon-key-123';

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function stubBrowserGlobals(pathname = '/product/dog-bow') {
  const storage = memoryStorage();
  vi.stubGlobal('window', {
    location: { pathname, search: '', href: `http://localhost${pathname}` },
    localStorage: storage,
    sessionStorage: storage,
  });
  vi.stubGlobal('document', { referrer: 'https://google.com/' });
  vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' });
}

beforeEach(() => {
  __setSupabaseConfigForTests({ url: URL, anonKey: ANON });
  __resetSiteEventsForTests();
});
afterEach(() => {
  __setSupabaseConfigForTests(undefined);
  vi.unstubAllGlobals();
});

describe('recordSiteEvent', () => {
  it('posts the event with the anon key and extracts item_ids from items[]', () => {
    stubBrowserGlobals();
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    recordSiteEvent('add_to_cart', {
      value: 20,
      currency: 'USD',
      items: [{ item_id: 'p1', item_name: 'Dog Bow', price: 20, quantity: 1 }],
      campaign_source: 'google',
      campaign_medium: 'cpc',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${URL}/rest/v1/site_events`);
    const headers = init.headers as Record<string, string>;
    expect(headers.apikey).toBe(ANON);
    expect(headers.Authorization).toBe(`Bearer ${ANON}`);

    const body = JSON.parse(String(init.body));
    expect(body.event).toBe('add_to_cart');
    expect(body.path).toBe('/product/dog-bow');
    expect(body.item_ids).toEqual(['p1']);
    expect(body.value).toBe(20);
    expect(body.currency).toBe('USD');
    expect(body.device).toBe('mobile');
    expect(body.referrer).toBe('https://google.com/');
    expect(body.utm_source).toBe('google');
    expect(body.utm_medium).toBe('cpc');
    expect(body.visitor_id).toBeTruthy();
    expect(body.session_id).toBeTruthy();
  });

  it('omits value/currency when absent (non-commerce events)', () => {
    stubBrowserGlobals();
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    recordSiteEvent('page_view', { page_location: 'http://localhost/' });

    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.value).toBeUndefined();
    expect(body.currency).toBeUndefined();
  });

  it('falls back to the base insert when revenue columns are missing (42703)', async () => {
    stubBrowserGlobals();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: '42703', message: 'column site_events.value does not exist' }), { status: 400 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    recordSiteEvent('purchase', { value: 99, currency: 'USD' });
    await new Promise((r) => setTimeout(r, 20));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [u1, i1] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [u2, i2] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(String(i1.body)).value).toBe(99);
    const retryBody = JSON.parse(String(i2.body));
    expect(retryBody.value).toBeUndefined();
    expect(retryBody.currency).toBeUndefined();
    expect(retryBody.event).toBe('purchase'); // event still recorded
    expect(u2).toBe(u1);
  });

  it('never records admin paths', () => {
    stubBrowserGlobals('/admin/blogs');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    recordSiteEvent('page_view', {});

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('normalizes a missing/empty items array to null item_ids', () => {
    stubBrowserGlobals();
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    recordSiteEvent('search', { search_term: 'horse' });

    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.item_ids).toBeNull();
  });

  it('swallows fetch failures (fire-and-forget, never breaks the storefront)', () => {
    stubBrowserGlobals();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    expect(() => recordSiteEvent('page_view', {})).not.toThrow();
  });
});

describe('fetchSiteEvents', () => {
  function stubAdminSession() {
    // A far-future expiry means getSession() returns it without a refresh call.
    vi.stubGlobal('window', {
      localStorage: (() => {
        const s = memoryStorage();
        s.setItem('luxedge_sb_session', JSON.stringify({
          accessToken: 'admin-token',
          refreshToken: 'refresh-token',
          expiresAt: Date.now() + 86_400_000,
          user: { id: 'u1', email: 'admin@luxedge.us', name: 'Admin', role: 'admin' },
        }));
        return s;
      })(),
    });
  }

  it('requests the newest events first (order=desc) with the 50k cap, including revenue fields', async () => {
    stubAdminSession();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await fetchSiteEvents(30);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('order=occurred_at.desc');
    expect(url).toContain('limit=50000');
    expect(url).toContain('occurred_at=gte.');
    expect(url).toContain('value');
    expect(url).toContain('currency');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer admin-token');
  });

  it.each([
    ['PGRST204', { code: 'PGRST204', message: "Could not find the 'value' column of 'site_events' in the schema cache" }],
    ['42703', { code: '42703', message: 'column site_events.value does not exist' }],
  ])('falls back to the base select when 0024 is not applied (%s)', async (_shape, errBody) => {
    stubAdminSession();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(errBody), { status: 400 }))
      .mockResolvedValueOnce(jsonResponse([{ event: 'page_view', path: '/', value: null, currency: null }]));
    vi.stubGlobal('fetch', fetchMock);

    const rows = await fetchSiteEvents(30);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [u2] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(u2).not.toContain('value');
    expect(u2).not.toContain('currency');
    expect(rows[0].value).toBeNull();
  });

  it('throws an honest error when Supabase is unconfigured instead of returning []', async () => {
    __setSupabaseConfigForTests(null);
    stubAdminSession();
    vi.stubGlobal('fetch', vi.fn());

    await expect(fetchSiteEvents(30)).rejects.toThrow('not configured');
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('maps the missing-table 404 to the run-migration message', async () => {
    stubAdminSession();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not found', { status: 404 })));

    await expect(fetchSiteEvents(30)).rejects.toThrow('run migration 0023');
  });

  it('maps 401/403 to the sign-in message', async () => {
    stubAdminSession();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('denied', { status: 403 })));

    await expect(fetchSiteEvents(30)).rejects.toThrow('Sign in as admin');
  });
});
