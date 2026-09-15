// ============================================================================
// LUXEDGE — product buyer content contract
//
// productContent.ts exists to lift thin product pages above "Low value content"
// WITHOUT inventing anything: no dimensions, materials, ratings or performance
// claims that the catalogue cannot support. This suite is the guard rail:
//
//   1. Every entry is substantive enough to be worth publishing.
//   2. No entry smuggles in an unsupported claim (the exact class of wording
//      that AdSense policy and our own claim scan reject).
//   3. Guide links point at guides that are actually live.
//   4. Both renderers — the worker pre-render and the React product page — read
//      this file, so a visitor and a crawler can never see different content.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PRODUCT_CONTENT, NEEDS_OWNER_EVIDENCE, productContentFor } from '../productContent';

/** The eight guides live in the CMS as of this change. */
const LIVE_BLOG_SLUGS = new Set([
  'best-bird-feeder-buyers-guide',
  'horse-fly-mask-buyers-guide',
  'horse-grooming-kit-buyers-guide',
  'horse-halter-lead-rope-buyers-guide',
  'how-to-choose-a-cat-tunnel',
  'how-to-choose-cattle-trough-feed-water-setup',
  'how-to-clean-a-bird-feeder',
  'how-to-fit-no-pull-dog-harness',
]);

const entries = Object.entries(PRODUCT_CONTENT);

// Wording that attributes a figure to the listing rather than asserting it:
// restating the product's own title ("the listing names 30 gallons") is
// published catalog data, not a claim of ours.
const ATTRIBUTED = /\b(?:the listing|the title|product name|listing names|listing states|the page|this page)\b/i;
// A disclaimer is not a claim: "not a crash-tested device" must pass.
const NEGATION = /\b(?:not|never|no|is not|does not|doesn't|cannot|can't|without|rather than)\b/i;

const numberClaims: Array<[string, RegExp]> = [
  ['decibel figure', /\b\d+\s*(?:db|dba)\b/i],
  ['measurement', /\b\d+(?:\.\d+)?\s?(?:cm|mm|inch|inches|ft|feet|kg|lb|lbs|oz|ml|gallon|gal)\b/i],
  ['UV rating', /\bupf\s?\d+|\buv\s?(?:protection factor|rating)\s?\d+/i],
  ['load rating', /\b\d+\s?(?:lb|lbs|kg)\s+(?:load|capacity|rating)\b/i],
];

// Never acceptable on our page, attributed or not: publishing "the listing says
// it is crash tested" is still publishing the claim.
const alwaysBanned: Array<[string, RegExp]> = [
  ['certification', /certipur|ce[- ]certified|fda[- ]approved|iso[- ]certified|certified/i],
  ['airline approval', /airline[- ]approved|approved by (?:the )?airline/i],
  ['crash test', /crash[- ]test|crash[- ]rated/i],
  // Word-boundary "treat" alone is not a claim ("treat it as a mesh cover"),
  // and the disclaimers in this file deliberately use "not a treatment for".
  ['medical claim', /\btreats?\s+(?:arthritis|disease|infection|inflammation|injury|pain|anxiety|parasites|worms|fleas|ticks|hot ?spots)|\bcures?\b|prevents? (?:arthritis|disease|infection|injury)|pain relief|therapeutic|medical[- ]grade|antibacterial|antimicrobial/i],
  ['absolute guarantee', /100% (?:safe|guaranteed|effective)|guaranteed to/i],
];

/** Fails on any sentence that ASSERTS a banned claim (a negated one is a disclaimer). */
function assertNoAssertedClaims(slug: string, text: string): void {
  for (const sentence of text.split(/(?<=[.!?;])\s*/).filter(Boolean)) {
    const attributed = ATTRIBUTED.test(sentence);
    const checks = attributed ? alwaysBanned : [...alwaysBanned, ...numberClaims];
    for (const [label, re] of checks) {
      const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
      for (const match of sentence.matchAll(global)) {
        if (NEGATION.test(sentence.slice(0, match.index))) continue;
        expect.fail(`${slug}: ${label} asserted → "${match[0]}" in: ${sentence.trim()}`);
      }
    }
  }
}

