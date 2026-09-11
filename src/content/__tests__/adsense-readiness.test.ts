import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanAllEditorial, type ScannableEditorial } from '../editorialSafety';

const root = process.cwd();
const read = (file: string) => readFileSync(resolve(root, file), 'utf8');

/**
 * Extract the INIT_BLOGS array literal from src/App.tsx and evaluate it —
 * same technique as scripts/extract-blog-seo.mjs. Everything after the
 * `return` in the constructed function is unreachable, so trailing
 * declarations (SAFE_INIT_BLOGS, CAT_LIST) never execute.
 */
function extractInitBlogs(): ScannableEditorial[] {
  const source = read('src/App.tsx');
  const start = source.indexOf('const INIT_BLOGS');
  const assign = source.indexOf('= [', start);
  const arrOpen = assign >= 0 ? assign + 2 : source.indexOf('[', start);
  if (arrOpen < 0 || source[arrOpen] !== '[') throw new Error('could not locate INIT_BLOGS array');
  const after = source.indexOf('export const CAT_LIST', start);
  const slice = source.slice(arrOpen, after > arrOpen ? after : source.length).replace(/;\s*$/, '').trim();
  // eslint-disable-next-line no-new-func
  const posts = new Function(`return ${slice}`)();
  if (!Array.isArray(posts)) throw new Error('INIT_BLOGS did not evaluate to an array');
  return posts as ScannableEditorial[];
}

function formatHits(hits: ReturnType<typeof scanAllEditorial>): string {
  return hits.map((h) => `  ${h.slug} [${h.field}] ${h.label}: "${h.sentence}"`).join('\n');
}

describe('AdSense-readiness remediation', () => {
  it('keeps AdSense enabled while retaining only the disabled Adsterra config sentinel', () => {
    const config = JSON.parse(read('public/site-config.json')) as Record<string, unknown>;
    expect(config.adsenseEnabled).toBe(true);
    expect(config.adsterraEnabled).toBe(false);
    expect(config).not.toHaveProperty('adsterraZoneUrl');
    expect(config).not.toHaveProperty('adsterraContainerId');
  });

  it('has no Adsterra runtime or CSP permission while retaining the AdSense host', () => {
    const cspSource = read('worker/seo-meta.ts');
    expect(cspSource).toContain('pagead2.googlesyndication.com');
    expect(cspSource).not.toMatch(/adsterra|profitableratecpmnetwork/i);
    expect(read('src/App.tsx')).not.toContain('AdsterraAd');
    expect(read('src/pages/BlogPages.tsx')).not.toContain('AdsterraAd');
    expect(() => read('src/components/AdsterraAd.tsx')).toThrow();
  });

  it('submits the contact form to the real, rate-limited endpoint (no fake success)', () => {
    const contactSource = read('src/App.tsx');
    expect(contactSource).toContain("fetch('/api/email/contact'");
    // No dead-end copy claiming the form is disconnected.
    expect(contactSource).not.toContain('This form is not connected to a support inbox');
    // Success is only ever set from the server response — no fake client-side success.
    expect(contactSource).not.toContain("notify('Message sent!')");
    expect(contactSource).not.toContain('Message Received!');
    expect(contactSource).toContain('Sending…');
  });

  it('keeps the contact endpoint server-side guarded: rate-limited, honeypot, topic allowlist', () => {
    const contactSource = read('api/email/contact.ts');
    expect(contactSource).toContain('SEND_MAIL');
    expect(contactSource).toContain('hello@luxedge.us');
    expect(contactSource).toContain('contactRateLimited');
    expect(contactSource).toContain('website');
    expect(contactSource).toContain("'Order Question'");
    expect(contactSource).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  describe('risk-pattern claim scan over all editorial content', () => {
    const registry = JSON.parse(read('public/blog-seo.json')) as { posts: ScannableEditorial[] };

    it('flags no unsupported medical/safety claims in public/blog-seo.json', () => {
      const hits = scanAllEditorial(registry.posts);
      expect(hits, `blog-seo.json risk-pattern scan found:\n${formatHits(hits)}`).toEqual([]);
    });

    it('flags no unsupported medical/safety claims in INIT_BLOGS (src/App.tsx)', () => {
      const hits = scanAllEditorial(extractInitBlogs());
      expect(hits, `INIT_BLOGS risk-pattern scan found:\n${formatHits(hits)}`).toEqual([]);
    });

    it('ships the softened copy as the single source of truth (no runtime rewrite)', () => {
      // The scan above already guarantees the committed copy is clean; this
      // guards that no one reintroduces a runtime phrase rewrite that lets a
      // future consumer of the raw files read unsupported claims.
      expect(read('src/App.tsx')).not.toContain('softenFallbackEditorial');
      expect(read('worker/seo-meta.ts')).not.toContain('softenFallbackEditorial');
    });

    it('keeps previously denylisted phrasings out of the committed copy', () => {
      const registryText = read('public/blog-seo.json');
      const appText = read('src/App.tsx');
      for (const bad of [
        'non-toxic',
        'chew-resistant',
        'prevents bloating',
        'reduces stress',
        'supports growing joints',
        'Joint-supporting memory foam',
        'constant hydration',
        'clean teeth',
        'proven tricks',
        'prevents stones',
      ]) {
        expect(appText, `INIT_BLOGS still contains "${bad}"`).not.toContain(bad);
        expect(registryText, `blog-seo.json still contains "${bad}"`).not.toContain(bad);
      }
    });
  });
});