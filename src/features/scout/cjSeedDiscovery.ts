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
  const words = t.split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    // Plural normalization — "door"/"doors", "bag"/"bags", "cage"/"cages"
    // are the SAME concept token. Deterministic; without it real variant
    // clusters fragment (e.g. "Single Door Dog Cage" vs "Dog Cage With Two
    // Doors"). Guards words ending in double-s so "class" stays "class".
    .map((w) => (w.length >= 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .filter(Boolean);
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
   * FIXED concept-level supplier-suitability score (0–15, Phase 4G §B) — NOT
   * a demand/market score and NOT scaled by member count. Ranks concepts
   * only for: pet relevance, product clarity, supplier data completeness,
   * basic safety/risk suitability. Higher = more researchable, not "popular".
   */
  suitabilityScore: number;
  /** Informational only — NEVER popularity, NEVER a score input. */
  memberCount: number;
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
      // Informational only — never a score input, never popularity.
      memberCount: members.length,
    };
  });
}

/**
 * Supplier-suitability assessment for a concept — FIXED CONCEPT-LEVEL SCORE
 * (Phase 4G §B). Points are awarded ONCE per concept, NOT per member record:
 * a concept with 5 near-duplicate CJ variants must NOT outrank an equally-
 * complete concept with 1 record merely because more listings exist. That is
 * not consumer demand and it is an undesirable selection bias.
 *
 *   pet relevance           0–2   (dog/cat/pet in the representative title)
 *   clear product concept   0–2   (title length is a real single-product title)
 *   verified supplier price 0–2   (ANY member has a real price — not count)
 *   usable image evidence   0–2   (ANY member has a real image — not count)
 *   US inventory evidence   0–2   (ANY member has a US inventory figure —
 *                                  inventory, NOT delivery, NOT demand)
 *   delivery-cycle evidence 0–1   (ANY member has a delivery cycle)
 *   basic safety pass       0–2   (ALL members pass IP/medical/battery/
 *                                  price/image prefilter)
 *   researchability         0–2   (concept tokens in a researchable band)
 *   MAX = 15
 *
 * memberCount and listedNum are recorded separately (informational only) and
 * NEVER contribute to the score. This is NOT demand proof and contributes
 * nothing to any Market Score.
 */
export function assessConceptSuitability(records: CjSeedRecord[]): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const rep = [...records].sort((a, b) => b.title.length - a.title.length)[0];
  if (!rep) return { score: 0, reasons: ['no records'] };
  const any = (fn: (r: CjSeedRecord) => boolean) => records.some(fn);
  const title = rep.title.toLowerCase();

  // 1) Pet relevance (0–2)
  let petPts = 0;
  if (/\b(dog|puppy|canine|cat|kitten|feline)\b/.test(title)) petPts = 2;
  else if (/\bpet\b/.test(title)) petPts = 1;
  reasons.push(petPts ? `pet-relevant title (+${petPts})` : 'no clear pet keyword in title');

  // 2) Clear product concept (0–2) — a real single-product title. Uses the
  //    NORMALIZED concept-token count, not raw title length: CJ titles are
  //    SEO-verbose ("Elegant Rectangular Pet Bed For Small And Medium-sized
  //    Dogs, Durable Elevated Dog Sofa Bed, …" is a perfectly clear single
  //    product yet >120 chars). A clean single-product phrase is 2–24
  //    distinct normalized tokens; a keyword-stuffed blob exceeds that.
  const clarityTokens = conceptTokens(rep.title);
  const clarity = clarityTokens.length >= 2 && clarityTokens.length <= 24;
  reasons.push(clarity ? 'clear single-product title (+2)' : 'title not a clean single-product concept');

  // 3) Verified supplier price (0–2) — presence, not count.
  const hasPrice = any((r) => r.sellPrice !== null && r.sellPrice > 0);
  reasons.push(hasPrice ? 'verified supplier price present (+2)' : 'no verified supplier price');

  // 4) Usable image evidence (0–2) — presence, not count.
  const hasImage = any((r) => Boolean(r.imageUrl && r.images.length > 0));
  reasons.push(hasImage ? 'usable product image present (+2)' : 'no usable product image');

  // 5) US inventory evidence (0–2) — inventory figure presence (NOT delivery,
  //    NOT demand).
  const hasUsInv = any((r) => r.usInventoryTotal !== null && r.usInventoryTotal > 0);
  reasons.push(hasUsInv ? 'US inventory figure present (+2, inventory not delivery)' : 'no US inventory figure');

  // 6) Delivery-cycle evidence (0–1).
  const hasDelivery = any((r) => r.deliveryCycle !== null);
  reasons.push(hasDelivery ? 'delivery cycle present (+1)' : 'no delivery-cycle evidence');

  // 7) Basic safety pass (0–2) — ALL members must pass (IP/medical/battery/
  //    price/image prefilter with US inventory NOT required at concept level).
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
  const safetyPts = safe === records.length ? 2 : safe > 0 ? 1 : 0;
  reasons.push(safetyPts === 2
    ? 'all members pass basic safety filters (+2)'
    : safetyPts === 1
      ? `only ${safe}/${records.length} members pass basic safety filters (+1)`
      : 'no member passes basic safety filters');

  // 8) Researchability (0–2) — the concept must carry enough vocabulary to
  //    build a search query. seedConceptSearchQuery caps the query at 7
  //    tokens, so a longer normalized vocabulary remains perfectly
  //    researchable — only a degenerate 0/1-token concept is not.
  const tokens = conceptTokens(rep.title);
  const researchable = tokens.length >= 2;
  reasons.push(researchable ? `researchable concept vocabulary (${tokens.length} tokens) (+2)` : `concept vocabulary not researchable (${tokens.length} tokens)`);

  const score = petPts
    + (clarity ? 2 : 0)
    + (hasPrice ? 2 : 0)
    + (hasImage ? 2 : 0)
    + (hasUsInv ? 2 : 0)
    + (hasDelivery ? 1 : 0)
    + safetyPts
    + (researchable ? 2 : 0);
  return { score: Math.min(15, score), reasons };
}

