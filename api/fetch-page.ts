// GET /api/fetch-page?url=...
//
// Credential-backed page fetching. When SCRAPE_DO_TOKEN is configured on the
// server, scraping goes through scrape.do from the server (token never ships
// to the browser). Falls back to the public Jina Reader when no token is set.
//
// PRODUCT TRUTH (Phase 5):
//  - HTTP 200 alone is NOT product success. For AliExpress the body must
//    contain strong product evidence (real og:title + og:image, valid Product
//    JSON-LD, or a real title + the requested item id in product-state data)
//    before the page is served downstream. A punish/captcha/shell page — no
//    matter how long — is treated as FAILURE and never sent as content.
//  - Cost-aware escalation: cheap mode first (render), super proxies only when
//    evidence is missing, blockResources=false + customWait only as last resort.
//  - On exhausted attempts the server returns 502 with structured diagnostics
//    (never junk HTML, never an opaque crash page).
//
// SECURITY:
//  - Admin-only (Phase 3A): valid Supabase admin JWT required. Arbitrary URL
//    fetching is an abuse/SSRF vector, so unauthenticated access is denied.
//  - SSRF-guarded: the target hostname is DNS-resolved and blocked if it
//    resolves to any private/reserved range; redirects are re-validated per
//    hop; non-http(s) URLs, embedded credentials and non-standard ports rejected.
//  - Rate-limited per instance.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, sendText, rateLimited, clientIp } from './_lib/providers.js';
import { validateFetchTarget } from './_lib/ssrf.js';
import { requireAdmin } from './_lib/auth.js';

const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 30_000;

/** One attempt's diagnostic record (no secrets ever included). */
interface AttemptDiag {
  scraper_attempt: number;
  http_status: number;
  response_chars: number;
  product_title_found: boolean;
  product_image_found: boolean;
  jsonld_product_found: boolean;
  item_id_found: boolean;
  product_evidence_valid: boolean;
  scrape_mode: string;
}

interface Evidence {
  valid: boolean;
  reason: string;
  titleFound: boolean;
  imageFound: boolean;
  jsonLdFound: boolean;
  itemIdFound: boolean;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    await handle(req, res);
  } catch (e) {
    // Never let an unexpected error surface as Vercel's opaque 502 page —
    // always answer with a clean JSON error (no secrets, no stack traces).
    sendJson(res, 502, { error: `Could not fetch page (${(e as Error).message || 'unexpected error'})` });
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  if (rateLimited(clientIp(req))) {
    sendJson(res, 429, { error: 'Too many requests — slow down.' });
    return;
  }
  // Admin session required — arbitrary page fetching must not be open.
  if (!(await requireAdmin(req, res))) return;

  const url = new URL(req.url || '/', 'http://localhost').searchParams.get('url') || '';
  if (!/^https?:\/\//i.test(url) || url.length > 2048) {
    sendJson(res, 400, { error: 'A valid http(s) url parameter is required' });
    return;
  }

  const guardErr = await validateFetchTarget(url);
  if (guardErr) {
    sendJson(res, 400, { error: `URL rejected: ${guardErr}` });
    return;
  }

  const token = (process.env.SCRAPE_DO_TOKEN || '').trim();
  const isAli = /aliexpress\.(com|us)/i.test(url);
  // The requested AliExpress item id (e.g. 3256805600005011) — its presence in
  // product-state data is one of the strong evidence signals.
  const itemId = isAli ? (url.match(/(?:item|product)\/(\d{6,20})/i)?.[1] || '') : '';

  if (token) {
    await scrapeWithEscalation(res, url, itemId, isAli, token);
    return;
  }

  await jinaFallback(res, url, isAli);
}

