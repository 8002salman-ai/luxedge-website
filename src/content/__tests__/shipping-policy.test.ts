import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SHIPPING_SECTIONS, POLICY_LAST_UPDATED } from '../policies';
import { SSR_FOOTER_NAV } from '../navigation';

/**
 * The shipping policy regressed in three ways at once, which is why it is
 * pinned here rather than trusted:
 *
 *  1. The storefront footer linked `/shipping`, a route that has never existed
 *     (the canonical page is `/shipping-policy`), so every footer click — and
 *     every Google crawl of that link — hit a 404. The server-side pre-rendered
 *     footer used the correct path, so an SSR-only link crawl never saw it.
 *  2. The React page hardcoded its own section list, which had already drifted
 *     from the worker's SHIPPING_SECTIONS: a crawler was shown 8 sections while
 *     a visitor saw 9.
 *  3. The meta description advertised "expected delivery windows ... based on
 *     verified supplier estimates" that the policy deliberately does not
 *     publish, because each window is shown per product and at checkout.
 */
const app = readFileSync('src/App.tsx', 'utf8');
const worker = readFileSync('worker/index.ts', 'utf8');
const seoMeta = readFileSync('worker/seo-meta.ts', 'utf8');
const sitemapScript = readFileSync('scripts/regenerate-sitemap.mjs', 'utf8');

const titles = SHIPPING_SECTIONS.map((s) => s.title);

/** Body of the ShippingPolicyPage component, so assertions cannot accidentally
 * match unrelated legal pages in the same file. */
function shippingPage(): string {
  const start = app.indexOf('function ShippingPolicyPage()');
  expect(start, 'ShippingPolicyPage component not found').toBeGreaterThan(-1);
  const end = app.indexOf('\nfunction ', start + 1);
  return app.slice(start, end === -1 ? undefined : end);
}

describe('shipping policy — crawl/React parity', () => {
  it('renders the page from SHIPPING_SECTIONS instead of a second hand-written list', () => {
    expect(shippingPage()).toContain('SHIPPING_SECTIONS.map(');
  });

  it('has no hardcoded section literal left to drift out of sync', () => {
    // A literal `<LS t="Some Title">` inside the page is how the section lists
    // diverged before; the rich extras are keyed off s.title instead.
    expect(shippingPage()).not.toMatch(/<LS\s+t="/);
  });

  it('keeps every rich-extra hook matched to a real section title', () => {
    // The table and in-page links are attached by comparing s.title, so renaming
    // a section would silently drop them. Pin the three anchors.
    for (const anchor of ['Shipping Methods & Times', 'Order Tracking', 'Related Information']) {
      expect(shippingPage()).toContain(`s.title === '${anchor}'`);
      expect(titles, `${anchor} is not a SHIPPING_SECTIONS title`).toContain(anchor);
    }
  });

  it('covers the questions a shipping policy has to answer', () => {
    for (const required of [
      'Overview',
      'Where We Ship',
      'Shipping Costs',
      'Processing Time',
      'Shipping Methods & Times',
      'Order Tracking',
      'Delivery Delays',
      'Missing or Lost Packages',
      'Address Accuracy',
      'Related Information',
    ]) {
      expect(titles, `missing section: ${required}`).toContain(required);
    }
  });

  it('gives every section real body text', () => {
    for (const s of SHIPPING_SECTIONS) {
      expect(s.body.trim().length, `${s.title} is empty`).toBeGreaterThan(60);
    }
  });

  it('links to genuinely related live pages, not just the footer', () => {
    const page = shippingPage();
    for (const href of ['/orders', '/returns', '/faq', '/contact']) {
      expect(page, `shipping page does not link ${href}`).toContain(`to="${href}"`);
    }
  });

  it('dates the page from the shared policy map', () => {
    expect(POLICY_LAST_UPDATED['/shipping-policy']).toMatch(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/);
    expect(shippingPage()).toContain("POLICY_LAST_UPDATED['/shipping-policy']");
  });
});

describe('shipping policy — no unsupported delivery promises', () => {
  it('never promises a guarantee or a fixed delivery window', () => {
    const text = SHIPPING_SECTIONS.map((s) => `${s.title}\n${s.body}`).join('\n');
    // "are estimates, not guarantees" is the honest framing and is allowed.
    expect(text).not.toMatch(/\bwe guarantee\b/i);
    expect(text).not.toMatch(/\bguaranteed (delivery|arrival|by)\b/i);
    // No invented business-day windows (nothing in the checkout config backs one).
    expect(text).not.toMatch(/\b\d+\s*[-–]\s*\d+\s*business days\b/i);
    expect(text).not.toMatch(/\bdelivered within \d+ days\b/i);
  });

  it('names no carrier the checkout does not verify', () => {
    const text = SHIPPING_SECTIONS.map((s) => `${s.title}\n${s.body}`).join('\n');
    for (const carrier of ['UPS', 'FedEx', 'DHL', 'USPS']) {
      expect(text, `${carrier} is claimed without checkout evidence`).not.toContain(carrier);
    }
  });
});

describe('the retired /shipping alias', () => {
  it('is never linked from the storefront footer', () => {
    expect(app).not.toMatch(/to="\/shipping"/);
    expect(app).toContain('to="/shipping-policy"');
  });

  it('redirects server-side instead of dead-ending', () => {
    expect(worker).toContain("'/shipping': '/shipping-policy'");
    expect(worker).toContain('LEGACY_PATH_REDIRECTS');
  });

  it('redirects client-side too, so dev matches production', () => {
    expect(app).toContain('<Route path="/shipping" element={<Navigate to="/shipping-policy" replace />} />');
  });

  it('advertises itself honestly in the meta description', () => {
    expect(seoMeta).toContain('Shipping Policy — Delivery, Costs & Tracking | Luxedge');
    expect(seoMeta).not.toContain('supplier estimates');
  });
});

describe('shipping policy — indexing hygiene', () => {
  it('is in the sitemap exactly once and the alias is not', () => {
    expect(sitemapScript).toContain("'/shipping-policy'");
    expect(sitemapScript).not.toContain("'/shipping'");
  });

  it('is reachable from the pre-rendered crawl footer', () => {
    expect(SSR_FOOTER_NAV.some((l) => l.to === '/shipping-policy')).toBe(true);
  });
});
