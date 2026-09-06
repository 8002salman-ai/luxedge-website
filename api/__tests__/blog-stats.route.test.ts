// ============================================================================
// LUXEDGE — /api/admin/blog-stats contract
//
// Admin-only per-post view counts derived from first-party site_events
// (page_view rows whose path matches /blog/<slug>). Only blog article paths
// count; trailing slashes normalize; the 90d window and 7d/30d sub-windows
// are real arithmetic on occurred_at.
// ============================================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../_lib/auth.js', () => ({
  requireAdmin: vi.fn(),
}));

const { requireAdmin } = await import('../_lib/auth.js');
const handler = (await import('../admin/blog-stats.js')).default;

const HOST = 'https://probe.supabase.co';

function makeRes(): { captured: { status: number; body: unknown }; server: ServerResponse } {
  const captured = { status: 200, body: null as unknown };
  const server = {
    statusCode: 200,
    setHeader: () => undefined,
    end: (body: unknown) => {
      captured.status = (server as { statusCode: number }).statusCode;
      captured.body = typeof body === 'string' ? JSON.parse(body) : body;
    },
  } as unknown as ServerResponse;
  return { captured, server };
}

function makeReq(method = 'GET'): IncomingMessage {
  const r = {
    method,
    url: '/api/admin/blog-stats',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
  const evt = (name: string, fn: (chunk?: Buffer) => void) => {
    if (name === 'data') process.nextTick(() => fn(Buffer.from('')));
    if (name === 'end') process.nextTick(() => fn());
    return r;
  };
  Object.defineProperty(r, 'on', { value: evt, configurable: true });
  return r;
}

const DAY = 86400000;
function iso(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * DAY).toISOString();
}

describe('/api/admin/blog-stats', () => {
  beforeEach(() => {
    vi.mocked(requireAdmin).mockResolvedValue({ sub: 'admin-1', role: 'admin' } as never);
    process.env.VITE_SUPABASE_URL = HOST;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-probe';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it('returns empty stats when analytics service is not configured', async () => {
    delete process.env.VITE_SUPABASE_URL;
    const { captured, server } = makeRes();
    await handler(makeReq(), server);
    const body = captured.body as { stats: Record<string, unknown>; unavailable?: string };
    expect(body.stats).toEqual({});
    expect(body.unavailable).toMatch(/not configured/);
  });

  it('counts page_view events per blog slug with 7d/30d windows', async () => {
    const rows = [
      { path: '/blog/cat-tunnel-guide', occurred_at: iso(1) },          // 1d → all windows
      { path: '/blog/cat-tunnel-guide/', occurred_at: iso(1) },         // trailing slash → same slug
      { path: '/blog/cat-tunnel-guide?x=1', occurred_at: iso(10) },     // query stripped → 30d only
      { path: '/blog/cat-tunnel-guide', occurred_at: iso(40) },         // 90d only
      { path: '/blog', occurred_at: iso(1) },                           // listing — excluded
      { path: '/blog/write', occurred_at: iso(1) },                     // non-article — excluded
      { path: '/blog/cat-tunnel-guide-extra', occurred_at: iso(1) },    // different slug
    ];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(rows), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));

    const { captured, server } = makeRes();
    await handler(makeReq(), server);

    expect(captured.status).toBe(200);
    const body = captured.body as { windowDays: number; stats: Record<string, { views: number; views7d: number; views30d: number }> };
    expect(body.windowDays).toBe(90);
    expect(body.stats['cat-tunnel-guide']).toEqual({ views: 4, views7d: 2, views30d: 3 });
    expect(body.stats['cat-tunnel-guide-extra']).toEqual({ views: 1, views7d: 1, views30d: 1 });
    // /blog listing excluded; /blog/write counts but no post uses that slug,
    // so it never surfaces in the table.
    expect(body.stats['']).toBeUndefined();
  });

  it('requires admin and rejects non-GET', async () => {
    // requireAdmin writes the 401 itself; the handler returns early.
    vi.mocked(requireAdmin).mockImplementationOnce(async (_req, res) => {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return null;
    });
    const { captured, server } = makeRes();
    await handler(makeReq(), server);
    expect(captured.status).toBe(401);

    vi.mocked(requireAdmin).mockResolvedValue({ sub: 'admin-1', role: 'admin' } as never);
    const { captured: c2, server: s2 } = makeRes();
    await handler(makeReq('POST'), s2);
    expect(c2.status).toBe(405);
  });

});