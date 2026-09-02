// ============================================================================
// LUXEDGE V2 — CSV BULK IMPORT (Zeedrop / any supplier CSV → Luxedge drafts)
//
// Parses pasted/uploaded CSV into honest ProductInput-shaped rows. Used by the
// Admin → Products → CSV Import modal. Everything imports as DRAFT only — no
// auto-publish. Duplicate protection mirrors the DB-level rule: supplier item
// ID > supplier URL > normalized title (priority order). No fake facts: stock,
// compare price and cost are kept only when the CSV actually provides them.
// ============================================================================

import { parseTagList } from './tags';

export interface CsvVariant {
  attributes: Record<string, string>;
}

export interface CsvImportRow {
  name: string;
  shortDescription?: string;
  description?: string;
  price?: number;
  compareAtPrice?: number;
  costPrice?: number;
  sku?: string;
  inventoryQty?: number;
  shippingCost?: number;
  freeShipping?: boolean;
  weight?: string;
  brand?: string;
  category?: string;
  subcategory?: string;
  tags: string[];
  images: string[];
  supplierUrl?: string;
  supplierSource?: string;
  supplierProductRef?: string;
  variants: CsvVariant[];
  raw: Record<string, string>;
}

export interface CsvSkippedRow {
  line: number;
  reason: string;
}

export interface CsvParseResult {
  rows: CsvImportRow[];
  skipped: CsvSkippedRow[];
  warnings: string[];
  headers: string[];
}

/** Minimal shape needed for duplicate detection (keeps the module pure/testable). */
export interface DupCandidate {
  id: string;
  name: string;
  supplierUrl?: string | null;
  supplierProductRef?: string | null;
}

export type DupField = 'supplierProductRef' | 'supplierUrl' | 'title';

export interface DuplicateMatch {
  field: DupField;
  product: DupCandidate;
}

// ---------------------------------------------------------------------------
// CSV parsing (RFC-4180-ish: quoted fields, escaped quotes, commas/newlines)
// ---------------------------------------------------------------------------
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const s = String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = '';
      // Drop fully-empty lines (blank rows) — only keep real rows.
      if (row.length > 1 || (row[0] ?? '').trim() !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.length > 1 || field.trim() !== '') rows.push(row);
  return rows;
}

// ---------------------------------------------------------------------------
// Column aliases — accept any common header (Zeedrop, CJ, AliExpress, generic)
// ---------------------------------------------------------------------------
const COL_ALIASES: Record<string, string> = {
  title: 'name', name: 'name', 'product title': 'name', 'product name': 'name',
  'item title': 'name', 'listing title': 'name', 'product': 'name',
  price: 'price', 'selling price': 'price', 'sell price': 'price', 'sale price': 'price',
  'price usd': 'price', 'list price': 'price', 'unit price': 'price',
  'compare price': 'compareAtPrice', 'compare-at price': 'compareAtPrice',
  'compare at price': 'compareAtPrice', 'was price': 'compareAtPrice',
  'original price': 'compareAtPrice', 'strikethrough price': 'compareAtPrice',
  msrp: 'compareAtPrice', 'old price': 'compareAtPrice', 'rrp': 'compareAtPrice',
  cost: 'costPrice', 'cost price': 'costPrice', 'supplier cost': 'costPrice',
  'wholesale price': 'costPrice', 'purchase price': 'costPrice', 'unit cost': 'costPrice',
  images: 'images', image: 'images', 'image urls': 'images', 'image url': 'images',
  'photo urls': 'images', 'photo url': 'images', gallery: 'images', 'image links': 'images',
  description: 'description', 'long description': 'description',
  'product description': 'description', details: 'description', 'full description': 'description',
  'short description': 'shortDescription', 'short desc': 'shortDescription', summary: 'shortDescription',
  variants: 'variants', variant: 'variants', options: 'variants', option: 'variants',
  url: 'supplierUrl', 'supplier url': 'supplierUrl', 'source url': 'supplierUrl',
  'product url': 'supplierUrl', link: 'supplierUrl', 'product link': 'supplierUrl',
  'item id': 'supplierProductRef', itemid: 'supplierProductRef',
  'supplier item id': 'supplierProductRef', 'supplier ref': 'supplierProductRef',
  'supplier product ref': 'supplierProductRef', 'product id': 'supplierProductRef',
  'aliexpress id': 'supplierProductRef', 'product code': 'supplierProductRef',
  source: 'supplierSource', supplier: 'supplierSource', platform: 'supplierSource',
  'supplier source': 'supplierSource', 'source platform': 'supplierSource',
  brand: 'brand',
  category: 'category', 'category name': 'category',
  subcategory: 'subcategory', 'sub category': 'subcategory',
  tags: 'tags', tag: 'tags', keywords: 'tags',
  sku: 'sku', 'variant sku': 'sku',
  stock: 'inventoryQty', inventory: 'inventoryQty', quantity: 'inventoryQty', qty: 'inventoryQty',
  'stock qty': 'inventoryQty', 'inventory qty': 'inventoryQty',
  'shipping cost': 'shippingCost', shipping: 'shippingCost', freight: 'shippingCost',
  'free shipping': 'freeShipping', 'free delivery': 'freeShipping',
  weight: 'weight', 'product weight': 'weight',
};

