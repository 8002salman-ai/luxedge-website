// ============================================================================
// LUXEDGE V2 — CJ SEED DISCOVERY + PRODUCT-CONCEPT CLUSTERING (Phase 4F)
//
// The web-discovery bottleneck is proven: generic/site-restricted discovery
// does not reliably produce enough retrievable exact PDPs. This module uses
// the OFFICIAL CJ supplier API ONCE as a LOW-COST PRODUCT-CONCEPT SEED
// SOURCE — real product titles/concepts that can then be researched more
// precisely in the USA market.
//
// CJ SUPPLIER DATA IS NOT MARKET DEMAND. CJ returns product titles, supplier
// products, price, variants, stock, warehouse, freight — supplier/economic
// evidence. It MUST NOT be converted into consumer demand, sales, review
// evidence, search volume, Market Score or trend strength. `listedNum` is a
// supplier listing count and is NEVER treated as demand.
//
// This workflow (CJ_SEED_DISCOVERY) is deliberately NOT:
//   BUSINESS_QUALIFIED / PRODUCT_SHORTLISTED / MARKET-GROUNDED SEARCH.
// Its only purpose: find real product concepts that can be researched more
// precisely in the USA market. It never creates product_candidates, never
// scores winners, never drafts, never publishes, never orders/pays.
//
// DURABLE SEED RUN: ONE run on the supplier_api_runs ledger with a hard
// budget of exactly 50 points (the cost of ONE product/listV2 call). NO
// product detail, NO freightCalculate. If the list call fails: STOP — no
// second paid seed run is created automatically.
// ============================================================================

import type { DbAdapter } from '../../services/db';
import type {
  SupplierDiscoveryAdapter, SupplierProductRecord, SupplierSearchOptions,
  SupplierPointUsage,
} from '../suppliers/types';
import { CjPointBudget, CJ_POINT_COST } from '../suppliers/cj/points';
import { createJob, completeJob, addRun, addLog } from './persist';
import { prefilterCjRecord } from '../suppliers/cj/prefilter';
import type { MarketIntelligenceResult } from './engine';
import { MARKET_QUALIFICATION_GATE } from './engine';

/** Hard seed-run budget: exactly the cost of ONE listV2 call. */
export const CJ_SEED_BUDGET = CJ_POINT_COST.listV2; // 50

/** How many supplier records ONE seed listV2 call aims to return. */
export const CJ_SEED_MAX_RECORDS = 40;

/** Max distinct product concepts selected for market research (Part B §5). */
export const CJ_SEED_MAX_CONCEPTS = 2;

/**
 * A FACTUAL CJ seed record — only fields CJ actually returned. Nothing is
 * invented: no ratings, no reviews, no sales/orders, no trend status, no
 * delivery time, no freight, no landed cost. `listedNum` is a SUPPLIER
 * LISTING COUNT and must never be read as consumer demand.
 */
export interface CjSeedRecord {
  provider: 'cj';
  productId: string;
  sku: string;
  title: string;
  category: string | null;
  imageUrl: string | null;
  images: string[];
  /** Base/supplier price when CJ returned it (null = not returned). */
  sellPrice: number | null;
  usInventoryTotal: number | null;
  usInventoryVerified: number | null;
  usInventoryInCountry: boolean;
  warehouse: string | null;
  deliveryCycle: string | null;
  /** Supplier listing count — NOT sales, orders, search volume or demand. */
  listedNum: number | null;
  supplierName: string | null;
  observedAt: string;
  sourceUrl: string;
}

/** Map a normalized supplier record into a factual seed record. */
export function seedRecordFromSupplierRecord(r: SupplierProductRecord): CjSeedRecord {
  return {
    provider: 'cj',
    productId: r.productId,
    sku: r.sku,
    title: r.title,
    category: r.category,
    imageUrl: r.imageUrl,
    images: r.images,
    sellPrice: r.sellPrice,
    usInventoryTotal: r.usInventoryTotal,
    usInventoryVerified: r.usInventoryVerified,
    usInventoryInCountry: r.usInventoryInCountry,
    warehouse: r.warehouse,
    deliveryCycle: r.deliveryCycle,
    listedNum: r.listedNum,
    supplierName: r.supplierName,
    observedAt: r.observedAt,
    sourceUrl: r.sourceUrl,
  };
}

