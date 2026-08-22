import { describe, it, expect } from 'vitest';
import { sanitizeProvider, loadAIProviders, DEFAULT_AI_PROVIDERS, resolveActiveProvider, scrubLegacySecrets, loadProviderSettings, saveProviderSettings, resolveProviderChain, DEFAULT_PROVIDER_SETTINGS } from '../providers';
import type { AIProvider } from '../types';

function memoryStorage(initial: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

describe('sanitizeProvider', () => {
  it('strips legacy apiKey secrets from stored provider config', () => {
    const dirty = {
      id: 'openai',
      name: 'OpenAI',
      models: ['gpt-4o-mini'],
      defaultModel: 'gpt-4o-mini',
      enabled: true,
      isDefault: true,
      apiKey: 'sk-secret-1234567890',
    };
    const clean = sanitizeProvider(dirty) as AIProvider & { apiKey?: string };
    expect(clean.apiKey).toBeUndefined();
    expect(JSON.stringify(clean)).not.toContain('sk-secret-1234567890');
    expect(clean.id).toBe('openai');
  });

  it('fills defaults for unknown/malformed providers', () => {
    const clean = sanitizeProvider({ id: 'unknown' } as AIProvider & Record<string, unknown>);
    expect(clean.name).toBeTruthy();
    expect(clean.models.length).toBeGreaterThan(0);
    expect(clean.enabled).toBe(true);
  });
});

describe('loadAIProviders', () => {
  it('returns defaults when nothing is stored', () => {
    const providers = loadAIProviders(memoryStorage({}));
    expect(providers.map((p) => p.id).sort()).toEqual(DEFAULT_AI_PROVIDERS.map((p) => p.id).sort());
    expect(providers.every((p) => !('apiKey' in p))).toBe(true);
  });

  it('merges stored config with defaults and never leaks keys', () => {
    const storage = memoryStorage({
      luxedge_ai_providers: JSON.stringify([
        { id: 'deepseek', name: 'DeepSeek', models: ['deepseek-chat'], defaultModel: 'deepseek-chat', enabled: true, isDefault: true, apiKey: 'sk-ds-super-secret' },
      ]),
    });
    const providers = loadAIProviders(storage);
    const deepseek = providers.find((p) => p.id === 'deepseek');
    expect(deepseek?.isDefault).toBe(true);
    expect(deepseek?.defaultModel).toBe('deepseek-chat');
    expect(deepseek && 'apiKey' in deepseek).toBe(false);
    // defaults still present
    expect(providers.length).toBeGreaterThanOrEqual(DEFAULT_AI_PROVIDERS.length);
    expect(JSON.stringify(providers)).not.toContain('sk-ds-super-secret');
  });

  it('recovers from corrupt storage', () => {
    const providers = loadAIProviders(memoryStorage({ luxedge_ai_providers: '{{{not json' }));
    expect(providers.length).toBe(DEFAULT_AI_PROVIDERS.length);
  });

  it('defaults to DeepSeek as the default provider (owner chain: deepseek → codex)', () => {
    expect(DEFAULT_AI_PROVIDERS.find((p) => p.isDefault)?.id).toBe('deepseek');
    const deepseek = DEFAULT_AI_PROVIDERS.find((p) => p.id === 'deepseek');
    expect(deepseek?.defaultModel).toBe('deepseek-v4-flash');
    expect(deepseek?.enabled).toBe(true);
  });

  it('includes the private Qwen provider (Qwen3.5-9B-Colab, qwen3.5:9b) without replacing defaults', () => {
    const qwen = DEFAULT_AI_PROVIDERS.find((p) => p.id === 'qwen');
    expect(qwen).toBeDefined();
    expect(qwen?.name).toBe('Qwen3.5-9B-Colab');
    expect(qwen?.models).toContain('qwen3.5:9b');
    expect(qwen?.defaultModel).toBe('qwen3.5:9b');
    expect(qwen?.enabled).toBe(true);
    expect(qwen?.isDefault).toBe(false);
    // existing providers untouched
    expect(DEFAULT_AI_PROVIDERS.find((p) => p.id === 'deepseek')?.isDefault).toBe(true);
  });

  it('self-heals a stale all-disabled stored config back to defaults', () => {
    const allDisabled = DEFAULT_AI_PROVIDERS.map((p) => ({ ...p, enabled: false }));
    const providers = loadAIProviders(memoryStorage({ luxedge_ai_providers: JSON.stringify(allDisabled) }));
    expect(providers.some((p) => p.enabled)).toBe(true);
    expect(providers.find((p) => p.id === 'deepseek')?.enabled).toBe(true);
    expect(providers.find((p) => p.isDefault)?.id).toBe('deepseek');
  });
});

describe('scrubLegacySecrets', () => {
  const mem = (initial: Record<string, string>) => {
    const map = new Map(Object.entries(initial));
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    };
  };

  it('removes the standalone legacy key vault', () => {
    const s = mem({ luxedge_api_keys: JSON.stringify({ scrapedoKey: 'tok-123', openAiKey: 'sk-secret' }) });
    scrubLegacySecrets(s);
    expect(s.getItem('luxedge_api_keys')).toBeNull();
  });

  it('strips apiKey from stored provider config', () => {
    const s = mem({ luxedge_ai_providers: JSON.stringify([{ id: 'openai', name: 'OpenAI', models: ['gpt-4o-mini'], defaultModel: 'gpt-4o-mini', enabled: true, isDefault: true, apiKey: 'sk-leaked' }]) });
    scrubLegacySecrets(s);
    const stored = JSON.parse(s.getItem('luxedge_ai_providers') || '[]');
    expect(JSON.stringify(stored)).not.toContain('sk-leaked');
    expect('apiKey' in stored[0]).toBe(false);
  });

  it('strips legacy secret keys from the luxedge-settings store and rewrites it', () => {
    const s = mem({
      'luxedge-settings': JSON.stringify({ state: { apiKeys: { scrapedoKey: 'tok-1', openAiKey: 'sk-1', openRouterKey: 'sk-2', geminiApiKey: 'ai-3', supabaseUrl: 'https://x.supabase.co' }, storeConfig: { storeName: 'Luxedge' } }, version: 0 }),
    });
    scrubLegacySecrets(s);
    const stored = JSON.parse(s.getItem('luxedge-settings') || '{}');
    const apiKeys = stored.state.apiKeys;
    expect(apiKeys.scrapedoKey).toBeUndefined();
    expect(apiKeys.openAiKey).toBeUndefined();
    expect(apiKeys.openRouterKey).toBeUndefined();
    expect(apiKeys.geminiApiKey).toBeUndefined();
    expect(apiKeys.supabaseUrl).toBe('https://x.supabase.co'); // client-safe fields survive
    expect(JSON.stringify(stored)).not.toContain('sk-1');
    expect(JSON.stringify(stored)).not.toContain('tok-1');
  });

  it('is a no-op when storage is empty or absent', () => {
    const s = mem({});
    expect(() => scrubLegacySecrets(s)).not.toThrow();
    expect(() => scrubLegacySecrets()).not.toThrow();
  });
});