function normalizeHeader(h: string): string {
  return String(h ?? '').toLowerCase().replace(/"/g, '').replace(/\s+/g, ' ').trim();
}

function mapHeader(h: string): string {
  return COL_ALIASES[normalizeHeader(h)] || normalizeHeader(h);
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------
function toNum(v: unknown): number | undefined {
  if (v == null) return undefined;
  const s = String(v).trim().replace(/[$,\s]/g, '');
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function toBool(v: unknown): boolean | undefined {
  if (v == null) return undefined;
  const s = String(v).trim().toLowerCase();
  if (['yes', 'true', '1', 'y', 'free'].includes(s)) return true;
  if (['no', 'false', '0', 'n'].includes(s)) return false;
  return undefined;
}

function splitImages(v: unknown): string[] {
  if (v == null) return [];
  const out = String(v)
    .split(/[\n|;,]+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s));
  // de-dupe exact + strip ali-oss size suffixes is NOT done here (preserve URLs verbatim)
  return [...new Set(out)];
}

/** Parse a variants cell: "Color:Red; Size:M" | "Red / M" | [{"Color":"Red"}] */
function parseVariants(v: unknown): CsvVariant[] {
  if (v == null) return [];
  const raw = String(v).trim();
  if (!raw) return [];
  // JSON array of attribute objects
  if (raw.startsWith('[')) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        return arr
          .map((item) => {
            if (!item || typeof item !== 'object') return null;
            const attrs: Record<string, string> = {};
            for (const [k, val] of Object.entries(item as Record<string, unknown>)) {
              if (typeof val === 'string' || typeof val === 'number') attrs[k] = String(val);
            }
            return Object.keys(attrs).length ? { attributes: attrs } : null;
          })
          .filter((x): x is CsvVariant => !!x);
      }
    } catch { /* fall through to text parsing */ }
  }
  const chunks = raw.split(/;;|\n/).map((s) => s.trim()).filter(Boolean);
  const variants: CsvVariant[] = [];
  for (const chunk of chunks) {
    const attrs: Record<string, string> = {};
    const parts = chunk.split(/;\s*|\|\|/).map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      const idx = part.indexOf(':');
      if (idx > 0) {
        const k = part.slice(0, idx).trim();
        const val = part.slice(idx + 1).trim();
        if (k && val) attrs[k] = val;
      } else if (part) {
        // unnamed option → Option 1 / Option 2 …
        const n = Object.keys(attrs).length + 1;
        attrs[`Option ${n}`] = part;
      }
    }
    if (Object.keys(attrs).length) variants.push({ attributes: attrs });
  }
  return variants;
}

