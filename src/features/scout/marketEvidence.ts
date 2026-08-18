// ============================================================================
// LUXEDGE V2 — MARKET EVIDENCE PACK (Phase 4D)
//
// The owner audit found the live Market Intelligence evidence pack was too
// thin: signalsFromDiscovery supplies only DuckDuckGo URL counts + domain
// diversity, because NO researched-page extracts were passed into MI. This
// module fixes that architecture:
//
//   discovery → select 6-8 strongest EXACT product pages → fetch/research them
//   → extract real facts (price, availability, rating, review count, brand,
//     variants, shipping, category) → MarketSignal pack → deterministic score
//   → EVIDENCE QUALITY GATE → DeepSeek ONLY after the gate passes.
//
// HONESTY: nothing is invented. Missing fields stay missing (extractPageFacts
// already returns null/unknown for absent facts). The quality gate uses
// conservative, CONFIGURABLE defaults — they are not universal business truth.
// ============================================================================

import { extractPageFacts } from './extract';
import type { FetchedSourcePage, PageExtract } from './types';

/** Conservative evidence-quality gate defaults (configurable per job). */
export interface EvidenceQualityThresholds {
  /** Minimum usable exact product pages. */
  minPages: number;
  /** Minimum independent source domains. */
  minDomains: number;
  /** Minimum products with a verified price. */
  minPriceEvidence: number;
  /** Minimum products with availability evidence. */
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
  /** Number of usable extracted product pages (non-empty title). */
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
  /** Pages showing positive availability. */
  availabilityEvidenceCount: number;
}

export interface EvidenceQualityAssessment {
  pass: boolean;
  /** Exact missing-evidence reasons (empty when pass). */
  missing: string[];
  /** Human-readable summary of what the pack did contain. */
  reasons: string[];
  counts: EvidenceCounts;
}

/** Count evidence from a set of extracts (shared by both builder paths). */
export function countExtractEvidence(extracts: { title: string; extract: PageExtract }[]): Omit<EvidenceCounts, 'independentDomains'> {
  let usablePages = 0;
  let price = 0;
  let rating = 0;
  let availability = 0;
  for (const { extract } of extracts) {
    if (extract.title) usablePages++;
    if (extract.price !== null) price++;
    if (extract.rating !== null || extract.reviewCount !== null) rating++;
    if (extract.availability === 'available') availability++;
  }
  return {
    usablePages,
    attemptedPages: extracts.length,
    successfulExtracts: extracts.length,
    failedExtracts: 0,
    priceEvidenceCount: price,
    ratingEvidenceCount: rating,
    availabilityEvidenceCount: availability,
  };
}

/**
 * Select ~maxPages STRONGEST exact product pages from a discovery result.
 * Prefers exact product pages over category/search/directory pages, prefers
 * diverse domains (round-robin so one retailer cannot dominate), dedupes by
 * canonical host+path, and caps at maxPages (default 8). Deterministic — no
 * network, no AI.
 */
