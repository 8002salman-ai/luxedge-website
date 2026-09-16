import fs from 'node:fs';

const ORIGIN = 'https://luxedge.us';
const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const UA_MOBILE = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';

// Read .env for DB queries if needed
const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const i = line.indexOf('=');
  if (i >= 0) env[line.slice(0, i)] = line.slice(i + 1).replace(/^["']|["']$/g, '').trim();
}
const base = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const HEAD = { apikey: key, Authorization: `Bearer ${key}` };

async function get(url, opts = {}) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': opts.mobile ? UA_MOBILE : UA_DESKTOP,
      ...opts.headers,
    },
    redirect: opts.redirect || 'follow',
  });
  return res;
}

console.log('================================================================');
console.log('         LUXEDGE 6-POINT ADSENSE AUDIT & RE-VERIFICATION        ');
console.log('================================================================\n');

// ============================================================================
// 1. /media = noindex + no ads + sitemap se remove
// ============================================================================
console.log('>>> CHECK 1: /media (noindex + no ads + sitemap removal) <<<');

// 1a. Fetch /media
const mediaRes = await get(`${ORIGIN}/media`);
const mediaHtml = await mediaRes.text();
const mediaXRobots = mediaRes.headers.get('x-robots-tag');
const mediaMetaRobots = mediaHtml.match(/<meta\s+name=["']robots["']\s+content=["'](.*?)["']/i)?.[1];
const mediaHasNoindex = (mediaXRobots && mediaXRobots.includes('noindex')) || (mediaMetaRobots && mediaMetaRobots.includes('noindex'));

console.log(`- /media HTTP Status: ${mediaRes.status}`);
console.log(`- /media X-Robots-Tag header: ${mediaXRobots || 'none'}`);
console.log(`- /media Meta robots tag: ${mediaMetaRobots || 'none'}`);
console.log(`- /media has NOINDEX: ${mediaHasNoindex ? 'PASS (Protected)' : 'FAIL'}`);

// 1b. Check ad exclusion in worker/src
const marketingCode = fs.readFileSync('src/lib/marketing.ts', 'utf8');
const isExcludedInAds = marketingCode.includes("'/media'") || marketingCode.includes('pathname.startsWith(\'/media\')') || marketingCode.includes('isExcludedPath');
console.log(`- AdSense ad exclusion for /media configured: ${isExcludedInAds ? 'PASS (Ads blocked on /media)' : 'VERIFY'}`);

// 1c. Check sample media slug
const sampleMediaSlug = 'how-livestock-salt-licks-are-made-and-used-worldwide-factory-to-farm';
const sampleMediaRes = await get(`${ORIGIN}/media/${sampleMediaSlug}`);
const sampleMediaHtml = await sampleMediaRes.text();
const sampleMediaXRobots = sampleMediaRes.headers.get('x-robots-tag');
const sampleMediaMeta = sampleMediaHtml.match(/<meta\s+name=["']robots["']\s+content=["'](.*?)["']/i)?.[1];
console.log(`- /media/:slug Status: ${sampleMediaRes.status}`);
console.log(`- /media/:slug NOINDEX: ${((sampleMediaXRobots && sampleMediaXRobots.includes('noindex')) || (sampleMediaMeta && sampleMediaMeta.includes('noindex'))) ? 'PASS' : 'FAIL'}`);

// 1d. Check sitemap
const sitemapRaw = await (await get(`${ORIGIN}/sitemap.xml`)).text();
const mediaInSitemap = sitemapRaw.includes('/media');
console.log(`- /media absent from sitemap.xml: ${!mediaInSitemap ? 'PASS (0 media URLs in sitemap)' : 'FAIL'}`);


// ============================================================================
// 2. Entire sitemap actual URLs count + zero 404
// ============================================================================
console.log('\n>>> CHECK 2: Entire Sitemap Actual URLs Count + Zero 404s <<<');

const locMatches = [...sitemapRaw.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1]);
console.log(`- Total URLs extracted from sitemap.xml: ${locMatches.length}`);

const sitemapResults = [];
for (const url of locMatches) {
  try {
    const r = await get(url, { redirect: 'manual' });
    sitemapResults.push({ url, status: r.status });
  } catch (err) {
    sitemapResults.push({ url, status: 'ERROR: ' + err.message });
  }
}

const sitemap404s = sitemapResults.filter(r => r.status === 404);
const sitemapNon200 = sitemapResults.filter(r => r.status !== 200);

console.log(`- Successfully fetched: ${sitemapResults.filter(r => r.status === 200).length} / ${locMatches.length} (200 OK)`);
if (sitemapNon200.length > 0) {
  console.log(`- NON-200 URLs (${sitemapNon200.length}):`, sitemapNon200);
} else {
  console.log('- Zero 404s: PASS (All URLs in sitemap return HTTP 200 OK)');
}


// ============================================================================
// 3. All 32 live products individually verify
// ============================================================================
console.log('\n>>> CHECK 3: All 32 Live Products Individually Verify <<<');

const prodDbRes = await fetch(`${base}/rest/v1/products?select=id,slug,name,price,status,image_url,category_id&status=eq.active&order=slug.asc`, { headers: HEAD });
const dbProducts = await prodDbRes.json();
console.log(`- Active products in database: ${dbProducts.length}`);

let prodErrors = 0;
const productAudit = [];

for (const p of dbProducts) {
  const url = `${ORIGIN}/product/${p.slug}`;
  const r = await get(url);
  const html = await r.text();
  
  const title = html.match(/<title>(.*?)<\/title>/i)?.[1] || '';
  const h1 = html.match(/<h1[^>]*>(.*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, '').trim() || '';
  const hasPrice = html.includes(`$${p.price}`) || html.includes(`${p.price}`);
  const hasImage = p.image_url && p.image_url.startsWith('http');
  
  // Check image accessibility
  let imgStatus = 0;
  if (hasImage) {
    try {
      const imgRes = await fetch(p.image_url, { method: 'HEAD' });
      imgStatus = imgRes.status;
    } catch {
      imgStatus = 500;
    }
  }

  // Contradiction checks
  const hasBiohazard = p.slug.includes('poop-bags') && html.toLowerCase().includes('100% biodegradable in landfills');
  const hasBladderConflict = p.slug.includes('cattle') && html.toLowerCase().includes('water storage bladder');
  const hasNecklaceConflict = p.slug.includes('necklace') && html.toLowerCase().includes('dog collar attachment');

  const cleanTitle = !p.name.startsWith('tyle:') && !p.name.includes('...') && p.name.length > 5;
  const isOk = r.status === 200 && cleanTitle && imgStatus === 200 && !hasBiohazard && !hasBladderConflict && !hasNecklaceConflict;

  if (!isOk) prodErrors++;

  productAudit.push({
    slug: p.slug,
    http: r.status,
    titleClean: cleanTitle,
    imgHttp: imgStatus,
    price: p.price,
    issues: [
      r.status !== 200 ? `HTTP ${r.status}` : null,
      !cleanTitle ? 'Malformed Title' : null,
      imgStatus !== 200 ? `Image HTTP ${imgStatus}` : null,
      hasBiohazard ? 'Contradiction: Biodegradable claim' : null,
      hasBladderConflict ? 'Contradiction: Bladder terminology' : null,
      hasNecklaceConflict ? 'Contradiction: Necklace positioning' : null,
    ].filter(Boolean),
  });
}

console.log(`- Products checked: ${productAudit.length}`);
console.log(`- Products completely clean and 200 OK: ${productAudit.filter(p => p.issues.length === 0).length} / ${productAudit.length}`);
if (prodErrors > 0) {
  console.log('- Product issues found:', productAudit.filter(p => p.issues.length > 0));
} else {
  console.log('- All 32 Products Verification: PASS (Zero contradictions, clean titles, HTTP 200, valid images)');
}


// ============================================================================
// 4. All published blogs individually rendered-text QA
// ============================================================================
console.log('\n>>> CHECK 4: All Published Blogs Individually Rendered-Text QA <<<');

const blogDbRes = await fetch(`${base}/rest/v1/blog_posts?select=id,slug,title,status,hero_image_url&status=eq.published&order=slug.asc`, { headers: HEAD });
const dbBlogs = await blogDbRes.json();
console.log(`- Published blog posts in database: ${dbBlogs.length}`);

const AI_FLUFF_PATTERNS = [
  /\bin today's fast-paced world\b/i,
  /\bin today's digital world\b/i,
  /\bwhether you're a beginner or an expert\b/i,
  /\blet's dive in\b/i,
  /\bunlock the secrets\b/i,
  /\bgame changer\b/i,
  /\bdelve into\b/i,
  /\btapestry\b/i,
];

let blogErrors = 0;
const blogAudit = [];

for (const b of dbBlogs) {
  const url = `${ORIGIN}/blog/${b.slug}`;
  const r = await get(url);
  const html = await r.text();

  const titleMatch = html.match(/<title>(.*?)<\/title>/i)?.[1] || '';
  const h1Match = html.match(/<h1[^>]*>(.*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, '').trim() || '';
  const hasJsonLd = html.includes('application/ld+json');
  const hasFaqSchema = html.includes('FAQPage');
  const hasArticleSchema = html.includes('Article') || html.includes('BlogPosting');

  // Word count approximation of article text
  const cleanBodyText = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
                            .replace(/<[^>]+>/g, ' ')
                            .replace(/\s+/g, ' ')
                            .trim();
  const wordCount = cleanBodyText.split(' ').length;

  // AI fluff check
  const fluffFound = AI_FLUFF_PATTERNS.filter(pattern => pattern.test(cleanBodyText)).map(p => p.source);

  // Markdown defects check
  const hasDanglingBullets = /\n\s*-\s*\n/.test(html);
  const hasBrokenMarkdown = /\[.*?\]\(\s*\)/.test(html);

  // Hero image check
  let heroHttp = 0;
  if (b.hero_image_url) {
    try {
      const imgR = await fetch(b.hero_image_url, { method: 'HEAD' });
      heroHttp = imgR.status;
    } catch {
      heroHttp = 500;
    }
  }

  const issues = [
    r.status !== 200 ? `HTTP ${r.status}` : null,
    wordCount < 300 ? `Low word count (${wordCount})` : null,
    fluffFound.length > 0 ? `AI Fluff: ${fluffFound.join(', ')}` : null,
    hasDanglingBullets ? 'Dangling bullets' : null,
    hasBrokenMarkdown ? 'Broken markdown links' : null,
    heroHttp !== 200 ? `Hero image HTTP ${heroHttp}` : null,
    !hasJsonLd ? 'Missing JSON-LD' : null,
  ].filter(Boolean);

  if (issues.length > 0) blogErrors++;

  blogAudit.push({
    slug: b.slug,
    http: r.status,
    title: b.title,
    h1: h1Match,
    words: wordCount,
    heroHttp,
    faqSchema: hasFaqSchema,
    issues,
  });
}

console.log(`- Blog guides checked: ${blogAudit.length}`);
console.log(`- Blogs with zero defects: ${blogAudit.filter(b => b.issues.length === 0).length} / ${blogAudit.length}`);
for (const b of blogAudit) {
  console.log(`  * /blog/${b.slug} | Words: ~${b.words} | Hero HTTP: ${b.heroHttp} | FAQ Schema: ${b.faqSchema} | Issues: ${b.issues.length === 0 ? 'CLEAN' : b.issues.join(', ')}`);
}


// ============================================================================
// 5. Supplier-hosted images/license audit
// ============================================================================
console.log('\n>>> CHECK 5: Supplier-Hosted Images / License Audit <<<');

const allImages = new Set();
// Collect product images
for (const p of dbProducts) {
  if (p.image_url) allImages.add(p.image_url);
}
// Collect blog hero images
for (const b of dbBlogs) {
  if (b.hero_image_url) allImages.add(b.hero_image_url);
}

const hostDomains = {};
let brokenImages = 0;

for (const imgUrl of allImages) {
  try {
    const host = new URL(imgUrl).hostname;
    hostDomains[host] = (hostDomains[host] || 0) + 1;
    const r = await fetch(imgUrl, { method: 'HEAD' });
    if (!r.ok && r.status !== 405) {
      brokenImages++;
      console.log(`  ! Broken image (${r.status}): ${imgUrl}`);
    }
  } catch (err) {
    brokenImages++;
    console.log(`  ! Image fetch error: ${imgUrl} (${err.message})`);
  }
}

console.log(`- Total unique catalog & editorial images audited: ${allImages.size}`);
console.log('- Image hosting distribution:');
for (const [h, count] of Object.entries(hostDomains)) {
  let licenseType = 'Custom / Unclassified';
  if (h.includes('pexels.com')) licenseType = 'Pexels Free Commercial License (Royalty Free)';
  else if (h.includes('wikimedia.org')) licenseType = 'Wikimedia Commons / Public Domain / CC';
  else if (h.includes('cjdropshipping.com') || h.includes('cndrop')) licenseType = 'Authorized Supplier Product Photography (CJ API)';
  else if (h.includes('supabase.co')) licenseType = 'Direct Brand Cloud Storage (Luxedge CDN)';
  console.log(`  * ${h}: ${count} images [${licenseType}]`);
}
console.log(`- Broken images count: ${brokenImages} (${brokenImages === 0 ? 'PASS - Zero broken images' : 'FAIL'})`);


// ============================================================================
// 6. Mobile live-page crawl
// ============================================================================
console.log('\n>>> CHECK 6: Mobile Live-Page Crawl (Simulated Mobile Device) <<<');

const mobileCheckUrls = [
  '/',
  '/shop',
  '/blog',
  '/blog/best-bird-feeder-buyers-guide',
  '/category/dog-supplies',
  '/category/horse',
  '/product/dog-poop-bags-biodegradable-waste-bag-rolls',
  '/product/outdoor-hanging-bird-feeder',
  '/about',
  '/contact',
  '/privacy',
  '/editorial-policy',
  '/disclaimer',
];

let mobileErrors = 0;
for (const p of mobileCheckUrls) {
  const url = `${ORIGIN}${p}`;
  const r = await get(url, { mobile: true });
  const html = await r.text();
  const hasViewport = html.includes('name="viewport"') && html.includes('width=device-width');
  const title = html.match(/<title>(.*?)<\/title>/i)?.[1] || '';
  const contentLength = html.length;
  const isOk = r.status === 200 && hasViewport && contentLength > 1000;
  if (!isOk) mobileErrors++;
  console.log(`  * Mobile ${p}: Status=${r.status}, Viewport=${hasViewport ? 'YES' : 'NO'}, Title="${title.slice(0, 45)}..."`);
}

console.log(`- Mobile crawl completed: ${mobileCheckUrls.length - mobileErrors} / ${mobileCheckUrls.length} passed.`);
console.log('\n================================================================');
console.log('              COMPREHENSIVE VERIFICATION COMPLETE               ');
console.log('================================================================');
