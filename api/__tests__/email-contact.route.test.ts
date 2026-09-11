// ============================================================================
// LUXEDGE — /api/email/contact ROUTE TESTS
//
// Public contact endpoint. Verifies: POST only, per-IP rate limit, honeypot
// silently swallows bots (fake success, never sends, never consumes the
// human rate limit), topic allowlist + field validation, send to
// hello@luxedge.us with reply_to set, honest failure when the send_email
// binding is missing or the send fails (never fake success), and no secret
// values in responses. (All HTTP is mocked — no live sends.)
// ============================================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const contactHandler = (await import('../email/contact.js')).default;
const { __resetContactLimiterForTests } = await import('../email/contact.js');

const sentMessages: Array<Record<string, string>> = [];

function makeBinding(failOnSend = false) {
  return {
    send: async (msg: Record<string, string>) => {
      if (failOnSend) throw new Error('Cloudflare rejected the send');
      sentMessages.push(msg);
    },
  };
}

interface CapturedResponse { status: number; body: unknown }
function makeHarness(env?: { SEND_MAIL?: unknown }) {
  function res(): CapturedResponse & { server: ServerResponse } {
    const captured: CapturedResponse = { status: 200, body: null };
    const server = {
      statusCode: 200,
      setHeader: () => {},
      end: (payload?: unknown) => {
        captured.status = (server as { statusCode: number }).statusCode;
        try { captured.body = payload ? JSON.parse(String(payload)) : null; } catch { captured.body = String(payload); }
      },
    } as unknown as ServerResponse;
    return Object.assign(captured, { server });
  }
  function req(method: string, body: unknown, ip = '1.2.3.4'): IncomingMessage {
    const payload = JSON.stringify(body);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
    };
    const r = {
      method,
      url: '/api/email/contact',
      headers,
      env,
    } as unknown as IncomingMessage;
    const listeners: Record<string, ((c?: Buffer) => void)[]> = {};
    (r as unknown as { on: (n: string, fn: (c?: Buffer) => void) => unknown }).on = (n: string, fn: (c?: Buffer) => void) => {
      (listeners[n] ||= []).push(fn);
      if (n === 'data' && payload) queueMicrotask(() => fn(Buffer.from(payload)));
      if (n === 'end') queueMicrotask(() => fn());
      return r;
    };
    return r;
  }
  return { res, req };
}

const VALID = {
  name: 'Jane Shopper',
  email: 'jane@example.com',
  topic: 'Order Question',
  message: 'I have a question about my recent order, thank you.',
  website: '',
};

