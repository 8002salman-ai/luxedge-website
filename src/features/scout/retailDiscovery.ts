// ============================================================================
// LUXEDGE V2 — RETAIL MARKET-EVIDENCE DISCOVERY (Phase 4E)
//
// MARKET EVIDENCE discovery only. NOT supplier sourcing, NOT CJ research, NOT
// product importing. Finds EXACT single-product retailer pages (Chewy, Target,
// Walmart, …) so the Market Intelligence evidence pack can reach the quality
// gate with real prices / availability / ratings.
//
// Strategy: use the existing controlled public search infrastructure
// (DuckDuckGo HTML via the app's existing fetchRawPage — no new proxies, no
// new credentials), but search each retailer domain INDIVIDUALLY with a
// `site:<domain>` query instead of one generic query.
//
// HONESTY:
//   * A URL pattern is recorded but is NOT sufficient evidence — the evidence
//     pack still validates each page by CONTENT (title + >=2 product signals).
//   * A URL list is search-result breadth / market-supply visibility — never
//     labeled sales, orders, search volume, or consumer demand.
// ============================================================================

import { fetchRawPage, extractLinks, decodeRedirectUrl, cleanUrl } from './discover';
import { evidenceUrlRejectionReason } from './marketEvidence';

/** Initial USA evidence domains (site-restricted). */
export const RETAIL_EVIDENCE_DOMAINS = ['chewy.com', 'target.com', 'walmart.com'];

/** Optional additional domains — NOT required to work. */
export const OPTIONAL_RETAIL_EVIDENCE_DOMAINS = ['petco.com', 'petsmart.com', 'tractorsupply.com'];

/** Hard cap on the number of site-restricted search requests per run. */
export const MAX_RETAIL_SEARCH_REQUESTS = 8;

export interface RetailEvidenceSearchOptions {
  /** Market hypothesis, e.g. "dog travel accessories". */
  query: string;
  market?: string;
  /** Retailer domains to search individually (default RETAIL_EVIDENCE_DOMAINS). */
  domains?: string[];
  /** Max URLs kept per domain (default 2). */
  maxPerDomain?: number;
  /** Max URLs across all domains (default 8). */
  maxTotal?: number;
  /** Injectable raw-page fetcher (defaults to the existing public path). */
  fetchRaw?: (url: string) => Promise<string>;
}

export interface RetailEvidenceCandidate {
  url: string;
  domain: string;
  /** e.g. "DuckDuckGo HTML (site-restricted)". */
  source: string;
  /** The exact site: query that surfaced this URL. */
  query: string;
  observedAt: string;
  /** URL-level only — content is validated later by the evidence pack. */
  confidence: 'inferred';
  /** Whether the URL matches the domain's verified single-product pattern. */
  productUrlPatternMatched: boolean;
}

export interface RetailEvidenceSearchResult {
  query: string;
  candidates: RetailEvidenceCandidate[];
  /** Same-domain URLs dropped for not being exact single-product pages. */
  rejected: { url: string; reason: string }[];
  /** Number of site-restricted search requests actually issued. */
  searchRequests: number;
  domainsAttempted: string[];
  domainsWithResults: string[];
  warning?: string;
}

