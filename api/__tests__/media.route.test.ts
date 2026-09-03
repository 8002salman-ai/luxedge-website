// ============================================================================
// LUXEDGE — /api/media/generate ROUTE TESTS
//
// Verifies: admin auth, type/provider validation, honest not-configured
// errors, OpenAI image path (b64 → storage upload → durable URL), Gemini
// image path, and Veo video long-running poll. All provider/storage HTTP is
// mocked — no live calls, no keys.
// ============================================================================
import { createHmac } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it, expect, afterEach, vi } from 'vitest';

const handler = (await import('../media/generate.js')).default;

const SECRET = '0123456789abcdef0123456789abcdef';
const original: Record<string, string | undefined> = {
  secret: process.env.SUPABASE_JWT_SECRET,
  url: process.env.VITE_SUPABASE_URL,
  role: process.env.SUPABASE_SERVICE_ROLE_KEY,
  openai: process.env.OPENAI_API_KEY,
  gemini: process.env.GEMINI_API_KEY,
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
const ADMIN_TOKEN = signToken({ sub: 'adm-1', email: 'admin@luxedge.us', exp: Math.floor(Date.now() / 1000) + 3600, app_metadata: { role: 'admin' } });

function makeReq(body: unknown, token = ADMIN_TOKEN): IncomingMessage {
  const payload = JSON.stringify(body);
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const r = { method: 'POST', url: '/api/media/generate', headers } as unknown as IncomingMessage;
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

type ImageBehavior = 'ok' | 'all-missing' | 'quota';

/**
 * Stub env keys + a fetch that answers provider and storage endpoints.
 * Gemini image attempts are model-aware: the preferred gemini-3.1-flash-image
 * 404s (moved/renamed) so the chain has to step down to gemini-2.5-flash-image.
 */
function stubEnv(providerKey: string | null, storageOk = true, imageBehavior: ImageBehavior = 'ok') {
  process.env.SUPABASE_JWT_SECRET = SECRET;
  process.env.VITE_SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
  if (providerKey) {
    if (providerKey === 'openai-key') process.env.OPENAI_API_KEY = providerKey;
    if (providerKey === 'gemini-key') process.env.GEMINI_API_KEY = providerKey;
  } else {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
  }
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/images/generations')) {
      if (imageBehavior === 'quota') return new Response(JSON.stringify({ error: { message: 'You exceeded your current quota' } }), { status: 429 });
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('FAKEIMG').toString('base64') }] }), { status: 200 });
    }
    if (url.includes(':generateContent?key=')) {
      if (imageBehavior === 'quota') return new Response(JSON.stringify({ error: { message: 'RESOURCE_EXHAUSTED: free tier image quota' } }), { status: 429 });
      if (imageBehavior === 'all-missing') return new Response(JSON.stringify({ error: { message: 'model not found' } }), { status: 404 });
      if (url.includes('gemini-3.1-flash-image')) return new Response(JSON.stringify({ error: { message: 'models/gemini-3.1-flash-image not found' } }), { status: 404 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: Buffer.from('FAKEIMG').toString('base64') } }] } }] }), { status: 200 });
    }
    if (url.includes('predictLongRunning')) {
      return new Response(JSON.stringify({ name: 'operations/op-1' }), { status: 200 });
    }
    if (url.includes('operations/op-1')) {
      return new Response(JSON.stringify({ done: true, response: { generatedVideos: [{ video: { videoBytesBase64: Buffer.from('FAKEVIDEO').toString('base64') } }] } }), { status: 200 });
    }
    if (url.includes('/storage/v1/object/')) {
      if (!storageOk) return new Response('nope', { status: 500 });
      return new Response('{}', { status: 200 });
    }
    return new Response(JSON.stringify({ error: 'unexpected ' + url }), { status: 500 });
  }));
}

afterEach(() => {
  for (const [k, v] of Object.entries(original)) {
    const envName = k === 'secret' ? 'SUPABASE_JWT_SECRET' : k === 'url' ? 'VITE_SUPABASE_URL' : k === 'role' ? 'SUPABASE_SERVICE_ROLE_KEY' : k === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY';
    if (v === undefined) delete process.env[envName];
    else process.env[envName] = v;
  }
  vi.unstubAllGlobals();
});

