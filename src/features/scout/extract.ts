// ============================================================================
// LUXEDGE V2 — SCOUT PAGE EXTRACTOR
//
// Rule-based extraction from a fetched source page (no AI, no credits). Only
// facts actually present in the page text/images are extracted; anything not
// found stays UNKNOWN. The caller keeps the raw text as evidence.
// ============================================================================

import type { PageExtract, FetchedSourcePage } from './types';
import { normalizeTitle, parsePrice, parseRating, parseReviewCount } from './normalize';

const AVAILABLE_RE = /\b(?:in stock|in-stock|usually ships|ships in|add to cart|available)\b/i;
const UNAVAILABLE_RE = /\b(?:out of stock|sold out|unavailable|currently unavailable|discontinued)\b/i;
const FREE_SHIP_RE = /\b(?:free shipping|free delivery|free 2-day)\b/i;
const SHIP_DAYS_RE = /(?:ships|delivery|arrives|shipping)\s+(?:within\s+|in\s+)?(\d{1,2})(?:\s*(?:-|–|to)\s*(\d{1,2}))?\s*(?:business\s*)?days/i;
const ORIGIN_RE = /\bmade in\s+([A-Za-z][A-Za-z\s-]{1,20})/i;
const SIZES_RE = /\bsizes?:?\s*([A-Za-z0-9][A-Za-z0-9,\s\/\-]{0,60})/i;

/** Pull the title from common page markers, falling back to the first line. */
function extractTitle(text: string): string | null {
  const og = text.match(/og:title[:\s]+([^\n]{5,160})/i);
  if (og && og[1]) return normalizeTitle(og[1]);
  const h1 = text.match(/^#\s+(.+)$/m);
  if (h1 && h1[1]) return normalizeTitle(h1[1]);
  const jsonLd = text.match(/"name"\s*:\s*"([^"]{5,160})"/);
  if (jsonLd && jsonLd[1]) return normalizeTitle(jsonLd[1]);
  // Jina Reader prefixes pages with "Title: ..." and "URL Source: ...".
  const jinaTitle = text.match(/^Title:\s*(.+)$/m);
  if (jinaTitle && jinaTitle[1]) {
    const t = normalizeTitle(jinaTitle[1]);
    if (t.length >= 5 && t.length <= 160 && !/^(http|url source)/i.test(t)) return t;
  }
  // First meaningful line of body text (skip proxy artifacts).
  for (const line of text.split('\n')) {
    const t = normalizeTitle(line.replace(/^Title:\s*/i, ''));
    if (t.length >= 8 && t.length <= 160 && !t.startsWith('http') && !/^(url source|markdown content)/i.test(t)) return t;
  }
  return null;
}

/** Extract sizes like "S, M, L" or "5kg/10kg" (conservative: 1–6 tokens). */
function extractSizes(text: string): string[] | null {
  const m = text.match(SIZES_RE);
  if (!m || !m[1]) return null;
  const tokens = m[1].split(/[,/]+/).map((s) => s.trim()).filter((s) => s.length >= 1 && s.length <= 12);
  if (tokens.length === 0 || tokens.length > 8) return null;
  return tokens;
}

/**
 * Turn a fetched source page into structured facts. `price` uses the FIRST
 * USD value found — the source may list multiple prices, so the caller can
 * re-verify against the raw text before approving.
 */
export function extractPageFacts(page: FetchedSourcePage): PageExtract {
  const text = page.text || '';
  const title = extractTitle(text);
  const price = parsePrice(text);

  let availability: PageExtract['availability'] = 'unknown';
  if (UNAVAILABLE_RE.test(text)) availability = 'unavailable';
  else if (AVAILABLE_RE.test(text)) availability = 'available';

  let shippingDays: PageExtract['shippingDays'] = null;
  const daysMatch = text.match(SHIP_DAYS_RE);
  if (daysMatch) {
    const min = parseInt(daysMatch[1], 10);
    const max = daysMatch[2] ? parseInt(daysMatch[2], 10) : min;
    if (Number.isFinite(min) && Number.isFinite(max) && min >= 1 && max <= 60) {
      shippingDays = { min, max };
    }
  }

  const originMatch = text.match(ORIGIN_RE);
  const origin = originMatch && originMatch[1] ? originMatch[1].trim() : null;

  return {
    title,
    price,
    images: page.images || [],
    availability,
    shippingDays,
    freeShipping: FREE_SHIP_RE.test(text),
    rating: parseRating(text),
    reviewCount: parseReviewCount(text),
    origin,
    sizes: extractSizes(text),
  };
}

/** Human-readable summary used in evidence notes. */
export function describeExtract(e: PageExtract): string[] {
  const parts: string[] = [];
  parts.push(`Title: ${e.title ?? 'UNKNOWN'}`);
  parts.push(`Price: ${e.price !== null ? '$' + e.price.toFixed(2) : 'UNKNOWN'}`);
  parts.push(`Availability: ${e.availability}`);
  parts.push(e.shippingDays ? `Delivery: ${e.shippingDays.min}-${e.shippingDays.max} days` : 'Delivery window: UNKNOWN');
  parts.push(`Free shipping: ${e.freeShipping ? 'yes' : 'not stated'}`);
  parts.push(`Images: ${e.images.length}`);
  parts.push(`Rating: ${e.rating !== null ? e.rating + '/5' : 'UNKNOWN'}`);
  parts.push(`Reviews: ${e.reviewCount !== null ? e.reviewCount : 'UNKNOWN'}`);
  parts.push(`Origin: ${e.origin ?? 'UNKNOWN'}`);
  return parts;
}
