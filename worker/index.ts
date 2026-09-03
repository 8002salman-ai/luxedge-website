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
import adminProductsHandler from '../api/admin/products';
import hermesIngestHandler from '../api/hermes/ingest';
import marketIntelTrendsHandler from '../api/market-intel/trends';
import googleAdsHandler from '../api/market-demand/google-ads';
import omnisendStatusHandler from '../api/omnisend/status';
import emailSendHandler from '../api/email/send';
import emailStatusHandler from '../api/email/status';
import emailRoutesHandler from '../api/email/routes';
import mediaGenerateHandler from '../api/media/generate';
import mediaSyncHandler, { runMediaSync } from '../api/media/sync';
import crmWelcomeHandler from '../api/crm/welcome';
import crmSubscribeHandler from '../api/crm/subscribe';
import crmLeadHandler from '../api/crm/lead';
import crmListHandler from '../api/crm/list';
import crmAssistantHandler from '../api/crm/assistant';
import cjKeyHandler from '../api/admin/cj-key';
import aiKeysHandler from '../api/admin/ai-keys';
import googleFeedHandler from '../api/google-feed';
import imgProxyHandler from '../api/img-proxy';
import { maybeInjectSeo } from './seo-meta';
import { buildSitemap, buildVideoSitemap } from './sitemap';
import blogAutomationHandler from '../api/blog-automation/index';
import adsenseHandler, { setAdSenseRuntimeBindings } from '../api/adsense/index';

type NodeHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

