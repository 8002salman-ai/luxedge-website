import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetDbForTests, __setDbConfigForTests, getDb, type DbAdapter } from '../../../services/db';
import {
  createProduct, updateProduct, setProductStatus, archiveProduct, hardDeleteProduct,
  duplicateProduct, saveProductImages, saveProductVariants, listProducts, getProduct,
  createCoupon, updateCoupon, deleteCoupon, listCoupons, getCouponByCode, validateCoupon,
  createOffer, updateOffer, deleteOffer, listOffers,
  getStoreSettings, saveStoreSettings, quoteShipping, setDbToken, uid,
  __resetCatalogSchemaCacheForTests,
} from '../repository';
import {
  effectivePrice, deriveStockStatus, deriveMarginPercent, DEFAULT_STORE_SETTINGS,
} from '../types';
import {
  buildProductJsonLd, buildFeedRow, buildFeedCsv, buildProductMeta, altTextFor, productUrl,
} from '../seo';
import type { CatalogProduct } from '../types';

function reset() {
  // LocalStorageAdapter reads window.localStorage — install an in-memory
  // shim so the local adapter persists across calls inside the test.
  const map = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    },
  };
  resetDbForTests();
  __setDbConfigForTests(null); // local adapter — no schema constraints
}

import type { ProductInput } from '../repository';

const base: ProductInput = {
  name: 'Interactive Squeaky Enrichment Toy for Dogs',
  shortDescription: 'Durable squeaky toy for play and enrichment.',
  description: 'A durable, easy-to-clean squeaky toy that keeps dogs engaged during play.',
  price: 14.99,
  compareAtPrice: 19.99,
  costPrice: 4.5,
  landedCost: 6.0,
  categoryId: 'cat-toys',
  brand: 'Luxedge',
  sku: 'TOY-SQ-001',
  inventoryQty: 50,
  tags: ['dog toy', 'enrichment'],
  status: 'draft',
};

