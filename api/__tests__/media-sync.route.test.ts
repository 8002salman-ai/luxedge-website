// ============================================================================
// LUXEDGE — /api/media/sync + runMediaSync() TESTS
//
// Verifies the YouTube importer that feeds /media:
//   * POST /api/media/sync requires admin auth (401 without a token, 405 for
//     non-POST).
//   * runMediaSync() — the cron-shared core (Cloudflare scheduled handler
//     calls it without HTTP/auth) — returns an honest 501 result when the
//     YouTube key/channel are not configured, and performs a real
//     channel → uploads → media_videos import when configured.
// All YouTube/Supabase HTTP is mocked — no live calls, no real keys.
// ============================================================================
import { createHmac } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it, expect, afterEach, vi } from 'vitest';

const { default: handler, runMediaSync } = await import('../media/sync.js');

const SECRET = '0123456789abcdef0123456789abcdef';

const ENV_KEYS = [
  'SUPABASE_JWT_SECRET',
  'VITE_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'YOUTUBE_API_KEY',
  'YOUTUBE_CHANNEL_ID',
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

function makeReq(body: unknown, token = ADMIN_TOKEN, method = 'POST'): IncomingMessage {
  const payload = JSON.stringify(body);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = { method, url: '/api/media/sync', headers } as unknown as IncomingMessage;
  const listeners: Record<string, ((c?: Buffer) => void)[]> = {};
  (r as unknown as { on: (n: string, fn: (c?: Buffer) => void) => unknown }).on = (n: string, fn: (c?: Buffer) => void) => {
    (listeners[n] ||= []).push(fn);
    if (n === 'data' && payload) queueMicrotask(() => fn(Buffer.from(payload)));
    if (n === 'end') queueMicrotask(() => fn());
    return r;
  };
  return r;
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

/** Configures env so supabaseAdmin() + runMediaSync() see a working setup. */
function stubEnv(withYouTube = true): void {
  process.env.SUPABASE_JWT_SECRET = SECRET;
  process.env.VITE_SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
  if (withYouTube) {
    process.env.YOUTUBE_API_KEY = 'yt-key';
    process.env.YOUTUBE_CHANNEL_ID = 'UCdemo';
  } else {
    delete process.env.YOUTUBE_API_KEY;
    delete process.env.YOUTUBE_CHANNEL_ID;
  }
}

/**
 * Mocks YouTube (channel → uploads playlist → 2 uploads with durations) and
 * Supabase (no existing rows; inserts succeed). One video is a normal 6:43
 * documentary, the other a 45-second Short.
 */
function stubHappyFetch(inserts: unknown[] = [], settings: unknown[] = []): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method as string | undefined) || 'GET';
      const yt = url.includes('googleapis.com/youtube/v3/');
      if (yt) {
        if (url.includes('channels?part=contentDetails')) {
          return json({ items: [{ contentDetails: { relatedPlaylists: { uploads: 'UUdemo' } } }] });
        }
        if (url.includes('playlistItems?part=snippet')) {
          return json({
            items: [
              {
                snippet: {
                  resourceId: { videoId: 'v1' },
                  title: "How Pakistan's Himalayan Pink Salt Products Are Made | Mine to Factory",
                  publishedAt: '2026-09-03T20:50:48Z',
                  thumbnails: { high: { url: 'https://i.ytimg.com/vi/v1/hqdefault.jpg' } },
                },
              },
              {
                snippet: {
                  resourceId: { videoId: 'v2' },
                  title: 'Salt Lamp Short',
                  publishedAt: '2026-09-04T10:00:00Z',
                  thumbnails: { medium: { url: 'https://i.ytimg.com/vi/v2/mqdefault.jpg' } },
                },
              },
            ],
          });
        }
        if (url.includes('videos?part=snippet,contentDetails')) {
          return json({
            items: [
              { id: 'v1', contentDetails: { duration: 'PT6M43S' }, snippet: { tags: ['himalayan', 'salt'] } },
              { id: 'v2', contentDetails: { duration: 'PT45S' }, snippet: { tags: [] } },
            ],
          });
        }
        return json({ error: `unexpected youtube url ${url}` }, 500);
      }
      if (url.includes('/rest/v1/app_settings')) {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        settings.push(body);
        return json([{ ...body }]);
      }
      if (url.includes('/rest/v1/media_videos')) {
        if (method === 'POST') {
          const body = init?.body ? JSON.parse(String(init.body)) : {};
          inserts.push(body);
          return json([{ id: `m${inserts.length}`, ...body }]);
        }
        return json([]);
      }
      return json({ error: `unexpected url ${url}` }, 500);
    }),
  );
}

