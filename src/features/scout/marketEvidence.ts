// ============================================================================
// LUXEDGE V2 — MARKET EVIDENCE PACK (Phase 4D + Phase 4E)
//
//   discovery → select 6-8 strongest EXACT product pages → fetch/research them
//   → extract real facts (price, availability, rating, review count, brand,
//     variants, shipping, category) → MarketSignal pack → deterministic score
//   → EVIDENCE QUALITY GATE → DeepSeek ONLY after the gate passes.
//
// Phase 4E changes:
//   * selectEvidencePages now round-robins across domains (one strong URL per
//     domain first, then a second pass up to maxPerDomain=2) so one retailer
//     cannot occupy the whole pack when other independent domains exist.
//   * availabilityEvidenceCount = pages with EXPLICIT availability evidence
//     (available OR unavailable); availableCount = positive availability only.
//     The quality gate uses availabilityEvidenceCount; the market opportunity
//     availability scoring continues to use positive availability.
//   * reviewCountEvidenceCount / totalObservedReviews recorded where safely
//     extractable (never republished as Luxedge reviews).
//   * a page counts as usable exact-product evidence only when it has a title
//     AND at least TWO of {price, availability, rating/review, real images,
//     selectable variants, product attribute/brand}. Listicles/category pages
//     cannot count merely because they contain a price-like string. Exact
//     rejection reasons are persisted per URL.
//
// HONESTY: nothing is invented. Missing fields stay missing (extractPageFacts
// already returns null/unknown for absent facts). The quality gate uses
// conservative, CONFIGURABLE defaults — they are not universal business truth.
// ============================================================================

import { extractPageFacts } from './extract';
import type { FetchedSourcePage, PageExtract } from './types';
import { identityEvidenceFromExtract, hasExplicitIdentity, aggregateReviewEvidence } from './identity';

/** Conservative evidence-quality gate defaults (configurable per job). */
export interface EvidenceQualityThresholds {
  /** Minimum usable exact product pages. */
  minPages: number;
  /** Minimum independent source domains. */
  minDomains: number;
  /** Minimum products with a verified price. */
  minPriceEvidence: number;
  /** Minimum products with explicit availability evidence (available or unavailable). */
  minAvailabilityEvidence: number;
  /** Minimum pages with rating/review evidence (0 = "where obtainable"). */
  minRatingEvidence: number;
}

export const DEFAULT_EVIDENCE_QUALITY: EvidenceQualityThresholds = {
  minPages: 4,
  minDomains: 3,
  minPriceEvidence: 3,
  minAvailabilityEvidence: 3,
  minRatingEvidence: 0,
};

export interface EvidenceCounts {
  /** Number of usable extracted exact-product pages (title + >=2 signals). */
  usablePages: number;
  /** Number of pages attempted (fetched). */
  attemptedPages: number;
  successfulExtracts: number;
  failedExtracts: number;
  /** Independent source domains across successful extracts. */
  independentDomains: number;
  /** Products with a verified price. */
  priceEvidenceCount: number;
  /** Pages with rating OR review-count evidence. */
  ratingEvidenceCount: number;
  /** Pages with a review-count number (where safely extractable). */
  reviewCountEvidenceCount: number;
  /** Sum of extractable review counts (never republished as Luxedge reviews). */
  totalObservedReviews: number;
  /** Pages with EXPLICIT availability evidence (available OR unavailable). */
  availabilityEvidenceCount: number;
  /** Pages showing POSITIVE availability only. */
  availableCount: number;
  /** Pages showing explicit OUT OF STOCK. */
  unavailableCount: number;
}

export interface EvidenceQualityAssessment {
  pass: boolean;
  /** Exact missing-evidence reasons (empty when pass). */
  missing: string[];
  /** Human-readable summary of what the pack did contain. */
  reasons: string[];
  counts: EvidenceCounts;
}

