// ============================================================================
// LUXEDGE V2 — AI PRODUCT IMPORTER
//
// Page fetching uses PUBLIC proxy services only — no scraping credentials
// live in the browser. Credential-backed scraping (e.g. scrape.do) is done
// server-side via /api/fetch-page with the token in an environment variable.
// ============================================================================

import type { AIExtractedProduct } from './types';
import type { ProductInput, CatalogImageInput, CatalogVariantInput } from '../catalog/repository';
import type { CommerceReadiness } from '../catalog/commerceReadiness';
import { getAccessToken } from '../../services/supabase';

function looksLikeBotPage(raw: string): boolean {
  const lower = raw.toLowerCase();
  return raw.length < 15000 && (
    lower.includes('just a moment') || lower.includes('cf-challenge') || lower.includes('challenge-platform') ||
    lower.includes('captcha') || lower.includes('unusual traffic') || lower.includes('access denied') ||
    lower.includes('are you a robot') || lower.includes('verify you are human') || lower.includes('one more step') ||
    lower.includes('security check') || lower.includes('pardon our interruption') || lower.includes('robot check') ||
    // AliExpress anti-bot "punish" page (sufei) — served to scrapers instead of
    // the product page. Contains zero product data and must never count as
    // page content (live finding: a 10KB punish page produced 54 empty fields).
    lower.includes('sufei-punish') || lower.includes('punish-page') || lower.includes('bx-pu-') ||
    /punish\?recaptcha=1/i.test(lower)
  );
}

/**
 * Jina Reader also returns BLOCKED-SNAPSHOT pages when its own crawl was
 * blocked (e.g. "## www.target.com is blocked … ERR_BLOCKED_BY_CLIENT").
 * That text is NOT a page — it must never count as product evidence.
 */
function looksLikeJinaBlockSnapshot(raw: string): boolean {
  const lower = raw.toLowerCase();
  return raw.length < 15000 && (
    lower.includes('err_blocked_by_client') ||
    lower.includes('page has been blocked by chrome') ||
    lower.includes('this page has been blocked') ||
    lower.includes('is blocked by the browser')
  );
}

/**
 * Jina Reader returns "Warning: <host> URL returned error <code>: ..." when
 * the target page failed (429/403/404/…). That text is NOT a page and must
 * never be counted as product evidence (Phase 4E live finding: a 429
 * "Warning:" text was being marked as availability evidence).
 */
const JINA_ERROR_RE = /^Warning:\s+.+?\bURL returned error\s+\d{3}\b/im;

/** True when fetched text is a proxy error page, not a real page. */
export function isProxyErrorText(text: string): boolean {
  return JINA_ERROR_RE.test(text) || looksLikeBotPage(text) || looksLikeJinaBlockSnapshot(text);
}

interface FetchedPage {
  text: string;
  images: string[];
  /** og:title or JSON-LD Product name — deterministic, not AI-dependent. */
  title: string;
  /** og:description or JSON-LD Product description. */
  description: string;
  /** JSON-LD offers price (VERIFIED from the page) when present. */
  price: number | null;
  /** JSON-LD offers priceCurrency when present. */
  currency: string;
  /** JSON-LD brand name when explicitly present. */
  brand: string;
  /** True when a JSON-LD Product block was found. */
  jsonLdProduct: boolean;
}

/**
 * Try the server-side proxy (/api/fetch-page) first: it is SSRF-guarded and
 * uses SCRAPE_DO_TOKEN when configured (token never ships to the browser).
 * Returns null when the endpoint is unreachable (e.g. Vite dev server).
 */
