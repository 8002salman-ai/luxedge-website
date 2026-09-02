import { describe, it, expect } from 'vitest';
import worker from '../index';

const SHELL = '<!doctype html><div id="root"></div><title>Luxedge</title>';

async function call(path: string) {
  const env = {
    ASSETS: {
      fetch: async () => new Response(SHELL, { status: 200, headers: { 'content-type': 'text/html' } }),
    } as unknown as import('../seo-meta').SeoEnv['ASSETS'],
  };
  const req = new Request('https://luxedge-production.8002salman.workers.dev' + path);
  return worker.fetch(req, env);
}

describe('worker fetch — legacy UUID product URL redirect', () => {
  it('known UUID param → 301 with slug Location', async () => {
    const res = await call('/product/9e1927f7-cde7-46bc-9e14-662dca6c6b3a');
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toContain('/product/horse-grooming-kit-12-piece');
  });
});