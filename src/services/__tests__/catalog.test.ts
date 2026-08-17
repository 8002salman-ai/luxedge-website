import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadStorefrontCatalog } from '../catalog';
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

  it('returns null when there are no published products yet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/categories')) return Promise.resolve(jsonResponse([]));
      if (url.includes('/products')) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse([]));
    }));
    expect(await loadStorefrontCatalog()).toBeNull();
  });

  it('filters to published products with prices (V2 schema: name/price)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/categories')) {
        return Promise.resolve(jsonResponse([{ id: 'c1', name: 'Pet Beds', slug: 'pet-beds', is_active: true, sort_order: 0 }]));
      }
      if (url.includes('/products')) {
        return Promise.resolve(jsonResponse([
          { id: 'p1', name: 'Dog Bed', slug: 'dog-bed', status: 'published', price: 49.99, category_id: 'c1', inventory_qty: 10 },
          { id: 'p2', name: 'Draft Item', slug: 'draft', status: 'draft', price: 9.99 },
          { id: 'p3', name: 'Free Item', slug: 'free', status: 'published', price: 0, price_amount: 0 },
        ]));
      }
      if (url.includes('/product_images')) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse([]));
    }));
    const cat = await loadStorefrontCatalog();
    expect(cat).not.toBeNull();
    expect(cat!.source).toBe('supabase');
    expect(cat!.products.map((p) => p.id)).toEqual(['p1']);
    expect(cat!.products[0].name).toBe('Dog Bed');
    expect(cat!.products[0].price).toBe(49.99);
    expect(cat!.products[0].category).toBe('Pet Beds');
    expect(cat!.categories.length).toBe(1);
  });

  it('handles the legacy schema (title + integer cents) defensively', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/categories')) return Promise.resolve(jsonResponse([]));
      if (url.includes('/products')) {
        return Promise.resolve(jsonResponse([
          { id: 'p1', title: 'Legacy Bed', status: 'published', price_amount: 4999, compare_at_amount: 8999, image_url: 'https://img/x.jpg' },
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
        return Promise.resolve(jsonResponse([{ id: 'p1', name: 'Bed', status: 'published', price: 10 }]));
      }
      if (url.includes('/product_images')) return Promise.resolve(jsonResponse({ code: 'PGRST205' }, 404));
      return Promise.resolve(jsonResponse([]));
    }));
    const cat = await loadStorefrontCatalog();
    expect(cat).not.toBeNull();
    expect(cat!.products[0].name).toBe('Bed');
  });
});
