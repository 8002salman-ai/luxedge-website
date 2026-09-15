// ============================================================================
// LUXEDGE — product facts contract
//
// The catalog's owner-editable columns (long_description, features,
// specifications, weight_oz) never reached a product page: filling them in
// could not add a single word, and those pages can only deepen honestly through
// data the owner supplies. This suite pins the rules that make publishing them
// safe:
//
//   1. EMPTY IS EMPTY — every "no data" shape (`undefined`, null, '', '[]', {})
//      produces byte-identical output to the field being absent, so a product
//      with empty fields gains no markup, no empty section and no default.
//   2. NOTHING IS GUESSED — values print as stored; nested objects are skipped
//      rather than flattened; a weight is converted only when the conversion is
//      exact.
//   3. BOTH RENDERERS AGREE — the worker pre-render and the React components
//      are rendered here and compared string-for-string, so the crawler and the
//      visitor cannot be shown different facts.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  productFacts,
  hasProductFacts,
  specLabel,
  specValue,
  weightFactRow,
  type ProductFactInput,
} from '../productFacts';
import { ProductFactSections, ProductSpecRows } from '../../components/ProductFacts';
import { injectProductBody } from '../../../worker/seo-meta';

const decode = (html: string) => html
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#0?39;|&apos;/g, "'")
  .replace(/&nbsp;/g, ' ');

const SHELL = '<div id="ssr-body"></div>';

type Row = Record<string, unknown>;
const row = (over: Row = {}): Parameters<typeof injectProductBody>[1] => ({
  id: 'fixture-id',
  slug: 'fixture-product',
  name: 'Fixture Product',
  price: 12.5,
  short_description: 'Short line',
  description: 'The description shown on the page.',
  ...over,
} as Parameters<typeof injectProductBody>[1]);

const POPULATED: Row = {
  long_description: 'A longer owner description.\n\nWith a second paragraph.',
  features: ['Machine washable cover', 'Non-slip base'],
  specifications: { material: 'Recycled polyester', dimensions_cm: '60 x 45', machine_safe: true, layers: 2 },
  weight_oz: 384,
};

/** Same mapping the worker and the product page do: raw DB column names in. */
const factsFor = (over: Row): ProductFactInput => ({
  features: over.features,
  specifications: over.specifications,
  longDescription: over.long_description,
  weightOz: over.weight_oz,
  description: over.description,
});

/** Every way the catalog says "no data" for these columns. */
const EMPTY_SHAPES: Array<[string, Row]> = [
  ['absent', {}],
  ['null', { long_description: null, features: null, specifications: null, weight_oz: null }],
  ['blank strings', { long_description: '  ', features: '', specifications: '' }],
  ['empty json text', { features: '[]', specifications: '[]' }],
  ['empty containers', { features: [], specifications: {} }],
  ['blank members', { long_description: '\n\n', features: [''], specifications: { Material: '' } }],
  ['unusable weight', { weight_oz: 0 }],
];

describe('productFacts — empty is empty', () => {
  it.each(EMPTY_SHAPES)('%s produces nothing at all', (_label, over) => {
    const facts = productFacts({ ...factsFor(over), description: 'The description shown on the page.' });
    expect(hasProductFacts(facts)).toBe(false);
    expect(facts.features).toEqual([]);
    expect(facts.specifications).toEqual([]);
    expect(facts.longDescription).toBeNull();
  });

  it('every empty shape renders byte-identical crawl HTML', () => {
    const baseline = injectProductBody(SHELL, row());
    for (const [label, over] of EMPTY_SHAPES) {
      expect(injectProductBody(SHELL, row(over)), `${label} changed the HTML`).toBe(baseline);
    }
    for (const heading of ['Features', 'Specifications', 'Full description']) {
      expect(baseline.includes(heading), `empty product grew a ${heading} section`).toBe(false);
    }
  });

  it('empty facts render no React section either', () => {
    const facts = productFacts({});
    expect(renderToStaticMarkup(createElement(ProductFactSections, { facts }))).toBe('');
    expect(renderToStaticMarkup(createElement(ProductSpecRows, { facts }))).toBe('');
  });
});

