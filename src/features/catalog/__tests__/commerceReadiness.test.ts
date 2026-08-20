import { describe, it, expect } from 'vitest';
import {
  deriveCommerceReadiness, deriveSourceType, deriveInventorySource, isCommerceReady,
} from '../commerceReadiness';

describe('deriveSourceType', () => {
  it('classifies CJ dropshipping from source/ref/url', () => {
    expect(deriveSourceType({ supplierSource: 'CJ' })).toBe('CJ_DROPSHIPPING');
    expect(deriveSourceType({ supplierProductRef: 'CJYD2060792' })).toBe('CJ_DROPSHIPPING');
    expect(deriveSourceType({ supplierUrl: 'https://cjdropshipping.com/x' })).toBe('CJ_DROPSHIPPING');
  });

  it('classifies manufacturer pages as RETAIL_REFERENCE_ONLY (authenticity ≠ purchasing path)', () => {
    expect(deriveSourceType({ supplierSource: 'KONG Company (official manufacturer)' })).toBe('RETAIL_REFERENCE_ONLY');
    expect(deriveSourceType({})).toBe('UNKNOWN');
  });
});

describe('deriveInventorySource', () => {
  it('SUPPLIER_VERIFIED only with real supplier stock evidence', () => {
    expect(deriveInventorySource({ usInventory: true, stockStatus: 'in_stock' })).toBe('SUPPLIER_VERIFIED');
  });
  it('internal quantity is NOT supplier stock', () => {
    expect(deriveInventorySource({ usInventory: false, stockStatus: 'in_stock' })).toBe('INTERNAL_STOCK');
    expect(deriveInventorySource({ usInventory: false, stockStatus: null })).toBe('UNKNOWN');
  });
});

describe('deriveCommerceReadiness', () => {
  it('non-active lifecycle → DRAFT', () => {
    expect(deriveCommerceReadiness({ status: 'draft', supplierSource: 'CJ', costPrice: 5 })).toBe('DRAFT');
  });

  it('retail-reference-only (no purchasing path) → SOURCE_PENDING even with a price', () => {
    const r = deriveCommerceReadiness({
      status: 'active',
      supplierSource: 'KONG Company (official manufacturer)',
      costPrice: 0,
      usInventory: true,
      stockStatus: 'in_stock',
    });
    expect(r).toBe('SOURCE_PENDING');
    expect(isCommerceReady({
      status: 'active', supplierSource: 'KONG Company (official manufacturer)', costPrice: 0,
    })).toBe(false);
  });

  it('unknown source → SOURCE_PENDING', () => {
    expect(deriveCommerceReadiness({ status: 'active' })).toBe('SOURCE_PENDING');
  });

  it('supplier exists but cost unknown → ECONOMICS_PENDING', () => {
    expect(deriveCommerceReadiness({ status: 'active', supplierSource: 'CJ', costPrice: 0 })).toBe('ECONOMICS_PENDING');
  });

  it('cost known but no verified US fulfillment → FULFILLMENT_PENDING', () => {
    const r = deriveCommerceReadiness({
      status: 'active', supplierSource: 'CJ', costPrice: 2.5, usInventory: false, stockStatus: null,
    });
    expect(r).toBe('FULFILLMENT_PENDING');
  });

  it('CJ supplier + cost + list-level US inventory → COMMERCE_READY', () => {
    const r = deriveCommerceReadiness({
      status: 'active',
      supplierSource: 'CJ',
      supplierProductRef: 'CJYD2060792',
      costPrice: 1.99,
      landedCost: 1.99,
      usInventory: true,
      stockStatus: 'in_stock',
      inventoryQty: 4,
    });
    expect(r).toBe('COMMERCE_READY');
    expect(isCommerceReady({
      status: 'active', supplierSource: 'CJ', costPrice: 1.99, usInventory: true, stockStatus: 'in_stock',
    })).toBe(true);
  });

  it('unresolved battery risk → RISK_REVIEW', () => {
    const r = deriveCommerceReadiness({
      status: 'active', supplierSource: 'CJ', costPrice: 5, usInventory: true,
      stockStatus: 'in_stock', riskFlags: ['battery UNKNOWN'],
    });
    expect(r).toBe('RISK_REVIEW');
  });
});
