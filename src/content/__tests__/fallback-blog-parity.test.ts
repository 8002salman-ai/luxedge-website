import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * src/App.tsx carries a bundle-only fallback for the blog: a list of post
 * objects (INIT_BLOGS) plus an allowlist (RETAINED_FALLBACK_BLOG_SLUGS) that
 * decides which of them may be served at all.
 *
 * Before this test the two drifted: the allowlist named eight guides while only
 * four had any fallback content, so half the entries were dead — they could
 * never render, and they made the allowlist look broader than the offline
 * fallback actually was. This keeps the pair in exact sync in both directions:
 * every allowlisted slug must have content, and no bundled content may sit
 * outside the allowlist (where the filter would silently drop it).
 */
const source = readFileSync('src/App.tsx', 'utf8');

function allowlistedSlugs(): string[] {
  const block = source.match(/const RETAINED_FALLBACK_BLOG_SLUGS = new Set\(\[([\s\S]*?)\]\);/);
  if (!block) throw new Error('RETAINED_FALLBACK_BLOG_SLUGS not found in src/App.tsx');
  return [...block[1].matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
}

function bundledBlogSlugs(): string[] {
  const block = source.match(/const INIT_BLOGS: BlogPost\[\] = \[([\s\S]*?)\n\s*\];/);
  if (!block) throw new Error('INIT_BLOGS not found in src/App.tsx');
  return [...new Set([...block[1].matchAll(/slug:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]))];
}

describe('bundled blog fallback parity', () => {
  const allowlisted = allowlistedSlugs();
  const bundled = bundledBlogSlugs();

  it('finds both lists in the source', () => {
    expect(bundled.length).toBeGreaterThan(0);
    expect(allowlisted.length).toBeGreaterThan(0);
  });

  it('has fallback content for every allowlisted slug (no dead allowlist entries)', () => {
    const missing = allowlisted.filter((slug) => !bundled.includes(slug));
    expect(missing, `allowlisted but has no INIT_BLOGS content: ${missing.join(', ')}`).toEqual([]);
  });

  it('lists every bundled post in the allowlist (nothing silently dropped)', () => {
    const unreachable = bundled.filter((slug) => !allowlisted.includes(slug));
    expect(unreachable, `bundled but filtered out by the allowlist: ${unreachable.join(', ')}`).toEqual([]);
  });

  it('keeps the retired low-value article out of the fallback', () => {
    for (const dead of ['grooming-routine-long-haired-pets', 'dog-car-safety-seat-belt-guide', 'essential-supplies-new-puppy']) {
      expect(allowlisted).not.toContain(dead);
      expect(bundled).not.toContain(dead);
    }
  });
});
