// ============================================================================
// LUXEDGE — Image Proxy (CORS/ORB bypass)
//
// Proxies external product images (CJ Dropshipping CDN) through the worker
// so browsers can load them without CORS/ORB restrictions.
// Usage: /api/img-proxy?url=<encoded-image-url>
// ============================================================================

import type { IncomingMessage, ServerResponse } from 'node:http';
const ALLOWED_HOSTS = [
  'cf.cjdropshipping.com',
  'oss-cf.cjdropshipping.com',
  'img.ltwebstatic.com',
  'ae01.alicdn.com',
];

function isAllowed(url: string): boolean {
  try {
    const u = new URL(url);
    return ALLOWED_HOSTS.some(h => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch {
    return false;
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    });
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const target = url.searchParams.get('url');

  if (!target || !isAllowed(target)) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Missing or disallowed url parameter');
    return;
  }

  try {
    const upstream = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
      redirect: 'follow',
    });

    if (!upstream.ok) {
      res.writeHead(upstream.status, { 'Content-Type': 'text/plain' });
      res.end(`Upstream returned ${upstream.status}`);
      return;
    }

    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    const cacheControl = upstream.headers.get('cache-control') || 'public, max-age=86400';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
      'Access-Control-Allow-Origin': '*',
    });

    const body = await upstream.arrayBuffer();
    res.end(Buffer.from(body));
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Image proxy error');
  }
}
