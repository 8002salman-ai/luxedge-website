import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetDbForTests, __setDbConfigForTests } from '../../../services/db';
import {
  defaultListingPlaybook, rulesForCategory, supplierBrandForUrl,
  isValidImageUrl, validateListingAgainstPlaybook, effectiveStatusForImport,
  listingPlaybookToJson, parseListingPlaybookJson,
  getListingPlaybook, saveListingPlaybook, appendImportHistory, getImportHistory,
} from '../listingPlaybook';
import { findDuplicateProduct, slugifyTitle } from '../../ai/importer';

function reset() {
  const map = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    },
  };
  resetDbForTests();
  __setDbConfigForTests(null); // local adapter
}

describe('listing playbook — defaults & rules', () => {
  beforeEach(reset);
  afterEach(() => { __setDbConfigForTests(undefined); resetDbForTests(); });

  it('defaults: min 3 images, max 5, never placeholder, all category presets present', () => {
    const pb = defaultListingPlaybook();
    expect(pb.global.minImages).toBe(3);
    expect(pb.global.maxImages).toBe(5);
    expect(pb.global.neverPlaceholder).toBe(true);
    for (const key of ['Dog', 'Cat', 'Horse', 'Cattle', 'Feeding & Water', 'Other']) {
      expect(pb.categories[key].minImages).toBe(3);
    }
    expect(pb.automation.defaultStatus).toBe('draft');
  });

  it('brand rule: HimalayanKoh supplier → HimalayanKoh; category brand wins', () => {
    expect(supplierBrandForUrl('https://www.himalayankoh.com/item/123')).toBe('HimalayanKoh');
    expect(supplierBrandForUrl('https://himalayankoh.com/x')).toBe('HimalayanKoh');
    expect(supplierBrandForUrl('https://aliexpress.com/item/1')).toBeNull();
    expect(supplierBrandForUrl('https://www.himalayankoh.com/x', 'Premium Salt Co')).toBe('Premium Salt Co');
  });

  it('isValidImageUrl rejects inline base64, placeholders, and non-http', () => {
    expect(isValidImageUrl('https://cdn.example.com/a.jpg')).toBe(true);
    expect(isValidImageUrl('data:image/webp;base64,UklGR')).toBe(false);
    expect(isValidImageUrl('https://via.placeholder.com/150')).toBe(false);
    expect(isValidImageUrl('https://placehold.co/150x150')).toBe(true); // real service, not blocked
    expect(isValidImageUrl('/local/path.png')).toBe(false);
    expect(isValidImageUrl('')).toBe(false);
    expect(isValidImageUrl(null)).toBe(false);
  });

  it('rulesForCategory merges global + category preset, falls back to Other', () => {
    const pb = defaultListingPlaybook();
    pb.global.minImages = 4;
    pb.categories['Dog'].minImages = 2;
    expect(rulesForCategory(pb, 'Dog').minImages).toBe(2);
    // Unknown category inherits the Other preset (its own 3), not global.
    expect(rulesForCategory(pb, 'Unknown Category').minImages).toBe(3);
    pb.categories['Other'].minImages = 6;
    expect(rulesForCategory(pb, 'Unknown Category').minImages).toBe(6);
  });

  it('active listing without min images is blocked; draft gets warnings only', () => {
    const pb = defaultListingPlaybook();
    const product = {
      name: 'Test Collar', status: 'active', categoryName: 'Dog',
      images: [{ url: 'https://cdn.example.com/1.jpg' }, { url: 'https://cdn.example.com/2.jpg' }],
      supplierUrl: 'https://aliexpress.com/item/1', supplierName: 'AliExpress', supplierSku: 'SKU-1',
    };
    const active = validateListingAgainstPlaybook(pb, product);
    expect(active.ok).toBe(false);
    expect(active.errors.join(' ')).toMatch(/2\/3 images/);
    const draft = validateListingAgainstPlaybook(pb, { ...product, status: 'draft' });
    expect(draft.ok).toBe(true);
    expect(draft.warnings.join(' ')).toMatch(/stays Draft/);
  });

  it('active listing with broken/placeholder image is blocked; supplier gaps flagged', () => {
    const pb = defaultListingPlaybook();
    const product = {
      name: 'X', status: 'active', categoryName: 'Dog',
      images: [
        { url: 'https://cdn.example.com/1.jpg' },
        { url: 'https://cdn.example.com/2.jpg' },
        { url: 'https://via.placeholder.com/150' },
      ],
      supplierUrl: null, supplierName: 'AliExpress', supplierSku: null,
    };
    const res = validateListingAgainstPlaybook(pb, product);
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/placeholder|failed verification/i);
    expect(res.errors.join(' ')).toMatch(/supplier URL/);
    expect(res.errors.join(' ')).toMatch(/supplier SKU/);
  });

  it('complete active product passes validation', () => {
    const pb = defaultListingPlaybook();
    const product = {
      name: 'Complete', status: 'active', categoryName: 'Dog',
      images: [
        { url: 'https://cdn.example.com/1.jpg' },
        { url: 'https://cdn.example.com/2.jpg' },
        { url: 'https://cdn.example.com/3.jpg' },
      ],
      supplierUrl: 'https://aliexpress.com/item/1', supplierName: 'AliExpress', supplierSku: 'SKU-1',
    };
    expect(validateListingAgainstPlaybook(pb, product).ok).toBe(true);
  });

  it('effectiveStatusForImport only allows active with verified images >= min', () => {
    const pb = defaultListingPlaybook();
    expect(effectiveStatusForImport(pb, 'Dog', 3, 'active')).toBe('active');
    expect(effectiveStatusForImport(pb, 'Dog', 2, 'active')).toBe('draft');
    expect(effectiveStatusForImport(pb, 'Dog', 3, 'draft')).toBe('draft');
  });

  it('JSON export/import round-trips and hostile input is normalized', () => {
    const pb = defaultListingPlaybook();
    pb.global.minImages = 4;
    pb.categories['Cattle'].brand = 'HimalayanKoh';
    const back = parseListingPlaybookJson(listingPlaybookToJson(pb));
    expect(back.global.minImages).toBe(4);
    expect(back.categories['Cattle'].brand).toBe('HimalayanKoh');
    const hostile = parseListingPlaybookJson(JSON.stringify({
      version: -5, global: { minImages: 999, maxImages: -3 }, categories: { Dog: { minImages: 'x' } },
    }));
    expect(hostile.version).toBeGreaterThanOrEqual(1);
    expect(hostile.global.minImages).toBe(10);
    expect(hostile.global.maxImages).toBe(0);
    expect(hostile.categories['Dog'].minImages).toBe(3);
    expect(hostile.categories['Other'].minImages).toBe(3);
  });
});

