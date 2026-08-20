// ============================================================================
// LUXEDGE V2 — RENDERED BROWSER EVIDENCE CAPTURE (Phase 4H.3, LIVE HARNESS ONLY)
//
// The Jina-based /api/fetch-page proxy cannot extract client-side-rendered
// prices from Target/Walmart/Wayfair/Lowes. This helper captures the RENDERED
// page from the local headless Chrome (--dump-dom) and curates the REAL
// structured fields (og:title, og:price, JSON-LD Product name/offers/brand/
// sku/availability) into the labeled-text format the existing extractPageFacts
// already understands — the smallest legitimate rendered-evidence path, with
// no new scraping subsystem and no server dependency.
//
// HONESTY: every emitted field comes from the rendered DOM (meta tags or
// JSON-LD) — nothing is inferred or invented. Missing fields stay absent.
//
// NODE-ONLY: it imports node:child_process, so it must NEVER be imported by
// browser-facing code. It is used only by the guarded live tests
// (RUN_LIVE_CJ_PROOF=1).
// ============================================================================

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import type { FetchedSourcePage } from '../../scout/types';
import { parseHtmlPage } from '../../ai/importer';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

/** Locate the local Chrome/Chromium binary (never hardcodes a single OS). */
export function findChromeBinary(): string | null {
  for (const p of CHROME_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export interface RenderedFetchOptions {
  timeoutMs?: number;
  /** Optional extra Chrome flags (kept minimal). */
  extraFlags?: string[];
}

// ---------------------------------------------------------------------------
// Curated rendered extraction — real fields only, labeled for extractPageFacts
// ---------------------------------------------------------------------------

function meta(raw: string, prop: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i');
  const m = raw.match(re);
  return m ? m[1].trim() : null;
}

function firstString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  return v ? [v] : [];
}

/** The value of `@type` as a lowercase string set. */
function types(v: unknown): Set<string> {
  return new Set(asArray(v).map((t) => String(t).toLowerCase()));
}

/** Recursively collect JSON-LD objects that look like a Product. */
function collectProducts(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const n of node) collectProducts(n, out);
    return out;
  }
  const obj = node as Record<string, unknown>;
  const t = types(obj['@type']);
  const isProduct = t.has('product') || (t.size === 0 && (obj.offers || obj.brand || obj.sku || obj.SKU || obj.gtin || obj.name));
  if (isProduct) out.push(obj);
  for (const v of Object.values(obj)) collectProducts(v, out);
  return out;
}

interface OfferFacts {
  price: number | null;
  currency: string | null;
  availability: string | null;
  sku: string | null;
}

function offerFacts(offer: unknown): OfferFacts {
  const o = (offer && typeof offer === 'object' ? offer : {}) as Record<string, unknown>;
  const priceRaw = firstString(o.price) ?? firstString(o.lowPrice) ?? null;
  const price = priceRaw ? parseFloat(String(priceRaw).replace(/[^0-9.]/g, '')) : null;
  const availRaw = firstString(o.availability);
  let availability: string | null = null;
  if (availRaw) {
    if (/instock|in_stock|in stock/i.test(availRaw)) availability = 'In Stock';
    else if (/outofstock|out_of_stock|soldout|sold out|out of stock/i.test(availRaw)) availability = 'Out of Stock';
  }
  return {
    price: price && Number.isFinite(price) && price > 0 ? price : null,
    currency: firstString(o.priceCurrency),
    availability,
    sku: firstString(o.sku) ?? firstString(o.SKU),
  };
}

/** Real structured fields from a Product object (offers preferred InStock). */
function productFacts(p: Record<string, unknown>): {
  name: string | null;
  brand: string | null;
  sku: string | null;
  price: number | null;
  availability: string | null;
  rating: number | null;
  reviewCount: number | null;
} {
  const brandNode = p.brand as Record<string, unknown> | string | undefined;
  const brand = typeof brandNode === 'string' ? firstString(brandNode) : firstString(brandNode?.name);
  const offers = asArray(p.offers).map(offerFacts).filter((o) => o.price !== null || o.availability !== null || o.sku !== null);
  // Prefer an InStock offer, then the first priced offer.
  const best = offers.find((o) => o.availability === 'In Stock') ?? offers.find((o) => o.price !== null) ?? offers[0];
  const agg = (p.aggregateRating || {}) as Record<string, unknown>;
  const ratingRaw = agg.ratingValue ?? null;
  const reviewRaw = agg.reviewCount ?? agg.ratingCount ?? null;
  const rating = ratingRaw !== null ? parseFloat(String(ratingRaw)) : null;
  const reviewCount = reviewRaw !== null ? parseInt(String(reviewRaw), 10) : null;
  return {
    name: firstString(p.name),
    brand,
    sku: firstString(p.sku) ?? firstString(p.SKU) ?? best?.sku ?? null,
    price: best?.price ?? null,
    availability: best?.availability ?? null,
    rating: rating !== null && Number.isFinite(rating) ? rating : null,
    reviewCount: reviewCount !== null && Number.isFinite(reviewCount) ? reviewCount : null,
  };
}

