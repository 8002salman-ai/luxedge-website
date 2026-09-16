import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  COPYRIGHT_SECTIONS,
  DISCLAIMER_SECTIONS,
  EDITORIAL_SECTIONS,
  PRIVACY_SECTIONS,
  RETURNS_SECTIONS,
  SHIPPING_SECTIONS,
  TERMS_SECTIONS,
} from '../policies';

/**
 * The trust pages are the surface an AdSense reviewer reads first, and they
 * were published from two places: the worker pre-rendered the section arrays in
 * src/content/policies.ts, while the React pages carried their own inline copy.
 * The two had already drifted in content — the crawl version of the privacy
 * policy had a US-privacy-rights section the visitor never saw, and the visitor
 * version had checkout and email-marketing sections the crawler never saw.
 *
 * A crawler without JavaScript and a visitor must read the same terms, so the
 * React page has to render the array, not a lookalike. These assertions fail if
 * anyone re-introduces an inline copy, or if a policy loses a section.
 */
const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
const worker = readFileSync(resolve(process.cwd(), 'worker/seo-meta.ts'), 'utf8');

const PAGES: [string, string, string, string][] = [
  ['/privacy', 'PrivacyPage', 'PRIVACY_SECTIONS', 'Privacy Policy'],
  ['/terms', 'TermsPage', 'TERMS_SECTIONS', 'Terms of Service'],
  ['/returns', 'ReturnsPage', 'RETURNS_SECTIONS', 'Returns & Replacement Policy'],
  ['/shipping-policy', 'ShippingPolicyPage', 'SHIPPING_SECTIONS', 'Shipping Policy'],
  ['/copyright', 'CopyrightPage', 'COPYRIGHT_SECTIONS', 'Copyright & DMCA'],
  ['/editorial-policy', 'EditorialPolicyPage', 'EDITORIAL_SECTIONS', 'Editorial Policy'],
  ['/disclaimer', 'DisclaimerPage', 'DISCLAIMER_SECTIONS', 'Disclaimer'],
];

/** The component body, from its declaration to the next top-level function. */
function componentBody(name: string): string {
  const start = app.indexOf(`function ${name}()`);
  expect(start, `${name} not found in src/App.tsx`).toBeGreaterThan(-1);
  const end = app.indexOf('\nfunction ', start + 1);
  return app.slice(start, end === -1 ? undefined : end);
}

describe('policy pages render from one source', () => {
  for (const [path, component, array] of PAGES) {
    it(`${path} renders ${array}`, () => {
      expect(componentBody(component)).toContain(`{${array}.map(`);
    });
  }

  it('keeps every page out of the hand-written section markup', () => {
    for (const [, component] of PAGES) {
      // A section written as inline JSX (<LS t="…">) is a second copy of the
      // policy, which is exactly what drifted before.
      expect(componentBody(component), `${component} has an inline section`).not.toMatch(/<LS\s+t="/);
    }
  });

  it('pre-renders the same arrays from the worker', () => {
    for (const [path, , array] of PAGES) {
      // injectLegalBody(out, '<Title>', <ARRAY>, …) — the title string the
      // worker prints has to come from the same page map the client uses.
      expect(worker, `${path} body not wired`).toContain(`'${path}'`);
      expect(worker, `${array} not used by the worker`).toContain(array);
    }
  });

  it('has no empty section, and no section that repeats another title', () => {
    const arrays = [PRIVACY_SECTIONS, TERMS_SECTIONS, RETURNS_SECTIONS, SHIPPING_SECTIONS, COPYRIGHT_SECTIONS, EDITORIAL_SECTIONS, DISCLAIMER_SECTIONS];
    for (const sections of arrays) {
      const titles = sections.map((s) => s.title);
      expect(new Set(titles).size, `duplicate title in ${titles[0]}`).toBe(titles.length);
      for (const s of sections) {
        expect(s.title.trim().length, 'untitled section').toBeGreaterThan(3);
        expect(s.body.trim().length, `${s.title} is empty`).toBeGreaterThan(40);
      }
    }
  });
});
