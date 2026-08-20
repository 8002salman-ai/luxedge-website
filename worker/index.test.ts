import { describe, expect, it } from 'vitest';
import { ROUTES, runNodeHandler } from './index';

describe('Cloudflare Node handler adapter', () => {
  it('routes every Vercel API function', () => {
    expect(Object.keys(ROUTES).sort()).toEqual([
      '/api/ai/generate',
      '/api/ai/openrouter-credits',
      '/api/ai/status',
      '/api/ai/test',
      '/api/checkout',
      '/api/fetch-page',
      '/api/hermes/ingest',
      '/api/import-images',
      '/api/market-demand/google-ads',
      '/api/salman-os',
      '/api/suppliers/cj',
      '/api/webhook',
    ]);
  });

  it('preserves method handling', async () => {
    const response = await runNodeHandler(
      new Request('https://staging.example/api/checkout', { method: 'PUT' }),
      ROUTES['/api/checkout'],
    );
    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({ error: 'Method not allowed' });
  });

  it('preserves Stripe raw request body and headers', async () => {
    const response = await runNodeHandler(
      new Request('https://staging.example/api/webhook', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': 't=1,v1=invalid',
        },
        body: '{"type":"checkout.session.completed"}',
      }),
      ROUTES['/api/webhook'],
    );
    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toBe('application/json');
  });
});