/** Shape of the ServerResponse shim produced by makeRes(). */
interface ShimRes extends ServerResponse {
  _status: number;
  _headers: Record<string, string>;
  _body: string;
  _chunks: Uint8Array[];
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
  { path: '/api/email/send', handler: emailSendHandler },
  { path: '/api/email/status', handler: emailStatusHandler },
  { path: '/api/email/routes', handler: emailRoutesHandler },
  { path: '/api/media/generate', handler: mediaGenerateHandler },
  { path: '/api/media/sync', handler: mediaSyncHandler },
  { path: '/api/crm/welcome', handler: crmWelcomeHandler },
  { path: '/api/crm/subscribe', handler: crmSubscribeHandler },
  { path: '/api/crm/lead', handler: crmLeadHandler },
  { path: '/api/crm/list', handler: crmListHandler },
  { path: '/api/crm/assistant', handler: crmAssistantHandler },
  { path: '/api/admin/cj-key', handler: cjKeyHandler },
  { path: '/api/admin/ai-keys', handler: aiKeysHandler },
  { path: '/api/admin/products', handler: adminProductsHandler },
  { path: '/google-products.xml', handler: googleFeedHandler },
  { path: '/api/img-proxy', handler: imgProxyHandler },
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
    _chunks: [] as Uint8Array[],
    statusCode: 200,
    writeHead(status: number, headers?: Record<string, string>) {
      res._status = status;
      if (headers) {
        for (const [k, v] of Object.entries(headers)) {
          res.setHeader(k, v);
        }
      }
    },
    setHeader(name: string, value: string) {
      res._headers[String(name).toLowerCase()] = String(value);
    },
    write(chunk: string | Uint8Array) {
      if (typeof chunk === 'string') res._body += chunk;
      else res._chunks.push(chunk);
    },
    end(chunk?: string | Uint8Array) {
      if (chunk !== undefined && chunk !== null) {
        if (typeof chunk === 'string') res._body += chunk;
        else res._chunks.push(chunk);
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
  /** CJ supplier credential — a Cloudflare secret binding, never client-side. */
  CJ_API_KEY?: string;
  /** YouTube Data API key — a Cloudflare secret binding (wrangler secret put). */
  YOUTUBE_API_KEY?: string;
  GOOGLE_ADSENSE_CLIENT_ID?: string;
  GOOGLE_ADSENSE_CLIENT_SECRET?: string;
  SEND_MAIL?: {
    send: (msg: { from: string; to: string; subject: string; html?: string; text?: string; reply_to?: string }) => Promise<void>;
  };
}

/**
 * The API modules were originally written for a Node/Vercel runtime and read
 * configuration from process.env. Cloudflare provides bindings on `env` per
 * request, so expose string bindings to those compatible handlers without
 * replacing the process.env object or serialising non-string bindings.
 */
function populateProcessEnv(env: Env): void {
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') process.env[key] ??= value;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    populateProcessEnv(env);
    // Secret bindings are not guaranteed to be enumerable in every Worker
    // runtime. CJ's server handler reads process.env, so preserve this one
    // explicitly instead of silently reporting a configured key as missing.
    if (env.CJ_API_KEY) process.env.CJ_API_KEY = env.CJ_API_KEY;
    const url = new URL(request.url);
    // Canonical host + scheme: www and HTTP must permanently redirect to the
    // non-www HTTPS apex, preserving the full path+query. Prevents a
    // duplicate-host index (Google was indexing www.luxedge.us as a separate
    // site) and a mixed-content/HTTP duplicate.
    const host = (url.hostname || '').toLowerCase();
    const needsRedirect = host === 'www.luxedge.us' || url.protocol === 'http:';
    if (needsRedirect) {
      const target = new URL(url.pathname + url.search, 'https://luxedge.us');
      // Preserve the hash is not possible server-side (browsers strip it),
      // but path+query are fully retained.
      return Response.redirect(target.toString(), 301);
    }
    // Consolidate the duplicate /home homepage (Google has indexed both /
    // and /home/) into a single canonical URL with a permanent redirect.
    if (url.pathname === '/home' || url.pathname === '/home/') {
      return Response.redirect(new URL('/', url.origin).toString(), 301);
    }
    // Dynamic sitemap from the LIVE database (CMS blogs + products + categories
    // + media videos) so publishing updates sitemap.xml without a redeploy.
    // Falls back to the static file when the DB is unreachable / not migrated.
    if (url.pathname === '/sitemap.xml') {
      const sitemap = await buildSitemap();
      if (sitemap) {
        return new Response(sitemap, {
          status: 200,
          headers: {
            'content-type': 'application/xml; charset=utf-8',
            'cache-control': 'public, max-age=300',
          },
        });
      }
    }
    // Google Video sitemap (media library) — real data only. When the DB is
    // unreachable / media_videos is not yet migrated (buildVideoSitemap
    // returns null), serve an EMPTY but valid video sitemap — never the SPA
    // shell, so robots.txt's reference can never hand Google HTML as XML.
    if (url.pathname === '/video-sitemap.xml') {
      const videoSitemap = await buildVideoSitemap();
      if (videoSitemap) {
        return new Response(videoSitemap, {
          status: 200,
          headers: {
            'content-type': 'application/xml; charset=utf-8',
            'cache-control': 'public, max-age=300',
          },
        });
      }
      return new Response(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">\n</urlset>\n',
        {
          status: 200,
          headers: {
            'content-type': 'application/xml; charset=utf-8',
            'cache-control': 'public, max-age=300',
          },
        },
      );
    }
    // Google AdSense earnings API (server-side). Routed by path prefix
    // because it has multiple sub-routes (status/auth/oauth/sync/earnings).
    if (url.pathname.startsWith('/api/adsense')) {
      // Cloudflare bindings can be non-enumerable, so pass OAuth bindings
      // explicitly instead of relying on Object.entries(env).
      setAdSenseRuntimeBindings({
        GOOGLE_ADSENSE_CLIENT_ID: env.GOOGLE_ADSENSE_CLIENT_ID,
        GOOGLE_ADSENSE_CLIENT_SECRET: env.GOOGLE_ADSENSE_CLIENT_SECRET,
      });
      const req = makeReq(request, url) as IncomingMessage & { env?: Env };
      req.env = env;
      const res = makeRes() as ShimRes;
      try {
        await adsenseHandler(req, res);
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      const contentType = res._headers['content-type'] || 'text/plain; charset=utf-8';
      return new Response(res._body || '', { status: res._status, headers: { ...res._headers, 'content-type': contentType } });
    }
    // Market intelligence API (server-side, admin-JWT). Routed by path prefix
    // because it has multiple sub-routes (trends jobs: list/claim/result).
    if (url.pathname.startsWith('/api/market-intel')) {
      const req = makeReq(request, url) as IncomingMessage & { env?: Env };
      req.env = env;
      const res = makeRes() as ShimRes;
      try {
        await marketIntelTrendsHandler(req, res);
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      const contentType = res._headers['content-type'] || 'text/plain; charset=utf-8';
      return new Response(res._body || '', { status: res._status, headers: { ...res._headers, 'content-type': contentType } });
    }
    // Blog automation API (server-side, blog-scoped). Routed by path prefix
    // because it has multiple sub-routes (draft/publish/posts/check-slug/{id}).
    if (url.pathname.startsWith('/blog-automation')) {
      const req = makeReq(request, url) as IncomingMessage & { env?: Env };
      req.env = env;
      const res = makeRes() as ShimRes;
      try {
        await blogAutomationHandler(req, res);
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      const contentType = res._headers['content-type'] || 'text/plain; charset=utf-8';
      return new Response(res._body || '', { status: res._status, headers: { ...res._headers, 'content-type': contentType } });
    }
    const route = ROUTES.find((r) => r.path === url.pathname);
    if (route) {
      const req = makeReq(request, url) as IncomingMessage & { env?: Env };
      // Attach runtime bindings so api/* handlers (Vercel-style, env-less)
      // can reach worker bindings such as the send_email SEND_MAIL binding.
      req.env = env;
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
      // Binary payloads (image proxy) must be returned as bytes — the string
      // `_body` path corrupts them.
      let body: BodyInit = res._body || '';
      if (res._chunks.length > 0) {
        const total = res._chunks.reduce((n: number, c: Uint8Array) => n + c.byteLength, 0);
        const buf = new Uint8Array(total);
        let off = 0;
        for (const c of res._chunks) {
          buf.set(c, off);
          off += c.byteLength;
        }
        body = buf;
      }
      return new Response(body, {
        status: res._status,
        headers: { ...res._headers, 'content-type': contentType },
      });
    }
    // Everything else → static assets, with an explicit SPA fallback so
    // client-side routes (/admin, /product/:slug, …) serve index.html.
    // Crawlers get per-route server-side SEO meta injected into the shell
    // (title/description/canonical/JSON-LD) so Google can index each page
    // with its real title instead of the generic one.
    if (url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }
    const lastSeg = url.pathname.split('/').filter(Boolean).pop() || '';
    const isFileLike = lastSeg.includes('.');
    if (isFileLike) {
      return env.ASSETS.fetch(request);
    }
    const indexRes = await env.ASSETS.fetch(new Request(url.origin + '/', request));
    if (request.method === 'GET' && indexRes.ok) {
      // Read the shell once and ALWAYS return a fresh Response — the original
      // response body is consumed by text(), so returning it would 500.
      const html = await indexRes.text();
      const injected = await maybeInjectSeo(
        html,
        url.pathname,
        url.origin,
        env,
      );
      if (injected) {
        // Legacy /product/<uuid> → /product/<slug> consolidation (PR #35
        // residual): 301 with the query string preserved.
        if ('redirect' in injected) {
          return Response.redirect(new URL(injected.redirect + url.search, url.origin).toString(), 301);
        }
        return new Response(injected.html, {
          status: injected.status,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'public, max-age=60',
          },
        });
      }
      return new Response(html, {
        status: indexRes.status,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'public, max-age=300',
        },
      });
    }
    return indexRes;
  },

  /**
   * Scheduled auto-sync (wrangler.toml [triggers], every 6 hours): pulls the
   * official channel's uploads into media_videos so new videos appear on
   * /media without a manual Sync click. Shares runMediaSync() with the admin
   * endpoint (api/media/sync.ts) — idempotent upsert, ~3 YouTube Data API
   * quota units per run. Clean no-op (logged) when not configured; the cron
   * trigger itself is not externally invokable.
   */
  async scheduled(_event: unknown, env: Env): Promise<void> {
    populateProcessEnv(env);
    if (env.YOUTUBE_API_KEY) process.env.YOUTUBE_API_KEY = env.YOUTUBE_API_KEY;
    const result = await runMediaSync();
    if (!result.ok) {
      console.error(`[media-cron] sync skipped: ${result.error || 'unknown error'}`);
      return;
    }
    console.log(`[media-cron] sync ok: synced=${result.synced ?? 0} created=${result.created ?? 0} updated=${result.updated ?? 0}`);
  },
};