describe('productFacts — nothing is guessed', () => {
  it('prints values as stored', () => {
    const facts = productFacts({ specifications: { material: 'Ceramic', layers: 3, machine_safe: false, sizes: ['S', 'M'] } });
    expect(facts.specifications).toEqual([
      { label: 'Material', value: 'Ceramic' },
      { label: 'Layers', value: '3' },
      { label: 'Machine safe', value: 'No' },
      { label: 'Sizes', value: 'S, M' },
    ]);
  });

  it('skips a nested object rather than flattening it', () => {
    const facts = productFacts({ specifications: { packing: { box: '30x20', weight: 4 }, material: 'Steel' } });
    expect(facts.specifications).toEqual([{ label: 'Material', value: 'Steel' }]);
    expect(specValue({ a: 1 })).toBe('');
    expect(specValue([{ a: 1 }])).toBe('');
    expect(specValue('')).toBe('');
    expect(specValue(Number.NaN)).toBe('');
  });

  it('formats labels without inventing units', () => {
    expect(specLabel('material')).toBe('Material');
    expect(specLabel('dimensions_cm')).toBe('Dimensions (cm)');
    expect(specLabel('max_load_lbs')).toBe('Max load (lbs)');
    expect(specLabel('pack_of')).toBe('Pack of');
    expect(specLabel('')).toBe('');
  });

  it('converts a weight only when the conversion is exact', () => {
    expect(weightFactRow(1)).toEqual({ label: 'Weight', value: '1 oz' });
    expect(weightFactRow(20)).toEqual({ label: 'Weight', value: '20 oz' });
    expect(weightFactRow(16)).toEqual({ label: 'Weight', value: '16 oz (1 lb)' });
    expect(weightFactRow(384)).toEqual({ label: 'Weight', value: '384 oz (24 lb)' });
    expect(weightFactRow(480)).toEqual({ label: 'Weight', value: '480 oz (30 lb)' });
    for (const junk of [null, undefined, '', 'abc', {}, [], 0, -3, Number.NaN]) {
      expect(weightFactRow(junk), `weight accepted ${JSON.stringify(junk)}`).toBeNull();
    }
  });

  it('never prints the description twice', () => {
    const description = 'A round, plush nest bed for cats.';
    expect(productFacts({ description, longDescription: description }).longDescription).toBeNull();
    expect(productFacts({ description, longDescription: `  ${description.toUpperCase()}  ` }).longDescription).toBeNull();
    expect(productFacts({ description, longDescription: 'Something genuinely additional.' }).longDescription)
      .toBe('Something genuinely additional.');
    expect(productFacts({ longDescription: 'Only the long one.' }).longDescription).toBe('Only the long one.');
  });

  it('reads features from arrays, JSON text and a plain string, and de-duplicates', () => {
    expect(productFacts({ features: ['A', 'A ', 'b'] }).features).toEqual(['A', 'b']);
    expect(productFacts({ features: '["A","B"]' }).features).toEqual(['A', 'B']);
    expect(productFacts({ features: 'Single hand-written line' }).features).toEqual(['Single hand-written line']);
    expect(productFacts({ features: [{ nope: 1 }, 'Ok'] }).features).toEqual(['Ok']);
    expect(productFacts({ features: 'not json [' }).features).toEqual(['not json [']);
  });

  it('puts the weight row first and de-duplicates spec labels', () => {
    const facts = productFacts({ weightOz: 480, specifications: { weight: 'ignored duplicate key', material: 'Salt' } });
    expect(facts.specifications[0]).toEqual({ label: 'Weight', value: '480 oz (30 lb)' });
    expect(facts.specifications.filter((r) => r.label === 'Weight')).toHaveLength(1);
  });
});

describe('productFacts — both renderers publish the same rows', () => {
  const facts = productFacts(factsFor(POPULATED));
  const crawled = decode(injectProductBody(SHELL, row(POPULATED)));
  const page = decode(renderToStaticMarkup(createElement('div', null,
    createElement(ProductFactSections, { facts }),
    createElement('table', null, createElement('tbody', null, createElement(ProductSpecRows, { facts }))),
  )));

  it('every fact string appears in the crawl HTML and in the hydrated DOM', () => {
    // The worker emits one <p> per line of the long description, so compare it
    // line by line — the text is the same on both sides, the wrapping differs.
    const strings = [...facts.longDescription!.split(/\n+/).filter((l) => l.trim()),
      ...facts.features, ...facts.specifications.flatMap((r) => [r.label, r.value])];
    expect(strings.length).toBeGreaterThanOrEqual(8);
    for (const s of strings) {
      expect(crawled.includes(s), `crawl HTML missing: ${s}`).toBe(true);
      expect(page.includes(s), `hydrated DOM missing: ${s}`).toBe(true);
    }
  });

  it('uses the same headings on both sides', () => {
    // The crawl HTML names all three sections. On the page the specification
    // rows live in the Specifications tab, whose label is rendered by the
    // product page itself — so here we assert the two headings the component
    // owns, and the rows above prove the rest.
    for (const heading of ['Full description', 'Features', 'Specifications']) {
      expect(crawled.includes(`<h2>${heading}</h2>`), `crawl missing heading ${heading}`).toBe(true);
    }
    for (const heading of ['Full description', 'Features']) {
      expect(page.includes(heading), `page missing heading ${heading}`).toBe(true);
    }
    // The table's accessible name must be a direct child of <table>, never of
    // <tbody> — React logged an invalid-nesting hydration error when it was not.
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).toContain('<caption className="sr-only">Specifications</caption>');
    expect(readFileSync('src/components/ProductFacts.tsx', 'utf8').includes('<caption className')).toBe(false);
  });

  it('a populated product gains real markup where an empty one gains none', () => {
    const empty = injectProductBody(SHELL, row());
    expect(crawled.length).toBeGreaterThan(empty.length);
    expect(empty.includes('384 oz')).toBe(false);
  });

  it('the unit, the label and the dedupe rule live in exactly one module', () => {
    // If a renderer starts formatting these fields itself, the two sides can
    // drift again — which is the whole point of the shared formatter.
    const factsModule = readFileSync('src/content/productFacts.ts', 'utf8');
    expect(factsModule.includes(' oz')).toBe(true);
    for (const file of ['src/components/ProductFacts.tsx', 'worker/seo-meta.ts', 'src/App.tsx']) {
      const src = readFileSync(file, 'utf8');
      expect(/['"`] ?oz['"`]/.test(src) || /\d+\s*oz\b/.test(src), `${file} formats weight itself`).toBe(false);
    }
    expect(readFileSync('worker/seo-meta.ts', 'utf8').includes('productFacts(')).toBe(true);
    expect(readFileSync('src/App.tsx', 'utf8').includes('productFacts(')).toBe(true);
  });
});
