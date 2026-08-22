// ============================================================================
// LUXEDGE — PRIVATE QWEN (OLLAMA ON COLAB) SERVER-SIDE CLIENT
//
// Talks to a private Ollama instance (qwen3.5:9b) hosted on Google Colab and
// published at https://ollama.luxedge.us behind Cloudflare Access Service
// Auth. All credentials live in server env vars ONLY:
//
//   QWEN_API_BASE_URL        (e.g. https://ollama.luxedge.us)
//   QWEN_MODEL               (e.g. qwen3.5:9b)
//   CF_ACCESS_CLIENT_ID      (Cloudflare Access service token ID)
//   CF_ACCESS_CLIENT_SECRET  (Cloudflare Access service token secret)
//
// SECURITY RULES:
//   - This module is imported ONLY by server-side /api handlers — never by
//     browser code. Secrets must never be put in VITE_* variables.
//   - Credentials are never logged, never echoed in errors, never returned to
//     the client.
//   - Google Colab runtimes disconnect: every call fails gracefully with a
//     clear, credential-free error instead of crashing the request.
// ============================================================================

export const QWEN_TIMEOUT_MS = 60_000;

export interface QwenConfig {
  baseUrl: string;
  model: string;
  clientId: string;
  clientSecret: string;
}

/**
 * Read the Qwen configuration from server env vars (null when incomplete).
 * Both the documented names (QWEN_API_BASE_URL / QWEN_MODEL) and the original
 * Colab credential file names (QWEN_COLAB_URL / QWEN_COLAB_MODEL) are
 * accepted so an existing secrets file works unchanged.
 */
export function qwenConfig(): QwenConfig | null {
  const baseUrl = (process.env.QWEN_API_BASE_URL || process.env.QWEN_COLAB_URL || '').trim().replace(/\/+$/, '');
  const model = (process.env.QWEN_MODEL || process.env.QWEN_COLAB_MODEL || '').trim();
  const clientId = (process.env.CF_ACCESS_CLIENT_ID || '').trim();
  const clientSecret = (process.env.CF_ACCESS_CLIENT_SECRET || '').trim();
  if (!baseUrl || !clientId || !clientSecret) return null;
  return { baseUrl, model: model || 'qwen3.5:9b', clientId, clientSecret };
}

export function qwenConfigured(): boolean {
  return qwenConfig() !== null;
}

/** Never include raw provider bodies — they may echo request headers/secrets. */
function sanitizeQwenError(status: number): string {
  return `Qwen3.5-9B-Colab unavailable (HTTP ${status}). Check server logs.`;
}

async function qwenPost(cfg: QwenConfig, path: string, body: unknown): Promise<unknown> {
  const signal = AbortSignal.timeout(QWEN_TIMEOUT_MS);
  let r: Response;
  try {
    r = await fetch(cfg.baseUrl + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Access-Client-Id': cfg.clientId,
        'CF-Access-Client-Secret': cfg.clientSecret,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    throw new Error(
      'Qwen3.5-9B-Colab unreachable — the Colab runtime may be disconnected or the Cloudflare Access tunnel is down.'
    );
  }
  const text = await r.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text.slice(0, 300); }
  if (!r.ok) throw new Error(sanitizeQwenError(r.status));
  return data;
}

export interface QwenMessage {
  role: string;
  content: string;
}

/** Chat-style completion via POST /api/chat (Ollama). */
export async function qwenChat(messages: QwenMessage[], opts?: { system?: string }): Promise<string> {
  const cfg = qwenConfig();
  if (!cfg) {
    throw new Error(
      'Qwen3.5-9B-Colab not configured on server (missing QWEN_API_BASE_URL / CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET env vars)'
    );
  }
  const msgs: QwenMessage[] = [];
  if (opts?.system) msgs.push({ role: 'system', content: opts.system });
  msgs.push(...messages);
  const data = (await qwenPost(cfg, '/api/chat', {
    model: cfg.model,
    messages: msgs,
    stream: false,
    options: { temperature: 0.2, num_predict: 4096 },
  })) as { message?: { content?: string } } | null;
  const text = data?.message?.content;
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Qwen returned no text');
  }
  return text;
}

/** Simple prompt completion (generate-style convenience). */
export async function qwenGenerate(prompt: string, system?: string): Promise<string> {
  return qwenChat([{ role: 'user', content: prompt }], { system });
}

export interface QwenHealth {
  configured: boolean;
  cloudflareAuth: 'PASS' | 'FAIL' | 'UNKNOWN';
  ollama: 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
  model: string;
  modelFound: boolean;
  generation: 'PASS' | 'FAIL' | 'SKIPPED';
  error?: string;
}

/**
 * Full health check:
 *   1. authenticated GET /api/tags  → proves Cloudflare Access auth + Ollama up
 *   2. qwen3.5:9b present in the tag list
 *   3. tiny generation test (reply exactly LUXEDGE-QWEN-OK)
 * Never returns credential values.
 */
export async function qwenHealth(): Promise<QwenHealth> {
  const cfg = qwenConfig();
  const model = cfg?.model || (process.env.QWEN_MODEL || 'qwen3.5:9b').trim();
  if (!cfg) {
    return {
      configured: false,
      cloudflareAuth: 'UNKNOWN',
      ollama: 'UNKNOWN',
      model,
      modelFound: false,
      generation: 'SKIPPED',
      error: 'Not configured on server (missing env vars)',
    };
  }
  try {
    const r = await fetch(cfg.baseUrl + '/api/tags', {
      headers: {
        'CF-Access-Client-Id': cfg.clientId,
        'CF-Access-Client-Secret': cfg.clientSecret,
      },
      signal: AbortSignal.timeout(QWEN_TIMEOUT_MS),
    });
    const text = await r.text();
    let data: { models?: { name?: string }[] } = {};
    try { data = text ? JSON.parse(text) : {}; } catch { /* non-JSON body */ }
    if (!r.ok) {
      return {
        configured: true,
        cloudflareAuth: 'FAIL',
        ollama: 'OFFLINE',
        model,
        modelFound: false,
        generation: 'SKIPPED',
        error: sanitizeQwenError(r.status),
      };
    }
    const names = (data.models || []).map((m) => m.name || '');
    const modelFound = names.some((n) => n === model || n.startsWith(model.split(':')[0] + ':'));
    let generation: 'PASS' | 'FAIL' = 'FAIL';
    try {
      const out = await qwenGenerate('Reply exactly: LUXEDGE-QWEN-OK');
      generation = out.trim().includes('LUXEDGE-QWEN-OK') ? 'PASS' : 'FAIL';
    } catch {
      generation = 'FAIL';
    }
    return {
      configured: true,
      cloudflareAuth: 'PASS',
      ollama: 'ONLINE',
      model,
      modelFound,
      generation,
    };
  } catch {
    return {
      configured: true,
      cloudflareAuth: 'FAIL',
      ollama: 'OFFLINE',
      model,
      modelFound: false,
      generation: 'SKIPPED',
      error: 'Connection failed — the Colab runtime may be disconnected',
    };
  }
}
