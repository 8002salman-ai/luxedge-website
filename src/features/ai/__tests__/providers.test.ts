import { describe, it, expect } from 'vitest';
import { sanitizeProvider, loadAIProviders, DEFAULT_AI_PROVIDERS, resolveActiveProvider } from '../providers';
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