export function selectEvidencePages(urls: string[], maxPages = 8): string[] {
  const canonical = (u: string): string => {
    try {
      const x = new URL(u);
      return `${x.hostname.replace(/^www\./, '').toLowerCase()}${x.pathname.replace(/\/+$/, '').toLowerCase()}`;
    } catch {
      return u;
    }
  };

  const isCategoryLike = (u: string): boolean => {
    const p = u.toLowerCase();
    // Strong single-product markers win FIRST — a product URL is never
    // rejected because of a later generic pattern.
    if (/(\/product[s]?\/|\/item(s)?\/|\/p\/|\/dp\/|\/gp\/|\/pd\/)/.test(p)) return false;
    // Category / search / directory / listing patterns — NOT single products.
    if (/(\/category\/|\/categories\/|\/search\?|\/search\/|\/collection(s)?\/|\/catalog\/|\/listing\/|\/products\?|\/shop\?|\/browse\/|\/directory\/|\/department\/)/.test(p)) return true;
    if (/\/tags\/|\/tag\/|\/brand(s)?\/|\/manufacturer(s)?\//.test(p)) return true;
    // Retailer search/browse markers (Amazon /s?k=, /b?node=; Chewy /b/;
    // Target /c/.../-/N-; /product-category/).
    if (/(\/s\?k=|\/b\?node=|\/product-category\/|\/-\/n-|\/b\/)/.test(p)) return true;
    // Listicles / guides / rankings (e.g. "dog-toy-brands-in-the-usa",
    // "14-usa-cat-toys", "/top-10", "/best-", "/lists/",
    // "/made-in-the-usa" collection pages).
    if (/(\/blog\/|\/guide(s)?\/|listicle|\/lists\/|\/top-\d+|\/best-|-brands?-in-|\/\d{1,4}-[a-z])/.test(p)) return true;
    if (/\/(made-in-the-usa|made-in-usa|usa-made)$/.test(p)) return true;
    return false;
  };

  const seen = new Set<string>();
  const selected: string[] = [];
  for (const u of urls) {
    const c = canonical(u);
    if (seen.has(c)) continue;
    seen.add(c);
    if (isCategoryLike(u)) continue;
    selected.push(u);
    if (selected.length >= maxPages) break;
  }
  return selected;
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

export interface EvidencePackOptions {
  /** Exact product URLs to research (post-selection). */
  urls: string[];
  /** Fetcher — the app's secure /api/fetch-page path in the browser/preview. */
  fetchPage: (url: string) => Promise<FetchedSourcePage>;
  maxPages?: number;
  onProgress?: (msg: string) => void;
}

export interface MarketEvidencePack {
  /** URLs selected for research. */
  selectedUrls: string[];
  /** Successful extracted page facts (fed to signalsFromExtracts). */
  extracts: { title: string; extract: PageExtract }[];
  /** Fetched-but-failed-to-extract URLs (recorded honestly). */
  failedUrls: string[];
  independentDomains: number;
  counts: EvidenceCounts;
}

/**
 * Build the market evidence pack: select → fetch → extract. Uses ONLY the
 * existing secure page-fetch infrastructure + extractPageFacts (no parallel
 * fake logic). Missing facts stay missing — nothing is invented.
 */
export async function buildMarketEvidencePack(opts: EvidencePackOptions): Promise<MarketEvidencePack> {
  const { urls, fetchPage, onProgress } = opts;
  const max = Math.max(1, Math.min(opts.maxPages ?? 8, 12));
  const selected = selectEvidencePages(urls, max);
  const extracts: { title: string; extract: PageExtract }[] = [];
  const failedUrls: string[] = [];

  // Fetch sequentially with a cap — controlled research, never dozens of pages.
  for (const url of selected) {
    try {
      const page = await fetchPage(url);
      const extract = extractPageFacts(page);
      if (!extract.title) {
        failedUrls.push(url);
        onProgress?.(`[evidence] ${url.slice(0, 70)} — fetched but no extractable product title`);
        continue;
      }
      extracts.push({ title: extract.title, extract });
      onProgress?.(`[evidence] ${extract.title.slice(0, 60)} — price ${extract.price !== null ? `$${extract.price}` : 'unknown'}, availability ${extract.availability}`);
    } catch (e) {
      failedUrls.push(url);
      onProgress?.(`[evidence] ${url.slice(0, 70)} — fetch failed: ${(e as Error).message}`);
    }
  }

  const base = countExtractEvidence(extracts);
  const domains = independentDomains(selected.filter((u) => !failedUrls.includes(u)));
  return {
    selectedUrls: selected,
    extracts,
    failedUrls,
    independentDomains: domains,
    counts: {
      ...base,
      independentDomains: domains,
      failedExtracts: failedUrls.length,
      attemptedPages: selected.length,
    },
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
    reasons.push(`availability evidence on ${counts.availabilityEvidenceCount} products`);
  }
  if (counts.ratingEvidenceCount < thresholds.minRatingEvidence) {
    missing.push(`rating/review evidence on ${counts.ratingEvidenceCount} products (need >= ${thresholds.minRatingEvidence})`);
  } else if (thresholds.minRatingEvidence > 0) {
    reasons.push(`rating/review evidence on ${counts.ratingEvidenceCount} products`);
  }
  if (counts.failedExtracts > 0) {
    reasons.push(`${counts.failedExtracts} pages fetched but not extractable`);
  }

  return { pass: missing.length === 0, missing, reasons, counts };
}