describe('/api/media/generate', () => {
  it('rejects invalid type/provider', async () => {
    stubEnv(null);
    const r = makeRes();
    await handler(makeReq({ type: 'audio', provider: 'openai', prompt: 'x' }), r.server);
    expect(r.status).toBe(400);
    await handler(makeReq({ type: 'image', provider: 'deepseek', prompt: 'x' }), r.server);
    expect(r.status).toBe(400);
    await handler(makeReq({ type: 'video', provider: 'openai', prompt: 'x' }), r.server);
    expect(r.status).toBe(400);
  });

  it('rejects missing prompt', async () => {
    stubEnv('openai-key');
    const r = makeRes();
    await handler(makeReq({ type: 'image', provider: 'openai', prompt: '  ' }), r.server);
    expect(r.status).toBe(400);
  });

  it('reports honestly when the provider key is not configured', async () => {
    stubEnv(null);
    const r = makeRes();
    await handler(makeReq({ type: 'image', provider: 'openai', prompt: 'test' }), r.server);
    expect(r.status).toBe(501);
    expect(String(JSON.stringify(r.body))).toContain('not configured');
  });

  it('OpenAI image: generates, uploads to storage, returns a durable URL (never the key)', async () => {
    stubEnv('openai-key');
    const r = makeRes();
    await handler(makeReq({ type: 'image', provider: 'openai', prompt: 'luxury salt block photo' }), r.server);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, type: 'image', provider: 'openai', contentType: 'image/png' });
    expect(String((r.body as { url?: string }).url)).toContain('/storage/v1/object/public/product-media/ai-');
    expect(JSON.stringify(r.body)).not.toContain('openai-key');
  });

  it('Gemini image: steps down the model chain when the preferred model is missing', async () => {
    stubEnv('gemini-key');
    const r = makeRes();
    await handler(makeReq({ type: 'image', provider: 'gemini', prompt: 'cat toy photo' }), r.server);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, type: 'image', provider: 'gemini' });
    const attempts = vi.mocked(fetch).mock.calls.map((c) => String(c[0])).filter((u) => u.includes(':generateContent'));
    expect(attempts.length).toBeGreaterThanOrEqual(2);
    expect(attempts[0]).toContain('gemini-3.1-flash-image'); // preferred → 404
    expect(attempts[1]).toContain('gemini-2.5-flash-image'); // fallback → success
  });

  it('Gemini image: all models missing surfaces an honest failure, not a fake image', async () => {
    stubEnv('gemini-key', true, 'all-missing');
    const r = makeRes();
    await handler(makeReq({ type: 'image', provider: 'gemini', prompt: 'cat toy photo' }), r.server);
    expect(r.status).toBe(502);
    expect((r.body as { error?: string }).error).toContain('none of the supported image models');
  });

  it('Gemini image: quota exhaustion is classified with the billing next step', async () => {
    stubEnv('gemini-key', true, 'quota');
    const r = makeRes();
    await handler(makeReq({ type: 'image', provider: 'gemini', prompt: 'cat toy photo' }), r.server);
    expect(r.status).toBe(502);
    const err = (r.body as { error?: string }).error || '';
    expect(err).toContain('quota');
    expect(err).toContain('Enable billing on the Google Cloud project');
    // The raw provider wording (which names the key state) must not be echoed verbatim.
    expect(err).not.toContain('RESOURCE_EXHAUSTED:');
  });

  it('Gemini video: polls the Veo operation until done and uploads the clip', async () => {
    stubEnv('gemini-key');
    const r = makeRes();
    await handler(makeReq({ type: 'video', provider: 'gemini', prompt: 'short product video' }), r.server);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, type: 'video', provider: 'gemini', contentType: 'video/mp4' });
  });

  it('storage failure surfaces honestly (never a fake URL)', async () => {
    stubEnv('openai-key', false);
    const r = makeRes();
    await handler(makeReq({ type: 'image', provider: 'openai', prompt: 'test' }), r.server);
    expect(r.status).toBe(502);
    expect((r.body as { error?: string }).error).toContain('Storage upload failed');
  });
});