// ---------------------------------------------------------------------------
// PRODUCT-CONCEPT CLUSTERING (Part B) — deterministic, no AI, no demand claims
// ---------------------------------------------------------------------------

const SIZE_TOKENS = /\b(s|m|l|xl|xxl|xxxl|2xl|3xl|sm|md|lg|sz|size|color|colour)\b/g;
const QTY_TOKENS = /\b(pack|pcs|pieces|set|count|packaging|box)\b/g;
const DIMENSION_RE = /\b\d+(\.\d+)?\s*(oz|ml|g|kg|lb|lbs|cm|mm|inch|inches|in|ft|feet|m)\b/g;
const STOP_WORDS = new Set(['for', 'with', 'and', 'the', 'of', 'to', 'in', 'on', 'your', 'you', 'this', 'that', 'a', 'an', 'new', 'high', 'quality', 'easy', 'perfect']);

/** Deterministic concept key: lowercase, punctuation stripped, filler removed. */
export function conceptKey(title: string): string {
  let t = title.toLowerCase();
  t = t.replace(/[^a-z0-9\s]/g, ' ');
  t = t.replace(QTY_TOKENS, ' ');
  t = t.replace(SIZE_TOKENS, ' ');
  t = t.replace(DIMENSION_RE, ' ');
  t = t.replace(/\b\d+\b/g, ' ');
  const words = t.split(/\s+/).filter((w) => w && !STOP_WORDS.has(w));
  return words.join(' ');
}

export function conceptTokens(title: string): string[] {
  return conceptKey(title).split(' ').filter(Boolean);
}

/** Jaccard similarity of two concept token sets (deterministic grouping). */
export function tokenSetSimilarity(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = new Set([...sa, ...sb]).size;
  return union ? inter / union : 0;
}

/** One clustered product concept derived from real CJ seed records. */
export interface CjSeedConcept {
  /** Deterministic concept key (normalized title vocabulary). */
  key: string;
  /** Representative label — the most complete member title. */
  label: string;
  /** Real seed records grouped into this concept (same product concept). */
  records: CjSeedRecord[];
  memberPids: string[];
  /**
   * Supplier-suitability score (NOT a demand/market score). Ranks concepts
   * only for: pet relevance, product clarity, supplier data completeness,
   * basic safety/risk suitability. Higher = more researchable, not "popular".
   */
  suitabilityScore: number;
  /** Why this concept was ranked the way it was (deterministic reasons). */
  suitabilityReasons: string[];
}

/**
 * Greedy deterministic clustering of seed records into product concepts.
 * Records whose concept tokens overlap heavily (Jaccard >= threshold) group
 * together — obvious variants of the same product concept dedupe; genuinely
 * distinct concepts stay separate. Order-independent by sorting on a stable
 * key first (product id), so results are reproducible.
 */