function lastSyncMarker(settings: unknown[]): { source: string; created: number; updated: number; at: string } | null {
  const marker = settings.find((s) => (s as { key?: string }).key === 'MEDIA_LAST_SYNC');
  if (!marker) return null;
  return JSON.parse((marker as { value: string }).value) as { source: string; created: number; updated: number; at: string };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = original[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.unstubAllGlobals();
});

describe('/api/media/sync — auth + method guards', () => {
  it('401 without an admin token', async () => {
    stubEnv();
    const r = makeRes();
    await handler(makeReq({}, ''), r.server);
    expect(r.status).toBe(401);
  });

  it('405 for non-POST', async () => {
    stubEnv();
    const r = makeRes();
    await handler(makeReq({}, ADMIN_TOKEN, 'GET'), r.server);
    expect(r.status).toBe(405);
  });
});

describe('runMediaSync() — the cron-shared core', () => {
  it('returns an honest 501 (not configured) when the YouTube key is missing', async () => {
    stubEnv(false);
    const out = await runMediaSync();
    expect(out.ok).toBe(false);
    expect(out.status).toBe(501);
    expect(out.missing?.YOUTUBE_API_KEY).toBe(true);
    expect(out.error).toContain('not configured');
  });

  it('imports channel uploads end-to-end through the admin endpoint', async () => {
    stubEnv(true);
    const inserts: unknown[] = [];
    const settings: unknown[] = [];
    stubHappyFetch(inserts, settings);

    const r = makeRes();
    await handler(makeReq({}), r.server);

    expect(r.status).toBe(200);
    const body = r.body as { ok: boolean; created: number; updated: number; synced: number; videos: { slug: string }[] };
    expect(body.ok).toBe(true);
    expect(body.created).toBe(2);
    expect(body.updated).toBe(0);
    expect(body.synced).toBe(2);
    // Slugs are derived from real titles.
    const slugs = body.videos.map((v) => v.slug);
    expect(slugs).toContain('how-pakistan-s-himalayan-pink-salt-products-are-made-mine-to-factory');
    expect(slugs).toContain('salt-lamp-short');

    // Rows are upserted (published) with real YouTube facts; v2 is a Short.
    expect(inserts).toHaveLength(2);
    const [a, b] = inserts as Array<{ youtube_video_id: string; status: string; is_short: boolean; duration: string; published_at: string }>;
    expect(a.youtube_video_id).toBe('v1');
    expect(a.status).toBe('published');
    expect(a.is_short).toBe(false);
    expect(a.duration).toBe('PT6M43S');
    expect(b.youtube_video_id).toBe('v2');
    expect(b.is_short).toBe(true);
    expect(b.published_at).toBe('2026-09-04T10:00:00Z');

    // A "Last synced" marker is recorded with the run outcome + source.
    const marker = lastSyncMarker(settings);
    expect(marker).not.toBeNull();
    expect(marker!.source).toBe('manual');
    expect(marker!.created).toBe(2);
    expect(marker!.updated).toBe(0);
    expect(new Date(marker!.at).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('records the run as cron when invoked by the scheduled handler', async () => {
    stubEnv(true);
    const settings: unknown[] = [];
    stubHappyFetch([], settings);

    const out = await runMediaSync('cron');
    expect(out.ok).toBe(true);
    const marker = lastSyncMarker(settings);
    expect(marker).not.toBeNull();
    expect(marker!.source).toBe('cron');
    expect(marker!.created).toBe(2);
  });
});
