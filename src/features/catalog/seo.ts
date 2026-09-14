// ============================================================================
// LUXEDGE V2 — CATALOG SEO + FEED READINESS
//
// Deterministic, factual SEO output for ACTIVE products: title tag, meta
// description, canonical, Product JSON-LD, OpenGraph, and a Google
// Merchant Center / Meta / Pinterest-ready feed row. Nothing is invented:
// only fields with real values are emitted; review/rating schema is emitted
// ONLY when genuine approved customer reviews exist (passed in).
// ============================================================================

import { CatalogProduct, CatalogImage, effectivePrice } from './types';

export const SITE_URL = 'https://luxedge.us';

/** Relative product-route path — the slug is the canonical crawlable form
 * (the worker emits full Product JSON-LD/canonical only for slug URLs); id is
 * a safety fallback when a slug is missing. */
export function productPath(p: { id: string; slug?: string | null }): string {
  return `/product/${p.slug || p.id}`;
}

export function productUrl(p: { id: string; slug?: string | null }): string {
  return `${SITE_URL}${productPath(p)}`;
}

/** Merchant-listing offer extras (GSC: hasMerchantReturnPolicy +
 * shippingDetails on the Offer). Only real values are emitted: the 30-day
 * return policy Luxedge advertises, a US shipping destination, shippingRate
 * only when free shipping or a cost is recorded, and transitTime only when
 * per-product delivery estimates exist. Shared by worker SSR + client so the
 * crawl HTML and the hydrated DOM carry identical markup. */
export function merchantOfferExtras(p: {
  freeShipping?: boolean | null;
  shippingCost?: number | null;
  deliveryMinDays?: number | null;
  deliveryMaxDays?: number | null;
  currency?: string | null;
}): Record<string, unknown> {
  const extras: Record<string, unknown> = {
    hasMerchantReturnPolicy: {
      '@type': 'MerchantReturnPolicy',
      applicableCountry: 'US',
      returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
      merchantReturnDays: 30,
      merchantReturnLink: `${SITE_URL}/returns`,
      // Must match the published Returns policy: "Customers are responsible
      // for return shipping label, packaging, and all return shipping costs."
      // Declaring FreeReturn here contradicted the visible policy (GSC
      // merchant-listing mismatch), so the schema states the real term.
      returnMethod: 'https://schema.org/ReturnByMail',
      returnFees: 'https://schema.org/ReturnFeesCustomerResponsibility',
    },
    shippingDetails: {
      '@type': 'OfferShippingDetails',
      shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'US' },
      deliveryTime: {
        '@type': 'ShippingDeliveryTime',
        handlingTime: { '@type': 'QuantitativeValue', minValue: 1, maxValue: 2, unitCode: 'DAY' },
      },
    },
  };
  const shippingDetails = extras.shippingDetails as Record<string, unknown>;
  if (p.freeShipping === true) {
    shippingDetails.shippingRate = { '@type': 'MonetaryAmount', value: '0', currency: p.currency || 'USD' };
  } else if (p.shippingCost != null && Number(p.shippingCost) > 0) {
    shippingDetails.shippingRate = {
      '@type': 'MonetaryAmount',
      value: Number(p.shippingCost).toFixed(2),
      currency: p.currency || 'USD',
    };
  }
  if (p.deliveryMinDays != null || p.deliveryMaxDays != null) {
    (shippingDetails.deliveryTime as Record<string, unknown>).transitTime = {
      '@type': 'QuantitativeValue',
      minValue: p.deliveryMinDays ?? 1,
      maxValue: p.deliveryMaxDays ?? p.deliveryMinDays ?? 1,
      unitCode: 'DAY',
    };
  }
  return extras;
}

export function shopUrl(categorySlug?: string): string {
  return categorySlug ? `${SITE_URL}/category/${categorySlug}` : `${SITE_URL}/shop`;
}

export interface ProductMeta {
  title: string;
  description: string;
  canonical: string;
  ogTitle: string;
  ogDescription: string;
  ogImage?: string;
}

export function buildProductMeta(p: CatalogProduct): ProductMeta {
  const title = (p.seoTitle || p.shortTitle || p.name).slice(0, 70);
  const description = (p.seoDescription || p.shortDescription || '').slice(0, 160);
  const ogImage = p.ogImage || p.images.find((i) => i.isPrimary)?.url || p.images[0]?.url;
  return {
    title,
    description,
    canonical: productUrl(p),
    ogTitle: title,
    ogDescription: description || title,
    ogImage,
  };
}

export interface ReviewFacts {
  count: number;
  average: number;
}

