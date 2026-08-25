// ============================================================================
// LUXEDGE — worker-side SEO meta injection for crawlers
//
// The storefront is a client-rendered SPA, so every route serves the same
// generic index.html shell. Google renders JS, but for a 60+ page catalog the
// shell-only meta (one title, one canonical → /) means product/blog/category
// pages rarely get indexed with correct titles.
//
// This module detects crawler/social-bot user agents and rewrites the shell's
// <head> for the requested route BEFORE it is returned:
//   /product/:slug   → product seo_title/seo_description + Product + Breadcrumb JSON-LD
//   /blog/:slug      → post title/excerpt + BlogPosting JSON-LD (static registry)
//   /category/:slug  → category name + CollectionPage JSON-LD
//   static pages     → unique title/description
// Real users are never affected (no extra latency, no data fetched).
// No secrets — reads Supabase with the anon key exactly like api/google-feed.ts.
// ============================================================================

export interface SeoEnv {
  ASSETS: {
    fetch(input: Request): Promise<Response>;
  };
}

const BOT_RE =
  /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|twitterbot|linkedinbot|pinterest|whatsapp|telegram|slack|discord|embedly|quora|tumblr|viber|line|skype|snapchat|outbrain|pocket|flipboard|instapaper|evernote|baiduspider|yandex|duckduckbot|gptbot|ccbot|applebot|semrush|ahrefs|mj12|dotbot|petalbot|serpstat|archive\.org|ia_archiver/i;

interface RouteMeta {
  title: string;
  description: string;
  canonical: string;
  noindex?: boolean;
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
}

const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const cleanText = (d: string | null | undefined, max = 400): string => {
  const plain = (d || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
};

// ---------------------------------------------------------------------------
// Data access (Supabase anon REST — same pattern as api/google-feed.ts)
// ---------------------------------------------------------------------------

function supabaseBase(): string {
  return (process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
}
function supabaseAnon(): string {
  return (process.env.VITE_SUPABASE_ANON_KEY || '').trim();
}

interface ProductRow {
  id: string;
  slug?: string | null;
  name: string;
  description?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  seo_keywords?: string | null;
  price?: number | null;
  brand?: string | null;
  stock_status?: string | null;
  us_inventory?: boolean | null;
}

const cache = new Map<string, { ts: number; data: unknown }>();
const TTL_DB = 15 * 60 * 1000;
const TTL_BLOG = 30 * 60 * 1000;

async function cachedFetch<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < ttl) return hit.data as T;
  try {
    const data = await fn();
    cache.set(key, { ts: Date.now(), data });
    return data;
  } catch {
    return null;
  }
}

