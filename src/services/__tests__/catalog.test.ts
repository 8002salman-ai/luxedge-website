import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadStorefrontCatalog, loadStorefrontPromotions } from '../catalog';
import { resetDbForTests, __setDbConfigForTests } from '../db';

const URL = 'https://project.supabase.co';
const ANON = 'anon-key-123';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('loadStorefrontCatalog', () => {
  beforeEach(() => {
    resetDbForTests();
    __setDbConfigForTests({ url: URL, anonKey: ANON });
  });

  afterEach(() => {
    __setDbConfigForTests(undefined);
    resetDbForTests();
    vi.unstubAllGlobals();
  });

  it('returns null when Supabase is not configured', async () => {
    __setDbConfigForTests(null);
    expect(await loadStorefrontCatalog()).toBeNull();
  });

  it('returns null when the DB is unreachable (no silent fake catalog)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    expect(await loadStorefrontCatalog()).toBeNull();
  });

  it('returns an EMPTY REAL CATALOG (not null, not demo fallback) when the DB is reachable with zero published products', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/categories')) return Promise.resolve(jsonResponse([{ id: 'c1', name: 'Pet Toys', slug: 'pet-toys', is_active: true, sort_order: 0 }]));
      if (url.includes('/products')) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse([]));
    }));
    const cat = await loadStorefrontCatalog();
    expect(cat).not.toBeNull();
    expect(cat!.source).toBe('supabase');
    expect(cat!.products).toEqual([]);
    // Categories still load — only the product list is intentionally empty.
    expect(cat!.categories.length).toBe(1);
    expect(cat!.categories[0].name).toBe('Pet Toys');
  });

  it('filters to published commerce-ready products (V2 schema: name/price)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/categories')) {
        return Promise.resolve(jsonResponse([{ id: 'c1', name: 'Pet Beds', slug: 'pet-beds', is_active: true, sort_order: 0 }]));
      }
      if (url.includes('/products')) {
        return Promise.resolve(jsonResponse([
          { id: 'p1', name: 'Dog Bed', slug: 'dog-bed', status: 'published', price: 49.99, category_id: 'c1', inventory_qty: 10, supplier_source: 'CJ', cost_price: 12, us_inventory: true, stock_status: 'in_stock' },
          { id: 'p2', name: 'Draft Item', slug: 'draft', status: 'draft', price: 9.99 },
          { id: 'p3', name: 'Free Item', slug: 'free', status: 'published', price: 0, price_amount: 0, supplier_source: 'CJ', cost_price: 1 },
          { id: 'p4', name: 'Retail-Ref Only', slug: 'ref', status: 'published', price: 29.99, supplier_source: 'KONG Company (official manufacturer)', cost_price: 0 },
        ]));
      }
      if (url.includes('/product_images')) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse([]));
    }));
    const cat = await loadStorefrontCatalog();
    expect(cat).not.toBeNull();
    expect(cat!.source).toBe('supabase');
    // p1 (real supplier + cost + US stock) is visible; p3 has no price; p4 is
    // retail-reference-only (no cost basis) → never storefront-visible.
    expect(cat!.products.map((p) => p.id)).toEqual(['p1']);
    expect(cat!.products[0].name).toBe('Dog Bed');
    expect(cat!.products[0].price).toBe(49.99);
    expect(cat!.products[0].category).toBe('Pet Beds');
    expect(cat!.products[0].commerceReadiness).toBe('COMMERCE_READY');
    expect(cat!.categories.length).toBe(1);
  });

  it('display parity: rows WITHOUT title/description/price_amount/image_url map cleanly (name||id, \'\' desc, price, images from product_images)', async () => {
    // The egress select deliberately omits columns that never existed on
    // public.products (they 400-d the query). The mapping must fall back the
    // same way select=* did: name→display, price_amount absent → price used,
    // image_url absent → product_images table still supplies the images.
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/categories')) return Promise.resolve(jsonResponse([]));
      if (url.includes('/products')) {
        return Promise.resolve(jsonResponse([
          { id: 'p1', name: 'Dog Bed', slug: 'dog-bed', status: 'active', price: 49.99, short_description: 'Comfy', category_id: null, inventory_qty: 5, supplier_source: 'CJ', cost_price: 12, us_inventory: true, stock_status: 'in_stock', commerce_readiness: 'COMMERCE_READY' },
          // No name → falls back to id (title is not a column, so never present).
          { id: 'p2', slug: 'nameless', status: 'active', price: 9.99, commerce_readiness: 'COMMERCE_READY' },
        ]));
      }
      if (url.includes('/product_images')) {
        return Promise.resolve(jsonResponse([{ product_id: 'p1', url: 'https://img/x.jpg', alt_text: 'bed', is_primary: true, sort_order: 0 }]));
      }
      return Promise.resolve(jsonResponse([]));
    }));
    const cat = await loadStorefrontCatalog();
    const byId = new Map(cat!.products.map((p) => [p.id, p]));
    expect(byId.get('p1')?.name).toBe('Dog Bed'); // p.name || p.title → name
    expect(byId.get('p1')?.description).toBe(''); // absent description column → ''
    expect(byId.get('p1')?.price).toBe(49.99); // price (no price_amount present)
    expect(byId.get('p1')?.images).toEqual(['https://img/x.jpg']);
    expect(byId.get('p2')?.name).toBe('p2'); // name||title||id → id
  });

  it('hides ACTIVE products without a verified purchasing path (commerce readiness gate)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/categories')) return Promise.resolve(jsonResponse([]));
      if (url.includes('/products')) {
        return Promise.resolve(jsonResponse([
          // Manufacturer retail-reference page: authenticity proven, but no
          // wholesale/dropship path and no cost basis → SOURCE_PENDING → hidden.
          { id: 'p1', name: 'KONG Classic Toy', status: 'active', price: 8.99, supplier_source: 'KONG Company (official manufacturer)', cost_price: 0, us_inventory: true, stock_status: 'in_stock', inventory_qty: 25 },
          // Real CJ supply + cost + list-level US inventory → COMMERCE_READY.
          { id: 'p2', name: 'CJ Scratch Board', status: 'active', price: 5.99, supplier_source: 'CJ', supplier_product_ref: 'CJYD2060792', cost_price: 1.99, us_inventory: true, stock_status: 'in_stock', inventory_qty: 4 },
        ]));
      }
      if (url.includes('/product_images')) return Promise.resolve(jsonResponse([]));
      if (url.includes('/product_variants')) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse([]));
    }));
    const cat = await loadStorefrontCatalog();
    expect(cat!.products.map((p) => p.id)).toEqual(['p2']);
    expect(cat!.products[0].commerceReadiness).toBe('COMMERCE_READY');
  });

  it('handles the legacy schema (title + integer cents) defensively', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/categories')) return Promise.resolve(jsonResponse([]));
      if (url.includes('/products')) {
        return Promise.resolve(jsonResponse([
          { id: 'p1', title: 'Legacy Bed', status: 'published', price_amount: 4999, compare_at_amount: 8999, image_url: 'https://img/x.jpg', supplier_source: 'CJ', cost_price: 12, us_inventory: true, stock_status: 'in_stock' },
        ]));
      }
      if (url.includes('/product_images')) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse([]));
    }));
    const cat = await loadStorefrontCatalog();
    expect(cat).not.toBeNull();
    expect(cat!.products[0].name).toBe('Legacy Bed');
    expect(cat!.products[0].price).toBe(49.99);
    expect(cat!.products[0].originalPrice).toBe(89.99);
    expect(cat!.products[0].images).toEqual(['https://img/x.jpg']);
  });

  it('tolerates a missing product_images table without failing the catalog', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/categories')) return Promise.resolve(jsonResponse([]));
      if (url.includes('/products')) {
        return Promise.resolve(jsonResponse([{ id: 'p1', name: 'Bed', status: 'published', price: 10, supplier_source: 'CJ', cost_price: 3, us_inventory: true, stock_status: 'in_stock' }]));
      }
      if (url.includes('/product_images')) return Promise.resolve(jsonResponse({ code: 'PGRST205' }, 404));
      return Promise.resolve(jsonResponse([]));
    }));
    const cat = await loadStorefrontCatalog();
    expect(cat).not.toBeNull();
    expect(cat!.products[0].name).toBe('Bed');
  });

  it('Catalog Launch: ACTIVE products are storefront-visible (status IN published/active)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/categories')) return Promise.resolve(jsonResponse([]));
      if (url.includes('/products')) {
        return Promise.resolve(jsonResponse([
          { id: 'p1', name: 'Active Bed', status: 'active', price: 39.99, featured: true, new_arrival: true, free_shipping: true, sale_enabled: true, discount_type: 'percent', discount_value: 10, price_amount: 3999, supplier_source: 'CJ', cost_price: 10, us_inventory: true, stock_status: 'in_stock' },
          { id: 'p2', name: 'Published Legacy', status: 'published', price: 19.99, supplier_source: 'CJ', cost_price: 5, us_inventory: true, stock_status: 'in_stock' },
          { id: 'p3', name: 'Draft Item', status: 'draft', price: 9.99 },
          { id: 'p4', name: 'Inactive Item', status: 'inactive', price: 8.99 },
        ]));
      }
      if (url.includes('/product_images')) return Promise.resolve(jsonResponse([]));
      if (url.includes('/product_variants')) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse([]));
    }));
    const cat = await loadStorefrontCatalog();
    expect(cat!.products.map((p) => p.id).sort()).toEqual(['p1', 'p2']);
    const active = cat!.products.find((p) => p.id === 'p1')!;
    expect(active.featured).toBe(true);
    expect(active.newArrival).toBe(true);
    expect(active.freeShipping).toBe(true);
    // percent sale applied to the storefront price
    expect(active.price).toBeCloseTo(35.99, 5);
  });
});

