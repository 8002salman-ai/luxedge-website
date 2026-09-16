import { afterEach, describe, expect, it, vi } from 'vitest';
import { maybeInjectSeo } from '../../../worker/seo-meta';
import { AUTHORS, authorFor } from '../authors';

/**
 * /author/<slug> is infrastructure for attribution we do not have yet: the
 * registry ships empty, so the honest state today is a 404 rather than a page
 * describing a person nobody has met. These tests publish a fixture author,
 * check both render paths agree, and then remove it again.
 */
const ORIGIN = 'https://luxedge.us';
const SHELL = '<!doctype html><head><title>Luxedge</title>'
  + '<meta name="robots" content="index, follow" /></head><div id="root"></div>';
const env = { ASSETS: { fetch: async () => new Response(SHELL) } };

afterEach(() => { AUTHORS.length = 0; vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('the author registry ships empty', () => {
  it('publishes no profile until a real person is entered', () => {
    expect(AUTHORS).toEqual([]);
    expect(authorFor('salman')).toBeUndefined();
  });

  it('answers /author/<unknown> as a noindex 404, not a placeholder page', async () => {
    const res = await maybeInjectSeo(SHELL, '/author/salman', ORIGIN, env);
    expect(res).toHaveProperty('status', 404);
    expect(res && 'html' in res && res.html).toContain('noindex, nofollow');
  });
});

describe('a published author renders from the registry', () => {
  it('pre-renders the name, bio and their articles into the server HTML', async () => {
    AUTHORS.push({
      slug: 'a-real-author',
      name: 'A Real Author',
      bio: 'Writes about pet gear they can verify.',
      links: [{ label: 'Profile', href: 'https://example.com/a' }],
    });
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      { slug: 'their-guide', title: 'Their Guide', excerpt: 'x', author_name: 'A Real Author' },
      { slug: 'someone-else', title: 'Not Theirs', excerpt: 'x', author_name: 'Luxedge Editorial Team' },
    ]))));

    const res = await maybeInjectSeo(SHELL, '/author/a-real-author', ORIGIN, env);
    expect(res).toHaveProperty('status', 200);
    const html = res && 'html' in res ? res.html : '';
    expect(html).toContain('<h1>A Real Author</h1>');
    expect(html).toContain('Writes about pet gear they can verify.');
    expect(html).toContain('href="/blog/their-guide"');
    expect(html).not.toContain('Not Theirs');
    expect(html).toContain('rel="noopener"');
  });
});
