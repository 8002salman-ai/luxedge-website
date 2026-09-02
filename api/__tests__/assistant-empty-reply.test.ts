// ============================================================================
// LUXEDGE — /api/crm/assistant empty-output contract
//
// DeepSeek occasionally returns empty content. Before this fix the endpoint
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
    generateWithRetry: vi.fn(async () => ''),
    isConfigured: vi.fn(() => true),
  };
});

const { generateWithRetry } = await import('../_lib/providers.js');
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

describe('/api/crm/assistant — empty DeepSeek output', () => {
  const original = { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY, VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL };
  beforeEach(() => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    delete process.env.VITE_SUPABASE_URL;
    vi.mocked(generateWithRetry).mockResolvedValue('');
  });
  afterEach(() => {
    process.env.DEEPSEEK_API_KEY = original.DEEPSEEK_API_KEY;
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

  it('passes real model output through as provider=deepseek', async () => {
    vi.mocked(generateWithRetry).mockResolvedValue('  Hi there! How can I help?  ');
    const { captured, server } = makeRes();
    await assistantHandler(makeReq('hi'), server);
    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({ reply: 'Hi there! How can I help?', provider: 'deepseek' });
  });
});