async function fetchViaServerProxy(url: string): Promise<string | null> {
  // AliExpress alternates between the real page, its anti-bot "punish" page,
  // and transient 5xx. One request often fails even though the product IS
  // retrievable, so retry a few times with backoff before falling back to
  // public proxies (live finding: same URL returned 502 then the real page).
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // /api/fetch-page is admin-only (Phase 3A). Attach the signed-in admin
      // access token so the server-side scrape path (SCRAPE_DO_TOKEN) actually
      // runs on the deployed app instead of silently 401-ing and falling back
      // to public proxies. Never logs the token.
      const token = getAccessToken();
      const r = await fetch(`/api/fetch-page?url=${encodeURIComponent(url)}`, {
        signal: AbortSignal.timeout(45_000),
        headers: { Accept: 'text/plain', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!r.ok) {
        if (attempt < MAX_ATTEMPTS) { await new Promise((res) => setTimeout(res, 1200 * attempt)); continue; }
        return null;
      }
      const ct = r.headers.get('content-type') || '';
      const text = await r.text();
    // The Vite dev server answers unknown /api routes with the SPA index HTML,
    // and serves api/* source files as JS modules. Content-Type distinguishes
    // those responses. A real /api/fetch-page success is deliberately returned
    // as text/plain even though its body is the target page's complete HTML.
    if (ct.includes('text/html') || ct.includes('javascript') || ct.includes('application/json')) return null;
    // Guard against the dev server leaking local source files (import statements).
    if (/^import\s+\{/.test(text.trim())) return null;
    // A Jina/bot error page is NOT the requested page — treat as a proxy
    // failure and retry (punish pages are transient).
    if (isProxyErrorText(text)) {
      if (attempt < MAX_ATTEMPTS) { await new Promise((res) => setTimeout(res, 1200 * attempt)); continue; }
      return null;
    }
    return text;
    } catch {
      if (attempt < MAX_ATTEMPTS) { await new Promise((res) => setTimeout(res, 1200 * attempt)); continue; }
      return null;
    }
  }
  return null;
}

/** Fetch a product page through the server proxy first, then public proxies. */
export async function fetchPageContent(url: string): Promise<string> {
  const isAli = /aliexpress\.(com|us)/i.test(url);

  const serverText = await fetchViaServerProxy(url);
  if (serverText !== null) {
    const parsed = parseHtmlPage(serverText);
    if (parsed.text.trim().length >= 100 && !looksLikeBotPage(serverText)) {
      return JSON.stringify(parsed);
    }
  }

  const timeout = isAli ? 35000 : 25000;
  const proxies: { label: string; url: string; timeout: number }[] = [
    { label: 'Jina Reader', url: `https://r.jina.ai/${url}`, timeout },
    { label: 'allorigins', url: `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, timeout },
    { label: 'codetabs', url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`, timeout },
    { label: 'corsproxy', url: `https://corsproxy.io/?${encodeURIComponent(url)}`, timeout },
    { label: 'Wayback', url: `https://web.archive.org/web/2024id_/${url}`, timeout },
  ];
  let lastErr = '';
  for (const { label, url: proxy, timeout: t } of proxies) {
    try {
      const r = await fetch(proxy, { signal: AbortSignal.timeout(t), redirect: 'follow' });
      if (r.ok) {
        const raw = await r.text();
        if (raw.length < 200) { lastErr = `${label}: empty response`; continue; }
        if (isProxyErrorText(raw)) { lastErr = `${label}: proxy error/bot page`; continue; }
        if (label === 'corsproxy' && raw.toLowerCase().includes('fix cors errors')) { lastErr = `${label}: proxy homepage`; continue; }
        const parsed = parseHtmlPage(raw);
        if (isAli && label === 'Jina Reader') {
          const titleLine = raw.match(/^Title:\s*(.+)$/m);
          if (!titleLine || !titleLine[1] || !titleLine[1].trim() || titleLine[1].trim().toLowerCase() === 'captcha interception') {
            lastErr = `${label}: AliExpress shell/captcha (product loads via JS)`;
            continue;
          }
        }
        if (isAli && parsed.text.length < 400 && (parsed.text.includes('Download the AliExpress app') || parsed.text.includes("I'm shopping for"))) {
          lastErr = `${label}: AliExpress shell page`;
          continue;
        }
        if (parsed.text.trim().length < 100) { lastErr = `${label}: too little content`; continue; }
        return JSON.stringify(parsed);
      } else {
        lastErr = `${label}: HTTP ${r.status}`;
      }
    } catch (e: any) { lastErr = `${label}: ${e.message}`; }
  }
  if (isAli) {
    throw new Error(`Could not load AliExpress product (${lastErr}). AliExpress blocks automated fetching. Enable server-side scraping (SCRAPE_DO_TOKEN env var, see .env.example) or paste the product HTML/text instead.`);
  }
  throw new Error(`Could not fetch page (${lastErr}). Try pasting HTML or text instead.`);
}

interface JsonLdProduct {
  name: string;
  description: string;
  images: string[];
  price: number | null;
  currency: string;
  brand: string;
}

/** Parse JSON-LD blocks and pull out Product evidence (never fabricates). */
export function parseJsonLdProduct(raw: string): JsonLdProduct {
  const out: JsonLdProduct = { name: '', description: '', images: [], price: null, currency: '', brand: '' };
  const blocks = Array.from(raw.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi))
    .map((m) => m[1]);
  for (const block of blocks) {
    let data: unknown = null;
    try {
      data = JSON.parse(block);
    } catch {
      continue;
    }
    // Walk @graph and nested @type structures to find Product data.
    const nodes: Record<string, unknown>[] = [];
    if (Array.isArray(data)) nodes.push(...(data as Record<string, unknown>[]));
    else if (data && typeof data === 'object') {
      const root = data as Record<string, unknown>;
      nodes.push(root);
      if (Array.isArray(root['@graph'])) nodes.push(...(root['@graph'] as Record<string, unknown>[]));
    }
    for (const node of nodes) {
      const type = Array.isArray(node['@type']) ? (node['@type'] as string[]).join(' ') : String(node['@type'] || '');
      if (!/\bProduct\b/i.test(type) && !(node['@type'] === 'ItemPage' && node['mainEntity'])) continue;
      const target = node['@type'] === 'ItemPage' && node['mainEntity'] ? (node['mainEntity'] as Record<string, unknown>) : node;
      if (typeof target.name === 'string' && target.name && !out.name) out.name = target.name.trim();
      if (typeof target.description === 'string' && target.description && !out.description) out.description = target.description.trim();
      if (typeof target.brand === 'object' && target.brand && typeof (target.brand as Record<string, unknown>).name === 'string') {
        out.brand = String((target.brand as Record<string, unknown>).name).trim();
      } else if (typeof target.brand === 'string' && target.brand) {
        out.brand = target.brand.trim();
      }
      const imgs = target.image ? (Array.isArray(target.image) ? target.image : [target.image]) : [];
      for (const img of imgs) {
        const u = typeof img === 'string' ? img : typeof img === 'object' && img ? String((img as Record<string, unknown>).url || '') : '';
        if (u.startsWith('http')) out.images.push(u);
      }
      const offers = target.offers ? (Array.isArray(target.offers) ? target.offers[0] : target.offers) : null;
      if (offers && typeof offers === 'object') {
        const o = offers as Record<string, unknown>;
        const price = o.price ?? o.lowPrice;
        if (typeof price === 'number' && Number.isFinite(price) && price > 0 && out.price === null) out.price = price;
        if (typeof price === 'string' && price && out.price === null) {
          const n = Number(price.replace(/[^\d.\-]/g, ''));
          if (Number.isFinite(n) && n > 0) out.price = n;
        }
        if (typeof o.priceCurrency === 'string' && o.priceCurrency) out.currency = o.priceCurrency;
      }
    }
  }
  out.images = [...new Set(out.images)].slice(0, 20);
  return out;
}

