import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Two navigation invariants the header and footer have both broken: one label
 * per destination, and nothing thin in primary navigation. Each surface is
 * sliced out of its source and parsed, so a duplicate destination or a thin
 * route cannot quietly return.
 */
const app = readFileSync('src/App.tsx', 'utf8');
const seoMeta = readFileSync('worker/seo-meta.ts', 'utf8');

/** Text between two anchors — throws via the assertion if the shape moved. */
const between = (src: string, from: string, to: string) => {
  const start = src.indexOf(from);
  expect(start, `anchor not found: ${from}`).toBeGreaterThan(-1);
  return src.slice(start, src.indexOf(to, start));
};

// Four surfaces render <Link to="..."> — the utility bar is a sibling of
// <header>, not inside it — and the header reads a data array. The worker footer
// builds its <a> tags from [label, url] pairs, so its destinations are the
// second element of each pair rather than an href in the source.
const workerFooter = between(seoMeta, 'const FOOTER_NAV =', '</nav>');

// Each header mega panel is a surface of its own, sliced from its groups array
// to the next panel. The panel's own destination is not counted: the nav bar
// entry above it is the conventional "go to the section" label, and the nav bar
// is already covered.
const megaBlock = between(app, 'const MEGA_MENU', 'function Header()');
const panelStarts = [...megaBlock.matchAll(/label: '([^']+)', to: '[^']+',\r?\n    groups: \[/g)];

const SURFACES: [string, string, RegExp][] = [
  ['utility bar', between(app, 'Top Utility Bar', 'Main Header'), /to="([^"]+)"/g],
  ['header nav', between(app, 'const navLinks = [', '];'), /to: '([^']+)'/g],
  ['mobile drawer', between(app, '{mob && (', '</header>'), /to="([^"]+)"/g],
  ['footer', between(app, 'function Footer()', '</footer>'), /to="([^"]+)"/g],
  ['worker footer', workerFooter, /\[[^,]+, '([^']+)'\]/g],
  ...panelStarts.map((m, i): [string, string, RegExp] => [
    `mega panel "${m[1]}"`,
    megaBlock.slice((m.index ?? 0) + m[0].length, panelStarts[i + 1]?.index ?? megaBlock.length),
    /to: '([^']+)'/g,
  ]),
];

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
    expect(workerFooter).not.toContain('/media');
    expect(workerFooter).toContain("['Blog', '/blog']");
  });

  it('keeps both /media routes registered so the URLs still resolve', () => {
    expect(app).toContain('path="/media"');
    expect(app).toContain('path="/media/:slug"');
  });
});
