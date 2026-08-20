import { describe, it, expect } from 'vitest';
import {
  extractProductJson, parseHtmlPage, buildExtractionPrompt, isProxyErrorText,
  deriveImportReadiness, findDuplicateProduct, buildImportImages,
  buildImportVariants, buildImportProductInput, buildStorageImageInputs,
  parsePdpNpi, extractAliExpressUrlEvidence, buildUrlEvidenceProduct,
  isEmptyExtraction,
} from '../importer';

describe('extractProductJson', () => {
  it('parses plain JSON objects', () => {
    const out = extractProductJson('{"title":"Dog Bed","sellingPrice":49.99}');
    expect(out?.title).toBe('Dog Bed');
    expect(out?.sellingPrice).toBe(49.99);
  });

  it('parses markdown-fenced JSON', () => {
    const raw = 'Here you go:\n```json\n{"title":"Cat Toy","category":"Pet Toys"}\n```\nEnjoy!';
    const out = extractProductJson(raw);
    expect(out?.title).toBe('Cat Toy');
    expect(out?.category).toBe('Pet Toys');
  });

  it('parses fenced JSON without the json tag', () => {
    const raw = '```\n{"title":"Harness"}\n```';
    expect(extractProductJson(raw)?.title).toBe('Harness');
  });

  it('returns null on garbage', () => {
    expect(extractProductJson('no json here at all')).toBeNull();
    expect(extractProductJson('')).toBeNull();
    expect(extractProductJson('{invalid json}')).toBeNull();
  });
});

describe('isProxyErrorText', () => {
  it('flags Jina "URL returned error" pages', () => {
    expect(isProxyErrorText('Warning: www.target.com URL returned error 429: Too many requests')).toBe(true);
  });
  it('flags Jina BLOCKED-SNAPSHOT pages (ERR_BLOCKED_BY_CLIENT)', () => {
    const snapshot = [
      'Title: www.target.com',
      'URL Source: https://www.target.com/p/.../A-91561719',
      'Warning: This is a cached snapshot of the original page.',
      'Markdown Content:',
      '## www.target.com is blocked',
      'This page has been blocked by Chrome',
      'ERR_BLOCKED_BY_CLIENT',
    ].join('\n');
    expect(isProxyErrorText(snapshot)).toBe(true);
  });
  it('does NOT flag a real product page with price/availability text', () => {
    const page = 'Title: PetAmi Dog Travel Bag\nPrice: $39.99\nAvailability: In stock\nA real product description with plenty of content padding beyond one hundred characters to exceed the length threshold safely.'.repeat(1);
    expect(isProxyErrorText(page)).toBe(false);
  });
});

describe('parseHtmlPage', () => {
  it('extracts title, description, images and strips scripts/styles', () => {
    const html = [
      '<html><head>',
      '<meta property="og:title" content="Premium Pet Bed" />',
      '<meta property="og:description" content="A cozy bed" />',
      '</head><body>',
      '<script>var secret = 1;</script>',
      '<style>.x{color:red}</style>',
      '<img src="https://cdn.example.com/a.jpg" />',
      '<img data-src="https://cdn.example.com/b.webp" />',
      '<nav>Nav junk</nav>',
      '<p>Soft and supportive memory foam.</p>',
      '</body></html>',
    ].join('');
    const { text, images } = parseHtmlPage(html);
    expect(text).toContain('Premium Pet Bed');
    expect(text).toContain('Soft and supportive memory foam.');
    expect(text).not.toContain('var secret');
    expect(text).not.toContain('color:red');
    expect(images).toContain('https://cdn.example.com/a.jpg');
    expect(images).toContain('https://cdn.example.com/b.webp');
  });

  it('extracts markdown images from plain text', () => {
    const { images } = parseHtmlPage('See this ![product](https://img.example.com/x.png) and ![y](https://img.example.com/y.jpeg)');
    expect(images).toContain('https://img.example.com/x.png');
  });
});

