import { EventEmitter } from 'node:events';
import { createHmac } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import handler from '../generate';
import fetchPageHandler from '../../fetch-page';

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
const buyerToken = signToken({ sub: 'buy-1', exp: futureExp });

function mockReq(method: string, headers: Record<string, string> = {}, body = ''): IncomingMessage {
  const req = new EventEmitter() as unknown as IncomingMessage & EventEmitter;
  (req as unknown as Record<string, unknown>).method = method;
  (req as unknown as Record<string, unknown>).headers = headers;
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

describe('/api/ai/generate handler', () => {
  beforeEach(() => {
    process.env.SUPABASE_JWT_SECRET = SECRET;
  });
  afterEach(() => {
    if (originalSecret === undefined) delete process.env.SUPABASE_JWT_SECRET;
    else process.env.SUPABASE_JWT_SECRET = originalSecret;
  });

  it('rejects non-POST methods with 405', async () => {
    const res = mockRes();
    await handler(mockReq('GET'), res);
    expect(statusOf(res)).toBe(405);
  });

  it('returns 401 without an Authorization header', async () => {
    const res = mockRes();
    await handler(mockReq('POST', { 'content-type': 'application/json' }, JSON.stringify({ provider: 'openai', prompt: 'hi' })), res);
    expect(statusOf(res)).toBe(401);
    expect(res._body).toContain('Unauthorized');
  });

  it('returns 403 for a valid non-admin token', async () => {
    const res = mockRes();
    await handler(mockReq('POST', { authorization: `Bearer ${buyerToken}` }, JSON.stringify({ provider: 'openai', prompt: 'hi' })), res);
    expect(statusOf(res)).toBe(403);
    expect(res._body).toContain('Forbidden');
  });

  it('returns 503 when the JWT secret is not configured (fail closed)', async () => {
    // .env may provide VITE_SUPABASE_* — clear them so no remote path exists.
    delete process.env.SUPABASE_JWT_SECRET;
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.VITE_SUPABASE_ANON_KEY;
    const res = mockRes();
    await handler(mockReq('POST', { authorization: `Bearer ${adminToken}` }, JSON.stringify({ provider: 'openai', prompt: 'hi' })), res);
    expect(statusOf(res)).toBe(503);
  });

  it('allows an admin token through to provider validation (501 for unconfigured provider)', async () => {
    const res = mockRes();
    await handler(mockReq('POST', { authorization: `Bearer ${adminToken}` }, JSON.stringify({ provider: 'openai', prompt: 'hi' })), res);
    expect(statusOf(res)).toBe(501);
    expect(res._body).toContain('not configured');
  });

  it('rejects malformed JSON with 400 even for admins', async () => {
    const res = mockRes();
    await handler(mockReq('POST', { authorization: `Bearer ${adminToken}` }, 'not json'), res);
    expect(statusOf(res)).toBe(400);
  });
});

describe('/api/fetch-page handler', () => {
  beforeEach(() => {
    process.env.SUPABASE_JWT_SECRET = SECRET;
  });
  afterEach(() => {
    if (originalSecret === undefined) delete process.env.SUPABASE_JWT_SECRET;
    else process.env.SUPABASE_JWT_SECRET = originalSecret;
  });

  it('returns 401 without an admin token (no open proxy)', async () => {
    const res = mockRes();
    await fetchPageHandler(mockReq('GET', {}, ''), res);
    expect(statusOf(res)).toBe(401);
  });
});