export function clusterCjSeedConcepts(
  records: CjSeedRecord[],
  similarityThreshold = 0.5
): CjSeedConcept[] {
  const sorted = [...records].sort((a, b) => a.productId.localeCompare(b.productId));
  const clusters: { key: string; members: CjSeedRecord[] }[] = [];

  for (const r of sorted) {
    const tokens = conceptTokens(r.title);
    let placed = false;
    for (const c of clusters) {
      const rep = conceptTokens(c.members[0].title);
      if (tokenSetSimilarity(tokens, rep) >= similarityThreshold) {
        c.members.push(r);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push({ key: conceptKey(r.title), members: [r] });
  }

  return clusters.map((c) => {
    const members = [...c.members].sort((a, b) => b.title.length - a.title.length);
    const label = members[0]?.title ?? c.key;
    const suitability = assessConceptSuitability(members);
    return {
      key: c.key,
      label,
      records: members,
      memberPids: members.map((m) => m.productId),
      suitabilityScore: suitability.score,
      suitabilityReasons: suitability.reasons,
    };
  });
}

/**
 * Supplier-suitability assessment for a concept's seed records. Uses ONLY
 * supplier/data facts: pet relevance, product clarity, real price, image,
 * US inventory figure, delivery cycle, and the existing deterministic
 * prefilter for IP/medical/battery/price/image safety. This is NOT consumer
 * demand proof and it contributes nothing to any Market Score.
 */
export function assessConceptSuitability(records: CjSeedRecord[]): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const petRelevant = records.filter((r) => /\b(dog|puppy|canine|cat|kitten|feline|pet)\b/i.test(r.title));
  if (petRelevant.length) {
    score += petRelevant.length;
    reasons.push(`${petRelevant.length}/${records.length} records clearly pet-relevant`);
  }

  const withPrice = records.filter((r) => r.sellPrice !== null && r.sellPrice > 0);
  if (withPrice.length) {
    score += withPrice.length;
    reasons.push(`real supplier price on ${withPrice.length}`);
  }
  const withImage = records.filter((r) => r.imageUrl && r.images.length);
  if (withImage.length) {
    score += withImage.length;
    reasons.push(`usable images on ${withImage.length}`);
  }
  const withUsStock = records.filter((r) => r.usInventoryTotal !== null && r.usInventoryTotal > 0);
  if (withUsStock.length) {
    score += withUsStock.length;
    reasons.push(`US inventory figure on ${withUsStock.length} (inventory, not delivery)`);
  }
  const withDelivery = records.filter((r) => r.deliveryCycle !== null);
  if (withDelivery.length) {
    score += withDelivery.length;
    reasons.push(`delivery cycle on ${withDelivery.length}`);
  }
  // Long enough to be a real product title, short enough to be a clear concept.
  const clarity = records.filter((r) => r.title.length >= 12 && r.title.length <= 120);
  if (clarity.length) {
    score += clarity.length;
    reasons.push('clear single-product titles');
  }

  // Basic safety/risk suitability — reuses the deterministic prefilter rules
  // (IP/counterfeit, medical/veterinary, battery/fire) with US-inventory not
  // required at the concept level. This filters supplier suitability only.
  let safe = 0;
  for (const r of records) {
    const probe: SupplierProductRecord = {
      provider: 'cj', productId: r.productId, sku: r.sku, title: r.title,
      selectedVariant: null, imageUrl: r.imageUrl, images: r.images,
      sellPrice: r.sellPrice, category: r.category, weightGrams: null,
      usInventoryVerified: r.usInventoryVerified, usInventoryTotal: r.usInventoryTotal,
      usInventoryInCountry: r.usInventoryInCountry, warehouse: r.warehouse,
      freeShipping: false, deliveryCycle: r.deliveryCycle, listedNum: r.listedNum,
      supplierName: r.supplierName, description: null, sourceUrl: r.sourceUrl,
      observedAt: r.observedAt, raw: {},
    };
    if (prefilterCjRecord(probe, { requireUsInventory: false }).ok) safe++;
  }
  score += safe;
  reasons.push(safe === records.length
    ? 'all records pass basic IP/medical/battery/price/image safety filters'
    : `${safe}/${records.length} records pass basic safety filters`);

  return { score, reasons };
}

/**
 * Select up to `max` DISTINCT concepts for market research. Ranking uses ONLY
 * supplier-suitability (pet relevance, clarity, data completeness, safety) —
 * never invented popularity. Returns concepts sorted by suitabilityScore desc.
 */
export function selectSeedConcepts(records: CjSeedRecord[], max = CJ_SEED_MAX_CONCEPTS): CjSeedConcept[] {
  const clusters = clusterCjSeedConcepts(records)
    .sort((a, b) => b.suitabilityScore - a.suitabilityScore || b.memberPids.length - a.memberPids.length)
    .slice(0, Math.max(1, max));
  return clusters;
}

/**
 * Build the targeted market-search vocabulary from a CJ concept: the actual
 * concept/title vocabulary learned from CJ (cleaned), capped at ~7 tokens so
 * the query stays precise. This is the vocabulary for MARKET EVIDENCE
 * discovery — it is not a supplier query and carries no demand claim.
 */
export function seedConceptSearchQuery(concept: CjSeedConcept, maxTokens = 7): string {
  const tokens = conceptTokens(concept.label);
  return tokens.slice(0, maxTokens).join(' ');
}

// ---------------------------------------------------------------------------
// DURABLE SEED RUN (Part A) — 50 points, ONE listV2, zero detail/freight
// ---------------------------------------------------------------------------

export interface CjSeedRunResult {
  jobId: string;
  runId: string | null;
  hardBudget: number;
  query: string;
  health: string;
  /** Fail-closed code when the durable ledger is unavailable (zero paid calls). */
  code?: string;
  recordsReturned: number;
  /** Records AFTER stable pid/SKU dedupe (CJ seed facts only). */
  seeds: CjSeedRecord[];
  duplicates: number;
  /** Points reserved for actual paid requests (server-authoritative when known). */
  pointsReserved: number;
  listCalls: number;
  detailCalls: number;
  freightCalls: number;
  serverPoints?: SupplierPointUsage | null;
  /** The clustered product concepts (max 2 selected for research). */
  concepts: CjSeedConcept[];
  warning?: string;
}

export interface CjSeedDiscoveryOptions {
  adapter: SupplierDiscoveryAdapter;
  db: DbAdapter;
  /** Seed search query (concept vocabulary source). Default: dog travel accessories. */
  query?: string;
  market?: string;
  maxResults?: number;
  onProgress?: (msg: string) => void;
}

/**
 * Run ONE controlled CJ seed-discovery pass:
 *
 *   start durable run (hard budget = 50) → ONE listV2 → dedupe (pid/SKU)
 *   → cluster concepts → persist a durable PRODUCT_RESEARCH job (note
 *   CJ_SEED_DISCOVERY) with the factual seed records → return.
 *
 * HARD RULES:
 *   * budget is EXACTLY 50 — after the list call nothing remains, so detail
 *     and freight are impossible (also enforced server-side by the durable
 *     ledger reserve-before-HTTP RPC).
 *   * If the list call fails → STOP. No second paid seed run is created.
 *   * No product_candidates are created. No scoring. No drafts. No publish.
 *   * `listedNum` is preserved as a listing count only — never demand.
 */
export async function runCjSeedDiscovery(opts: CjSeedDiscoveryOptions): Promise<CjSeedRunResult> {
  const { adapter, db, query = 'dog travel accessories', market = 'US', maxResults = CJ_SEED_MAX_RECORDS, onProgress } = opts;
  const progress = (m: string) => onProgress?.(m);
  const at = new Date().toISOString();

  // Durable seed run — the SERVER creates the supplier_api_runs row with the
  // DB-clamped hard budget. FAIL CLOSED: no durable run → zero paid CJ calls.
  let runId: string | null = null;
  let hardBudget = CJ_SEED_BUDGET;
  let ledgerError = '';
  try {
    const started = await adapter.startRun?.(CJ_SEED_BUDGET);
    if (!started?.runId) throw new Error('durable supplier run was not created (startRun returned no run id)');
    runId = started.runId;
    hardBudget = started.hardBudget;
  } catch (e) {
    ledgerError = (e as Error).message;
    progress(`[block] ${ledgerError}`);
  }
  const budget = new CjPointBudget(CJ_SEED_BUDGET);
  if (runId) adapter.setRunScope?.(runId, hardBudget);
  const finishRun = (status: 'completed' | 'failed' | 'exhausted') => {
    if (!runId) return Promise.resolve();
    return adapter.finishRun?.(status).catch(() => {});
  };

  if (!runId) {
    const code = 'CJ_DURABLE_LEDGER_UNAVAILABLE';
    const jobId = await createJob(db, 'PRODUCT_RESEARCH', {
      provider: adapter.provider, query, target_market: market, at,
      note: 'CJ_SEED_DISCOVERY BLOCKED — durable seed run ledger unavailable; zero paid supplier API calls issued (fail closed).',
    });
    await addRun(db, jobId, 'cj-seed-discovery', 'failed', code);
    await addLog(db, jobId, 'error', `CJ SEED DISCOVERY BLOCKED: ${code} — ${ledgerError}`);
    await completeJob(db, jobId, 'failed', { code, error: ledgerError, retries: 0 });
    progress(`[block] ${code} — zero paid supplier calls issued.`);
    return {
      jobId, runId: null, hardBudget, query, health: 'offline', code,
      recordsReturned: 0, seeds: [], duplicates: 0, pointsReserved: 0,
      listCalls: 0, detailCalls: 0, freightCalls: 0, concepts: [],
      warning: `Seed run blocked: durable point ledger unavailable (${ledgerError}) — zero paid calls issued.`,
    };
  }

  const jobId = await createJob(db, 'PRODUCT_RESEARCH', {
    provider: adapter.provider, query, target_market: market, at, runId,
    note: 'CJ_SEED_DISCOVERY — ONE listV2 (50pt budget) → dedupe → concept clustering → persist factual seeds. NOT a supplier qualification run; no candidates, no scoring.',
  });
  await addRun(db, jobId, 'cj-seed-discovery', 'running', `Seed discovery ${adapter.provider.toUpperCase()}: ${query} (budget ${budget.budget}pts)`);
  await addLog(db, jobId, 'info', `CJ_SEED_DISCOVERY started for "${query}" (budget=${budget.budget}pts, retries=0)`);

  // ONE listV2 call — the only paid request a 50-point seed run can afford.
  if (!budget.canSpend('listV2')) {
    await addLog(db, jobId, 'error', `Seed budget ${budget.budget} exhausted before the search — run denied.`);
    await addRun(db, jobId, 'cj-seed-discovery', 'failed', 'CJ point budget exhausted before search');
    await completeJob(db, jobId, 'failed', { error: 'CJ point budget exhausted', points: budget.usage() });
    await finishRun('failed');
    return { jobId, runId, hardBudget, query, health: 'offline', recordsReturned: 0, seeds: [], duplicates: 0, pointsReserved: 0, listCalls: 0, detailCalls: 0, freightCalls: 0, concepts: [], warning: 'Seed budget exhausted before search' };
  }

  let result;
  try {
    result = await adapter.searchProducts({ query, market, maxResults } as SupplierSearchOptions);
    budget.spend('listV2');
  } catch (e) {
    await addLog(db, jobId, 'error', `CJ_SEED_DISCOVERY search failed: ${(e as Error).message} (retries=0)`);
    await addRun(db, jobId, 'cj-seed-discovery', 'failed', `Seed search failed: ${(e as Error).message}`);
    await completeJob(db, jobId, 'failed', { error: (e as Error).message, retries: 0, points: budget.usage() });
    await finishRun('failed');
    return { jobId, runId, hardBudget, query, health: 'offline', recordsReturned: 0, seeds: [], duplicates: 0, pointsReserved: 0, listCalls: 0, detailCalls: 0, freightCalls: 0, concepts: [], warning: `Seed search failed: ${(e as Error).message}` };
  }
  progress(`[seed] ${adapter.provider.toUpperCase()} returned ${result.records.length} records (health=${result.health}, points used ${budget.used}/${budget.budget})${result.warning ? ' — ' + result.warning : ''}`);
  await addLog(db, jobId, 'info', `CJ_SEED_DISCOVERY: ${result.records.length} records, health=${result.health}${result.warning ? '; ' + result.warning : ''}`);

  // Stable pid/SKU dedupe across the returned set (same product may repeat).
  const seen = new Set<string>();
  const seeds: CjSeedRecord[] = [];
  let duplicates = 0;
  for (const r of result.records) {
    const key = r.productId ? `cj:${r.productId.toUpperCase()}` : r.sku ? `cj:sku:${r.sku.toUpperCase()}` : r.sourceUrl;
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key);
    seeds.push(seedRecordFromSupplierRecord(r));
  }
  if (duplicates) progress(`[seed] ${duplicates} duplicate CJ records skipped (stable pid/SKU keys)`);

  // Product-concept clustering (Part B) — deterministic, no demand claims.
  const concepts = selectSeedConcepts(seeds, CJ_SEED_MAX_CONCEPTS);
  for (const c of concepts) {
    progress(`[concept] "${c.label.slice(0, 60)}" — ${c.memberPids.length} record(s), suitability ${c.suitabilityScore} (${c.suitabilityReasons.join('; ')})`);
  }

  // Persist the seed proof durably on the existing PRODUCT_RESEARCH job type
  // (no schema migration needed): factual seed records + concepts. NEVER
  // create product_candidates here — seeds are concepts for research, not
  // candidates, and are never scored as winners.
  await addRun(db, jobId, 'cj-seed-discovery', 'completed', `${seeds.length} seeds (${duplicates} dups) · ${concepts.length} concepts · budget ${budget.used}/${budget.budget}pts`);
  await completeJob(db, jobId, 'completed', {
    query, market,
    mode: 'CJ_SEED_DISCOVERY',
    runId,
    hardBudget,
    pointsReserved: budget.used,
    recordsReturned: result.records.length,
    seedsDeduped: seeds.length,
    duplicates,
    concepts: concepts.map((c) => ({
      key: c.key, label: c.label, memberPids: c.memberPids,
      suitabilityScore: c.suitabilityScore, suitabilityReasons: c.suitabilityReasons,
    })),
    // Factual CJ seed records — supplier/economic evidence ONLY. listedNum is
    // a supplier listing count and is NOT consumer demand.
    seeds: seeds.map((s) => ({ ...s })),
    // Explicit honesty: this run produced NO market/demand evidence.
    marketScore: null,
    qualificationEligible: false,
    demandEvidence: 'NONE — CJ supplier data is not market demand.',
  });

  let serverPoints: SupplierPointUsage | null = null;
  try {
    serverPoints = (await adapter.getRunUsage?.()) ?? null;
  } catch {
    serverPoints = null;
  }
  await finishRun('exhausted'); // 50/50 used — the seed run is spent by design
  progress(`Done — ${seeds.length} seed records, ${concepts.length} concepts selected, points ${budget.used}/${budget.budget}.`);

  return {
    jobId, runId, hardBudget, query,
    health: result.health,
    recordsReturned: result.records.length,
    seeds, duplicates,
    pointsReserved: budget.used,
    listCalls: budget.listCalls,
    detailCalls: budget.detailCalls,
    freightCalls: budget.freightCalls,
    serverPoints,
    concepts,
    warning: result.warning || undefined,
  };
}