/** Parse raw HTML or text into structured page evidence without a DOM library. */
export function parseHtmlPage(raw: string): FetchedPage {
  const isHtml = raw.trimStart().startsWith('<') || raw.includes('<html') || raw.includes('<!doctype');
  if (isHtml) {
    // Lightweight extraction — enough for product import prompts.
    const ogTitle = matchMeta(raw, 'og:title');
    const ogDesc = matchMeta(raw, 'og:description');
    const ogImage = matchMeta(raw, 'og:image');
    const ld = parseJsonLdProduct(raw);
    const jsonLdRaw = Array.from(raw.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi))
      .map((m) => m[1])
      .join('\n');
    // AliExpress serves size-suffixed thumbnails (…jpg_220x220q75.jpg_.avif);
    // normalize them back to the base image URL so the real product image is
    // usable, not a 220px placeholder.
    const normalize = (src: string) =>
      src
        .replace(/\.avif$/i, '')
        .replace(/(\.(?:jpe?g|png|webp))_.+$/i, '$1');
    const images = Array.from(raw.matchAll(/<img[^>]+(?:src|data-src)=["']([^"']+)["']/gi))
      .map((m) => normalize(m[1]))
      .filter((src) => src.startsWith('http') && /\.(jpe?g|png|webp|avif)(\?|$)/i.test(src));
    if (ogImage && ogImage.startsWith('http')) images.unshift(normalize(ogImage));
    images.push(...ld.images);
    const bodyText = stripHtml(raw)
      .replace(/[ \t]+/g, ' ')
      .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
    const text = [ogTitle, ogDesc, jsonLdRaw ? `JSON-LD:\n${jsonLdRaw}` : '', bodyText].filter(Boolean).join('\n').slice(0, 12000);
    const dedupImages = [...new Set(images)].slice(0, 30);
    return {
      text,
      images: dedupImages,
      title: ogTitle || ld.name,
      description: ogDesc || ld.description,
      price: ld.price,
      currency: ld.currency,
      brand: ld.brand,
      jsonLdProduct: !!(ld.name || ld.description || ld.images.length || ld.price !== null),
    };
  }
  const images: string[] = [];
  const re = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    if (m[1].match(/\.(jpe?g|png|webp)(\?|$)/i)) images.push(m[1]);
  }
  return { text: raw.slice(0, 12000), images: [...new Set(images)].slice(0, 30), title: '', description: '', price: null, currency: '', brand: '', jsonLdProduct: false };
}

function matchMeta(raw: string, prop: string): string {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i');
  const m = raw.match(re);
  return m ? m[1] : '';
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"');
}

export function buildExtractionPrompt(rawContent: string, sourceType: string): string {
  return `You are an expert e-commerce product data analyst for Luxedge, a premium US pet-supplies store. Extract ONLY what the source actually shows — nothing more.

SOURCE TYPE: ${sourceType}

CONTENT:
${rawContent.slice(0, 10000)}

TRUTH RULES (non-negotiable):
- Classify every field as VERIFIED (explicitly shown), INFERRED (reasonably deduced from shown text), or UNKNOWN (not present). Never guess a missing fact.
- Never invent: cost, shipping, inventory/stock, delivery time, ratings, reviews, order counts, materials, dimensions, or battery/electrical information.
- The supplier LIST price is the retail price shown to shoppers — it is NOT a wholesale/supplier cost. costPrice must be 0/UNKNOWN unless a real wholesale cost is shown.
- Do NOT invent a "was"/compare price. comparePrice is 0/UNKNOWN unless the page shows a real regular/compare price.
- Do NOT estimate a market price. sellingPrice is the supplier list price shown on the page; 0/UNKNOWN if not shown.
- Do NOT invent stock. stock is 0/UNKNOWN unless a real quantity or "in stock" is shown.
- Record the AliExpress item URL + numeric item ID under supplierUrl / supplierItemId (supplier identity evidence).
- Record battery/electrical status and any counterfeit / medicine / supplement / weapon / medical-claim / copyrighted-character indicators under batteryElectrical and riskFlags.

Return ONLY a valid JSON object with this EXACT shape (use "" / [] / 0 for missing values):
{
  "title": "exact supplier title",
  "luxuryTitle": "professional, concise, premium rewrite of the title (factual, no unsupported claims)",
  "seoTitle": "SEO title (60 chars max)",
  "slug": "url-friendly-slug",
  "brand": "brand ONLY if explicitly shown, else \"\"",
  "manufacturer": "",
  "category": "best matching: Dog Supplies | Cat Supplies | Pet Beds | Pet Toys | Feeding & Water | Grooming | Pet Accessories",
  "subcategory": "",
  "collection": "",
  "shortDescription": "2-3 factual sentences",
  "longDescription": "factual description paragraphs",
  "features": ["3-6 factual points taken from the page"],
  "benefits": [],
  "specifications": {"spec name": "value"},
  "packageIncludes": [],
  "weight": "shown weight or \"\"",
  "dimensions": "shown dimensions or \"\"",
  "origin": "shown origin or \"\"",
  "materials": [],
  "colors": [],
  "sizes": [],
  "sku": "",
  "barcode": "",
  "hsCode": "",
  "stock": 0,
  "costPrice": 0,
  "sellingPrice": 0,
  "comparePrice": 0,
  "shippingWeight": "",
  "tags": [],
  "seoKeywords": [],
  "metaTitle": "SEO meta title (60 chars)",
  "metaDescription": "SEO meta description (160 chars)",
  "focusKeyword": "primary SEO keyword",
  "images": [],
  "faqs": [],
  "warranty": "",
  "careInstructions": "",
  "safetyNotes": "",
  "supplierPlatform": "AliExpress",
  "supplierUrl": "the exact source URL",
  "supplierItemId": "numeric item ID from the URL or page, else \"\"",
  "shippingToUsa": "shown USA shipping cost, else \"UNKNOWN\"",
  "deliveryRangeUsa": "shown USA delivery range, else \"UNKNOWN\"",
  "usStockEvidence": "shown stock/availability, else \"UNKNOWN\"",
  "ordersCount": "shown orders/sold count, else \"UNKNOWN\"",
  "ratingValue": "shown rating, else \"UNKNOWN\"",
  "reviewCount": "shown review count, else \"UNKNOWN\"",
  "batteryElectrical": "shown battery/electrical info, else \"UNKNOWN\"",
  "riskFlags": [],
  "variants": [{"attributes":{"Color":"","Size":""},"sku":"","price":0,"image":""}],
  "evidence": {"title":"UNKNOWN","sellingPrice":"UNKNOWN","costPrice":"UNKNOWN","shipping":"UNKNOWN","delivery":"UNKNOWN","stock":"UNKNOWN","materials":"UNKNOWN","dimensions":"UNKNOWN","battery":"UNKNOWN"},
  "confidence": {"title": 0, "price": 0, "description": 0, "specifications": 0, "images": 0, "brand": 0, "category": 0, "tags": 0}
}

Rules:
- luxuryTitle: premium and concise, but never add a claim the source does not support.
- riskFlags: list ONLY genuine flags from this set — ["counterfeit","branded copy","medicine","supplement","unsafe ingestible","battery","copyrighted character","weapon","medical claim"]. Use [] when none apply.
- evidence: use ONLY "VERIFIED", "INFERRED" or "UNKNOWN" per field.
- IMPORTANT: never invent factual specifications that are not present in the content. Leave unknown values empty.
- Return ONLY the JSON, absolutely no other text`;
}

