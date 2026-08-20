// ============================================================================
// LUXEDGE — CART SAFETY (pre-Stripe hardening, Catalog Launch Phase)
//
// Pure, testable cart guards used by the storefront:
//   1. purgeLegacyCart()  — one-time removal of the demo-era 'luxedge_cart'
//      payload so stale/fake product objects never surface again.
//   2. parseStoredCart()  — tolerant parse/validation of the persisted cart.
//   3. reconcileCart()    — drop any stored item whose product is not in the
//      current customer-visible catalog (or is out of stock). Defense in
//      depth against manually-restored malformed payloads.
//   4. isCartOrderable()  — a cart may be submitted ONLY when every item is
//      present in the current catalog AND has stock. Empty/stale/invalid
//      carts are rejected — no fake success, no purchase conversion.
//
// No localStorage writes happen here except the one-time legacy purge;
// persistence stays in the caller. No secrets. No fake data.
// ============================================================================

// Demo-era key (may hold stale/demo product objects) — purged, never read.
export const CART_STORAGE_KEY_LEGACY = 'luxedge_cart';
// Current key.
export const CART_STORAGE_KEY = 'luxedge_cart_v2';

/** Minimal structural product shape the cart guards rely on. */
export interface CartProductBase {
  id: string;
  stock?: number;
}

export interface CartItemLike<P extends CartProductBase = CartProductBase> {
  product: P;
  quantity: number;
}

type StorageLike = Pick<Storage, 'getItem' | 'removeItem'>;

/** Remove the legacy demo-era cart payload once. Safe to call on every load. */
export function purgeLegacyCart(storage: StorageLike = localStorage): void {
  try {
    storage.removeItem(CART_STORAGE_KEY_LEGACY);
  } catch {
    /* storage unavailable — ignore */
  }
}

/**
 * Parse + validate the persisted cart from a storage object.
 * Returns only well-formed items (product id string + positive integer qty).
 */
export function parseStoredCart<P extends CartProductBase = CartProductBase>(
  storage: StorageLike = localStorage,
): CartItemLike<P>[] {
  try {
    purgeLegacyCart(storage);
    const raw = storage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const items: CartItemLike<P>[] = [];
    for (const entry of parsed) {
      const e = entry as Partial<CartItemLike<P>>;
      // A persisted cart item must look like a REAL full product object
      // (id + name + price + images array), not a stripped/stale demo stub.
      // Anything less is malformed and rejected outright — the drawer must
      // never render (or crash on) a payload that lacks renderable fields.
      if (
        e && typeof e === 'object' &&
        e.product && typeof e.product === 'object' &&
        typeof e.product.id === 'string' && e.product.id.trim() !== '' &&
        typeof (e.product as { name?: unknown }).name === 'string' &&
        typeof (e.product as { price?: unknown }).price === 'number' &&
        Array.isArray((e.product as { images?: unknown }).images) &&
        typeof e.quantity === 'number' && e.quantity > 0
      ) {
        items.push({ product: e.product, quantity: Math.floor(e.quantity) });
      }
    }
    return items;
  } catch {
    return [];
  }
}

/**
 * Reconcile a cart against the current customer-visible catalog: keep only
 * items whose product id exists in `catalog` (and, when stock is known, is
 * in stock). Returns the surviving items.
 */
export function reconcileCart<P extends CartProductBase = CartProductBase>(
  items: CartItemLike<P>[],
  catalog: CartProductBase[],
): CartItemLike<P>[] {
  if (!Array.isArray(catalog) || catalog.length === 0) return [];
  return items.filter((i) => {
    if (!i || !i.product) return false;
    const match = catalog.find((p) => p && p.id === i.product.id);
    if (!match) return false;
    // Stock is optional on the catalog row; only reject when we KNOW it's 0.
    const stock = typeof match.stock === 'number' ? match.stock : typeof i.product.stock === 'number' ? i.product.stock : null;
    return stock === null || stock > 0;
  });
}

/**
 * A cart may only be submitted when it is non-empty and every item exists in
 * the current catalog with stock > 0 (or unknown stock). Used by the
 * checkout guard — never fabricate an order for an empty/stale/invalid cart.
 */
export function isCartOrderable(
  items: CartItemLike[],
  catalog: CartProductBase[],
): boolean {
  if (!Array.isArray(items) || items.length === 0) return false;
  if (!Array.isArray(catalog) || catalog.length === 0) return false;
  return items.every((i) => {
    if (!i || !i.product || typeof i.product.id !== 'string') return false;
    const match = catalog.find((p) => p && p.id === i.product.id);
    if (!match) return false;
    const stock = typeof match.stock === 'number' ? match.stock : typeof i.product.stock === 'number' ? i.product.stock : null;
    return stock === null || stock > 0;
  });
}
