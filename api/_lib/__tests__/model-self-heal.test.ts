// ============================================================================
// LUXEDGE — retired-model self-heal
//
// Upstream providers retire model ids without notice (OpenRouter dropped the
// `:free` suffix from a model this deployment shipped as its default), and a
// dead id fails the WHOLE request with HTTP 404 "does not offer the requested
// model" — which is exactly how AI SEO broke in the admin Blog Manager.
//
// generateWithFallback must therefore retry the SAME provider with its
// registry default before giving up. Auth/quota failures must NOT be retried
// this way (swapping the model cannot fix a bad key), and the cross-provider
// fallback must still run when even the healed model fails.
// ============================================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  generateWithFallback,
  defaultModelFor,
  classifyProviderStatus,
  providerError,
  isModelProblem,
} from '../providers.js';

const KEYS = ['OPENROUTER_API_KEY', 'DEEPSEEK_API_KEY'] as const;
const ORIG = new Map<string, string | undefined>(KEYS.map((k) => [k, process.env[k]]));

const RETIRED = 'retired/vendor-model:free';

/** Stub fetch, replying per (provider url, requested model). */
function stubFetch(reply: (url: string, model: string) => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      let model = '';
      try {
        model = String((JSON.parse(String(init?.body || '{}')) as { model?: string }).model || '');
      } catch {
        /* body not JSON — leave model empty */
      }
      return reply(url, model);
    }),
  );
}

const okText = (text: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
const notFound = () =>
  new Response(JSON.stringify({ error: { message: 'No endpoints found for that model' } }), { status: 404 });

describe('classifyProviderStatus / providerError', () => {
  it('tags a 404 model failure as a model problem', () => {
    expect(classifyProviderStatus('openrouter', 404, 'no endpoints found').problem).toBe('model');
  });

  it('exposes the problem category on the thrown error', () => {
    expect(isModelProblem(providerError('openrouter', 404, 'no endpoints found'))).toBe(true);
    expect(isModelProblem(providerError('openrouter', 401, 'invalid key'))).toBe(false);
    expect(isModelProblem(providerError('openrouter', 429, 'rate limit'))).toBe(false);
    expect(isModelProblem(new Error('plain'))).toBe(false);
    expect(isModelProblem(undefined)).toBe(false);
  });
});

describe('generateWithFallback — retired model id', () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'or-key';
    delete process.env.DEEPSEEK_API_KEY;
  });
  afterEach(() => {
    for (const [k, v] of ORIG) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.unstubAllGlobals();
  });

  it('retries the provider default instead of failing when the model is retired', async () => {
    const asked: string[] = [];
    stubFetch((_url, model) => {
      asked.push(model);
      return model === defaultModelFor('openrouter') ? okText('healed reply') : notFound();
    });

    const result = await generateWithFallback('openrouter', null, { prompt: 'Write SEO', model: RETIRED });

    expect(result.text).toBe('healed reply');
    expect(result.provider).toBe('openrouter');
    expect(result.model).toBe(defaultModelFor('openrouter'));
    expect(result.fallbackUsed).toBe(false);
    expect(asked).toContain(RETIRED);
    expect(asked).toContain(defaultModelFor('openrouter'));
  });

  it('does NOT swap the model on an auth failure (swapping cannot fix a key)', async () => {
    const asked: string[] = [];
    stubFetch((_url, model) => {
      asked.push(model);
      return new Response(JSON.stringify({ error: { message: 'Incorrect API key provided' } }), { status: 401 });
    });

    await expect(
      generateWithFallback('openrouter', null, { prompt: 'Write SEO', model: RETIRED }),
    ).rejects.toThrow(/rejected the key/);
    expect(new Set(asked)).toEqual(new Set([RETIRED]));
  });

  it('does NOT swap the model on a quota failure', async () => {
    const asked: string[] = [];
    stubFetch((_url, model) => {
      asked.push(model);
      return new Response(JSON.stringify({ error: { message: 'rate limit exceeded' } }), { status: 429 });
    });

    await expect(
      generateWithFallback('openrouter', null, { prompt: 'Write SEO', model: RETIRED }),
    ).rejects.toThrow(/out of quota/);
    expect(new Set(asked)).toEqual(new Set([RETIRED]));
  });

  it('still reaches the fallback provider when the healed model also fails', async () => {
    process.env.DEEPSEEK_API_KEY = 'ds-key';
    stubFetch((url) => {
      if (url.includes('openrouter.ai')) return notFound();
      return okText('deepseek reply');
    });

    const result = await generateWithFallback('openrouter', 'deepseek', {
      prompt: 'Write SEO',
      model: RETIRED,
    });

    expect(result.text).toBe('deepseek reply');
    expect(result.provider).toBe('deepseek');
    expect(result.fallbackUsed).toBe(true);
  });

  it('leaves a working model untouched (no extra provider calls)', async () => {
    const asked: string[] = [];
    stubFetch((_url, model) => {
      asked.push(model);
      return okText('first try');
    });

    const result = await generateWithFallback('openrouter', null, { prompt: 'Write SEO', model: 'openrouter/free' });

    expect(result.model).toBe('openrouter/free');
    expect(asked).toEqual(['openrouter/free']);
  });
});
