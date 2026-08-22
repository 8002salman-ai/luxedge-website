// ============================================================================
// LUXEDGE V2 — AI CLIENT (secure server proxy)
//
// The browser NEVER holds an AI provider API key and NEVER calls a provider
// endpoint directly. All generation, connection tests and credit checks go
// through the serverless /api/ai/* endpoints, which read keys from
// environment variables and keep them out of browser bundles, localStorage,
// console output and error messages.
// ============================================================================

import type { AIProvider } from './types';
import { loadProviderSettings, resolveProviderChain, DEFAULT_AI_PROVIDERS } from './providers';
import { getAccessToken } from '../../services/supabase';

const API_BASE = '/api';

export interface ProviderStatus {
  id: string;
  name: string;
  configured: boolean;
  model: string;
}

export interface ProviderStatusMap {
  providers: ProviderStatus[];
  backend: 'configured' | 'missing';
}

async function parseJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    throw new Error('AI backend returned a non-JSON response. Are the /api serverless functions deployed (see .env.example)?');
  }
}

function authHeaders(): Record<string, string> {
  // /api/ai/* and /api/fetch-page require an authenticated admin session
  // (Phase 3A). Attach the Supabase access token when one exists; the server
  // responds 401/403 otherwise. The token is never stored/logged by us.
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('AI backend not reachable. Deploy the /api serverless functions (see .env.example) to enable server-side AI.');
  }
  const data = await parseJson(res);
  if (!res.ok) {
    const serverMsg = (data as { error?: string }).error;
    const status = res.status;
    const message =
      status === 401 || status === 403
        ? 'Admin session required — sign in to the admin dashboard and try again.'
        : serverMsg || `AI backend error (HTTP ${status})`;
    throw new Error(message);
  }
  return data as T;
}

async function get<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
  } catch {
    throw new Error('AI backend not reachable. Deploy the /api serverless functions (see .env.example) to enable server-side AI.');
  }
  const data = await parseJson(res);
  if (!res.ok) {
    const serverMsg = (data as { error?: string }).error;
    const status = res.status;
    const message =
      status === 401 || status === 403
        ? 'Admin session required — sign in to the admin dashboard and try again.'
        : serverMsg || `AI backend error (HTTP ${status})`;
    throw new Error(message);
  }
  return data as T;
}

export interface GenerateResponse {
  text: string;
  provider: string;
  model: string;
}

/** Generate text via the secure server proxy. Provider id/model are not secrets. */
export async function serverGenerate(
  prompt: string,
  providerId: string,
  model: string,
  system?: string
): Promise<string> {
  const data = await post<GenerateResponse>('/ai/generate', { provider: providerId, model, prompt, system });
  return data.text;
}

/** Generate with an optional fallback provider (server decides when to fail over). */
export async function serverGenerateWithFallback(
  prompt: string,
  providerId: string,
  model: string,
  fallbackProviderId?: string,
  system?: string
): Promise<string> {
  const data = await post<GenerateResponse>('/ai/generate', { provider: providerId, model, fallback: fallbackProviderId, prompt, system });
  return data.text;
}

/** Connection test executed server-side so no key ever touches the browser. */
export async function serverTestProvider(providerId: string, model?: string): Promise<string> {
  const data = await post<{ ok: boolean; message: string }>('/ai/test', { provider: providerId, model });
  return data.ok ? 'Connected successfully!' : data.message;
}

/** OpenRouter credit balance, checked server-side. */
export async function serverOpenRouterCredits(): Promise<{ total: number; used: number }> {
  const data = await get<{ total: number; used: number }>('/ai/openrouter-credits');
  return { total: data.total || 0, used: data.used || 0 };
}

export interface QwenHealthStatus {
  configured: boolean;
  cloudflareAuth: 'PASS' | 'FAIL' | 'UNKNOWN';
  ollama: 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
  model: string;
  modelFound: boolean;
  generation: 'PASS' | 'FAIL' | 'SKIPPED';
  error?: string;
}

/** Detailed health of the private Qwen provider (admin-only, no secrets returned). */
export async function serverQwenHealth(): Promise<QwenHealthStatus> {
  const data = await get<Partial<QwenHealthStatus>>('/ai/qwen/health');
  return {
    configured: !!data.configured,
    cloudflareAuth: data.cloudflareAuth || 'UNKNOWN',
    ollama: data.ollama || 'UNKNOWN',
    model: data.model || 'qwen3.5:9b',
    modelFound: !!data.modelFound,
    generation: data.generation || 'SKIPPED',
    error: data.error,
  };
}

/** Generate via the private Qwen provider through the secure server proxy. */
export async function serverQwenGenerate(prompt: string): Promise<{ model: string; response: string }> {
  const data = await post<{ model: string; response: string }>('/ai/qwen', { prompt });
  return { model: data.model || 'qwen3.5:9b', response: data.response || '' };
}

/** Which providers have keys configured on the server (booleans only). */
export async function serverProviderStatus(): Promise<ProviderStatusMap> {
  const data = await get<Partial<ProviderStatusMap>>('/ai/status');
  return {
    backend: data.backend || 'missing',
    providers: Array.isArray(data.providers) ? data.providers : [],
  };
}

/**
 * Call the active AI provider through the server proxy.
 * Kept signature-compatible with the legacy in-browser callAIProvider so
 * existing call sites (AI import, marketing copy) keep working unchanged.
 */
export async function callAIProvider(
  prompt: string,
  providers: AIProvider[],
  onProgress?: (m: string) => void,
  system?: string
): Promise<string> {
  const settings = loadProviderSettings();
  let { primary, fallback } = resolveProviderChain(providers, settings);
  // The server is the authority on which providers actually have keys. A stale
  // all-disabled client config must not dead-end the import: fall back to the
  // configured routing defaults (deepseek → codex) and let the server answer
  // honestly if the key is missing there.
  if (!primary) {
    const defaults = DEFAULT_AI_PROVIDERS.filter((p) => p.enabled);
    primary = defaults.find((p) => p.id === settings.defaultProviderId) || defaults.find((p) => p.id === 'deepseek') || defaults[0] || null;
    if (settings.fallbackProviderId) fallback = defaults.find((p) => p.id === settings.fallbackProviderId) || null;
  }
  if (!primary) {
    throw new Error('No AI provider enabled. Enable one in AI Hub → AI Provider Configuration.');
  }
  onProgress?.(`Using ${primary.name} (${primary.defaultModel}) via secure server proxy…`);
  return serverGenerateWithFallback(prompt, primary.id, primary.defaultModel, fallback?.id, system);
}