describe('buildExtractionPrompt', () => {
  it('includes the content and instructs against inventing facts', () => {
    const prompt = buildExtractionPrompt('The bed is 40 inches wide.', 'text');
    expect(prompt).toContain('The bed is 40 inches wide.');
    expect(prompt).toContain('never invent factual specifications');
  });
});

describe('AliExpress import persistence mapping', () => {
  it('finds a duplicate by exact supplier URL', () => {
    const dup = findDuplicateProduct(
      [{ id: 'p1', name: 'X', supplierUrl: 'https://www.aliexpress.com/item/1005001.html', supplierProductRef: '1005001', sku: null }],
      { url: 'https://www.aliexpress.com/item/1005001.html', itemId: '999', title: 'Unrelated' },
    );
    expect(dup?.id).toBe('p1');
  });

  it('finds a duplicate by item ID (supplier ref or sku)', () => {
    const dup = findDuplicateProduct(
      [{ id: 'p2', name: 'Y', supplierUrl: null, supplierProductRef: '1005002', sku: null }],
      { url: 'https://other.example/x', itemId: '1005002', title: 'Unrelated' },
    );
    expect(dup?.id).toBe('p2');
  });

  it('falls back to normalized title', () => {
    const dup = findDuplicateProduct(
      [{ id: 'p3', name: 'Orthopedic Dog Bed', supplierUrl: null, supplierProductRef: null, sku: null }],
      { url: 'https://other.example/x', itemId: null, title: 'Orthopedic  Dog-Bed!!' },
    );
    expect(dup?.id).toBe('p3');
  });

  it('builds a draft-only product input (never active)', () => {
    const input = buildImportProductInput({
      title: 'Test Dog Toy',
      price: 12.99,
      supplierListPrice: 12.99,
      url: 'https://www.aliexpress.com/item/1005009.html',
      itemId: '1005009',
      imageCount: 1,
    });
    expect(input.status).toBe('draft');
    expect(input.supplierSource).toBe('AliExpress');
    expect(input.freeShipping).toBe(false);
    expect(input.commerceReadiness).toBe('ECONOMICS_PENDING');
  });

  it('never invents a compare price or stock', () => {
    const input = buildImportProductInput({
      title: 'Test',
      price: 10,
      comparePrice: 0,
      stock: 0,
      url: 'https://www.aliexpress.com/item/1005010.html',
      itemId: '1005010',
      imageCount: 1,
    });
    expect(input.compareAtPrice).toBeUndefined();
    expect(input.inventoryQty).toBe(0);
    expect(input.costPrice).toBeUndefined();
  });

  it('keeps real compare price and cost when provided', () => {
    const input = buildImportProductInput({
      title: 'Test',
      price: 20,
      comparePrice: 25,
      costPrice: 8,
      stock: 5,
      url: 'https://www.aliexpress.com/item/1005011.html',
      itemId: '1005011',
      imageCount: 1,
    });
    expect(input.compareAtPrice).toBe(25);
    expect(input.costPrice).toBe(8);
    expect(input.inventoryQty).toBe(5);
    expect(input.commerceReadiness).toBe('FULFILLMENT_PENDING');
  });

  it('persists variants with no invented stock and draft status', () => {
    const variants = buildImportVariants([
      { attributes: { Color: 'Red' }, sku: 'SKU-R', price: 9.99 },
    ]);
    expect(variants).toHaveLength(1);
    expect(variants[0].attributes).toEqual({ Color: 'Red' });
    expect(variants[0].price).toBe(9.99);
    expect(variants[0].inventoryQty).toBe(0);
    expect(variants[0].status).toBe('draft');
  });

  it('keeps missing shipping UNKNOWN and derives ECONOMICS_PENDING', () => {
    const input = buildImportProductInput({
      title: 'Test',
      price: 10,
      url: 'https://www.aliexpress.com/item/1005012.html',
      itemId: '1005012',
      shippingToUsa: 'UNKNOWN',
      deliveryRangeUsa: 'UNKNOWN',
      usStockEvidence: 'UNKNOWN',
      imageCount: 0,
    });
    expect(input.evidenceNotes).toContain('UNKNOWN');
    expect(input.commerceReadiness).toBe('ECONOMICS_PENDING');
  });

  it('marks battery/medical risk items RISK_REVIEW', () => {
    const readiness = deriveImportReadiness({
      supplierUrl: 'https://www.aliexpress.com/item/1005013.html',
      supplierItemId: '1005013',
      riskFlags: ['battery'],
      costPrice: 10,
    });
    expect(readiness).toBe('RISK_REVIEW');
  });

  it('derives SOURCE_PENDING without supplier identity', () => {
    expect(deriveImportReadiness({})).toBe('SOURCE_PENDING');
  });

  it('dedupes images and puts hero first', () => {
    const imgs = buildImportImages(['https://a/1.jpg', 'https://a/2.jpg', 'https://a/1.jpg'], 'https://a/2.jpg');
    expect(imgs).toHaveLength(2);
    expect(imgs[0].url).toBe('https://a/2.jpg');
    expect(imgs[0].isPrimary).toBe(true);
    expect(imgs[1].isPrimary).toBe(false);
  });
});

