import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FREE_SHIPPING_CLAIM } from '../productFacts';
import { quoteShipping } from '../../features/catalog/repository';

/**
 * The product page used to print a flat "Free shipping" whenever the catalog
 * row carried `free_shipping = true`. That overstates what the store does in
 * two ways:
 *
 *   1. The checkout grants free shipping only when EVERY line in the cart is
 *      flagged (`quoteShipping`), so a flagged product in a mixed cart still
 *      pays shipping.
 *   2. /shipping-policy publishes the opposite of a per-product promise —
 *      "Shipping cost is calculated for your specific cart, products, and
 *      destination, and is shown in the cart and again at checkout".
 *
 * On supplier-imported rows the flag is not even a decision: `free_shipping`
 * defaults to true and `shipping_cost` to 0, so 66 of 98 active rows carried it
 * without anyone choosing it. The claim is now conditional and shared by the
 * two render paths, so the crawler and the visitor cannot drift apart again.
 */
const file = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

// Storewide free shipping deliberately OFF, so every assertion below exercises
// the per-product flag alone.
const settings = { freeShippingEnabled: false, freeShippingThreshold: 999, defaultDeliveryMinDays: null, defaultDeliveryMaxDays: null };

describe('free-shipping claim', () => {
  it('is conditional, not the flat supplier artifact', () => {
    expect(FREE_SHIPPING_CLAIM).not.toBe('Free shipping');
    expect(FREE_SHIPPING_CLAIM.toLowerCase()).toContain('qualif');
  });

  it('matches what the checkout actually grants', () => {
    const free = { productFreeShipping: true, productSubtotal: 20 };
    const paid = { productFreeShipping: false, productSubtotal: 20 };
    // The flag alone is not enough: a mixed cart still pays shipping, which is
    // why the product page may say "qualifies" but never "free shipping".
    expect(quoteShipping(settings, [free]).freeEligible).toBe(true);
    expect(quoteShipping(settings, [free, paid]).freeEligible).toBe(false);
    // An empty cart qualifies for nothing.
    expect(quoteShipping(settings, []).freeEligible).toBe(false);
  });

  it('is read from one module by both render paths', () => {
    const react = file('src/App.tsx');
    const worker = file('worker/seo-meta.ts');
    for (const [name, src] of [['src/App.tsx', react], ['worker/seo-meta.ts', worker]] as const) {
      expect(src, `${name} must use the shared claim`).toContain('FREE_SHIPPING_CLAIM');
    }
    // Neither path may reintroduce the flat claim as PDP copy. (`Free shipping`
    // survives only as the shop filter chip's label in src/App.tsx.)
    expect(worker).not.toContain("facts.push('Free shipping')");
    expect(react).not.toMatch(/>\s*Free shipping\s*</);
  });
});