describe('resolveActiveProvider', () => {
  const list: AIProvider[] = [
    { id: 'a', name: 'A', models: [], defaultModel: 'm', enabled: true, isDefault: false },
    { id: 'b', name: 'B', models: [], defaultModel: 'm', enabled: true, isDefault: true },
    { id: 'c', name: 'C', models: [], defaultModel: 'm', enabled: false, isDefault: false },
  ];
  it('prefers the default enabled provider', () => {
    expect(resolveActiveProvider(list)?.id).toBe('b');
  });
  it('falls back to first enabled when no default', () => {
    const noDefault = list.map((p) => ({ ...p, isDefault: false }));
    expect(resolveActiveProvider(noDefault)?.id).toBe('a');
  });
  it('returns null when none enabled', () => {
    expect(resolveActiveProvider(list.map((p) => ({ ...p, enabled: false })))).toBeNull();
  });
});

describe('provider routing settings', () => {
  it('defaults to DeepSeek primary + Codex fallback', () => {
    expect(DEFAULT_PROVIDER_SETTINGS.defaultProviderId).toBe('deepseek');
    expect(DEFAULT_PROVIDER_SETTINGS.fallbackProviderId).toBe('codex');
    expect(loadProviderSettings(memoryStorage({}))).toEqual(DEFAULT_PROVIDER_SETTINGS);
  });

  it('round-trips default/fallback and treats empty fallback as null', () => {
    const s = memoryStorage({});
    saveProviderSettings({ defaultProviderId: 'codex', fallbackProviderId: '' }, s);
    expect(loadProviderSettings(s)).toEqual({ defaultProviderId: 'codex', fallbackProviderId: null });
  });

  it('recovers from corrupt storage', () => {
    expect(loadProviderSettings(memoryStorage({ luxedge_ai_provider_settings: '{{{nope' }))).toEqual(DEFAULT_PROVIDER_SETTINGS);
  });

  const providers: AIProvider[] = [
    { id: 'deepseek', name: 'DeepSeek', models: [], defaultModel: 'deepseek-v4-flash', enabled: true, isDefault: false },
    { id: 'codex', name: 'Codex', models: [], defaultModel: 'gpt-5-codex', enabled: true, isDefault: false },
    { id: 'openai', name: 'OpenAI', models: [], defaultModel: 'gpt-4o-mini', enabled: false, isDefault: false },
  ];

  it('resolves the configured primary and fallback', () => {
    const chain = resolveProviderChain(providers, { defaultProviderId: 'deepseek', fallbackProviderId: 'codex' });
    expect(chain.primary?.id).toBe('deepseek');
    expect(chain.fallback?.id).toBe('codex');
  });

  it('ignores a fallback that equals the primary', () => {
    const chain = resolveProviderChain(providers, { defaultProviderId: 'deepseek', fallbackProviderId: 'deepseek' });
    expect(chain.primary?.id).toBe('deepseek');
    expect(chain.fallback).toBeNull();
  });

  it('never selects a disabled provider as primary or fallback', () => {
    const chain = resolveProviderChain(providers, { defaultProviderId: 'openai', fallbackProviderId: 'openai' });
    expect(chain.primary?.id).not.toBe('openai');
    expect(chain.fallback?.id).not.toBe('openai');
  });
});
