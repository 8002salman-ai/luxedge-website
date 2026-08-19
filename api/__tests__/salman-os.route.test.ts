// ============================================================================
// LUXEDGE — /api/salman-os CONSOLIDATED ROUTE TESTS
//
// ONE Vercel Serverless Function replaces the previous status/intelligence/
// jobs routes (keeps the Hobby deployment under 12 functions). Verifies:
//   - admin JWT required (401 / 403), fail-closed when auth unconfigured
//   - method restriction (405)
//   - action validation (400 on unknown GET action / POST action / kinds)
//   - WAITING (503) for dispatch when server env is not configured — Salman OS
//     is never called and no credentials leak
//   - GET status / POST run_job dispatch through the frozen contract shapes
// (All HTTP is mocked — no live calls.)
// ============================================================================
import { createHmac } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import handler from '../salman-os.js';

const SECRET = '0123456789abcdef0123456789abcdef';
const SUPABASE_URL = 'https://test-project.supabase.co';
const ANON = 'test-anon-key';

const original = {
  secret: process.env.SUPABASE_JWT_SECRET,
  url: process.env.VITE_SUPABASE_URL,
  anon: process.env.VITE_SUPABASE_ANON_KEY,
  sosBase: process.env.SALMAN_OS_BASE_URL,
  sosToken: process.env.SALMAN_OS_TOKEN,
};

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
const BUYER_TOKEN = signToken({ sub: 'buy-1', email: 'buyer@luxedge.us', exp: futureExp });

interface CapturedResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

