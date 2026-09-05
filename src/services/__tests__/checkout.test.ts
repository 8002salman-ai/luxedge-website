// ============================================================================
// LUXEDGE — CLIENT CHECKOUT CONTRACT TYPE TEST
//
// Compile-time pin on src/services/checkout.ts. /api/checkout returns JSON,
// so the browser trusts the server's shape — this file makes the client
// contract itself the enforcement point. Any future drift (a tax field that
// can carry a non-zero value, or a resurrected taxHandledByProvider) fails
// `tsc`, not just the runtime suite.
// ============================================================================

import { describe, expectTypeOf, it } from 'vitest';
import type { CheckoutTotals } from '../checkout';

const happyPath: CheckoutTotals = {
  subtotal: 25,
  discount: 0,
  shipping: 4.99,
  tax: 0,
  total: 29.99,
  currency: 'USD',
  freeShippingApplied: false,
  couponCode: null,
};

describe('client checkout response contract (compile-time pin)', () => {
  it('tax is the literal 0 — a non-zero tax value cannot typecheck', () => {
    expectTypeOf<CheckoutTotals['tax']>().toEqualTypeOf<0>();
    // @ts-expect-error tax is always 0 (no Stripe Tax add-on)
    const badTax: CheckoutTotals = { ...happyPath, tax: 0.07 };
    void badTax;
  });

  it('taxHandledByProvider stays out of the contract', () => {
    // `never` proves the key no longer exists in the interface at all.
    expectTypeOf<Extract<keyof CheckoutTotals, 'taxHandledByProvider'>>().toEqualTypeOf<never>();
    // @ts-expect-error taxHandledByProvider was removed with automatic_tax (PR #68)
    const resurrected: CheckoutTotals = { ...happyPath, taxHandledByProvider: false };
    void resurrected;
  });

  it('the current happy-path shape typechecks', () => {
    expectTypeOf(happyPath).toEqualTypeOf<CheckoutTotals>();
  });
});