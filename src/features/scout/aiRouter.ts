// ============================================================================
// LUXEDGE V2 — AI ROUTER (Phase 4B amendment)
//
// Single funnel for every AI provider invocation. Enforces, in order:
//   master switch → feature switch → control mode → emergency pause →
//   provider routing (cost strategy) → capped retries + fallback →
//   second opinion (optional) → decision-log record.
//
// The router never calls a provider directly — it always goes through the
// secure server proxy (serverGenerate → /api/ai/generate, admin JWT, keys
// server-side). The chosen provider id + model are the only provider data
// that travels to the server.
//
// When the router blocks AI (services OFF, feature OFF, MANUAL mode without
// an explicit request, pause) it THROWS a catchable error so callers fall
// back to the deterministic pipeline — AI OFF never breaks Luxedge.
// ============================================================================

import { serverGenerate } from '../ai/client';
import type { AiControlConfig, AiTask, AiRouterLogEntry, ProviderSelection } from './aiControl';
import {
  aiGate, appendAiRouterLog, loadAiControlConfig, DEFAULT_MODEL_HELP,
  selectProvider, scrubLogError, type ProviderId,
} from './aiControl';
import { evidenceFingerprint } from './aiCost';
import { newId } from './persist';

export interface ProviderStatusInfo {
  configured: string[];
}

export interface RouterGenerateOptions {
  task: AiTask;
  /** High-value/uncertain decision — triggers QUALITY model + second opinion. */
  important?: boolean;
  /** Explicit owner request — allows AI in MANUAL control mode. */
  explicit?: boolean;
  /** Evidence fingerprint for cache/dedupe + audit. */
  fingerprint?: string | null;
  /** Optional explicit model override (legacy callers). */
  model?: string;
  system?: string;
  /** Injectable config (defaults to localStorage). */
  control?: AiControlConfig;
  /** Injectable configured-provider list (defaults to server status). */
  configured?: string[];
  /** Injectable provider-status loader (tests). */
  providerStatus?: () => Promise<ProviderStatusInfo>;
  /** Injectable generate call (tests) — default serverGenerate via proxy. */
  generate?: (prompt: string, provider: string, model: string, system?: string) => Promise<string>;
  /** Optional per-invocation log sink (e.g. agent_logs via addLog). */
  onLog?: (msg: string) => void;
}

export interface RouterGenerateResult {
  text: string;
  provider: string;
  model: string;
  fallbackUsed: boolean;
  why: string;
  controlMode: string;
  /** Second provider's text when a second opinion ran (may be undefined). */
  secondOpinionText?: string;
  secondOpinionProvider?: string;
  /** true when the second opinion materially disagreed (caller routes to owner). */
  secondOpinionDisagreed?: boolean;
}

const MAX_ATTEMPTS = 2;        // capped retries (1 retry per provider)
const BACKOFF_MS = 400;

/** Wait helper (capped backoff — never burn credits on blind retries). */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Try one provider with capped retries + backoff. Returns null when failed. */
async function tryProvider(
  generate: (prompt: string, provider: string, model: string, system?: string) => Promise<string>,
  prompt: string,
  sel: ProviderSelection,
  system?: string
): Promise<string | null> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await generate(prompt, sel.provider, sel.model, system);
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_ATTEMPTS) await sleep(BACKOFF_MS * attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('AI provider call failed');
}

/**
 * Compare two providers' structured outputs when a second opinion ran.
 * Default: extract the first integer 0-100 (e.g. a score) from each and
 * compare against the configured disagreement threshold.
 */
export function compareProviderOutputs(a: string, b: string): { disagree: boolean; aScore: number | null; bScore: number | null } {
  const scoreOf = (s: string): number | null => {
    const m = s.match(/\b(\d{1,3})\s*\/\s*100\b/);
    return m ? parseInt(m[1], 10) : null;
  };
  const aScore = scoreOf(a);
  const bScore = scoreOf(b);
  if (aScore === null || bScore === null) return { disagree: false, aScore, bScore };
  return { disagree: Math.abs(aScore - bScore) >= 10, aScore, bScore };
}

/**
 * Generate text through the AI router. Throws a plain Error when AI is
 * blocked or every provider failed — callers catch and use deterministic
 * paths. Never logs prompts, outputs, or key material.
 */