describe('catalog repository (local adapter)', () => {
  beforeEach(reset);
  afterEach(() => { __setDbConfigForTests(undefined); resetDbForTests(); });

  it('creates a product with a unique slug', async () => {
    const a = await createProduct({ ...base });
    const b = await createProduct({ ...base, name: base.name });
    expect(a.slug).toBe('interactive-squeaky-enrichment-toy-for-dogs');
    expect(b.slug).toBe('interactive-squeaky-enrichment-toy-for-dogs-2');
  });

  it('updates a product and derives margin + stock status', async () => {
    const p = await createProduct({ ...base });
    const updated = await updateProduct(p.id, { ...base, price: 24.99, inventoryQty: 3, lowStockThreshold: 5, stockStatus: 'low_stock' });
    expect(updated!.price).toBe(24.99);
    expect(updated!.slug).toBe(p.slug);
    expect(updated!.stockStatus).toBe('low_stock');
    expect(updated!.marginPercent).toBeCloseTo(((24.99 - 6) / 24.99) * 100, 1);
  });

  it('sets status, archives (not delete), and lists all', async () => {
    const p = await createProduct({ ...base });
    await setProductStatus(p.id, 'active');
    expect((await getProduct(p.id))!.status).toBe('active');
    await archiveProduct(p.id);
    const archived = await getProduct(p.id);
    expect(archived!.status).toBe('archived');
    expect((await listProducts()).length).toBe(1); // still listed for admin
  });

  it('hard deletes a product', async () => {
    const p = await createProduct({ ...base });
    await hardDeleteProduct(p.id);
    expect(await getProduct(p.id)).toBeNull();
  });

  it('duplicates product with images + variants as a DRAFT', async () => {
    const p = await createProduct({ ...base });
    await saveProductImages(p.id, [
      { url: 'https://img/1.jpg', altText: 'Front', isPrimary: true, sortOrder: 0 },
      { url: 'https://img/2.jpg', altText: 'Side', sortOrder: 1 },
    ]);
    await saveProductVariants(p.id, [
      { attributes: { size: 'S' }, sku: 'TOY-S', price: 14.99, inventoryQty: 20 },
      { attributes: { size: 'L' }, sku: 'TOY-L', price: 16.99, inventoryQty: 30 },
    ]);
    const dup = await duplicateProduct(p.id);
    expect(dup!.name).toBe(`${p.name} (Copy)`);
    expect(dup!.status).toBe('draft');
    expect(dup!.images.length).toBe(2);
    expect(dup!.variants.length).toBe(2);
    expect(dup!.sku).toBe('TOY-SQ-001-COPY');
    expect(dup!.id).not.toBe(p.id);
  });

  it('image manager replaces the set (add/remove/reorder/primary/alt/variant)', async () => {
    const p = await createProduct({ ...base });
    await saveProductImages(p.id, [
      { url: 'https://img/a.jpg', altText: 'A', isPrimary: true, sortOrder: 0 },
      { url: 'https://img/b.jpg', altText: 'B', sortOrder: 1 },
    ]);
    await saveProductVariants(p.id, [{ attributes: { color: 'Blue' }, sku: 'B-1', price: 10, inventoryQty: 5 }]);
    const withVariant = await getProduct(p.id);
    const vid = withVariant!.variants[0].id;

    // Replace: keep A (now alt + variant-linked), drop B, add C as new primary.
    const a = withVariant!.images.find((i) => i.url === 'https://img/a.jpg')!;
    await saveProductImages(p.id, [
      { id: a.id, url: a.url, altText: 'Updated alt', isPrimary: false, sortOrder: 1, variantId: vid },
      { url: 'https://img/c.jpg', altText: 'C', isPrimary: true, sortOrder: 0 },
    ]);
    const after = await getProduct(p.id);
    expect(after!.images.length).toBe(2);
    expect(after!.images.map((i) => i.url)).toEqual(['https://img/c.jpg', 'https://img/a.jpg']);
    expect(after!.images[0].isPrimary).toBe(true);
    expect(after!.images[1].altText).toBe('Updated alt');
    expect(after!.images[1].variantId).toBe(vid);
  });

  it('variant manager replaces the set', async () => {
    const p = await createProduct({ ...base });
    await saveProductVariants(p.id, [
      { attributes: { size: 'S' }, sku: 'S-1', price: 10, inventoryQty: 2 },
      { attributes: { size: 'M' }, sku: 'M-1', price: 12, inventoryQty: 3 },
    ]);
    const before = await getProduct(p.id);
    const s = before!.variants.find((v) => v.sku === 'S-1')!;
    await saveProductVariants(p.id, [
      { id: s.id, attributes: { size: 'S' }, sku: 'S-1', price: 11, inventoryQty: 9 },
    ]);
    const after = await getProduct(p.id);
    expect(after!.variants.length).toBe(1);
    expect(after!.variants[0].price).toBe(11);
    expect(after!.variants[0].inventoryQty).toBe(9);
  });
});

