// ============================================================================
// LUXEDGE — Cloudflare Workers entry
//
// Runs the existing Vercel-style api/* handlers (`handler(req, res)` with
// `sendJson`/`sendText`/`readJsonBody` from api/_lib/providers.ts) on the
// Cloudflare runtime by adapting Request → a minimal IncomingMessage shim and
// building a Response from a minimal ServerResponse shim. Static assets (the
// Vite build in dist/) are served through the ASSETS binding with SPA
// fallback configured in wrangler.toml.
//
// No secret is ever handled here: handlers read process.env bindings exactly
// as they do on Vercel.
// ============================================================================
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';

import fetchPageHandler from '../api/fetch-page';
import aiStatusHandler from '../api/ai/status';
import aiGenerateHandler from '../api/ai/generate';
import aiTestHandler from '../api/ai/test';
import aiCreditsHandler from '../api/ai/openrouter-credits';
import importImagesHandler from '../api/import-images';
import uploadImageHandler from '../api/upload-image';
import checkoutHandler from '../api/checkout';
import webhookHandler from '../api/webhook';
import salmanOsHandler from '../api/salman-os';
import cjHandler from '../api/suppliers/cj';
import hermesIngestHandler from '../api/hermes/ingest';
import googleAdsHandler from '../api/market-demand/google-ads';
import omnisendStatusHandler from '../api/omnisend/status';

type NodeHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

/** Shape of the ServerResponse shim produced by makeRes(). */
interface ShimRes extends ServerResponse {
  _status: number;
  _headers: Record<string, string>;
  _body: string;
}

interface Route {
  path: string;
  handler: NodeHandler;
}

const ROUTES: Route[] = [
  { path: '/api/ai/status', handler: aiStatusHandler },
  { path: '/api/ai/generate', handler: aiGenerateHandler },
  { path: '/api/ai/test', handler: aiTestHandler },
  { path: '/api/ai/openrouter-credits', handler: aiCreditsHandler },
  { path: '/api/fetch-page', handler: fetchPageHandler },
  { path: '/api/import-images', handler: importImagesHandler },
  { path: '/api/upload-image', handler: uploadImageHandler },
  { path: '/api/checkout', handler: checkoutHandler },
  { path: '/api/webhook', handler: webhookHandler },
  { path: '/api/salman-os', handler: salmanOsHandler },
  { path: '/api/suppliers/cj', handler: cjHandler },
  { path: '/api/hermes/ingest', handler: hermesIngestHandler },
  { path: '/api/market-demand/google-ads', handler: googleAdsHandler },
  { path: '/api/omnisend/status', handler: omnisendStatusHandler },
];

/**
 * Minimal IncomingMessage shim: EventEmitter + method/url/headers/socket + body events.
 *
 * The body is buffered and delivered exactly like a Node stream in paused mode:
 * 'data' then 'end' are only emitted once a listener is attached. Handlers call
 * readJsonBody AFTER an await (e.g. requireAdmin does a network call), so the
 * body must not be emitted before the handler subscribes — otherwise the
 * pending readJsonBody never resolves and the Worker hangs.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeReq(request: Request, url: URL): IncomingMessage {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const req: any = new EventEmitter();
  req.method = request.method;
  req.url = url.pathname + url.search;
  req.headers = {};
  request.headers.forEach((value, key) => {
    req.headers[key.toLowerCase()] = value;
  });
  req.socket = {
    remoteAddress: request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || '',
  };
  req.destroy = () => undefined;

  let bodyReady = false;
  let bodyEmitted = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let bodyBuffer: any = Buffer.alloc(0);
  const emitBody = () => {
    if (bodyEmitted) return;
    bodyEmitted = true;
    if (bodyBuffer.length > 0) req.emit('data', bodyBuffer);
    // Defer 'end' so listeners attached synchronously after 'data' (as
    // readJsonBody does) are registered before it fires — real Node streams
    // never emit 'end' before the consumer has subscribed.
    queueMicrotask(() => req.emit('end'));
  };
  request
    .arrayBuffer()
    .then((buf) => {
      bodyBuffer = Buffer.from(buf);
      bodyReady = true;
      // If the handler already subscribed (listener attached before the body
      // arrived), deliver now.
      if (req.listenerCount('data') > 0 || req.listenerCount('end') > 0) emitBody();
    })
    .catch((err) => req.emit('error', err));
  const origOn = req.on.bind(req);
  req.on = (event: string, fn: (...args: unknown[]) => void) => {
    const result = origOn(event, fn);
    if ((event === 'data' || event === 'end') && bodyReady) emitBody();
    return result;
  };
  return req as IncomingMessage;
}

/** Minimal ServerResponse shim capturing statusCode/headers/body. */
function makeRes(): ServerResponse {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = {
    _status: 200,
    _headers: {} as Record<string, string>,
    _body: '',
    statusCode: 200,
    setHeader(name: string, value: string) {
      res._headers[String(name).toLowerCase()] = String(value);
    },
    write(chunk: string | Uint8Array) {
      res._body += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    },
    end(chunk?: string | Uint8Array) {
      if (chunk !== undefined && chunk !== null) {
        res._body += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      }
    },
  };
  Object.defineProperty(res, 'statusCode', {
    get: () => res._status,
    set: (v: number) => {
      res._status = v;
    },
    enumerable: true,
    configurable: true,
  });
  return res as ServerResponse;
}

interface AssetsFetcher {
  fetch(input: Request): Promise<Response>;
}

export interface Env {
  ASSETS: AssetsFetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const route = ROUTES.find((r) => r.path === url.pathname);
    if (route) {
      const req = makeReq(request, url);
      const res = makeRes() as ShimRes;
      try {
        await route.handler(req, res);
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      const contentType =
        res._headers['content-type'] || 'text/plain; charset=utf-8';
      return new Response(res._body || '', {
        status: res._status,
        headers: { ...res._headers, 'content-type': contentType },
      });
    }
    // Everything else → static assets, with an explicit SPA fallback so
    // client-side routes (/admin, /product/:slug, …) serve index.html.
    const assetRes = await env.ASSETS.fetch(request);
    if (assetRes.status === 404 && !url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(new Request(url.origin + '/', request));
    }
    return assetRes;
  },
};