/**
 * Parse an AI response into a structured product. Tolerates markdown fences
 * and leading/trailing noise. Returns null when no JSON object is present.
 */
export function extractProductJson(raw: string): AIExtractedProduct | null {
  if (!raw) return null;
  let candidate = raw;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidate = fenced[1];
  const obj = candidate.match(/(\{[\s\S]*\})/);
  if (!obj) return null;
  try {
    const data = JSON.parse(obj[1]);
    return typeof data === 'object' && data !== null ? (data as AIExtractedProduct) : null;
  } catch {
    return null;
  }
}

/** Normalize a product title for duplicate detection (lowercase, alnum only). */
export function normalizeProductTitle(title: string): string {
  return (title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Extract the numeric AliExpress item ID from a URL or free text, else null. */
export function extractAliExpressItemId(url: string): string | null {
  const s = String(url || '');
  const m = s.match(/\/item\/(\d+)\.html/i) || s.match(/(?:itemId|item_id)[=/](\d+)/i);
  return m ? m[1] : null;
}

/**
 * Extract VERIFIED/INFERRED product evidence embedded in an AliExpress URL.
 * AliExpress blocks automated page fetching (JS-rendered shell), but the
 * shareable item URL itself carries real facts: the item ID, ship-from
 * country, sku id, and (via the pdp_npi tracking param) the list price and a
 * secondary price (usually the estimated shipping). Every field is classified
 * honestly — nothing here is invented.
 */
export interface AliExpressUrlEvidence {
  /** Numeric item ID — VERIFIED from the URL path. */
  itemId: string | null;
  /** ship_from country from pdp_ext_f — VERIFIED when present. */
  shipFrom: string | null;
  /** sku id from pdp_ext_f — VERIFIED when present. */
  skuId: string | null;
  /** List price parsed from pdp_npi — INFERRED (tracking param, not a live page read). */
  listPrice: number | null;
  /** Secondary price from pdp_npi (usually shipping estimate) — INFERRED semantics UNKNOWN. */
  secondaryPrice: number | null;
}

/** Decode a URL-encoded JSON value embedded in a query param, else null. */
function decodeEmbeddedJson(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Parse the AliExpress pdp_npi tracking param. Two real-world formats occur:
 *   A) `{n}@dis!USD!US+$12.13!US+$0.99!...`  (country-prefixed prices)
 *   B) `{n}@dis!USD!4.11!0.99!!!27.52!6.64!...` (bare prices after currency)
 * Returns the first two prices found, classified as list (primary) and
 * secondary (sale/shipping — semantics UNKNOWN). Pure + unit-tested.
 */
export function parsePdpNpi(param: string | null): { listPrice: number | null; secondaryPrice: number | null } {
  if (!param) return { listPrice: null, secondaryPrice: null };
  const marker = '@dis!';
  const idx = param.indexOf(marker);
  const rest = idx >= 0 ? param.slice(idx + marker.length) : param;
  const prices: number[] = [];
  const segs = rest.split('!');
  // Format A: first segment is the currency (e.g. USD); prices carry `CC+$`.
  // Format B: first segment is also the currency; prices are bare decimals.
  const startAt = segs[0] && /^[A-Z]{2,3}$/.test(segs[0].trim()) ? 1 : 0;
  for (const seg of segs.slice(startAt)) {
    let n = NaN;
    const m = /^[A-Z]{2}\+\$([\d.,]+)/.exec(seg.trim());
    if (m) n = Number(m[1].replace(/,/g, ''));
    else if (/^\d{1,3}([.,]\d{2})?$/.test(seg.trim())) n = Number(seg.trim().replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0) prices.push(n);
    if (prices.length >= 2) break;
  }
  return { listPrice: prices[0] ?? null, secondaryPrice: prices[1] ?? null };
}

/**
 * True when an AI extraction returned no usable product evidence at all —
 * e.g. the fetch delivered a bot/anti-crawler page that slipped through
 * detection. Used to fall back to URL evidence instead of a 54-field empty form.
 */
export function isEmptyExtraction(p: AIExtractedProduct | null | undefined): boolean {
  if (!p) return true;
  const hasTitle = !!(p.title || '').trim() || !!(p.luxuryTitle || '').trim();
  const hasPrice = (p.sellingPrice ?? 0) > 0 || (p.costPrice ?? 0) > 0;
  const hasImages = Array.isArray(p.images) && p.images.length > 0;
  const hasDesc = !!(p.shortDescription || '').trim() || !!(p.longDescription || '').trim();
  const hasMeta = !!(p.supplierUrl || '').trim() || !!(p.supplierItemId || '').trim();
  return !hasTitle && !hasPrice && !hasImages && !hasDesc && !hasMeta;
}

/** Extract all real evidence from an AliExpress item URL (never fabricates). */
export function extractAliExpressUrlEvidence(url: string): AliExpressUrlEvidence {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { itemId: extractAliExpressItemId(url), shipFrom: null, skuId: null, listPrice: null, secondaryPrice: null };
  }
  const ext = decodeEmbeddedJson(u.searchParams.get('pdp_ext_f'));
  const { listPrice, secondaryPrice } = parsePdpNpi(u.searchParams.get('pdp_npi'));
  return {
    itemId: extractAliExpressItemId(url),
    shipFrom: typeof ext?.ship_from === 'string' && ext.ship_from ? String(ext.ship_from) : null,
    skuId: typeof ext?.sku_id === 'string' && ext.sku_id ? String(ext.sku_id) : null,
    listPrice,
    secondaryPrice,
  };
}

