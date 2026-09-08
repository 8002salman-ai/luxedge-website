// ============================================================================
// LUXEDGE — LISTING TASK (batch import automation)
//
// A Listing Task is a structured batch-import command:
//   source platform + source URL (product / category / search page) + count
//   + LuxEdge category + pricing rule + status + special instructions.
//
// This module is PURE (no I/O) so every rule is unit-testable: task
// normalization, product-link discovery from a source page, pricing-rule
// application (fixed / markup / min-margin), and task validation.
// The batch runner (batchImport.ts) executes a task with injected I/O.
// ============================================================================

import type { PlaybookStatus } from './listingPlaybook';

export type SourcePlatform = 'AliExpress' | 'Amazon' | 'eBay' | 'Shopify' | 'CJ' | 'Other';
export type PricingMode = 'fixed' | 'markup' | 'min-margin';

export interface PricingRule {
  mode: PricingMode;
  /** Fixed selling price (USD) when mode === 'fixed'. */
  fixedPrice?: number | null;
  /** Markup % over supplier cost when mode === 'markup'. */
  markupPct?: number | null;
  /** Minimum margin % when mode === 'min-margin' (price = cost / (1 - margin)). */
  minMarginPct?: number | null;
}

export interface ListingTask {
  sourcePlatform: SourcePlatform;
  sourceUrl: string;
  productCount: number;
  category: string;
  pricing: PricingRule;
  status: PlaybookStatus;
  specialInstructions: string;
}

export const LISTING_TASK_CATEGORIES = ['Dog', 'Cat', 'Horse', 'Cattle', 'Feeding & Water', 'Other'] as const;

// ---------------------------------------------------------------------------
// Normalization (hostile/partial input is sanitized, never trusted)
// ---------------------------------------------------------------------------

export function normalizeListingTask(raw: unknown): ListingTask {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const src = String(r.sourceUrl || '').trim();
  return {
    sourcePlatform: ['AliExpress', 'Amazon', 'eBay', 'Shopify', 'CJ'].includes(String(r.sourcePlatform))
      ? (r.sourcePlatform as SourcePlatform)
      : 'Other',
    sourceUrl: /^https?:\/\//i.test(src) ? src : '',
    productCount: Math.min(500, Math.max(1, Math.round(Number(r.productCount) || 10))),
    category: String(r.category || 'Other').trim() || 'Other',
    pricing: normalizePricingRule(r.pricing),
    status: r.status === 'active' ? 'active' : 'draft',
    specialInstructions: String(r.specialInstructions || '').trim(),
  };
}

export function normalizePricingRule(raw: unknown): PricingRule {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const mode = r.mode === 'fixed' || r.mode === 'markup' || r.mode === 'min-margin' ? r.mode : 'markup';
  const num = (v: unknown, fb = 0): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fb || null);
  return {
    mode,
    fixedPrice: num(r.fixedPrice),
    markupPct: num(r.markupPct),
    minMarginPct: num(r.minMarginPct),
  };
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

/**
 * Apply the task's pricing rule to a supplier cost → Luxedge selling price.
 * - fixed:       the configured fixed price
 * - markup:      cost × (1 + markup% / 100)
 * - min-margin:  price = cost / (1 − margin% / 100) so (price − cost)/price
 *                is at least the configured margin (falls back to markup 35%
 *                when cost is unknown)
 * Never returns a price below the supplier cost (no negative-margin listings)
 * unless the owner explicitly set a fixed price below cost.
 */
export function applyPricingRule(cost: number | null | undefined, rule: PricingRule): number {
  const c = (cost ?? 0) > 0 ? cost! : 0;
  if (rule.mode === 'fixed' && rule.fixedPrice != null && rule.fixedPrice > 0) {
    return Math.round(rule.fixedPrice * 100) / 100;
  }
  if (rule.mode === 'min-margin' && rule.minMarginPct != null && rule.minMarginPct > 0 && c > 0) {
    const p = c / (1 - Math.min(rule.minMarginPct, 90) / 100);
    return Math.round(p * 100) / 100;
  }
  const markup = rule.mode === 'markup' ? (rule.markupPct ?? 35) : 35;
  if (c > 0) return Math.round(c * (1 + markup / 100) * 100) / 100;
  // No cost evidence — a fixed price is the only honest option.
  return rule.fixedPrice != null && rule.fixedPrice > 0 ? Math.round(rule.fixedPrice * 100) / 100 : 0;
}

// ---------------------------------------------------------------------------
// Product-link discovery (from a fetched category/search/product page)
// ---------------------------------------------------------------------------

