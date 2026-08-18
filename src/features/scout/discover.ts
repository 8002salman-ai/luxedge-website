// ============================================================================
// LUXEDGE V2 — SCOUT AUTONOMOUS DISCOVERY (Phase 4A closure)
//
// Query-based discovery: turn a plain-language query ("dog toys", "pet
// accessories") into a deduped list of real product-page URLs, then hand
// them to the existing research pipeline. Manual URL mode stays available
// as an advanced option in the admin UI.
//
// Discovery uses PUBLIC search endpoints only (DuckDuckGo HTML) fetched
// through the same proxies the importer already uses — no scraping
// credentials, no brittle proxy chains, no secrets in the browser.
// ============================================================================

import { hostOf } from './normalize';

export interface DiscoverOptions {
  /** Plain-language query, e.g. "dog toys" or "pet accessories". */
  query: string;
  /** Target market appended to the query, e.g. "USA". */
  market?: string;
  /** Maximum number of URLs to return (default 25). */
  maxResults?: number;
  /** Optional max supplier cost — used to bias the query, not fabricate data. */
  maxSupplierCost?: number;
  /** Optional category keyword (dog/cat/grooming/…) appended to the query. */
  category?: string;
}

/**
 * Concrete pet product types used to expand a generic query ("pet
 * accessories") into real product searches. Each becomes its own search so a
 * category-level query still surfaces actual product pages. Never invents
 * results — it only broadens the query into honest product terms.
 */
export const QUERY_EXPANSIONS = [
  'dog toy',
  'cat toy',
  'dog bed',
  'dog harness',
  'dog collar',
  'cat scratching post',
  'pet grooming brush',
  'dog leash',
  'cat carrier',
  'dog bowl',
  'pet first aid kit',
  'dog puzzle toy',
  'cat tunnel',
  'pet water fountain',
  'dog treat dispenser',
];

export interface DiscoverResult {
  query: string;
  /** Raw links extracted from the search results (pre-filter). */
  rawLinks: string[];
  /** Links after product-page filtering + dedupe. */
  urls: string[];
  /** How many raw links were dropped as non-product pages. */
  filtered: number;
  /** How many were dropped as duplicates. */
  duplicates: number;
  /** Optional warning (e.g. "search endpoint unreachable"). */
  warning?: string;
}

/** Decode a DuckDuckGo /l/?uddg= redirect URL into the real target. */
export function decodeRedirectUrl(href: string): string | null {
  try {
    const u = new URL(href);
    const uddg = u.searchParams.get('uddg');
    if (uddg) return uddg;
    // Some links are already direct (no uddg wrapper).
    if (u.hostname === 'duckduckgo.com' && u.pathname === '/l/') return null;
    return href;
  } catch {
    return null;
  }
}

/** Extract http(s) links from raw search-result text (HTML or markdown). */
export function extractLinks(raw: string): string[] {
  const out = new Set<string>();
  // Markdown links: [title](url)
  for (const m of raw.matchAll(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)) {
    out.add(m[1]);
  }
  // HTML <a href="...">
  for (const m of raw.matchAll(/<a[^>]+href=["'](https?:\/\/[^"']+)["']/gi)) {
    out.add(m[1]);
  }
  // Bare URLs
  for (const m of raw.matchAll(/(https?:\/\/[^\s<>"')\]]+)/g)) {
    const s = m[1].replace(/[.,;:!?]+$/, '');
    if (/^https?:\/\//i.test(s)) out.add(s);
  }
  return [...out];
}

/** Strip tracking params and trailing slashes for a stable product URL. */
export function cleanUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    // Remove common tracking params.
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'mc_cid', 'mc_eid']) {
      u.searchParams.delete(k);
    }
    let s = u.toString();
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) s = s.replace(/([^/])\/$/, '$1');
    return s;
  } catch {
    return url;
  }
}