describe('coupons', () => {
  beforeEach(reset);
  afterEach(() => { __setDbConfigForTests(undefined); resetDbForTests(); });

  it('creates + lists + updates + deletes a coupon', async () => {
    const c = await createCoupon({ code: 'welcome10', discountType: 'percent', discountValue: 10, minCartValue: 25 });
    expect(c.code).toBe('WELCOME10');
    expect((await listCoupons()).length).toBe(1);
    await updateCoupon(c.id, { code: 'welcome15', discountType: 'percent', discountValue: 15 });
    expect((await getCouponByCode('welcome15'))!.discountValue).toBe(15);
    await deleteCoupon(c.id);
    expect(await getCouponByCode('welcome15')).toBeNull();
  });

  it('validates percent coupon with minimum cart value', () => {
    const coupon = {
      id: '1', code: 'P10', discountType: 'percent' as const, discountValue: 10,
      minCartValue: 50, eligibleProductIds: [], eligibleCategoryIds: [],
      startAt: null, endAt: null, usageLimit: null, usedCount: 0, isActive: true,
      createdAt: '', updatedAt: '',
    };
    expect(validateCoupon(coupon, 40, []).ok).toBe(false);
    expect(validateCoupon(coupon, 100, []).discount).toBeCloseTo(10, 5);
  });

  it('validates fixed coupon capped at subtotal', () => {
    const coupon = {
      id: '2', code: 'FIX', discountType: 'fixed' as const, discountValue: 20,
      minCartValue: 0, eligibleProductIds: [], eligibleCategoryIds: [],
      startAt: null, endAt: null, usageLimit: null, usedCount: 0, isActive: true,
      createdAt: '', updatedAt: '',
    };
    expect(validateCoupon(coupon, 15, []).discount).toBe(15);
    expect(validateCoupon(coupon, 100, []).discount).toBe(20);
  });

  it('enforces usage limit, dates, inactive, and eligibility', () => {
    const base = {
      id: '3', code: 'X', discountType: 'percent' as const, discountValue: 10,
      minCartValue: 0, eligibleProductIds: [], eligibleCategoryIds: [],
      startAt: null, endAt: null, usageLimit: 1, usedCount: 1, isActive: true,
      createdAt: '', updatedAt: '',
    };
    expect(validateCoupon(base, 100, []).ok).toBe(false);
    expect(validateCoupon({ ...base, usageLimit: null, usedCount: 0, isActive: false }, 100, []).ok).toBe(false);
    const now = new Date('2026-01-01');
    expect(validateCoupon({ ...base, usageLimit: null, usedCount: 0, startAt: '2026-02-01' }, 100, [], now).ok).toBe(false);
    expect(validateCoupon({ ...base, usageLimit: null, usedCount: 0, endAt: '2025-12-01' }, 100, [], now).ok).toBe(false);
    const scoped = {
      ...base, usageLimit: null, usedCount: 0, eligibleProductIds: ['p1'],
    };
    expect(validateCoupon(scoped, 100, [{ productId: 'p2' }]).ok).toBe(false);
    expect(validateCoupon(scoped, 100, [{ productId: 'p1' }]).ok).toBe(true);
    const catScoped = {
      ...base, usageLimit: null, usedCount: 0, eligibleProductIds: [], eligibleCategoryIds: ['cat-toys'],
    };
    expect(validateCoupon(catScoped, 100, [{ productId: 'x', categoryId: 'cat-toys' }]).ok).toBe(true);
  });
});

describe('offers + settings + shipping', () => {
  beforeEach(reset);
  afterEach(() => { __setDbConfigForTests(undefined); resetDbForTests(); });

  it('creates/updates/deletes offers', async () => {
    const o = await createOffer({ name: 'Free Shipping Week', offerType: 'free_shipping', isActive: true });
    expect((await listOffers()).length).toBe(1);
    await updateOffer(o.id, { name: 'Renamed', offerType: 'percentage', value: 10 });
    const after = (await listOffers())[0];
    expect(after.name).toBe('Renamed');
    expect(after.offerType).toBe('percentage');
    expect(after.value).toBe(10);
    await deleteOffer(o.id);
    expect((await listOffers()).length).toBe(0);
  });

  it('round-trips store settings with defaults', async () => {
    expect((await getStoreSettings()).freeShippingThreshold).toBe(DEFAULT_STORE_SETTINGS.freeShippingThreshold);
    await saveStoreSettings({ freeShippingEnabled: true, freeShippingThreshold: 75, defaultDeliveryMinDays: 5, defaultDeliveryMaxDays: 12 });
    const s = await getStoreSettings();
    expect(s.freeShippingThreshold).toBe(75);
    expect(s.defaultDeliveryMinDays).toBe(5);
  });

  it('quotes shipping honestly from settings + product flags', () => {
    const settings = { freeShippingEnabled: true, freeShippingThreshold: 50, defaultDeliveryMinDays: null, defaultDeliveryMaxDays: null };
    expect(quoteShipping(settings, [{ productFreeShipping: false, productSubtotal: 30 }]).freeEligible).toBe(false);
    expect(quoteShipping(settings, [{ productFreeShipping: false, productSubtotal: 60 }]).freeEligible).toBe(true);
    expect(quoteShipping(settings, [{ productFreeShipping: true, productSubtotal: 10 }]).freeEligible).toBe(true);
  });
});