// ---------------------------------------------------------------------------
// PART E — CONDITIONAL MARKET-GROUNDED CJ QUALIFICATION RUN (fail-closed gate)
// ---------------------------------------------------------------------------

export type ConditionalRunDecision =
  | { run: false; reason: 'evidence-insufficient' | 'market-score-below-gate' | 'no-persisted-recommendation' }
  | {
      run: true;
      query: string;
      marketAnalysisId: string;
      hypothesis: string;
      recommendedSearchQueries: string[];
      marketScore: number;
    };

/**
 * Decide whether a market-grounded CJ qualification run may start (Part D §10
 * → Part E). FAIL CLOSED — a qualification run happens ONLY when:
 *   * evidenceQuality = sufficient AND qualificationEligible = true
 *   * marketScore (QUALIFYING) is a finite number >= 60
 *   * at least one search recommendation was persisted on the MI job
 * The ACTUAL supplier query must then be one of the persisted
 * recommendations (enforced again by marketProvenance when the run runs).
 * A diagnostic deterministic score can NEVER unlock this gate.
 */
export function conditionalQualifiedRunDecision(
  mi: Pick<MarketIntelligenceResult, 'jobId' | 'evidence' | 'qualificationEligible' | 'marketScore' | 'analysis'>
): ConditionalRunDecision {
  if (mi.evidence.evidenceQuality !== 'sufficient' || !mi.qualificationEligible) {
    return { run: false, reason: 'evidence-insufficient' };
  }
  if (mi.marketScore === null || mi.marketScore < MARKET_QUALIFICATION_GATE) {
    return { run: false, reason: 'market-score-below-gate' };
  }
  const recs = (mi.analysis?.recommendedSearchQueries ?? []).filter((r) => typeof r === 'string' && r.trim());
  if (recs.length === 0) {
    return { run: false, reason: 'no-persisted-recommendation' };
  }
  return {
    run: true,
    query: recs[0],
    marketAnalysisId: mi.jobId,
    hypothesis: recs[0],
    recommendedSearchQueries: recs,
    marketScore: mi.marketScore,
  };
}