/** Provider-neutral retail evidence discovery contract. */
export interface RetailEvidenceDiscoveryAdapter {
  searchExactProducts(opts: RetailEvidenceSearchOptions): Promise<RetailEvidenceSearchResult>;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Retailers with a VERIFIED single-product URL pattern (Phase 4E live proof:
 * Chewy /dp/, Target /p/…/A-, Walmart /ip/). For these, ONLY pattern-matched
 * URLs are accepted — content-level validation alone cannot reject rich
 * collection/search pages (chewy /deals/, target /s/, walmart /c/kp/).
 * Future domains WITHOUT a verified pattern remain permissive (URL-level
 * category filters + the evidence pack's content validation apply).
 */
export const STRICT_PATTERN_DOMAINS = new Set(['chewy.com', 'target.com', 'walmart.com']);

/**
 * Verified single-product URL patterns — encoded from CURRENT public search
 * results (Phase 4E live proof), not invented from memory. A pattern match is
 * recorded on the candidate but is NEVER sufficient evidence on its own: the
 * evidence pack validates page CONTENT before counting a page as usable.
 */
export function retailProductUrlPattern(url: string): { matched: boolean; pattern?: string } {
  const h = hostOf(url);
  const p = url.toLowerCase();
  if (h === 'chewy.com' || h.endsWith('.chewy.com')) {
    return /\/dp\/\d/.test(p) ? { matched: true, pattern: 'chewy:/dp/<id>' } : { matched: false };
  }
  if (h === 'target.com' || h.endsWith('.target.com')) {
    return /\/p\//.test(p) && /\/a-\d+/.test(p) ? { matched: true, pattern: 'target:/p/.../A-<id>' } : { matched: false };
  }
  if (h === 'walmart.com' || h.endsWith('.walmart.com')) {
    return /\/ip\//.test(p) && /\/\d+$/.test(p) ? { matched: true, pattern: 'walmart:/ip/<id>' } : { matched: false };
  }
  return { matched: false };
}

/**
 * DuckDuckGo HTML site-restricted implementation. One search request per
 * domain, capped, deduped, exact-product-URL filtered. Uses the EXISTING
 * fetchRawPage infrastructure — no new proxy services, no new credentials.
 */
export class DuckDuckGoRetailDiscoveryAdapter implements RetailEvidenceDiscoveryAdapter {
  constructor(
    private readonly fetchRaw: (url: string) => Promise<string> = fetchRawPage,
    private readonly at: () => string = () => new Date().toISOString()
  ) {}

  async searchExactProducts(opts: RetailEvidenceSearchOptions): Promise<RetailEvidenceSearchResult> {
    const domains = (opts.domains && opts.domains.length ? opts.domains : RETAIL_EVIDENCE_DOMAINS)
      .slice(0, MAX_RETAIL_SEARCH_REQUESTS);
    const maxPerDomain = Math.max(1, opts.maxPerDomain ?? 2);
    const maxTotal = Math.max(1, opts.maxTotal ?? 8);
    const observedAt = this.at();

    const candidates: RetailEvidenceCandidate[] = [];
    const rejected: { url: string; reason: string }[] = [];
    const domainsWithResults = new Set<string>();
    const warnings: string[] = [];
    let searchRequests = 0;

    for (const domain of domains) {
      if (candidates.length >= maxTotal) break;
      const query = `site:${domain} ${opts.query.trim()}${opts.market ? ` ${opts.market.trim()}` : ''}`.trim();
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      searchRequests++;
      let raw = '';
      try {
        raw = await this.fetchRaw(searchUrl);
      } catch (e) {
        warnings.push(`${domain}: search unreachable (${(e as Error).message})`);
        continue;
      }
      if (!raw || raw.trim().length < 100) {
        warnings.push(`${domain}: no usable search content`);
        continue;
      }

      const seen = new Set<string>();
      const perDomain: { url: string; matched: boolean }[] = [];
      for (const link of extractLinks(raw)) {
        const real = decodeRedirectUrl(link);
        if (!real) continue;
        const clean = cleanUrl(real);
        if (hostOf(clean) !== domain) continue;           // site-restricted: same domain only
        if (seen.has(clean)) continue;
        seen.add(clean);
        const urlReason = evidenceUrlRejectionReason(clean);
        if (urlReason) {
          rejected.push({ url: clean, reason: urlReason });
          continue;
        }
        const { matched } = retailProductUrlPattern(clean);
        // Strict mode for pattern-verified retailers: only exact single-product
        // URLs are accepted (rich collection/search pages would otherwise pass
        // content validation as "usable" evidence — Phase 4E live finding).
        if (STRICT_PATTERN_DOMAINS.has(domain) && !matched) {
          rejected.push({ url: clean, reason: 'not a verified single-product URL pattern for this retailer' });
          continue;
        }
        perDomain.push({ url: clean, matched });
      }
      // Prefer pattern-matched single-product URLs, then other exact pages.
      perDomain.sort((a, b) => (b.matched ? 1 : 0) - (a.matched ? 1 : 0));
      const kept = perDomain.slice(0, maxPerDomain);
      if (kept.length) domainsWithResults.add(domain);
      for (const k of kept) {
        candidates.push({
          url: k.url,
          domain,
          source: 'DuckDuckGo HTML (site-restricted)',
          query,
          observedAt,
          confidence: 'inferred',
          productUrlPatternMatched: k.matched,
        });
        if (candidates.length >= maxTotal) break;
      }
    }

    return {
      query: opts.query,
      candidates,
      rejected,
      searchRequests,
      domainsAttempted: domains,
      domainsWithResults: [...domainsWithResults],
      warning: warnings.length ? warnings.join('; ') : undefined,
    };
  }
}
