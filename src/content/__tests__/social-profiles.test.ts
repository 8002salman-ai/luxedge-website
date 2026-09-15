import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SOCIAL_PROFILES } from '../socialProfiles';

/**
 * The footer shipped five social buttons that pointed at platform homepages
 * (https://facebook.com, https://instagram.com, https://pinterest.com,
 * https://tiktok.com) plus a placeholder YouTube URL for the owner's personal
 * channel — not one of them a Luxedge account. The owner asked for them to come
 * down until real accounts exist, so the buttons are now driven by an
 * intentionally empty SOCIAL_PROFILES list.
 *
 * These tests stop the two ways that regresses: a hardcoded link smuggled back
 * into a component, and structured data that names a profile that does not
 * exist (which is a false claim about the business, not just a dead link).
 */
const SOCIAL_DOMAINS = ['facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'pinterest.com', 'tiktok.com', 'linkedin.com'];

/** Full social URLs only — a bare "x.com" substring also matches ordinary code
 * such as `x.compareAtPrice`, which is not a social link. */
const SOCIAL_URL =
  /https?:\/\/(?:www\.)?(?:facebook|instagram|twitter|x|pinterest|tiktok|linkedin)\.com[^\s"'`)]*/gi;

/** Sharing the current page to the visitor's OWN account (sharer.php,
 * intent/tweet, share-offsite) is not a profile link: it claims nothing about
 * Luxedge having an account, so it is allowed outside the profile list. Only
 * profile/homepage links are forbidden. */
const SHARE_INTENT = /\/(sharer|intent|sharing)(\/|\b)/i;

const app = readFileSync('src/App.tsx', 'utf8');
const adminSection = readFileSync('src/admin/AdminSection.tsx', 'utf8');
const workerSeoMeta = readFileSync('worker/seo-meta.ts', 'utf8');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      // Nested worktrees are other checkouts, not this source tree.
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      sourceFiles(p, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/__tests__/.test(p)) {
      out.push(p);
    }
  }
  return out;
}

/** Path of a bare platform homepage, e.g. https://facebook.com or www.x.com/ . */
const isPlatformHomepage = (href: string): boolean =>
  SOCIAL_DOMAINS.some((d) => new RegExp(`^https?://(www\\.)?${d.replace('.', '\\.')}/?$`, 'i').test(href));

describe('social profiles — no account is advertised until it exists', () => {
  it('lists only verified account URLs, never a platform homepage', () => {
    for (const p of SOCIAL_PROFILES) {
      expect(isPlatformHomepage(p.href), `${p.label} points at a platform homepage: ${p.href}`).toBe(false);
      expect(p.href, `${p.label} is not an https account URL`).toMatch(/^https:\/\/[^/]+\/.+/);
    }
  });

  it('is currently empty, so the footer renders no social buttons at all', () => {
    expect(SOCIAL_PROFILES).toEqual([]);
  });

  it('hardcodes no social profile link anywhere in the source tree', () => {
    // socialProfiles.ts is the ONLY file allowed to name a profile destination.
    const offenders: string[] = [];
    for (const file of sourceFiles('src')) {
      const normalised = file.replace(/\\/g, '/');
      if (normalised.endsWith('src/content/socialProfiles.ts')) continue;
      for (const found of readFileSync(file, 'utf8').match(SOCIAL_URL) || []) {
        if (!SHARE_INTENT.test(found)) offenders.push(`${normalised} → ${found}`);
      }
    }
    expect(offenders, `social profile links must come from SOCIAL_PROFILES:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('renders the footer icons from the shared list behind an empty guard', () => {
    expect(app).toContain('SOCIAL_PROFILES.length > 0 &&');
    expect(app).toContain('SOCIAL_PROFILES.map((p) =>');
    expect(app).not.toContain('aria-label="Facebook"');
  });
});

describe('social profiles — structured data cannot name a fake account', () => {
  it('builds Organization sameAs from the same list, and omits it when empty', () => {
    expect(adminSection).toContain('SOCIAL_PROFILES.map((p) => p.href)');
    expect(adminSection).not.toMatch(/sameAs"?\s*:\s*\[/);
    expect(adminSection).not.toContain('twitter.com/luxedge');
  });

  it('keeps the public pre-rendered schema free of social URLs', () => {
    for (const domain of SOCIAL_DOMAINS) {
      expect(workerSeoMeta, `public schema references ${domain}`).not.toContain(domain);
    }
  });
});
