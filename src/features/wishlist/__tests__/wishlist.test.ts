// Contract for the storefront wishlist store.
//   * The saved list persists to localStorage under WISHLIST_STORAGE_KEY and
//     survives a reset (reload).
//   * Toggling records add_to_wishlist / remove_from_wishlist through
//     trackEvent (which fans out to site_events + GA4) — the events the admin
//     "Saved" column aggregates.
//   * Adding an already-saved id never duplicates it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../lib/marketing', () => ({
  trackEvent: vi.fn(),
  utmParams: () => ({}),
}));

import { trackEvent } from '../../../lib/marketing';
import { __setSupabaseConfigForTests } from '../../../services/supabase';
import {
  WISHLIST_STORAGE_KEY,
  toggleWishlist,
  clearWishlist,
  configureWishlistAccount,
  __resetWishlistForTests,
} from '../wishlist';

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

let storage: Storage;

beforeEach(() => {
  storage = memoryStorage();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', { addEventListener: vi.fn() });
  __setSupabaseConfigForTests({ url: 'https://project.supabase.co', anonKey: 'anon-key-123' });
  vi.mocked(trackEvent).mockClear();
  __resetWishlistForTests();
});

afterEach(() => {
  __setSupabaseConfigForTests(undefined);
  vi.unstubAllGlobals();
});

const dogBow = { id: 'p1', name: 'Dog Bow', price: 19.99 };
const catTunnel = { id: 'p2', name: 'Cat Tunnel', price: 24.95 };