function makeHandler() {
  function res(): CapturedResponse & { server: ServerResponse } {
    const captured: CapturedResponse = { status: 200, body: null, headers: {} };
    const server = {
      statusCode: 200,
      setHeader: (k: string, v: string) => { captured.headers[k] = v; },
      end: (payload?: unknown) => {
        captured.status = (server as { statusCode: number }).statusCode;
        try { captured.body = payload ? JSON.parse(String(payload)) : null; } catch { captured.body = String(payload); }
      },
    } as unknown as ServerResponse;
    return Object.assign(captured, { server });
  }

  function req(method: string, url: string, body?: unknown, token?: string): IncomingMessage {
    const headers: Record<string, string> = {};
    if (token !== undefined) headers.authorization = `Bearer ${token}`;
    const raw = body !== undefined ? Buffer.from(JSON.stringify(body)) : undefined;
    let ended = false;
    return {
      method,
      url,
      headers,
      on: (ev: string, cb: (chunk?: Buffer) => void) => {
        if (ev === 'data' && raw) cb(raw);
        if (ev === 'end' && !ended) { ended = true; cb(); }
      },
    } as unknown as IncomingMessage;
  }

  return { res, req };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

const STATUS_OK = {
  success: true,
  data: {
    slug: 'luxedge',
    name: 'Luxedge',
    status: 'active',
    contract_version: 1,
    environment: { default_environment: 'preview', scheduler_enabled: true },
    hermes: { agent_registered: true, provider: 'deepseek', model: 'deepseek-chat', status: 'online' },
    router: { policy: { mode: 'free_critical_backup' }, models: [] },
    modules: [],
    jobs: { queue: [], queue_pending: 0, queue_running: 0, latest_completed: null, latest_failed: null },
  },
  meta: { dataType: 'live' },
};

const OVERVIEW_OK = {
  success: true,
  data: {
    contract_version: 1,
    slug: 'luxedge',
    hermes: { online: true, agent: { provider: 'deepseek', model: 'deepseek-chat', status: 'online' }, node_model: 'deepseek-chat' },
    router: { policy: { mode: 'free_critical_backup' }, free_available: true, current_free_model: 'deepseek-chat', last_model_used: null, last_cost_class: 'UNKNOWN', fallback_used: false, fallback_reason: null, models: [] },
    modules: [],
    jobs: { queue_pending: 0, queue_running: 0, last_research_at: null, next_scheduled_at: null, latest_error: null },
    scheduler_enabled: true,
  },
  meta: { dataType: 'live' },
};

function stubLiveBackend() {
  const fetchMock = vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.includes('/api/projects/luxedge/status')) return json(STATUS_OK);
    if (url.includes('/api/ops/overview')) return json(OVERVIEW_OK);
    if (url.includes('/jobs/run')) {
      return json({
        success: true,
        data: {
          action: 'run',
          environment: 'preview',
          results: [{ module: 'product_research', action: 'dispatched', task_id: 'task-9', duplicate: false, model: 'deepseek-chat', cost_class: 'FREE', fallback_used: false, reason: 'TIER 0 FREE selected (free-first policy).' }],
          dispatched: 1,
          paused: 0,
        },
        meta: { policy: 'free_critical_backup', free_available: true },
      });
    }
    return json({ success: false, error: 'unexpected URL' }, 500);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('/api/salman-os (consolidated)', () => {
  beforeEach(() => {
    process.env.SUPABASE_JWT_SECRET = SECRET;
    process.env.VITE_SUPABASE_URL = SUPABASE_URL;
    process.env.VITE_SUPABASE_ANON_KEY = ANON;
    process.env.SALMAN_OS_BASE_URL = 'https://salman-os.example';
    process.env.SALMAN_OS_TOKEN = 'test-token-abc';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  it('rejects unauthenticated requests (401)', async () => {
    const { res, req } = makeHandler();
    const c = res();
    await handler(req('GET', '/api/salman-os?action=status'), c.server);
    expect(c.status).toBe(401);
  });

  it('rejects non-admin roles (403)', async () => {
    const { res, req } = makeHandler();
    const c = res();
    await handler(req('GET', '/api/salman-os?action=status', undefined, BUYER_TOKEN), c.server);
    expect(c.status).toBe(403);
  });

  it('returns 405 for unsupported methods', async () => {
    const { res, req } = makeHandler();
    const c = res();
    await handler(req('PUT', '/api/salman-os?action=status', undefined, ADMIN_TOKEN), c.server);
    expect(c.status).toBe(405);
  });

  it('validates GET action (400 on unknown action)', async () => {
    const { res, req } = makeHandler();
    const c = res();
    await handler(req('GET', '/api/salman-os?action=bogus', undefined, ADMIN_TOKEN), c.server);
    expect(c.status).toBe(400);
    expect((c.body as { error: string }).error).toContain("action must be 'status'");
  });

  it('returns live status via the consolidated GET (handshake)', async () => {
    stubLiveBackend();
    const { res, req } = makeHandler();
    const c = res();
    await handler(req('GET', '/api/salman-os?action=status', undefined, ADMIN_TOKEN), c.server);
    expect(c.status).toBe(200);
    const status = (c.body as { status: { state: string; contractVersion: number; live: { bridge: string } | null } }).status;
    expect(status.state).toBe('CONNECTED');
    expect(status.contractVersion).toBe(1);
    expect(status.live?.bridge).toBe('online');
  });

  it('fails closed with WAITING (503) for dispatch when server env is missing — no Salman OS call', async () => {
    delete process.env.SALMAN_OS_BASE_URL;
    delete process.env.SALMAN_OS_TOKEN;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { res, req } = makeHandler();
    const c = res();
    await handler(req('POST', '/api/salman-os', { action: 'run_job', kind: 'SEO' }, ADMIN_TOKEN), c.server);
    expect(c.status).toBe(503);
    expect((c.body as { error: string }).error).toContain('SALMAN OS BASE URL REQUIRED');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('validates POST action + job kind (400)', async () => {
    const { res, req } = makeHandler();
    const badAction = res();
    await handler(req('POST', '/api/salman-os', { action: 'explode' }, ADMIN_TOKEN), badAction.server);
    expect(badAction.status).toBe(400);
    const badKind = res();
    await handler(req('POST', '/api/salman-os', { action: 'run_job', kind: 'NOPE' }, ADMIN_TOKEN), badKind.server);
    expect(badKind.status).toBe(400);
    expect((badKind.body as { error: string }).error).toContain('Unknown job kind');
    const badModule = res();
    await handler(req('POST', '/api/salman-os', { action: 'pause_job', module: 'nope' }, ADMIN_TOKEN), badModule.server);
    expect(badModule.status).toBe(400);
    expect((badModule.body as { error: string }).error).toContain('Unknown Salman OS module');
  });

  it('dispatches run_job through the frozen contract', async () => {
    stubLiveBackend();
    const { res, req } = makeHandler();
    const c = res();
    await handler(req('POST', '/api/salman-os', { action: 'run_job', kind: 'PRODUCT_RESEARCH' }, ADMIN_TOKEN), c.server);
    expect(c.status).toBe(200);
    const body = c.body as { ok: boolean; job: { kind: string; status: string; model: string | null } };
    expect(body.ok).toBe(true);
    expect(body.job.kind).toBe('PRODUCT_RESEARCH');
    expect(body.job.status).toBe('QUEUED');
    expect(body.job.model).toBe('deepseek-chat');
  });
});
