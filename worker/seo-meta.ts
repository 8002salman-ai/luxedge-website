// ============================================================================
// LUXEDGE — worker-side SEO meta + content injection (one path for every UA)
//
// The storefront is a client-rendered SPA, so every route serves the same
// generic index.html shell. This module rewrites the shell for the requested
// route BEFORE it is returned, for ALL user agents (no bot detection):
//   /product/:slug    → product seo_title/seo_description + Product + Breadcrumb
//                       JSON-LD + a pre-rendered product summary in #root
//                       (title, price, stock/shipping facts, description,
//                       category link) — the same content the client renders
//   /blog/:slug       → post title/excerpt + BlogPosting/FAQPage JSON-LD + the
//                       article body pre-rendered into #root (same content the
//                       client renders, with its real internal links)
//   /category/:slug   → category name + CollectionPage JSON-LD + a pre-rendered
//                       category intro with real product links (mirrors the
//                       client category grid)
//   / (homepage)      → WebSite JSON-LD + pre-rendered hero + category navigation
//   /about            → unique title/description + About copy pre-rendered from
//                       src/content/about.ts (same copy the client renders)
//   static pages      → unique title/description
// Every indexable route also gets an exact route-specific canonical + og:url.
// React's createRoot().render() replaces #root on mount, so JS users see the
// identical client-rendered content — no duplicated or hidden content.
// No secrets — reads Supabase with the anon key exactly like api/google-feed.ts.
// ============================================================================

