// ============================================================================
// LUXEDGE — /api/crm/assistant empty-output contract
//
// Models occasionally return empty content. Before this fix the endpoint
// replied `{"reply":""}` and the storefront widget's `reply || fallback`
// turned that into the alarming "Sorry, I could not respond right now"
// message — exactly what a visitor hit in the live chat. A 200 must always
// carry a non-empty reply: empty model output falls back to the canned line.
// ============================================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../_lib/providers.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../_lib/providers.js')>();
  return {
    ...actual,
    generateWithFallback: vi.fn(async () => ({ text: '', provider: 'openrouter', model: 'minimax/minimax-m3:free', fallbackUsed: false })),
    isConfiguredFull: vi.fn(async (p: string) => p === 'openrouter'),
  };
});

const { generateWithFallback } = await import('../_lib/providers.js');
const assistantHandler = (await import('../crm/assistant.js')).default;

function makeRes(): { captured: { status: number; body: unknown }; server: ServerResponse } {
  const captured = { status: 200, body: null as unknown };
  const server = {
    statusCode: 200,
    setHeader: () => undefined,
    end: (body: unknown) => {
      captured.status = 200;
      captured.body = typeof body === 'string' ? JSON.parse(body) : body;
    },
  } as unknown as ServerResponse;
  return { captured, server };
}
function makeReq(message: string): IncomingMessage {
  const payload = JSON.stringify({ message });
  const r = {
    method: 'POST',
    url: '/api/crm/assistant',
    headers: { 'content-type': 'application/json' },
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
  const evt = (name: string, fn: (chunk?: Buffer) => void) => {
    if (name === 'data') process.nextTick(() => fn(Buffer.from(payload)));
    if (name === 'end') process.nextTick(() => fn());
    return r;
  };
  Object.defineProperty(r, 'on', { value: evt, configurable: true });
  return r;
}

describe('/api/crm/assistant — empty model output', () => {
  const original = { VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL };
  beforeEach(() => {
    delete process.env.VITE_SUPABASE_URL;
    vi.mocked(generateWithFallback).mockResolvedValue({ text: '', provider: 'openrouter', model: 'minimax/minimax-m3:free', fallbackUsed: false });
  });
  afterEach(() => {
    if (original.VITE_SUPABASE_URL === undefined) delete process.env.VITE_SUPABASE_URL;
    else process.env.VITE_SUPABASE_URL = original.VITE_SUPABASE_URL;
  });

  it('never replies with a 200 empty reply — empty model output falls back to canned', async () => {
    const { captured, server } = makeRes();
    await assistantHandler(makeReq('hi'), server);
    expect(captured.status).toBe(200);
    const body = captured.body as { reply?: string; provider?: string };
    expect(typeof body.reply).toBe('string');
    expect((body.reply || '').trim().length).toBeGreaterThan(0);
    expect(body.provider).toBe('canned');
  });

  it('passes real model output through with the serving provider', async () => {
    vi.mocked(generateWithFallback).mockResolvedValue({ text: '  Hi there! How can I help?  ', provider: 'openrouter', model: 'minimax/minimax-m3:free', fallbackUsed: false });
    const { captured, server } = makeRes();
    await assistantHandler(makeReq('hi'), server);
    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({ reply: 'Hi there! How can I help?', provider: 'openrouter', model: 'minimax/minimax-m3:free' });
  });

  it('falls back to DeepSeek when OpenRouter is not configured but DeepSeek is', async () => {
    vi.mocked(generateWithFallback).mockResolvedValue({ text: 'Hello!', provider: 'deepseek', model: 'deepseek-v4-flash', fallbackUsed: true });
    vi.mocked(await import('../_lib/providers.js')).isConfiguredFull.mockImplementation(async (p: string) => p === 'deepseek');
    const { captured, server } = makeRes();
    await assistantHandler(makeReq('hi'), server);
    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({ reply: 'Hello!', provider: 'deepseek' });
  });
});