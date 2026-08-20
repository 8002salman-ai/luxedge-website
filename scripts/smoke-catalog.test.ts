// TEMPORARY live smoke test — drives the REAL repository against the LIVE DB.
// Guarded by RUN_LIVE_SMOKE=1. Deleted after the run (no committed harness).
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function loadEnv() {
  const env: Record<string, string> = {};
  if (fs.existsSync(path.join(__dirname, '..', '.env'))) {
    for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

const env = loadEnv();
const RUN = process.env.RUN_LIVE_SMOKE === '1' && env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY && env.SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(!RUN)('LIVE catalog smoke (RUN_LIVE_SMOKE=1)', () => {
  it('full admin CRUD + promotions + cleanup', { timeout: 60000 }, async () => {
    const { __setDbConfigForTests, getDb, resetDbForTests } = await import('../src/services/db');
    const repo = await import('../src/features/catalog/repository');
    const { SupabaseAdapter } = await import('../src/services/db');

    // Server-side path: service-role key in both headers (same SQL + repository
    // path the admin UI uses; RLS admin policies verified separately with anon
    // read/write probes — this bypasses RLS like the server does).
    __setDbConfigForTests({ url: env.VITE_SUPABASE_URL!.replace(/\/$/, ''), anonKey: env.SUPABASE_SERVICE_ROLE_KEY! });
    resetDbForTests();
    const db = getDb();
    void SupabaseAdapter; // (type-only reference kept for clarity)

    const cats = await repo.listCategories();
    const catId = cats.find((c) => c.slug === 'pet-toys')?.id || cats[0]?.id;
    expect(catId, 'category present').toBeTruthy();

    const created: string[] = [];

    // ---- 1. CREATE temp draft product (full fields) ----
    const p = await repo.createProduct({
      name: 'SMOKE TEST — Interactive Rope Toy',
      shortTitle: 'Smoke Rope Toy',
      subtitle: 'Live CRUD smoke product',
      shortDescription: 'Temporary smoke-test product.',
      description: 'A temporary product used to verify live admin CRUD. Deleted after the test.',
      features: ['Feature A', 'Feature B'],
      specifications: { material: 'cotton', care: 'spot clean' },
      categoryId: catId,
      brand: 'Luxedge QA',
      price: 19.99,
      compareAtPrice: 0,
      costPrice: 8.0,
      currency: 'USD',
      sku: `SMOKE-${Date.now()}`,
      inventoryQty: 12,
      stockStatus: 'in_stock',
      lowStockThreshold: 3,
      freeShipping: true,
      deliveryMinDays: 7,
      deliveryMaxDays: 12,
      shippingNote: 'Smoke test shipping note.',
      usInventory: true,
      supplierSource: 'CJ',
      supplierProductRef: 'SMOKE-REF',
      tags: ['dog', 'toys'],
      featured: true,
      newArrival: true,
      seoTitle: 'Smoke Interactive Rope Toy | Luxedge',
      seoDescription: 'Smoke test SEO description.',
      seoKeywords: ['dog', 'rope toy'],
      ownerNotes: 'QA smoke product — delete after test.',
    });
    created.push(p.id);
    expect(p.status).toBe('draft');
    expect(p.sku).toBeTruthy();
    expect(p.featured).toBe(true);
    expect(p.tags).toContain('dog');
    expect(p.freeShipping).toBe(true);
    expect(p.usInventory).toBe(true);

    // ---- 2. EDIT title/description/pricing/inventory/shipping/SEO ----
    const edited = await repo.updateProduct(p.id, {
      name: 'SMOKE TEST — Edited Rope Toy',
      description: 'Edited smoke description.',
      price: 24.99,
      compareAtPrice: 29.99,
      inventoryQty: 5,
      stockStatus: 'low_stock',
      lowStockThreshold: 6,
      freeShipping: false,
      deliveryMinDays: 5,
      seoTitle: 'Smoke Edited Rope Toy | Luxedge',
      seoDescription: 'Edited SEO description.',
      tags: ['dog', 'toys', 'edited'],
    });
    expect(edited!.name).toBe('SMOKE TEST — Edited Rope Toy');
    expect(edited!.price).toBe(24.99);
    expect(edited!.compareAtPrice).toBe(29.99);
    expect(edited!.stockStatus).toBe('low_stock');
    expect(edited!.seoTitle).toContain('Edited');
    expect(edited!.tags).toContain('edited');

    // ---- 3. IMAGES: add, reorder, primary, alt, delete ----
    const imgA = 'https://cf.cjdropshipping.com/smoke-a.jpg';
    const imgB = 'https://cf.cjdropshipping.com/smoke-b.jpg';
    let withImgs = await repo.saveProductImages(p.id, [
      { url: imgA, altText: 'Smoke A', isPrimary: true, sortOrder: 0 },
      { url: imgB, altText: 'Smoke B', isPrimary: false, sortOrder: 1 },
    ]);
    expect(withImgs!.images).toHaveLength(2);
    expect(withImgs!.images[0].isPrimary).toBe(true);

    // reorder: B becomes primary first
    const b = withImgs!.images[1];
    withImgs = await repo.saveProductImages(p.id, [
      { id: b.id, url: imgB, altText: 'Smoke B primary', isPrimary: true, sortOrder: 0 },
      { url: imgA, altText: 'Smoke A', isPrimary: false, sortOrder: 1 },
    ]);
    expect(withImgs!.images[0].url).toBe(imgB);
    expect(withImgs!.images[0].isPrimary).toBe(true);
    expect(withImgs!.images[0].altText).toBe('Smoke B primary');

    // delete A
    const aAfter = withImgs!.images.find((i) => i.url === imgA)!;
    withImgs = await repo.saveProductImages(p.id, [withImgs!.images[0]]);
    expect(withImgs!.images).toHaveLength(1);
    expect(withImgs!.images[0].id).not.toBe(aAfter.id);

    // ---- 4. VARIANTS: create, edit, delete ----
    let withVars = await repo.saveProductVariants(p.id, [
      { attributes: { size: 'S' }, sku: `${p.sku}-S`, price: 19.99, inventoryQty: 4 },
      { attributes: { size: 'M' }, sku: `${p.sku}-M`, price: 24.99, inventoryQty: 6 },
    ]);
    expect(withVars!.variants).toHaveLength(2);
    const vM = withVars!.variants[1];
    withVars = await repo.saveProductVariants(p.id, [
      withVars!.variants[0],
      { id: vM.id, attributes: { size: 'M', color: 'Blue' }, sku: `${p.sku}-M-BLUE`, price: 26.99, inventoryQty: 3 },
    ]);
    expect(withVars!.variants).toHaveLength(2);
    const editedV = withVars!.variants.find((v) => v.id === vM.id)!;
    expect(editedV.attributes).toEqual({ size: 'M', color: 'Blue' });
    expect(editedV.sku).toBe(`${p.sku}-M-BLUE`);
    expect(editedV.price).toBe(26.99);

    // delete one variant
    withVars = await repo.saveProductVariants(p.id, [withVars!.variants[0]]);
    expect(withVars!.variants).toHaveLength(1);

    // ---- 5. STATUS cycle draft → ready → active → inactive → archived ----
    let st = await repo.setProductStatus(p.id, 'ready');
    expect(st!.status).toBe('ready');
    st = await repo.setProductStatus(p.id, 'active');
    expect(st!.status).toBe('active');
    expect(st!.publishedAt).toBeTruthy();
    st = await repo.setProductStatus(p.id, 'inactive');
    expect(st!.status).toBe('inactive');
    st = await repo.setProductStatus(p.id, 'active'); // back to active for storefront QA
    expect(st!.status).toBe('active');

    // ---- 6. Coupon temp: create/edit/disable/delete ----
    const c = await repo.createCoupon({
      code: 'SMOKE10',
      description: 'Temporary smoke coupon',
      discountType: 'percent',
      discountValue: 10,
      minCartValue: 0,
      isActive: true,
    });
    expect(c.code).toBe('SMOKE10');
    const c2 = await repo.updateCoupon(c.id, { ...c, description: 'Edited smoke coupon', discountValue: 15, isActive: false });
    expect(c2!.discountValue).toBe(15);
    expect(c2!.isActive).toBe(false);
    const c3 = await repo.updateCoupon(c.id, { ...c, isActive: true });
    expect(c3!.isActive).toBe(true);
    await repo.deleteCoupon(c.id);
    expect(await repo.getCouponByCode('SMOKE10')).toBeNull();

    // ---- 7. Free-shipping setting save/load ----
    const saved = await repo.saveStoreSettings({ freeShippingEnabled: true, freeShippingThreshold: 50, defaultDeliveryMinDays: 7, defaultDeliveryMaxDays: 14 });
    expect(saved.freeShippingEnabled).toBe(true);
    expect(saved.freeShippingThreshold).toBe(50);
    const loaded = await repo.getStoreSettings();
    expect(loaded.freeShippingEnabled).toBe(true);
    expect(loaded.freeShippingThreshold).toBe(50);

    // ---- 8. WELCOME10 launch coupon (idempotent) ----
    let w = await repo.getCouponByCode('WELCOME10');
    if (!w) {
      w = await repo.createCoupon({ code: 'WELCOME10', description: '10% off your first order', discountType: 'percent', discountValue: 10, minCartValue: 0, isActive: true });
    }
    expect(w.code).toBe('WELCOME10');
    expect(w.discountValue).toBe(10);
    expect(w.discountType).toBe('percent');

    // ---- 9. CLEANUP: archive then hard delete, verify no orphans ----
    await repo.archiveProduct(p.id);
    const archived = await repo.getProduct(p.id);
    expect(archived!.status).toBe('archived');
    await repo.hardDeleteProduct(p.id);
    expect(await repo.getProduct(p.id)).toBeNull();
    // orphans?
    const orphans = await db.list<{ id: string; product_id: string }>('product_images', { limit: 2000 });
    const orphanImgs = orphans.filter((i) => i.product_id === p.id);
    const varOrphans = await db.list<{ id: string; product_id: string }>('product_variants', { limit: 2000 });
    expect(orphanImgs).toHaveLength(0);
    expect(varOrphans.filter((v) => v.product_id === p.id)).toHaveLength(0);

    console.log('LIVE SMOKE PASS: CRUD ✓ images ✓ variants ✓ status cycle ✓ coupon ✓ settings ✓ WELCOME10 ✓ cleanup ✓ no orphans ✓');
    __setDbConfigForTests(undefined);
    resetDbForTests();
  });
});
