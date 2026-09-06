import { describe, it, expect } from 'vitest';
import { SUPPLIER_SOURCE_PRESETS, supplierSearchUrl } from '../supplierSource';

describe('supplierSearchUrl', () => {
  it('builds slug-based search URLs for AliExpress and CJ', () => {
    expect(supplierSearchUrl('AliExpress', 'Dog Leash 5m')).toBe('https://www.aliexpress.com/w/wholesale-dog-leash-5m.html');
    expect(supplierSearchUrl('CJ', 'Adjustable Dog Harness')).toBe('https://cjdropshipping.com/list/wholesale-adjustable-dog-harness.html');
  });

  it('builds query-based search URLs for Amazon, Alibaba, eBay and Walmart', () => {
    expect(supplierSearchUrl('Amazon', 'Cat Tunnel')).toBe('https://www.amazon.com/s?k=Cat%20Tunnel');
    expect(supplierSearchUrl('Alibaba', 'Salt Lick 30lb')).toBe('https://www.alibaba.com/trade/search?SearchText=Salt%20Lick%2030lb');
    expect(supplierSearchUrl('eBay', 'Horse Halter')).toBe('https://www.ebay.com/sch/i.html?_nkw=Horse%20Halter');
    expect(supplierSearchUrl('Walmart', 'Bird Feeder')).toBe('https://www.walmart.com/search?q=Bird%20Feeder');
  });

  it('matches source case-insensitively and ignores surrounding whitespace', () => {
    expect(supplierSearchUrl('amazon', 'Cat Tunnel')).toBe('https://www.amazon.com/s?k=Cat%20Tunnel');
    expect(supplierSearchUrl('  AliExpress  ', 'Toy')).toBe('https://www.aliexpress.com/w/wholesale-toy.html');
  });

  it('URL-encodes reserved characters in the product name', () => {
    expect(supplierSearchUrl('Amazon', 'Dog Leash & Collar (2-Pack)')).toBe('https://www.amazon.com/s?k=Dog%20Leash%20%26%20Collar%20(2-Pack)');
  });

  it('returns null for a blank name or a non-preset source', () => {
    expect(supplierSearchUrl('Amazon', '   ')).toBeNull();
    expect(supplierSearchUrl('Other / Custom', 'Cat Toy')).toBeNull();
    expect(supplierSearchUrl('', 'Cat Toy')).toBeNull();
  });

  it('every preset has a usable search URL builder', () => {
    for (const preset of SUPPLIER_SOURCE_PRESETS) {
      const url = supplierSearchUrl(preset, 'Pet Product');
      expect(url).toMatch(/^https:\/\//);
      expect(url).not.toBeNull();
    }
  });
});
