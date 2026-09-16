import { describe, expect, it } from 'vitest';
import { maybeInjectSeo } from '../../../worker/seo-meta';
import {
  NAV_PATHS, UTILITY_NAV, STRIP_NAV, MEGA_MENU, DRAWER_NAV, FOOTER_COLUMNS, SSR_FOOTER_NAV,
} from '../navigation';

/**
 * Navigation invariants, asserted against src/content/navigation.ts — the one
 * module the header strip, mobile drawer, footer and the worker's pre-rendered
 * footer all render from.
 *
 * These read the values themselves rather than the markup that happens to
 * contain them, so a surface that drifts from the rest fails here instead of
 * shipping a menu that points at the wrong page. The worker case is exercised
 * through maybeInjectSeo, which is the code path that actually emits it.
 */

const stripDests = [STRIP_NAV.all, ...STRIP_NAV.items, STRIP_NAV.deals].map((l) => l.to);
const drawerDests = [...DRAWER_NAV.tiles, ...DRAWER_NAV.links].map((l) => l.to);
const footerDests = FOOTER_COLUMNS.flatMap((c) => c.links.map((l) => l.to));

const SURFACES: [string, string[]][] = [
  ['utility bar', UTILITY_NAV.map((l) => l.to)],
  ['header strip', stripDests],
  ['mobile drawer', drawerDests],
  ['footer', footerDests],
  ['worker footer', SSR_FOOTER_NAV.map((l) => l.to)],
  ...MEGA_MENU.map((p): [string, string[]] => [`${p.label} panel`, p.groups.flatMap((g) => g.links.map((l) => l.to))]),
];

describe('every navigation surface advertises each destination once', () => {
  for (const [name, dests] of SURFACES) {
    it(`${name}: no duplicate destination`, () => {
      // The length assertion keeps this honest: a surface that renders nothing
      // would otherwise satisfy the uniqueness check and protect nothing.
      expect(dests.length).toBeGreaterThan(1);
      expect(dests.filter((d, i) => dests.indexOf(d) !== i)).toEqual([]);
    });
  }
});

describe('navigation only points at named paths', () => {
  it('uses a NAV_PATHS value for every destination on every surface', () => {
    const named = new Set<string>(Object.values(NAV_PATHS));
    expect([...new Set(SURFACES.flatMap(([, dests]) => dests))].filter((d) => !named.has(d))).toEqual([]);
  });

  it('keeps /media out of primary navigation', () => {
    expect(SURFACES.flatMap(([, dests]) => dests).filter((d) => d === '/media' || d.startsWith('/media/'))).toEqual([]);
  });
});

describe('panels and the strip items that open them agree', () => {
  it('matches every megaKey to a panel pointing at the same destination', () => {
    for (const item of STRIP_NAV.items.filter((i) => i.megaKey)) {
      const panel = MEGA_MENU.find((p) => p.label === item.megaKey);
      expect(panel, `no panel for megaKey "${item.megaKey}"`).toBeDefined();
      expect(panel?.to).toBe(item.to);
      expect(panel?.groups.length).toBeGreaterThan(0);
    }
  });

  it('gives every panel a strip item that opens it', () => {
    expect(MEGA_MENU.map((p) => p.label).filter((l) => !STRIP_NAV.items.some((i) => i.megaKey === l))).toEqual([]);
  });
});

describe('the worker pre-renders the footer the module defines', () => {
  const shell = '<head><title>Luxedge</title><meta name="robots" content="index, follow" />'
    + '<link rel="canonical" href="https://luxedge.us" /></head><div id="root"></div>';
  const env = { ASSETS: { fetch: async () => new Response('{}') } };

  it('emits every SSR_FOOTER_NAV link, in order, and no others', async () => {
    const result = await maybeInjectSeo(shell, '/about', 'https://luxedge.us', env);
    const html = result && 'html' in result ? result.html : '';
    const block = html.slice(html.indexOf('aria-label="Site"'), html.indexOf('</nav>'));
    const rendered = [...block.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map((m) => `${m[2]}→${m[1]}`);
    expect(rendered.length).toBeGreaterThan(1);
    expect(rendered).toEqual(SSR_FOOTER_NAV.map((l) => `${l.label}→${l.to}`));
  });
});
