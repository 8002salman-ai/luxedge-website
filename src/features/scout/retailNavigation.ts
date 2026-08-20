// ============================================================================
// LUXEDGE V2 — RETAIL NAVIGATION DISCOVERY (Phase 4E.2)
//
// A retailer LISTING / search / category page is a NAVIGATION SOURCE ONLY. It
// is never market/product evidence itself. Flow:
//
//   retailer search/listing page
//     → fetch page
//     → extract exact PDP links
//     → validate PDP URL (retailer pattern + URL-level category filters)
//     → those PDPs feed the normal evidence pack (fetch → extract → validate
//       page CONTENT before counting as usable evidence)
//
// The listing page contributes ZERO price / rating / availability evidence and
// ZERO Market Score points.
//
// Provider-neutral contract (RetailNavigationAdapter) so future sources can be
// added without touching the engine. No credentials. Uses ONLY the app's
// existing secure page-fetch infrastructure (/api/fetch-page in the browser /
// preview) — no new proxies.
// ============================================================================

import { extractLinks, cleanUrl } from './discover';
import { retailProductUrlPattern } from './retailDiscovery';
import { evidenceUrlRejectionReason } from './marketEvidence';
import type { FetchedSourcePage } from './types';

/** Max retailer listing/search pages used as navigation sources per run. */
export const MAX_NAV_LISTING_SOURCES = 3;
/** Max PDP links accepted from navigation per run. */
export const MAX_NAV_PDP_LINKS = 8;
/** Max PDPs kept per retailer (when more are extracted). */
export const MAX_NAV_PDP_PER_RETAILER = 2;

export interface RetailNavigationOptions {
  /** The retailer listing/search page to navigate FROM (never evidence itself). */
  sourceUrl: string;
  /** Optional retailer label (defaults to the source URL's host). */
  retailer?: string;
  /** Max PDP links to return from this source (default MAX_NAV_PDP_LINKS). */
  maxLinks?: number;
}

export interface RetailNavigationResult {
  sourceUrl: string;
  retailer: string;
  /** Validated exact PDP URLs extracted from the listing page. */
  pdpUrls: string[];
  /** Non-PDP / invalid links with exact rejection reasons. */
  rejected: { url: string; reason: string }[];
  observedAt: string;
}

/** Provider-neutral retail navigation contract (Phase 4E.2 §8). */
export interface RetailNavigationAdapter {
  discoverProductLinks(opts: RetailNavigationOptions): Promise<RetailNavigationResult>;
}

/** Canonical domain of a URL (www-stripped, lowercased). */
export function retailerOfUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function canonicalKey(u: string): string {
  try {
    const x = new URL(u);
    return `${x.hostname.replace(/^www\./, '').toLowerCase()}${x.pathname.replace(/\/+$/, '').toLowerCase()}`;
  } catch {
    return u;
  }
}

export interface ExtractionResult {
  pdpUrls: string[];
  rejected: { url: string; reason: string }[];
}

/**
 * Pure extraction: from a fetched retailer listing page's TEXT (Jina-reader
 * text with markdown/HTML/bare links), return ONLY exact same-domain PDP URLs
 * that match the retailer's verified single-product pattern. A URL pattern is
 * NEVER sufficient evidence — the evidence pack still validates page CONTENT.
 * The listing page itself contributes nothing to the evidence counts.
 */
export function extractNavigationPdpUrls(text: string, sourceUrl: string): ExtractionResult {
  const retailer = retailerOfUrl(sourceUrl);
  const seen = new Set<string>();
  const pdpUrls: string[] = [];
  const rejected: { url: string; reason: string }[] = [];

  for (const rawLink of extractLinks(text || '')) {
    const clean = cleanUrl(rawLink);
    if (!/^https?:\/\//i.test(clean)) continue;
    if (retailerOfUrl(clean) !== retailer) {
      rejected.push({ url: clean, reason: 'off-domain link' });
      continue;
    }
    const key = canonicalKey(clean);
    if (seen.has(key)) {
      rejected.push({ url: clean, reason: 'duplicate PDP link' });
      continue;
    }
    seen.add(key);
    const urlReason = evidenceUrlRejectionReason(clean);
    if (urlReason) {
      rejected.push({ url: clean, reason: urlReason });
      continue;
    }
    const { matched } = retailProductUrlPattern(clean);
    if (!matched) {
      rejected.push({ url: clean, reason: 'not a verified single-product URL pattern for this retailer' });
      continue;
    }
    pdpUrls.push(clean);
  }
  return { pdpUrls, rejected };
}

/**
 * Fetch-based implementation over the app's existing secure page fetcher
 * (`/api/fetch-page` in the browser / preview). Sequential single-page
 * fetches; a failed listing fetch is recorded as a rejection, never a crash.
 */
export class FetchingRetailNavigationAdapter implements RetailNavigationAdapter {
  constructor(
    private readonly fetchPage: (url: string) => Promise<FetchedSourcePage>,
    private readonly at: () => string = () => new Date().toISOString()
  ) {}

  async discoverProductLinks(opts: RetailNavigationOptions): Promise<RetailNavigationResult> {
    const maxLinks = Math.max(1, Math.min(opts.maxLinks ?? MAX_NAV_PDP_LINKS, MAX_NAV_PDP_LINKS));
    const retailer = opts.retailer || retailerOfUrl(opts.sourceUrl);
    const observedAt = this.at();
    let text = '';
    try {
      const page = await this.fetchPage(opts.sourceUrl);
      text = page.text || '';
    } catch (e) {
      return {
        sourceUrl: opts.sourceUrl,
        retailer,
        pdpUrls: [],
        rejected: [{ url: opts.sourceUrl, reason: `listing fetch failed: ${(e as Error).message}` }],
        observedAt,
      };
    }
    const { pdpUrls, rejected } = extractNavigationPdpUrls(text, opts.sourceUrl);
    return {
      sourceUrl: opts.sourceUrl,
      retailer,
      pdpUrls: pdpUrls.slice(0, maxLinks),
      rejected,
      observedAt,
    };
  }
}