// ---------------------------------------------------------------------------
// Main entry: text → parsed rows
// ---------------------------------------------------------------------------
export function parseCsvImport(text: string): CsvParseResult {
  const warnings: string[] = [];
  const skipped: CsvSkippedRow[] = [];
  const rawRows = parseCsv(text);
  if (rawRows.length === 0) return { rows: [], skipped, warnings, headers: [] };
  const headers = rawRows[0].map((h) => mapHeader(h));
  const rows: CsvImportRow[] = [];
  for (let i = 1; i < rawRows.length; i++) {
    const cells = rawRows[i];
    const rec: Record<string, string> = {};
    headers.forEach((h, idx) => { if (h) rec[h] = (cells[idx] ?? '').trim(); });
    const name = rec.name || rec['product title'] || '';
    if (!name) {
      skipped.push({ line: i + 1, reason: 'Missing title' });
      continue;
    }
    const price = toNum(rec.price);
    const compareAtPrice = toNum(rec.compareAtPrice);
    const costPrice = toNum(rec.costPrice);
    const inventoryQty = toNum(rec.inventoryQty);
    const shippingCost = toNum(rec.shippingCost);
    const freeShipping = toBool(rec.freeShipping);
    const images = splitImages(rec.images);
    const variants = parseVariants(rec.variants);
    if (compareAtPrice != null && price != null && compareAtPrice <= price) {
      warnings.push(`Row ${i + 1}: compare price ($${compareAtPrice}) is not above selling price ($${price}) — ignored`);
    }
    rows.push({
      name,
      shortDescription: rec.shortDescription || undefined,
      description: rec.description || undefined,
      price,
      compareAtPrice: compareAtPrice != null && price != null && compareAtPrice > price ? compareAtPrice : undefined,
      costPrice,
      sku: rec.sku || undefined,
      inventoryQty,
      shippingCost,
      freeShipping,
      weight: rec.weight || undefined,
      brand: rec.brand || undefined,
      category: rec.category || undefined,
      subcategory: rec.subcategory || undefined,
      tags: parseTagList(rec.tags),
      images,
      supplierUrl: rec.supplierUrl || undefined,
      supplierSource: rec.supplierSource || undefined,
      supplierProductRef: rec.supplierProductRef || undefined,
      variants,
      raw: rec,
    });
  }
  return { rows, skipped, warnings, headers };
}

// ---------------------------------------------------------------------------
// Duplicate detection (priority: item ID > URL > normalized title)
// ---------------------------------------------------------------------------
export function normalizeTitle(s: string): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

export function findDuplicate(row: CsvImportRow, existing: DupCandidate[]): DuplicateMatch | null {
  const ref = (row.supplierProductRef || '').trim().toLowerCase();
  const url = (row.supplierUrl || '').trim().toLowerCase();
  const title = normalizeTitle(row.name);
  // 1. supplier item ID
  if (ref) {
    const hit = existing.find((p) => (p.supplierProductRef || '').trim().toLowerCase() === ref);
    if (hit) return { field: 'supplierProductRef', product: hit };
  }
  // 2. exact supplier URL
  if (url) {
    const hit = existing.find((p) => (p.supplierUrl || '').trim().toLowerCase() === url);
    if (hit) return { field: 'supplierUrl', product: hit };
  }
  // 3. normalized title (only when the title is meaningful)
  if (title.length >= 4) {
    const hit = existing.find((p) => normalizeTitle(p.name) === title);
    if (hit) return { field: 'title', product: hit };
  }
  return null;
}

/** Split duplicate matches per row — used by the import modal to skip dupes. */
export function classifyDuplicates(
  rows: CsvImportRow[],
  existing: DupCandidate[],
): { row: CsvImportRow; duplicate: DuplicateMatch | null }[] {
  return rows.map((row) => ({ row, duplicate: findDuplicate(row, existing) }));
}