describe('loadStorefrontPromotions', () => {
  beforeEach(() => {
    resetDbForTests();
    __setDbConfigForTests({ url: URL, anonKey: ANON });
  });
  afterEach(() => {
    __setDbConfigForTests(undefined);
    resetDbForTests();
    vi.unstubAllGlobals();
  });

  it('loads active coupons + free-shipping settings', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/coupons')) {
        return Promise.resolve(jsonResponse([
          { id: 'c1', code: 'WELCOME10', discount_type: 'percent', discount_value: 10, min_cart_value: 25, eligible_product_ids: [], eligible_category_ids: [], end_at: null, usage_limit: 100, used_count: 3, is_active: true },
        ]));
      }
      if (url.includes('/store_settings')) {
        return Promise.resolve(jsonResponse([{ key: 'free_shipping', value: { freeShippingEnabled: true, freeShippingThreshold: 75 } }]));
      }
      return Promise.resolve(jsonResponse([]));
    }));
    const p = await loadStorefrontPromotions();
    expect(p.coupons.length).toBe(1);
    expect(p.coupons[0].code).toBe('WELCOME10');
    expect(p.coupons[0].discountValue).toBe(10);
    expect(p.freeShippingEnabled).toBe(true);
    expect(p.freeShippingThreshold).toBe(75);
  });

  it('degrades to safe defaults when promotions are unavailable (no fake coupons/shipping)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('unreachable')));
    const p = await loadStorefrontPromotions();
    expect(p.coupons).toEqual([]);
    expect(p.freeShippingEnabled).toBe(false);
  });
});