/**
 * Build a partial AIExtractedProduct from URL evidence alone — used when
 * AliExpress blocks the page fetch so the owner can still start from the real
 * facts the URL proves and fill in the rest. Everything not in the URL stays
 * UNKNOWN/empty.
 */
export function buildUrlEvidenceProduct(url: string): AIExtractedProduct {
  const ev = extractAliExpressUrlEvidence(url);
  const itemId = ev.itemId || '';
  const price = ev.listPrice ?? 0;
  const notes: string[] = [
    `Source URL: ${url}`,
    `Item ID: ${itemId || 'UNKNOWN'}`,
    ev.shipFrom ? `Ship from: ${ev.shipFrom} (from URL pdp_ext_f)` : 'Ship from: UNKNOWN',
    ev.listPrice ? `List price evidence from URL tracking param (pdp_npi): $${ev.listPrice.toFixed(2)} — INFERRED, verify on the live page.` : 'List price: UNKNOWN',
    ev.secondaryPrice ? `Secondary price (usually shipping) from URL param: $${ev.secondaryPrice.toFixed(2)} — INFERRED, verify on the live page.` : '',
    'Automated page fetch was blocked by AliExpress (JS-rendered shell). Verify title, description, images, variants, USA shipping and stock on the live page before saving.',
  ].filter(Boolean);
  return {
    title: '',
    luxuryTitle: '',
    seoTitle: '',
    slug: '',
    brand: '',
    manufacturer: '',
    category: '',
    subcategory: '',
    collection: '',
    shortDescription: '',
    longDescription: '',
    features: [],
    benefits: [],
    specifications: {},
    packageIncludes: [],
    weight: '',
    dimensions: '',
    origin: ev.shipFrom || '',
    materials: [],
    colors: [],
    sizes: [],
    sku: '',
    barcode: '',
    hsCode: '',
    stock: 0,
    costPrice: 0,
    sellingPrice: price,
    comparePrice: 0,
    shippingWeight: '',
    tags: [],
    seoKeywords: [],
    metaTitle: '',
    metaDescription: '',
    focusKeyword: '',
    images: [],
    faqs: [],
    warranty: '',
    careInstructions: '',
    safetyNotes: '',
    confidence: {},
    supplierPlatform: 'AliExpress',
    supplierUrl: url,
    supplierItemId: itemId || undefined,
    shippingToUsa: 'UNKNOWN',
    deliveryRangeUsa: 'UNKNOWN',
    usStockEvidence: 'UNKNOWN',
    ordersCount: 'UNKNOWN',
    ratingValue: 'UNKNOWN',
    reviewCount: 'UNKNOWN',
    batteryElectrical: 'UNKNOWN',
    riskFlags: [],
    variants: [],
    evidence: {
      title: 'UNKNOWN',
      sellingPrice: ev.listPrice ? 'INFERRED' : 'UNKNOWN',
      costPrice: 'UNKNOWN',
      shipping: 'UNKNOWN',
      delivery: 'UNKNOWN',
      stock: 'UNKNOWN',
      materials: 'UNKNOWN',
      dimensions: 'UNKNOWN',
      battery: 'UNKNOWN',
    },
    ownerNotes: notes.join(' | '),
  };
}

/**
 * Build a deterministic AIExtractedProduct from real scraped page evidence
 * (og:title/description, JSON-LD, images, JSON-LD price) PLUS the real facts
 * the URL proves (item ID, ship-from, pdp_npi price). AI is NOT required:
 * this is the base product the Review & Edit screen must always show when the
 * scrape succeeded — AI only enriches it later.
 */
