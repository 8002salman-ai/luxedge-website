// ============================================================================
// LUXEDGE — /api/media/status TESTS
//
// GET /api/media/status feeds the Admin Media Hub "Last synced" stamp:
//   * 401 without an admin token, 405 for non-GET.
//   * Returns the recorded MEDIA_LAST_SYNC app_settings value as lastSync,
//     or lastSync: null when the cron has never completed a run.
// The app_settings read is mocked — no live Supabase calls.
// ============================================================================
import { createHmac } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it, expect, afterEach, vi } from 'vitest';

const { default: handler } = await import('../media/status.js');

const SECRET = '0123456789abcdef0123456789abcdef';

const ENV_KEYS = [
  'SUPABASE_JWT_SECRET',
  'VITE_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const;
const original: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) original[k] = process.env[k];

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}
function signToken(payload: Record<string, unknown>): string {
  const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}
const ADMIN_TOKEN = signToken({
  sub: 'adm-1',
  email: 'admin@luxedge.us',
  exp: Math.floor(Date.now() / 1000) + 3600,
  app_metadata: { role: 'admin' },
});

function makeReq(method = 'GET', token = ADMIN_TOKEN): IncomingMessage {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return { method, url: '/api/media/status', headers } as unknown as IncomingMessage;
}

function makeRes(): { status: number; body: unknown; server: ServerResponse } {
  const cap = { status: 200, body: null as unknown, server: null as unknown as ServerResponse };
  const server = {
    statusCode: 200,
    setHeader: () => {},
    end: (payload?: unknown) => {
      cap.status = (server as { statusCode: number }).statusCode;
      try { cap.body = payload ? JSON.parse(String(payload)) : null; } catch { cap.body = String(payload); }
    },
  } as unknown as ServerResponse;
  cap.server = server;
  return cap;
}

function stubEnv(): void {
  process.env.SUPABASE_JWT_SECRET = SECRET;
  process.env.VITE_SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Stub the app_settings read: rows below are served for any key. */
function stubSettingsRead(rows: Array<{ key: string; value: string }>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/rest/v1/app_settings')) return json(rows);
      return json({ error: `unexpected url ${url}` }, 500);
    }),
  );
}

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = original[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.unstubAllGlobals();
});

describe('/api/media/status — auth + method guards', () => {
  it('401 without an admin token', async () => {
    stubEnv();
    const r = makeRes();
    await handler(makeReq('GET', ''), r.server);
    expect(r.status).toBe(401);
  });

  it('405 for non-GET', async () => {
    stubEnv();
    const r = makeRes();
    await handler(makeReq('POST'), r.server);
    expect(r.status).toBe(405);
  });
});

describe('/api/media/status — last-sync reporting', () => {
  it('returns the recorded run when a sync has completed (cron)', async () => {
    stubEnv();
    stubSettingsRead([
      {
        key: 'MEDIA_LAST_SYNC',
        value: JSON.stringify({ at: '2026-09-04T12:00:00Z', source: 'cron', synced: 5, created: 4, updated: 1 }),
      },
    ]);
    const r = makeRes();
    await handler(makeReq(), r.server);
    expect(r.status).toBe(200);
    const body = r.body as { ok: boolean; lastSync: { source: string; created: number; at: string } };
    expect(body.ok).toBe(true);
    expect(body.lastSync.source).toBe('cron');
    expect(body.lastSync.created).toBe(4);
    expect(body.lastSync.at).toBe('2026-09-04T12:00:00Z');
  });

  it('returns lastSync null when no sync has ever completed', async () => {
    stubEnv();
    stubSettingsRead([]);
    const r = makeRes();
    await handler(makeReq(), r.server);
    expect(r.status).toBe(200);
    expect((r.body as { ok: boolean; lastSync: unknown }).ok).toBe(true);
    expect((r.body as { ok: boolean; lastSync: unknown }).lastSync).toBeNull();
  });

  it('does not crash on a corrupt stored value', async () => {
    stubEnv();
    stubSettingsRead([{ key: 'MEDIA_LAST_SYNC', value: 'not-json{' }]);
    const r = makeRes();
    await handler(makeReq(), r.server);
    expect(r.status).toBe(200);
    expect((r.body as { lastSync: unknown }).lastSync).toBeNull();
  });
});
