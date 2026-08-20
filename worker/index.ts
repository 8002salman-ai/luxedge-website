import { Readable } from 'node:stream';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';

import checkout from '../api/checkout.js';
import webhook from '../api/webhook.js';
import fetchPage from '../api/fetch-page.js';
import importImages from '../api/import-images.js';
import salmanOs from '../api/salman-os.js';
import suppliersCj from '../api/suppliers/cj.js';
import hermesIngest from '../api/hermes/ingest.js';
import googleAds from '../api/market-demand/google-ads.js';
import aiGenerate from '../api/ai/generate.js';
import aiStatus from '../api/ai/status.js';
import aiTest from '../api/ai/test.js';
import openrouterCredits from '../api/ai/openrouter-credits.js';

type NodeHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;

export const ROUTES: Readonly<Record<string, NodeHandler>> = {
  '/api/checkout': checkout,
  '/api/webhook': webhook,
  '/api/fetch-page': fetchPage,
  '/api/import-images': importImages,
  '/api/salman-os': salmanOs,
  '/api/suppliers/cj': suppliersCj,
  '/api/hermes/ingest': hermesIngest,
  '/api/market-demand/google-ads': googleAds,
  '/api/ai/generate': aiGenerate,
  '/api/ai/status': aiStatus,
  '/api/ai/test': aiTest,
  '/api/ai/openrouter-credits': openrouterCredits,
};

class WorkerIncomingMessage extends Readable {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  socket: { remoteAddress?: string };
  private readonly body: Uint8Array;
  private sent = false;

  constructor(request: Request, body: Uint8Array) {
    super();
    const url = new URL(request.url);
    this.method = request.method;
    this.url = `${url.pathname}${url.search}`;
    this.headers = Object.fromEntries(
      Array.from(request.headers.entries(), ([key, value]) => [key.toLowerCase(), value]),
    );
    this.socket = {
      remoteAddress:
        request.headers.get('cf-connecting-ip') ||
        request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        undefined,
    };
    this.body = body;
  }

  override _read(): void {
    if (this.sent) return;
    this.sent = true;
    if (this.body.byteLength > 0) this.push(Buffer.from(this.body));
    this.push(null);
  }
}

class WorkerServerResponse {
  statusCode = 200;
  private readonly headers = new Headers();
  private readonly chunks: Uint8Array[] = [];
  private finished = false;
  private readonly resolveResponse: (response: Response) => void;
  readonly response: Promise<Response>;

  constructor() {
    let resolveResponse!: (response: Response) => void;
    this.response = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    this.resolveResponse = resolveResponse;
  }

  setHeader(name: string, value: number | string | readonly string[]): this {
    this.headers.delete(name);
    if (Array.isArray(value)) {
      for (const item of value) this.headers.append(name, String(item));
    } else {
      this.headers.set(name, String(value));
    }
    return this;
  }

  getHeader(name: string): string | null {
    return this.headers.get(name);
  }

  write(chunk: string | Uint8Array): boolean {
    if (this.finished) return false;
    this.chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
    return true;
  }

  end(chunk?: string | Uint8Array): this {
    if (this.finished) return this;
    if (chunk !== undefined) this.write(chunk);
    this.finished = true;
    const size = this.chunks.reduce((total, item) => total + item.byteLength, 0);
    const body = new Uint8Array(size);
    let offset = 0;
    for (const item of this.chunks) {
      body.set(item, offset);
      offset += item.byteLength;
    }
    this.resolveResponse(new Response(body.byteLength ? body : null, {
      status: this.statusCode,
      headers: this.headers,
    }));
    return this;
  }
}

export async function runNodeHandler(request: Request, handler: NodeHandler): Promise<Response> {
  const contentLength = Number(request.headers.get('content-length') || '0');
  if (Number.isFinite(contentLength) && contentLength > 10 * 1024 * 1024) {
    return Response.json({ error: 'Request body too large' }, { status: 413 });
  }
  const body = request.method === 'GET' || request.method === 'HEAD'
    ? new Uint8Array()
    : new Uint8Array(await request.arrayBuffer());
  const req = new WorkerIncomingMessage(request, body) as unknown as IncomingMessage;
  const response = new WorkerServerResponse();
  await handler(req, response as unknown as ServerResponse);
  return response.response;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const handler = ROUTES[url.pathname.replace(/\/$/, '')];
    if (!handler) return env.ASSETS.fetch(request);
    try {
      return await runNodeHandler(request, handler);
    } catch (error) {
      console.error(JSON.stringify({
        message: 'Cloudflare API adapter failed',
        path: url.pathname,
        error: error instanceof Error ? error.message : String(error),
      }));
      return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
