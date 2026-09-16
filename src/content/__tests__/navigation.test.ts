import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Two navigation invariants this header and footer have both broken:
 *
 *  1. ONE LABEL PER DESTINATION. The header carried "Guides" and "Blog" for
 *     /blog, and the footer's Learn column carried /blog twice plus copies of
 *     the Shop column's /category/horse and /category/cattle — advertising more
 *     destinations than the site has.
 *  2. NOTHING THIN IN PRIMARY NAVIGATION. /media is four 57-65 word companion
 *     pages and a 136-word hub, all noindexed, so it was de-listed from the
 *     header, drawer and footer. Every /media URL still resolves 200 + noindex,
 *     and the homepage still links the videos as content.
 *
 * Each surface is sliced out of its source and parsed, so a duplicate cannot
 * quietly return to any of them.
 */
const app = readFileSync('src/App.tsx', 'utf8');
const seoMeta = readFileSync('worker/seo-meta.ts', 'utf8');

/** Text between two anchors — throws via the assertion if the shape moved. */
const between = (src: string, from: string, to: string) => {
  const start = src.indexOf(from);
  expect(start, `anchor not found: ${from}`).toBeGreaterThan(-1);
  return src.slice(start, src.indexOf(to, start));
};

// Three surfaces render <Link to="…"> and the header reads a data array. The
// worker footer builds its <a> tags from [label, url] pairs, so its destinations
// are the second element of each pair rather than an href in the source.
const SURFACES = [
  ['header nav', between(app, 'const navLinks = [', '];'), /to: '([^']+)'/g],
  ['mobile drawer', between(app, '{mob && (', '</header>'), /to="([^"]+)"/g],
  ['footer', between(app, 'function Footer()', '</footer>'), /to="([^"]+)"/g],
  ['worker footer', between(seoMeta, 'const FOOTER_NAV =', '</nav>'), /\[[^,]+, '([^']+)'\]/g],
] as const;

describe('primary navigation advertises each destination once', () => {
  for (const [name, block, re] of SURFACES) {
    it(`${name} has no duplicate destination`, () => {
      const dests = [...block.matchAll(re)].map((m) => m[1]);
      // The length assertion keeps this honest: a stale anchor would otherwise
      // let the test pass against an empty list and protect nothing.
      expect(dests.length, `${name} yielded no destinations`).toBeGreaterThan(1);
      expect(dests.filter((d, i) => dests.indexOf(d) !== i)).toEqual([]);
    });
  }
});

describe('/media is de-listed from primary navigation', () => {
  it('has no /media link in the header nav, mobile drawer or footer', () => {
    expect(app).not.toContain('to="/media"');
  });

  it('drops Media from the worker footer without dropping its neighbours', () => {
    const nav = between(seoMeta, 'const FOOTER_NAV =', '</nav>');
    expect(nav).not.toContain('/media');
    expect(nav).toContain("['Blog', '/blog']");
  });

  it('keeps both /media routes registered so the URLs still resolve', () => {
    expect(app).toContain('path="/media"');
    expect(app).toContain('path="/media/:slug"');
  });
});