const EMPTY_COUNTS: EvidenceCounts = {
  usablePages: 0,
  attemptedPages: 0,
  successfulExtracts: 0,
  failedExtracts: 0,
  independentDomains: 0,
  priceEvidenceCount: 0,
  ratingEvidenceCount: 0,
  reviewCountEvidenceCount: 0,
  totalObservedReviews: 0,
  availabilityEvidenceCount: 0,
  availableCount: 0,
  unavailableCount: 0,
};

/** Empty counts for the no-pack fallback path. */
export function emptyEvidenceCounts(): EvidenceCounts {
  return { ...EMPTY_COUNTS };
}

/** Count evidence from a set of extracts (shared by both builder paths). */
export function countExtractEvidence(extracts: { title: string; extract: PageExtract }[]): Omit<EvidenceCounts, 'independentDomains'> {
  let usablePages = 0;
  let price = 0;
  let rating = 0;
  let reviewPages = 0;
  let totalReviews = 0;
  let availability = 0;
  let available = 0;
  let unavailable = 0;
  for (const { extract } of extracts) {
    if (extract.title) usablePages++;
    if (extract.price !== null) price++;
    if (extract.rating !== null || extract.reviewCount !== null) rating++;
    if (extract.reviewCount !== null) {
      reviewPages++;
      if (extract.reviewCount > 0) totalReviews += extract.reviewCount;
    }
    if (extract.availability === 'available') {
      availability++;
      available++;
    } else if (extract.availability === 'unavailable') {
      availability++;
      unavailable++;
    }
  }
  return {
    usablePages,
    attemptedPages: extracts.length,
    successfulExtracts: extracts.length,
    failedExtracts: 0,
    priceEvidenceCount: price,
    ratingEvidenceCount: rating,
    reviewCountEvidenceCount: reviewPages,
    totalObservedReviews: totalReviews,
    availabilityEvidenceCount: availability,
    availableCount: available,
    unavailableCount: unavailable,
  };
}

function canonicalKey(u: string): string {
  try {
    const x = new URL(u);
    return `${x.hostname.replace(/^www\./, '').toLowerCase()}${x.pathname.replace(/\/+$/, '').toLowerCase()}`;
  } catch {
    return u;
  }
}

function domainOf(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Exact rejection reason for a URL that is NOT a single-product page, or null
 * when the URL may be an exact product page. Product-marker URLs always win —
 * a product URL is never rejected because of a later generic pattern.
 */
export function evidenceUrlRejectionReason(url: string): string | null {
  const p = url.toLowerCase();
  const h = domainOf(url);
  // First path segment (e.g. "/b/", "/s/", "/deals/") — collection markers
  // are anchored to the FIRST segment so a plain segment name inside a real
  // product slug (e.g. walmart.com/ip/b/2) is never misread as a collection.
  let firstSeg = '';
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean)[0] || '';
    if (seg) firstSeg = `/${seg.toLowerCase()}/`;
  } catch { /* keep empty */ }
  // Strong single-product markers win FIRST.
  if (/(\/product[s]?\/|\/item(s)?\/|\/p\/|\/dp\/|\/gp\/|\/pd\/)/.test(p)) return null;
  // Category / search / directory / listing patterns — NOT single products.
  if (/(\/category\/|\/categories\/|\/search\?|\/search\/|\/collection(s)?\/|\/catalog\/|\/listing\/|\/products\?|\/shop\?|\/browse\/|\/directory\/|\/department\/)/.test(p)) return 'category/search page URL';
  if (/\/tags\/|\/tag\/|\/brand(s)?\/|\/manufacturer(s)?\//.test(p)) return 'brand/tag listing URL';
  // Retailer search/browse markers (Amazon /s?k=, /b?node=; Target /c/.../-/N-;
  // /product-category/; first-segment /deals/).
  if (/(\/s\?k=|\/b\?node=|\/product-category\/|\/-\/n-|\/deals\/)/.test(p)) return 'retailer browse/search URL';
  if (firstSeg === '/deals/') return 'retailer deals/browse URL';
  // Phase 4E live finding — host-specific FIRST-SEGMENT collection/search
  // markers that surfaced in real site-restricted results (content-level
  // validation alone cannot reject rich collection pages, so the URL is the
  // discriminator). Anchored so /ip/b/2 or /ip/c/3 are never misread.
  if (h === 'target.com' && firstSeg === '/s/') return 'retailer search URL (target /s/)';
  if (h === 'chewy.com' && firstSeg === '/f/') return 'retailer collection/filter URL (chewy /f/)';
  if (h === 'chewy.com' && firstSeg === '/b/') return 'retailer browse URL (chewy /b/)';
  if (h === 'walmart.com' && p.includes('/c/kp/')) return 'retailer category URL (walmart /c/kp/)';
  // Listicles / guides / rankings (e.g. "dog-toy-brands-in-the-usa",
  // "14-usa-cat-toys", "/top-10", "/best-", "/lists/", "/made-in-the-usa"
  // collection pages).
  if (/(\/blog\/|\/guide(s)?\/|listicle|\/lists\/|\/top-\d+|\/best-|-brands?-in-|\/\d{1,4}-[a-z])/.test(p)) return 'listicle/collection/guide URL';
  if (/\/(made-in-the-usa|made-in-usa|usa-made)$/.test(p)) return 'brand collection page URL';
  return null;
}