import { ABOUT_QUOTE, ABOUT_LEAD, ABOUT_SECTIONS } from '../src/content/about';
import {
  CONTACT_INFO,
  CONTACT_INTRO,
  PRIVACY_SECTIONS,
  TERMS_SECTIONS,
  RETURNS_SECTIONS,
  SHIPPING_SECTIONS,
  FAQ_DATA,
} from '../src/content/policies';

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
  short_description?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  seo_keywords?: string | null;
  price?: number | null;
  compare_at_price?: number | null;
  brand?: string | null;
  stock_status?: string | null;
  us_inventory?: boolean | null;
  free_shipping?: boolean | null;
  shipping_cost?: number | null;
  delivery_min_days?: number | null;
  delivery_max_days?: number | null;
  currency?: string | null;
  /** Embedded category name via categories(name) — the REST key is the
   * relation name `categories`. */
  categories?: { name?: string } | null;
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
  // Page-specific fields the storefront shows: short/long description, price,
  // stock, shipping and delivery estimates, plus the embedded category name for
  // a contextual "More in {category}" link. features/specifications are mostly
  // empty in the live catalog, so they are deliberately not pre-rendered.
  return cachedFetch('seo:products', TTL_DB, () =>
    fetchJson<ProductRow[]>(
      base,
      key,
      'products?select=slug,name,description,short_description,seo_title,seo_description,seo_keywords,price,compare_at_price,brand,stock_status,us_inventory,free_shipping,shipping_cost,delivery_min_days,delivery_max_days,categories(name)&status=eq.active&limit=500',
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

interface BlogCmsRow {
  slug: string;
  title: string;
  excerpt?: string | null;
  hero_image_url?: string | null;
  published_at?: string | null;
  created_at?: string | null;
  author_name?: string | null;
  content?: string | null;
  faq?: { q: string; a: string }[] | null;
}

function mapCmsToBlogEntry(r: BlogCmsRow): BlogEntry | null {
  if (!r || !r.slug) return null;
  const date = (r.published_at || r.created_at || '').slice(0, 10) || undefined;
  return {
    slug: r.slug,
    title: r.title || r.slug,
    excerpt: r.excerpt || r.title || '',
    image: r.hero_image_url || undefined,
    date,
    // Truthful default attribution: when the CMS row has no individual author,
    // attribute the article to the editorial team instead of a bare brand name
    // or an invented persona.
    authorName: r.author_name || 'Luxedge Editorial Team',
    content: r.content || undefined,
    faq: Array.isArray(r.faq) && r.faq.length ? r.faq : undefined,
  };
}

/**
 * Blog registry — source of truth is the Supabase CMS (published only; RLS
 * enforces published + published_at <= now()). Short TTL so a freshly
 * published CMS post gets SEO + indexability on the very next worker requests
 * WITHOUT a redeploy. Falls back to the static blog-seo.json shell when the DB
 * is unreachable / the table is not yet migrated (migration/rollback path).
 */
async function getBlogRegistry(origin: string, env: SeoEnv): Promise<BlogEntry[] | null> {
  const base = supabaseBase();
  const key = supabaseAnon();
  if (base && key) {
    const cms = await cachedFetch<BlogEntry[]>('seo:blog-cms', 60_000, async () => {
      const rows = await fetchJson<BlogCmsRow[]>(
        base,
        key,
        'blog_posts?select=slug,title,excerpt,hero_image_url,published_at,created_at,author_name,content,faq&status=eq.published&order=published_at.desc',
      );
      if (!rows) throw new Error('blog_cms unavailable');
      return rows
        .map(mapCmsToBlogEntry)
        .filter((x): x is BlogEntry => x !== null);
    });
    if (cms) return cms;
  }
  // Fallback: legacy static registry (used while the DB/migration is not ready).
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
  // Truthful organic attribution (BlogPosting is a Person schema): default to
  // the editorial team when no individual author is recorded in the CMS.
  post.author = { '@type': 'Person', name: b.authorName || 'Luxedge Editorial Team' };
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
  const author = post.authorName || 'Luxedge Editorial Team';
  const date = post.date
    ? new Date(post.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : '';
  const byline = `<p>Written by ${esc(author)}${date ? ' \u2014 ' + esc(date) : ''}</p>`;
  const editorialNote = author === 'Luxedge Editorial Team'
    ? '<p><em>Buying guides are researched and reviewed by the Luxedge editorial team. They are informational and not veterinary, medical, or nutritional advice.</em></p>'
    : '';
  const body = renderArticleBody(post.content || post.excerpt || '');
  const article = `<article><h1>${esc(post.title)}</h1>${byline}${editorialNote}${image}${body}</article>`;
  return html.replace('<div id="root"></div>', `<div id="root">${article}</div>`);
}

// ---------------------------------------------------------------------------
// Pre-rendered route bodies (product / category / homepage / about)
// ---------------------------------------------------------------------------

/** Static category intros — mirrors CAT_META in src/App.tsx (keep in sync).
 * Used only when the live categories table has no description for the slug,
 * so the pre-render and the client category header show the same line. */
const CATEGORY_DESC: Record<string, string> = {
  'dog-supplies': 'Walking, training & everyday dog essentials',
  'cat-supplies': 'Play, comfort & everyday cat essentials',
  'pet-beds': 'Comfort-led pieces for deeper rest',
  'pet-toys': 'Interactive play and everyday enrichment',
  'feeding-water': 'Considered pieces for daily mealtimes',
  grooming: 'Simple tools for everyday care',
  'pet-accessories': 'Useful pieces for life together',
  'bird-supplies': 'Seed, feed & care essentials for feathered friends',
  horse: 'Practical care and stable essentials for horses',
  cattle: 'Useful feeding and care essentials for cattle and livestock',
};

function money(value: number | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  return `$${n.toFixed(2)}`;
}

/** Pre-renders the product essentials into the SPA shell: the same title,
 * price, stock/shipping facts, description and category link the Product
 * detail page renders after hydration. Only real catalog columns are used —
 * nothing is invented. */
function injectProductBody(html: string, p: ProductRow): string {
  const parts: string[] = [`<h1>${esc(p.name)}</h1>`];
  const price = money(p.price);
  const compare = money(p.compare_at_price);
  if (price) {
    parts.push(compare ? `<p>Price: <strong>${price}</strong> <s>${compare}</s></p>` : `<p>Price: <strong>${price}</strong></p>`);
  }
  const facts: string[] = [];
  if (p.stock_status === 'in_stock' || p.us_inventory === true) facts.push('In stock');
  else if (p.stock_status && p.stock_status !== 'in_stock') facts.push('Availability confirmed at checkout');
  if (p.free_shipping === true) facts.push('Free shipping');
  else if (p.shipping_cost && Number(p.shipping_cost) > 0) facts.push(`Shipping ${money(p.shipping_cost)}`);
  if (p.delivery_min_days != null && p.delivery_max_days != null) {
    facts.push(`Estimated delivery ${p.delivery_min_days}–${p.delivery_max_days} business days`);
  }
  if (facts.length) parts.push(`<p>${esc(facts.join(' · '))}</p>`);
  const lead = (p.short_description || '').trim() || (p.description || '').trim();
  if (lead) parts.push(`<h2>Details</h2>`, `<p>${esc(lead)}</p>`);
  if (p.description && p.description.trim() && p.description.trim() !== lead) {
    parts.push(`<h2>Description</h2>`);
    parts.push(...p.description.split(/\n+/).filter((l) => l.trim()).map((l) => `<p>${esc(l)}</p>`));
  }
  const links: string[] = [];
  if (p.categories && p.categories.name) {
    const catSlug = (p.categories.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    links.push(`<a href="/category/${esc(catSlug)}">More in ${esc(p.categories.name)}</a>`);
  }
  links.push('<a href="/shop">Shop all pet essentials</a>');
  parts.push(`<p>${links.join(' · ')}</p>`);
  return html.replace('<div id="root"></div>', `<div id="root"><article>${parts.join('\n')}</article></div>`);
}

/** Pre-renders the category intro into the SPA shell: the category name, the
 * same descriptive line the client header shows, and links to the real
 * products in the category (the client renders these same products as cards). */
function injectCategoryBody(html: string, cat: CategoryRow, products: ProductRow[]): string {
  const inCategory = products.filter(
    (p) => p.slug && p.categories && p.categories.name && p.categories.name.toLowerCase() === cat.name.toLowerCase(),
  );
  // Mirror the client category header exactly (CAT_META in src/App.tsx or the
  // client's `Browse our {category} collection` fallback) so the pre-render and
  // the hydrated page show the same line. The DB description column is ignored
  // here because the client does not render it. Keep CATEGORY_DESC in sync.
  const desc = CATEGORY_DESC[cat.slug] || `Browse our ${cat.name} collection`;
  const parts: string[] = [`<h1>${esc(cat.name)}</h1>`, `<p>${esc(desc)}</p>`];
  if (inCategory.length > 0) {
    const items = inCategory
      .slice(0, 12)
      .map((p) => `<li><a href="/product/${esc(p.slug!)}">${esc(p.name)}</a></li>`)
      .join('');
    parts.push(`<ul>${items}</ul>`);
  }
  return html.replace('<div id="root"></div>', `<div id="root"><article>${parts.join('\n')}</article></div>`);
}

/** Pre-renders the homepage hero + category navigation into the SPA shell.
 * Mirrors the HomePage section copy and every link the client renders. */
function injectHomeBody(html: string): string {
  const parts: string[] = [
    `<h1>The Best Finds for Every Pet, Thoughtfully Curated.</h1>`,
    `<p>Sourced worldwide. Chosen with care.</p>`,
    `<p>We search trusted sources around the world for well-made essentials, then choose the pieces worth bringing home.</p>`,
    `<p>Shop by pet</p>`,
    `<h2>Who are you shopping for?</h2>`,
    `<ul>` +
      `<li><a href="/category/dog-supplies">Dog</a></li>` +
      `<li><a href="/category/cat-supplies">Cat</a></li>` +
      `<li><a href="/category/bird-supplies">Birds</a></li>` +
      `<li><a href="/category/horse">Horse</a></li>` +
      `<li><a href="/category/cattle">Livestock</a></li>` +
      `</ul>`,
    `<p>Browse</p>`,
    `<h2>Popular Categories</h2>`,
    `<ul>` +
      `<li><a href="/shop">Shop all products</a></li>` +
      `<li><a href="/category/dog-supplies">Dog walking &amp; training</a></li>` +
      `<li><a href="/category/pet-beds">Beds &amp; mats</a></li>` +
      `<li><a href="/category/grooming">Grooming</a></li>` +
      `<li><a href="/category/feeding-water">Feeding &amp; water</a></li>` +
      `<li><a href="/category/pet-toys">Toys</a></li>` +
      `<li><a href="/category/pet-accessories">Travel &amp; accessories</a></li>` +
      `<li><a href="/category/cat-supplies">Cat essentials</a></li>` +
      `<li><a href="/category/bird-supplies">Bird supplies</a></li>` +
      `</ul>`,
  ];
  return html.replace('<div id="root"></div>', `<div id="root"><article>${parts.join('\n')}</article></div>`);
}

/** Pre-renders the /about copy (shared with the client AboutPage) so the
 * initial HTML carries the same truthful content the hydrated page shows. */
function injectAboutBody(html: string): string {
  const parts: string[] = [`<h1>About Luxedge</h1>`, `<p>${esc(ABOUT_QUOTE)}</p>`, `<p>${esc(ABOUT_LEAD)}</p>`];
  for (const s of ABOUT_SECTIONS) {
    parts.push(`<h2>${esc(s.title)}</h2>`, `<p>${esc(s.body)}</p>`);
  }
  return html.replace('<div id="root"></div>', `<div id="root"><article>${parts.join('\n')}</article></div>`);
}

/** Pre-renders the /contact page with contact info and intro. */
function injectContactBody(html: string): string {
  const cards = CONTACT_INFO.map((c) => `<li><strong>${esc(c.label)}:</strong> ${esc(c.value)} (${esc(c.sub)})</li>`).join('');
  const parts: string[] = [
    `<h1>Contact Us</h1>`,
    `<p>${esc(CONTACT_INTRO)}</p>`,
    `<ul>${cards}</ul>`,
    `<p>Email: <a href="mailto:hello@luxedge.us">hello@luxedge.us</a> | Phone: (440) 941-8002 | Hours: Mon-Fri, 9AM-6PM CT</p>`,
  ];
  return html.replace('<div id="root"></div>', `<div id="root"><article>${parts.join('\n')}</article></div>`);
}

/** Pre-renders a legal/policy page from shared section data. */
function injectLegalBody(html: string, title: string, sections: { title: string; body: string }[]): string {
  const parts: string[] = [`<h1>${esc(title)}</h1>`, `<p>Last updated: August 26, 2026</p>`];
  for (const s of sections) {
    parts.push(`<h2>${esc(s.title)}</h2>`, `<p>${esc(s.body)}</p>`);
  }
  return html.replace('<div id="root"></div>', `<div id="root"><article>${parts.join('\n')}</article></div>`);
}

/** Pre-renders the /faq page with categories and questions. */
function injectFaqBody(html: string): string {
  const parts: string[] = [`<h1>Frequently Asked Questions</h1>`];
  for (const cat of FAQ_DATA) {
    parts.push(`<h2>${esc(cat.category)}</h2>`);
    for (const item of cat.items) {
      parts.push(`<h3>${esc(item.q)}</h3>`, `<p>${esc(item.a)}</p>`);
    }
  }
  return html.replace('<div id="root"></div>', `<div id="root"><article>${parts.join('\n')}</article></div>`);
}

/** Pre-renders the /shop page with category navigation. */
function injectShopBody(html: string): string {
  const cats = [
    ['Dog Supplies', '/category/dog-supplies'], ['Cat Supplies', '/category/cat-supplies'],
    ['Pet Beds', '/category/pet-beds'], ['Pet Toys', '/category/pet-toys'],
    ['Feeding & Water', '/category/feeding-water'], ['Grooming', '/category/grooming'],
    ['Pet Accessories', '/category/pet-accessories'], ['Bird Supplies', '/category/bird-supplies'],
    ['Horse', '/category/horse'], ['Cattle', '/category/cattle'],
  ];
  const links = cats.map(([label, to]) => `<li><a href="${esc(to)}">${esc(label)}</a></li>`).join('');
  const parts: string[] = [
    `<h1>Shop All Pet Essentials</h1>`,
    `<p>Handpicked for quality, comfort, and value. Browse by category below.</p>`,
    `<h2>Categories</h2>`,
    `<ul>${links}</ul>`,
  ];
  return html.replace('<div id="root"></div>', `<div id="root"><article>${parts.join('\n')}</article></div>`);
}

/** Pre-renders the /blog index with recent post links from the CMS. */
async function injectBlogIndexBody(html: string, origin: string, env: SeoEnv): Promise<string> {
  const posts = await getBlogRegistry(origin, env);
  const parts: string[] = [
    `<h1>Blog</h1>`,
    `<p>Practical pet care guides from Luxedge — puppy essentials, cat enrichment, bird care, horse grooming, cattle basics, and honest buying advice.</p>`,
  ];
  if (posts && posts.length > 0) {
    const items = posts.slice(0, 15).map((p) => `<li><a href="/blog/${esc(p.slug)}">${esc(p.title)}</a> — ${esc(p.excerpt || '').slice(0, 100)}</li>`).join('');
    parts.push(`<h2>Latest articles</h2>`, `<ul>${items}</ul>`);
  }
  return html.replace('<div id="root"></div>', `<div id="root"><article>${parts.join('\n')}</article></div>`);
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

  // Noindex utility/private routes so they never appear in search results.
  const noIndexRoutes = ['admin', 'checkout', 'login', 'signup', 'account'];
  if (segs.length === 1 && noIndexRoutes.includes(segs[0])) {
    return inject(html, {
      title: `${segs[0].charAt(0).toUpperCase() + segs[0].slice(1)} | Luxedge`,
      description: '',
      canonical: `${root}/${segs[0]}`,
      noindex: true,
    });
  }

  // Homepage (and the /home alias the app also serves) — canonical always to /.
  if (segs.length === 0 || (segs.length === 1 && segs[0] === 'home')) {
    let out = inject(html, {
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
    // Pre-render the hero + category navigation so the initial HTML (and any
    // non-JS crawler) sees real substantive content, not an empty shell.
    out = injectHomeBody(out);
    return out;
  }

  // /blog (index) — pre-render the index with recent post links from the CMS.
  if (segs.length === 1 && segs[0] === 'blog') {
    let out = inject(html, {
      title: 'Pet Care Blog — Guides, Tips & Buying Advice | Luxedge',
      description:
        'Practical pet care guides from Luxedge — puppy essentials, cat enrichment, bird care, horse grooming, cattle basics, and honest buying advice.',
      canonical: `${root}/blog`,
    });
    out = await injectBlogIndexBody(out, origin, env);
    return out;
  }

  // /shop — pre-render category navigation.
  if (segs.length === 1 && segs[0] === 'shop') {
    let out = inject(html, {
      title: 'Shop All Pet Essentials — Dog, Cat, Bird, Horse & More | Luxedge',
      description:
        'Browse the Luxedge curated collection — dog beds and leashes, cat toys and fountains, bird feeders, horse grooming and livestock essentials, all sourced and ready to ship.',
      canonical: `${root}/shop`,
    });
    out = injectShopBody(out);
    return out;
  }

  // Static pages (about also receives the shared About copy pre-rendered).
  const staticKey = `/${segs.join('/')}`;
  const staticMeta = STATIC_PAGES[staticKey];
  if (staticMeta) {
    let out = inject(html, {
      title: staticMeta.title,
      description: staticMeta.description,
      canonical: `${root}${staticKey}`,
    });
    // Pre-render body content for each static page so crawlers see
    // substantive material, not an empty SPA shell.
    if (staticKey === '/about') out = injectAboutBody(out);
    else if (staticKey === '/contact') out = injectContactBody(out);
    else if (staticKey === '/privacy') out = injectLegalBody(out, 'Privacy Policy', PRIVACY_SECTIONS);
    else if (staticKey === '/terms') out = injectLegalBody(out, 'Terms of Service', TERMS_SECTIONS);
    else if (staticKey === '/returns') out = injectLegalBody(out, 'Returns & Replacement Policy', RETURNS_SECTIONS);
    else if (staticKey === '/shipping-policy') out = injectLegalBody(out, 'Shipping Policy', SHIPPING_SECTIONS);
    else if (staticKey === '/faq') out = injectFaqBody(out);
    return out;
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
    let out = inject(html, {
      title,
      description: cleanText(p.seo_description || p.short_description || p.description || '', 200),
      canonical,
      jsonLd: [productJsonLd(p, canonical), breadcrumbJsonLd(p.name, canonical)],
    });
    // Pre-render the real product facts into #root (same content the client
    // renders after hydration) so crawlers see page-specific substance.
    out = injectProductBody(out, p);
    return out;
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
    let out = inject(html, {
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
    // Pre-render the category intro + real product links (the client renders
    // the same products as its category grid).
    const products = await getProducts();
    if (products !== null) out = injectCategoryBody(out, cat, products);
    return out;
  }

  return null;
}
