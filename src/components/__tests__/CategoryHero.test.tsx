import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import CategoryHero, { categoryHeroConfig, categoryImageVariant } from '../CategoryHero';

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