describe('buildStorageImageInputs (Supabase storage mapping)', () => {
  it('maps uploaded storage URLs preserving sort order', () => {
    const inputs = buildStorageImageInputs([
      { publicUrl: 'https://proj.supabase.co/storage/v1/object/public/product-media/catalog/p1/0-a.jpg', sourceUrl: 'https://cdn/x.jpg', sortOrder: 0 },
      { publicUrl: 'https://proj.supabase.co/storage/v1/object/public/product-media/catalog/p1/1-b.jpg', sourceUrl: 'https://cdn/y.jpg', sortOrder: 1 },
    ], 'https://cdn/x.jpg');
    expect(inputs).toHaveLength(2);
    expect(inputs[0].url).toContain('/0-a.jpg');
    expect(inputs[0].isPrimary).toBe(true);
    expect(inputs[1].url).toContain('/1-b.jpg');
    expect(inputs[1].isPrimary).toBe(false);
  });

  it('marks the first uploaded image primary when no hero matches', () => {
    const inputs = buildStorageImageInputs([
      { publicUrl: 'https://proj.supabase.co/storage/v1/object/public/product-media/catalog/p1/0-a.jpg', sourceUrl: 'https://cdn/x.jpg', sortOrder: 0 },
      { publicUrl: 'https://proj.supabase.co/storage/v1/object/public/product-media/catalog/p1/1-b.jpg', sourceUrl: 'https://cdn/y.jpg', sortOrder: 1 },
    ]);
    expect(inputs[0].isPrimary).toBe(true);
    expect(inputs.filter((i) => i.isPrimary)).toHaveLength(1);
  });

  it('accepts a public storage URL directly as the hero', () => {
    const inputs = buildStorageImageInputs([
      { publicUrl: 'https://proj.supabase.co/storage/v1/object/public/product-media/catalog/p1/0-a.jpg', sourceUrl: 'https://cdn/x.jpg', sortOrder: 0 },
      { publicUrl: 'https://proj.supabase.co/storage/v1/object/public/product-media/catalog/p1/1-b.jpg', sourceUrl: 'https://cdn/y.jpg', sortOrder: 1 },
    ], 'https://proj.supabase.co/storage/v1/object/public/product-media/catalog/p1/1-b.jpg');
    expect(inputs[1].isPrimary).toBe(true);
  });

  it('returns an empty list for no uploads — never invents an image', () => {
    expect(buildStorageImageInputs([])).toEqual([]);
  });
});