// ---------------------------------------------------------------------------
// scrape.do — cost-aware escalation with product-evidence validation
// ---------------------------------------------------------------------------
async function scrapeWithEscalation(res: ServerResponse, url: string, itemId: string, isAli: boolean, token: string): Promise<void> {
  const modes: { scrape_mode: string; query: string }[] = [
    // Attempt 1: cheap — JS render to the USA, no super proxies.
    { scrape_mode: 'render', query: 'render=true&geoCode=us' },
    // Attempt 2: super proxies (rotate residential) — only when evidence missing.
    { scrape_mode: 'super', query: 'render=true&geoCode=us&super=true' },
    // Attempt 3: most expensive — allow all resources + extra wait, last resort.
    { scrape_mode: 'super-wait', query: 'render=true&geoCode=us&super=true&blockResources=false&customWait=2000' },
  ];
  const diags: AttemptDiag[] = [];

  for (let i = 0; i < modes.length; i++) {
    const proxyUrl = `https://api.scrape.do/?token=${encodeURIComponent(token)}&url=${encodeURIComponent(url)}&${modes[i].query}`;
    const { status, text } = await safeFetch(proxyUrl);
    const evidence = isAli ? validateAliExpressEvidence(text, itemId) : validateGenericPage(text);
    const diag: AttemptDiag = {
      scraper_attempt: i + 1,
      http_status: status,
      response_chars: text.length,
      product_title_found: evidence.titleFound,
      product_image_found: evidence.imageFound,
      jsonld_product_found: evidence.jsonLdFound,
      item_id_found: evidence.itemIdFound,
      product_evidence_valid: evidence.valid,
      scrape_mode: modes[i].scrape_mode,
    };
    diags.push(diag);
    // Structured diagnostics — logged server-side, never contains secrets.
    console.log(`[fetch-page] attempt=${diag.scraper_attempt} mode=${diag.scrape_mode} http=${diag.http_status} chars=${diag.response_chars} title=${diag.product_title_found ? 'yes' : 'no'} image=${diag.product_image_found ? 'yes' : 'no'} jsonld=${diag.jsonld_product_found ? 'yes' : 'no'} item=${diag.item_id_found ? 'yes' : 'no'} valid=${diag.product_evidence_valid ? 'yes' : 'no'}`);

    if (evidence.valid) {
      sendText(res, 200, text);
      return;
    }
    if (i < modes.length - 1) await sleep(1000 * (i + 1));
  }

  const last = diags[diags.length - 1];
  const reason = last ? lastReason(last, isAli) : 'unknown failure';
  sendJson(res, 502, {
    error: `Could not fetch page — no valid product evidence after ${modes.length} attempts (${reason})`,
    diagnostics: diags,
  });
}

function lastReason(diag: AttemptDiag, isAli: boolean): string {
  if (diag.http_status === 0) return 'connection/redirect blocked';
  if (diag.http_status !== 200) return `HTTP ${diag.http_status}`;
  if (isAli && !diag.product_title_found && !diag.product_image_found && !diag.jsonld_product_found) {
    return 'AliExpress anti-bot punish/captcha page (no product data)';
  }
  if (isAli) return 'no strong product evidence (title/image/JSON-LD/item id missing)';
  return 'anti-bot shell or too little content';
}

// ---------------------------------------------------------------------------
// Product-evidence validation — AliExpress (strict) and generic pages
// ---------------------------------------------------------------------------
function validateAliExpressEvidence(raw: string, requestedItemId: string): Evidence {
  const lower = raw.toLowerCase();
  const ev: Evidence = { valid: false, reason: '', titleFound: false, imageFound: false, jsonLdFound: false, itemIdFound: false };

  // Anti-bot shells — detected by MARKERS, never by total length. A punish or
  // captcha page can be arbitrarily long and still contain zero product data.
  const shell =
    lower.includes('sufei-punish') || lower.includes('punish-page') || lower.includes('punish?recaptcha') || lower.includes('punish/')
      ? 'anti-bot punish page'
      : lower.includes('captcha') || lower.includes('slider-captcha') || lower.includes('verify you are human')
        ? 'captcha/verify page'
        : lower.includes('security verification') || lower.includes('security check')
          ? 'security verification page'
          : lower.includes('just a moment') || lower.includes('cf-challenge') || lower.includes('challenge-platform')
            ? 'Cloudflare challenge'
            : '';
  if (shell) {
    ev.reason = shell;
    return ev;
  }

  // Generic AliExpress shells (homepage/sign-in) carry no product title.
  const ogTitle = matchMeta(raw, 'og:title').trim();
  const genericTitle = ogTitle.length < 4 || /aliexpress|smarter shopping|better living|online shopping|^security/i.test(ogTitle);
  ev.titleFound = !genericTitle;

  const ogImage = matchMeta(raw, 'og:image').trim();
  ev.imageFound = /^https?:\/\//i.test(ogImage);

  ev.jsonLdFound = !!parseJsonLdProductName(raw);
  ev.itemIdFound = !!requestedItemId && raw.includes(requestedItemId);

  // Strong product signal required: real title + image, valid Product
  // JSON-LD, or a real title with the requested item id in page data.
  ev.valid = (ev.titleFound && ev.imageFound) || ev.jsonLdFound || (ev.titleFound && ev.itemIdFound);
  ev.reason = ev.valid ? 'product evidence validated' : 'no strong product evidence (title/image/JSON-LD/item id missing)';
  return ev;
}

/** Loose validation for non-AliExpress pages — shell markers regardless of length, plus a minimum content size. */
function validateGenericPage(raw: string): Evidence {
  const lower = raw.toLowerCase();
  const ev: Evidence = { valid: false, reason: '', titleFound: false, imageFound: false, jsonLdFound: false, itemIdFound: false };
  const shell = /sufei-punish|punish-page|punish\?recaptcha|captcha|security verification|verify you are human|just a moment|cf-challenge|challenge-platform|unusual traffic|access denied/i;
  if (shell.test(lower)) {
    ev.reason = 'anti-bot shell detected';
    return ev;
  }
  if (raw.trim().length < 200) {
    ev.reason = 'too little content';
    return ev;
  }
  ev.valid = true;
  ev.reason = 'page fetched';
  return ev;
}

