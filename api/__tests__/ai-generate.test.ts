// ============================================================================
// LUXEDGE — /api/ai/generate provider routing
//
// The requested provider wins when its key is configured; otherwise the server
// routes to the FIRST configured provider in PROVIDER_PRIORITY (the working
// key first) so admin AI features never dead-end on a missing optional key.
// 501 only when NO provider key exists at all.
// ============================================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../_lib/auth.js', () => ({ requireAdmin: vi.fn() }));

vi.mock('../_lib/providers.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../_lib/providers.js')>();
  return {
    ...actual,
    isConfiguredFull: vi.fn(async () => false),
    generateWithFallback: vi.fn(async (_p: string, _f: string | undefined, opts: { prompt: string; model?: string; system?: string }) => ({
      text: `generated-by:${opts.model || 'default'}`,
      provider: _p,
      model: opts.model || 'default',
      fallbackUsed: false,
    })),
  };
});

const { requireAdmin } = await import('../_lib/auth.js');
const { isConfiguredFull, generateWithFallback } = await import('../_lib/providers.js');
const handler = (await import('../ai/generate.js')).default;

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

function makeReq(payload: Record<string, unknown>): IncomingMessage {
  const body = JSON.stringify(payload);
  const r = {
    method: 'POST',
    url: '/api/ai/generate',
    headers: { 'content-type': 'application/json' },
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
  const evt = (name: string, fn: (chunk?: Buffer) => void) => {
    if (name === 'data') process.nextTick(() => fn(Buffer.from(body)));
    if (name === 'end') process.nextTick(() => fn());
    return r;
  };
  Object.defineProperty(r, 'on', { value: evt, configurable: true });
  return r;
}

describe('/api/ai/generate provider routing', () => {
  beforeEach(() => {
    vi.mocked(requireAdmin).mockResolvedValue({ sub: 'admin-1', role: 'admin' } as never);
    vi.mocked(isConfiguredFull).mockResolvedValue(false);
  });
  afterEach(() => vi.clearAllMocks());

  it('uses the requested provider and its model when configured', async () => {
    vi.mocked(isConfiguredFull).mockImplementation(async (p: string) => p === 'openrouter');
    const { captured, server } = makeRes();
    await handler(makeReq({ provider: 'openrouter', model: 'minimax/minimax-m3:free', prompt: 'Write SEO' }), server);
    expect(captured.status).toBe(200);
    expect(generateWithFallback).toHaveBeenCalledWith('openrouter', undefined, { prompt: 'Write SEO', model: 'minimax/minimax-m3:free', system: undefined });
    const b = captured.body as { provider: string; model: string };
    expect(b.provider).toBe('openrouter');
    expect(b.model).toBe('minimax/minimax-m3:free');
  });

  it('routes an unconfigured requested provider to the first CONFIGURED provider (working key first)', async () => {
    vi.mocked(isConfiguredFull).mockImplementation(async (p: string) => p === 'gemini');
    const { captured, server } = makeRes();
    // Client asked for deepseek (no DeepSeek key) → server must use gemini with gemini-3.5-flash.
    await handler(makeReq({ provider: 'deepseek', model: 'deepseek-v4-flash', prompt: 'Write SEO' }), server);
    expect(captured.status).toBe(200);
    expect(generateWithFallback).toHaveBeenCalledWith('gemini', undefined, { prompt: 'Write SEO', model: 'gemini-3.5-flash', system: undefined });
    const b = captured.body as { provider: string; model: string };
    expect(b.provider).toBe('gemini');
    expect(b.model).toBe('gemini-3.5-flash');
  });

  it('prioritizes openrouter before gemini when both are configured and the requested one is not', async () => {
    vi.mocked(isConfiguredFull).mockImplementation(async (p: string) => p !== 'deepseek');
    const { captured, server } = makeRes();
    await handler(makeReq({ provider: 'deepseek', model: 'deepseek-v4-flash', prompt: 'Write SEO' }), server);
    expect(captured.status).toBe(200);
    expect(generateWithFallback).toHaveBeenCalledWith('openrouter', undefined, { prompt: 'Write SEO', model: 'minimax/minimax-m3:free', system: undefined });
  });

  it('answers 501 only when NO provider has a key', async () => {
    vi.mocked(isConfiguredFull).mockResolvedValue(false);
    const { captured, server } = makeRes();
    await handler(makeReq({ provider: 'deepseek', prompt: 'Write SEO' }), server);
    expect(captured.status).toBe(501);
    expect(generateWithFallback).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated callers before routing', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);
    const { server } = makeRes();
    await handler(makeReq({ provider: 'openrouter', prompt: 'hi' }), server);
    expect(generateWithFallback).not.toHaveBeenCalled();
  });
});