export interface SelectionDetail {
  selected: string[];
  /** Every non-selected URL with its exact reason. */
  rejected: { url: string; reason: string }[];
}

/**
 * Select ~maxPages STRONGEST exact product pages with DOMAIN ROUND-ROBIN:
 *   1. canonical dedupe
 *   2. reject non-exact-product URLs (with reasons)
 *   3. group by domain
 *   4. first pass takes max ONE strong product URL per domain
 *   5. subsequent passes take a second page per domain as capacity allows
 *   6. stop at maxPages (default 8); maxPerDomain (default 2) per domain.
 * Deterministic — no network, no AI.
 */
export function selectEvidencePagesDetailed(urls: string[], maxPages = 8, maxPerDomain = 2): SelectionDetail {
  const seen = new Set<string>();
  const byDomain = new Map<string, string[]>();
  const rejected: { url: string; reason: string }[] = [];

  for (const u of urls) {
    const c = canonicalKey(u);
    if (seen.has(c)) {
      rejected.push({ url: u, reason: 'duplicate URL' });
      continue;
    }
    seen.add(c);
    const reason = evidenceUrlRejectionReason(u);
    if (reason) {
      rejected.push({ url: u, reason });
      continue;
    }
    const d = domainOf(u);
    const list = byDomain.get(d) ?? [];
    list.push(u);
    byDomain.set(d, list);
  }

  const selected: string[] = [];
  const counts = new Map<string, number>();
  const domains = [...byDomain.keys()];
  let pass = 0;
  while (selected.length < maxPages && pass < maxPerDomain) {
    let progressed = false;
    for (const d of domains) {
      if (selected.length >= maxPages) break;
      const list = byDomain.get(d)!;
      if (pass >= list.length) continue;
      const c = counts.get(d) ?? 0;
      if (c >= maxPerDomain) continue;
      selected.push(list[pass]);
      counts.set(d, c + 1);
      progressed = true;
    }
    if (!progressed) break;
    pass++;
  }

  // URLs that did not fit within the domain quota → exact rejection reason.
  for (const d of domains) {
    const list = byDomain.get(d)!;
    const used = counts.get(d) ?? 0;
    for (let i = used; i < list.length; i++) {
      rejected.push({ url: list[i], reason: `domain quota reached (max ${maxPerDomain} per domain)` });
    }
  }

  return { selected, rejected };
}

/** Convenience wrapper returning only the selected URLs. */
export function selectEvidencePages(urls: string[], maxPages = 8, maxPerDomain = 2): string[] {
  return selectEvidencePagesDetailed(urls, maxPages, maxPerDomain).selected;
}

