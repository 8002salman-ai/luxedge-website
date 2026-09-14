import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CATEGORY_CONTENT, categoryContentFor } from '../categoryContent';

/** The ten live, indexable categories (worker/sitemap.ts source of truth). */
const CATEGORY_SLUGS = [
  'dog-supplies', 'cat-supplies', 'pet-beds', 'pet-toys', 'feeding-water',
  'grooming', 'pet-accessories', 'bird-supplies', 'horse', 'cattle',
];

/** public/blog-seo.json is the offline snapshot of the PUBLISHED CMS corpus. */
const publishedBlogSlugs = (
  JSON.parse(readFileSync('public/blog-seo.json', 'utf8')) as { posts: { slug: string }[] }
).posts.map((p) => p.slug);

describe('category content', () => {
  it('covers every live category with a real intro and usable considerations', () => {
    for (const slug of CATEGORY_SLUGS) {
      const c = CATEGORY_CONTENT[slug];
      expect(c, slug).toBeTruthy();
      expect(c.desc.length, slug).toBeGreaterThan(20);
      expect(c.considerations.length, `${slug} considerations`).toBeGreaterThanOrEqual(2);
      for (const item of c.considerations) {
        // A short bullet is filler; these must carry actual guidance.
        expect(item.length, `${slug}: "${item}"`).toBeGreaterThan(50);
      }
    }
  });

  it('links only to guides that are actually published', () => {
    for (const [slug, c] of Object.entries(CATEGORY_CONTENT)) {
      for (const g of c.guides) {
        expect(g.href.startsWith('/blog/'), `${slug} -> ${g.href}`).toBe(true);
        expect(publishedBlogSlugs, `${slug} -> ${g.href}`).toContain(g.href.replace('/blog/', ''));
      }
    }
  });

  it('resolves by display name as well as by slug (the client passes a name)', () => {
    expect(categoryContentFor('Dog Supplies')?.desc).toBe(CATEGORY_CONTENT['dog-supplies'].desc);
    expect(categoryContentFor('Horse')?.guides.length).toBeGreaterThan(0);
    expect(categoryContentFor('All')).toBeNull();
  });

  it('is the single source for both the client and the pre-rendered category page', () => {
    // Guards against the previous duplicated maps (CAT_META / CATEGORY_DESC)
    // drifting apart again — that duplication is what this module replaced.
    expect(readFileSync('src/App.tsx', 'utf8')).toContain("from './content/categoryContent'");
    expect(readFileSync('worker/seo-meta.ts', 'utf8')).toContain("from '../src/content/categoryContent'");
  });

  it('makes no certification, safety, medical or performance claims', () => {
    const all = Object.values(CATEGORY_CONTENT).flatMap((c) => [c.desc, ...c.considerations]).join(' ');
    for (const bad of [
      /\bairline[- ]approved\b/i, /\bcertified\b/i, /\bcures?\b/i, /\bguarantee/i,
      /\bnon[- ]toxic\b/i, /\b\d+\s?dB\b/i, /\bUV[- ]?(protection|resistant)\b/i, /\bcrash[- ]tested\b/i,
    ]) {
      expect(all).not.toMatch(bad);
    }
  });
});