/**
 * Select up to `max` DISTINCT concepts for market research. Ranking uses ONLY
 * supplier-suitability (pet relevance, clarity, data completeness, safety) —
 * never invented popularity. Returns concepts sorted by suitabilityScore desc.
 */
export function selectSeedConcepts(records: CjSeedRecord[], max = CJ_SEED_MAX_CONCEPTS): CjSeedConcept[] {
  // Deterministic ranking: suitability score desc, then label asc. Member
  // count / listedNum NEVER break ties — Phase 4G §B: more near-duplicate
  // records is not a quality signal.
  const clusters = clusterCjSeedConcepts(records)
    .sort((a, b) => b.suitabilityScore - a.suitabilityScore || a.label.localeCompare(b.label))
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
  /**
   * CLIENT FORECAST of points used (local CjPointBudget) — DIAGNOSTICS ONLY.
   * Phase 4G: the DURABLE SERVER LEDGER is the authority; if a response is
   * lost after the server reserved points, this can read 0 while the server
   * correctly reports 50. Never treat this as the authoritative count.
   */
  clientForecastPoints: number;
  /** @deprecated Phase 4G — same value as clientForecastPoints (kept for compat). */
  pointsReserved: number;
  /** SERVER-AUTHORIZED / RESERVED points (durable ledger, authoritative). */
  serverAuthorizedPoints: number | null;
  serverRemainingPoints: number | null;
  serverListAttempts: number | null;
  serverDetailAttempts: number | null;
  serverFreightAttempts: number | null;
  serverPaidRetries: number | null;
  serverDeniedAttempts: number | null;
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

  // Phase 4G — SERVER-AUTHORITATIVE ACCOUNTING. The durable supplier_api_runs
  // ledger is the authority: it reserves points BEFORE every outbound paid CJ
  // request, so a lost/aborted client response must never be reported as
  // "0 points used". After EVERY paid seed attempt — success or failure — we
  // fetch the durable usage when a run id exists. The local CjPointBudget
  // stays a CLIENT FORECAST for diagnostics only.
  // Object holder defeats TS CFA narrowing of `let` captured by closures —
  // the holder property always keeps the declared type.
  const usageState: { value: SupplierPointUsage | null } = { value: null };
  const refreshServerUsage = async () => {
    if (!runId) return;
    try {
      usageState.value = (await adapter.getRunUsage?.()) ?? null;
    } catch {
      usageState.value = null; // ledger unreachable now — keep last known
    }
  };
  const serverOut = () => ({
    clientForecastPoints: budget.used,
    pointsReserved: budget.used, // @deprecated — client forecast (compat)
    serverAuthorizedPoints: usageState.value?.reserved ?? null,
    serverRemainingPoints: usageState.value?.remaining ?? null,
    serverListAttempts: usageState.value?.listAttempts ?? null,
    serverDetailAttempts: usageState.value?.detailAttempts ?? null,
    serverFreightAttempts: usageState.value?.freightAttempts ?? null,
    serverPaidRetries: usageState.value?.paidRetries ?? null,
    serverDeniedAttempts: usageState.value?.denied ?? null,
  });

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
      recordsReturned: 0, seeds: [], duplicates: 0,
      clientForecastPoints: 0, pointsReserved: 0,
      serverAuthorizedPoints: null, serverRemainingPoints: null,
      serverListAttempts: null, serverDetailAttempts: null, serverFreightAttempts: null,
      serverPaidRetries: null, serverDeniedAttempts: null,
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
    await refreshServerUsage(); // authoritative ledger still governs the run
    await finishRun('failed');
    return {
      jobId, runId, hardBudget, query, health: 'offline',
      recordsReturned: 0, seeds: [], duplicates: 0,
      ...serverOut(), listCalls: 0, detailCalls: 0, freightCalls: 0, concepts: [],
      serverPoints: usageState.value,
      warning: 'Seed budget exhausted before search',
    };
  }

  let result;
  try {
    result = await adapter.searchProducts({ query, market, maxResults } as SupplierSearchOptions);
    budget.spend('listV2');
  } catch (e) {
    // FAILURE-PATH ACCOUNTING (Phase 4G §2): the server may have reserved the
    // 50 points before the outbound response was lost. NEVER report 0
    // automatically — fetch the durable ledger BEFORE returning.
    await refreshServerUsage();
    await addLog(db, jobId, 'error', `CJ_SEED_DISCOVERY search failed: ${(e as Error).message} (serverAuthorized=${usageState.value?.reserved ?? 'unknown'}pts, clientForecast=${budget.used}pts)`);
    await addRun(db, jobId, 'cj-seed-discovery', 'failed', `Seed search failed: ${(e as Error).message}`);
    await completeJob(db, jobId, 'failed', {
      error: (e as Error).message, retries: 0,
      clientForecastPoints: budget.used, serverAuthorizedPoints: usageState.value?.reserved ?? null,
      transportStatus: 'failed/unknown',
    });
    await finishRun('failed');
    return {
      jobId, runId, hardBudget, query, health: 'offline',
      recordsReturned: 0, seeds: [], duplicates: 0,
      ...serverOut(), listCalls: 0, detailCalls: 0, freightCalls: 0, concepts: [],
      serverPoints: usageState.value,
      warning: `Seed search failed: ${(e as Error).message} (serverAuthorized=${usageState.value?.reserved ?? 'unknown'}pts)`,
    };
  }
  // After a SUCCESSFUL paid attempt the durable ledger is the authority for
  // what was actually authorized/reserved (Phase 4G §1).
  await refreshServerUsage();
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
  await addRun(db, jobId, 'cj-seed-discovery', 'completed', `${seeds.length} seeds (${duplicates} dups) · ${concepts.length} concepts · serverAuthorized=${usageState.value?.reserved ?? 'unknown'}/${hardBudget}pts`);
  await completeJob(db, jobId, 'completed', {
    query, market,
    mode: 'CJ_SEED_DISCOVERY',
    runId,
    hardBudget,
    // Phase 4G: SERVER-AUTHORIZED usage is authoritative; the client forecast
    // is diagnostics only. Correct wording: SERVER-AUTHORIZED / RESERVED
    // points — never "exact CJ billing" unless CJ itself reports billing.
    serverAuthorizedPoints: usageState.value?.reserved ?? null,
    serverRemainingPoints: usageState.value?.remaining ?? null,
    serverListAttempts: usageState.value?.listAttempts ?? null,
    serverDetailAttempts: usageState.value?.detailAttempts ?? null,
    serverFreightAttempts: usageState.value?.freightAttempts ?? null,
    serverPaidRetries: usageState.value?.paidRetries ?? null,
    serverDeniedAttempts: usageState.value?.denied ?? null,
    clientForecastPoints: budget.used,
    pointsReserved: budget.used, // @deprecated — client forecast (compat)
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
    ...serverOut(),
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
