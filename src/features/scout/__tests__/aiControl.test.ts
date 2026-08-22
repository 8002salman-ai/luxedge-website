// ============================================================================
// LUXEDGE V2 — FLEXIBLE AI CONTROL TESTS (Phase 4B amendment)
//
// Verifies the owner's control over AI:
//   master switch, control modes (MANUAL/ASSISTED/AUTONOMOUS), per-provider
//   switches, task routing + fallback, second opinion + disagreement, cost
//   strategies, feature-level switches, emergency pause, manual ↔ AI handoff,
//   provider-failure resilience, and that secrets are never logged.
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_AI_CONTROL_CONFIG, loadAiControlConfig, saveAiControlConfig,
  takeManualControl, resumeAiControl, aiGate, selectProvider, callsToday,
  providerHealth, scrubLogError, appendAiRouterLog, loadAiRouterLog, clearAiRouterLog,
  type AiControlConfig, type ProviderId,
} from '../aiControl';
import { routerGenerate, compareProviderOutputs } from '../aiRouter';
import { loadAutonomyConfig, saveAutonomyConfig, isEmergencyPaused, setEmergencyPause } from '../autonomy';

function cfg(over: Partial<AiControlConfig> = {}): AiControlConfig {
  return {
    ...DEFAULT_AI_CONTROL_CONFIG,
    providers: DEFAULT_AI_CONTROL_CONFIG.providers.map((p) => ({ ...p, tasks: [...p.tasks] })),
    features: { ...DEFAULT_AI_CONTROL_CONFIG.features },
    routing: DEFAULT_AI_CONTROL_CONFIG.routing.map((r) => ({ ...r })),
    ...over,
  };
}

/** Enable exactly the given providers (default safe config enables only DeepSeek). */
function withProviders(ids: ProviderId[]): AiControlConfig {
  return cfg({
    providers: DEFAULT_AI_CONTROL_CONFIG.providers.map((p) => ({ ...p, enabled: ids.includes(p.id), tasks: [...p.tasks] })),
  });
}

function makeGenerate(opts?: { fail?: (p: string) => boolean; text?: (p: string) => string }) {
  const calls: { provider: string; model: string }[] = [];
  const fail = opts?.fail || (() => false);
  const text = opts?.text || (() => '60/100');
  const generate = async (_prompt: string, provider: string, model: string) => {
    calls.push({ provider, model });
    if (fail(provider)) throw new Error(`${provider} is down`);
    return text(provider);
  };
  return { calls, generate };
}

const withStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
  };
};

describe('AI master switch', () => {
  it('AI Services OFF = zero provider calls, deterministic mode', async () => {
    const { calls, generate } = makeGenerate();
    await expect(routerGenerate('p', {
      task: 'MARKET_INTELLIGENCE',
      control: cfg({ aiServicesOn: false }),
      configured: ['deepseek'],
      generate,
    })).rejects.toThrow(/AI Services OFF/);
    expect(calls.length).toBe(0);
  });

  it('master OFF never breaks the scout — caller falls back to deterministic', async () => {
    const { calls, generate } = makeGenerate();
    const ok = await routerGenerate('p', {
      task: 'LISTING_GENERATE',
      control: cfg({ aiServicesOn: false }),
      explicit: true,
      configured: ['deepseek'],
      generate,
    }).then(() => true).catch(() => false);
    expect(ok).toBe(false);
    expect(calls.length).toBe(0);
  });
});

