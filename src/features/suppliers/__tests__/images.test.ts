// ============================================================================
// LUXEDGE V2 — SUPPLIER IMAGE CONTENT TESTS (Phase 4H.3 image content)
//
// Verifies the ACTUAL image-content layer (not presentation CSS): exact
// dedupe, hero selection, gallery order, honest alt text, honest resolution
// (never invented), and that variant images are NEVER guessed from title
// color words.
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  normalizeImageUrlForDedupe, dedupeImageUrls, isObviouslyWeakImageUrl,
  imageUrlResolutionHint, curateSupplierImageSet,
} from '../images';
import {
  normalizeCjListProduct, normalizeCjProductDetail,
  type CjProductDetail,
} from '../cj/normalize';

describe('normalizeImageUrlForDedupe', () => {
  it('strips tracking params, lowercases host, drops fragment (URL never rewritten)', () => {
    expect(normalizeImageUrlForDedupe('HTTPS://Img.CJDropshipping.com/a.jpg?utm_source=x&w=800#frag'))
      .toBe('https://img.cjdropshipping.com/a.jpg?w=800');
  });

  it('returns null for junk / non-http', () => {
    expect(normalizeImageUrlForDedupe('')).toBeNull();
    expect(normalizeImageUrlForDedupe('   ')).toBeNull();
    expect(normalizeImageUrlForDedupe('ftp://x/a.jpg')).toBeNull();
    expect(normalizeImageUrlForDedupe('not a url')).toBeNull();
  });
});

describe('dedupeImageUrls', () => {
  it('removes exact duplicates (even with tracking params) and keeps first occurrence order', () => {
    const res = dedupeImageUrls([
      'https://img.cjdropshipping.com/a.jpg?utm_source=1',
      'https://img.cjdropshipping.com/b.jpg',
      'https://img.cjdropshipping.com/a.jpg?utm_source=2',
      null,
      '   ',
      'not-a-url',
    ]);
    expect(res.unique).toEqual([
      'https://img.cjdropshipping.com/a.jpg?utm_source=1',
      'https://img.cjdropshipping.com/b.jpg',
    ]);
    expect(res.removed).toHaveLength(1);
    expect(res.removed[0]).toContain('a.jpg');
  });
});

describe('isObviouslyWeakImageUrl', () => {
  it('flags thumb/thumbnail tokens (hero ranking only, never deletion)', () => {
    expect(isObviouslyWeakImageUrl('https://img.cjdropshipping.com/a_thumb.jpg')).toBe(true);
    expect(isObviouslyWeakImageUrl('https://img.cjdropshipping.com/a_small.jpg')).toBe(true);
    expect(isObviouslyWeakImageUrl('https://img.cjdropshipping.com/a.jpg')).toBe(false);
  });
});

describe('imageUrlResolutionHint', () => {
  it('parses a _WxH path suffix', () => {
    expect(imageUrlResolutionHint('https://img.cjdropshipping.com/a_800x800.jpg')).toEqual({ width: 800, height: 800 });
  });

  it('parses w=800&h=600 query form', () => {
    expect(imageUrlResolutionHint('https://img.cjdropshipping.com/a.jpg?w=800&h=600')).toEqual({ width: 800, height: 600 });
  });

  it('parses Aliyun OSS resize', () => {
    expect(imageUrlResolutionHint('https://cc.oss-us-west-1.aliyuncs.com/a.png?x-oss-process=image/resize,w_800,h_600')).toEqual({ width: 800, height: 600 });
  });

  it('returns null when the URL encodes no size (never guesses)', () => {
    expect(imageUrlResolutionHint('https://img.cjdropshipping.com/a.jpg')).toBeNull();
  });
});