describe('pricing + status helpers', () => {
  it('computes effective price for percent/fixed sales', () => {
    expect(effectivePrice({ price: 20, saleEnabled: false, discountType: 'percent', discountValue: 10, compareAtPrice: 0 })).toBe(20);
    expect(effectivePrice({ price: 20, saleEnabled: true, discountType: 'percent', discountValue: 10, compareAtPrice: 25 })).toBe(18);
    expect(effectivePrice({ price: 20, saleEnabled: true, discountType: 'fixed', discountValue: 5, compareAtPrice: 25 })).toBe(15);
  });
  it('derives stock status + margin honestly', () => {
    expect(deriveStockStatus(0, 0)).toBe('out_of_stock');
    expect(deriveStockStatus(3, 5)).toBe('low_stock');
    expect(deriveStockStatus(10, 5)).toBe('in_stock');
    expect(deriveStockStatus(10, 5, 'on_backorder')).toBe('on_backorder');
    expect(deriveMarginPercent(20, 0)).toBeNull();
    expect(deriveMarginPercent(20, 10)).toBe(50);
  });
});

describe('seo + feed', () => {
  const p: CatalogProduct = {
    id: 'p1', slug: 'toy', name: 'Interactive Squeaky Toy', shortDescription: 'Durable squeaky toy.',
    description: 'Longer description.', price: 14.99, compareAtPrice: 19.99, costPrice: 4, landedCost: 5,
    marginPercent: 66.6, currency: 'USD', sku: 'SKU-1', inventoryQty: 10, stockStatus: 'in_stock',
    lowStockThreshold: 0, shippingCost: 4.99, freeShipping: false, deliveryMinDays: null, deliveryMaxDays: null,
    usInventory: false, tags: ['toy'], featured: false, newArrival: true, trending: false, bestRated: false,
    bestSeller: false, promoted: false, saleEnabled: false, seoTitle: 'SEO Toy Title', seoDescription: 'SEO desc.',
    seoKeywords: ['toy'], images: [
      { id: 'i1', productId: 'p1', url: 'https://img/1.jpg', altText: '', kind: 'product', isPrimary: true, sortOrder: 0 },
    ], variants: [], categoryId: 'cat-toys', categoryName: 'Pet Toys', brand: 'Luxedge',
    status: 'active', features: [], specifications: {}, createdAt: '', updatedAt: '', publishedAt: null,
  };

  it('builds meta with real fields', () => {
    const meta = buildProductMeta(p);
    expect(meta.title).toBe('SEO Toy Title');
    expect(meta.canonical).toBe(productUrl(p));
    expect(meta.ogImage).toBe('https://img/1.jpg');
  });

  it('emits JSON-LD without fake ratings; includes them only when real reviews passed', () => {
    const ld = buildProductJsonLd(p);
    const product = ld.find((x) => x['@type'] === 'Product') as Record<string, unknown>;
    expect(product.aggregateRating).toBeUndefined();
    const withReviews = buildProductJsonLd(p, { count: 4, average: 4.5 });
    const rated = withReviews.find((x) => x['@type'] === 'Product') as Record<string, unknown>;
    expect((rated.aggregateRating as Record<string, unknown>).reviewCount).toBe(4);
  });

  it('builds feed rows + CSV for Merchant readiness', () => {
    const row = buildFeedRow(p);
    expect(row.id).toBe('p1');
    expect(row.availability).toBe('in stock');
    expect(row.condition).toBe('new');
    expect(String(row.price)).toBe('14.99 USD');
    const csv = buildFeedCsv([p]);
    expect(csv).toContain('id,title');
    expect(csv).toContain('p1');
  });

  it('alt text is deterministic and never invented', () => {
    expect(altTextFor(p, p.images[0], 0)).toBe('Interactive Squeaky Toy — primary image');
  });

  it('setDbToken is safe on any adapter', () => {
    setDbToken('jwt');
    expect((getDb() as DbAdapter & { getAccessToken?: () => string | null }).getAccessToken?.()).toBe('jwt');
  });

  it('uid generates unique ids', () => {
    expect(uid()).not.toBe(uid());
  });
});

