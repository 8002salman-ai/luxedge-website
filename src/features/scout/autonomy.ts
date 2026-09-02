// ============================================================================
// LUXEDGE V2 — SCOUT GUARDED AUTONOMY (Phase 4B)
//
// Policy layer over the deterministic evidence pipeline. Three modes:
//   MANUAL — owner controls every candidate transition.
//   REVIEW — AI researches/scores/QA/prepares; owner approves key transitions.
//   AUTO   — AI may advance LOW-RISK products when EVERY policy gate passes.
//
// AUTO can NEVER override hard safety/business gates: hard rejection, missing
// source cost, low margin confidence, IP/regulatory concerns, unknown critical
// fields, QA failure, or the EMERGENCY PAUSE.
//
// The owner attention queue surfaces ONLY meaningful decisions (pricing
// exception, uncertain supplier, possible IP issue, publish exception, spend),
// so the owner reviews a short queue instead of operating the system.
// ============================================================================

import type { AutonomyConfig, AutonomyDecision, OwnerAttentionItem, ScoutCandidate } from './types';
import type { QAOutcome } from './engine';
import { newId } from './persist';
import { SHORTLIST_THRESHOLD } from './score';

export const DEFAULT_AUTONOMY_CONFIG: AutonomyConfig = {
  mode: 'REVIEW',
  productScoreThreshold: SHORTLIST_THRESHOLD,
  marketScoreThreshold: 60,
  minMarginPct: 0.35,
  maxUnknownFields: 3,
  requireUsaDelivery: true,
  requireQa: true,
  emergencyPause: false,
  maxAiCallsPerRun: 6,
};

export const AUTONOMY_MODES = ['MANUAL', 'REVIEW', 'AUTO'] as const;

// ---------------------------------------------------------------------------
// Emergency pause (kill switch)
// ---------------------------------------------------------------------------

const PAUSE_KEY = 'luxedge_scout_emergency_pause';