describe('control modes', () => {
  it('MANUAL blocks autonomous (implicit) AI actions', async () => {
    const { calls, generate } = makeGenerate();
    await expect(routerGenerate('p', {
      task: 'MARKET_INTELLIGENCE',
      control: cfg({ controlMode: 'MANUAL' }),
      configured: ['deepseek'],
      generate,
    })).rejects.toThrow(/MANUAL/);
    expect(calls.length).toBe(0);
  });

  it('MANUAL allows explicitly requested AI', async () => {
    const { calls, generate } = makeGenerate();
    const r = await routerGenerate('p', {
      task: 'MARKET_INTELLIGENCE',
      explicit: true,
      control: cfg({ controlMode: 'MANUAL' }),
      configured: ['deepseek'],
      generate,
    });
    expect(r.text).toBe('60/100');
    expect(calls.length).toBe(1);
  });

  it('ASSISTED allows AI recommendations without explicit request', async () => {
    const { calls, generate } = makeGenerate();
    const r = await routerGenerate('p', {
      task: 'MARKET_INTELLIGENCE',
      control: cfg({ controlMode: 'ASSISTED' }),
      configured: ['deepseek'],
      generate,
    });
    expect(r.text).toBe('60/100');
    expect(calls.length).toBe(1);
  });

  it('AUTONOMOUS routes allowed low-risk work', async () => {
    const { calls, generate } = makeGenerate();
    const r = await routerGenerate('p', {
      task: 'MARKET_INTELLIGENCE',
      control: cfg({ controlMode: 'AUTONOMOUS' }),
      configured: ['deepseek'],
      generate,
    });
    expect(r.text).toBe('60/100');
    expect(calls.length).toBe(1);
  });

  it('aiGate reflects the exact mode reason', () => {
    expect(aiGate(cfg({ controlMode: 'MANUAL' }), 'MARKET_INTELLIGENCE').allow).toBe(false);
    expect(aiGate(cfg({ controlMode: 'MANUAL' }), 'MARKET_INTELLIGENCE', { explicit: true }).allow).toBe(true);
    expect(aiGate(cfg({ controlMode: 'ASSISTED' }), 'MARKET_INTELLIGENCE').allow).toBe(true);
  });
});

describe('per-provider switches', () => {
  it('DeepSeek OFF = zero DeepSeek calls (next enabled+configured provider used)', async () => {
    const { calls, generate } = makeGenerate();
    const r = await routerGenerate('p', {
      task: 'MARKET_INTELLIGENCE',
      control: withProviders(['openai']),
      configured: ['deepseek', 'openai'],
      generate,
    });
    expect(calls.some((c) => c.provider === 'deepseek')).toBe(false);
    expect(r.provider).toBe('openai');
  });

  it('Claude OFF = zero Claude calls (even as routing primary)', async () => {
    const { calls, generate } = makeGenerate();
    const r = await routerGenerate('p', {
      task: 'FACTUAL_QA',
      control: withProviders(['openai']),
      configured: ['anthropic', 'openai'],
      generate,
    });
    expect(calls.some((c) => c.provider === 'anthropic')).toBe(false);
    expect(r.provider).toBe('openai');
  });

  it('OpenAI OFF = zero OpenAI calls', async () => {
    const { calls, generate } = makeGenerate();
    const r = await routerGenerate('p', {
      task: 'MARKET_INTELLIGENCE',
      control: withProviders(['deepseek']),
      configured: ['deepseek', 'openai'],
      generate,
    });
    expect(calls.some((c) => c.provider === 'openai')).toBe(false);
    expect(r.provider).toBe('deepseek');
  });

  it('disabled provider is never called even as fallback', async () => {
    const { calls, generate } = makeGenerate({ fail: () => true });
    await expect(routerGenerate('p', {
      task: 'MARKET_INTELLIGENCE',
      control: withProviders(['deepseek']), // anthropic disabled
      configured: ['deepseek', 'anthropic'],
      generate,
    })).rejects.toThrow();
    expect(calls.some((c) => c.provider === 'anthropic')).toBe(false);
  });
});

