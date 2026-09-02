// ============================================================================
// LUXEDGE — worker SSR Product JSON-LD image contract
//
// Google Search Console flagged luxedge.us merchant listings with
// 'Missing field image' (Google requires Product.image). The worker's SSR
// Product JSON-LD previously never emitted `image`. These tests pin the fix:
// images come from the embedded product_images (primary-first, absolutized to
// the canonical origin so relative /img/... assets are crawlable), falling
// back to the legacy products.image_url, and are honestly omitted when the
// catalog genuinely has no image — never fabricated from nothing.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { type ProductRow, productImageUrls, productJsonLd } from '../seo-meta';

const ROW = {
  id: 'p1',
  slug: 'himalayan-round-rope-salt-lick-6-lb-pack-of-4',
  name: 'Himalayan Round Rope Salt Lick',
  price: 49.95,
};

const row = (over?: Partial<ProductRow>): ProductRow => ({ ...ROW, ...over });

describe('productImageUrls', () => {
  it('absolutizes relative product_images to the canonical origin', () => {
    expect(productImageUrls(row({ product_images: [{ url: '/img/hk/hk-rope-licks.jpg' }] }))).toEqual([
      'https://luxedge.us/img/hk/hk-rope-licks.jpg',
    ]);
  });

  it('orders images primary first, then by sort_order, ignoring row order', () => {
    const images = productImageUrls(
      row({
        product_images: [
          { url: '/img/hk/a.jpg', is_primary: false, sort_order: 10 },
          { url: '/img/hk/b.jpg', is_primary: true, sort_order: 0 },
          { url: '/img/hk/c.jpg', is_primary: false, sort_order: 1 },
        ],
      }),
    );
    expect(images).toEqual([
      'https://luxedge.us/img/hk/b.jpg',
      'https://luxedge.us/img/hk/c.jpg',
      'https://luxedge.us/img/hk/a.jpg',
    ]);
  });

  it('falls back to the legacy absolute image_url when no product_images exist', () => {
    expect(
      productImageUrls(
        row({ image_url: 'https://himalayankoh.com/wp-content/uploads/2021/03/horse-lick-himalayan-salt5.jpg' }),
      ),
    ).toEqual(['https://himalayankoh.com/wp-content/uploads/2021/03/horse-lick-himalayan-salt5.jpg']);
  });

  it('prefers product_images over image_url when both exist (mirrors the storefront)', () => {
    expect(
      productImageUrls(
        row({
          image_url: 'https://himalayankoh.com/legacy.jpg',
          product_images: [{ url: '/img/hk/primary.jpg' }],
        }),
      ),
    ).toEqual(['https://luxedge.us/img/hk/primary.jpg']);
  });

  it('returns [] only when every source is absent or unusable — never a fabricated URL', () => {
    expect(productImageUrls(row({ product_images: [] }))).toEqual([]);
    expect(productImageUrls(row({ product_images: [{ url: 'garbage' }, { url: null }] }))).toEqual([]);
    expect(productImageUrls(row({ image_url: 'not-a-url' }))).toEqual([]);
  });
});

describe('productJsonLd', () => {
  const canonical = 'https://luxedge.us/product/himalayan-round-rope-salt-lick-6-lb-pack-of-4';

  it('emits image (the GSC missing-field contract) with absolute URLs', () => {
    const ld = productJsonLd(
      row({ product_images: [{ url: '/img/hk/hk-rope-licks.jpg', is_primary: true, sort_order: 0 }] }),
      canonical,
    ) as { image?: string[] };
    expect(ld.image).toEqual(['https://luxedge.us/img/hk/hk-rope-licks.jpg']);
  });

  it('emits image from the legacy image_url fallback', () => {
    const ld = productJsonLd(row({ image_url: 'https://himalayankoh.com/salt5.jpg' }), canonical) as {
      image?: string[];
    };
    expect(ld.image).toEqual(['https://himalayankoh.com/salt5.jpg']);
  });

  it('omits image honestly when the catalog has none (no fabrication)', () => {
    const ld = productJsonLd(row({}), canonical) as { image?: string[] };
    expect(ld.image).toBeUndefined();
  });

  it('keeps name/description/url/offers intact', () => {
    const ld = productJsonLd(row({ product_images: [{ url: '/img/hk/x.jpg' }] }), canonical);
    expect(ld['@type']).toBe('Product');
    expect(ld['name']).toBe(ROW.name);
    expect(ld['url']).toBe(canonical);
    expect((ld['offers'] as { price?: string }).price).toBe('49.95');
  });
});