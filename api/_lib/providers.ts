// ============================================================================
// LUXEDGE V2 — SERVER-SIDE AI PROVIDER LAYER
//
// This code runs ONLY inside /api serverless functions (never in the browser).
// Provider API keys are read exclusively from environment variables.
//
// SECURITY RULES (enforced here):
//  - Keys are never logged, never echoed in errors, never returned to clients.
//  - Only provider id + model + prompt travel between browser and server.
//  - Response payloads never include the key.
// ============================================================================

import type { IncomingMessage, ServerResponse } from 'node:http';

/** Hard cap on outbound provider calls — prevents hung serverless functions. */
export const FETCH_TIMEOUT_MS = 45_000;

/**
 * Rate limiter boundary. Today an in-memory per-instance limiter is used.
 * Honest limitation: serverless instances are ephemeral, so this throttles
 * per warm instance only and is NOT a global rate limit. A future shared
 * limiter (Upstash / Vercel KV) can implement the same interface without
 * touching any endpoint — Phase 3B+.
 */
export interface RateLimiter {
  isLimited(key: string): boolean;
}

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;

/** In-memory per-instance limiter (current implementation). */
export class InMemoryRateLimiter implements RateLimiter {
  private hits = new Map<string, number[]>();

  isLimited(key: string): boolean {
    const now = Date.now();
    const arr = (this.hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
    if (arr.length >= MAX_PER_WINDOW) {
      this.hits.set(key, arr);
      return true;
    }
    arr.push(now);
    this.hits.set(key, arr);
    return false;
  }
}

/** Active limiter — swap this for a shared implementation later. */
export const limiter: RateLimiter = new InMemoryRateLimiter();

export function clientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

export function rateLimited(ip: string): boolean {
  return limiter.isLimited(ip);
}

/** Allow only sane model identifiers — prevents URL/query injection. */
export function isValidModel(model: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:/\-]{0,127}$/.test(model);
}

export const PROVIDER_ENV: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  codex: 'CODEX_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

export const PROVIDER_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  codex: 'OpenAI Codex',
  deepseek: 'DeepSeek',
  anthropic: 'Anthropic Claude',
  openrouter: 'OpenRouter',
  gemini: 'Google Gemini',
};

export function isConfigured(providerId: string): boolean {
  const envName = PROVIDER_ENV[providerId];
  if (!envName) return false;
  return Boolean(process.env[envName] && process.env[envName]!.trim());
}

export function configuredProviders(): string[] {
  return Object.keys(PROVIDER_ENV).filter(isConfigured);
}

export function providerKey(providerId: string): string {
  const envName = PROVIDER_ENV[providerId];
  if (!envName) return '';
  const primary = process.env[envName] || '';
  if (primary) return primary;
  // Codex may authenticate via the Freebuff ChatGPT OAuth token instead of an API key.
  if (providerId === 'codex') return process.env['CHATGPT_OAUTH_TOKEN'] || '';
  return '';
}

function sanitizeError(providerId: string, status: number): string {
  // Never include raw provider error bodies — they may echo request headers/keys.
  return `${PROVIDER_NAMES[providerId] || providerId} error (HTTP ${status}). Check server logs for details.`;
}

export interface GenerateOptions {
  prompt: string;
  model: string;
  system?: string;
}