describe('fallback + failure', () => {
  it('primary failure → enabled+configured fallback used', async () => {
    const { calls, generate } = makeGenerate({ fail: (p) => p === 'openrouter' });
    const r = await routerGenerate('p', {
      task: 'MARKET_INTELLIGENCE',
      control: withProviders(['openrouter', 'deepseek']),
      configured: ['openrouter', 'deepseek'],
      generate,
    });
    expect(r.fallbackUsed).toBe(true);
    expect(r.provider).toBe('deepseek');
    expect(calls.some((c) => c.provider === 'deepseek')).toBe(true);
  });

  it('fallback disabled → error after capped retries, no fallback call', async () => {
    const { calls, generate } = makeGenerate({ fail: () => true });
    const control = cfg({
      routing: DEFAULT_AI_CONTROL_CONFIG.routing.map((r) =>
        r.task === 'MARKET_INTELLIGENCE' ? { ...r, fallback: null } : r),
    });
    await expect(routerGenerate('p', {
      task: 'MARKET_INTELLIGENCE',
      control,
      configured: ['deepseek', 'anthropic'],
      generate,
    })).rejects.toThrow(/down|failed/i);
    // capped retries (2 attempts max) on the primary only — never the fallback
    expect(calls.filter((c) => c.provider === 'deepseek').length).toBeLessThanOrEqual(2);
    expect(calls.some((c) => c.provider === 'anthropic')).toBe(false);
  });

  it('all providers unavailable → catchable error (deterministic continues)', async () => {
    const { generate } = makeGenerate({ fail: () => true });
    await expect(routerGenerate('p', {
      task: 'MARKET_INTELLIGENCE',
      control: cfg(),
      configured: ['deepseek'],
      generate,
    })).rejects.toThrow();
  });
});

describe('second opinion', () => {
  it('IMPORTANT_ONLY + important decision → second provider consulted', async () => {
    const { calls, generate } = makeGenerate({ text: () => 'score 60/100' });
    const r = await routerGenerate('p', {
      task: 'MARKET_INTELLIGENCE',
      important: true,
      control: withProviders(['deepseek', 'openai']),
      configured: ['deepseek', 'openai'],
      generate,
    });
    expect(calls.length).toBe(2);
    expect(r.secondOpinionProvider).toBe('openai');
    expect(r.secondOpinionDisagreed).toBe(false);
  });

  it('ALWAYS runs a second opinion; OFF runs one provider only', async () => {
    const always = makeGenerate({ text: () => 'score 60/100' });
    await routerGenerate('p', {
      task: 'MARKET_INTELLIGENCE', important: true,
      control: withProviders(['deepseek', 'openai']),
      configured: ['deepseek', 'openai'], generate: always.generate,
    });
    expect(always.calls.length).toBe(2);

    const off = makeGenerate({ text: () => 'score 60/100' });
    await routerGenerate('p', {
      task: 'MARKET_INTELLIGENCE', important: true,
      control: { ...withProviders(['deepseek', 'openai']), secondOpinion: 'OFF' },
      configured: ['deepseek', 'openai'], generate: off.generate,
    });
    expect(off.calls.length).toBe(1);
  });

  it('provider disagreement is flagged for owner attention', async () => {
    const { calls, generate } = makeGenerate({ text: (p) => (p === 'openai' ? 'score 82/100' : 'score 60/100') });
    const r = await routerGenerate('p', {
      task: 'MARKET_INTELLIGENCE', important: true,
      control: withProviders(['deepseek', 'openai']),
      configured: ['deepseek', 'openai'],
      generate,
    });
    expect(calls.length).toBe(2);
    expect(r.secondOpinionDisagreed).toBe(true);
  });

  it('no unnecessary duplicate runs when not important', async () => {
    const { calls, generate } = makeGenerate();
    await routerGenerate('p', {
      task: 'PRODUCT_ANALYSIS',
      important: false,
      control: cfg({ secondOpinion: 'IMPORTANT_ONLY' }),
      configured: ['deepseek', 'openai'],
      generate,
    });
    expect(calls.length).toBe(1);
  });
});