const NON_PRODUCT_PATH = /^\/(?:search|category|categories|collections?|shop(?:-[a-z]+)?(?:\/|$)|account|login|cart|checkout|about|contact|privacy|terms|blog|news|faq|help|sitemap|track|support|wishlist|gift|deals?|sale|clearance|brands?|vendors?|policies?|returns|shipping|stores?|wholesale)(?:[/?#]|$)/i;

/** Listing/nav segments that must never be treated as product pages. */
const LISTING_SEGMENT = /^(?:search|category|categories|collections?|shop|account|login|cart|checkout|about|contact|privacy|terms|blog|news|faq|help|sitemap|track|support|wishlist|gift|deals?|sale|clearance|brands?|vendors?|returns|shipping|stores?|wholesale|products(?:-all)?|all|new|featured|index|home)$/i;

const BLOCKED_DOMAINS = /(?:duckduckgo|bing|google|yahoo|facebook|instagram|pinterest|youtube|tiktok|reddit|wikipedia|wikihow|aliexpress\.com\/category|amazon\.(?:com|co\.uk|de|ca)\/(?:s\?|b\/|gp\/bestsellers|gp\/new-releases|stores|events))/i;

/** Heuristic: is this link likely a single product page (not a listing)? */
export function isLikelyProductPage(url: string): boolean {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    const host = u.hostname;
    if (BLOCKED_DOMAINS.test(host + u.pathname)) return false;
    const path = u.pathname;
    // Must have a real path (a domain root is a listing, not a product).
    if (path.length < 2 || path === '/') return false;
    // Category/search/account/cart/blog paths are not single products.
    if (NON_PRODUCT_PATH.test(path)) return false;
    const segments = path.split('/').filter(Boolean);
    // Deep product paths (>= 2 segments) are almost always product pages.
    if (segments.length >= 2) return true;
    // Single-segment path: reject listing/nav segments and generic plurals
    // (dog-toys, collars, beds = listings; kong-classic = a product). The
    // research pipeline is the real product filter — discovery only avoids
    // category/blog/search pages.
    const seg = segments[0];
    if (LISTING_SEGMENT.test(seg)) return false;
    if (/s$/.test(seg) && /^(?:dog|cat|pet|toy|bed|bowl|collar|leash|groom|accessor|suppl)[a-z-]*s$/i.test(seg)) return false;
    return true;
  } catch {
    return false;
  }
}

/** Dedupe a URL list by canonical host+path, preferring the first seen. */
export function dedupeUrls(urls: string[]): { urls: string[]; duplicates: number } {
  const seen = new Set<string>();
  const out: string[] = [];
  let duplicates = 0;
  for (const raw of urls) {
    const clean = cleanUrl(raw);
    const key = dedupeKeyForUrl(clean);
    if (!key || seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    out.push(clean);
  }
  return { urls: out, duplicates };
}

function dedupeKeyForUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = hostOf(url);
    // Ignore query strings except real product IDs on known retail hosts.
    const q = /(?:chewy|petco|amazon)\./i.test(host) ? u.search : '';
    return `${host}${u.pathname.replace(/\/+$/, '')}${q}`;
  } catch {
    return '';
  }
}

/**
 * Build the DuckDuckGo HTML search URL from the query + options.
 * Market/category/cost bias the query text — they never invent results.
 */
