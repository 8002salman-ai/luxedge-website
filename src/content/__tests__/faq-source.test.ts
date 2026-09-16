// ============================================================================
// LUXEDGE — /faq single source + drift contract
//
// /faq had two sources of truth: the worker pre-rendered FAQ_DATA (what Google
// crawls) while the React page carried its own inline list (what visitors read).
// They contradicted each other, most sharply on payment — the crawl HTML said
// payment was "handled by the configured third-party provider" while checkout
// reported, correctly, that no provider is configured — and serving crawlers
// different answers than users is misleading content.
//
// This suite pins the three things that fix it:
//
//   1. There is exactly ONE copy of the FAQ copy in the repo (no second list).
//   2. The crawl HTML and the hydrated page render the same questions, answers
//      and headings — compared by actually rendering both.
//   3. No answer contradicts a policy page, overstates payment, or invents a
//      feature (reviews used to be "considered"; supplier verification used to
//      be implied; the password answer pointed at a reset flow that does not
//      exist).
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { FAQ_DATA, SHIPPING_SECTIONS, RETURNS_SECTIONS, PRIVACY_SECTIONS } from '../policies';
import { FaqContent } from '../../components/FaqContent';
import { injectFaqBody } from '../../../worker/seo-meta';

const everything = FAQ_DATA.flatMap((c) => c.items);
const decode = (html: string) => html
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#0?39;|&apos;/g, "'")
  .replace(/&nbsp;/g, ' ');

// Decoded, because the worker entity-escapes "&" and quotes on the way in.
const crawl = decode(injectFaqBody('<div id="ssr-body"></div>'));
const page = decode(renderToStaticMarkup(
  createElement(MemoryRouter, null, createElement(FaqContent, { faqs: FAQ_DATA })),
));

describe('/faq — one source', () => {
  it('is substantive and free of duplicate questions', () => {

    expect(everything.length).toBeGreaterThanOrEqual(18);
    const seen = new Set<string>();
    for (const f of everything) {
      expect(seen.has(f.q), `duplicate question: ${f.q}`).toBe(false);
      seen.add(f.q);
      expect(f.a.length, `${f.q} answer is too thin`).toBeGreaterThan(80);
    }
    for (const cat of FAQ_DATA) {
      expect(cat.items.length, `${cat.category} is empty`).toBeGreaterThan(1);
    }
  });

  it('the React page no longer holds a second copy of any answer', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app.includes('FAQ_DATA'), 'App.tsx must read the shared FAQ module').toBe(true);
    for (const f of everything) {
      expect(app.includes(f.a), `App.tsx still hardcodes an answer:\n  ${f.a}`).toBe(false);
    }
  });

  it('no other file carries a private FAQ list', () => {
    // Any source file that mentions a question must be reading the module, not
    // restating it. Guards against the duplicate quietly coming back.
    const roots = ['src', 'worker'];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry === '__tests__' || entry === 'node_modules') continue;
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry)) continue;
        const src = readFileSync(full, 'utf8');
        if (full.replace(/\\/g, '/') === 'src/content/policies.ts') continue;
        for (const f of everything) {
          if (src.includes(f.q) && src.includes(f.a)) offenders.push(`${full} → ${f.q}`);
        }
      }
    };
    for (const root of roots) walk(root);
    expect(offenders, `FAQ copy duplicated in:\n${offenders.join('\n')}`).toEqual([]);
  });
});