function persistedIds(): string[] {
  const raw = storage.getItem(WISHLIST_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

describe('toggleWishlist', () => {
  it('saves an id, persists it, and records add_to_wishlist with the item', () => {
    toggleWishlist(dogBow, true);

    expect(persistedIds()).toEqual(['p1']);
    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledWith('add_to_wishlist', expect.objectContaining({
      currency: 'USD',
      value: 19.99,
      items: [{ item_id: 'p1', item_name: 'Dog Bow', price: 19.99, quantity: 1 }],
    }));
  });

  it('removes an id and records remove_from_wishlist', () => {
    toggleWishlist(dogBow, true);
    toggleWishlist(dogBow, false);

    expect(persistedIds()).toEqual([]);
    expect(trackEvent).toHaveBeenLastCalledWith('remove_from_wishlist', expect.objectContaining({
      items: [expect.objectContaining({ item_id: 'p1' })],
    }));
  });

  it('never duplicates an id that is already saved', () => {
    toggleWishlist(dogBow, true);
    toggleWishlist(dogBow, true);
    toggleWishlist(catTunnel, true);

    expect(persistedIds()).toEqual(['p1', 'p2']);
    expect(trackEvent).toHaveBeenCalledTimes(2); // duplicate add is a no-op — no noise event
  });

  it('saving one product leaves another saved product untouched', () => {
    toggleWishlist(dogBow, true);
    toggleWishlist(catTunnel, true);
    toggleWishlist(dogBow, false);

    expect(persistedIds()).toEqual(['p2']);
  });
});

describe('persistence', () => {
  it('rehydrates the saved list from localStorage on reset (simulated reload)', () => {
    toggleWishlist(dogBow, true);
    toggleWishlist(catTunnel, true);
    expect(persistedIds()).toEqual(['p1', 'p2']);

    // Simulate a fresh page load: storage is intact, in-memory state is reset.
    __resetWishlistForTests();
    toggleWishlist(catTunnel, false);
    expect(persistedIds()).toEqual(['p1']);
  });

  it('ignores corrupted storage values instead of crashing', () => {
    storage.setItem(WISHLIST_STORAGE_KEY, '{not json');
    __resetWishlistForTests();
    toggleWishlist(dogBow, true);
    expect(persistedIds()).toEqual(['p1']);
  });
});

describe('clearWishlist', () => {
  it('empties the list and storage', () => {
    toggleWishlist(dogBow, true);
    toggleWishlist(catTunnel, true);
    clearWishlist();
    expect(persistedIds()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Account-backed persistence (signed-in shoppers, wishlist_items table)
// ---------------------------------------------------------------------------

const ACC = { userId: 'user-abc', token: 'jwt-token' };
const REQ: { method?: string; url?: string; body?: string }[] = [];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** REST-style fetch mock for wishlist_items, recording every request. */
function stubWishlistFetch(serverRows: string[]) {
  REQ.length = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method || 'GET').toUpperCase();
    REQ.push({ method, url, body: init?.body ? String(init.body) : undefined });
    if (method === 'GET') return jsonResponse(serverRows.map((product_id) => ({ product_id })));
    if (method === 'POST') return jsonResponse({ id: 'row-' + Math.random() }, 201);
    if (method === 'DELETE') return jsonResponse({}, 204);
    return jsonResponse({}, 405);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function settle(): Promise<void> {
  // Let the fire-and-forget hydrate/write promises finish.
  await new Promise((r) => setTimeout(r, 0));
}

const ACCOUNT_URL = 'https://project.supabase.co/rest/v1/wishlist_items';

describe('account-backed wishlist', () => {
  it('hydrates from the account and merges the device list once, then clears local', async () => {
    toggleWishlist(dogBow, true); // device-local save while signed out
    expect(persistedIds()).toEqual(['p1']);

    const fetchMock = stubWishlistFetch([]);
    configureWishlistAccount(ACC);
    await settle();

    // Merged device list was written to the account.
    const post = REQ.find((r) => r.method === 'POST');
    expect(post).toBeTruthy();
    expect(post!.url!.startsWith(ACCOUNT_URL)).toBe(true);
    expect(JSON.parse(post!.body || '{}')).toEqual({ user_id: 'user-abc', product_id: 'p1' });
    // Device copy cleared after merge — no cross-account leakage on shared devices.
    expect(persistedIds()).toEqual([]);
    // UI state reflects the account list.
    expect(fetchMock).toHaveBeenCalled();
  });

  it('union-merges account rows with the device list', async () => {
    toggleWishlist(dogBow, true); // p1 on device
    stubWishlistFetch(['p2']); // account already has p2
    configureWishlistAccount(ACC);
    await settle();

    const posted = REQ.filter((r) => r.method === 'POST').map((r) => JSON.parse(r.body || '').product_id);
    expect(posted).toEqual(['p1']); // only the missing one is written
    expect(persistedIds()).toEqual([]); // device cleared after merge
  });

  it('toggles write through to the account and still record the analytics event', async () => {
    stubWishlistFetch([]);
    configureWishlistAccount(ACC);
    await settle();

    toggleWishlist(dogBow, true);
    await settle();
    expect(REQ.some((r) => r.method === 'POST' && JSON.parse(r.body || '').product_id === 'p1')).toBe(true);
    expect(trackEvent).toHaveBeenLastCalledWith('add_to_wishlist', expect.objectContaining({
      items: [expect.objectContaining({ item_id: 'p1' })],
    }));

    toggleWishlist(dogBow, false);
    await settle();
    expect(REQ.some((r) => r.method === 'DELETE' && String(r.url || '').includes('product_id=eq.p1'))).toBe(true);
    expect(trackEvent).toHaveBeenLastCalledWith('remove_from_wishlist', expect.objectContaining({
      items: [expect.objectContaining({ item_id: 'p1' })],
    }));
  });

  it('falls back to the device list on logout and persists there again', async () => {
    stubWishlistFetch(['p1']);
    configureWishlistAccount(ACC);
    await settle();

    configureWishlistAccount(null); // logout
    expect(persistedIds()).toEqual([]); // device list was cleared after merge
    toggleWishlist(catTunnel, true);
    expect(persistedIds()).toEqual(['p2']); // device-local again while signed out
  });

  it('never writes while a duplicate save is a no-op', async () => {
    stubWishlistFetch(['p1']);
    configureWishlistAccount(ACC);
    await settle();

    const postsBefore = REQ.filter((r) => r.method === 'POST').length;
    toggleWishlist(dogBow, true); // already saved on the account — no-op
    await settle();
    expect(REQ.filter((r) => r.method === 'POST').length).toBe(postsBefore);
    expect(trackEvent).not.toHaveBeenCalled();
  });
});