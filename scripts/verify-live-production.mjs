const ORIGIN = 'https://luxedge.us';

async function checkUrl(path, opts = {}) {
  const url = path.startsWith('http') ? path : `${ORIGIN}${path}`;
  try {
    const res = await fetch(url, {
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        ...opts.headers,
      },
    });
    const text = opts.text ? await res.text() : '';
    return {
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      text,
      location: res.headers.get('location'),
    };
  } catch (err) {
    return { error: err.message };
  }
}

console.log('=== STARTING LIVE PRODUCTION VERIFICATION ===\n');

// 1. Ads.txt
console.log('1. Checking ads.txt...');
const adsTxt = await checkUrl('/ads.txt', { text: true });
console.log(`Status: ${adsTxt.status}`);
console.log(`Publisher ID match: ${adsTxt.text.includes('pub-5473713135927706')}`);

// 2. Robots.txt
console.log('\n2. Checking robots.txt...');
const robots = await checkUrl('/robots.txt', { text: true });
console.log(`Status: ${robots.status}`);
console.log(`Sitemap directive: ${robots.text.includes('sitemap.xml')}`);

// 3. Sitemap.xml
console.log('\n3. Checking sitemap.xml...');
const sitemap = await checkUrl('/sitemap.xml', { text: true });
console.log(`Status: ${sitemap.status}`);
const sitemapUrls = (sitemap.text.match(/<loc>(.*?)<\/loc>/g) || []).map(u => u.replace(/<\/?loc>/g, ''));
console.log(`Total URLs in sitemap: ${sitemapUrls.length}`);
console.log(`Has /blog: ${sitemapUrls.includes('https://luxedge.us/blog')}`);
console.log(`Has bird feeder guide: ${sitemapUrls.includes('https://luxedge.us/blog/best-bird-feeder-buyers-guide')}`);
console.log(`Has cooking salt (should be FALSE): ${sitemap.text.includes('pink-cooking-salt')}`);
console.log(`Has hair bows (should be FALSE): ${sitemap.text.includes('hair-bows')}`);

// 4. /blog index page
console.log('\n4. Checking /blog index page...');
const blogIndex = await checkUrl('/blog', { text: true });
console.log(`Status: ${blogIndex.status}`);
console.log(`X-Robots-Tag: ${blogIndex.headers['x-robots-tag'] || 'none (indexed)'}`);
console.log(`Contains "noindex": ${blogIndex.text.includes('noindex')}`);
console.log(`Contains blog guide title: ${blogIndex.text.includes('Bird Feeder') || blogIndex.text.includes('Horse') || blogIndex.text.includes('Pet Care Blog')}`);

// 5. Individual Blog Articles
console.log('\n5. Checking individual blog articles...');
const articles = [
  'best-bird-feeder-buyers-guide',
  'how-to-clean-a-bird-feeder',
  'horse-fly-mask-buyers-guide',
  'horse-grooming-kit-buyers-guide',
  'horse-halter-lead-rope-buyers-guide',
  'how-to-choose-a-cat-tunnel',
  'how-to-choose-cattle-trough-feed-water-setup',
  'how-to-fit-no-pull-dog-harness',
];

for (const slug of articles) {
  const r = await checkUrl(`/blog/${slug}`, { text: true });
  const hasNoindex = (r.headers['x-robots-tag'] || '').includes('noindex') || r.text.includes('content="noindex');
  const hasJsonLd = r.text.includes('application/ld+json');
  console.log(`  /blog/${slug}: Status=${r.status}, Indexed=${!hasNoindex}, JSON-LD=${hasJsonLd}`);
}

// 6. Retired guide redirect
console.log('\n6. Checking retired guide redirect...');
const retired = await checkUrl('/blog/essential-supplies-new-puppy');
console.log(`  /blog/essential-supplies-new-puppy: Status=${retired.status}, Location=${retired.location}`);

// 7. Trust & Legal Pages
console.log('\n7. Checking trust and legal pages...');
const trustPages = ['/about', '/contact', '/privacy', '/terms', '/shipping-policy', '/returns', '/editorial-policy', '/disclaimer'];
for (const p of trustPages) {
  const r = await checkUrl(p, { text: true });
  console.log(`  ${p}: Status=${r.status}`);
  if (p === '/privacy') {
    console.log(`    Privacy mentions Google: ${r.text.toLowerCase().includes('google')}`);
    console.log(`    Privacy mentions cookies/ads: ${r.text.toLowerCase().includes('cookie') && r.text.toLowerCase().includes('advertis')}`);
  }
  if (p === '/editorial-policy') {
    console.log(`    Editorial policy has review standards: ${r.text.toLowerCase().includes('editorial') || r.text.toLowerCase().includes('review')}`);
  }
}

// 8. Checking PDPs (Product Pages)
console.log('\n8. Checking cleaned product PDPs...');
const pdps = [
  'dog-poop-bags-biodegradable-waste-bag-rolls',
  'bone-charm-pendant-necklace',
  'portable-livestock-water-trough-30-gallon',
  'outdoor-hanging-bird-feeder',
  'cat-window-perch-suction-cup-hammock-seat-for-sunbathing',
];

for (const slug of pdps) {
  const r = await checkUrl(`/product/${slug}`, { text: true });
  console.log(`  /product/${slug}: Status=${r.status}`);
}

console.log('\n=== LIVE PRODUCTION VERIFICATION COMPLETE ===');