describe('curateSupplierImageSet', () => {
  const title = 'Elegant Rectangular Pet Bed, Durable Elevated Dog Sofa Bed';

  it('selects the first non-weak image as hero and orders gallery hero-first', () => {
    const set = curateSupplierImageSet({
      title,
      images: [
        'https://img.cjdropshipping.com/bed_thumb.jpg',
        'https://img.cjdropshipping.com/bed-main.jpg',
        'https://img.cjdropshipping.com/bed-detail.jpg',
      ],
    });
    expect(set.primaryImage).toBe('https://img.cjdropshipping.com/bed-main.jpg');
    expect(set.galleryImages[0].url).toBe('https://img.cjdropshipping.com/bed-main.jpg');
    expect(set.galleryImages.map((g) => g.url)).toEqual([
      'https://img.cjdropshipping.com/bed-main.jpg',
      'https://img.cjdropshipping.com/bed_thumb.jpg',
      'https://img.cjdropshipping.com/bed-detail.jpg',
    ]);
  });

  it('dedupes exact duplicates and records removed keys', () => {
    const set = curateSupplierImageSet({
      title,
      images: [
        'https://img.cjdropshipping.com/a.jpg?utm_source=1',
        'https://img.cjdropshipping.com/b.jpg',
        'https://img.cjdropshipping.com/a.jpg?utm_source=2',
      ],
    });
    expect(set.dedupedCount).toBe(2);
    expect(set.removedDuplicates).toHaveLength(1);
  });

  it('derives alt text ONLY from the real title (+ image index)', () => {
    const set = curateSupplierImageSet({
      title,
      images: ['https://img.cjdropshipping.com/a.jpg', 'https://img.cjdropshipping.com/b.jpg'],
    });
    expect(set.altText).toEqual([title, `${title} — image 2`]);
    expect(set.galleryImages[0].alt).toBe(title);
  });

  it('does NOT guess variant images when no linkage is supplied', () => {
    const set = curateSupplierImageSet({
      title: 'Dog Bed - Black',
      images: ['https://img.cjdropshipping.com/a.jpg'],
    });
    expect(set.variantImages).toEqual([]);
  });

  it('includes variant images ONLY from a real supplied linkage', () => {
    const set = curateSupplierImageSet({
      title,
      images: ['https://img.cjdropshipping.com/a.jpg'],
      variantImages: [
        { url: 'https://img.cjdropshipping.com/a-black.jpg', variantId: 'v1', variantLabel: 'Black' },
      ],
    });
    expect(set.variantImages).toHaveLength(1);
    expect(set.variantImages[0].variantLabel).toBe('Black');
    expect(set.variantImages[0].alt).toBe(`${title} — Black`);
  });

  it('records resolution only when the URL encodes it (never invented)', () => {
    const set = curateSupplierImageSet({
      title,
      images: ['https://img.cjdropshipping.com/a_1200x1200.jpg', 'https://img.cjdropshipping.com/b.jpg'],
    });
    expect(set.galleryImages[0].width).toBe(1200);
    expect(set.galleryImages[0].height).toBe(1200);
    expect(set.galleryImages[1].width).toBeNull();
    expect(set.galleryImages[1].height).toBeNull();
  });
});

describe('CJ normalization image content', () => {
  it('attaches a curated image set to list-level records (single bigImage)', () => {
    const r = normalizeCjListProduct({ id: 'p1', nameEn: 'Dog Bed', bigImage: 'https://img.cjdropshipping.com/bed.jpg' });
    expect(r?.imageSet?.primaryImage).toBe('https://img.cjdropshipping.com/bed.jpg');
    expect(r?.imageSet?.galleryImages).toHaveLength(1);
    expect(r?.imageSet?.altText[0]).toBe('Dog Bed');
  });

  it('attaches a deduped, hero-first image set to detail records from productImageSet', () => {
    const detail: CjProductDetail = {
      id: 'p1',
      nameEn: 'Elevated Dog Sofa Bed',
      bigImage: 'https://img.cjdropshipping.com/bed_thumb.jpg',
      productImageSet: [
        'https://img.cjdropshipping.com/bed_thumb.jpg',
        'https://img.cjdropshipping.com/bed-main.jpg',
        'https://img.cjdropshipping.com/bed-main.jpg?utm_source=x',
        'https://img.cjdropshipping.com/bed-detail.jpg',
      ],
      variants: [],
    };
    const r = normalizeCjProductDetail(detail);
    expect(r?.imageSet?.primaryImage).toBe('https://img.cjdropshipping.com/bed-main.jpg');
    expect(r?.imageSet?.dedupedCount).toBe(3);
    expect(r?.imageSet?.removedDuplicates).toHaveLength(1);
  });
});
