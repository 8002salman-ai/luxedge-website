const ORIGIN = 'https://luxedge.us';

async function fetchPage(path) {
  const res = await fetch(`${ORIGIN}${path}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    },
  });
  return { status: res.status, text: await res.text(), headers: Object.fromEntries(res.headers) };
}

console.log('=== DEEP HTML & RESPONSIVENESS AUDIT ===\n');

const paths = [
  '/',
  '/shop',
  '/blog',
  '/blog/best-bird-feeder-buyers-guide',
  '/product/outdoor-hanging-bird-feeder',
  '/product/dog-poop-bags-biodegradable-waste-bag-rolls',
  '/category/bird-supplies',
  '/about',
  '/privacy',
  '/editorial-policy',
];

for (const p of paths) {
  const { status, text, headers } = await fetchPage(p);
  const titleMatch = text.match(/<title>(.*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1] : 'NONE';
  const metaDescMatch = text.match(/<meta\s+name=["']description["']\s+content=["'](.*?)["']/i) || text.match(/<meta\s+content=["'](.*?)["']\s+name=["']description["']/i);
  const metaDesc = metaDescMatch ? metaDescMatch[1] : 'NONE';
  const hasViewport = text.includes('name="viewport"');
  const hasCanonical = text.includes('rel="canonical"');
  const hasJsonLd = text.includes('application/ld+json');
  const h1Match = text.match(/<h1[^>]*>(.*?)<\/h1>/i);
  const h1 = h1Match ? h1Match[1].replace(/<[^>]+>/g, '').trim() : 'NONE';
  const xRobots = headers['x-robots-tag'] || 'none';

  console.log(`Path: ${p}`);
  console.log(`  HTTP: ${status} | X-Robots-Tag: ${xRobots}`);
  console.log(`  Title: ${title}`);
  console.log(`  H1: ${h1}`);
  console.log(`  Meta Desc: ${metaDesc ? metaDesc.slice(0, 75) + '...' : 'NONE'}`);
  console.log(`  Viewport: ${hasViewport} | Canonical: ${hasCanonical} | JSON-LD: ${hasJsonLd}`);
  console.log('');
}