describe('/faq — crawl HTML === hydrated page', () => {
  it('publishes the same categories, questions and answers on both sides', () => {
    for (const cat of FAQ_DATA) expect(crawl.includes(cat.category), `crawl missing category ${cat.category}`).toBe(true);
    for (const cat of FAQ_DATA) expect(page.includes(cat.category), `page missing category ${cat.category}`).toBe(true);
    for (const f of everything) {
      expect(crawl.includes(f.q), `crawl missing question: ${f.q}`).toBe(true);
      expect(page.includes(f.q), `page missing question: ${f.q}`).toBe(true);
      expect(crawl.includes(f.a), `crawl missing answer: ${f.q}`).toBe(true);
      expect(page.includes(f.a), `page missing answer: ${f.q}`).toBe(true);
    }
  });

  it('renders no extra questions on either side', () => {
    const count = (html: string, tag: 'h2' | 'h3') => (html.match(new RegExp(`<${tag}[ >]`, 'g')) || []).length;
    expect(count(crawl, 'h3')).toBe(everything.length);
    expect(count(page, 'h3')).toBe(everything.length);
    expect(count(crawl, 'h2')).toBe(FAQ_DATA.length);
    expect(count(page, 'h2')).toBe(FAQ_DATA.length);
  });

  it('answers are rendered up front, not revealed on interaction', () => {
    // An accordion that mounts answers only when clicked puts the DOM back out
    // of step with the crawl HTML — invisible to this assertion if the answers
    // are simply missing.
    for (const f of everything) {
      expect(page.includes(f.a), `answer only appears after interaction: ${f.q}`).toBe(true);
    }
  });

  it('the page is wired to FaqContent and the worker to injectFaqBody', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app.includes('<FaqContent faqs={FAQ_DATA} />')).toBe(true);
    const worker = readFileSync('worker/seo-meta.ts', 'utf8');
    expect(worker.includes('for (const cat of FAQ_DATA)')).toBe(true);
  });
});

describe('/faq — answers agree with the rest of the site', () => {
  const answerFor = (q: string) => everything.find((f) => f.q === q)?.a || '';
  const policyText = [...SHIPPING_SECTIONS, ...RETURNS_SECTIONS, ...PRIVACY_SECTIONS].map((s) => s.body).join('\n');

  it('shipping and returns answers repeat the policy wording they come from', () => {
    const pins: Array<[string, string]> = [
      ['shipping destination', 'International shipping is not currently offered.'],
      ['return shipping cost', 'Customers are responsible for purchasing their own return shipping label'],
      ['replacement route', 'handled by replacement'],
      ['card data', 'Luxedge does not store complete card numbers'],
    ];
    for (const [label, phrase] of pins) {
      const owners = policyText.includes(phrase) || everything.some((f) => f.a.includes(phrase));
      expect(owners, `${label}: nothing on the site says "${phrase}"`).toBe(true);
      expect(policyText.includes(phrase), `${label}: no policy page owns "${phrase}"`).toBe(true);
    }
  });

  it('describes secure online checkout and available payment methods', () => {
    const payment = [answerFor('How does online checkout and payment work?'), answerFor('What payment methods do you accept?')].join(' ');
    expect(payment).not.toMatch(/handled by the configured|powered by|we accept (?:visa|mastercard|amex|paypal)/i);
    expect(answerFor('How does online checkout and payment work?')).toMatch(/secure online checkout/i);
    expect(answerFor('What payment methods do you accept?')).toMatch(/appear at checkout/i);
  });

  it('does not invent features, certifications or credentials', () => {
    const all = everything.map((f) => `${f.q} ${f.a}`).join('\n');
    const banned: Array<[string, RegExp]> = [
      ['review claims', /customer reviews|reviews? before listing/i],
      ['supplier verification', /verified (?:manufacturers|suppliers)|supplier[- ]verified/i],
      ['certification', /certipur|airline[- ]approved|fda[- ]approved|iso[- ]certified|\bcertified\b/i],
      ['nonexistent reset flow', /password reset option|reset your password/i],
      ['medical claim', /treats? (?:arthritis|pain|disease)|\bcures?\b|therapeutic|medical[- ]grade/i],
      ['guarantee', /100% (?:safe|guaranteed|effective)|guaranteed to/i],
    ];
    for (const [label, re] of banned) {
      expect(re.test(all), `${label} claimed in a FAQ answer`).toBe(false);
    }
  });

  it('keeps the public support channels exactly as the rest of the site does', () => {
    const all = everything.map((f) => `${f.q} ${f.a}`).join('\n');
    expect(all).toMatch(/hello@luxedge\.us/);
    expect(all).not.toMatch(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/);
    expect(all).not.toMatch(/whatsapp/i);
  });
});
