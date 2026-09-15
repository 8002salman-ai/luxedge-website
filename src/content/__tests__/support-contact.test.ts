import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CONTACT_INFO, FAQ_DATA, PRIVACY_SECTIONS, TERMS_SECTIONS, RETURNS_SECTIONS, COPYRIGHT_SECTIONS } from '../policies';
import { ABOUT_SECTIONS } from '../about';

/**
 * The support phone number used to be published everywhere: the footer, every
 * policy page, the FAQ, the About page, the pre-rendered crawl HTML, the
 * Organization schema, the AI assistant's failure messages and a floating
 * WhatsApp button. The owner's rule is now:
 *
 *   public contact = EMAIL ONLY
 *   phone = released only to a signed-in customer who has placed an order
 *
 * "Customers only" is only true if the number is absent from everything the
 * browser downloads, so these tests scan the tree that ships to the browser and
 * fail on the digits themselves — not merely on where they are rendered.
 */
const DIGITS = /941[\s-]?8002|9418002/;

const app = readFileSync('src/App.tsx', 'utf8');
const workerSeoMeta = readFileSync('worker/seo-meta.ts', 'utf8');
const workerIndex = readFileSync('worker/index.ts', 'utf8');
const supportApi = readFileSync('api/support/contact.ts', 'utf8');

/** Only api/support/contact.ts is allowed to name the number, and it is server-only. */
const ALLOWED_PHONE_FILE = 'api/support/contact.ts';

