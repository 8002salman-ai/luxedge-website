import { describe, expect, it } from 'vitest';
import { adminPublicVisibility, publicFactsFor } from '../visibility';
import { isHeldProduct } from '../../../content/reviewHolds';
import type { CatalogProduct } from '../types';

/** Minimal CatalogProduct factory — only the fields the visibility contract reads. */
function product(over: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id: 'p1',
    slug: 'verified-dog-bed',
    name: 'Verified Dog Bed',
    shortDescription: 'A factual short description for the listing.',
    description: 'A factual product description with enough verified catalog detail for a customer to understand this listed item before ordering.',
    features: [],
    specifications: {},
    brand: '',
    status: 'active',
    price: 49.99,
    compareAtPrice: 0,
    costPrice: 20,
    landedCost: 22,
    marginPercent: 50,
    currency: 'USD',
    sku: '',
    inventoryQty: 5,
    stockStatus: 'in_stock',
    lowStockThreshold: 0,
    shippingCost: 0,
    freeShipping: true,
    deliveryMinDays: null,
    deliveryMaxDays: null,
    usInventory: true,
    commerceReadiness: 'COMMERCE_READY',
    tags: [],
    featured: false,
    newArrival: false,
    trending: false,
    bestRated: false,
    bestSeller: false,
    promoted: false,
    saleEnabled: false,
    seoTitle: '',
    seoDescription: '',
    seoTitleStored: null,
    seoDescriptionStored: null,
    seoKeywords: [],
    images: [{ id: 'i1', productId: 'p1', url: 'https://img.example/bed.jpg', altText: '', kind: 'product', isPrimary: true, sortOrder: 0 }],
    variants: [],
    createdAt: '',
    updatedAt: '',
    publishedAt: null,
    ...over,
  } as CatalogProduct;
}

describe('admin public visibility', () => {
  it('reports an active, commerce-ready, illustrated product as listable', () => {
    expect(adminPublicVisibility(product())).toEqual({ listable: true, reason: null });
  });

  it('explains WHY an active product is not listable (the operator question)', () => {
    // The exact case that used to show a misleading "LIVE" badge.
    expect(adminPublicVisibility(product({ commerceReadiness: 'ECONOMICS_PENDING' })).reason).toBe('unverified commerce readiness');
    expect(adminPublicVisibility(product({ images: [] })).reason).toBe('missing usable product image');
    expect(adminPublicVisibility(product({ price: 0 })).reason).toBe('missing price fact');
    expect(adminPublicVisibility(product({ status: 'draft' })).reason).toBe('not publicly active');
    expect(adminPublicVisibility(product({ supplierSource: 'KONG Company (official manufacturer)' })).reason).toBe('unverified commerce readiness');
  });

  it('treats CatalogImage objects as real images instead of "[object Object]"', () => {
    const facts = publicFactsFor(product());
    expect(facts.images).toEqual(['https://img.example/bed.jpg']);
    // Without the adapter the object array would fail the URL test and the
    // product would be wrongly reported as having no image.
    expect(adminPublicVisibility(product()).listable).toBe(true);
  });

  it('names an editorial hold ahead of any other reason', () => {
    const held = product({ slug: 'kong-classic-durable-natural-rubber-dog-toy' });
    expect(isHeldProduct(held.slug)).toBe(true);
    const v = adminPublicVisibility(held);
    expect(v.listable).toBe(false);
    expect(v.reason).toContain('editorial hold');
  });
});
