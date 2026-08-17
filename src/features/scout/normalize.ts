// ============================================================================
// LUXEDGE V2 — SCOUT NORMALIZATION + DEDUPE
//
// Pure helpers: slugify, supplier-from-domain, price parsing, and duplicate
// detection keys. No I/O — fully unit-testable.
// ============================================================================

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
