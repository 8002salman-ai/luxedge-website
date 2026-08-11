export interface AliExpressProductData {
  title: string;
  price: number;
  originalPrice: number;
  images: string[];
  description: string;
  sku: string;
  category: string;
}

function decodeUnicode(str: string): string {
  return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
}

function cleanTitle(raw: string): string {
  return decodeUnicode(raw)
    .replace(/\b(free shipping|hot sale|2024|2025|2026|new arrival|best seller|high quality|wholesale|dropship)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150);
}

function normalizeImageUrl(url: string): string {
  let u = url.startsWith('//') ? `https:${url}` : url;
  u = u.replace(/\.jpg_[^.]*\.jpg.*$/i, '.jpg');
  u = u.replace(/\.jpg_\d+x\d+.*$/i, '.jpg');
  return u;
}

function extractTitle(html: string): string {
  const og = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1];
  if (og) return cleanTitle(og.replace('- AliExpress', '').replace('| AliExpress', '').trim());

  const subject = html.match(/["']subject["']\s*:\s*["']((?:[^"'\\]|\\.){10,})["']/);
  if (subject) return cleanTitle(subject[1]);

  const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
  if (title) return cleanTitle(title.replace('- AliExpress', '').trim());

  return '';
}

function extractPrice(html: string): { price: number; originalPrice: number } {
  const actMatch = html.match(/["']minActivityAmount["']\s*:\s*\{[^}]*["']value["']\s*:\s*([\d.]+)/);
  const minMatch = html.match(/["']minAmount["']\s*:\s*\{[^}]*["']value["']\s*:\s*([\d.]+)/);
  const maxMatch = html.match(/["']maxAmount["']\s*:\s*\{[^}]*["']value["']\s*:\s*([\d.]+)/);

  let price = parseFloat(actMatch?.[1] || minMatch?.[1] || '0');
  let originalPrice = parseFloat(maxMatch?.[1] || '0');

  if (!price) {
    const m = html.match(/US\s*\$\s*([\d.]+)/);
    price = m ? parseFloat(m[1]) : 9.99;
  }

  if (!originalPrice || originalPrice <= price) {
    originalPrice = Math.round(price * 1.6 * 100) / 100;
  }

  return { price, originalPrice };
}

function extractImages(html: string): string[] {
  const listMatch = html.match(/["']imagePathList["']\s*:\s*\[([^\]]{20,}?)\]/);
  if (listMatch) {
    try {
      const parsed: string[] = JSON.parse(`[${listMatch[1]}]`);
      const imgs = parsed
        .filter((u) => typeof u === 'string' && (u.includes('alicdn') || u.includes('aliexpress')))
        .map(normalizeImageUrl)
        .slice(0, 8);
      if (imgs.length) return imgs;
    } catch {}
  }
  const og = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1];
  return og ? [og] : [];
}

function extractDescription(html: string, title: string): string {
  const specsMatch = html.match(/["']props["']\s*:\s*(\[[\s\S]{10,2000}?\])/);
  if (specsMatch) {
    try {
      interface Spec { attrName?: string; attrValue?: string }
      const specs: Spec[] = JSON.parse(specsMatch[1]);
      const lines = specs
        .filter((s) => s.attrName && s.attrValue)
        .slice(0, 8)
        .map((s) => `• ${decodeUnicode(s.attrName!)}: ${decodeUnicode(s.attrValue!)}`);
      if (lines.length) return `${title}\n\nKey Specifications:\n${lines.join('\n')}`;
    } catch {}
  }
  return title;
}

export function extractProductId(url: string): string | null {
  return (
    url.match(/\/item\/(\d+)\.html/)?.[1] ||
    url.match(/\/i\/(\d+)\.html/)?.[1] ||
    url.match(/(\d{10,})/)?.[1] ||
    null
  );
}

async function fetchHtml(
  url: string,
  scrapedoKey?: string,
  scraperApiKey?: string
): Promise<string> {
  // 1. scrape.do — BEST FREE OPTION (1000/month permanent, no credit card)
  if (scrapedoKey?.trim()) {
    try {
      const res = await fetch(
        `https://api.scrape.do?token=${scrapedoKey.trim()}&url=${encodeURIComponent(url)}`
      );
      if (res.ok) {
        const text = await res.text();
        if (text.length > 5000) return text;
      }
    } catch {}
  }

  // 2. ScraperAPI fallback (if user added it)
  if (scraperApiKey?.trim()) {
    try {
      const res = await fetch(
        `https://api.scraperapi.com/?api_key=${scraperApiKey.trim()}&url=${encodeURIComponent(url)}`
      );
      if (res.ok) {
        const text = await res.text();
        if (text.length > 5000) return text;
      }
    } catch {}
  }

  // 3. corsproxy.io — free no-key proxy
  try {
    const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`);
    if (res.ok) {
      const text = await res.text();
      if (text.length > 5000 && !text.includes('cf-browser-verification')) return text;
    }
  } catch {}

  // 4. allorigins — last resort
  const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    throw new Error(
      'Import failed. Please add a free scrape.do key in Settings → API Keys (1000 req/month, no credit card).'
    );
  }
  const json = await res.json() as { contents: string };
  const html = json.contents || '';
  if (html.length < 5000) {
    throw new Error(
      'AliExpress blocked the request. Add your free scrape.do key in Settings → API Keys.'
    );
  }
  return html;
}

export async function importFromAliExpress(
  url: string,
  scrapedoKey?: string,
  scraperApiKey?: string
): Promise<AliExpressProductData> {
  const cleanUrl = url.trim();

  if (!cleanUrl.includes('aliexpress.com') && !cleanUrl.includes('aliexpress.us')) {
    throw new Error('Please enter a valid AliExpress product URL');
  }

  const html = await fetchHtml(cleanUrl, scrapedoKey, scraperApiKey);

  if (
    html.includes('cf-browser-verification') ||
    html.includes('challenge-platform') ||
    html.toLowerCase().includes('access denied')
  ) {
    throw new Error(
      'AliExpress blocked this request. Add your free scrape.do key in Settings → API Keys.'
    );
  }

  const productId = extractProductId(cleanUrl) || `${Date.now()}`;
  const title = extractTitle(html);

  if (!title) {
    throw new Error(
      'Could not read product data. Add your free scrape.do key in Settings → API Keys for better results.'
    );
  }

  const { price, originalPrice } = extractPrice(html);
  const images = extractImages(html);
  const description = extractDescription(html, title);

  return { title, price, originalPrice, images, description, sku: `AE-${productId}`, category: '' };
}