function filesUnder(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      filesUnder(p, out);
    } else if (/\.(ts|tsx|mjs|js|json|html)$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

describe('support phone — never public', () => {
  it('appears nowhere in the code that ships to the browser', () => {
    const offenders: string[] = [];
    // index.html is the shell every route is served from — a phone number left
    // in its static structured data ships on every page load, which is exactly
    // how this one stayed public after the React pages were cleaned up.
    const roots = ['index.html'];
    for (const file of [...roots, ...filesUnder('src'), ...filesUnder('worker'), ...filesUnder('public')]) {
      const normalised = file.replace(/\\/g, '/');
      if (normalised.endsWith(ALLOWED_PHONE_FILE)) continue;
      // Test files must contain the digits to search for them.
      if (normalised.includes('__tests__')) continue;
      if (DIGITS.test(readFileSync(file, 'utf8'))) offenders.push(normalised);
    }
    expect(offenders, `the support number must not ship in client code:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('lives only in the server-side endpoint', () => {
    expect(existsSync(ALLOWED_PHONE_FILE)).toBe(true);
    expect(DIGITS.test(supportApi)).toBe(true);
    // A node:http handler — never imported from src/, so Vite cannot bundle it.
    expect(supportApi).toContain("from 'node:http'");
    expect(app).not.toContain('api/support/contact.ts');
  });

  it('is not repeated across the public policy copy', () => {
    const bodies = [
      ...PRIVACY_SECTIONS, ...TERMS_SECTIONS, ...RETURNS_SECTIONS, ...COPYRIGHT_SECTIONS,
      ...ABOUT_SECTIONS.map((s) => ({ title: s.title, body: s.body })),
      ...FAQ_DATA.flatMap((c) => c.items.map((i) => ({ title: i.q, body: i.a }))),
    ].map((s) => `${s.title} ${s.body}`).join('\n');
    expect(DIGITS.test(bodies)).toBe(false);
    expect(bodies).not.toMatch(/\bcall \(/i);
  });

  it('is not a public contact detail on the contact page', () => {
    expect(CONTACT_INFO.some((c) => /phone/i.test(c.label))).toBe(false);
    expect(CONTACT_INFO.some((c) => c.value === 'hello@luxedge.us')).toBe(true);
  });

  it('is absent from the pre-rendered crawl HTML and the Organization schema', () => {
    expect(DIGITS.test(workerSeoMeta)).toBe(false);
    // The schema must not publish it either: telephone in structured data would
    // both expose the number and contradict the email-only contact policy.
    // A phone property as a JSON key — the DMCA section may still ask a
    // complainant for THEIR telephone number, which is unrelated.
    expect(workerSeoMeta).not.toMatch(/telephone\s*:/);
    expect(workerSeoMeta).toContain('Email: <a href="mailto:hello@luxedge.us">hello@luxedge.us</a>');
  });
});

describe('support phone — static shell', () => {
  it('is absent from the HTML every page is served from', () => {
    const shell = readFileSync('index.html', 'utf8');
    expect(DIGITS.test(shell)).toBe(false);
    expect(shell).not.toMatch(/telephone\s*:/);
    // The Organization block still identifies the business honestly.
    expect(shell).toContain('"email": "hello@luxedge.us"');
    expect(shell).toContain('"sameAs": []');
  });
});

describe('support phone — customer gating', () => {
  it('requires a verified session, not a client-supplied identifier', () => {
    expect(supportApi).toContain('userAuth(req)');
    expect(supportApi).toContain('auth.payload.email');
    // Never read eligibility from the request.
    expect(supportApi).not.toMatch(/searchParams\.get\('email'\)/);
  });

  it('requires real order evidence before releasing the number', () => {
    expect(supportApi).toContain('hasPlacedOrder');
    expect(supportApi).toContain('luxedge_orders');
    expect(supportApi).toContain('customer_email=ilike');
    expect(supportApi).toContain('SUPPORT_PHONE');
  });

  it('fails closed when order lookup is not configured', () => {
    expect(supportApi).toMatch(/if \(!key\)[\s\S]*?503/);
  });

  it('is registered as a worker API route', () => {
    expect(workerIndex).toContain("path: '/api/support/contact'");
    expect(workerIndex).toContain('supportContactHandler');
  });

  it('is fetched by the client instead of hardcoded', () => {
    const service = readFileSync('src/services/support.ts', 'utf8');
    expect(service).toContain("fetch('/api/support/contact'");
    expect(DIGITS.test(service)).toBe(false);
    expect(service).toContain('SUPPORT_EMAIL');
  });

  it('does not publish the number to signed-out visitors', () => {
    const hook = readFileSync('src/hooks/useSupportContact.ts', 'utf8');
    expect(hook).toMatch(/if \(!ready \|\| !user\)/);
    expect(DIGITS.test(hook)).toBe(false);
  });
});

describe('public address — street line not published', () => {
  it('is gone from every file that ships', () => {
    const offenders: string[] = [];
    for (const file of ['index.html', ...filesUnder('src'), ...filesUnder('worker'), ...filesUnder('public')]) {
      const normalised = file.replace(/\\/g, '/');
      if (normalised.includes('__tests__')) continue;
      // Any street-style line for the business's own address: a leading number
      // followed by a street name, which is what the owner asked to withdraw.
      if (/1500 N Grant|\b\d+\s+N\s+Grant\b/.test(readFileSync(file, 'utf8'))) offenders.push(normalised);
    }
    expect(offenders, `the street address must not ship:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('keeps city/state/ZIP so the business is still identified', () => {
    const address = CONTACT_INFO.find((c) => c.label === 'Address');
    expect(address?.value).toBe('Denver, CO 80203');
    expect(PRIVACY_SECTIONS[0].body).toContain('Embani LLC, Denver, CO 80203');
  });

  it('publishes no streetAddress in structured data', () => {
    expect(readFileSync('index.html', 'utf8')).not.toContain('streetAddress');
    expect(workerSeoMeta).not.toContain('streetAddress');
    // The PostalAddress is still valid and complete enough to identify the business.
    expect(workerSeoMeta).toContain("addressLocality: 'Denver'");
    expect(readFileSync('index.html', 'utf8')).toContain('"addressLocality": "Denver"');
  });
});

describe('WhatsApp button — removed', () => {
  it('no longer exists as a component', () => {
    expect(existsSync('src/components/WhatsAppButton.tsx')).toBe(false);
  });

  it('is not rendered anywhere', () => {
    expect(app).not.toContain('<WhatsAppButton');
    expect(app).not.toContain('components/WhatsAppButton');
  });

  it('is not offered as a contact channel in the assistant or CRM copy', () => {
    const assistant = readFileSync('src/components/AIAssistant.tsx', 'utf8');
    const crm = readFileSync('api/crm/assistant.ts', 'utf8');
    expect(assistant).not.toContain('WhatsApp');
    expect(crm).not.toContain('WhatsApp');
    // A wa.me link carrying a phone number is the thing being removed.
    expect(assistant).not.toMatch(/wa\.me\/\d/);
    expect(crm).not.toMatch(/wa\.me\/\d/);
  });
});
