import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PRODUCT_SLUG_RENAMES,
  FORBIDDEN_SLUG_PATTERNS,
  MAX_SLUG_LENGTH,
  productSlugRedirects,
} from '../productSlugHistory';
import { PRODUCT_CONTENT } from '../productContent';

/**
 * A product URL is customer-facing copy — it appears in the sitemap a reviewer
 * reads, in the address bar a buyer reads, and in Google's result list. The
 * catalogue was imported from a supplier feed, so a third of the public PDP
 * URLs were feed keyword strings, two of which carried an unsupported claim
 * (airline approval, joint support) that the served-text claim scan cannot see.
 *
 * These tests pin the rename so it cannot silently regress, and — the failure
 * that actually hurts — so a rename can never drop the curated buyer copy that
 * makes those PDPs substantive. Renaming a PRODUCT_CONTENT key without moving
 * the database row (or the reverse) leaves the page short again.
 */
const file = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('product slug hygiene', () => {
  it('keeps every new slug clean by pattern and length', () => {
    for (const [oldSlug, newSlug] of Object.entries(PRODUCT_SLUG_RENAMES)) {
      expect(newSlug.length, `${newSlug} must be readable, not a feed keyword string`).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
      for (const bad of FORBIDDEN_SLUG_PATTERNS) {
        expect(bad.test(newSlug), `${newSlug} still matches ${bad}`).toBe(false);
      }
      expect(oldSlug).not.toBe(newSlug);
    }
  });

  it('flags the exact defects the supplier slugs carried', () => {
    // Regression guard on the guard: if these patterns ever stop matching, the
    // rule above has silently stopped protecting anything.
    const supplierSlugs = Object.keys(PRODUCT_SLUG_RENAMES);
    const claimed = supplierSlugs.filter((s) => /airline[- ]approved|joint[- ]support/i.test(s));
    expect(claimed.length, 'the airline/joint-support slugs that motivated this file').toBeGreaterThanOrEqual(2);
    expect(supplierSlugs.some((s) => s.length > MAX_SLUG_LENGTH)).toBe(true);
  });

  it('renamed the curated copy with the URL, so no PDP was left thin', () => {
    for (const [oldSlug, newSlug] of Object.entries(PRODUCT_SLUG_RENAMES)) {
      expect(
        Object.prototype.hasOwnProperty.call(PRODUCT_CONTENT, oldSlug),
        `${oldSlug} is gone from the URL — the copy map must not keep the old key`,
      ).toBe(false);
      expect(
        Object.prototype.hasOwnProperty.call(PRODUCT_CONTENT, newSlug),
        `${newSlug} must carry the curated copy that ${oldSlug} used to have`,
      ).toBe(true);
    }
  });

  it('serves a permanent redirect for every retired supplier URL', () => {
    const redirects = productSlugRedirects();
    expect(Object.keys(redirects)).toHaveLength(Object.keys(PRODUCT_SLUG_RENAMES).length);
    for (const [oldSlug, newSlug] of Object.entries(PRODUCT_SLUG_RENAMES)) {
      expect(redirects[`/product/${oldSlug}`]).toBe(`/product/${newSlug}`);
    }
  });

  it('wires those redirects into the worker instead of leaving dead URLs', () => {
    const src = file('worker/index.ts');
    expect(src).toContain('productSlugRedirects()');
    expect(src).toContain("import { productSlugRedirects } from '../src/content/productSlugHistory'");
  });

  it('keeps no supplier-style slug in the curated copy map', () => {
    for (const slug of Object.keys(PRODUCT_CONTENT)) {
      for (const bad of FORBIDDEN_SLUG_PATTERNS) {
        expect(bad.test(slug), `PRODUCT_CONTENT key "${slug}" matches ${bad}`).toBe(false);
      }
    }
  });
});