describe('AliExpress URL evidence (fetch-blocked fallback)', () => {
  const URL_UNDECODED = [
    'https://www.aliexpress.us/item/3256811704175460.html?spm=a2g0o.tm1000020137.2248275130.16.f00e37440UI0QM',
    '&pvid=7cb19531-5f80-4976-a096-20977ca27f4d',
    '&pdp_ext_f=%7B%22ship_from%22%3A%22US%22%2C%22sku_id%22%3A%2212000056899111739%22%7D',
    '&pdp_npi=6%40dis%21USD%21US%2B%2412.13%21US%2B%240.99%21%21%2112.13%210.99%21%402103128917872265124817054e0f05%2112000056899111739%21gdf%21US%216395549784%21X%211%210%21n_tag%3A-29910%3Bd%3A94b185ad%3Bm03_new_user%3A-29895%3BpisId%3A5000000210792318',
    '&aecmd=true&gatewayAdapt=glo2usa',
  ].join('');

  it('parses pdp_npi list + secondary price honestly', () => {
    const { listPrice, secondaryPrice } = parsePdpNpi('6@dis!USD!US+$12.13!US+$0.99!!!12.13!0.99!@x!12000056899111739!gdf!US');
    expect(listPrice).toBe(12.13);
    expect(secondaryPrice).toBe(0.99);
    expect(parsePdpNpi(null)).toEqual({ listPrice: null, secondaryPrice: null });
    expect(parsePdpNpi('garbage')).toEqual({ listPrice: null, secondaryPrice: null });
  });

  it('parses the bare-number pdp_npi format (no CC+$ prefix)', () => {
    const { listPrice, secondaryPrice } = parsePdpNpi('6@dis!USD!4.11!0.99!!!27.52!6.64!@2101ca9517872300755714122e1037!12000034351273366!sea!US');
    expect(listPrice).toBe(4.11);
    expect(secondaryPrice).toBe(0.99);
  });

  it('flags the AliExpress anti-bot punish page as a proxy/bot page', () => {
    const punish = '<html><script src="//g.alicdn.com/bsop-static/sufei-punish/0.1.125/build/htmltocanvas.min.js"></script><div id="bx-pu-qrcode">punish-page</div></html>';
    expect(isProxyErrorText(punish)).toBe(true);
    const recaptchaPunish = '<html>punish?recaptcha=1&iframe=1&x5step=2</html>';
    expect(isProxyErrorText(recaptchaPunish)).toBe(true);
  });

  it('detects an empty extraction (54 empty fields from a bot page)', () => {
    expect(isEmptyExtraction(null)).toBe(true);
    expect(isEmptyExtraction({ title: '', sellingPrice: 0, images: [], shortDescription: '', supplierItemId: undefined } as never)).toBe(true);
    expect(isEmptyExtraction({ title: 'Cat Toy', sellingPrice: 12.13, images: [], shortDescription: '' } as never)).toBe(false);
  });

  it('extracts item id, ship-from and sku id from the shareable URL', () => {
    const ev = extractAliExpressUrlEvidence(URL_UNDECODED);
    expect(ev.itemId).toBe('3256811704175460');
    expect(ev.shipFrom).toBe('US');
    expect(ev.skuId).toBe('12000056899111739');
    expect(ev.listPrice).toBe(12.13);
    expect(ev.secondaryPrice).toBe(0.99);
  });

  it('builds a partial product that stays UNKNOWN where the URL has no evidence', () => {
    const p = buildUrlEvidenceProduct(URL_UNDECODED);
    expect(p.supplierPlatform).toBe('AliExpress');
    expect(p.supplierItemId).toBe('3256811704175460');
    expect(p.sellingPrice).toBe(12.13);
    expect(p.title).toBe('');
    expect(p.shippingToUsa).toBe('UNKNOWN');
    expect(p.usStockEvidence).toBe('UNKNOWN');
    expect(p.evidence?.sellingPrice).toBe('INFERRED');
    expect(p.ownerNotes || '').toContain('blocked by AliExpress');
  });

  it('extracts only the item id when no tracking params exist', () => {
    const ev = extractAliExpressUrlEvidence('https://www.aliexpress.com/item/1005001234567.html');
    expect(ev.itemId).toBe('1005001234567');
    expect(ev.shipFrom).toBeNull();
    expect(ev.listPrice).toBeNull();
  });
});