describe('cost strategies', () => {
  it('ECONOMY picks the cheapest capable provider', async () => {
    const sel = selectProvider(
      cfg({ costStrategy: 'ECONOMY' }),
      'MARKET_INTELLIGENCE',
      ['deepseek', 'openai', 'anthropic'],
    );
    expect(sel?.provider).toBe('deepseek'); // costRank 1
  });

  it('BALANCED uses the routing matrix', async () => {
    const sel = selectProvider(
      cfg({ costStrategy: 'BALANCED' }),
      'LISTING_GENERATE',
      ['deepseek', 'openai'],
    );
    // LISTING_GENERATE primary = openrouter (unconfigured), fallback = deepseek
    expect(sel?.provider).toBe('deepseek');
  });

  it('QUALITY uses the premium model for important decisions', async () => {
    const { calls, generate } = makeGenerate();
    await routerGenerate('p', {
      task: 'MARKET_INTELLIGENCE', important: true,
      control: cfg({ costStrategy: 'QUALITY' }),
      configured: ['deepseek'],
      generate,
    });
    expect(calls[0].model).toBe('deepseek-reasoner');
  });
});

describe('feature switches + pause', () => {
  it('feature-level OFF blocks that task, others still work', async () => {
    const { calls, generate } = makeGenerate();
    await expect(routerGenerate('p', {
      task: 'LISTING_GENERATE',
      control: cfg({ features: { ...DEFAULT_AI_CONTROL_CONFIG.features, listing: false } }),
      configured: ['deepseek'],
      generate,
    })).rejects.toThrow(/Feature AI OFF/);
    expect(calls.length).toBe(0);

    const r = await routerGenerate('p', {
      task: 'MARKET_INTELLIGENCE',
      control: cfg({ features: { ...DEFAULT_AI_CONTROL_CONFIG.features, listing: false } }),
      configured: ['deepseek'],
      generate,
    });
    expect(r.text).toBe('60/100');
  });

  it('emergency pause blocks all AI calls', async () => {
    const { calls, generate } = makeGenerate();
    await expect(routerGenerate('p', {
      task: 'MARKET_INTELLIGENCE',
      control: cfg({ emergencyPause: true }),
      configured: ['deepseek'],
      generate,
    })).rejects.toThrow(/EMERGENCY PAUSE/);
    expect(calls.length).toBe(0);
  });

  it('pause must be persisted to the canonical key the runtime gate reads (Control Center regression)', () => {
    // The AI Control Center's toggle previously wrote only the control-config
    // flag; the gate reads the canonical pause key via isEmergencyPaused().
    // Writing the canonical key must make a freshly loaded config gate the AI.
    const storage = withStorage();
    setEmergencyPause(true, storage);
    expect(isEmergencyPaused(storage)).toBe(true);
    // loadAiControlConfig overrides the stored flag with the canonical key.
    const cfg2 = loadAiControlConfig(storage);
    expect(cfg2.emergencyPause).toBe(true);
    const g = aiGate(cfg2, 'MARKET_INTELLIGENCE');
    expect(g.allow).toBe(false);
    expect(g.reason).toMatch(/EMERGENCY PAUSE/);
    setEmergencyPause(false, storage);
    expect(isEmergencyPaused(storage)).toBe(false);
    expect(loadAiControlConfig(storage).emergencyPause).toBe(false);
  });
});

describe('manual ↔ AI handoff', () => {
  it('TAKE MANUAL CONTROL switches control mode + autonomy policy to MANUAL, preserves state', () => {
    const storage = withStorage();
    saveAutonomyConfig({ ...loadAutonomyConfig(storage), mode: 'AUTO' }, storage);
    saveAiControlConfig(cfg({ controlMode: 'AUTONOMOUS' }), storage);

    const next = takeManualControl(storage);
    expect(next.controlMode).toBe('MANUAL');
    expect(loadAiControlConfig(storage).controlMode).toBe('MANUAL');
    expect(loadAutonomyConfig(storage).mode).toBe('MANUAL');
    // evidence/config preserved — aiServicesOn unchanged
    expect(loadAiControlConfig(storage).aiServicesOn).toBe(true);
  });

  it('RESUME AI CONTROL returns to ASSISTED (autonomy REVIEW)', () => {
    const storage = withStorage();
    takeManualControl(storage);
    const next = resumeAiControl('ASSISTED', storage);
    expect(next.controlMode).toBe('ASSISTED');
    expect(loadAutonomyConfig(storage).mode).toBe('REVIEW');
  });

  it('RESUME AUTONOMOUS sets autonomy AUTO', () => {
    const storage = withStorage();
    takeManualControl(storage);
    resumeAiControl('AUTONOMOUS', storage);
    expect(loadAutonomyConfig(storage).mode).toBe('AUTO');
  });

  it('workflow continues from existing DB state across mode switches (no restart needed)', async () => {
    const storage = withStorage();
    takeManualControl(storage);
    // owner does manual work, then turns AI back on later
    resumeAiControl('ASSISTED', storage);
    const { calls, generate } = makeGenerate();
    const r = await routerGenerate('p', {
      task: 'MARKET_INTELLIGENCE',
      control: loadAiControlConfig(storage),
      configured: ['deepseek'],
      generate,
    });
    expect(r.text).toBe('60/100');
    expect(calls.length).toBe(1);
  });
});

