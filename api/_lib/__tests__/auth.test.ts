import { createHmac } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { adminAuth, getBearerToken } from '../auth';

const SECRET = '0123456789abcdef0123456789abcdef';
const originalSecret = process.env.SUPABASE_JWT_SECRET;

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function signToken(payload: Record<string, unknown>, secret = SECRET): string {
  const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

function reqWithAuth(token?: string): IncomingMessage {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  return { headers } as unknown as IncomingMessage;
}

const futureExp = Math.floor(Date.now() / 1000) + 3600;
const adminToken = signToken({ sub: 'adm-1', email: 'admin@luxedge.us', exp: futureExp, app_metadata: { role: 'admin' } });
const buyerToken = signToken({ sub: 'buy-1', email: 'buyer@luxedge.us', exp: futureExp });

describe('getBearerToken', () => {
  it('extracts the Bearer token (case-insensitive)', () => {
    expect(getBearerToken({ headers: { authorization: 'Bearer abc.def.ghi' } } as unknown as IncomingMessage)).toBe('abc.def.ghi');
    expect(getBearerToken({ headers: { authorization: 'bearer xyz' } } as unknown as IncomingMessage)).toBe('xyz');
    expect(getBearerToken({ headers: {} } as unknown as IncomingMessage)).toBe('');
    expect(getBearerToken({ headers: { authorization: 'Basic abc' } } as unknown as IncomingMessage)).toBe('');
  });
});

describe('adminAuth', () => {
  beforeEach(() => {
    process.env.SUPABASE_JWT_SECRET = SECRET;
  });
  afterEach(() => {
    if (originalSecret === undefined) delete process.env.SUPABASE_JWT_SECRET;
    else process.env.SUPABASE_JWT_SECRET = originalSecret;
  });

  it('fails closed (503) when the JWT secret is not configured', async () => {
    delete process.env.SUPABASE_JWT_SECRET;
    const decision = await adminAuth(reqWithAuth(adminToken));
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.status).toBe(503);
  });

  it('returns 401 when no token is provided', async () => {
    const decision = await adminAuth(reqWithAuth());
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.status).toBe(401);
  });

  it('returns 401 for an invalid/expired token', async () => {
    const expired = signToken({ sub: 'adm-1', exp: Math.floor(Date.now() / 1000) - 60 });
    for (const token of ['garbage.token.value', expired]) {
      const decision = await adminAuth(reqWithAuth(token));
      expect(decision.ok).toBe(false);
      if (!decision.ok) expect(decision.status).toBe(401);
    }
  });

  it('returns 403 for a valid token without the admin role', async () => {
    const decision = await adminAuth(reqWithAuth(buyerToken));
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.status).toBe(403);
  });

  it('accepts a valid admin token', async () => {
    const decision = await adminAuth(reqWithAuth(adminToken));
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.payload.sub).toBe('adm-1');
  });
});
