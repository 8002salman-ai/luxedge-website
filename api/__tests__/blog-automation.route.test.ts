// ============================================================================
// LUXEDGE — /blog-automation PUBLISH ROUTE
//
// The automation surface exists so n8n/Hermes can queue editorial work without
// touching git or the deploy. Publication is NOT part of that: the route's gate
// hard-fails, so a caller that asks for /publish gets a draft. That is the
// behaviour the AdSense review depends on ("no AI auto-publishing"), and it is
// easy to lose silently — an edit that drops `gate.ok = false` would keep every
// other test green while the endpoint started publishing on its own.
//
// This drives the real handler with Supabase stubbed and asserts on the writes
// it actually issues, not on the string in the source. The worker mounts this
// handler on the bare /blog-automation prefix (worker/index.ts), which is why
// the paths below carry no /api.
// ============================================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../blog-automation/index.js';

const SECRET = 'automation-secret-for-tests';

interface Cap { status: number; body: unknown }
function res(): { server: ServerResponse; cap: Cap } {
  const cap: Cap = { status: 200, body: null };
  const server = {
    statusCode: 200,
    setHeader: () => {},
    end: (payload?: unknown) => {
      cap.status = (server as { statusCode: number }).statusCode;
      try { cap.body = payload ? JSON.parse(String(payload)) : null; } catch { cap.body = String(payload); }
    },
  } as unknown as ServerResponse;
  return { server, cap };
}

function req(method: string, urlPath: string, body?: unknown, secret: string | null = SECRET): IncomingMessage {
  const raw = body !== undefined ? Buffer.from(JSON.stringify(body)) : undefined;
  let ended = false;
  return {
    method,
    url: urlPath,
    headers: secret ? { host: 'luxedge.us', 'x-automation-secret': secret } : { host: 'luxedge.us' },
    on: (ev: string, cb: (chunk?: Buffer) => void) => {
      if (ev === 'data' && raw) cb(raw);
      if (ev === 'end' && !ended) { ended = true; cb(); }
    },
  } as unknown as IncomingMessage;
}

/** Every write the handler attempts, so we can assert on what it would store. */
let writes: { path: string; method: string; body: Record<string, unknown> | null }[];

function stubSupabase() {
  writes = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace('https://test-project.supabase.co/rest/v1/', '');
    const method = (init?.method || 'GET').toUpperCase();
    if (method !== 'GET') {
      let parsed: Record<string, unknown> | null = null;
      try { parsed = init?.body ? JSON.parse(String(init.body)) : null; } catch { parsed = null; }
      writes.push({ path, method, body: parsed });
      // A create returns the row the handler just wrote (PostgREST representation).
      if (path.startsWith('blog_posts')) {
        return new Response(JSON.stringify([{ id: 'row-1', ...(parsed || {}) }]), { status: 201 });
      }
    }
    return new Response('[]', { status: 200 });
  }));
}

describe('/blog-automation/publish', () => {
  beforeEach(() => {
    process.env.VITE_SUPABASE_URL = 'https://test-project.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    process.env.BLOG_AUTOMATION_SECRET = SECRET;
    stubSupabase();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.BLOG_AUTOMATION_SECRET;
  });

  it('answers a publish request with a draft, never a published row', async () => {
    const { server, cap } = res();
    await handler(req('POST', '/blog-automation/publish', {
      title: 'A guide the automation wants to publish',
      content: 'Body copy for the guide.',
      author_name: 'Luxedge Editorial Team',
      internal_links: [],
    }), server);

    expect(cap.status, JSON.stringify(cap.body)).toBe(200);
    expect((cap.body as { status: string }).status).toBe('draft');
    // The real assertion: no write the handler issued asked the database for a
    // published (or scheduled) row.
    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) {
      expect(w.body?.status, `${w.method} ${w.path} status`).not.toBe('published');
      expect(w.body?.status, `${w.method} ${w.path} status`).not.toBe('scheduled');
    }
    const post = writes.find((w) => w.method === 'POST' && w.path.startsWith('blog_posts'));
    expect(post?.body?.status).toBe('draft');
  });

  it('creates only a draft on the explicit draft route too', async () => {
    const { server, cap } = res();
    await handler(req('POST', '/blog-automation/draft', {
      title: 'Another queued draft for review',
      content: 'Body copy.',
    }), server);
    expect(cap.status).toBe(201);
    for (const w of writes) expect(w.body?.status).not.toBe('published');
  });

  it('stays closed when the automation secret is not configured', async () => {
    delete process.env.BLOG_AUTOMATION_SECRET;
    const { server, cap } = res();
    await handler(req('POST', '/blog-automation/publish', { title: 'Anything at all' }), server);
    expect(cap.status).toBe(503);
    expect(writes).toEqual([]);
  });

  it('rejects a caller without the secret', async () => {
    const { server, cap } = res();
    await handler(req('POST', '/blog-automation/publish', { title: 'Anything at all' }, null), server);
    expect(cap.status).toBe(401);
    expect(writes).toEqual([]);
  });
});
