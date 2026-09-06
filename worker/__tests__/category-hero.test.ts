// ============================================================================
// LUXEDGE — worker category header pet-hero image contract
//
// The category page header now shows a pet image related to the category in
// the middle of the header (text left, image center, ad right). These tests
// pin that the SERVER-RENDERED category body emits the matching editorial pet
// image for known categories, and never invents an image for an unknown one.
// The client side renders the same map (CAT_HERO_IMAGES in src/App.tsx).
// ============================================================================

import { describe, expect, it } from 'vitest';
import { injectCategoryBody, type CategoryRow, type ProductRow } from '../seo-meta';

const cat = (name: string, slug: string): CategoryRow => ({ name, slug });

function wrap(c: CategoryRow, products: ProductRow[] = []): string {
  // Matches the production shell: inject() pre-fills #root with the SSR body
  // mount point (PR #110 footer-nav change), which route injectors replace.
  return injectCategoryBody('<div id="root"><div id="ssr-body"></div></div>', c, products);
}

describe('injectCategoryBody — category pet hero image', () => {
  it('emits the matching pet image for a known category (Dog Supplies)', () => {
    const html = wrap(cat('Dog Supplies', 'dog-supplies'));
    expect(html).toMatch(
      /<img src="https:\/\/images\.unsplash\.com\/photo-1552053831-71594a27632d[^"]*" alt="Dog Supplies essentials" \/>/,
    );
  });

  it('emits the matching pet image for Cat Supplies', () => {
    const html = wrap(cat('Cat Supplies', 'cat-supplies'));
    expect(html).toContain('photo-1514888286974-6c03e2ca1dba');
    expect(html).toContain('alt="Cat Supplies essentials"');
  });

  it('emits the matching pet image for Horse and Cattle', () => {
    expect(wrap(cat('Horse', 'horse'))).toContain('photo-1553284965-83fd3e82fa5a');
    expect(wrap(cat('Cattle', 'cattle'))).toContain('photo-1500595046743-cd271d694d30');
  });

  it('emits no image for an unknown category (no invented URL)', () => {
    const html = wrap(cat('Unlisted New Category', 'unlisted-new-category'));
    expect(html).not.toContain('<img src="');
  });

  it('still renders the category h1 and description with the image', () => {
    const html = wrap(cat('Dog Supplies', 'dog-supplies'));
    expect(html).toContain('<h1>Dog Supplies</h1>');
    // & is HTML-escaped by esc().
    expect(html).toContain('Walking, training &amp; everyday dog essentials');
    // Image appears before the heading.
    expect(html.indexOf('<img')).toBeLessThan(html.indexOf('<h1>'));
  });
});