const PLATFORM_LINK_PATTERNS: Record<SourcePlatform, RegExp[]> = {
  AliExpress: [/\/item\/[a-z0-9_-]+/i, /\/item\//i, /aliexpress\.(com|us)\/i\/[0-9]+/i],
  Amazon: [/\/dp\/[A-Z0-9]{10}/i, /\/gp\/product\/[A-Z0-9]{10}/i, /\/product\/[A-Z0-9]{10}/i],
  eBay: [/\/itm\/[0-9]+/i],
  Shopify: [/\/products\/[a-z0-9-]+/i],
  CJ: [/\/product\/[a-z0-9-]+/i, /\/products\//i],
  Other: [/\/product[s]?\/[a-z0-9-]+/i, /\/item\/[a-z0-9_-]+/i, /\/dp\/[A-Z0-9]{10}/i],
};

const HREF_RE = /href\s*=\s*["']([^"']+)["']/gi;

function absolutize(href: string, base: string): string | null {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

function looksLikeProductLink(url: string, platform: SourcePlatform): boolean {
  const u = url.toLowerCase();
  const patterns = PLATFORM_LINK_PATTERNS[platform] || PLATFORM_LINK_PATTERNS.Other;
  if (!patterns.some((p) => p.test(u))) return false;
  // Exclude navigation/utility URLs that happen to contain product-ish paths.
  if (/\/cart\b|\/login\b|\/account\b|\/wishlist\b|\/checkout\b|\/search\?|\/help\b|\/about\b|\/contact\b/i.test(u)) return false;
  return true;
}

/**
 * Extract candidate product links from a fetched source page. Returns unique,
 * absolute, platform-relevant links, in page order, capped at `max`.
 */
export function discoverProductLinks(html: string, sourceUrl: string, platform: SourcePlatform, max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const base = sourceUrl || '';
  const srcLower = sourceUrl.toLowerCase();
  for (const m of html.matchAll(HREF_RE)) {
    const abs = absolutize(m[1], base);
    if (!abs) continue;
    const lower = abs.toLowerCase();
    if (lower === srcLower) continue;
    if (!looksLikeProductLink(abs, platform)) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push(abs);
    if (out.length >= max) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Task validation
// ---------------------------------------------------------------------------

export interface TaskValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateListingTask(task: ListingTask): TaskValidationResult {
  const errors: string[] = [];
  if (!/^https?:\/\//i.test(task.sourceUrl)) errors.push('A valid source URL (http/https) is required.');
  if (task.productCount < 1 || task.productCount > 500) errors.push('Product count must be between 1 and 500.');
  if (task.pricing.mode === 'fixed' && !(task.pricing.fixedPrice && task.pricing.fixedPrice > 0)) {
    errors.push('Fixed pricing requires a fixed price greater than 0.');
  }
  if (task.pricing.mode === 'markup' && !(task.pricing.markupPct && task.pricing.markupPct > 0)) {
    errors.push('Markup pricing requires a markup percentage greater than 0.');
  }
  if (task.pricing.mode === 'min-margin' && !(task.pricing.minMarginPct && task.pricing.minMarginPct > 0)) {
    errors.push('Min-margin pricing requires a minimum margin percentage greater than 0.');
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Parse a pasted Listing Task command (free text) into a structured task.
 * Matches the template keywords; everything else is best-effort. Unknown
 * input normalizes to safe defaults and is never executed blindly.
 */
export function parseListingTaskText(text: string, existing?: Partial<ListingTask>): ListingTask {
  const t = (text || '').toLowerCase();
  // Prefer the LONGEST matching option so 'Cattle' beats 'Cat' (substring).
  const pick = <T>(arr: readonly T[], pred: (s: string) => boolean): T | undefined =>
    arr.filter((a) => pred(String(a).toLowerCase())).sort((a, b) => String(b).length - String(a).length)[0];
  const sourcePlatform = pick(['AliExpress', 'Amazon', 'eBay', 'Shopify', 'CJ', 'Other'] as const, (s) => t.includes(s)) || 'Other';
  const category = pick(LISTING_TASK_CATEGORIES, (s) => t.includes(s)) || 'Other';
  const countMatch = /(\d+)\s*(?:products?|items?)/.exec(t);
  const markupMatch = /(\d+)%?\s*(?:markup|margin)/.exec(t);
  const fixedMatch = /\$\s*([\d.]+)/.exec(t);
  const active = /active/.test(t);
  const minMargin = /min(?:imum)?\s*margin/.test(t);
  const sourceUrlMatch = /(https?:\/\/[^\s]+)/.exec(text);
  return normalizeListingTask({
    sourcePlatform,
    sourceUrl: sourceUrlMatch ? sourceUrlMatch[1].replace(/[)\]]+$/, '') : existing?.sourceUrl || '',
    productCount: countMatch ? parseInt(countMatch[1], 10) : existing?.productCount ?? 10,
    category,
    pricing: {
      mode: fixedMatch && !markupMatch ? 'fixed' : minMargin ? 'min-margin' : 'markup',
      fixedPrice: fixedMatch ? parseFloat(fixedMatch[1]) : existing?.pricing?.fixedPrice,
      markupPct: markupMatch ? parseInt(markupMatch[1], 10) : existing?.pricing?.markupPct ?? 35,
      minMarginPct: markupMatch && minMargin ? parseInt(markupMatch[1], 10) : existing?.pricing?.minMarginPct,
    },
    status: active ? 'active' : 'draft',
    specialInstructions: text.trim(),
  });
}