describe('productContent entries', () => {
  it('covers a meaningful number of products', () => {
    expect(entries.length).toBeGreaterThanOrEqual(30);
  });

  it('every entry is substantive (summary, checks, care, evidence list)', () => {
    for (const [slug, c] of entries) {
      expect(c.summary.length, `${slug} summary`).toBeGreaterThan(80);
      expect(c.confirm.length, `${slug} confirm`).toBeGreaterThanOrEqual(2);
      expect(c.care.length, `${slug} care`).toBeGreaterThanOrEqual(2);
      expect(c.needs.length, `${slug} needs`).toBeGreaterThanOrEqual(2);
      for (const line of [...c.confirm, ...c.care]) {
        expect(line.length, `${slug} bullet too short: ${line}`).toBeGreaterThan(30);
      }
    }
  });

  it('slugs are lowercase, url-safe and unique', () => {
    const seen = new Set<string>();
    for (const [slug] of entries) {
      expect(slug).toMatch(/^[a-z0-9][a-z0-9-]+$/);
      expect(seen.has(slug)).toBe(false);
      seen.add(slug);
    }
  });

  it('never asserts a specification or performance claim of its own', () => {
    for (const [slug, c] of entries) {
      const text = [c.summary, ...c.confirm, ...c.care, c.guide?.label || ''].join(' ');
      assertNoAssertedClaims(slug, text);
    }
  });

  it('the guard itself distinguishes a claim from a disclaimer', () => {
    // A guard that cannot tell these apart would either miss real claims or
    // force the disclaimers out of the copy — both are wrong.
    assertNoAssertedClaims('t', 'This is a restraint, not a crash-tested safety device.');
    assertNoAssertedClaims('t', 'It is a comfort aid, not a treatment for heat stress.');
    assertNoAssertedClaims('t', 'Capacity: the listing names 50 gallons, so confirm it suits your pen.');
    expect(() => assertNoAssertedClaims('t', 'This carrier is airline-approved.')).toThrow();
    expect(() => assertNoAssertedClaims('t', 'The pump runs at 35 dB.')).toThrow();
    expect(() => assertNoAssertedClaims('t', 'It measures 60 cm across.')).toThrow();
  });

  it('guide links point at live guides only', () => {
    for (const [slug, c] of entries) {
      if (!c.guide) continue;
      expect(c.guide.href, `${slug} href`).toMatch(/^\/blog\/[a-z0-9-]+$/);
      expect(LIVE_BLOG_SLUGS.has(c.guide.href.replace('/blog/', '')), `${slug} → ${c.guide.href}`).toBe(true);
      expect(c.guide.label.length).toBeGreaterThan(5);
    }
  });

  it('says plainly when a fact is missing instead of implying one exists', () => {
    // Products whose known gaps are material must tell the buyer so.
    expect(PRODUCT_CONTENT['dog-bed'].confirm.join(' ')).toMatch(/not published on this page|not stated/i);
    expect(PRODUCT_CONTENT['orthopedic-memory-foam-dog-bed-joint-support-for-senior-large-dogs'].confirm.join(' ')).toMatch(/not state/i);
    expect(PRODUCT_CONTENT['foldable-pet-carrier-backpack-airline-approved-travel-bag-for-cats-small-dogs'].confirm.join(' ')).toMatch(/no approval claim/i);
    expect(PRODUCT_CONTENT['dog-poop-bags-biodegradable-waste-bag-rolls'].confirm.join(' ')).toMatch(/does not state a degradation timeframe/i);
  });

  it('documents the owner-evidence list', () => {
    expect(NEEDS_OWNER_EVIDENCE.length).toBeGreaterThanOrEqual(5);
  });
});

describe('productContentFor', () => {
  it('resolves a known slug and rejects unknown/empty input', () => {
    expect(productContentFor('dog-bed')?.summary).toBeTruthy();
    expect(productContentFor('no-such-product-xyz')).toBeUndefined();
    expect(productContentFor('')).toBeUndefined();
    expect(productContentFor(null)).toBeUndefined();
    expect(productContentFor(undefined)).toBeUndefined();
  });

  it('does not resolve Object.prototype members', () => {
    // The lookup is keyed by a URL slug, so it must never walk the prototype.
    for (const key of ['toString', 'constructor', '__proto__', 'valueOf', 'hasOwnProperty']) {
      expect(productContentFor(key)).toBeUndefined();
    }
  });
});

describe('renderer parity', () => {
  it('both the crawl pre-render and the product page read this file', () => {
    // Divergence between what Google crawls and what a visitor sees is its own
    // quality problem — and it already happened once with the shipping page.
    const worker = readFileSync('worker/seo-meta.ts', 'utf8');
    const app = readFileSync('src/App.tsx', 'utf8');
    for (const [name, src] of [['worker/seo-meta.ts', worker], ['src/App.tsx', app]] as const) {
      expect(src.includes('productContentFor'), `${name} must import productContentFor`).toBe(true);
    }
    // The worker must emit the same section headings the client renders.
    for (const heading of ['About this product', 'What to check before ordering', 'Care and safety']) {
      expect(worker.includes(heading), `worker missing heading: ${heading}`).toBe(true);
      expect(app.includes(heading), `App.tsx missing heading: ${heading}`).toBe(true);
    }
  });
});