describe('/api/email/contact', () => {
  beforeEach(() => {
    sentMessages.length = 0;
    __resetContactLimiterForTests();
  });
  afterEach(() => {
    __resetContactLimiterForTests();
  });

  it('rejects non-POST with 405', async () => {
    const { res, req } = makeHarness({ SEND_MAIL: makeBinding() });
    const r = res();
    await contactHandler(req('GET', VALID), r.server);
    expect(r.status).toBe(405);
    expect(sentMessages.length).toBe(0);
  });

  it('silently swallows honeypot submissions: fake success, no email, no rate-limit consumption', async () => {
    const { res, req } = makeHarness({ SEND_MAIL: makeBinding() });
    // Three filled-honeypot submissions in a row — all fake success…
    for (let i = 0; i < 3; i++) {
      const r = res();
      await contactHandler(req('POST', { ...VALID, website: 'http://spam.example' }), r.server);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ ok: true, sent: true });
    }
    // …and a real submission right after still goes through.
    const r = res();
    await contactHandler(req('POST', VALID), r.server);
    expect(r.status).toBe(200);
    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0]).toMatchObject({ to: 'hello@luxedge.us', reply_to: 'jane@example.com' });
  });

  it('reports 501 honestly when the send_email binding is missing', async () => {
    const { res, req } = makeHarness();
    const r = res();
    await contactHandler(req('POST', VALID), r.server);
    expect(r.status).toBe(501);
    expect(r.body).toMatchObject({ ok: false, sent: false });
    expect(JSON.stringify(r.body)).toContain('send_email binding');
    expect(sentMessages.length).toBe(0);
  });

  it.each([
    ['missing name', { ...VALID, name: ' ' }],
    ['short name', { ...VALID, name: 'J' }],
    ['invalid email', { ...VALID, email: 'not-an-email' }],
    ['topic not in allowlist', { ...VALID, topic: 'Refund please' }],
    ['missing topic', { ...VALID, topic: '' }],
    ['short message', { ...VALID, message: 'hi' }],
    ['missing message', { ...VALID, message: '' }],
  ])('rejects with 400 on %s', async (_label, body) => {
    const { res, req } = makeHarness({ SEND_MAIL: makeBinding() });
    const r = res();
    await contactHandler(req('POST', body), r.server);
    expect(r.status).toBe(400);
    expect(r.body).toHaveProperty('error');
    expect(sentMessages.length).toBe(0);
  });

  it('sends a valid submission to hello@luxedge.us with reply_to and safe subject', async () => {
    const { res, req } = makeHarness({ SEND_MAIL: makeBinding() });
    const r = res();
    await contactHandler(req('POST', VALID), r.server);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, sent: true });
    expect(sentMessages.length).toBe(1);
    const msg = sentMessages[0];
    expect(msg).toMatchObject({
      from: 'sales@luxedge.us',
      to: 'hello@luxedge.us',
      reply_to: 'jane@example.com',
    });
    expect(msg.subject).toContain('Order Question');
    expect(msg.subject).toContain('Jane Shopper');
    expect(msg.text).toContain('I have a question about my recent order');
    expect(msg.text).not.toContain('website');
  });

  it('lowercases the sender email and trims fields', async () => {
    const { res, req } = makeHarness({ SEND_MAIL: makeBinding() });
    const r = res();
    await contactHandler(req('POST', { ...VALID, email: '  JANE@Example.COM ' }), r.server);
    expect(r.status).toBe(200);
    expect(sentMessages[0]).toMatchObject({ reply_to: 'jane@example.com' });
  });

  it('never claims success when the send fails', async () => {
    const { res, req } = makeHarness({ SEND_MAIL: makeBinding(true) });
    const r = res();
    await contactHandler(req('POST', VALID), r.server);
    expect(r.status).toBe(502);
    expect(r.body).toMatchObject({ ok: false, sent: false });
    expect(JSON.stringify(r.body)).toContain('Cloudflare rejected the send');
  });

  it('rate-limits a single IP after 3 submissions and returns 429', async () => {
    const { res, req } = makeHarness({ SEND_MAIL: makeBinding() });
    for (let i = 0; i < 3; i++) {
      const r = res();
      await contactHandler(req('POST', VALID), r.server);
      expect(r.status).toBe(200);
    }
    const r = res();
    await contactHandler(req('POST', VALID), r.server);
    expect(r.status).toBe(429);
    expect(JSON.stringify(r.body)).toMatch(/too many|slow down/i);
    expect(sentMessages.length).toBe(3);
  });

  it('rate-limits per IP independently', async () => {
    const { res, req } = makeHarness({ SEND_MAIL: makeBinding() });
    for (let i = 0; i < 3; i++) {
      const r = res();
      await contactHandler(req('POST', VALID, '9.9.9.9'), r.server);
      expect(r.status).toBe(200);
    }
    // A different IP is unaffected.
    const r = res();
    await contactHandler(req('POST', VALID, '8.8.8.8'), r.server);
    expect(r.status).toBe(200);
    expect(sentMessages.length).toBe(4);
  });

  it('never returns secrets or recipient internals in the response', async () => {
    const { res, req } = makeHarness({ SEND_MAIL: makeBinding() });
    const r = res();
    await contactHandler(req('POST', VALID), r.server);
    const s = JSON.stringify(r.body);
    expect(s).not.toMatch(/secret|token|key|supabase|service_role/i);
    expect(s).not.toContain('sales@luxedge.us');
  });
});