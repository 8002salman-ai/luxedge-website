// ============================================================================
// LUXEDGE — WISHLIST / FAVORITES
//
// A real, persisted "save for later" list for the storefront. There is NO
// wishlist table in Supabase (deliberately): the visitor's list lives in
// localStorage (device-local, no account required), and every toggle is
// recorded into the existing first-party `site_events` infrastructure
// (migration 0023) as `add_to_wishlist` / `remove_from_wishlist`. That is
// what the admin Catalog "Saved" counts read from (api/admin/product-stats.ts)
// — genuine saved-item numbers derived from real events, never fabricated.
//
// GA4 receives the same events via trackEvent (`add_to_wishlist` is a
// standard GA4 ecommerce event), so nothing here needs Google-specific wiring.
// ============================================================================

import { useCallback, useSyncExternalStore } from 'react';
import { Heart } from '@untitledui/icons';
import { trackEvent, utmParams } from '../../lib/marketing';

export const WISHLIST_STORAGE_KEY = 'luxedge_wishlist';

/** The minimal product shape the wishlist needs — pass a storefront Product. */
export interface WishlistTarget {
  id: string;
  name: string;
  price: number;
}

// Module-level store: the id list + a subscriber set. Persisted to
// localStorage so the list survives reloads; `storage` events keep open tabs
// in sync with each other.
let ids: string[] = [];
const listeners = new Set<() => void>();

function read(): string[] {
  try {
    const raw = localStorage.getItem(WISHLIST_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string' && x.length > 0)
      : [];
  } catch {
    return [];
  }
}

function write(next: string[]): void {
  ids = next;
  try {
    localStorage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — keep the in-memory list for this session */
  }
  listeners.forEach((l) => l());
}

ids = read();

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === WISHLIST_STORAGE_KEY) {
      ids = read();
      listeners.forEach((l) => l());
    }
  });
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot(): string[] {
  return ids;
}

/**
 * Toggle a product in the wishlist and record the event first-party
 * (site_events) and to GA4 via trackEvent. `saved` is the NEW state.
 */
export function toggleWishlist(product: WishlistTarget, saved: boolean): void {
  const next = saved
    ? (ids.includes(product.id) ? ids : [...ids, product.id])
    : ids.filter((i) => i !== product.id);
  if (next === ids) return; // no state change — don't record a noise event
  write(next);
  trackEvent(saved ? 'add_to_wishlist' : 'remove_from_wishlist', {
    currency: 'USD',
    value: product.price,
    items: [{ item_id: product.id, item_name: product.name, price: product.price, quantity: 1 }],
    ...utmParams(),
  });
}

export function clearWishlist(): void {
  write([]);
}

/** Test-only hook: re-read storage and drop subscribers between tests. */
export function __resetWishlistForTests(): void {
  ids = read();
  listeners.clear();
}

export interface WishlistState {
  ids: string[];
  isSaved: (id: string) => boolean;
  toggle: (product: WishlistTarget, saved: boolean) => void;
  clear: () => void;
}

export function useWishlist(): WishlistState {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  const isSaved = useCallback((id: string) => snapshot.includes(id), [snapshot]);
  const toggle = useCallback((p: WishlistTarget, s: boolean) => toggleWishlist(p, s), []);
  const clear = useCallback(() => clearWishlist(), []);
  return { ids: snapshot, isSaved, toggle, clear };
}

/**
 * Heart toggle used on product cards and the product page. The caller owns
 * placement/background styling via `className`; the component handles the
 * saved state, aria labels, and event recording.
 */
export function WishlistButton({
  product,
  size = 16,
  notify,
  className = '',
}: {
  product: WishlistTarget;
  size?: number;
  notify?: (msg: string) => void;
  className?: string;
}) {
  const { ids: savedIds, toggle } = useWishlist();
  const saved = savedIds.includes(product.id);
  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={saved ? `Remove ${product.name} from wishlist` : `Save ${product.name} to wishlist`}
      title={saved ? 'Saved to wishlist' : 'Save to wishlist'}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(product, !saved);
        notify?.(saved ? 'Removed from wishlist' : 'Saved to wishlist');
      }}
      className={`flex items-center justify-center rounded-full transition-colors ${saved ? 'text-rose-500' : 'text-luxe-charcoal hover:text-rose-500'} ${className}`}
    >
      <Heart strokeWidth={1.5} size={size} fill={saved ? 'currentColor' : 'none'} aria-hidden="true" />
    </button>
  );
}