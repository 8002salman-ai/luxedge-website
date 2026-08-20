// ============================================================================
// LUXEDGE V2 — AI PRODUCT IMPORTER
//
// Page fetching uses PUBLIC proxy services only — no scraping credentials
// live in the browser. Credential-backed scraping (e.g. scrape.do) is done
// server-side via /api/fetch-page with the token in an environment variable.
// ============================================================================

import type { AIExtractedProduct } from './types';

function looksLikeBotPage(raw: string): boolean {
  const lower = raw.toLowerCase();
  return raw.length < 15000 && (
    lower.includes('just a moment') || lower.includes('cf-challenge') || lower.includes('challenge-platform') ||
    lower.includes('captcha') || lower.includes('unusual traffic') || lower.includes('access denied') ||
    lower.includes('are you a robot') || lower.includes('verify you are human') || lower.includes('one more step') ||
    lower.includes('security check') || lower.includes('pardon our interruption') || lower.includes('robot check')
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
}

/**
 * Try the server-side proxy (/api/fetch-page) first: it is SSRF-guarded and
 * uses SCRAPE_DO_TOKEN when configured (token never ships to the browser).
 * Returns null when the endpoint is unreachable (e.g. Vite dev server).
 */
async function fetchViaServerProxy(url: string): Promise<string | null> {
  try {
    const r = await fetch(`/api/fetch-page?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(45_000),
      headers: { Accept: 'text/plain' },
    });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    const text = await r.text();
    // The Vite dev server answers unknown /api routes with the SPA index.html,
    // and serves the api/* source files themselves as JS modules (e.g.
    // /api/fetch-page → the transformed fetch-page.ts). Neither is a fetched
    // page: a real proxy success is plain text, never HTML or JS module code.
    if (ct.includes('text/html') || ct.includes('javascript') || ct.includes('application/json')) return null;
    if (/<!doctype html/i.test(text)) return null;
    // Guard against the dev server leaking local source files (import statements).
    if (/^import\s+\{/.test(text.trim())) return null;
    // A Jina/bot error page is NOT the requested page — treat as a proxy failure.
    if (isProxyErrorText(text)) return null;
    return text;
  } catch {
    return null;
  }
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

/** Parse raw HTML or text into { text, images } without a DOM library. */
export function parseHtmlPage(raw: string): FetchedPage {
  const isHtml = raw.trimStart().startsWith('<') || raw.includes('<html') || raw.includes('<!doctype');
  if (isHtml) {
    // Lightweight extraction — enough for product import prompts.
    const ogTitle = matchMeta(raw, 'og:title');
    const ogDesc = matchMeta(raw, 'og:description');
    const jsonLd = Array.from(raw.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi))
      .map((m) => m[1])
      .join('\n');
    const images = Array.from(raw.matchAll(/<img[^>]+(?:src|data-src)=["']([^"']+)["']/gi))
      .map((m) => m[1])
      .filter((src) => src.startsWith('http') && /\.(jpe?g|png|webp)(\?|$)/i.test(src));
    const bodyText = stripHtml(raw)
      .replace(/[ \t]+/g, ' ')
      .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
    const text = [ogTitle, ogDesc, jsonLd ? `JSON-LD:\n${jsonLd}` : '', bodyText].filter(Boolean).join('\n').slice(0, 12000);
    return { text, images: [...new Set(images)].slice(0, 30) };
  }
  const images: string[] = [];
  const re = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    if (m[1].match(/\.(jpe?g|png|webp)(\?|$)/i)) images.push(m[1]);
  }
  return { text: raw.slice(0, 12000), images: [...new Set(images)].slice(0, 30) };
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
