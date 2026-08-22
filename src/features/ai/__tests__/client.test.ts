// ============================================================================
// LUXEDGE — AI CLIENT TESTS
//
// Verifies callAIProvider's provider override + fallback chain contract:
//   - default routing uses the configured default (deepseek) with the
//     configured fallback (codex)
//   - a providerIdOverride forces the primary provider (e.g. private Qwen)
//     while keeping the configured fallback for server-side failover
//   - an override that is disabled/unknown throws instead of silently
//     switching to another provider
//   - nothing secret is ever sent to /api/ai/generate
// ============================================================================
import { describe, it, expect, afterEach, vi } from 'vitest';
import { callAIProvider } from '../client';
import type { AIProvider } from '../types';

function providers(): AIProvider[] {
  return [
    { id: 'deepseek', name: 'DeepSeek', models: ['deepseek-v4-flash'], defaultModel: 'deepseek-v4-flash', enabled: true, isDefault: true },
    { id: 'codex', name: 'OpenAI Codex', models: ['gpt-5-codex'], defaultModel: 'gpt-5-codex', enabled: true, isDefault: false },
    { id: 'qwen', name: 'Qwen3.5-9B-Colab', models: ['qwen3.5:9b'], defaultModel: 'qwen3.5:9b', enabled: true, isDefault: false },
  ];
}

let lastBody: { provider?: string; model?: string; fallback?: string; prompt?: string; system?: string } = {};

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    lastBody = JSON.parse(String(init?.body || '{}'));
    return new Response(JSON.stringify({ text: 'LUXEDGE-QWEN-OK', provider: lastBody.provider, model: lastBody.model }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  lastBody = {};
});

describe('callAIProvider', () => {
  it('uses the configured default provider with the configured fallback when no override', async () => {
    stubFetch();
    const out = await callAIProvider('test', providers());
    expect(out).toBe('LUXEDGE-QWEN-OK');
    expect(lastBody.provider).toBe('deepseek');
    expect(lastBody.model).toBe('deepseek-v4-flash');
    expect(lastBody.fallback).toBe('codex');
  });

  it('forces the private Qwen provider as primary while keeping the fallback', async () => {
    stubFetch();
    const progress: string[] = [];
    const out = await callAIProvider('test', providers(), (m) => progress.push(m), undefined, 'qwen');
    expect(out).toBe('LUXEDGE-QWEN-OK');
    expect(lastBody.provider).toBe('qwen');
    expect(lastBody.model).toBe('qwen3.5:9b');
    expect(lastBody.fallback).toBe('codex');
    expect(progress.some((m) => m.includes('Qwen3.5-9B-Colab') && m.includes('Codex'))).toBe(true);
  });

  it('throws when the override provider is disabled or unknown', async () => {
    stubFetch();
    const disabled = providers().map((p) => (p.id === 'qwen' ? { ...p, enabled: false } : p));
    await expect(callAIProvider('test', disabled, undefined, undefined, 'qwen')).rejects.toThrow(/not enabled/i);
    await expect(callAIProvider('test', providers(), undefined, undefined, 'does-not-exist')).rejects.toThrow(/not enabled/i);
  });

  it('uses auto-routing when the override is the literal "auto" value', async () => {
    stubFetch();
    await callAIProvider('test', providers(), undefined, undefined, 'auto');
    expect(lastBody.provider).toBe('deepseek');
    expect(lastBody.fallback).toBe('codex');
  });

  it('never sends secrets to the server proxy', async () => {
    stubFetch();
    await callAIProvider('test', providers(), undefined, 'be nice', 'qwen');
    const serialized = JSON.stringify(lastBody);
    expect(serialized).not.toMatch(/api[_-]?key|secret|Bearer\s+\S+|sk-[A-Za-z0-9]{10,}/i);
  });
});
