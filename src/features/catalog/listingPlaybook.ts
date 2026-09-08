// ============================================================================
// LUXEDGE — LISTING PLAYBOOK
//
// Database-backed listing rules that govern product creation and imports:
//   - minimum/maximum verified product images
//   - never-placeholder / no-inline-base64 image policy
//   - supplier data requirements (URL, name, SKU)
//   - supplier-host → brand rule (e.g. HimalayanKoh)
//   - per-category presets (Dog, Cat, Horse, Cattle, Feeding & Water, Other)
//   - automation preset (source site, markup/fixed price, min margin, …)
//   - import history (DB-backed, not localStorage)
//
// Persistence reuses the store_settings key/value table (same pattern as
// getStoreSettings/saveStoreSettings) — no schema migration required.
// All rule decisions are pure functions so they are unit-testable.
// ============================================================================

import { getDb } from '../../services/db';

export type PlaybookStatus = 'draft' | 'active';

export const PLAYBOOK_VERSION = 1;
export const PLAYBOOK_SETTINGS_KEY = 'listing_playbook';
export const IMPORT_HISTORY_KEY = 'import_history';
export const DEFAULT_CATEGORY_KEYS = ['Dog', 'Cat', 'Horse', 'Cattle', 'Feeding & Water', 'Other'] as const;
export const IMPORT_HISTORY_CAP = 100;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CategoryListingRules {
  /** Force this brand for products from the category (e.g. 'HimalayanKoh'). */
  brand?: string;
  minImages?: number;
  maxImages?: number;
  defaultTags?: string[];
  /** Default status for imports that pass image/supplier verification. */
  defaultStatus?: PlaybookStatus;
  /** Require supplier URL + name + SKU on every product. */
  requiredSupplierData?: boolean;
  /** Automation: markup % applied over supplier cost → selling price. */
  markupPct?: number | null;
  /** Automation: fixed selling price (overrides markup when set). */
  fixedSellingPrice?: number | null;
  /** Automation: minimum margin % — imports below it are flagged/skipped. */
  minMarginPct?: number | null;
  shippingNote?: string;
}

export interface ListingAutomationPreset {
  sourceSite: string;
  sourceUrl: string;
  productCount: number;
  defaultCategory: string;
  priceMode: 'markup' | 'fixed';
  markupPct: number;
  fixedPrice: number;
  minMarginPct: number;
  minImages: number;
  defaultStatus: PlaybookStatus;
  freeShipping: boolean;
  shippingCost: number;
  instructions: string;
}

export interface ListingPlaybook {
  version: number;
  updatedAt: string;
  global: CategoryListingRules & { neverPlaceholder: boolean };
  categories: Record<string, CategoryListingRules>;
  automation: ListingAutomationPreset;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_GLOBAL: ListingPlaybook['global'] = {
  minImages: 3,
  maxImages: 5,
  requiredSupplierData: true,
  defaultStatus: 'draft',
  neverPlaceholder: true,
  brand: '',
};

function defaultCategoryRules(): CategoryListingRules {
  return {
    brand: '',
    minImages: 3,
    maxImages: 5,
    defaultTags: [],
    defaultStatus: 'draft',
    requiredSupplierData: true,
    markupPct: null,
    fixedSellingPrice: null,
    minMarginPct: null,
    shippingNote: '',
  };
}

export function defaultListingPlaybook(): ListingPlaybook {
  const categories: Record<string, CategoryListingRules> = {};
  for (const key of DEFAULT_CATEGORY_KEYS) categories[key] = defaultCategoryRules();
  return {
    version: PLAYBOOK_VERSION,
    updatedAt: new Date().toISOString(),
    global: { ...DEFAULT_GLOBAL },
    categories,
    automation: {
      sourceSite: 'AliExpress',
      sourceUrl: '',
      productCount: 10,
      defaultCategory: 'Dog',
      priceMode: 'markup',
      markupPct: 35,
      fixedPrice: 0,
      minMarginPct: 25,
      minImages: 3,
      defaultStatus: 'draft',
      freeShipping: false,
      shippingCost: 0,
      instructions: '',
    },
  };
}

// ---------------------------------------------------------------------------
// Normalization (load + JSON import safety)
// ---------------------------------------------------------------------------

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.min(max, Math.max(min, n));
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v.trim() : fallback;
}

