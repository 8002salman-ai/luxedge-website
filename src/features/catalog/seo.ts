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

export function productUrl(p: Pick<CatalogProduct, 'id' | 'slug'>): string {
  return `${SITE_URL}/product/${p.slug || p.id}`;
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
  const product: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    image: p.images.slice(0, 8).map((i) => i.url),
    description: p.shortDescription || p.description || p.name,
    brand: { '@type': 'Brand', name: p.brand || 'Luxedge' },
    offers: offer,
  };
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
