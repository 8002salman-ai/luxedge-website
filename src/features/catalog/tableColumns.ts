// ============================================================================
// LUXEDGE — CATALOG TABLE COLUMN ORDER
//
// The Products listing lets the seller drag columns to reorder them. The
// order is stored per-device in localStorage (admin-only surface). Helpers
// take a Storage-like object so they are unit-testable without a browser.
// ============================================================================

export const CATALOG_COLUMN_KEYS = [
  'product',
  'category',
  'status',
  'price',
  'margin',
  'stock',
  'views',
  'interest',
  'age',
  'promotion',
  'readiness',
  'actions',
] as const;

export type CatalogColumnKey = (typeof CATALOG_COLUMN_KEYS)[number];

export const CATALOG_COLUMN_LABELS: Record<CatalogColumnKey, string> = {
  product: 'Product',
  category: 'Category / Species',
  status: 'Status',
  price: 'Price',
  margin: 'Margin',
  stock: 'Stock',
  views: 'Views',
  interest: 'Interest',
  age: 'Listing Age',
  promotion: 'Promotion',
  readiness: 'Readiness',
  actions: 'Actions',
};

export const CATALOG_COLUMN_STORAGE_KEY = 'luxedge_catalog_columns_v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** Load the persisted column order; corrupted/unknown entries are dropped
 *  and any missing columns are appended in their default position. */
export function loadCatalogColumns(storage?: StorageLike | null): CatalogColumnKey[] {
  if (!storage) return [...CATALOG_COLUMN_KEYS];
  let parsed: unknown;
  try {
    const raw = storage.getItem(CATALOG_COLUMN_STORAGE_KEY);
    if (!raw) return [...CATALOG_COLUMN_KEYS];
    parsed = JSON.parse(raw);
  } catch {
    return [...CATALOG_COLUMN_KEYS];
  }
  if (!Array.isArray(parsed)) return [...CATALOG_COLUMN_KEYS];
  const known = new Set<string>(CATALOG_COLUMN_KEYS);
  const ordered: CatalogColumnKey[] = [];
  const seen = new Set<string>();
  for (const k of parsed) {
    if (typeof k === 'string' && known.has(k) && !seen.has(k)) {
      seen.add(k);
      ordered.push(k as CatalogColumnKey);
    }
  }
  // Anything missing from the stored list keeps its default position at the end.
  for (const k of CATALOG_COLUMN_KEYS) {
    if (!seen.has(k)) ordered.push(k);
  }
  return ordered;
}

/** Persist the current column order (best-effort — storage failures are non-fatal). */
export function saveCatalogColumns(order: CatalogColumnKey[], storage?: StorageLike | null): void {
  if (!storage) return;
  try {
    storage.setItem(CATALOG_COLUMN_STORAGE_KEY, JSON.stringify(order));
  } catch {
    // Quota/private-mode storage failures must never break the table.
  }
}

/** Move `from` to the index of `to` (dropping the dragged column on a target). */
export function moveColumn(order: CatalogColumnKey[], from: string, to: string): CatalogColumnKey[] {
  if (from === to) return order;
  const next = [...order];
  const fromIdx = next.indexOf(from as CatalogColumnKey);
  const toIdx = next.indexOf(to as CatalogColumnKey);
  if (fromIdx === -1 || toIdx === -1) return order;
  next.splice(fromIdx, 1);
  next.splice(toIdx, 0, from as CatalogColumnKey);
  return next;
}