function normalizeRules(raw: unknown): CategoryListingRules {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    brand: asString(r.brand),
    minImages: clampInt(r.minImages, 3, 0, 10),
    maxImages: clampInt(r.maxImages, 5, 0, 10),
    defaultTags: Array.isArray(r.defaultTags) ? r.defaultTags.filter((t): t is string => typeof t === 'string').slice(0, 20) : [],
    defaultStatus: r.defaultStatus === 'active' ? 'active' : 'draft',
    requiredSupplierData: typeof r.requiredSupplierData === 'boolean' ? r.requiredSupplierData : true,
    markupPct: typeof r.markupPct === 'number' && Number.isFinite(r.markupPct) ? r.markupPct : null,
    fixedSellingPrice: typeof r.fixedSellingPrice === 'number' && Number.isFinite(r.fixedSellingPrice) ? r.fixedSellingPrice : null,
    minMarginPct: typeof r.minMarginPct === 'number' && Number.isFinite(r.minMarginPct) ? r.minMarginPct : null,
    shippingNote: asString(r.shippingNote),
  };
}

/** Sanitize arbitrary input (DB row / imported JSON) into a valid playbook. */
export function normalizeListingPlaybook(raw: unknown): ListingPlaybook {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const categories: Record<string, CategoryListingRules> = {};
  for (const key of DEFAULT_CATEGORY_KEYS) categories[key] = defaultCategoryRules();
  if (r.categories && typeof r.categories === 'object') {
    for (const [key, val] of Object.entries(r.categories as Record<string, unknown>)) {
      categories[key] = normalizeRules(val);
    }
  }
  const auto = (r.automation && typeof r.automation === 'object' ? r.automation : {}) as Record<string, unknown>;
  return {
    version: clampInt(r.version, PLAYBOOK_VERSION, 1, 99),
    updatedAt: asString(r.updatedAt) || new Date().toISOString(),
    global: { ...normalizeRules(r.global), neverPlaceholder: r.global && typeof r.global === 'object' ? (r.global as Record<string, unknown>).neverPlaceholder !== false : true },
    categories,
    automation: {
      sourceSite: asString(auto.sourceSite, 'AliExpress'),
      sourceUrl: asString(auto.sourceUrl),
      productCount: clampInt(auto.productCount, 10, 1, 500),
      defaultCategory: asString(auto.defaultCategory, 'Dog'),
      priceMode: auto.priceMode === 'fixed' ? 'fixed' : 'markup',
      markupPct: clampInt(auto.markupPct, 35, 0, 1000),
      fixedPrice: typeof auto.fixedPrice === 'number' && Number.isFinite(auto.fixedPrice) ? auto.fixedPrice : 0,
      minMarginPct: clampInt(auto.minMarginPct, 25, 0, 100),
      minImages: clampInt(auto.minImages, 3, 0, 10),
      defaultStatus: auto.defaultStatus === 'active' ? 'active' : 'draft',
      freeShipping: auto.freeShipping === true,
      shippingCost: typeof auto.shippingCost === 'number' && Number.isFinite(auto.shippingCost) ? auto.shippingCost : 0,
      instructions: asString(auto.instructions),
    },
  };
}

// ---------------------------------------------------------------------------
// Pure rule functions
// ---------------------------------------------------------------------------

