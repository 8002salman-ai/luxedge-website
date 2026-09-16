import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { CONTACT_INFO, FAQ_DATA, PRIVACY_SECTIONS, TERMS_SECTIONS, RETURNS_SECTIONS, COPYRIGHT_SECTIONS } from '../policies';
import { ABOUT_SECTIONS } from '../about';
import { CONTACT_SECTIONS } from '../sitePages';

/**
 * History of the support contact, so nobody re-litigates it from git:
 *
 * 1. The phone number and street address used to be published everywhere —
 *    footer, policies, FAQ, About, crawl HTML, Organization schema, WhatsApp
 *    button. An earlier owner request removed them (commits c57739c and
 *    4bf7e04) and released the phone only to signed-in customers with an order
 *    via a gated endpoint.
 * 2. A later owner request RESTORED both: the phone and the street address are
 *    public contact details again, and the gating endpoint was deleted.
 *
 * Current owner rule (what these tests pin):
 *   - phone (440) 941-8002 and 1500 N Grant St are published in the shared
 *     contact surfaces: CONTACT_INFO, the contact page cards, the policies'
 *     "Contact Us" lines, the FAQ answer, the Organization schema and the
 *     worker's pre-rendered /contact HTML.
 *   - The gated /api/support/contact endpoint must NOT come back: the number is
 *     public now, so a second hidden release path would drift from CONTACT_INFO.
 *   - The WhatsApp floating button stays removed (a separate, earlier request).
 *     Assistant/CRM copy may mention WhatsApp only as a channel name with the
 *     public support number.
 */
const PHONE = /\(440\) 941-8002/;
const STREET = /1500 N Grant St/;

const app = readFileSync('src/App.tsx', 'utf8');
const workerSeoMeta = readFileSync('worker/seo-meta.ts', 'utf8');
const workerIndex = readFileSync('worker/index.ts', 'utf8');

describe('support phone and street address — public again', () => {
  it('CONTACT_INFO carries email, phone and the full street address', () => {
    expect(CONTACT_INFO.map((c) => c.label)).toEqual(['Email', 'Phone', 'Address', 'Hours']);
    expect(CONTACT_INFO.find((c) => c.label === 'Phone')?.value).toBe('(440) 941-8002');
    expect(CONTACT_INFO.find((c) => c.label === 'Address')?.value).toBe('1500 N Grant St, Denver, CO 80203');
  });

  it('policy copy publishes both, consistently', () => {
    const bodies = [
      ...PRIVACY_SECTIONS, ...TERMS_SECTIONS, ...RETURNS_SECTIONS, ...COPYRIGHT_SECTIONS,
      ...ABOUT_SECTIONS.map((s) => ({ title: s.title, body: s.body })),
      ...FAQ_DATA.flatMap((c) => c.items.map((i) => ({ title: i.q, body: i.a }))),
    ].map((s) => `${s.title} ${s.body}`).join('\n');
    expect(bodies).toMatch(PHONE);
    expect(bodies).toMatch(STREET);
    // No gated-release wording may survive anywhere in public copy.
    expect(bodies).not.toMatch(/customers? with an order|placed an order.*phone line|phone line for order support/i);
  });

  it('the React contact page shows the phone card and the street address', () => {
    expect(app).toMatch(PHONE);
    expect(app).toMatch(STREET);
    expect(app).toContain("{ i: Phone, l: 'Phone', v: '(440) 941-8002', s: 'Mon-Fri, 9AM-6PM CT' }");
    expect(app).toContain("{ i: MarkerPin01, l: 'Address', v: '1500 N Grant St, Denver, CO 80203', s: 'United States' }");
  });

  it('the worker pre-render and the Organization schema publish both', () => {
    // Crawl HTML for /contact carries the phone line and renders the shared
    // sections, whose Business-details paragraph carries the street address.
    expect(workerSeoMeta).toContain('Phone: (440) 941-8002');
    expect(workerSeoMeta).toContain('renderSiteSections(CONTACT_SECTIONS)');
    expect(CONTACT_SECTIONS.map((s) => [...(s.paragraphs ?? []), ...(s.bullets ?? [])].join(' ')).join(' ')).toMatch(STREET);
    // Schema: telephone back on the ContactPoint; streetAddress back on the
    // PostalAddress. The static shell in index.html mirrors the same block.
    expect(workerSeoMeta).toContain("telephone: '+1-440-941-8002'");
    expect(workerSeoMeta).toContain("streetAddress: '1500 N Grant St'");
    const shell = readFileSync('index.html', 'utf8');
    expect(shell).toContain('"telephone": "+1-440-941-8002"');
    expect(shell).toContain('"streetAddress": "1500 N Grant St"');
  });

  it('is not repeated nowhere — the gating endpoint must stay deleted', () => {
    expect(existsSync('api/support/contact.ts')).toBe(false);
    expect(workerIndex).not.toContain('api/support/contact');
    expect(workerIndex).not.toContain('SUPPORT_PHONE');
  });
});

describe('support contact — removed surfaces stay removed', () => {
  it('the WhatsApp floating button is not rendered anywhere', () => {
    expect(existsSync('src/components/WhatsAppButton.tsx')).toBe(false);
    expect(app).not.toContain('<WhatsAppButton');
    expect(app).not.toContain('components/WhatsAppButton');
  });

  it('assistant/CRM fallback copy mentions WhatsApp only as a channel with the public number', () => {
    const assistant = readFileSync('src/components/AIAssistant.tsx', 'utf8');
    const crm = readFileSync('api/crm/assistant.ts', 'utf8');
    // Channel name is allowed; a raw wa.me deep link carrying the number is not.
    expect(assistant).not.toMatch(/wa\.me\/\d/);
    expect(crm).not.toMatch(/wa\.me\/\d/);
  });

  it('no gated-release plumbing ships in the client bundle', () => {
    expect(existsSync('src/services/support.ts')).toBe(false);
    expect(existsSync('src/hooks/useSupportContact.ts')).toBe(false);
    expect(app).not.toContain('useSupportContact');
    expect(app).not.toContain('SUPPORT_CUSTOMER_ONLY_NOTE');
    expect(app).not.toContain('supportMailto');
  });
});
