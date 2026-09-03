import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generate, providerKeys, __resetKeyRotationForTests } from '../providers.js';

const ORIG = new Map<string, string | undefined>([
  ['DEEPSEEK_API_KEY', process.env.DEEPSEEK_API_KEY],
  ['DEEPSEEK_API_KEY_1', process.env.DEEPSEEK_API_KEY_1],
  ['DEEPSEEK_API_KEY_2', process.env.DEEPSEEK_API_KEY_2],
  ['DEEPSEEK_API_KEY_3', process.env.DEEPSEEK_API_KEY_3],
]);

function stubFetch(byKey: Record<string, () => Response>) {
  vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
    const auth = String((init?.headers as Record<string, string> | undefined)?.Authorization || '');
    const key = auth.replace(/^Bearer /, '');
    const fn = byKey[key];
    if (!fn) return new Response(JSON.stringify({ error: 'unknown key' }), { status: 401 });
    return fn();
  }));
}

const ok = (text: string) => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
const err = () => new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 });

describe('providerKeys', () => {
  it('collects the legacy single key plus numbered extras, deduped and trimmed', () => {
    process.env.DEEPSEEK_API_KEY = 'k0';
    process.env.DEEPSEEK_API_KEY_1 = 'k1';
    process.env.DEEPSEEK_API_KEY_2 = 'k2';
    process.env.DEEPSEEK_API_KEY_3 = '';
    expect(providerKeys('deepseek')).toEqual(['k0', 'k1', 'k2']);
  });

  it('supports comma-separated values in the primary var (backward compatible)', () => {
    process.env.DEEPSEEK_API_KEY = 'a,b, a ';
    delete process.env.DEEPSEEK_API_KEY_1;
    delete process.env.DEEPSEEK_API_KEY_2;
    expect(providerKeys('deepseek')).toEqual(['a', 'b']);
  });
});

describe('generate with multi-key rotation', () => {
  beforeEach(() => {
    process.env.DEEPSEEK_API_KEY = 'k1';
    process.env.DEEPSEEK_API_KEY_1 = 'k2';
    process.env.DEEPSEEK_API_KEY_2 = 'k3';
    __resetKeyRotationForTests();
  });
  afterEach(() => {
    for (const [k, v] of ORIG) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.unstubAllGlobals();
  });

  it('falls back to the next key when the first fails, then returns text', async () => {
    const calls: string[] = [];
    stubFetch({
      k1: () => { calls.push('k1'); return err(); },
      k2: () => { calls.push('k2'); return ok('from k2'); },
      k3: () => { calls.push('k3'); return ok('from k3'); },
    });
    const text = await generate('deepseek', { prompt: 'hi', model: 'deepseek-v4-flash' });
    expect(text).toBe('from k2');
    expect(calls).toEqual(['k1', 'k2']); // never reached k3
  });

  it('round-robins the starting key across successive calls', async () => {
    stubFetch({
      k1: () => ok('k1-ok'),
      k2: () => ok('k2-ok'),
      k3: () => ok('k3-ok'),
    });
    const seen: string[] = [];
    const use = async () => {
      const text = await generate('deepseek', { prompt: 'hi', model: 'deepseek-v4-flash' });
      seen.push(text);
    };
    await use();
    await use();
    await use();
    expect(seen).toEqual(['k1-ok', 'k2-ok', 'k3-ok']);
  });

  it('throws (instead of looping forever) when every key fails', async () => {
    stubFetch({ k1: () => err(), k2: () => err(), k3: () => err() });
    // Every key 429s → the classified quota message surfaces (never a silent loop).
    await expect(generate('deepseek', { prompt: 'hi', model: 'deepseek-v4-flash' })).rejects.toThrow(/DeepSeek is out of quota/);
  });
});
