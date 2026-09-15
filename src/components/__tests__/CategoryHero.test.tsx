import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import CategoryHero, { categoryHeroConfig, categoryImageVariant } from '../CategoryHero';
import { categoryContentFor } from '../../content/categoryContent';

const categories = ['Dog Supplies', 'Cat Supplies', 'Horse', 'Bird Supplies', 'Cattle', 'Feeding & Water', 'Pet Accessories', 'Pet Beds', 'Pet Toys', 'Grooming'];
const slugs = ['dog-supplies', 'cat-supplies', 'horse', 'bird-supplies', 'cattle', 'feeding-water', 'pet-accessories', 'pet-beds', 'pet-toys', 'grooming'];

describe('category hero public rendering', () => {
  it.each(categories)('%s has one heading, a photo and valid shopping links', name => {
    const config = categoryHeroConfig(name, 'Fallback');
    const html = renderToStaticMarkup(<MemoryRouter><CategoryHero config={config} /></MemoryRouter>);
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(html).toContain('href="#product-grid"');
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain('Buyer guidance');
    expect(html).toContain(config.buyerNote);
    expect(html).toContain('fetchPriority="high"');
    expect(config.imageAlt.length).toBeGreaterThan(10);
    expect(config.image).toMatch(/^https:\/\//);
    for (const chip of config.chips) expect(slugs).toContain(chip.href.replace('/category/', ''));
  });

  it.each(categories)('%s renders the shared considerations and honest guide links', name => {
    // The worker pre-renders these same considerations into the crawl HTML, so a
    // visitor seeing less guidance than a crawler is a real defect, not a
    // cosmetic difference.
    const config = categoryHeroConfig(name, 'Fallback');
    const html = renderToStaticMarkup(<MemoryRouter><CategoryHero config={config} /></MemoryRouter>);
    const shared = categoryContentFor(name);
    expect(shared, `${name} must have shared content`).not.toBeNull();
    // Decode entities once: "Feeding & Water" legitimately renders as
    // "Feeding &amp; Water", and comparing raw HTML to source text would either
    // fail on that or hide a double-escape.
    const decoded = html.replace(/&#x27;|&apos;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    expect(decoded).not.toContain('&amp;');
    expect(decoded).toContain(`What to look for in ${name.toLowerCase()}`);
    for (const consideration of shared!.considerations) {
      expect(decoded).toContain(consideration);
    }
    for (const guide of shared!.guides) {
      expect(html).toContain(`href="${guide.href}"`);
    }
    // A collection with no genuinely relevant guide must not link one.
    if (shared!.guides.length === 0) expect(html).not.toContain('Related guides:');
  });

  it('renders no considerations section for a collection with no shared content', () => {
    const html = renderToStaticMarkup(<MemoryRouter><CategoryHero config={categoryHeroConfig('Future collection', 'Desc')} /></MemoryRouter>);
    expect(html).not.toContain('What to look for in');
    expect(html).not.toContain('Related guides:');
  });

  it('retains unknown category copy without inventing imagery', () => {
    const config = categoryHeroConfig('Future collection', 'Useful collection description');
    expect(config.headline).toBe('Future collection');
    expect(config.desc).toBe('Useful collection description');
    expect(config.image).toBe('');
    expect(config.chips).toEqual([]);
    expect(config.buyerNote).toContain('task');
  });

  it('sizes known CDN images without rewriting custom image URLs', () => {
    const custom = 'https://luxedge.us/images/custom.webp';
    expect(categoryImageVariant(custom, 360)).toBe(custom);
    const image = new URL(categoryImageVariant(categoryHeroConfig('Dog Supplies', '').image, 360));
    expect(image.searchParams.get('w')).toBe('360');
    expect(image.searchParams.get('h')).toBe('324');
    expect(image.searchParams.get('auto')).toBe('format');
  });
});