export function isEmergencyPaused(storage?: Pick<Storage, 'getItem'>): boolean {
  try {
    return (storage || window.localStorage).getItem(PAUSE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setEmergencyPause(on: boolean, storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage || window.localStorage).setItem(PAUSE_KEY, on ? '1' : '0');
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Config persistence (admin-only, no secrets)
// ---------------------------------------------------------------------------

const CONFIG_KEY = 'luxedge_scout_autonomy_config';

export function loadAutonomyConfig(storage?: Pick<Storage, 'getItem'>): AutonomyConfig {
  const base = { ...DEFAULT_AUTONOMY_CONFIG, emergencyPause: isEmergencyPaused(storage) };
  try {
    const raw = (storage || window.localStorage).getItem(CONFIG_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<AutonomyConfig>;
    return { ...base, ...parsed, emergencyPause: base.emergencyPause };
  } catch {
    return base;
  }
}

export function saveAutonomyConfig(cfg: AutonomyConfig, storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage || window.localStorage).setItem(CONFIG_KEY, JSON.stringify(cfg));
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Autonomy decision engine
// ---------------------------------------------------------------------------

export interface AutonomyInput {
  candidate: ScoutCandidate;
  /** Market Opportunity Score /100 (may be null if never analyzed). */
  marketScore: number | null;
  /** PRODUCT_QA outcome (may be null if never QA'd). */
  qa: QAOutcome | null;
  config: AutonomyConfig;
}

/**
 * Evaluate whether the candidate may advance autonomously. Every gate must
 * pass for AUTO; any hard-gate failure forces owner review regardless of mode.
 */
export function evaluateAutonomy(input: AutonomyInput): AutonomyDecision {
  const { candidate, marketScore, qa, config } = input;
  const gates: Record<string, boolean> = {};

  const hardRejected = candidate.status === 'rejected';
  gates.noHardRejection = !hardRejected;

  const productScore = candidate.score?.overall ?? 0;
  gates.productScoreOk = !hardRejected && productScore >= config.productScoreThreshold;

  gates.marketScoreOk = marketScore !== null && marketScore >= config.marketScoreThreshold;

  // Margin: must be HIGH confidence AND above the configured floor.
  const marginHigh = candidate.margin?.confidence === 'high' && candidate.margin.grossMarginPct !== null;
  gates.marginHigh = !!marginHigh;
  gates.minMargin = !!marginHigh && (candidate.margin?.grossMarginPct ?? 0) >= config.minMarginPct;

  // USA delivery requirement. `!= null` so evidence that simply lacks
  // shippingDays fails the gate instead of crashing on `.status` (undefined
  // is not null — the old `!== null` guard fell through to the property read).
  const deliveryOk = !config.requireUsaDelivery ||
    (candidate.evidence.shippingDays != null &&
     candidate.evidence.shippingDays.status !== 'unknown' &&
     candidate.evidence.availability?.value !== 'unavailable');
  gates.usaDelivery = deliveryOk;

  // QA requirement.
  gates.qaPass = !config.requireQa || (qa !== null && qa.passed);

  // Unknown critical fields cap.
  const unknownCount = candidate.evidence.unknownFields?.length ?? 0;
  gates.unknownFieldsOk = unknownCount <= config.maxUnknownFields;

  // Source cost known.
  gates.sourceCostKnown = (candidate.evidence.supplierPrice?.value as number | null) !== null;

  // No IP / regulatory concern in risk notes.
  const riskText = (candidate.evidence.riskNotes || []).join(' ').toLowerCase();
  gates.noIpRegulatory = !/(counterfeit|ip risk|medical|regulated|battery|fire)/.test(riskText);

  // Emergency pause — absolute kill switch.
  gates.emergencyPauseOff = !config.emergencyPause;

  const allPass = Object.values(gates).every(Boolean);

  if (config.mode === 'MANUAL') {
    return {
      eligibleForAutoPublish: false,
      reason: `Mode MANUAL — owner controls transitions. ${gates.noHardRejection ? '' : 'Candidate is hard-rejected.'}`,
      gates,
      needsOwnerAttention: !gates.noHardRejection || !gates.unknownFieldsOk || !gates.minMargin,
    };
  }

  if (config.mode === 'REVIEW') {
    const attentionReasons: string[] = [];
    if (!gates.productScoreOk) attentionReasons.push(`Product score ${productScore} below threshold ${config.productScoreThreshold}`);
    if (!gates.marketScoreOk) attentionReasons.push(marketScore === null ? 'No market opportunity score yet' : `Market score ${marketScore} below threshold ${config.marketScoreThreshold}`);
    if (!gates.minMargin) attentionReasons.push('Margin below minimum or confidence not HIGH');
    if (!gates.unknownFieldsOk) attentionReasons.push(`${unknownCount} unknown fields exceed cap ${config.maxUnknownFields}`);
    if (hardRejected) attentionReasons.push('Candidate is hard-rejected');
    return {
      eligibleForAutoPublish: false,
      reason: `Mode REVIEW — candidate prepared; owner approval required. ${attentionReasons.length ? attentionReasons.join('; ') : 'All gates pass — ready for owner approval.'}`,
      gates,
      needsOwnerAttention: attentionReasons.length > 0 || qa === null || marketScore === null,
    };
  }

  // AUTO mode — advance only when every gate passes.
  if (allPass) {
    return {
      eligibleForAutoPublish: true,
      reason: 'AUTO mode: every policy gate passed — eligible for autonomous publish under policy.',
      gates,
      needsOwnerAttention: false,
    };
  }

  const failures = Object.entries(gates).filter(([, v]) => !v).map(([k]) => k);
  const isHardFailure = failures.some((f) => ['noHardRejection', 'sourceCostKnown', 'noIpRegulatory', 'emergencyPauseOff'].includes(f));
  return {
    eligibleForAutoPublish: false,
    reason: `AUTO blocked: ${failures.join(', ')}${config.emergencyPause ? ' (EMERGENCY PAUSE ACTIVE)' : ''}`,
    gates,
    needsOwnerAttention: isHardFailure || true, // blocked AUTO always surfaces
  };
}

// ---------------------------------------------------------------------------
// Owner attention queue
// ---------------------------------------------------------------------------

const ATTENTION_KEY = 'luxedge_scout_owner_attention';

export function loadAttentionItems(storage?: Pick<Storage, 'getItem'>): OwnerAttentionItem[] {
  try {
    const raw = (storage || window.localStorage).getItem(ATTENTION_KEY);
    return raw ? (JSON.parse(raw) as OwnerAttentionItem[]) : [];
  } catch {
    return [];
  }
}

export function saveAttentionItems(items: OwnerAttentionItem[], storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage || window.localStorage).setItem(ATTENTION_KEY, JSON.stringify(items.slice(0, 50)));
  } catch { /* ignore */ }
}

/** Add an attention item (deduped by candidate+reason). */
export function pushAttentionItem(
  item: Omit<OwnerAttentionItem, 'id' | 'createdAt' | 'status'>,
  storage?: Pick<Storage, 'getItem' | 'setItem'>
): OwnerAttentionItem {
  const items = loadAttentionItems(storage);
  const dup = items.find((i) => i.candidateId === item.candidateId && i.reason === item.reason && i.status === 'pending');
  if (dup) return dup;
  const full: OwnerAttentionItem = { ...item, id: newId(), createdAt: new Date().toISOString(), status: 'pending' };
  saveAttentionItems([full, ...items], storage);
  return full;
}

export function resolveAttentionItem(id: string, storage?: Pick<Storage, 'getItem' | 'setItem'>): void {
  const items = loadAttentionItems(storage);
  saveAttentionItems(items.map((i) => (i.id === id ? { ...i, status: 'resolved' } : i)), storage);
}

/** Build attention items for a candidate based on its decision + evidence. */
export function attentionForCandidate(
  candidate: ScoutCandidate,
  decision: AutonomyDecision,
  marketScore: number | null,
  qa: QAOutcome | null
): Omit<OwnerAttentionItem, 'id' | 'createdAt' | 'status'>[] {
  const out: Omit<OwnerAttentionItem, 'id' | 'createdAt' | 'status'>[] = [];
  const price = candidate.evidence.supplierPrice?.value as number | null;
  const marginPct = candidate.margin?.grossMarginPct !== null ? Math.round((candidate.margin?.grossMarginPct ?? 0) * 100) : null;

  if (candidate.status === 'rejected' && candidate.rejectionReason) {
    out.push({
      candidateId: candidate.id,
      title: candidate.title,
      reason: `Hard-rejected: ${candidate.rejectionReason}`,
      recommendedAction: 'Review rejection reason; correct source data and re-run, or discard.',
      riskIfIgnored: 'Riskier product could be listed against policy.',
      evidence: `Source: ${candidate.sourceUrl}`,
    });
  }
  if (marketScore === null && candidate.status !== 'rejected') {
    out.push({
      candidateId: candidate.id,
      title: candidate.title,
      reason: 'No market opportunity score — market intelligence not run.',
      recommendedAction: 'Run Market Intelligence for this candidate before deciding.',
      riskIfIgnored: 'Opportunity may be weak or strong without evidence to decide.',
      evidence: `Source: ${candidate.sourceUrl}`,
    });
  }
  if (price !== null && marginPct !== null && marginPct >= 55) {
    out.push({
      candidateId: candidate.id,
      title: candidate.title,
      reason: `Unusually high margin (${marginPct}%) — elevated risk possible.`,
      recommendedAction: 'Verify pricing/supplier before listing; confirm the price is real, not an error.',
      riskIfIgnored: 'A pricing error could cause losses or chargebacks.',
      evidence: `Supplier price $${price.toFixed(2)}, margin ${marginPct}%`,
    });
  }
  if (qa && !qa.passed) {
    out.push({
      candidateId: candidate.id,
      title: candidate.title,
      reason: `QA flagged: ${qa.issues.join('; ')}`,
      recommendedAction: 'Correct the evidence gaps or reject the candidate.',
      riskIfIgnored: 'Listing could carry unsupported claims or unusable assets.',
      evidence: `QA ${qa.passed ? 'PASS' : 'FAIL'}`,
    });
  }
  if (decision.needsOwnerAttention && candidate.status !== 'rejected') {
    out.push({
      candidateId: candidate.id,
      title: candidate.title,
      reason: decision.reason,
      recommendedAction: decision.eligibleForAutoPublish ? 'Approve to prepare the listing draft.' : 'Review gates and approve/reject manually.',
      riskIfIgnored: 'Candidate stalls in the queue; no autonomous action taken.',
      evidence: `Product ${candidate.score?.overall ?? 'n/a'}/100 · Market ${marketScore ?? 'n/a'}/100`,
    });
  }
  return out;
}
