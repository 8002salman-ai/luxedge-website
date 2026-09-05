// ============================================================================
// LUXEDGE — WISHLIST / FAVORITES
//
// Two tiers, one store:
//   * signed OUT (or guest) — the list lives in localStorage (device-local,
//     no account required), exactly as before;
//   * signed IN — the list persists in Supabase `wishlist_items` (migration
//     0028, RLS-scoped to the user's own rows) so saved items follow the
//     shopper across devices. On first sign-in the device list is merged into
//     the account once, then the device copy is cleared so a shared device can
//     never leak one account's items into another's.
//
// ANALYTICS IS UNCHANGED: every toggle still records add_to_wishlist /
// remove_from_wishlist via trackEvent into `site_events` (+ GA4). The admin
// Saved counts (product-stats, Traffic dashboard) keep reading site_events —
// wishlist_items is persistence only and never read for analytics.
//
// GA4 receives the same events via trackEvent (`add_to_wishlist` is a
// standard GA4 ecommerce event), so nothing here needs Google-specific wiring.
// ============================================================================

import { useCallback, useSyncExternalStore } from 'react';
import { Heart } from '@untitledui/icons';
import { trackEvent, utmParams } from '../../lib/marketing';
import { getSupabaseConfig } from '../../services/supabase';

export const WISHLIST_STORAGE_KEY = 'luxedge_wishlist';

/** The minimal product shape the wishlist needs — pass a storefront Product. */
export interface WishlistTarget {
  id: string;
  name: string;
  price: number;
}

interface WishlistAccount {
  userId: string;
  token: string;
}

type AccountState = 'idle' | 'hydrating' | 'ready' | 'error';

// Module-level store: the id list + a subscriber set. Persisted to
// localStorage when signed out; to Supabase (per-user) when signed in.
let ids: string[] = [];
const listeners = new Set<() => void>();

let account: WishlistAccount | null = null;
let accountState: AccountState = 'idle';

function readLocal(): string[] {
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

function clearLocal(): void {
  try {
    localStorage.removeItem(WISHLIST_STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

function write(next: string[]): void {
  ids = next;
  // Device copy only while signed out (or while the account is unreachable) —
  // while an account is live the server is the source of truth and the
  // device list stays cleared so accounts can never bleed into each other.
  if (!account || accountState === 'error') {
    try {
      localStorage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable — keep the in-memory list for this session */
    }
  }
  listeners.forEach((l) => l());
}

ids = readLocal();

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    // An account tab treats the server as authoritative; only anonymous tabs
    // sync off each other's device storage.
    if (e.key === WISHLIST_STORAGE_KEY && !account) {
      ids = readLocal();
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

// ---------------------------------------------------------------------------
// Supabase persistence (signed-in shoppers only)
// ---------------------------------------------------------------------------

async function fetchAccountIds(acc: WishlistAccount): Promise<string[]> {
  const cfg = getSupabaseConfig();
  if (!cfg) throw new Error('Supabase is not configured.');
  const r = await fetch(`${cfg.url}/rest/v1/wishlist_items?select=${encodeURIComponent('product_id')}`, {
    headers: { apikey: cfg.anonKey, Authorization: `Bearer ${acc.token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`wishlist read failed (HTTP ${r.status})`);
  const rows = (await r.json()) as Array<{ product_id?: unknown }>;
  return rows.map((row) => String(row.product_id ?? '')).filter(Boolean);
}

async function writeAccountItem(acc: WishlistAccount, productId: string, saved: boolean): Promise<void> {
  const cfg = getSupabaseConfig();
  if (!cfg) throw new Error('Supabase is not configured.');
  if (saved) {
    const r = await fetch(`${cfg.url}/rest/v1/wishlist_items`, {
      method: 'POST',
      headers: { apikey: cfg.anonKey, Authorization: `Bearer ${acc.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: acc.userId, product_id: productId }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok && r.status !== 409) throw new Error(`wishlist insert failed (HTTP ${r.status})`);
  } else {
    const r = await fetch(
      `${cfg.url}/rest/v1/wishlist_items?user_id=eq.${encodeURIComponent(acc.userId)}&product_id=eq.${encodeURIComponent(productId)}`,
      { method: 'DELETE', headers: { apikey: cfg.anonKey, Authorization: `Bearer ${acc.token}` }, signal: AbortSignal.timeout(10_000) },
    );
    if (!r.ok && r.status !== 404) throw new Error(`wishlist delete failed (HTTP ${r.status})`);
  }
}

/** Reconcile the server list to exactly `wanted` (add missing, remove stale). */
async function writeAccountIds(acc: WishlistAccount, wanted: string[]): Promise<void> {
  const existing = await fetchAccountIds(acc);
  const toAdd = wanted.filter((id) => !existing.includes(id));
  const toRemove = existing.filter((id) => !wanted.includes(id));
  await Promise.all([
    ...toAdd.map((id) => writeAccountItem(acc, id, true)),
    ...toRemove.map((id) => writeAccountItem(acc, id, false)),
  ]);
}

async function hydrateFromAccount(acc: WishlistAccount): Promise<void> {
  try {
    const serverIds = await fetchAccountIds(acc);
    const local = readLocal();
    if (local.length > 0) {
      // One-time device → account merge; then clear the device copy so a
      // shared device can never fold one account's items into another's.
      const merged = Array.from(new Set([...serverIds, ...local]));
      await writeAccountIds(acc, merged);
      ids = merged;
      clearLocal();
    } else {
      ids = serverIds;
    }
    accountState = 'ready';
  } catch {
    // Unreachable/offline: keep the device list working for this session.
    ids = readLocal();
    accountState = 'error';
  }
  listeners.forEach((l) => l());
}

/**
 * Bind the wishlist to a signed-in Supabase account (or detach on logout).
 * Called by the app whenever the signed-in user changes. While bound, the
 * server list is the source of truth and toggles write through to it.
 */
export function configureWishlistAccount(acc: WishlistAccount | null): void {
  if (acc?.userId === account?.userId) return; // same account — nothing to do
  account = acc;
  if (!acc) {
    accountState = 'idle';
    ids = readLocal();
    listeners.forEach((l) => l());
    return;
  }
  accountState = 'hydrating';
  void hydrateFromAccount(acc);
}

/**
 * Toggle a product in the wishlist and record the event first-party
 * (site_events) and to GA4 via trackEvent. `saved` is the NEW state.
 * Signed-in toggles also persist to Supabase (optimistic; the store re-syncs
 * from the server if a write fails).
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
  if (account && accountState === 'ready') {
    const acc = account;
    void writeAccountItem(acc, product.id, saved).catch(() => {
      // Converge back to the server truth rather than leaving silent drift.
      if (account?.userId === acc.userId) void hydrateFromAccount(acc);
    });
  }
}

export function clearWishlist(): void {
  write([]);
  if (account && accountState === 'ready') {
    const acc = account;
    void writeAccountIds(acc, []).catch(() => {
      if (account?.userId === acc.userId) void hydrateFromAccount(acc);
    });
  }
}

/** Test-only hook: re-read storage and drop subscribers between tests. */
export function __resetWishlistForTests(): void {
  account = null;
  accountState = 'idle';
  ids = readLocal();
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