export async function routerGenerate(prompt: string, opts: RouterGenerateOptions): Promise<RouterGenerateResult> {
  const control = opts.control || loadAiControlConfig();
  const gate = aiGate(control, opts.task, { explicit: opts.explicit });
  if (!gate.allow) {
    throw new Error(gate.reason);
  }

  const configured = opts.configured || (opts.providerStatus ? (await opts.providerStatus()).configured : (await serverProviderStatusSafe()).configured);
  const generate = opts.generate || ((p, provider, model, system) => serverGenerate(p, provider, model, system));

  const selection = selectProvider(control, opts.task, configured, { important: opts.important, explicit: opts.explicit });
  if (!selection) {
    throw new Error(`No enabled + configured AI provider for ${opts.task} (AI Services ${control.aiServicesOn ? 'ON' : 'OFF'}, mode ${control.controlMode}). Deterministic path continues.`);
  }
  if (opts.model) selection.model = opts.model;

  let text: string;
  let fallbackUsed = false;
  let why = selection.why;
  try {
    text = (await tryProvider(generate, prompt, selection, opts.system))!;
  } catch (primaryErr) {
    // Fallback provider (§11): next configured provider for the task.
    // Respects the per-provider ON/OFF switch — a disabled provider is never
    // called, even as a fallback (§3).
    const rule = control.routing.find((r) => r.task === opts.task);
    const fallbackId = rule?.fallback || null;
    const fallbackCtrl = fallbackId ? control.providers.find((p) => p.id === fallbackId) : null;
    const fallbackUsable =
      fallbackId && fallbackId !== selection.provider && configured.includes(fallbackId) &&
      !!fallbackCtrl?.enabled && (fallbackCtrl?.tasks.includes(opts.task) ?? false);
    const fallbackSel: ProviderSelection | null =
      fallbackUsable
        ? {
            provider: fallbackId,
            name: control.providers.find((p) => p.id === fallbackId)?.name || fallbackId,
            model: DEFAULT_MODEL_HELP[fallbackId as ProviderId] || '',
            why: `Fallback after ${selection.name} failed: ${fallbackId}`,
          }
        : null;
    if (fallbackSel) {
      try {
        text = (await tryProvider(generate, prompt, fallbackSel, opts.system))!;
        fallbackUsed = true;
        why = fallbackSel.why;
      } catch {
        throw new Error(`All AI providers failed for ${opts.task}. Deterministic path continues.`);
      }
    } else {
      throw primaryErr instanceof Error ? primaryErr : new Error(`AI provider ${selection.name} failed for ${opts.task}`);
    }
  }

  const logEntryBase: Omit<AiRouterLogEntry, 'id' | 'at' | 'ok' | 'provider' | 'model' | 'resultSummary'> = {
    task: opts.task,
    controlMode: control.controlMode,
    why,
    fallbackUsed,
    fingerprint: opts.fingerprint ?? null,
  };

  const usedProvider = fallbackUsed ? (control.routing.find((r) => r.task === opts.task)?.fallback || selection.provider) : selection.provider;
  const result: RouterGenerateResult = {
    text,
    provider: usedProvider,
    model: fallbackUsed ? DEFAULT_MODEL_HELP[usedProvider] || '' : selection.model,
    fallbackUsed,
    why,
    controlMode: control.controlMode,
  };

  // SECOND OPINION (§6): an extra provider verifies important decisions.
  if (selection.secondOpinion) {
    const so = selection.secondOpinion;
    try {
      const soText = (await tryProvider(generate, prompt, so, opts.system))!;
      const cmp = compareProviderOutputs(text, soText);
      result.secondOpinionText = soText;
      result.secondOpinionProvider = so.provider;
      result.secondOpinionDisagreed = cmp.disagree;
      result.why = `${why} · second opinion ${so.name}${cmp.disagree ? ' DISAGREED (→ owner attention)' : ' agreed'}`;
      opts.onLog?.(`Second opinion via ${so.name}: ${cmp.disagree ? 'disagreement detected — owner attention' : 'agreement'}`);
      appendAiRouterLog({
        ...logEntryBase,
        id: newId(),
        at: new Date().toISOString(),
        provider: so.provider,
        model: so.model,
        ok: true,
        resultSummary: `second opinion ${cmp.disagree ? 'disagreed' : 'agreed'}`,
      });
    } catch (soErr) {
      opts.onLog?.(`Second opinion via ${so.name} failed — primary result stands`);
      appendAiRouterLog({
        ...logEntryBase,
        id: newId(),
        at: new Date().toISOString(),
        provider: so.provider,
        model: so.model,
        ok: false,
        resultSummary: 'second opinion failed',
        error: scrubLogError((soErr as Error).message),
      });
    }
  }

  // Decision log (§10).
  appendAiRouterLog({
    ...logEntryBase,
    id: newId(),
    at: new Date().toISOString(),
    provider: result.provider,
    model: result.model,
    ok: true,
    resultSummary: `${opts.task} ok (${text.length} chars)`,
  });

  opts.onLog?.(`[ai-router] ${opts.task} → ${result.provider} (${result.model})${fallbackUsed ? ' [fallback]' : ''} — ${why}`);
  return result;
}

/** Safe server-status load — never throws; an empty list = no AI. */
async function serverProviderStatusSafe(): Promise<ProviderStatusInfo> {
  try {
    const { serverProviderStatus } = await import('../ai/client');
    const st = await serverProviderStatus();
    return { configured: Array.isArray(st.providers) ? st.providers.filter((p) => p.configured).map((p) => p.id) : [] };
  } catch {
    return { configured: [] };
  }
}

/** Convenience: build an aiCall-compatible function for a task. */
export function routerCallFor(task: AiTask, opts?: Omit<RouterGenerateOptions, 'task'>): (prompt: string, model?: string) => Promise<string> {
  return async (prompt: string, model?: string) => {
    const r = await routerGenerate(prompt, { ...opts, task, model });
    return r.text;
  };
}

/** Evidence fingerprint helper re-exported for callers. */
export { evidenceFingerprint as aiEvidenceFingerprint };