/** Resolve the effective rules for a category (falls back to Other). */
export function rulesForCategory(pb: ListingPlaybook, categoryName?: string | null): Required<CategoryListingRules> & { neverPlaceholder: boolean } {
  const key = (categoryName || '').trim();
  const rules = (key && pb.categories[key]) || pb.categories['Other'] || {};
  const global = pb.global;
  return {
    brand: rules.brand || global.brand || '',
    minImages: rules.minImages ?? global.minImages ?? 3,
    maxImages: rules.maxImages ?? global.maxImages ?? 5,
    defaultTags: rules.defaultTags || [],
    defaultStatus: rules.defaultStatus || global.defaultStatus || 'draft',
    requiredSupplierData: rules.requiredSupplierData ?? global.requiredSupplierData ?? true,
    markupPct: rules.markupPct ?? null,
    fixedSellingPrice: rules.fixedSellingPrice ?? null,
    minMarginPct: rules.minMarginPct ?? null,
    shippingNote: rules.shippingNote || '',
    neverPlaceholder: global.neverPlaceholder ?? true,
  };
}

/** Supplier-host → brand rule (e.g. HimalayanKoh). Never invented. */
export function supplierBrandForUrl(supplierUrl?: string | null, categoryBrand?: string): string | null {
  const url = (supplierUrl || '').toLowerCase();
  if (!url) return null;
  // Explicit per-category brand wins for the category's own suppliers.
  if (categoryBrand) return categoryBrand;
  if (url.includes('himalayankoh')) return 'HimalayanKoh';
  return null;
}

const PLACEHOLDER_PATTERNS = /placeholder|no-image|noimage|dummyimage|picsum|via\.placeholder/i;

/** A real, loadable image URL — http(s) only, never inline base64 or placeholder. */
export function isValidImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return false;
  if (PLACEHOLDER_PATTERNS.test(u)) return false;
  return true;
}

export interface ListingValidationProduct {
  name?: string;
  status?: string;
  images?: { url?: string | null }[];
  supplierUrl?: string | null;
  supplierName?: string | null;
  supplierSku?: string | null;
  categoryName?: string | null;
}

