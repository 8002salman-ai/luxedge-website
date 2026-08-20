// ============================================================================
// LUXEDGE V2 — PHASE 4G.1 ROUTE TESTS: /api/market-demand/google-ads
//
// G) 6 unique input keywords → server rejects, does NOT silently truncate
// J) not configured → route returns not_configured, zero outbound Google calls
// ============================================================================

import { EventEmitter } from 'node:events';
import { createHmac } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import handler from '../google-ads.js';

const SECRET = '0123456789abcdef0123456789abcdef';
const originalSecret = process.env.SUPABASE_JWT_SECRET;

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function signToken(payload: Record<string, unknown>): string {
  const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

const futureExp = Math.floor(Date.now() / 1000) + 3600;
const adminToken = signToken({ sub: 'adm-1', app_metadata: { role: 'admin' }, exp: futureExp });

function mockReq(method: string, headers: Record<string, string> = {}, body = '', url = '/?action=health'): IncomingMessage {
  const req = new EventEmitter() as unknown as IncomingMessage & EventEmitter;
  (req as unknown as Record<string, unknown>).method = method;
  (req as unknown as Record<string, unknown>).headers = headers;
  (req as unknown as Record<string, unknown>).url = url;
  (req as unknown as Record<string, unknown>).socket = { remoteAddress: '127.0.0.1' };
  process.nextTick(() => {
    if (body) req.emit('data', Buffer.from(body));
    req.emit('end');
  });
  return req;
}

function mockRes(): ServerResponse & { _body: string } {
  const res = new EventEmitter() as unknown as ServerResponse & { _body: string };
  (res as unknown as Record<string, unknown>).statusCode = 0;
  (res as unknown as Record<string, unknown>).setHeader = vi.fn();
  (res as unknown as Record<string, unknown>).end = ((payload: string) => {
    res._body = payload;
  }) as unknown as ServerResponse['end'];
  return res;
}

function statusOf(res: ServerResponse & { _body: string }): number {
  return (res as unknown as { statusCode: number }).statusCode;
}

function bodyOf(res: ServerResponse & { _body: string }): Record<string, unknown> {
  try {
    return JSON.parse(res._body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const FIXTURE_ENV_KEYS = [
  'GOOGLE_ADS_DEVELOPER_TOKEN',
  'GOOGLE_ADS_CLIENT_ID',
  'GOOGLE_ADS_CLIENT_SECRET',
  'GOOGLE_ADS_REFRESH_TOKEN',
  'GOOGLE_ADS_CUSTOMER_ID',
  'GOOGLE_ADS_LOGIN_CUSTOMER_ID',
];

beforeEach(() => {
  process.env.SUPABASE_JWT_SECRET = SECRET;
  // Ensure no Google credentials are configured in these route tests — we
  // assert not_configured behavior and zero outbound calls.
  for (const k of FIXTURE_ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.SUPABASE_JWT_SECRET;
  else process.env.SUPABASE_JWT_SECRET = originalSecret;
  for (const k of FIXTURE_ENV_KEYS) delete process.env[k];
});

describe('/api/market-demand/google-ads route', () => {
  it('G) 6 unique keywords → HTTP 400 MAX_KEYWORDS_EXCEEDED (never silently truncated)', async () => {
    const req = mockReq('POST', { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      JSON.stringify({ keywords: ['a', 'b', 'c', 'd', 'e', 'f'], market: 'US', language: 'en' }),
      '/?action=historical-metrics');
    const res = mockRes();
    await handler(req, res);
    expect(statusOf(res)).toBe(400);
    const body = bodyOf(res);
    expect(body.errorCode).toBe('MAX_KEYWORDS_EXCEEDED');
    expect(String(body.error)).toContain('received 6');
  });

  it('G2) exactly 5 keywords is allowed past validation (not_configured path — zero Google calls)', async () => {
    const req = mockReq('POST', { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      JSON.stringify({ keywords: ['a', 'b', 'c', 'd', 'e'], market: 'US', language: 'en' }),
      '/?action=historical-metrics');
    const res = mockRes();
    await handler(req, res);
    expect(statusOf(res)).toBe(200);
    const body = bodyOf(res);
    expect(body.status).toBe('not_configured');
    expect(body.keywordsRequested).toBe(5);
    expect(body.keywordsReturned).toBe(0);
  });

  it('J) not configured → health reports not_configured (never ONLINE from env presence)', async () => {
    const req = mockReq('GET', { authorization: `Bearer ${adminToken}` }, '');
    const res = mockRes();
    await handler(req, res);
    expect(statusOf(res)).toBe(200);
    const body = bodyOf(res);
    expect(body.provider).toBe('google-ads');
    expect(body.health).toBe('not_configured');
  });

  it('J2) not configured → historical-metrics returns not_configured with ZERO outbound Google calls', async () => {
    const req = mockReq('POST', { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      JSON.stringify({ keywords: ['dog ramp'], market: 'US', language: 'en' }),
      '/?action=historical-metrics');
    const res = mockRes();
    await handler(req, res);
    expect(statusOf(res)).toBe(200);
    const body = bodyOf(res);
    expect(body.status).toBe('not_configured');
    expect(body.keywordsReturned).toBe(0);
    expect(body.results).toEqual([]);
    // The not_configured path never performs OAuth or a Google API call.
    expect(JSON.stringify(body)).not.toContain('access_token');
    expect(JSON.stringify(body)).not.toContain('oauth2');
    expect(JSON.stringify(body)).not.toContain('googleads.googleapis.com');
  });

  it('rejects non-USA market and non-English language', async () => {
    const req = mockReq('POST', { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      JSON.stringify({ keywords: ['dog ramp'], market: 'CA', language: 'en' }),
      '/?action=historical-metrics');
    const res = mockRes();
    await handler(req, res);
    expect(statusOf(res)).toBe(400);
    expect(String(bodyOf(res).error)).toContain('USA only');

    const req2 = mockReq('POST', { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      JSON.stringify({ keywords: ['dog ramp'], market: 'US', language: 'fr' }),
      '/?action=historical-metrics');
    const res2 = mockRes();
    await handler(req2, res2);
    expect(statusOf(res2)).toBe(400);
    expect(String(bodyOf(res2).error)).toContain('English only');
  });

  it('requires admin JWT (401 without auth)', async () => {
    const req = mockReq('GET', {}, '');
    const res = mockRes();
    await handler(req, res);
    expect(statusOf(res)).toBe(401);
  });
});
