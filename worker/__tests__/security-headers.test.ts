import { describe, it, expect } from 'vitest';
import worker from '../index';
import { SECURITY_HEADERS } from '../seo-meta';

const SHELL = '<!doctype html><div id="root"></div><title>Luxedge</title>';

const HTML_ENV = {
  ASSETS: {
    fetch: async () =>
      new Response(SHELL, { status: 200, headers: { 'content-type': 'text/html' } }),
  } as unknown as import('../seo-meta').SeoEnv['ASSETS'],
};

function jsonEnv(handler: (req: Request) => Promise<Response>) {
  return {
    ASSETS: {
      fetch: async (req: Request) => handler(req),
    } as unknown as import('../seo-meta').SeoEnv['ASSETS'],
  };
}

describe('worker security headers', () => {
  it('HTML shell responses carry the full header set', async () => {
    const res = await worker.fetch(new Request('https://luxedge.us/'), HTML_ENV);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('permissions-policy')).toContain('camera=()');
    expect(res.headers.get('strict-transport-security')).toBe('max-age=86400; includeSubDomains');
    const csp = res.headers.get('content-security-policy-report-only') || '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain('frame-ancestors');
    expect(csp).toContain('*.supabase.co');
    expect(csp).toContain('www.googletagmanager.com');
    expect(csp).toContain('*.profitableratecpmnetwork.com');
    expect(csp).toContain('www.youtube.com');
  });

  it('JSON api responses carry the header set (no content-type clobber)', async () => {
    const env = jsonEnv(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const res = await worker.fetch(new Request('https://luxedge.us/api/ai/status'), env);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('www → apex 301 still redirects (immutable redirect passes through)', async () => {
    const res = await worker.fetch(new Request('https://www.luxedge.us/shop'), HTML_ENV);
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toContain('luxedge.us/shop');
  });

  it('withSecurityHeaders never overrides an existing header', async () => {
    const { withSecurityHeaders } = await import('../seo-meta');
    const res = withSecurityHeaders(
      new Response('x', { headers: { 'x-content-type-options': 'custom' } }),
    );
    expect(res.headers.get('x-content-type-options')).toBe('custom');
  });

  it('header set stays intentional: no HSTS preload, CSP is Report-Only', async () => {
    expect(SECURITY_HEADERS['strict-transport-security']).not.toContain('preload');
    expect(SECURITY_HEADERS['strict-transport-security']).toBe('max-age=86400; includeSubDomains');
    expect(Object.keys(SECURITY_HEADERS)).not.toContain('content-security-policy');
    expect(Object.keys(SECURITY_HEADERS)).toContain('content-security-policy-report-only');
  });
});