describe('catalog repository (pre-0010 live schema degradation)', () => {
  afterEach(() => {
    __setDbConfigForTests(undefined);
    resetDbForTests();
    __resetCatalogSchemaCacheForTests();
    vi.unstubAllGlobals();
  });

  // Mock a Supabase REST endpoint whose OpenAPI reports ONLY legacy product
  // columns (no featured/tags/coupons) — exactly the live pre-0010 state.
  function mockLegacySupabase() {
    const db: Record<string, unknown[]> = {};
    const legacyCols = ['id', 'slug', 'name', 'status', 'price', 'cost_price', 'sku', 'inventory_qty', 'category_id', 'brand', 'currency', 'created_at', 'updated_at'];
    const openApi = {
      components: { schemas: {
        products: { properties: Object.fromEntries(legacyCols.map((c) => [c, { type: 'string' }])) },
      } },
    };
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method || 'GET'} ${url.split('?')[0]}`);
      if (url.includes('/rest/v1/') && !url.includes('/rest/v1/products') && !url.includes('/rest/v1/categories')) {
        return new Response(JSON.stringify(openApi), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/rest/v1/categories')) {
        const rows = db['categories'] || [];
        return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/rest/v1/products')) {
        if (!db['products']) db['products'] = [];
        const rows = db['products'];
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body));
          rows.push(body);
          return new Response(JSON.stringify([body]), { status: 201, headers: { 'Content-Type': 'application/json' } });
        }
        if (init?.method === 'PATCH') {
          const id = url.match(/id=eq\.([^&]+)/)?.[1];
          const body = JSON.parse(String(init.body));
          const typed = rows as { id?: string }[];
          const idx = typed.findIndex((r) => r.id === decodeURIComponent(id || ''));
          if (idx >= 0) rows[idx] = { ...(rows[idx] as Record<string, unknown>), ...body };
          return new Response(JSON.stringify([rows[idx]]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.includes('id=eq.')) {
          const id = decodeURIComponent(url.match(/id=eq\.([^&]+)/)?.[1] || '');
          const typed = rows as { id?: string }[];
          return new Response(JSON.stringify(typed.filter((r) => r.id === id)), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.includes('slug=eq.')) {
          const slug = decodeURIComponent(url.match(/slug=eq\.([^&]+)/)?.[1] || '');
          const typed = rows as { slug?: string }[];
          return new Response(JSON.stringify(typed.filter((r) => r.slug === slug)), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.includes('sku=eq.')) {
          const sku = decodeURIComponent(url.match(/sku=eq\.([^&]+)/)?.[1] || '');
          const typed = rows as { sku?: string }[];
          return new Response(JSON.stringify(typed.filter((r) => r.sku === sku)), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    return { db, calls };
  }

  it('pre-0010: requesting active status degrades to DRAFT (never silent publish)', async () => {
    const { db, calls } = mockLegacySupabase();
    __setDbConfigForTests({ url: 'https://db.example.com', anonKey: 'anon' });
    resetDbForTests();
    __resetCatalogSchemaCacheForTests();
    const p = await createProduct({ ...base, status: 'active' });
    expect(p.status).toBe('draft');
    const stored = db['products'][0] as Record<string, unknown>;
    expect(stored.status).toBe('draft');
    expect(stored.featured).toBeUndefined(); // 0010 columns never sent
    expect(calls.some((c) => c.startsWith('GET https://db.example.com/rest/v1/'))).toBe(true);
  });

  it('pre-0010: coupons and offers degrade to empty lists', async () => {
    mockLegacySupabase();
    __setDbConfigForTests({ url: 'https://db.example.com', anonKey: 'anon' });
    resetDbForTests();
    __resetCatalogSchemaCacheForTests();
    expect(await listCoupons()).toEqual([]);
    expect(await listOffers()).toEqual([]);
  });
});