export function buildSearchUrl(opts: DiscoverOptions): string {
  const parts = [opts.query.trim(), opts.market?.trim(), opts.category?.trim()].filter(Boolean);
  if (opts.maxSupplierCost && opts.maxSupplierCost > 0) {
    parts.push(`under $${opts.maxSupplierCost}`);
  }
  const q = parts.join(' ');
  return `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
}

/**
 * Build the concrete search queries for one discovery run. A generic
 * category-level query ("pet accessories") is expanded into specific pet
 * product types so real product pages surface; a product-specific query
 * ("KONG Classic dog toy") is searched as-is.
 */
export function buildQueries(opts: DiscoverOptions): string[] {
  const q = opts.query.trim();
  if (!q) return [];
  const market = opts.market?.trim() || '';
  const cost = opts.maxSupplierCost && opts.maxSupplierCost > 0 ? ` under $${opts.maxSupplierCost}` : '';
  const suffix = [market, cost].filter(Boolean).join(' ');
  const mk = (term: string) => [term, suffix].filter(Boolean).join(' ');

  // Product-specific: contains a concrete product noun or brand word → search
  // the ORIGINAL query as-is. A product-specific seed query (e.g. a CJ-seeded
  // concept like "single door dog cage") must NEVER be replaced by unrelated
  // generic QUERY_EXPANSIONS — the original query is the authoritative search
  // term. The noun list covers the concrete pet-product vocabulary actually
  // used by the Phase 4F CJ seed concepts (cage, playpen, mat, blanket, ramp,
  // sofa, bag, backpack, trailer, seat belt, clothes, shoe, fence, saucer, …).
  if (/\b(?:kong|chuckit|west paw|frisco|nylabone|barkbox|petfusion|outward hound)\b|\b(?:toy|bed|harness|collar|leash|brush|carrier|fountain|dispenser|scratch|tunnel|bowl|kennel|crate|cage|playpen|pen|mat|blanket|ramp|sofa|bag|backpack|trailer|seat ?belt|clothes|clothing|shirt|sweater|shoe|shoes|fence|stroller|bottle|saucer|ball|puzzle|treat|supplement|shampoo|clipper|groomer|towel|pad|house|igloo|jacket|boots|necklace|feeder|perch)\b/i.test(q)) {
    return [mk(q)];
  }
  // Generic category query → expand into concrete product types.
  return QUERY_EXPANSIONS.map((term) => mk(term));
}

/**
 * Run autonomous discovery: fetch search results through the provided fetcher
 * (defaults to the importer's public-proxy path), decode redirects, filter to
 * product pages, dedupe, and return up to maxResults URLs.
 *
 * The fetcher receives the search URL and returns raw page text/markdown.
 * Returns a warning instead of throwing when the search endpoint is
 * unreachable, so the admin UI can show "try manual URL mode" honestly.
 */
export async function discoverUrls(
  opts: DiscoverOptions,
  fetchRaw: (url: string) => Promise<string> = fetchRawPage
): Promise<DiscoverResult> {
  const queries = buildQueries(opts);
  if (!queries.length) {
    return { query: opts.query, rawLinks: [], urls: [], filtered: 0, duplicates: 0, warning: 'Empty query.' };
  }

  const max = Math.max(1, opts.maxResults ?? 25);
  const seenLinks = new Set<string>();
  const urls: string[] = [];
  let filtered = 0;
  let duplicates = 0;
  let warning = '';

  for (const query of queries) {
    const url = buildSearchUrl({ ...opts, query });
    let raw = '';
    try {
      raw = await fetchRaw(url);
    } catch (e) {
      warning = `Search endpoint unreachable for “${query}”: ${(e as Error).message}`;
      continue;
    }
    if (!raw || raw.trim().length < 100) {
      warning = warning || `Search returned no usable content for “${query}”.`;
      continue;
    }
    for (const link of extractLinks(raw)) {
      const real = decodeRedirectUrl(link);
      if (!real) continue;
      if (seenLinks.has(real)) { duplicates++; continue; }
      seenLinks.add(real);
      if (!isLikelyProductPage(real)) { filtered++; continue; }
      const clean = cleanUrl(real);
      if (!urls.includes(clean)) urls.push(clean);
      if (urls.length >= max) break;
    }
    if (urls.length >= max) break;
  }

  return {
    query: opts.query,
    rawLinks: [...seenLinks],
    urls: urls.slice(0, max),
    filtered,
    duplicates,
    warning: warning || undefined,
  };
}

/**
 * Default raw fetcher: try the server proxy first (production), then the
 * public Jina Reader (returns markdown with links preserved), then allorigins.
 * Mirrors the importer's proxy chain so nothing new is added to the bundle.
 */
export async function fetchRawPage(url: string): Promise<string> {
  // Server proxy (production only; returns null in Vite dev).
  try {
    const r = await fetch(`/api/fetch-page?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(40_000),
      headers: { Accept: 'text/plain' },
    });
    if (r.ok) {
      const ct = r.headers.get('content-type') || '';
      const text = await r.text();
      if (!ct.includes('text/html') && !ct.includes('javascript') && !/<!doctype html/i.test(text)) {
        return text;
      }
    }
  } catch {
    /* fall through */
  }
  const proxies: { label: string; url: string }[] = [
    { label: 'Jina Reader', url: `https://r.jina.ai/${encodeURIComponent(url)}` },
    { label: 'allorigins', url: `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}` },
  ];
  let lastErr = '';
  for (const { label, url: proxy } of proxies) {
    try {
      const r = await fetch(proxy, { signal: AbortSignal.timeout(30_000), redirect: 'follow' });
      if (r.ok) {
        const text = await r.text();
        if (text.trim().length >= 100) return text;
        lastErr = `${label}: empty`;
      } else {
        lastErr = `${label}: HTTP ${r.status}`;
      }
    } catch (e) {
      lastErr = `${label}: ${(e as Error).message}`;
    }
  }
  throw new Error(lastErr || 'no proxy available');
}
