// LUXEDGE — production crawl audit (sitemap + internal links).
//
// Checks what Google and AdSense crawlers actually receive from the live site:
//   1. every <loc> in /sitemap.xml resolves 200, is indexable, and has a
//      self-referencing canonical (a sitemap URL that 404s, redirects, or is
//      noindexed is a crawl-budget and review-quality defect)
//   2. every internal href in the served HTML of those pages resolves
//      (broken internal links are the classic "low value content" signal)
//
// Usage:
//   node scripts/crawl-audit.mjs                       # audit https://luxedge.us
//   node scripts/crawl-audit.mjs --base http://localhost:5173
//   node scripts/crawl-audit.mjs --json                # machine-readable report
//
// Read-only: it only issues GETs. Same crawl the nightly sitemap-health job
// runs, extended with the internal-link pass.

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = opt('base', 'https://luxedge.us').replace(/\/$/, '');
const AS_JSON = args.includes('--json');
const CONCURRENCY = Number(opt('concurrency', '5'));
const UA = 'LuxedgeCrawlAudit/1.0 (+https://luxedge.us)';

/** Routes that are intentionally non-indexable / non-content. */
const EXPECT_NOINDEX = [/^\/admin/, /^\/checkout/, /^\/cart$/, /^\/account/, /^\/wishlist/, /^\/media(\/|$)/, /^\/blog\/write/, /^\/campaigns\//];
/** Link targets that are assets or non-page endpoints, not crawlable pages. */
const NON_PAGE = /\.(png|jpe?g|webp|avif|svg|gif|ico|css|js|json|xml|txt|webmanifest|woff2?|mp4|pdf)$/i;

async function get(url) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
    const type = res.headers.get('content-type') || '';
    const body = /text\/|xml|json/i.test(type) ? await res.text() : '';
    return { status: res.status, location: res.headers.get('location'), body };
  } catch (err) {
    return { status: 0, error: err.message, body: '' };
  }
}

const attr = (html, re) => (html.match(re) || [])[1];

/** Unsupported-claim classes (same list as scripts/product-claim-audit.mjs).
 * Scanning the SERVED HTML covers product copy, guide bodies and category
 * intros in one pass — the same text Google and AdSense receive. */
const CLAIMS = [
  ['airline-approval', /\bairline[- ]approved\b|\bTSA[- ]approved\b|\bIATA[- ]approved\b/i],
  ['crash-test', /\bcrash[- ]test(ed|ing)?\b|\bsafety[- ]certified\b/i],
  ['certification', /\bCertiPUR[- ]US\b|\bOEKO[- ]TEX\b|\bFDA[- ]approved\b|\bCE[- ]marked\b/i],
  ['medical-outcome', /\bcures?\b|\bprevents? (pain|disease|infection)\b|\bjoint support\b|\brelieves? (pain|joint)\b|\btreats? (pain|disease)\b/i],
  ['decibels', /\b\d{2}\s?dB\b/i],
  ['uv-protection', /\bUV[- ]?(protection|resistant|blocking|proof)\b|\bUPF\s?\d+/i],
  ['biodegradable-timeline', /\bbiodegrades?[^.]{0,40}\b(year|month|day)/i],
  ['third-party-brand', /\b3M\b|\bGore[- ]?Tex\b/,],
];
const stripTags = (html) => html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ')
  .trim();

function metaRobots(html) {
  const raw = attr(html, /<meta\s+name="robots"\s+content="([^"]*)"/i) || '';
  return raw.toLowerCase();
}

async function pool(items, worker) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await worker(items[idx], idx);
    }
  }));
  return out;
}

