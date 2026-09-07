// ============================================================================
// LUXEDGE — Shippo helper unit tests (pure normalization + validation logic)
// ============================================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  normalizeUsState,
  formatUsPostalCode,
  isLikelyUsZip,
  normalizeShippingAddress,
  basicValidation,
  validateShippingAddress,
  normalizeCountry,
} from '../shippo.js';

const original = { key: process.env.SHIPPO_API_KEY };

afterEach(() => {
  if (original.key === undefined) delete process.env.SHIPPO_API_KEY; else process.env.SHIPPO_API_KEY = original.key;
  vi.unstubAllGlobals();
});

describe('shippo US normalization helpers', () => {
  it('normalizes full state names and 9-digit ZIPs', () => {
    expect(normalizeUsState('texas')).toBe('TX');
    expect(normalizeUsState('New York')).toBe('NY');
    expect(normalizeUsState('zz')).toBe('ZZ');
    expect(formatUsPostalCode('750381234')).toBe('75038-1234');
    expect(formatUsPostalCode('75038')).toBe('75038');
    expect(isLikelyUsZip('75038')).toBe(true);
    expect(isLikelyUsZip('75038-1234')).toBe(true);
    expect(isLikelyUsZip('abcde')).toBe(false);
  });

  it('normalizes a shipping address (US state/ZIP only)', () => {
    const n = normalizeShippingAddress({
      fullName: ' Ada Lovelace ',
      addressLine1: ' 12 Woof Lane ',
      city: ' austin ',
      state: 'texas',
      postalCode: ' 78701 ',
      country: 'United States',
    });
    expect(n.state).toBe('TX');
    expect(n.postalCode).toBe('78701');
    expect(n.country).toBe('US');
    expect(normalizeCountry('CA')).toBe('CA');
    expect(normalizeCountry('Canada')).toBe('CA');
  });

  it('basicValidation catches clearly invalid US addresses without Shippo', () => {
    const bad = basicValidation({
      fullName: 'Ada', addressLine1: '12 Woof Lane', city: 'Austin', state: 'TX', postalCode: '12', country: 'US',
    });
    expect(bad.isValid).toBe(false);
    expect(bad.source).toBe('basic');
    expect(bad.messages.some((m) => /ZIP/i.test(m))).toBe(true);
    const good = basicValidation({
      fullName: 'Ada', addressLine1: '12 Woof Lane', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US',
    });
    expect(good.isValid).toBe(true);
  });

  it('validateShippingAddress falls back to basic when Shippo is not configured', async () => {
    delete process.env.SHIPPO_API_KEY;
    const r = await validateShippingAddress({
      fullName: 'Ada', addressLine1: '12 Woof Lane', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US',
    });
    expect(r.source).toBe('basic');
    expect(r.configured).toBe(false);
    expect(r.isValid).toBe(true);
  });
});

describe('validateShippingAddress with Shippo configured', () => {
  beforeEach(() => { process.env.SHIPPO_API_KEY = 'shippo_test_abc'; });

  it('returns a recommended address when Shippo corrects the street', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      street1: '12 WOOF LANE',
      city: 'AUSTIN',
      state: 'TX',
      zip: '78701-1234',
      country: 'US',
      validation_results: { is_valid: true, messages: [] },
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const r = await validateShippingAddress({
      fullName: 'Ada', addressLine1: '12 Woof Ln', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US',
    });
    expect(r.source).toBe('shippo');
    expect(r.configured).toBe(true);
    expect(r.isValid).toBe(true);
    expect(r.recommendedAddress).toBeDefined();
    expect(r.recommendedAddress?.addressLine1).toContain('WOOF');
  });

  it('reports invalid + messages when Shippo validation fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      street1: '999 NOPE ST',
      city: 'NOWHERE',
      state: 'ZZ',
      zip: '99999',
      validation_results: { is_valid: false, messages: [{ text: 'The address could not be verified.' }] },
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const r = await validateShippingAddress({
      fullName: 'Ada', addressLine1: '999 NOPE ST', city: 'Nowhere', state: 'ZZ', postalCode: '99999', country: 'US',
    });
    expect(r.source).toBe('shippo');
    expect(r.isValid).toBe(false);
    expect(r.messages.length).toBeGreaterThan(0);
  });
});