async function fetchJson<T>(base: string, key: string, path: string): Promise<T | null> {
  try {
    const res = await fetch(`${base}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

async function getProducts(): Promise<ProductRow[] | null> {
  const base = supabaseBase();
  const key = supabaseAnon();
  if (!base || !key) return null;
  return cachedFetch('seo:products', TTL_DB, () =>
    fetchJson<ProductRow[]>(
      base,
      key,
      'products?select=slug,name,description,seo_title,seo_description,seo_keywords,price,brand,stock_status,us_inventory&status=eq.active&limit=500',
    ),
  );
}

interface CategoryRow {
  slug: string;
  name: string;
}

async function getCategories(): Promise<CategoryRow[] | null> {
  const base = supabaseBase();
  const key = supabaseAnon();
  if (!base || !key) return null;
  return cachedFetch('seo:categories', TTL_DB, () =>
    fetchJson<CategoryRow[]>(base, key, 'categories?select=slug,name&limit=200'),
  );
}

interface BlogEntry {
  slug: string;
  title: string;
  excerpt: string;
  image?: string;
  date?: string;
  authorName?: string;
}

async function getBlogRegistry(origin: string, env: SeoEnv): Promise<BlogEntry[] | null> {
  return cachedFetch('seo:blogs', TTL_BLOG, async () => {
    const res = await env.ASSETS.fetch(new Request(`${origin}/blog-seo.json`));
    if (!res.ok) return null;
    const data = (await res.json()) as { posts?: BlogEntry[] };
    return Array.isArray(data.posts) ? data.posts : null;
  });
}

// ---------------------------------------------------------------------------
// Static pages
// ---------------------------------------------------------------------------

const STATIC_PAGES: Record<string, { title: string; description: string }> = {
  '/shop': {
    title: 'Shop All Pet Essentials — Dog, Cat, Bird, Horse & More | Luxedge',
    description:
      'Browse the Luxedge curated collection — dog beds and leashes, cat toys and fountains, bird feeders, horse grooming and livestock essentials, all sourced and ready to ship.',
  },
  '/about': {
    title: 'About Luxedge — Premium Pet Essentials',
    description:
      'Luxedge curates useful essentials for pets and animals — thoughtfully selected, sourced from verified suppliers, and shipped to your door.',
  },
  '/contact': {
    title: 'Contact Luxedge — We Are Here to Help',
    description:
      'Questions about an order, a product, or shipping? Contact the Luxedge support team and we will get back to you.',
  },
  '/faq': {
    title: 'FAQ — Shipping, Returns & Product Questions | Luxedge',
    description:
      'Answers to common questions about Luxedge — shipping times, order tracking, returns, and how our curated pet essentials are sourced.',
  },
  '/shipping-policy': {
    title: 'Shipping Policy — Delivery Times & Costs | Luxedge',
    description:
      'How Luxedge ships pet essentials — expected delivery windows, processing time, and free shipping details, based on verified supplier estimates.',
  },
  '/returns': {
    title: 'Returns Policy | Luxedge',
    description:
      'Luxedge returns policy — how to request a return or exchange for your pet essentials order.',
  },
  '/privacy': {
    title: 'Privacy Policy | Luxedge',
    description:
      'How Luxedge collects, uses, and protects your personal information when you shop with us.',
  },
  '/terms': {
    title: 'Terms of Service | Luxedge',
    description:
      'The terms that govern your use of the Luxedge storefront and services.',
  },
};

// ---------------------------------------------------------------------------
// JSON-LD builders
// ---------------------------------------------------------------------------

function productJsonLd(p: ProductRow, canonical: string): Record<string, unknown> {
  const offers: Record<string, unknown> = {
    '@type': 'Offer',
    price: Number(p.price ?? 0).toFixed(2),
    priceCurrency: 'USD',
    url: canonical,
  };
  if (p.stock_status === 'in_stock' || p.us_inventory === true) offers.availability = 'https://schema.org/InStock';
  else if (p.stock_status && p.stock_status !== 'in_stock') offers.availability = 'https://schema.org/OutOfStock';
  const product: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    description: cleanText(p.seo_description || p.description || ''),
    url: canonical,
    offers,
  };
  if (p.brand) product.brand = { '@type': 'Brand', name: p.brand };
  return product;
}

function breadcrumbJsonLd(name: string, canonical: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://luxedge.us' },
      { '@type': 'ListItem', position: 2, name, item: canonical },
    ],
  };
}

function blogJsonLd(b: BlogEntry, canonical: string): Record<string, unknown> {
  const post: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: b.title,
    description: b.excerpt,
    mainEntityOfPage: canonical,
  };
  if (b.date) post.datePublished = b.date;
  if (b.authorName) post.author = { '@type': 'Person', name: b.authorName };
  if (b.image) post.image = b.image;
  return post;
}

// ---------------------------------------------------------------------------
// Head injection
// ---------------------------------------------------------------------------

function inject(html: string, meta: RouteMeta): string {
  let out = html;
  out = out.replace(/<title>[^<]*<\/title>/, `<title>${esc(meta.title)}</title>`);
  out = out.replace(
    /<meta name="description" content="[^"]*" \/>/,
    `<meta name="description" content="${esc(meta.description)}" />`,
  );
  out = out.replace(
    /<meta name="robots" content="[^"]*" \/>/,
    `<meta name="robots" content="${meta.noindex ? 'noindex, nofollow' : 'index, follow'}" />`,
  );
  out = out.replace(
    /<link rel="canonical" href="[^"]*" \/>/,
    `<link rel="canonical" href="${esc(meta.canonical)}" />`,
  );
  out = out.replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${esc(meta.title)}" />`);
  out = out.replace(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${esc(meta.description)}" />`);
  out = out.replace(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${esc(meta.canonical)}" />`);
  out = out.replace(/<meta name="twitter:title" content="[^"]*" \/>/, `<meta name="twitter:title" content="${esc(meta.title)}" />`);
  out = out.replace(/<meta name="twitter:description" content="[^"]*" \/>/, `<meta name="twitter:description" content="${esc(meta.description)}" />`);
  if (meta.jsonLd) {
    const blocks = Array.isArray(meta.jsonLd) ? meta.jsonLd : [meta.jsonLd];
    const script = blocks
      .map((b) => `<script type="application/ld+json">${JSON.stringify(b)}</script>`)
      .join('\n');
    out = out.replace('</head>', `${script}\n</head>`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Route resolution
// ---------------------------------------------------------------------------

/**
 * Returns injected HTML for crawler requests, or null when no injection applies
 * (non-bot UA, asset route, or data unavailable). Callers serve the original
 * response when null.
 */
export async function maybeInjectSeo(
  html: string,
  pathname: string,
  origin: string,
  userAgent: string,
  env: SeoEnv,
): Promise<string | null> {
  if (!userAgent || !BOT_RE.test(userAgent)) return null;

  const segs = pathname.split('/').filter(Boolean);
  const root = 'https://luxedge.us';

  // Homepage (and the /home alias the app also serves) — canonical always to /.
  if (segs.length === 0 || (segs.length === 1 && segs[0] === 'home')) {
    return inject(html, {
      title: 'Luxedge — Premium Pet Essentials | Better Products for Happier Pets',
      description:
        "Luxedge curates the world's best pet essentials — from orthopedic dog beds to interactive cat toys, smart feeders, grooming, and travel gear. Free shipping, 30-day returns, and handpicked quality you can trust.",
      canonical: root,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'Luxedge',
        url: root,
      },
    });
  }

  // /blog (index) and /blog/write are not indexed targets — keep /blog only.
  if (segs.length === 1 && segs[0] === 'blog') {
    return inject(html, {
      title: 'Pet Care Blog — Guides, Tips & Buying Advice | Luxedge',
      description:
        'Practical pet care guides from Luxedge — puppy essentials, cat enrichment, bird care, horse grooming, cattle basics, and honest buying advice.',
      canonical: `${root}/blog`,
    });
  }

  // Static pages
  const staticKey = `/${segs.join('/')}`;
  const staticMeta = STATIC_PAGES[staticKey];
  if (staticMeta) {
    return inject(html, {
      title: staticMeta.title,
      description: staticMeta.description,
      canonical: `${root}${staticKey}`,
    });
  }

  // /product/:slug
  if (segs.length === 2 && segs[0] === 'product') {
    const slug = decodeURIComponent(segs[1]);
    const products = await getProducts();
    if (products === null) return null; // DB unavailable — serve shell as-is
    const p = products.find((x) => x.slug === slug);
    if (!p) {
      return inject(html, {
        title: 'Product Not Found | Luxedge',
        description: 'This product is no longer available.',
        canonical: `${root}/product/${slug}`,
        noindex: true,
      });
    }
    const canonical = `${root}/product/${slug}`;
    const title = (p.seo_title || `${p.name} | Luxedge`).replace(/\s*\|\s*Luxedge\s*$/, '') + ' | Luxedge';
    return inject(html, {
      title,
      description: cleanText(p.seo_description || p.description || '', 200),
      canonical,
      jsonLd: [productJsonLd(p, canonical), breadcrumbJsonLd(p.name, canonical)],
    });
  }

  // /blog/:slug
  if (segs.length === 2 && segs[0] === 'blog') {
    const slug = decodeURIComponent(segs[1]);
    const posts = await getBlogRegistry(origin, env);
    if (posts === null) return null; // registry unavailable — serve shell as-is
    const post = posts.find((x) => x.slug === slug);
    if (!post) {
      return inject(html, {
        title: 'Post Not Found | Luxedge',
        description: 'This article is no longer available.',
        canonical: `${root}/blog/${slug}`,
        noindex: true,
      });
    }
    const canonical = `${root}/blog/${slug}`;
    return inject(html, {
      title: `${post.title} | Luxedge`,
      description: cleanText(post.excerpt, 200),
      canonical,
      jsonLd: blogJsonLd(post, canonical),
    });
  }

  // /category/:slug
  if (segs.length === 2 && segs[0] === 'category') {
    const slug = decodeURIComponent(segs[1]);
    const categories = await getCategories();
    if (categories === null) return null;
    const cat = categories.find((x) => x.slug === slug);
    if (!cat) {
      return inject(html, {
        title: 'Category Not Found | Luxedge',
        description: 'This category is no longer available.',
        canonical: `${root}/category/${slug}`,
        noindex: true,
      });
    }
    const canonical = `${root}/category/${slug}`;
    return inject(html, {
      title: `${cat.name} — Pet Essentials | Luxedge`,
      description: `Shop ${cat.name} at Luxedge — curated, supplier-verified essentials for you and your pets.`,
      canonical,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: `${cat.name} — Luxedge`,
        url: canonical,
      },
    });
  }

  return null;
}