/** Independent domains across a set of URLs (deduped, www-stripped). */
export function independentDomains(urls: string[]): number {
  const hosts = new Set<string>();
  for (const u of urls) {
    try {
      hosts.add(new URL(u).hostname.replace(/^www\./, '').toLowerCase());
    } catch { /* ignore */ }
  }
  return hosts.size;
}

/**
 * Count the product signals a page actually carries (Phase 4E exact-product
 * validation). Signals: price, explicit availability, rating/review evidence,
 * real images, selectable variants (sizes), product attribute/brand (origin).
 */
export function exactProductSignalCount(extract: PageExtract): number {
  let n = 0;
  if (extract.price !== null) n++;
  if (extract.availability !== 'unknown') n++;
  if (extract.rating !== null || extract.reviewCount !== null) n++;
  if (extract.images.length > 0) n++;
  if (extract.sizes !== null) n++;
  if (extract.origin !== null) n++;
  return n;
}

/**
 * A page counts as usable exact-product evidence ONLY when it has a title AND
 * at least TWO of the six product signals. A listicle/category/search page
 * cannot count merely because it contains a price-like string.
 */
export function validateExactProduct(extract: PageExtract): { usable: boolean; reason: string | null } {
  if (!extract.title) return { usable: false, reason: 'no extractable product title' };
  const n = exactProductSignalCount(extract);
  if (n < 2) {
    return { usable: false, reason: `fetched but only ${n} of 2 required product signals (needs 2+ of price/availability/rating/reviews/images/variants/origin)` };
  }
  return { usable: true, reason: null };
}

export interface EvidencePackOptions {
  /** Exact product URLs to research (post-selection). */
  urls: string[];
  /** Fetcher — the app's secure /api/fetch-page path in the browser/preview. */
  fetchPage: (url: string) => Promise<FetchedSourcePage>;
  maxPages?: number;
  maxPerDomain?: number;
  onProgress?: (msg: string) => void;
}

export interface MarketEvidencePack {
  /** URLs selected for research. */
  selectedUrls: string[];
  /** Successful extracted exact-product pages (fed to signalsFromExtracts). */
  extracts: { url: string; title: string; extract: PageExtract }[];
  /** Fetched-but-failed-to-extract URLs (recorded honestly). */
  failedUrls: string[];
  /** Non-selected or invalid URLs with their exact rejection reasons. */
  rejectedUrls: { url: string; reason: string }[];
  independentDomains: number;
  counts: EvidenceCounts;
  // Phase 4G — product identity honesty. Pages with explicit identity
  // evidence (brand/model/MPN/SKU/UPC) and the review-aggregation note.
  identityEvidencePages: number;
  reviewAggregationNote: string;
}

/**
 * Build the market evidence pack: select → fetch → extract → validate exact
 * product. Uses ONLY the existing secure page-fetch infrastructure +
 * extractPageFacts (no parallel fake logic). Missing facts stay missing —
 * nothing is invented. Fetched pages that fail exact-product validation are
 * recorded in rejectedUrls with their exact reason.
 */