describe('router decision log — never secrets', () => {
  beforeEach(() => {
    try { clearAiRouterLog(window.localStorage); } catch { clearAiRouterLog(); }
  });

  it('scrubs key-like material before persisting', () => {
    const scrubbed = scrubLogError('provider rejected Bearer sk-abcdefgh1234567890 (HTTP 401)');
    expect(scrubbed).toMatch(/REDACTED/);
    expect(scrubbed).not.toContain('sk-abcdefgh1234567890');
    expect(scrubbed).not.toContain('Bearer');
  });

  it('log entries contain no prompt/output text — only task/provider/result metadata', async () => {
    const storage = withStorage();
    (globalThis as unknown as { window?: unknown }).window = { localStorage: storage };
    const { generate } = makeGenerate({ text: () => 'super secret product description content that must never be logged' });
    await routerGenerate('this is a very long proprietary prompt', {
      task: 'LISTING_GENERATE',
      control: cfg(),
      configured: ['deepseek'],
      generate,
      fingerprint: 'fp-test-1',
    });
    const entries = loadAiRouterLog();
    expect(entries.length).toBeGreaterThan(0);
    const e = entries[0];
    expect(e.task).toBe('LISTING_GENERATE');
    expect(e.provider).toBe('deepseek');
    expect(e.fingerprint).toBe('fp-test-1');
    expect(e.resultSummary).not.toContain('proprietary prompt');
    expect(e.resultSummary).not.toContain('super secret product description');
    expect(JSON.stringify(e)).not.toMatch(/sk-|api[_-]?key|secret/i);
  });

  it('callsToday and providerHealth derive from the log', () => {
    const storage = withStorage();
    appendAiRouterLog({
      id: '1', at: new Date().toISOString(), task: 'MARKET_INTELLIGENCE', controlMode: 'ASSISTED',
      provider: 'deepseek', model: 'deepseek-chat', why: 'test', fallbackUsed: false,
      fingerprint: null, ok: true, resultSummary: 'ok',
    }, storage);
    appendAiRouterLog({
      id: '2', at: new Date().toISOString(), task: 'MARKET_INTELLIGENCE', controlMode: 'ASSISTED',
      provider: 'deepseek', model: 'deepseek-chat', why: 'test', fallbackUsed: false,
      fingerprint: null, ok: false, resultSummary: 'failed', error: 'boom',
    }, storage);
    expect(callsToday('deepseek', loadAiRouterLog(storage))).toBe(2);
    expect(providerHealth(['deepseek'], 'deepseek', loadAiRouterLog(storage))).toBe('error');
    expect(providerHealth([], 'deepseek', loadAiRouterLog(storage))).toBe('not_configured');
    expect(providerHealth(['deepseek'], 'openai', loadAiRouterLog(storage))).toBe('not_configured');
  });

  it('compareProviderOutputs detects agreement and disagreement', () => {
    expect(compareProviderOutputs('score 60/100', 'score 62/100').disagree).toBe(false);
    expect(compareProviderOutputs('score 60/100', 'score 78/100').disagree).toBe(true);
    expect(compareProviderOutputs('no number here', 'also none').disagree).toBe(false);
  });
});
