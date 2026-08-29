// ============================================================================
// LUXEDGE — worker-side SEO meta + content injection (one path for every UA)
//
// The storefront is a client-rendered SPA, so every route serves the same
// generic index.html shell. This module rewrites the shell for the requested
// route BEFORE it is returned, for ALL user agents (no bot detection):
//   /product/:slug   → product seo_title/seo_description + Product + Breadcrumb JSON-LD
//   /blog/:slug      → post title/excerpt + BlogPosting/FAQPage JSON-LD + the
//                      article body pre-rendered into #root (same content the
//                      client renders, with its real internal links)
//   /category/:slug  → category name + CollectionPage JSON-LD
//   static pages     → unique title/description
// Every indexable route also gets an exact route-specific canonical + og:url.
// React's createRoot().render() replaces #root on mount, so JS users see the
// identical client-rendered article — no duplicated or hidden content.
// No secrets — reads Supabase with the anon key exactly like api/google-feed.ts.
// ============================================================================

export interface SeoEnv {
  ASSETS: {
    fetch(input: Request): Promise<Response>;
  };
}

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

/** Lightweight canonical + og:url rewrite used when route data is unavailable
 * so no content route is ever served with the homepage canonical. */
function injectCanonical(html: string, canonical: string): string {
  let out = html;
  out = out.replace(/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${esc(canonical)}" />`);
  out = out.replace(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${esc(canonical)}" />`);
  return out;
}

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
  /** Full markdown-ish body (same source the client renders from). */
  content?: string;
  /** Visible FAQ section, mirrored as FAQPage JSON-LD — never schema-only. */
  faq?: { q: string; a: string }[];
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

function blogJsonLd(b: BlogEntry, canonical: string): Record<string, unknown>[] {
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
  const blocks: Record<string, unknown>[] = [post];
  if (b.faq && b.faq.length) {
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: b.faq.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    });
  }
  return blocks;
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
// Article body pre-render + route resolution (one semantic path for every UA)
// ---------------------------------------------------------------------------

/** Escape for text and attribute contexts (same rules as esc()). */
function inlineMarkup(text: string): string {
  // Mirrors the client renderer (src/App.tsx renderInline): [label](/path)
  // becomes a real <a>; everything else is plain escaped text.
  const parts = text.split(/(\[[^\]]+\]\([^)]+\))/g).filter(Boolean);
  return parts
    .map((part) => {
      const m = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (m) return `<a href="${esc(m[2])}">${esc(m[1])}</a>`;
      return esc(part);
    })
    .join('');
}

/** Renders the article body exactly like the client (## → h2, # → h1, else <p>;
 * the client shows `### ` FAQ lines as plain paragraphs, so we mirror that too). */
function renderArticleBody(content: string): string {
  return content
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (!t) return '<br />';
      if (t.startsWith('## ')) return `<h2>${esc(t.slice(3))}</h2>`;
      if (t.startsWith('# ')) return `<h1>${esc(t.slice(2))}</h1>`;
      return `<p>${inlineMarkup(t)}</p>`;
    })
    .join('\n');
}

/** Injects the pre-rendered article (title, image, body with real internal
 * links) into the SPA shell's #root. React's createRoot().render() replaces
 * #root on mount, so JS users see the identical client-rendered article — no
 * duplication, no hidden/SEO-only markup. */
function injectArticleBody(html: string, post: BlogEntry): string {
  const image = post.image ? `<img src="${esc(post.image)}" alt="${esc(post.title)}" />` : '';
  const body = renderArticleBody(post.content || post.excerpt || '');
  const article = `<article><h1>${esc(post.title)}</h1>${image}${body}</article>`;
  return html.replace('<div id="root"></div>', `<div id="root">${article}</div>`);
}

export async function maybeInjectSeo(
  html: string,
  pathname: string,
  origin: string,
  env: SeoEnv,
): Promise<string | null> {
  const segs = pathname.split('/').filter(Boolean);
  const root = 'https://luxedge.us';

  // Metadata and content are UA-independent: every indexable route receives the
  // same head (title/desc/canonical/og/robots/JSON-LD), and blog articles also
  // receive their pre-rendered body with real internal links. React replaces
  // #root on mount, so bots and humans see the same semantic content.

  // Homepage (and the /home alias the app also serves) — canonical always to /.
  if (segs.length === 0 || (segs.length === 1 && segs[0] === 'home')) {
    return inject(html, {
      title: 'Luxedge — Premium Pet Essentials | Better Products for Happier Pets',
      description:
        "Luxedge curates the world's best pet essentials — from orthopedic dog beds to interactive cat toys, smart feeders, grooming, and travel gear. Clear delivery options, return policies, and handpicked quality you can trust.",
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
    if (products === null) return injectCanonical(html, `${root}/product/${slug}`); // DB unavailable — keep canonical correct
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
    if (posts === null) return injectCanonical(html, `${root}/blog/${slug}`); // registry unavailable — keep canonical correct
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
    // One semantic path: full head metadata AND the pre-rendered article body
    // (with its real internal links) are served to every UA. React replaces
    // #root on mount, so there is no duplicated visible content.
    let out = inject(html, {
      title: `${post.title} | Luxedge`,
      description: cleanText(post.excerpt, 200),
      canonical,
      jsonLd: blogJsonLd(post, canonical),
    });
    out = injectArticleBody(out, post);
    return out;
  }

  // /category/:slug
  if (segs.length === 2 && segs[0] === 'category') {
    const slug = decodeURIComponent(segs[1]);
    const categories = await getCategories();
    if (categories === null) return injectCanonical(html, `${root}/category/${slug}`);
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
