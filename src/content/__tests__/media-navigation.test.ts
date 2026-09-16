import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * /media is four 57–65 word companion pages and a 136-word hub, all noindexed.
 * It cannot be grown into substance without inventing it, and a 57-word page
 * linked from the header is the mass-produced-filler read an AdSense reviewer
 * rejects. Nothing there earns a primary-nav slot, so Media came out of the
 * header nav, the mobile drawer and the footer — while both /media routes stay
 * registered, because this is de-listing, not deleting indexed value. The
 * homepage widget still links the videos as content.
 */
const app = readFileSync('src/App.tsx', 'utf8');
const seoMeta = readFileSync('worker/seo-meta.ts', 'utf8');

describe('/media is de-listed from primary navigation', () => {
  it('has no /media link in the header nav, mobile drawer or footer', () => {
    // Exact `to="/media"` covers all three call sites; the router uses
    // path="/media", so this cannot accidentally assert the routes away.
    expect(app).not.toContain('to="/media"');
  });

  it('drops Media from the worker footer without dropping its neighbours', () => {
    const nav = seoMeta.slice(seoMeta.indexOf('const FOOTER_NAV ='), seoMeta.indexOf('</nav>', seoMeta.indexOf('const FOOTER_NAV =')));
    expect(nav).not.toContain('/media');
    expect(nav).toContain("['Blog', '/blog']");
  });

  it('keeps both /media routes registered so the URLs still resolve', () => {
    expect(app).toContain('path="/media"');
    expect(app).toContain('path="/media/:slug"');
  });
});