export function buildScrapedEvidenceProduct(page: FetchedPage, url: string): AIExtractedProduct {
  const ev = extractAliExpressUrlEvidence(url);
  const itemId = ev.itemId || extractAliExpressItemId(url) || '';
  // Price priority: JSON-LD verified price from the page > URL pdp_npi evidence.
  const price = page.price && page.price > 0 ? page.price : (ev.listPrice ?? 0);
  const priceVerified = page.price && page.price > 0;
  const notes: string[] = [
    `Source URL: ${url}`,
    `Item ID: ${itemId || 'UNKNOWN'}`,
    ev.shipFrom ? `Ship from: ${ev.shipFrom} (from URL pdp_ext_f)` : 'Ship from: UNKNOWN',
    page.jsonLdProduct ? 'Page JSON-LD product data found (name/description/images/price evidence).' : 'Page JSON-LD product data: not found.',
    priceVerified
      ? `List price from page data: $${page.price!.toFixed(2)} ${page.currency || 'USD'} — page-verified.`
      : (ev.listPrice
        ? `List price evidence from URL tracking param (pdp_npi): $${ev.listPrice.toFixed(2)} — INFERRED, verify on the live page.`
        : 'List price: UNKNOWN'),
    ev.secondaryPrice ? `Secondary price (usually shipping) from URL param: $${ev.secondaryPrice.toFixed(2)} — INFERRED, verify on the live page.` : '',
    'USA shipping, stock, delivery and variant details load via JS — verify on the live page before publish.',
  ].filter(Boolean);
  const shortDesc = page.description.trim();
  return {
    title: page.title.trim(),
    luxuryTitle: '',
    seoTitle: page.title.trim(),
    slug: '',
    brand: page.brand.trim(),
    manufacturer: '',
    category: '',
    subcategory: '',
    collection: '',
    shortDescription: shortDesc,
    longDescription: shortDesc,
    features: [],
    benefits: [],
    specifications: {},
    packageIncludes: [],
    weight: '',
    dimensions: '',
    origin: ev.shipFrom || '',
    materials: [],
    colors: [],
    sizes: [],
    sku: '',
    barcode: '',
    hsCode: '',
    stock: 0,
    costPrice: 0,
    sellingPrice: price,
    comparePrice: 0,
    shippingWeight: '',
    tags: [],
    seoKeywords: [],
    metaTitle: page.title.trim(),
    metaDescription: shortDesc,
    focusKeyword: '',
    images: page.images,
    faqs: [],
    warranty: '',
    careInstructions: '',
    safetyNotes: '',
    confidence: {
      title: page.title.trim() ? 1 : 0,
      price: priceVerified ? 1 : 0,
      description: shortDesc ? 1 : 0,
      images: page.images.length ? 1 : 0,
      brand: page.brand.trim() ? 1 : 0,
      category: 0,
      tags: 0,
      specifications: 0,
    },
    supplierPlatform: 'AliExpress',
    supplierUrl: url,
    supplierItemId: itemId || undefined,
    shippingToUsa: 'UNKNOWN',
    deliveryRangeUsa: 'UNKNOWN',
    usStockEvidence: 'UNKNOWN',
    ordersCount: 'UNKNOWN',
    ratingValue: 'UNKNOWN',
    reviewCount: 'UNKNOWN',
    batteryElectrical: 'UNKNOWN',
    riskFlags: [],
    variants: [],
    evidence: {
      title: page.title.trim() ? 'VERIFIED' : 'UNKNOWN',
      sellingPrice: priceVerified ? 'VERIFIED' : (ev.listPrice ? 'INFERRED' : 'UNKNOWN'),
      costPrice: 'UNKNOWN',
      shipping: 'UNKNOWN',
      delivery: 'UNKNOWN',
      stock: 'UNKNOWN',
      materials: 'UNKNOWN',
      dimensions: 'UNKNOWN',
      battery: 'UNKNOWN',
    },
    ownerNotes: notes.join(' | '),
  };
}

/**
 * Merge deterministic scraped evidence (base) with AI enrichment. Scraped
 * evidence is NEVER erased by AI: empty AI fields fall back to scraped values,
 * and images are the union of both, deduped, strongest (og:image) first.
 */
export function mergeScrapedWithAi(scraped: AIExtractedProduct, ai: AIExtractedProduct | null | undefined): AIExtractedProduct {
  const aiImages = (ai?.images || []).filter((u) => typeof u === 'string' && u.startsWith('http'));
  const mergedImages = [...new Set([...scraped.images, ...aiImages])].filter((u) => u.startsWith('http')).slice(0, 24);
  const pick = (aiVal: string | undefined, scrapedVal: string): string => {
    const v = (aiVal || '').trim();
    return v ? v : scrapedVal.trim();
  };
  const shortDesc = pick(ai?.shortDescription, scraped.shortDescription);
  const longDesc = pick(ai?.longDescription, scraped.longDescription) || shortDesc;
  const title = pick(ai?.title, scraped.title) || scraped.title;
  return {
    ...scraped,
    ...(ai ? { ...ai } : {}),
    // Scraped evidence wins on fields where AI must not erase real data.
    title: title || ai?.luxuryTitle || scraped.title,
    luxuryTitle: ai?.luxuryTitle || title || '',
    seoTitle: pick(ai?.seoTitle, scraped.seoTitle || scraped.title),
    shortDescription: shortDesc,
    longDescription: longDesc,
    metaTitle: pick(ai?.metaTitle, scraped.metaTitle || scraped.title),
    metaDescription: pick(ai?.metaDescription, scraped.metaDescription || shortDesc),
    sellingPrice: (ai?.sellingPrice && ai.sellingPrice > 0 ? ai.sellingPrice : scraped.sellingPrice) || scraped.sellingPrice || 0,
    images: mergedImages,
    supplierUrl: ai?.supplierUrl || scraped.supplierUrl,
    supplierItemId: ai?.supplierItemId || scraped.supplierItemId,
    supplierPlatform: ai?.supplierPlatform || scraped.supplierPlatform || 'AliExpress',
    evidence: { ...scraped.evidence, ...(ai?.evidence || {}) },
    ownerNotes: [scraped.ownerNotes, ai?.ownerNotes].filter(Boolean).join(' | '),
  };
}

