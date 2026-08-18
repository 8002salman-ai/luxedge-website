import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  CART_STORAGE_KEY,
  CART_STORAGE_KEY_LEGACY,
  purgeLegacyCart,
  parseStoredCart,
  reconcileCart,
  isCartOrderable,
  type CartItemLike,
  type CartProductBase,
} from '../cartSafety';

function fakeStorage(init: Record<string, string> = {}) {
  const store = new Map(Object.entries(init));
  return {
    getItem: vi.fn((k: string) => (store.has(k) ? store.get(k)! : null)),
    removeItem: vi.fn((k: string) => { store.delete(k); }),
    setItem: vi.fn((k: string, v: string) => { store.set(k, v); }),
  };
}

const cat: CartProductBase[] = [
  { id: 'p1', stock: 10 },
  { id: 'p2', stock: 0 },
  { id: 'p3', stock: 4 },
];

describe('cart safety guards', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  describe('purgeLegacyCart', () => {
    it('removes the demo-era luxedge_cart key', () => {
      const s = fakeStorage({ [CART_STORAGE_KEY_LEGACY]: '[{"product":{"id":"1"}}]' });
      purgeLegacyCart(s);
      expect(s.removeItem).toHaveBeenCalledWith(CART_STORAGE_KEY_LEGACY);
      expect(s.getItem(CART_STORAGE_KEY_LEGACY)).toBeNull();
    });
  });

  function fullProduct(id: string, over: Record<string, unknown> = {}) {
    return { id, name: 'Test Product', price: 10, images: ['https://img/x.jpg'], ...over };
  }

  describe('parseStoredCart', () => {
    it('purges the legacy key and reads only the v2 key', () => {
      const s = fakeStorage({
        [CART_STORAGE_KEY_LEGACY]: '[{"product":{"id":"demo"},"quantity":1}]',
        [CART_STORAGE_KEY]: JSON.stringify([{ product: fullProduct('p1', { stock: 10 }), quantity: 2 }]),
      });
      const items = parseStoredCart(s);
      expect(items).toHaveLength(1);
      expect(items[0].product.id).toBe('p1');
      expect(items[0].quantity).toBe(2);
      expect(s.getItem(CART_STORAGE_KEY_LEGACY)).toBeNull();
    });

    it('returns [] for empty, malformed, or non-array payloads', () => {
      const s1 = fakeStorage({ [CART_STORAGE_KEY]: '' });
      expect(parseStoredCart(s1)).toEqual([]);
      const s2 = fakeStorage({ [CART_STORAGE_KEY]: '{"nope":1}' });
      expect(parseStoredCart(s2)).toEqual([]);
      const s3 = fakeStorage({ [CART_STORAGE_KEY]: 'not json' });
      expect(parseStoredCart(s3)).toEqual([]);
    });

    it('drops entries with missing/invalid product id or non-positive quantity', () => {
      const s = fakeStorage({
        [CART_STORAGE_KEY]: JSON.stringify([
          { product: fullProduct('p1'), quantity: 2 },   // valid
          { product: fullProduct('', { name: 'X' }), quantity: 1 }, // invalid id
          { product: fullProduct('p2'), quantity: 0 },   // zero qty
          { product: fullProduct('p3'), quantity: -1 },  // negative qty
          { product: null, quantity: 1 },                // no product
          { quantity: 1 },                               // no product
        ]),
      });
      const items = parseStoredCart(s);
      expect(items).toHaveLength(1);
      expect(items[0].product.id).toBe('p1');
      expect(items[0].quantity).toBe(2);
    });

    it('rejects stripped/stale product stubs that lack renderable fields (name/price/images)', () => {
      const s = fakeStorage({
        [CART_STORAGE_KEY]: JSON.stringify([
          { product: { id: 'p1' }, quantity: 1 },                        // no name/price/images
          { product: { id: 'p2', name: 'X', price: 1 }, quantity: 1 },   // no images array
          { product: { id: 'p3', name: 'X', images: [] }, quantity: 1 }, // no price
          { product: fullProduct('p4'), quantity: 1 },                   // valid full product
        ]),
      });
      const items = parseStoredCart(s);
      expect(items).toHaveLength(1);
      expect(items[0].product.id).toBe('p4');
    });

    it('floors fractional quantities to integers', () => {
      const s = fakeStorage({ [CART_STORAGE_KEY]: JSON.stringify([{ product: fullProduct('p1'), quantity: 2.7 }]) });
      const items = parseStoredCart(s);
      expect(items[0].quantity).toBe(2);
    });
  });

  describe('reconcileCart', () => {
    it('keeps only items present in the current catalog', () => {
      const items: CartItemLike[] = [
        { product: { id: 'p1', stock: 10 }, quantity: 1 },
        { product: { id: 'gone', stock: 5 }, quantity: 1 },
        { product: { id: 'p3', stock: 4 }, quantity: 2 },
      ];
      const out = reconcileCart(items, cat);
      expect(out.map((i) => i.product.id)).toEqual(['p1', 'p3']);
    });

    it('drops out-of-stock items when stock is known', () => {
      const items: CartItemLike[] = [
        { product: { id: 'p2', stock: 0 }, quantity: 1 },
        { product: { id: 'p1', stock: 10 }, quantity: 1 },
      ];
      const out = reconcileCart(items, cat);
      expect(out.map((i) => i.product.id)).toEqual(['p1']);
    });

    it('keeps items with unknown stock (stock not known = not rejected)', () => {
      const items: CartItemLike[] = [{ product: { id: 'p1' }, quantity: 1 }];
      const out = reconcileCart(items, [{ id: 'p1' }]);
      expect(out).toHaveLength(1);
    });

    it('returns [] when the catalog is empty (defense in depth)', () => {
      const items: CartItemLike[] = [{ product: { id: 'p1' }, quantity: 1 }];
      expect(reconcileCart(items, [])).toEqual([]);
    });
  });

  describe('isCartOrderable', () => {
    it('false for an empty cart', () => {
      expect(isCartOrderable([], cat)).toBe(false);
    });

    it('false when the catalog is empty', () => {
      const items: CartItemLike[] = [{ product: { id: 'p1' }, quantity: 1 }];
      expect(isCartOrderable(items, [])).toBe(false);
    });

    it('false when any item is not in the current catalog (stale product)', () => {
      const items: CartItemLike[] = [
        { product: { id: 'p1' }, quantity: 1 },
        { product: { id: 'legacy-demo' }, quantity: 1 },
      ];
      expect(isCartOrderable(items, cat)).toBe(false);
    });

    it('false when any item is out of stock', () => {
      const items: CartItemLike[] = [
        { product: { id: 'p1' }, quantity: 1 },
        { product: { id: 'p2' }, quantity: 1 }, // stock 0
      ];
      expect(isCartOrderable(items, cat)).toBe(false);
    });

    it('false when an item has no valid product id', () => {
      const items = [{ product: {} as CartProductBase, quantity: 1 }];
      expect(isCartOrderable(items, cat)).toBe(false);
    });

    it('true only when every item exists in the catalog with stock', () => {
      const items: CartItemLike[] = [
        { product: { id: 'p1', stock: 10 }, quantity: 2 },
        { product: { id: 'p3', stock: 4 }, quantity: 1 },
      ];
      expect(isCartOrderable(items, cat)).toBe(true);
    });

    it('true when catalog stock is unknown (not falsely blocked)', () => {
      const items: CartItemLike[] = [{ product: { id: 'p1' }, quantity: 1 }];
      expect(isCartOrderable(items, [{ id: 'p1' }])).toBe(true);
    });
  });
});