export interface ListingValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/** Active requires verified images + supplier data; missing/broken → Draft. */
export function validateListingAgainstPlaybook(
  pb: ListingPlaybook,
  product: ListingValidationProduct,
): ListingValidationResult {
  const rules = rulesForCategory(pb, product.categoryName);
  const errors: string[] = [];
  const warnings: string[] = [];
  const images = (product.images || []).filter((i) => i?.url);
  const validImages = images.filter((i) => isValidImageUrl(i.url));
  const wantsActive = product.status === 'active';

  if (images.length < rules.minImages) {
    const msg = `Only ${images.length}/${rules.minImages} image${rules.minImages === 1 ? '' : 's'} — Listing Playbook requires ${rules.minImages}.`;
    if (wantsActive) errors.push(msg);
    else warnings.push(`${msg} Product stays Draft.`);
  }
  if (images.length > rules.maxImages) {
    warnings.push(`${images.length} images exceed the max of ${rules.maxImages} — extra images will be ignored on the storefront.`);
  }
  if (images.length > validImages.length) {
    const bad = images.length - validImages.length;
    const msg = `${bad} image${bad === 1 ? '' : 's'} failed verification (broken, placeholder, or inline base64) — no placeholder images are allowed.`;
    if (wantsActive) errors.push(msg);
    else warnings.push(`${msg} Product stays Draft.`);
  }
  if (pb.global.neverPlaceholder && images.some((i) => !isValidImageUrl(i.url))) {
    if (wantsActive) errors.push('Placeholder/inline images are not allowed on active listings.');
  }
  if (rules.requiredSupplierData) {
    const missing: string[] = [];
    if (!product.supplierUrl) missing.push('supplier URL');
    if (!product.supplierName) missing.push('supplier name');
    if (!product.supplierSku) missing.push('supplier SKU');
    if (missing.length) {
      const msg = `Missing supplier data: ${missing.join(', ')}.`;
      if (wantsActive) errors.push(msg);
      else warnings.push(`${msg} Product stays Draft.`);
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

/** Should an import with this many verified images be created as Active? */
export function effectiveStatusForImport(
  pb: ListingPlaybook,
  categoryName: string | null | undefined,
  verifiedImageCount: number,
  requestedStatus: PlaybookStatus,
): PlaybookStatus {
  const rules = rulesForCategory(pb, categoryName);
  const minImages = rules.minImages ?? pb.global.minImages ?? 3;
  if (requestedStatus === 'active' && verifiedImageCount >= minImages) return 'active';
  return 'draft';
}

// ---------------------------------------------------------------------------
// JSON export / import
// ---------------------------------------------------------------------------

export function listingPlaybookToJson(pb: ListingPlaybook): string {
  return JSON.stringify(normalizeListingPlaybook(pb), null, 2);
}

export function parseListingPlaybookJson(text: string): ListingPlaybook {
  const raw = JSON.parse(text);
  return normalizeListingPlaybook(raw);
}

// ---------------------------------------------------------------------------
// Persistence (store_settings key/value — DB-backed, not localStorage)
// ---------------------------------------------------------------------------

export async function getListingPlaybook(): Promise<ListingPlaybook> {
  const db = getDb();
  try {
    const row = await db.findFirst<{ key: string; value?: unknown }>('store_settings', 'key', PLAYBOOK_SETTINGS_KEY);
    if (row && row.value) return normalizeListingPlaybook(row.value);
  } catch {
    // fall through to defaults — never crash admin on a bad row
  }
  return defaultListingPlaybook();
}

export async function saveListingPlaybook(pb: ListingPlaybook): Promise<ListingPlaybook> {
  const db = getDb();
  const normalized = normalizeListingPlaybook({ ...pb, updatedAt: new Date().toISOString() });
  const now = new Date().toISOString();
  const existing = await db.findFirst<{ key: string }>('store_settings', 'key', PLAYBOOK_SETTINGS_KEY).catch(() => null);
  if (existing) {
    await db.updateBy('store_settings', 'key', PLAYBOOK_SETTINGS_KEY, { value: normalized, updated_at: now });
  } else {
    await db.insertRaw('store_settings', { key: PLAYBOOK_SETTINGS_KEY, value: normalized, updated_at: now });
  }
  return normalized;
}

export interface PlaybookImportHistoryEntry {
  id: string;
  source: string;
  sourceType: string;
  date: string;
  provider: string;
  model: string;
  productTitle: string;
  status: 'success' | 'failed' | 'partial';
  importTime: number;
  /** Where the record lives: 'db' | 'local'. */
  store?: 'db' | 'local';
}

export async function getImportHistory(): Promise<PlaybookImportHistoryEntry[]> {
  const db = getDb();
  try {
    const row = await db.findFirst<{ key: string; value?: unknown }>('store_settings', 'key', IMPORT_HISTORY_KEY);
    if (row && Array.isArray(row.value)) {
      return row.value
        .filter((e): e is PlaybookImportHistoryEntry => e && typeof e === 'object' && typeof (e as PlaybookImportHistoryEntry).id === 'string')
        .slice(0, IMPORT_HISTORY_CAP)
        .map((e) => ({ ...e, store: 'db' as const }));
    }
  } catch {
    // fall through
  }
  return [];
}

/** Append a history entry (newest first, capped). Never throws. */
export async function appendImportHistory(entry: PlaybookImportHistoryEntry): Promise<PlaybookImportHistoryEntry[]> {
  const db = getDb();
  try {
    const current = await getImportHistory();
    const next = [entry, ...current.filter((e) => e.id !== entry.id)].slice(0, IMPORT_HISTORY_CAP);
    const existing = await db.findFirst<{ key: string }>('store_settings', 'key', IMPORT_HISTORY_KEY).catch(() => null);
    const now = new Date().toISOString();
    if (existing) {
      await db.updateBy('store_settings', 'key', IMPORT_HISTORY_KEY, { value: next, updated_at: now });
    } else {
      await db.insertRaw('store_settings', { key: IMPORT_HISTORY_KEY, value: next, updated_at: now });
    }
    return next;
  } catch {
    return [entry];
  }
}