export async function buildMarketEvidencePack(opts: EvidencePackOptions): Promise<MarketEvidencePack> {
  const { urls, fetchPage, onProgress } = opts;
  const max = Math.max(1, Math.min(opts.maxPages ?? 8, 12));
  const maxPerDomain = Math.max(1, opts.maxPerDomain ?? 2);
  const selection = selectEvidencePagesDetailed(urls, max, maxPerDomain);
  const rejectedUrls = [...selection.rejected];
  const extracts: { url: string; title: string; extract: PageExtract }[] = [];
  const failedUrls: string[] = [];

  // Fetch sequentially with a cap — controlled research, never dozens of pages.
  for (const url of selection.selected) {
    try {
      const page = await fetchPage(url);
      const extract = extractPageFacts(page);
      if (!extract.title) {
        failedUrls.push(url);
        onProgress?.(`[evidence] ${url.slice(0, 70)} — fetched but no extractable product title`);
        continue;
      }
      const check = validateExactProduct(extract);
      if (!check.usable) {
        rejectedUrls.push({ url, reason: check.reason || 'not exact product evidence' });
        onProgress?.(`[evidence] ${url.slice(0, 70)} — rejected: ${check.reason}`);
        continue;
      }
      extracts.push({ url, title: extract.title, extract });
      onProgress?.(`[evidence] ${extract.title.slice(0, 60)} — price ${extract.price !== null ? `$${extract.price}` : 'unknown'}, availability ${extract.availability}`);
    } catch (e) {
      failedUrls.push(url);
      onProgress?.(`[evidence] ${url.slice(0, 70)} — fetch failed: ${(e as Error).message}`);
    }
  }

  const base = countExtractEvidence(extracts);
  const domains = independentDomains(extracts.map((x) => x.url));
  // Phase 4G — identity evidence across the usable pages. A product family is
  // not the same exact product; review counts are never summed across
  // non-exact identities.
  const identities = extracts.map((x) => identityEvidenceFromExtract(x.extract));
  const identityEvidencePages = identities.filter((i) => hasExplicitIdentity(i)).length;
  const reviewAgg = aggregateReviewEvidence(identities);
  return {
    selectedUrls: selection.selected,
    extracts,
    failedUrls,
    rejectedUrls,
    independentDomains: domains,
    counts: {
      ...base,
      independentDomains: domains,
      failedExtracts: failedUrls.length,
      attemptedPages: selection.selected.length,
    },
    identityEvidencePages,
    reviewAggregationNote: reviewAgg.note,
  };
}

/**
 * Evidence-quality gate — run BEFORE any DeepSeek spend. If the pack is too
 * thin, the AI is NOT called and the caller reports MARKET EVIDENCE
 * INSUFFICIENT with the exact missing evidence.
 */
export function assessEvidenceQuality(
  counts: EvidenceCounts,
  thresholds: EvidenceQualityThresholds = DEFAULT_EVIDENCE_QUALITY
): EvidenceQualityAssessment {
  const missing: string[] = [];
  const reasons: string[] = [];

  if (counts.usablePages < thresholds.minPages) {
    missing.push(`only ${counts.usablePages} usable exact product pages (need >= ${thresholds.minPages})`);
  } else {
    reasons.push(`${counts.usablePages} usable exact product pages`);
  }
  if (counts.independentDomains < thresholds.minDomains) {
    missing.push(`only ${counts.independentDomains} independent source domains (need >= ${thresholds.minDomains})`);
  } else {
    reasons.push(`${counts.independentDomains} independent domains`);
  }
  if (counts.priceEvidenceCount < thresholds.minPriceEvidence) {
    missing.push(`price evidence on ${counts.priceEvidenceCount} products (need >= ${thresholds.minPriceEvidence})`);
  } else {
    reasons.push(`price evidence on ${counts.priceEvidenceCount} products`);
  }
  if (counts.availabilityEvidenceCount < thresholds.minAvailabilityEvidence) {
    missing.push(`availability evidence on ${counts.availabilityEvidenceCount} products (need >= ${thresholds.minAvailabilityEvidence})`);
  } else {
    reasons.push(`availability evidence on ${counts.availabilityEvidenceCount} products (${counts.availableCount} available)`);
  }
  if (counts.ratingEvidenceCount < thresholds.minRatingEvidence) {
    missing.push(`rating/review evidence on ${counts.ratingEvidenceCount} products (need >= ${thresholds.minRatingEvidence})`);
  } else if (thresholds.minRatingEvidence > 0) {
    reasons.push(`rating/review evidence on ${counts.ratingEvidenceCount} products`);
  }
  if (counts.failedExtracts > 0) {
    reasons.push(`${counts.failedExtracts} pages fetched but not extractable`);
  }
  if (counts.reviewCountEvidenceCount > 0) {
    reasons.push(`${counts.reviewCountEvidenceCount} pages with review counts (${counts.totalObservedReviews} total observed, never republished as Luxedge reviews)`);
  }

  return { pass: missing.length === 0, missing, reasons, counts };
}
