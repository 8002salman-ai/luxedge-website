import { describe, it, expect } from 'vitest';
import {
  COLLECTIONS, NAV_COLLECTIONS, PRIMARY_ANIMAL_COLLECTIONS, MEGA_COLUMNS,
  resolveCollection, matchesCollection, primaryCollectionFor, legacySlugsInNav,
  sitemapCollectionSlugs, isLegacyCollection,
} from '../taxonomy';

const product = (name: string, category = '', tags: string[] = []) => ({ name, category, tags });

describe('taxonomy — primary navigation', () => {
  it('surfaces Horse and Cattle as the animal navigation, in that order', () => {
    expect(PRIMARY_ANIMAL_COLLECTIONS.map((c) => c.slug)).toEqual(['horse', 'cattle']);
  });

  it('never leaks a legacy collection into a navigation surface', () => {
    // Fails loudly if Dog or Cat are re-promoted into nav, the mega menu, or
    // anything else built from NAV_COLLECTIONS.
    expect(legacySlugsInNav()).toEqual([]);
  });

  it('keeps Dog and Cat out of the mega menu animal column', () => {
    const animals = MEGA_COLUMNS.find((c) => c.title === 'Shop by animal');
    expect(animals?.slugs).toEqual(['horse', 'cattle']);
  });

  it('marks Dog and Cat as legacy but keeps them in the full collection list', () => {
    expect(COLLECTIONS.map((c) => c.slug)).toEqual(expect.arrayContaining(['dog', 'cat']));
    expect(isLegacyCollection(resolveCollection('dog'))).toBe(true);
    expect(isLegacyCollection(resolveCollection('cat'))).toBe(true);
    expect(isLegacyCollection(resolveCollection('horse'))).toBe(false);
  });
});

describe('taxonomy — legacy URL resolution', () => {
  it.each([
    ['dog', 'Dog'],
    ['cat', 'Cat'],
    ['dog-supplies', 'Dog'],
    ['cat-supplies', 'Cat'],
    ['pet-beds', 'Comfort & Rest'],
    ['pet-toys', 'Play & Enrichment'],
    ['grooming', 'Grooming & Care'],
    ['pet-accessories', 'Accessories'],
    ['feeding-water', 'Feeding & Water'],
    ['horse', 'Horse'],
    ['cattle', 'Cattle'],
  ])('/category/%s still resolves to %s', (slug, label) => {
    expect(resolveCollection(slug)?.label).toBe(label);
  });

  it('returns null for an unknown slug rather than guessing', () => {
    expect(resolveCollection('not-a-collection')).toBeNull();
    expect(resolveCollection(undefined)).toBeNull();
  });
});

describe('taxonomy — product matching is non-destructive', () => {
  it('still matches existing Dog/Cat products to their legacy collections', () => {
    const bed = product('Orthopedic Memory Foam Dog Bed', 'Pet Beds', ['dog']);
    expect(matchesCollection(bed, resolveCollection('dog')!)).toBe(true);
    const tower = product('Cat Scratching Tower', 'Cat Supplies', ['cat']);
    expect(matchesCollection(tower, resolveCollection('cat')!)).toBe(true);
  });

  it('keeps Dog/Cat products reachable through need-based collections', () => {
    const bed = product('Orthopedic Memory Foam Dog Bed', 'Pet Beds', ['dog']);
    expect(matchesCollection(bed, resolveCollection('comfort-rest')!)).toBe(true);
  });

  it('prefers a navigable collection when describing a product', () => {
    // A dog bed must not breadcrumb into a collection navigation hides.
    const bed = product('Orthopedic Memory Foam Dog Bed', 'Pet Beds', ['dog']);
    const chosen = primaryCollectionFor(bed);
    expect(chosen).toBeDefined();
    expect(chosen!.legacy).toBeFalsy();
    expect(NAV_COLLECTIONS).toContain(chosen);
  });

  it('matches horse and cattle products to their collections', () => {
    expect(matchesCollection(product('Leather Rope Halter', '', ['horse']), resolveCollection('horse')!)).toBe(true);
    expect(matchesCollection(product('Cattle Mineral Feed Trough', '', ['livestock']), resolveCollection('cattle')!)).toBe(true);
  });
});

describe('taxonomy — sitemap', () => {
  it('advertises the primary collections', () => {
    expect(sitemapCollectionSlugs()).toEqual(expect.arrayContaining(['horse', 'cattle', 'stable-farm', 'feeding-water']));
  });

  it('does not newly promote /category/dog or /category/cat', () => {
    const slugs = sitemapCollectionSlugs();
    expect(slugs).not.toContain('dog');
    expect(slugs).not.toContain('cat');
  });

  it('keeps the already-indexed legacy aliases', () => {
    expect(sitemapCollectionSlugs()).toEqual(expect.arrayContaining(['dog-supplies', 'cat-supplies']));
  });
});

describe('taxonomy — sitemap generator stays in sync', () => {
  it('scripts/regenerate-sitemap.mjs advertises exactly the same slugs', async () => {
    // The generator runs in Node against the live DB and cannot import this
    // TS module, so it carries its own list. This asserts the two never drift.
    const fs = await import('node:fs');
    const src = fs.readFileSync('scripts/regenerate-sitemap.mjs', 'utf8');
    const block = src.match(/const COLLECTION_SLUGS = \[([\s\S]*?)\];/);
    expect(block).toBeTruthy();
    const inScript = [...block![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect([...inScript].sort()).toEqual([...sitemapCollectionSlugs()].sort());
  });
});