/**
 * Build a LABELED text block from the rendered DOM so extractPageFacts picks
 * up the correct title/price/availability/brand/sku (the raw body text would
 * otherwise yield greedy first-price / breadcrumb-name noise). Emitted lines
 * are real values from og: meta tags or JSON-LD Product/Offer blocks only.
 */
export function curateRenderedPage(raw: string): { text: string; images: string[] } {
  const ogTitle = meta(raw, 'og:title');
  const ogPriceRaw = meta(raw, 'og:price:amount') ?? meta(raw, 'og:price') ?? meta(raw, 'product:price:amount');
  const h1 = raw.match(/<h1[^>]*>([\s\S]{3,200}?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() ?? null;

  const jsonLd = Array.from(raw.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi))
    .map((m) => {
      try { return JSON.parse(m[1]); } catch { return null; }
    })
    .filter(Boolean);
  const products: Record<string, unknown>[] = [];
  for (const node of jsonLd) collectProducts(node, products);
  // Strongest product: one with an offer (price/availability/sku) or a brand+name.
  const ranked = products.map((p) => ({ p, f: productFacts(p) }));
  ranked.sort((a, b) => {
    const score = (f: ReturnType<typeof productFacts>) =>
      (f.price !== null ? 4 : 0) + (f.availability !== null ? 2 : 0) + (f.sku !== null ? 1 : 0) + (f.brand !== null ? 1 : 0);
    return score(b.f) - score(a.f);
  });
  const best = ranked[0]?.f ?? { name: null, brand: null, sku: null, price: null, availability: null, rating: null, reviewCount: null };

  const title = ogTitle ?? best.name ?? h1;
  const ogPrice = ogPriceRaw ? parseFloat(ogPriceRaw.replace(/[^0-9.]/g, '')) : null;
  const price = (ogPrice && ogPrice > 0 ? ogPrice : best.price) ?? null;

  const lines: string[] = [];
  if (title) lines.push(`og:title ${title}`);
  if (price !== null) lines.push(`Price: $${price.toFixed(2)}`);
  if (best.availability) lines.push(`Availability: ${best.availability}`);
  if (best.brand) lines.push(`Brand: ${best.brand}`);
  if (best.sku) lines.push(`SKU: ${best.sku}`);
  if (best.rating !== null) lines.push(`Rating: ${best.rating}`);
  if (best.reviewCount !== null) lines.push(`Reviews: ${best.reviewCount}`);
  if (h1 && h1 !== title) lines.push(`# ${h1}`);

  // Images from the rendered DOM (same extractor as parseHtmlPage).
  const images = parseHtmlPage(raw).images || [];
  return { text: lines.join('\n'), images };
}

/**
 * Render a URL with headless Chrome and return curated rendered facts in the
 * `FetchedSourcePage` shape the engine's fetchPage contract expects. A single
 * retry tolerates transient Chrome startup/render failures (real headless
 * browsers occasionally exit non-zero on heavy JS pages).
 */
export async function renderPageWithChrome(url: string, opts: RenderedFetchOptions = {}): Promise<FetchedSourcePage> {
  const chrome = findChromeBinary();
  if (!chrome) throw new Error('headless Chrome/Chromium not found on this machine');
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const flags = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--virtual-time-budget=12000',
    '--dump-dom',
    ...(opts.extraFlags ?? []),
    url,
  ];
  const run = (): Promise<string> => new Promise<string>((resolve, reject) => {
    execFile(chrome, flags, { maxBuffer: 10 * 1024 * 1024, timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(`Chrome render failed: ${err.message}${stderr ? ` — ${stderr.slice(0, 200)}` : ''}`));
      else resolve(stdout || '');
    });
  });

  let html = '';
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      html = await run();
      if (html && html.trim().length >= 200) break;
    } catch (e) {
      lastErr = e as Error;
    }
  }
  if (!html || html.trim().length < 200) throw lastErr ?? new Error('rendered page returned no usable DOM');
  const curated = curateRenderedPage(html);
  if (!curated.text || curated.text.trim().length < 60) throw new Error('rendered page yielded no usable structured facts');
  return { text: curated.text, images: curated.images };
}