const sitemapRes = await get(`${BASE}/sitemap.xml`);
if (sitemapRes.status !== 200) {
  console.error(`sitemap.xml -> HTTP ${sitemapRes.status || 'ERR'}`);
  process.exit(1);
}
const locs = [...sitemapRes.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
const toPath = (u) => {
  try {
    const url = new URL(u, BASE);
    return url.origin === new URL(BASE).origin ? url.pathname.replace(/\/$/, '') || '/' : null;
  } catch { return null; }
};
const sitemapPaths = locs.map(toPath).filter(Boolean);

const pageReports = await pool(sitemapPaths, async (path) => {
  const url = `${BASE}${path === '/' ? '/' : path}`;
  const { status, location, body } = await get(url);
  const canonical = attr(body, /<link\s+rel="canonical"\s+href="([^"]*)"/i) || '';
  const robots = metaRobots(body);
  const h1s = [...body.matchAll(/<h1[\s>]/gi)].length;
  const title = attr(body, /<title>([^<]*)<\/title>/i) || '';
  const links = [...body.matchAll(/href="(\/[^"#?]*)"/g)].map((m) => m[1]);
  const expectedCanonical = `${BASE}${path === '/' ? '/' : path}`;
  const problems = [];
  if (status !== 200) problems.push(`status ${status || 'ERR'}`);
  if (location) problems.push(`redirect -> ${location}`);
  if (/noindex/.test(robots)) problems.push(`robots "${robots}"`);
  if (canonical.replace(/\/$/, '') !== expectedCanonical.replace(/\/$/, '')) problems.push(`canonical "${canonical}"`);
  if (h1s !== 1) problems.push(`${h1s} h1`);
  if ((body.length || 0) < 1500) problems.push(`thin HTML (${body.length}b)`);
  const text = stripTags(body);
  const claims = [];
  for (const [label, re] of CLAIMS) {
    const hit = text.match(re);
    if (hit) claims.push({ label, text: hit[0] });
  }
  return { path, status, robots, canonical, h1s, title, links, problems, claims };
});

const internalLinks = new Set();
for (const p of pageReports) {
  for (const href of p.links || []) {
    if (NON_PAGE.test(href)) continue;
    internalLinks.add(href.replace(/\/$/, '') || '/');
  }
}
const linkList = [...internalLinks];
const linkReports = await pool(linkList, async (href) => {
  const { status, location } = await get(`${BASE}${href}`);
  return { href, status, location };
});

const claimPages = pageReports.filter((p) => (p.claims || []).length);
const brokenLinks = linkReports.filter((l) => l.status === 0 || l.status >= 400);
const redirectedLinks = linkReports.filter((l) => l.status >= 300 && l.status < 400);
const badPages = pageReports.filter((p) => p.problems.length);
const srcByLink = new Map();
for (const p of pageReports) {
  for (const href of p.links || []) {
    const key = href.replace(/\/$/, '') || '/';
    if (!srcByLink.has(key)) srcByLink.set(key, []);
    srcByLink.get(key).push(p.path);
  }
}

const report = {
  base: BASE,
  sitemap: { urls: locs.length, nonSelfPaths: locs.length - sitemapPaths.length },
  sitemapPages: pageReports.map(({ path, status, robots, canonical, h1s, problems }) => ({ path, status, robots, canonical, h1s, problems })),
  internalLinks: { checked: linkList.length, broken: brokenLinks, redirected: redirectedLinks },
  intentionalNoindexSources: EXPECT_NOINDEX.length,
};

if (AS_JSON) {
  console.log(JSON.stringify({ ...report, brokenLinkSources: Object.fromEntries(brokenLinks.map((b) => [b.href, srcByLink.get(b.href) || []])) }, null, 2));
} else {
  console.log(`\n=== ${BASE} crawl audit ===`);
  console.log(`sitemap: ${locs.length} URLs (${sitemapPaths.length} own-origin paths)\n`);
  console.log(`SITEMAP PAGE HEALTH: ${pageReports.length - badPages.length}/${pageReports.length} clean`);
  for (const p of badPages) console.log(`  FAIL ${p.path} — ${p.problems.join('; ')}`);
  console.log(`\nUNSUPPORTED-CLAIM SCAN: ${claimPages.length} page(s) with a flagged claim`);
  for (const p of claimPages) {
    console.log(`  ${p.path} — ${p.claims.map((c) => `${c.label}: "${c.text}"`).join(' · ')}`);
  }
  console.log(`\nINTERNAL LINKS: ${linkList.length} checked, ${brokenLinks.length} broken, ${redirectedLinks.length} redirected`);
  for (const b of brokenLinks) console.log(`  BROKEN ${b.href} (${b.status || 'ERR'}) from: ${(srcByLink.get(b.href) || []).join(', ')}`);
  for (const r of redirectedLinks) console.log(`  REDIRECT ${r.href} -> ${r.location}`);
  console.log('');
}
process.exit(badPages.length || brokenLinks.length ? 1 : 0);
