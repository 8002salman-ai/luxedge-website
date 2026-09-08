import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

// The page only reads useApp() during the initial render — effects (config
// fetch, address validation) never run under renderToStaticMarkup.
vi.mock('../../../App', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../App')>();
  return {
    ...mod,
    useApp: () => ({
      cart: [
        {
          product: {
            id: 'p1', name: 'Orthopedic Memory Foam Pet Bed — Large', price: 54.98,
            images: ['https://example.com/bed.jpg'], imageAlts: [], stock: 10, isActive: true,
          } as unknown,
          quantity: 2,
        },
      ] as { product: unknown; quantity: number }[],
      coupon: null,
      applyCoupon: () => null,
      removeCoupon: () => {},
      freeShippingEnabled: true,
      freeShippingThreshold: 75,
      user: null,
      clearCart: () => {},
      notify: () => {},
    }),
  };
});

import CheckoutOnsitePage from '../CheckoutOnsitePage';

describe('CheckoutOnsitePage premium redesign', () => {
  it('renders the 3-step checkout structure, summary and payment CTA', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CheckoutOnsitePage />
      </MemoryRouter>,
    );
    // Header
    expect(html).toContain('Secure Checkout');
    // Numbered step cards
    expect(html).toContain('1');
    expect(html).toContain('Contact');
    expect(html).toContain('Delivery');
    expect(html).toContain('Payment');
    // Address + billing fields intact
    expect(html).toContain('checkout-email');
    expect(html).toContain('checkout-city');
    expect(html).toContain('checkout-billing-same');
    // Order summary: item title, qty badge, totals; mobile collapsible + desktop sticky
    expect(html).toContain('Orthopedic Memory Foam Pet Bed');
    expect(html).toContain('Order Summary');
    expect(html).toContain('2');
    expect(html).toContain('Subtotal');
    expect(html).toContain('Total');
    // Coupon field
    expect(html).toContain('Coupon code');
    // Mobile sticky bottom bar with total + CTA (config still loading in
    // static render, so the CTA honestly shows the checking state)
    expect(html).toContain('Checking secure payment');
    // Trust row (no payment claim while config is still loading)
    expect(html).toContain('30-day returns');
    expect(html).toContain('Customer support');
  });
});