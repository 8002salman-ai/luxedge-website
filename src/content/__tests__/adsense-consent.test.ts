import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * AdSense consent pipeline regressions (EEA/UK/Switzerland readiness).
 *
 * Google requires two things of sites serving ads in the EEA/UK/Switzerland:
 *   1. Consent Mode v2 signals (ad_storage, ad_user_data, ad_personalization,
 *      analytics_storage) must DEFAULT TO DENIED before any Google tag loads.
 *   2. The ad script must not personalize or read/write ad cookies without
 *      consent, and EEA traffic must run under a Google-certified CMP.
 *
 * The pipeline implemented here:
 *   shell <head> bootstrap  → sets denied defaults before any Google tag
 *   src/lib/consent.ts      → module-init defaults + decision sync
 *   src/lib/marketing.ts    → loadAdSenseScript refuses to load without
 *                             'accepted' and removes any existing tag
 *   MarketingManager        → re-syncs signals and removes the shell tag when
 *                             consent is missing/declined
 *   CookieConsent           → the single first-party consent surface
 *
 * A Google-certified CMP, once connected, must drive the SAME signals in
 * src/lib/consent.ts — these tests guard the contract it has to keep.
 */

const root = process.cwd();
const read = (file: string) => readFileSync(resolve(root, file), 'utf8');

const CONSENT_SIGNALS = ['ad_storage', 'ad_user_data', 'ad_personalization', 'analytics_storage'];

describe('AdSense consent pipeline (Consent Mode v2)', () => {
  it('shell <head> sets denied defaults before the publisher script tag', () => {
    const html = read('index.html');
    const bootstrap = html.indexOf("gtag('consent', 'default'");
    const scriptTag = html.indexOf('adsbygoogle-script');
    expect(bootstrap, 'shell must carry a consent-default bootstrap').toBeGreaterThan(-1);
    expect(scriptTag).toBeGreaterThan(-1);
    expect(bootstrap).toBeLessThan(scriptTag);
    for (const signal of CONSENT_SIGNALS) {
      expect(html).toContain(`${signal}: 'denied'`);
    }
  });

  it('consent.ts defaults to denied and syncs the decision', () => {
    const src = read('src/lib/consent.ts');
    for (const signal of CONSENT_SIGNALS) {
      expect(src).toContain(`${signal}: 'denied'`);
      expect(src).toContain(`${signal}: 'granted'`);
    }
    expect(src).toContain("w.gtag('consent', 'default', state)");
  });

  it('loadAdSenseScript refuses to load without accepted consent and cleans up', () => {
    const src = read('src/lib/marketing.ts');
    const fn = src.slice(src.indexOf('export function loadAdSenseScript'), src.indexOf('export function removeAdSenseScript'));
    expect(fn).toContain("getConsent() !== 'accepted'");
    expect(fn).toContain('removeAdSenseScript()');
  });

  it('MarketingManager re-syncs consent signals and removes the shell tag when unconsented', () => {
    const src = read('src/components/MarketingManager.tsx');
    expect(src).toContain('syncConsentMode(getConsent())');
    expect(src).toContain('removeAdSenseScript()');
  });

  it('keeps exactly one consent surface and one decision store', () => {
    // One banner component; the Consent Mode plumbing lives in lib/consent.ts,
    // not duplicated in the component or a second storage key.
    expect(read('src/components/CookieConsent.tsx')).toContain("import { getConsent, setConsent } from '../lib/consent'");
    const consentSrc = read('src/lib/consent.ts');
    expect(consentSrc.match(/CONSENT_KEY = '/g)?.length).toBe(1);
  });

  it('privacy policy discloses the consent signals and the EEA/UK/CH CMP path', () => {
    const src = read('src/content/policies.ts');
    expect(src).toContain('Consent Mode');
    expect(src).toContain('advertising storage, advertising personalization, advertising measurement, and analytics storage');
    expect(src).toContain('certification requirements');
  });

  it('ads.txt keeps the verified publisher line', () => {
    expect(read('public/ads.txt')).toContain('google.com, pub-5473713135927706, DIRECT, f08c47fec0942fa0');
  });
});
