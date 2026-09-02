// ============================================================================
// LUXEDGE — /api/admin/products contract
//
// The EASY product-creation API: one POST, admin-JWT guarded, creates the
// products row + product_images rows with 'active' status + COMMERCE_READY
// when 'live' (a row without cost/inventory would otherwise be hidden by
// the storefront readiness filter). Never accepts fabricated data: title,
// price and image URLs are validated; errors are scrubbed.
// ============================================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../_lib/auth.js', () => ({
  requireAdmin: vi.fn(),
}));

const { requireAdmin } = await import('../_lib/auth.js');
const handler = (await import('../admin/products.js')).default;

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

function makeReq(method: string, payload: Record<string, unknown>): IncomingMessage {
  const body = JSON.stringify(payload);
  const r = {
    method,
    url: '/api/admin/products',
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

describe('/api/admin/products', () => {
  const calls: { url: string; method: string; body: Record<string, unknown> | null }[] = [];
  let slugTaken = false;
  let imageConflictOnce = false;
  const originalFetch = globalThis.fetch;
  const original = {
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  beforeEach(() => {
    calls.length = 0;
    slugTaken = false;
    imageConflictOnce = false;
    process.env.VITE_SUPABASE_URL = 'https://proj.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-key';
    vi.mocked(requireAdmin).mockResolvedValue({ sub: 'admin-1', role: 'admin' } as never);
    let imageInserts = 0;
    const fetcher = async (info: RequestInfo | URL, init?: RequestInit) => {
      const url = String(info);
      calls.push({
        url: url.replace('https://proj.supabase.co/rest/v1/', ''),
        method: (init?.method as string) || 'GET',
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      });
      if (url.includes('/products?select=slug&slug=eq.')) {
        // Only the FIRST probe is taken when slugTaken is on → suffix settles at -2.
        const probes = calls.filter((c) => c.url.startsWith('products?select=slug')).length;
        return new Response(JSON.stringify(slugTaken && probes === 1 ? [{ slug: 'kong-classic-dog-toy' }] : []), { status: 200 });
      }
      if (url.endsWith('/products')) {
        return new Response(JSON.stringify([{ id: 'p-new-1' }]), { status: 201, headers: { 'content-type': 'application/json' } });
      }
      if (url.endsWith('/product_images')) {
        if (imageConflictOnce && imageInserts++ === 0) {
          return new Response(JSON.stringify({ code: '23505', message: 'duplicate key value violates unique constraint "product_images_storage_path_key"' }), { status: 409, headers: { 'content-type': 'application/json' } });
        }
        imageInserts++;
        return new Response(JSON.stringify([{ id: `img-${imageInserts}` }]), { status: 201, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    globalThis.fetch = fetcher as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.VITE_SUPABASE_URL = original.VITE_SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = original.SUPABASE_SERVICE_ROLE_KEY;
  });

  it('rejects non-POST methods with 405', async () => {
    const { captured, server } = makeRes();
    await handler(makeReq('GET', {}), server);
    expect(captured.status).toBe(405);
  });

  it('requires admin — 401/403 without a valid admin token', async () => {
    vi.mocked(requireAdmin).mockImplementationOnce(async (_req, res) => {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return null;
    });
    const { captured, server } = makeRes();
    await handler(makeReq('POST', { title: 'KONG', price: 10 }), server);
    expect(captured.status).toBe(401);
    expect(calls.length).toBe(0); // never touches Supabase
  });

  it('rejects invalid bodies with 400 (no title / bad price / bad status / bad image URL)', async () => {
    for (const [payload, msg] of [
      [{ price: 10 }, 'title'],
      [{ title: 'KONG', price: 0 }, 'price'],
      [{ title: 'KONG', price: 10, status: 'pending' }, 'status'],
      [{ title: 'KONG', price: 10, image_urls: ['ftp://x'] }, 'image_urls'],
    ] as const) {
      const { captured, server } = makeRes();
      await handler(makeReq('POST', payload as Record<string, unknown>), server);
      expect(captured.status).toBe(400);
      expect(String((captured.body as { error: string }).error)).toContain(msg);
    }
    expect(calls.length).toBe(0);
  });

  it('creates a LIVE product: active status, COMMERCE_READY, slug, URL + image rows', async () => {
    const { captured, server } = makeRes();
    await handler(makeReq('POST', {
      title: 'KONG Classic Dog Toy',
      price: 11.96,
      image_urls: ['https://img.example/1.jpg', 'https://img.example/2.jpg'],
      description: 'Durable rubber dog toy',
      brand: 'KONG',
    }), server);
    expect(captured.status).toBe(201);
    const body = captured.body as { ok: boolean; id: string; slug: string; url: string; status: string; images?: number };
    expect(body.ok).toBe(true);
    expect(body.slug).toBe('kong-classic-dog-toy');
    expect(body.url).toBe('/product/kong-classic-dog-toy');
    expect(body.status).toBe('active');
    expect(body.images).toBe(2);

    const insert = calls.find((c) => c.method === 'POST' && c.url === 'products');
    expect(insert, `calls=${JSON.stringify(calls)}`).toBeTruthy();
    const product = insert!.body as Record<string, unknown>;
    expect(product.slug).toBe('kong-classic-dog-toy');
    expect(product.status).toBe('active');
    expect(product.price).toBe(11.96);
    expect(product.commerce_readiness).toBe('COMMERCE_READY');
    expect(product.published_at).toBeTruthy();
    expect(product.tax_code).toBe('txcd_99999999');

    const imgPosts = calls.filter((c) => c.method === 'POST' && c.url === 'product_images');
    expect(imgPosts.length).toBe(2);
    expect((imgPosts[0].body as { is_primary: boolean }).is_primary).toBe(true);
    expect((imgPosts[0].body as { product_id: string }).product_id).toBe('p-new-1');
  });

  it('creates a DRAFT product (status draft, no readiness stamp) when asked', async () => {
    const { captured, server } = makeRes();
    await handler(makeReq('POST', { title: 'Test Draft', price: 5, status: 'draft' }), server);
    expect(captured.status).toBe(201);
    const product = calls.find((c) => c.method === 'POST' && c.url === 'products')!.body as Record<string, unknown>;
    expect(product.status).toBe('draft');
    expect(product.commerce_readiness).toBeNull();
    expect(product.published_at).toBeNull();
  });

  it('survives a product_images storage_path UNIQUE conflict (live-db drift): retries with a uniquified storage_path', async () => {
    imageConflictOnce = true; // simulate the out-of-band unique constraint 409 on the first insert
    const { captured, server } = makeRes();
    await handler(makeReq('POST', { title: 'KONG Classic Dog Toy', price: 9.99, image_urls: ['https://img.example/1.jpg'] }), server);
    expect(captured.status).toBe(201);
    expect((captured.body as { images: number }).images).toBe(1);
    const imgPosts = calls.filter((c) => c.method === 'POST' && c.url === 'product_images');
    expect(imgPosts.length).toBe(2); // original + retry with uniquified storage_path
    const retry = imgPosts[1].body as { storage_path: string; url: string };
    expect(retry.url).toBe('https://img.example/1.jpg'); // display URL untouched
    expect(retry.storage_path).toContain('https://img.example/1.jpg#api-'); // legacy column uniquified
  });

  it('dedupes a taken slug with a numeric suffix', async () => {
    slugTaken = true;
    const { captured, server } = makeRes();
    await handler(makeReq('POST', { title: 'KONG Classic Dog Toy', price: 9.99 }), server);
    const body = captured.body as { slug: string };
    expect(body.slug).toBe('kong-classic-dog-toy-2');
  });
});