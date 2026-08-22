// ============================================================================
// LUXEDGE — /api/suppliers/cj ROUTE TESTS (Worker-shim body handling)
//
// Regression for the Cloudflare Worker bug: the worker shim (makeReq) is a
// plain EventEmitter and is NOT async-iterable. `readBody` previously used
// `for await (const chunk of req)` which throws on that shim → HTTP 500 for
// every POST action (start/freight). This test drives the handler with a
// NON-async-iterable request shim (exactly like the Worker) and asserts POST
// actions return 200 with the expected body instead of throwing.
// ============================================================================
import { createHmac } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const SECRET = '0123456789abcdef0123456789abcdef';
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
const ADMIN_TOKEN = signToken({ sub: 'adm-1', email: 'admin@luxedge.us', exp: futureExp, app_metadata: { role: 'admin' } });

const originalEnv: Record<string, string | undefined> = {
  CJ_API_KEY: process.env.CJ_API_KEY,
  SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET,
  VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
};

// Non-async-iterable request shim — mirrors worker/index.ts makeReq. It has
// `on` (EventEmitter-style), method/url/headers/socket, but NO
// Symbol.asyncIterator. The old `for await` readBody crashed here.
function makeWorkerReq(method: string, body?: unknown, token?: string, url = '/api/suppliers/cj?action=x'): IncomingMessage {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  const payload = body !== undefined ? JSON.stringify(body) : '';
  const r = {
    method,
    url,
    headers,
    socket: { remoteAddress: '127.0.0.1' },
    destroy: () => undefined,
  } as unknown as IncomingMessage;
  const listeners: Record<string, ((chunk?: Buffer) => void)[]> = {};
  const on = (name: string, fn: (chunk?: Buffer) => void) => {
    (listeners[name] ||= []).push(fn);
    if (name === 'data' && payload) queueMicrotask(() => fn(Buffer.from(payload)));
    if (name === 'end') queueMicrotask(() => fn());
    return r;
  };
  Object.defineProperty(r, 'on', { value: on, configurable: true });
  // Explicitly assert the shim is NOT async-iterable (the bug this guards).
  Object.defineProperty(r, Symbol.asyncIterator, { value: undefined });
  return r;
}

function makeRes() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const server: any = {
    statusCode: 200,
    _status: 200,
    _headers: {} as Record<string, string>,
    _body: '',
    setHeader(name: string, value: string) { server._headers[name.toLowerCase()] = String(value); },
    write(chunk: string | Uint8Array) { server._body += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'); },
    end(chunk?: string | Uint8Array) { if (chunk !== undefined) server._body += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'); },
  };
  Object.defineProperty(server, 'statusCode', {
    get: () => server._status,
    set: (v: number) => { server._status = v; },
    enumerable: true,
    configurable: true,
  });
  return server as unknown as ServerResponse & { statusCode: number; _body: string };
}

function jsonOf(res: ServerResponse & { _body: string }): Record<string, unknown> {
  try { return JSON.parse(res._body) as Record<string, unknown>; } catch { return { __raw: res._body }; }
}

describe('/api/suppliers/cj (worker shim body handling)', () => {
  beforeEach(() => {
    process.env.CJ_API_KEY = 'CJ-test@api@test-secret';
    process.env.SUPABASE_JWT_SECRET = SECRET;
    // Mock the durable ledger so no real Supabase call happens.
    vi.mock('../_lib/cj.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../_lib/cj.js')>();
      class FakeLedger {
        async start() {
          return { runId: 'run-test-123', usage: { budget: 250, used: 0, remaining: 250 } };
        }
        async usage() {
          return { budget: 250, used: 0, remaining: 250 };
        }
        async reserve() {
          return { approved: true, usage: null };
        }
        async finish() { return undefined; }
      }
      return {
        ...actual,
        cjConfigured: () => true,
        CjDurableRunLedger: FakeLedger,
        CjDurableRunContext: class { usage() { return { budget: 250, used: 0, remaining: 250 }; } markAttempt() {} },
      };
    });
  });

  afterEach(() => {
    vi.resetModules();
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('POST action=start parses the body on a NON-async-iterable shim (was HTTP 500)', async () => {
    const handler = (await import('../suppliers/cj.js')).default;
    const res = makeRes();
    let threw: unknown = null;
    try {
      await handler(
        makeWorkerReq('POST', { provider: 'cj', requestedBudget: 250 }, ADMIN_TOKEN, '/api/suppliers/cj?action=start'),
        res,
      );
    } catch (e) { threw = e; }
    expect(threw).toBeNull();
    expect(res.statusCode).toBe(200);
    const body = jsonOf(res);
    expect(body.runId).toBe('run-test-123');
  });
});