/** Call the requested provider from the server. Throws on failure. */
export async function generate(providerId: string, opts: GenerateOptions): Promise<string> {
  const key = providerKey(providerId);
  if (!key) throw new Error(`${PROVIDER_NAMES[providerId] || providerId} not configured on server (missing ${PROVIDER_ENV[providerId]} env var)`);
  const { prompt, model, system } = opts;
  if (!isValidModel(model)) throw new Error('Invalid model identifier');
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  switch (providerId) {
    case 'openai':
    case 'deepseek': {
      const base = providerId === 'openai' ? 'https://api.openai.com/v1/chat/completions' : 'https://api.deepseek.com/chat/completions';
      const r = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          { role: 'user', content: prompt },
        ], temperature: 0.2, max_tokens: 4096 }),
        signal,
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(sanitizeError(providerId, r.status));
      const text = d?.choices?.[0]?.message?.content;
      if (typeof text !== 'string') throw new Error(`${PROVIDER_NAMES[providerId]} returned no text`);
      return text;
    }
    case 'gemini': {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 4096 } }),
        signal,
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(sanitizeError(providerId, r.status));
      const text = d?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text !== 'string') throw new Error('Gemini returned no text');
      return text;
    }
    case 'openrouter': {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'HTTP-Referer': 'https://luxedge.us', 'X-Title': 'Luxedge' },
        body: JSON.stringify({ model, messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          { role: 'user', content: prompt },
        ], temperature: 0.2 }),
        signal,
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(sanitizeError(providerId, r.status));
      const text = d?.choices?.[0]?.message?.content;
      if (typeof text !== 'string') throw new Error('OpenRouter returned no text');
      return text;
    }
    case 'anthropic': {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 4096, system: system || undefined, messages: [{ role: 'user', content: prompt }] }),
        signal,
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(sanitizeError(providerId, r.status));
      const text = d?.content?.[0]?.text;
      if (typeof text !== 'string') throw new Error('Anthropic returned no text');
      return text;
    }
    case 'codex': {
      // OpenAI Codex uses the Responses API (OpenAI-compatible bearer auth).
      const r = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, instructions: system || undefined, input: prompt, temperature: 0.2, max_output_tokens: 4096 }),
        signal,
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(sanitizeError(providerId, r.status));
      let text: string | undefined;
      if (typeof d?.output_text === 'string') text = d.output_text;
      else if (Array.isArray(d?.output)) {
        text = d.output.map((o: { content?: { text?: string }[] }) =>
          Array.isArray(o?.content) ? o.content.map((c) => (typeof c?.text === 'string' ? c.text : '')).join('') : ''
        ).join('');
      }
      if (typeof text !== 'string' || !text.trim()) throw new Error('Codex returned no text');
      return text;
    }
    default:
      throw new Error(`Unknown provider: ${providerId}`);
  }
}

/** Generate with bounded retries + linear backoff (never infinite). */
export async function generateWithRetry(providerId: string, opts: GenerateOptions, attempts = 2): Promise<string> {
  let lastErr: Error | null = null;
  for (let i = 0; i <= attempts; i++) {
    try {
      return await generate(providerId, opts);
    } catch (e) {
      lastErr = e as Error;
      if (i < attempts) await new Promise((resolve) => setTimeout(resolve, 300 * (i + 1)));
    }
  }
  throw lastErr || new Error('Generation failed');
}

export interface FallbackResult {
  text: string;
  provider: string;
  model: string;
  fallbackUsed: boolean;
}

/**
 * Generate with a primary provider, falling back to the configured fallback
 * provider when the primary fails. Never silently succeeds — if both fail a
 * combined error is thrown with the fallback provider's message.
 */
export async function generateWithFallback(
  providerId: string,
  fallbackProviderId: string | null | undefined,
  opts: GenerateOptions,
): Promise<FallbackResult> {
  try {
    const text = await generateWithRetry(providerId, opts);
    return { text, provider: providerId, model: opts.model, fallbackUsed: false };
  } catch (primaryErr) {
    if (fallbackProviderId && fallbackProviderId !== providerId && isConfigured(fallbackProviderId)) {
      try {
        const fallbackModel = defaultModelFor(fallbackProviderId) || opts.model;
        const text = await generateWithRetry(fallbackProviderId, { ...opts, model: fallbackModel });
        return { text, provider: fallbackProviderId, model: fallbackModel, fallbackUsed: true };
      } catch (fallbackErr) {
        throw new Error(`${PROVIDER_NAMES[providerId]} failed and fallback ${PROVIDER_NAMES[fallbackProviderId]} also failed. Last error: ${(fallbackErr as Error).message}`);
      }
    }
    throw primaryErr;
  }
}

/** Test connectivity server-side. Never leaks the key. */
export async function testProvider(providerId: string, model?: string): Promise<{ ok: boolean; message: string }> {
  if (!isConfigured(providerId)) {
    return { ok: false, message: `Not configured — add ${PROVIDER_ENV[providerId]} env var on the server` };
  }
  try {
    const text = await generate(providerId, {
      prompt: 'Reply with only: OK',
      model: model || defaultModelFor(providerId),
    });
    return { ok: true, message: text.trim().includes('OK') ? 'Connected successfully!' : 'Connected (unexpected reply)' };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export function defaultModelFor(providerId: string): string {
  switch (providerId) {
    case 'openai': return 'gpt-4o-mini';
    case 'codex': return 'gpt-5-codex';
    case 'deepseek': return 'deepseek-v4-flash';
    case 'anthropic': return 'claude-haiku-4-5-20251001';
    case 'gemini': return 'gemini-2.0-flash-exp';
    case 'openrouter': return 'nvidia/nemotron-3-super-120b-a12b:free';
    default: return '';
  }
}

/** Read a JSON request body (bounded to prevent abuse). */
export function readJsonBody(req: IncomingMessage, maxBytes = 200_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      body += chunk.toString('utf8');
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

export function sendText(res: ServerResponse, status: number, text: string): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(text);
}