// ---------------------------------------------------------------------------
// Jina Reader fallback (no SCRAPE_DO_TOKEN configured)
// ---------------------------------------------------------------------------
async function jinaFallback(res: ServerResponse, url: string, isAli: boolean): Promise<void> {
  const proxyUrl = `https://r.jina.ai/${encodeURIComponent(url)}`;
  let lastErr = 'no proxy available';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { status, text } = await safeFetch(proxyUrl);
    if (status === 0) {
      lastErr = 'Jina Reader: connection/redirect blocked';
      if (attempt < 3) { await sleep(1200 * attempt); continue; }
      break;
    }
    if (status !== 200) {
      lastErr = `Jina Reader: HTTP ${status}`;
      if (attempt < 3) { await sleep(1200 * attempt); continue; }
      break;
    }
    if (text.trim().length < 100) {
      lastErr = 'Jina Reader: too little content';
      if (attempt < 3) { await sleep(1200 * attempt); continue; }
      break;
    }
    // Jina error/block pages and bot shells are NOT pages — markers only, no
    // length gate (a punish page can be long and still be empty of product).
    const lower = text.toLowerCase();
    if (/^Warning:\s+.+?\bURL returned error\s+\d{3}\b/im.test(text) ||
      lower.includes('err_blocked_by_client') || lower.includes('page has been blocked by chrome') ||
      lower.includes('this page has been blocked') || lower.includes('is blocked by the browser') ||
      lower.includes('sufei-punish') || lower.includes('punish-page') || lower.includes('punish?recaptcha') ||
      lower.includes('captcha') || lower.includes('security verification') || lower.includes('verify you are human')) {
      lastErr = `Jina Reader: proxy error/anti-bot page (${isAli ? 'AliExpress blocks Jina' : 'target not retrievable'})`;
      if (attempt < 3) { await sleep(1200 * attempt); continue; }
      break;
    }
    // AliExpress via Jina almost always resolves to the JS shell; require at
    // least a real page title to avoid serving the shell as product content.
    if (isAli) {
      const titleLine = text.match(/^Title:\s*(.+)$/m);
      const hasRealTitle = titleLine && titleLine[1] && titleLine[1].trim() &&
        !/captcha|aliexpress|smarter shopping|shopping for/i.test(titleLine[1].trim());
      if (!hasRealTitle) {
        lastErr = 'Jina Reader: AliExpress shell/captcha (product loads via JS)';
        if (attempt < 3) { await sleep(1200 * attempt); continue; }
        break;
      }
    }
    sendText(res, 200, text);
    return;
  }
  sendJson(res, 502, { error: `Could not fetch page (${lastErr})` });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch following redirects manually, validating every hop against the SSRF
 * guard so a redirect cannot bypass the initial host check. Returns the HTTP
 * status and body; status 0 means blocked/network failure (body empty).
 */
async function safeFetch(startUrl: string): Promise<{ status: number; text: string }> {
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const err = await validateFetchTarget(current);
    if (err) return { status: 0, text: '' };
    let r: Response;
    try {
      r = await fetch(current, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'manual' });
    } catch {
      return { status: 0, text: '' };
    }
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location');
      if (!loc) return { status: r.status, text: '' };
      current = new URL(loc, current).toString();
      continue;
    }
    if (!r.ok) return { status: r.status, text: '' };
    const text = await r.text();
    return { status: r.status, text };
  }
  return { status: 0, text: '' };
}

function matchMeta(raw: string, prop: string): string {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i');
  const m = raw.match(re);
  return m ? m[1] : '';
}

/** Parse JSON-LD blocks and return the first Product name (never fabricates). */
function parseJsonLdProductName(raw: string): string {
  const blocks = Array.from(raw.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi))
    .map((m) => m[1]);
  for (const block of blocks) {
    let data: unknown = null;
    try {
      data = JSON.parse(block);
    } catch {
      continue;
    }
    const nodes: Record<string, unknown>[] = [];
    if (Array.isArray(data)) nodes.push(...(data as Record<string, unknown>[]));
    else if (data && typeof data === 'object') {
      const root = data as Record<string, unknown>;
      nodes.push(root);
      if (Array.isArray(root['@graph'])) nodes.push(...(root['@graph'] as Record<string, unknown>[]));
    }
    for (const node of nodes) {
      const type = Array.isArray(node['@type']) ? (node['@type'] as string[]).join(' ') : String(node['@type'] || '');
      if (!/\bProduct\b/i.test(type)) continue;
      const name = typeof node.name === 'string' ? node.name.trim() : '';
      if (name) return name;
    }
  }
  return '';
}