describe('listing playbook — persistence (DB-backed, not localStorage)', () => {
  beforeEach(reset);
  afterEach(() => { __setDbConfigForTests(undefined); resetDbForTests(); });

  it('saves and reloads the playbook from the settings store', async () => {
    const pb = defaultListingPlaybook();
    pb.global.minImages = 4;
    pb.categories['Cat'].defaultStatus = 'active';
    await saveListingPlaybook(pb);
    const loaded = await getListingPlaybook();
    expect(loaded.global.minImages).toBe(4);
    expect(loaded.categories['Cat'].defaultStatus).toBe('active');
  });

  it('returns defaults when nothing is saved', async () => {
    const loaded = await getListingPlaybook();
    expect(loaded.global.minImages).toBe(3);
  });

  it('import history appends newest-first and persists', async () => {
    await appendImportHistory({ id: 'h1', source: 'https://a.com', sourceType: 'url', date: '2026-09-08T00:00:00Z', provider: 'DeepSeek', model: 'm', productTitle: 'A', status: 'success', importTime: 100 });
    await appendImportHistory({ id: 'h2', source: 'https://b.com', sourceType: 'url', date: '2026-09-08T00:00:01Z', provider: 'DeepSeek', model: 'm', productTitle: 'B', status: 'partial', importTime: 200 });
    const hist = await getImportHistory();
    expect(hist.map((h) => h.id)).toEqual(['h2', 'h1']);
    expect(hist[0].store).toBe('db');
    expect(hist[0].status).toBe('partial');
  });
});

describe('duplicate protection — slug & SKU', () => {
  it('blocks by slug collision (same normalized slug, different casing/punct)', () => {
    const products = [{ id: 'p1', name: 'Premium Dog Collar', slug: 'premium-dog-collar', supplierUrl: 'https://s.com/1', sku: 'SKU-1' }];
    expect(findDuplicateProduct(products, { title: 'Premium  Dog  Collar!' })).toMatchObject({ id: 'p1', name: 'Premium Dog Collar' });
    expect(findDuplicateProduct(products, { title: 'Totally Different' })).toBeNull();
    expect(slugifyTitle('Cats Collars — Bow & Bell!')).toBe('cats-collars-bow-bell');
  });

  it('blocks by supplier SKU', () => {
    const products = [{ id: 'p1', name: 'X', supplierUrl: null, sku: 'AE-998877' }];
    expect(findDuplicateProduct(products, { title: 'Fresh Name', sku: 'AE-998877' })).toMatchObject({ id: 'p1', name: 'X' });
  });
});