export interface AliExpressRiskAssessment {
  /** Hard-restricted — must never become customer-visible. */
  blocked: string[];
  /** Risk-review flags the owner must clear before publish. */
  warnings: string[];
}

/**
 * AliExpress-specific safety gate. Returns hard blockers (counterfeit,
 * medicine/supplement, weapons) and risk-review warnings (battery/electrical,
 * copyrighted characters, medical claims, ingestibles). Never fabricates a flag.
 */
export function assessAliExpressRisk(p: {
  title?: string;
  brand?: string;
  riskFlags?: string[];
  batteryElectrical?: string;
  safetyNotes?: string;
}): AliExpressRiskAssessment {
  const text = [p.title, p.brand, p.batteryElectrical, p.safetyNotes].map((v) => String(v || '')).join(' ').toLowerCase();
  const flags = (p.riskFlags || []).map((f) => String(f).toLowerCase());
  const has = (words: string[]) => words.some((w) => text.includes(w) || flags.some((f) => f.includes(w)));
  const blocked: string[] = [];
  const warnings: string[] = [];
  if (has(['medicine', 'supplement', 'vitamin', 'pharmaceutical', 'cbd', 'tablet', 'capsule'])) blocked.push('Medicine/supplement');
  if (has(['counterfeit', 'replica', 'branded copy', 'copy of', 'knockoff'])) blocked.push('Counterfeit/branded copy');
  if (has(['weapon', 'taser', 'pepper spray', 'knife', 'blade'])) blocked.push('Weapon');
  if (has(['battery', 'rechargeable', 'lithium', 'li-ion', 'electric', 'charger', 'power bank'])) warnings.push('Battery/electrical — risk review');
  if (has(['disney', 'pokemon', 'pokémon', 'marvel', 'hello kitty', 'star wars', 'nintendo', 'harry potter'])) warnings.push('Copyrighted character — IP risk');
  if (has(['cure', 'heal', 'pain relief', 'anxiety relief', 'calming', 'therapeutic', 'medical grade'])) warnings.push('Medical/therapeutic claim — regulatory review');
  if (has(['treat', 'edible', 'food', 'chewable', 'ingestible'])) warnings.push('Ingestible — food safety review');
  return { blocked: [...new Set(blocked)], warnings: [...new Set(warnings)] };
}

// ---------------------------------------------------------------------------
// AliExpress import → catalog persistence mapping (pure, no DB side effects)
// ---------------------------------------------------------------------------

/**
 * Derive the honest commerce-readiness for a freshly imported AliExpress draft.
 * Safety risks are evaluated first; the product is never COMMERCE_READY unless
 * source + cost + fulfillment + images are all actually evidenced.
 */
export function deriveImportReadiness(f: {
  supplierUrl?: string;
  supplierItemId?: string;
  riskFlags?: string[];
  costPrice?: number;
  landedCost?: number;
  hasUsShippingEvidence?: boolean;
  hasStockEvidence?: boolean;
  imageCount?: number;
}): CommerceReadiness {
  const risky = (f.riskFlags || []).some((r) => /battery|ip\b|trademark|regulatory|compliance|counterfeit|medicine|weapon|medical|ingestible/i.test(r));
  if (risky) return 'RISK_REVIEW';
  if (!f.supplierUrl && !f.supplierItemId) return 'SOURCE_PENDING';
  const hasCost = (f.costPrice ?? 0) > 0 || (f.landedCost ?? 0) > 0;
  if (!hasCost) return 'ECONOMICS_PENDING';
  const hasFulfillment = f.hasUsShippingEvidence === true || f.hasStockEvidence === true;
  if (!hasFulfillment) return 'FULFILLMENT_PENDING';
  if ((f.imageCount ?? 0) === 0) return 'FULFILLMENT_PENDING';
  return 'COMMERCE_READY';
}

/** Find an existing catalog row by supplier URL → item ID → normalized title. */
export function findDuplicateProduct(
  products: { id: string; name: string; supplierUrl?: string | null; supplierProductRef?: string | null; sku?: string | null }[],
  { url, itemId, title }: { url?: string | null; itemId?: string | null; title?: string },
): { id: string; name: string } | null {
  const u = (url || '').trim();
  const it = (itemId || '').trim();
  for (const p of products) {
    if (u && p.supplierUrl && p.supplierUrl.trim() === u) return p;
    if (it && (p.supplierProductRef === it || p.sku === it)) return p;
  }
  const norm = normalizeProductTitle(title || '');
  if (norm) {
    for (const p of products) {
      if (normalizeProductTitle(p.name) === norm) return p;
    }
  }
  return null;
}

