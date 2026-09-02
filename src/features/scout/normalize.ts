// ============================================================================
// LUXEDGE V2 — SCOUT NORMALIZATION + DEDUPE
//
// Pure helpers: slugify, supplier-from-domain, price parsing, suggested-sell
// price resolution, and duplicate detection keys. No I/O — fully unit-testable.
// ============================================================================

import type { EvidenceItem } from './types';

/** URL-safe slug. Empty input → 'item'. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';
}

/** Hostname without www. prefix; '' when the URL is invalid. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Canonical supplier identity key: www-stripped, lowercased hostname.
 * "https://www.kongcompany.com/..." and "https://kongcompany.com/..." both
 * resolve to "kongcompany.com", so the same real supplier is never split
 * into two rows by a www prefix.
 */
export function canonicalDomain(url: string): string {
  return hostOf(url);
}

/** Supplier identity derived from the source URL's domain. */
export function supplierFromUrl(url: string): { name: string; slug: string; baseUrl: string } {
  const host = hostOf(url);
  const parts = host.split('.');
  // Take the registrable-ish label: for x.example.com → example
  const label = parts.length >= 2 ? parts[parts.length - 2] : host;
  const name = label.charAt(0).toUpperCase() + label.slice(1);
  return { name, slug: slugify(host || label), baseUrl: host ? `https://${host}` : '' };
}

/** Collapse whitespace and trim. */
export function normalizeTitle(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/** Extract the first USD price from a string like "$12.99", "US$ 1,299.00". */
export function parsePrice(text: string): number | null {
  const m = text.match(/(?:US\$|\$)\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d{1,6}(?:\.\d{1,2})?)/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Dedupe key: prefer the canonical path of the source URL; fall back to a
 * normalized title when the URL is unusable. Two candidates with the same key
 * are considered the same product.
 */
export function dedupeKey(url: string, title: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.hostname.replace(/^www\./, '')}${path}`;
  } catch {
    return slugify(title);
  }
}

/**
 * Fuzzy duplicate check across an existing candidate set (in-memory or from
 * the DB). Returns the existing title when a match is found, else null.
 */
export function findDuplicate(
  key: string,
  existing: { dedupeKey: string; title: string }[]
): string | null {
  const hit = existing.find((e) => e.dedupeKey === key);
  return hit ? hit.title : null;
}

/** Normalize a review-count string ("1,234 reviews") to a number. */
export function parseReviewCount(text: string): number | null {
  const m = text.match(/(\d{1,3}(?:,\d{3})*)\s*(?:reviews|ratings)/i);
  if (!m) return null;
  const n = parseInt(m[1].replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

/** Normalize a rating like "4.8 out of 5" / "4.8/5" to a number. */
export function parseRating(text: string): number | null {
  const m = text.match(/(\d(?:\.\d)?)\s*(?:out of|\/)\s*5/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n >= 0 && n <= 5 ? n : null;
}

// ---------------------------------------------------------------------------
// Suggested sell price (honest, evidence-driven — never fabricated)
// ---------------------------------------------------------------------------

export interface SellPriceEvidence {
  supplierPrice?: EvidenceItem | null;
  /** e.g. "Chewy KONG Classic Dog Toy, Medium - $11.96 (https://…)" */
  retail_reference?: unknown;
  /** e.g. "$7.99 - $25.99" */
  manufacturer_price_range?: unknown;
}

export interface SuggestedSellPrice {
  price: number | null;
  /** Where the suggestion came from — drives the publish UI label. */
  source: 'exact' | 'retail' | 'range' | 'none';
  label: string;
}

/**
 * Resolve a suggested sell price from candidate evidence, best evidence
 * first: exact supplier (CJ) price → real retail-reference price → midpoint
 * of the manufacturer price range → nothing (owner enters one). Returns null
 * price ONLY when no usable evidence exists — never a fabricated number.
 */
export function suggestedSellPrice(ev: SellPriceEvidence | null | undefined): SuggestedSellPrice {
  const exact = ev?.supplierPrice && typeof ev.supplierPrice === 'object'
    ? (ev.supplierPrice as EvidenceItem).value
    : null;
  if (typeof exact === 'number' && exact > 0) {
    return { price: exact, source: 'exact', label: 'exact supplier (CJ) price' };
  }

  if (typeof ev?.retail_reference === 'string') {
    const m = ev.retail_reference.match(/-\s*\$(\d+(?:\.\d+)?)/);
    const price = m ? parseFloat(m[1]) : NaN;
    if (Number.isFinite(price) && price > 0) {
      const name = ev.retail_reference.split(' - ')[0].trim();
      return {
        price,
        source: 'retail',
        label: name ? `retail reference (${name.slice(0, 60)})` : 'retail reference price',
      };
    }
  }

  if (typeof ev?.manufacturer_price_range === 'string') {
    const m = ev.manufacturer_price_range.match(/(\d+(?:\.\d+)?)\s*-\s*\$(\d+(?:\.\d+)?)/);
    const m2 = ev.manufacturer_price_range.match(/\$(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
    const r = m || m2;
    if (r) {
      const low = parseFloat(r[1]);
      const high = parseFloat(r[2]);
      if (Number.isFinite(low) && Number.isFinite(high) && high >= low && low > 0) {
        return {
          price: Math.round(((low + high) / 2) * 100) / 100,
          source: 'range',
          label: 'midpoint of manufacturer price range',
        };
      }
    }
  }

  return { price: null, source: 'none', label: 'no pricing evidence — you set the selling price' };
}
