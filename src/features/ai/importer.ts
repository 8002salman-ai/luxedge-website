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

interface FetchedPage {
  text: string;
  images: string[];
}

/** Fetch a product page through public proxies. No credentials involved. */
export async function fetchPageContent(url: string): Promise<string> {
  const isAli = /aliexpress\.(com|us)/i.test(url);
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
        if (looksLikeBotPage(raw)) { lastErr = `${label}: bot check`; continue; }
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
  return `You are an expert e-commerce product data analyst for Luxedge, a premium US dropshipping store.

Extract ALL product information from this ${sourceType} content and return ONLY a valid JSON object.

CONTENT:
${rawContent.slice(0, 10000)}

Return this EXACT JSON structure (use empty string/array/0 if not found):
{
  "title": "exact product title",
  "luxuryTitle": "premium rewritten title for luxury brand",
  "seoTitle": "SEO optimized title with main keyword (60 chars max)",
  "slug": "url-friendly-slug",
  "brand": "brand name",
  "manufacturer": "manufacturer",
  "category": "best matching: Dog Supplies | Cat Supplies | Pet Beds | Pet Toys | Feeding & Water | Grooming | Pet Accessories",
  "subcategory": "specific subcategory",
  "collection": "product collection name",
  "shortDescription": "2-3 sentence product summary",
  "longDescription": "detailed 3-4 paragraph product description",
  "features": ["feature 1", "feature 2", "feature 3"],
  "benefits": ["benefit 1", "benefit 2"],
  "specifications": {"spec name": "value"},
  "packageIncludes": ["item 1", "item 2"],
  "weight": "e.g. 0.5 lbs",
  "dimensions": "e.g. 10 x 5 x 2 inches",
  "origin": "country of origin",
  "materials": ["material 1"],
  "colors": ["color 1", "color 2"],
  "sizes": ["S", "M", "L"],
  "sku": "suggested SKU",
  "barcode": "",
  "hsCode": "",
  "stock": 100,
  "costPrice": 0,
  "sellingPrice": 0,
  "comparePrice": 0,
  "shippingWeight": "",
  "tags": ["tag1", "tag2", "tag3"],
  "seoKeywords": ["keyword1", "keyword2"],
  "metaTitle": "SEO meta title (60 chars)",
  "metaDescription": "SEO meta description (160 chars)",
  "focusKeyword": "primary SEO keyword",
  "images": [],
  "faqs": [{"q": "question?", "a": "answer"}],
  "warranty": "warranty info",
  "careInstructions": "care instructions",
  "safetyNotes": "safety notes",
  "confidence": {
    "title": 95, "price": 80, "description": 85, "specifications": 70, "images": 60, "brand": 75, "category": 90, "tags": 80
  }
}

Rules:
- luxuryTitle: make it sound premium, e.g. "Orthopedic Memory Foam Dog Bed" → "Luxe Joint-Support Memory Foam Bed | LuxePaws"
- sellingPrice: use actual price from content; if not found estimate market price
- comparePrice: 20-30% higher than sellingPrice (to show "was" price)
- costPrice: 40-50% of sellingPrice
- confidence: 0-100 how certain you are about each field
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