/**
 * Product + Breadcrumb JSON-LD. aggregateRating is ONLY emitted when real
 * approved reviews exist (never fabricated from catalog stub data).
 */
export function buildProductJsonLd(p: CatalogProduct, reviews?: ReviewFacts): Record<string, unknown>[] {
  const price = effectivePrice(p);
  const url = productUrl(p);
  const offer: Record<string, unknown> = {
    '@type': 'Offer',
    price,
    priceCurrency: p.currency || 'USD',
    // Honest availability: InStock only for real supplier-verified stock
    // (list-level US inventory or explicit supplier in_stock), never from an
    // internal placeholder quantity.
    availability: p.usInventory === true || p.stockStatus === 'in_stock'
      ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    itemCondition: 'https://schema.org/NewCondition',
  };
  if (p.sku) offer.sku = p.sku;
  if (p.images[0]) offer.image = p.images[0].url;
  Object.assign(offer, merchantOfferExtras({
    freeShipping: p.freeShipping,
    shippingCost: p.shippingCost,
    deliveryMinDays: p.deliveryMinDays,
    deliveryMaxDays: p.deliveryMaxDays,
    currency: p.currency,
  }));
  const product: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    image: p.images.slice(0, 8).map((i) => i.url),
    description: p.shortDescription || p.description || p.name,
    offers: offer,
  };
  // brand is emitted ONLY when a real product brand is recorded — and never the
  // retailer's own name. Most of the catalog is generic third-party goods, and
  // Luxedge is the store, not their manufacturer, so defaulting the brand to
  // "Luxedge" put a fabricated brand fact in front of Google and shoppers.
  // This is the same rule buildFeedRow applies, so JSON-LD and the merchant
  // feed agree.
  const brand = (p.brand || '').trim();
  if (brand && brand.toLowerCase() !== 'luxedge') product.brand = { '@type': 'Brand', name: brand };
  if (p.categoryName) product.category = p.categoryName;
  if (p.sku) product.sku = p.sku;
  if (reviews && reviews.count > 0) {
    product.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: Math.round(reviews.average * 10) / 10,
      reviewCount: reviews.count,
    };
  }
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Shop', item: shopUrl() },
      { '@type': 'ListItem', position: 3, name: p.name, item: url },
    ],
  };
  return [breadcrumb, product];
}

export function buildStoreJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Store',
    name: 'Luxedge',
    url: SITE_URL,
    description: 'Premium pet essentials for dogs and cats.',
    brand: { '@type': 'Brand', name: 'Luxedge' },
  };
}

/** Google Merchant Center / Meta / Pinterest-ready feed row (data only — no submission). */
export function buildFeedRow(p: CatalogProduct): Record<string, string | number> {
  const price = effectivePrice(p);
  const image = p.images.find((i) => i.isPrimary)?.url || p.images[0]?.url || '';
  const availability = p.usInventory === true || p.stockStatus === 'in_stock' ? 'in stock' : 'out of stock';
  const row: Record<string, string | number> = {
    id: p.id,
    title: p.name,
    description: (p.shortDescription || p.description || p.name).slice(0, 5000),
    link: productUrl(p),
    image,
    price: `${price.toFixed(2)} USD`,
    availability,
    condition: 'new',
    // Storewide 30-day mail-return policy in CSV form — the same values as
    // merchantOfferExtras (ReturnByMail / ReturnFeesCustomerResponsibility,
    // merchantReturnDays: 30) so the feed columns match the JSON-LD on the
    // product page AND the published Returns policy: the customer pays return
    // shipping.
    return_method: 'by_mail',
    return_fees: 'customer',
    return_days: 30,
  };
  if (p.brand && p.brand !== 'Luxedge') row.brand = p.brand;
  if (p.sku) row.sku = p.sku;
  if (p.categoryName) row.product_type = p.categoryName;
  if (p.compareAtPrice > p.price) row.sale_price = `${price.toFixed(2)} USD`;
  return row;
}

export function buildFeedCsv(products: CatalogProduct[]): string {
  const rows = products.map(buildFeedRow);
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(headers.map((h) => esc(r[h] ?? '')).join(','));
  return lines.join('\n');
}

/** Deterministic alt text from the real product + image, never invented. */
export function altTextFor(p: Pick<CatalogProduct, 'name' | 'brand'>, img: CatalogImage, fallbackIndex: number): string {
  const base = p.name || p.brand || 'Product';
  if (img.altText) return img.altText;
  if (img.isPrimary) return `${base} — primary image`;
  return `${base} — image ${fallbackIndex + 1}`;
}
