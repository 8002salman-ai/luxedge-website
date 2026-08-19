// ============================================================================
// LUXEDGE — /api/webhook ROUTE TESTS
//
// Verifies the Stripe webhook: invalid signatures are rejected with NO
// database write, completed sessions persist an order idempotently, replays
// are acked without duplicates, and non-completion events are ignored.
// ============================================================================
import { createHmac } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import handler from '../webhook.js';

const SUPABASE_URL = 'https://test-project.supabase.co';
const SR = 'service-role-key';
const WH = 'whsec_probe_webhook_secret';

const original = {
  url: process.env.VITE_SUPABASE_URL,
  sr: process.env.SUPABASE_SERVICE_ROLE_KEY,
  wh: process.env.STRIPE_WEBHOOK_SECRET,
};

function sessionEvent(type = 'checkout.session.completed', overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'evt_1',
    type,
    data: {
      object: {
        id: 'cs_test_123',
        payment_status: 'paid',
        amount_total: 3205,
        currency: 'usd',
        customer_email: 'buyer@example.com',
        payment_intent: 'pi_test_1',
        metadata: { items_count: '1', coupon: 'none' },
        ...overrides,
      },
    },
  });
}

function sign(body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac('sha256', WH).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${sig}`;
}

function makeEnv() {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  let existing = false; // simulate an already-persisted order (duplicate replay)
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method || 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes('/rest/v1/luxedge_orders') && init?.method === 'POST') {
      if (existing) {
        return new Response(JSON.stringify({ code: '23505', message: 'duplicate key' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      existing = true;
      return new Response(JSON.stringify([{ id: 'ord_1', ...JSON.parse(String(init.body)) }]), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/rest/v1/luxedge_orders')) {
      return new Response(JSON.stringify(existing ? [{ id: 'ord_1' }] : []), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  return calls;
}

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

function req(rawBody: string, sig: string | undefined): IncomingMessage {
  const raw = Buffer.from(rawBody);
  let ended = false;
  return {
    method: 'POST',
    url: '/api/webhook',
    headers: { 'stripe-signature': sig, 'content-type': 'application/json' },
    on: (ev: string, cb: (chunk?: Buffer) => void) => {
      if (ev === 'data') cb(raw);
      if (ev === 'end' && !ended) { ended = true; cb(); }
    },
  } as unknown as IncomingMessage;
}

describe('/api/webhook', () => {
  beforeEach(() => {
    process.env.VITE_SUPABASE_URL = SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SR;
    process.env.STRIPE_WEBHOOK_SECRET = WH;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (original.url === undefined) delete process.env.VITE_SUPABASE_URL; else process.env.VITE_SUPABASE_URL = original.url;
    if (original.sr === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = original.sr;
    if (original.wh === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = original.wh;
  });

  it('rejects an invalid signature with NO database write', async () => {
    const calls = makeEnv();
    const body = sessionEvent();
    const { server, cap } = res();
    await handler(req(body, `t=${Math.floor(Date.now() / 1000)},v1=deadbeef`), server);
    expect(cap.status).toBe(400);
    expect(calls.some((c) => c.url.includes('/rest/v1/luxedge_orders'))).toBe(false);
  });

  it('persists an order on checkout.session.completed', async () => {
    const calls = makeEnv();
    const body = sessionEvent();
    const { server, cap } = res();
    await handler(req(body, sign(body)), server);
    expect(cap.status).toBe(200);
    const insert = calls.find((c) => c.url.includes('/rest/v1/luxedge_orders') && c.method === 'POST');
    expect(insert).toBeTruthy();
    const row = insert!.body as { stripe_session_id: string; status: string; total: number; order_number: string };
    expect(row.stripe_session_id).toBe('cs_test_123');
    expect(row.status).toBe('paid');
    expect(row.total).toBe(32.05);
    expect(row.order_number).toMatch(/^LX-/);
  });

  it('is idempotent — a replayed completed event does not create a second order', async () => {
    const calls = makeEnv();
    const body = sessionEvent();
    const sig = sign(body);
    const a = res();
    await handler(req(body, sig), a.server);
    expect(a.cap.status).toBe(200);
    const b = res();
    await handler(req(body, sig), b.server);
    expect(b.cap.status).toBe(200);
    expect((b.cap.body as { duplicate: boolean }).duplicate).toBe(true);
    const inserts = calls.filter((c) => c.url.includes('/rest/v1/luxedge_orders') && c.method === 'POST');
    expect(inserts.length).toBe(1);
  });

  it('acks but ignores non-completion events', async () => {
    const calls = makeEnv();
    const body = sessionEvent('checkout.session.expired');
    const { server, cap } = res();
    await handler(req(body, sign(body)), server);
    expect(cap.status).toBe(200);
    expect((cap.body as { ignored: string }).ignored).toBe('checkout.session.expired');
    expect(calls.some((c) => c.url.includes('/rest/v1/luxedge_orders'))).toBe(false);
  });

  it('fails closed (400) when the webhook secret is not configured', async () => {
    makeEnv();
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const body = sessionEvent();
    const { server, cap } = res();
    await handler(req(body, sign(body)), server);
    expect(cap.status).toBe(400);
  });
});
