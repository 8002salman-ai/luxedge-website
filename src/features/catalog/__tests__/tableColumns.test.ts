// Contract for the catalog table column order.
//   * Default order matches the shipped seller-hub layout.
//   * Saved orders are sanitized: unknown keys dropped, duplicates removed,
//     missing keys appended at the end (their default position).
//   * Corrupted storage falls back to the default order — never crashes.
import { describe, it, expect } from 'vitest';
import {
  CATALOG_COLUMN_KEYS,
  loadCatalogColumns,
  saveCatalogColumns,
  moveColumn,
} from '../tableColumns';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => Array.from(map.keys())[i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  };
}

describe('loadCatalogColumns', () => {
  it('returns the default order with no stored value', () => {
    expect(loadCatalogColumns(memoryStorage())).toEqual([...CATALOG_COLUMN_KEYS]);
  });

  it('returns the default order without storage (SSR/test-safe)', () => {
    expect(loadCatalogColumns(undefined)).toEqual([...CATALOG_COLUMN_KEYS]);
    expect(loadCatalogColumns(null)).toEqual([...CATALOG_COLUMN_KEYS]);
  });

  it('sanitizes a stored order: unknown keys dropped, missing keys appended', () => {
    const storage = memoryStorage({
      'luxedge_catalog_columns_v1': JSON.stringify(['margin', 'price', 'bogus', 'margin', 'actions']),
    });
    expect(loadCatalogColumns(storage)).toEqual([
      'margin', 'price', 'actions',
      'product', 'category', 'status', 'stock', 'views', 'interest', 'age', 'promotion', 'readiness',
    ]);
  });

  it('falls back to defaults on corrupted JSON', () => {
    const storage = memoryStorage({ 'luxedge_catalog_columns_v1': '{not json' });
    expect(loadCatalogColumns(storage)).toEqual([...CATALOG_COLUMN_KEYS]);
  });
});

describe('saveCatalogColumns', () => {
  it('round-trips a custom order (saved prefix first, remaining columns appended)', () => {
    const storage = memoryStorage();
    saveCatalogColumns(['actions', 'price', 'product'], storage);
    const loaded = loadCatalogColumns(storage);
    expect(loaded.slice(0, 3)).toEqual(['actions', 'price', 'product']);
    expect(loaded).toHaveLength(CATALOG_COLUMN_KEYS.length);
    // No column is lost or duplicated by the round-trip.
    expect(new Set(loaded).size).toBe(CATALOG_COLUMN_KEYS.length);
  });

  it('never throws when storage is unavailable', () => {
    expect(() => saveCatalogColumns(['product'], undefined)).not.toThrow();
    const broken = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    expect(() => saveCatalogColumns(['product'], broken)).not.toThrow();
  });
});

describe('moveColumn', () => {
  it('moves the dragged column to the target index', () => {
    expect(moveColumn(['product', 'price', 'margin', 'stock'], 'product', 'margin')).toEqual(['price', 'margin', 'product', 'stock']);
    expect(moveColumn(['product', 'price', 'margin', 'stock'], 'stock', 'product')).toEqual(['stock', 'product', 'price', 'margin']);
  });

  it('is a no-op for same-column or unknown keys', () => {
    expect(moveColumn(['product', 'price'], 'product', 'product')).toEqual(['product', 'price']);
    expect(moveColumn(['product', 'price'], 'zz', 'price')).toEqual(['product', 'price']);
  });
});