/** Deduplicate + order supplier images, strongest (hero) first. No fake fallback. */
export function buildImportImages(images: string[], heroUrl?: string): CatalogImageInput[] {
  const dedup = [...new Set((images || []).filter((u) => /^https?:\/\//i.test(u)))];
  const ordered = heroUrl && dedup.includes(heroUrl) ? [heroUrl, ...dedup.filter((u) => u !== heroUrl)] : dedup;
  return ordered.map((url, i) => ({ url, altText: '', isPrimary: i === 0, sortOrder: i }));
}

/** Persist only real supplier variants — never invent stock or price. */
export function buildImportVariants(variants: { attributes?: Record<string, string>; sku?: string; price?: number }[]): CatalogVariantInput[] {
  return (variants || []).map((v) => ({
    attributes: v.attributes && Object.keys(v.attributes).length ? v.attributes : undefined,
    sku: v.sku || undefined,
    price: v.price && v.price > 0 ? v.price : null,
    inventoryQty: 0,
    status: 'draft',
  }));
}

// ---------------------------------------------------------------------------
// Supabase Storage image import (serverless /api/import-images)
// ---------------------------------------------------------------------------

export interface StorageImportedImage {
  publicUrl: string;
  sourceUrl: string;
  sortOrder: number;
}

export interface StorageImportResult {
  ok: boolean;
  uploaded: StorageImportedImage[];
  failed: { sourceUrl: string; reason: string }[];
  warnings: string[];
}

/**
 * Map server-side storage uploads to catalog image rows, preserving order and
 * primary (hero) placement. Never invents an image that was not uploaded.
 */
export function buildStorageImageInputs(uploaded: StorageImportedImage[], heroUrl?: string): CatalogImageInput[] {
  const ordered = [...(uploaded || [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const hero = heroUrl && ordered.some((u) => u.publicUrl === heroUrl)
    ? heroUrl
    : heroUrl && ordered.some((u) => u.sourceUrl === heroUrl)
      ? ordered.find((u) => u.sourceUrl === heroUrl)!.publicUrl
      : ordered[0]?.publicUrl || '';
  return ordered.map((img, i) => ({
    url: img.publicUrl,
    altText: '',
    isPrimary: img.publicUrl === hero,
    sortOrder: i,
  }));
}

/**
 * Ask the server to download + dedupe + upload supplier images into Supabase
 * Storage. Returns the result when the endpoint answered; throws when the
 * endpoint itself is unreachable (e.g. local Vite dev server with no /api).
 */
export async function importProductImagesToStorage(productId: string, urls: string[]): Promise<StorageImportResult> {
  const r = await fetch('/api/import-images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId, urls }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Storage import failed (HTTP ${r.status})${text ? `: ${text.slice(0, 160)}` : ''}`);
  }
  const data = (await r.json()) as StorageImportResult;
  return data;
}

export interface ImportProductArgs {
  title: string;
  shortDescription?: string;
  description?: string;
  features?: string[];
  specifications?: Record<string, string>;
  brand?: string;
  categoryId?: string | null;
  /** Luxedge selling price (owner-confirmed, editable). */
  price: number;
  /** Supplier list price shown on the AliExpress page (evidence, not cost). */
  supplierListPrice?: number;
  comparePrice?: number;
  costPrice?: number;
  stock?: number;
  tags?: string[];
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string[];
  url: string;
  itemId?: string | null;
  riskFlags?: string[];
  shippingToUsa?: string;
  deliveryRangeUsa?: string;
  usStockEvidence?: string;
  ownerNotes?: string;
  imageCount?: number;
}

/** Build the honest DRAFT ProductInput for an AliExpress import (no fabricated facts). */
export function buildImportProductInput(a: ImportProductArgs): ProductInput {
  const riskFlags = [...new Set((a.riskFlags || []).filter(Boolean))];
  const cost = (a.costPrice ?? 0) > 0 ? a.costPrice : undefined;
  const compare = (a.comparePrice ?? 0) > 0 ? a.comparePrice : undefined;
  const stock = (a.stock ?? 0) > 0 ? a.stock : 0;
  const hasShipping = !!(a.shippingToUsa && !/unknown/i.test(a.shippingToUsa));
  const hasStock = !!(a.usStockEvidence && !/unknown/i.test(a.usStockEvidence));
  const readiness = deriveImportReadiness({
    supplierUrl: a.url,
    supplierItemId: a.itemId || undefined,
    riskFlags,
    costPrice: cost,
    hasUsShippingEvidence: hasShipping,
    hasStockEvidence: hasStock,
    imageCount: a.imageCount ?? 0,
  });
  const listPrice = (a.supplierListPrice ?? 0) > 0 ? `$${Number(a.supplierListPrice).toFixed(2)}` : 'UNKNOWN';
  return {
    name: a.title,
    shortTitle: (a.title || '').slice(0, 60),
    shortDescription: a.shortDescription?.trim() || undefined,
    // The catalog schema requires description. A real short description is a
    // safe fallback when the supplier exposes only one description field.
    description: a.description?.trim() || a.shortDescription?.trim() || undefined,
    features: (a.features || []).slice(0, 6),
    specifications: (a.specifications || {}) as Record<string, unknown>,
    brand: a.brand || 'Luxedge',
    categoryId: a.categoryId ?? null,
    status: 'draft',
    price: a.price > 0 ? a.price : 0,
    compareAtPrice: compare,
    costPrice: cost,
    inventoryQty: stock,
    freeShipping: false,
    supplierSource: 'AliExpress',
    supplierProductRef: a.itemId || undefined,
    supplierUrl: a.url,
    sourceType: 'OTHER_VERIFIED',
    inventorySource: 'UNKNOWN',
    commerceReadiness: readiness,
    riskFlags,
    tags: (a.tags || []).slice(0, 12),
    seoTitle: a.seoTitle || undefined,
    seoDescription: a.seoDescription || undefined,
    seoKeywords: (a.seoKeywords || []).slice(0, 20),
    ownerNotes: a.ownerNotes || undefined,
    evidenceNotes: [
      `AliExpress import (supplier list price ${listPrice}).`,
      hasShipping ? `USA shipping: ${a.shippingToUsa}` : 'USA shipping: UNKNOWN — owner/browser verification required.',
      a.deliveryRangeUsa && !/unknown/i.test(a.deliveryRangeUsa) ? `USA delivery: ${a.deliveryRangeUsa}` : 'USA delivery: UNKNOWN.',
      hasStock ? `Stock: ${a.usStockEvidence}` : 'Stock: UNKNOWN.',
      'Supplier list price is NOT treated as acquisition cost until the owner verifies the checkout/base price for the selected variant plus USA shipping.',
    ].join(' '),
  };
}
