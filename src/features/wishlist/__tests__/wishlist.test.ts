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
import {
  WISHLIST_STORAGE_KEY,
  toggleWishlist,
  clearWishlist,
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
  vi.mocked(trackEvent).mockClear();
  __resetWishlistForTests();
});

afterEach(() => {
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