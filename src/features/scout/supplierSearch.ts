// ============================================================================
// LUXEDGE V2 — SUPPLIER SEARCH ENGINE (Phase 4C)
//
// Bridges the provider-neutral SupplierDiscoveryAdapter into the existing
// Product Scout pipeline. Flow:
//
//   adapter.searchProducts(query, market, maxResults)
//   → normalize (already done by the adapter) → dedupe (CJ pid/SKU)
//   → deterministic prefilter (US inventory, pet niche, price, images, risk)
//   → persist candidates (admin JWT, RLS) → PRODUCT_SCORE → PRODUCT_QA
//
// Reuses the SAME durable job trail (PRODUCT_RESEARCH → PRODUCT_SCORE →
// PRODUCT_QA) as URL-based research, so the audit trail is uniform. It never
// approves, never drafts, never publishes, and never places orders/payments.
//
// SUPPLIER-DATA SOURCE vs AI: supplier discovery does not require DeepSeek —
// CJ is a supplier data source, not an AI provider. AI Services OFF still
// allows an explicit owner-run supplier search (it makes zero AI calls).
// ============================================================================

import type { DbAdapter } from '../../services/db';
import type {
  SupplierDiscoveryAdapter, SupplierSearchOptions, SupplierProductRecord,
  SupplierShippingEvidence,
} from '../suppliers/types';
import type { ScoutCandidate, CandidateEvidence } from './types';
import { calculateMargin } from './margin';
import { applyRejectFilters, collectRiskFlags } from './reject';
import { scoreCandidate, SHORTLIST_THRESHOLD } from './score';
import { qaCandidate } from './engine';
import {
  ensureSupplier, persistSupplierProduct, persistCandidate, persistScore,
  createJob, completeJob, addRun, addLog,
} from './persist';
import { cjProductKey, cjSkuKey } from '../suppliers/cj/dedupe';
import { prefilterCjRecords } from '../suppliers/cj/prefilter';
import { CjPointBudget, enrichmentCaps, CJ_POINT_COST } from '../suppliers/cj/points';
import { parseDeliveryCycle, normalizeCountryCode } from '../suppliers/cj/normalize';
import type { CjPointUsage } from '../suppliers/cj/points';

export interface SupplierSearchRunOptions {
  adapter: SupplierDiscoveryAdapter;
  search: SupplierSearchOptions;
  db: DbAdapter;
  markup?: number;
  onProgress?: (msg: string) => void;
}

export function petCategoryFromTitle(title: string): 'Dog' | 'Cat' | 'Pet' | null {
  const t = title.toLowerCase();
  if (/dog|puppy|canine/i.test(t)) return 'Dog';
  if (/cat|kitten|feline/i.test(t)) return 'Cat';
  if (/pet/i.test(t)) return 'Pet';
  return null;
}

export interface SupplierSearchRunResult {
  jobId: string;
  scoreJobId?: string;
  qaJobId?: string;
  health: string;
  searched: number;
  duplicates: number;
  prefilterRejected: number;
  researched: number;
  rejected: number;
  shortlisted: number;
  failed: number;
  candidates: ScoutCandidate[];
  warning?: string;
  /** CJ point budget usage for the run (Phase 4C hardening). */
  points?: CjPointUsage;
}

/**
 * Convert a normalized supplier record into scout evidence (honest statuses).
 * `freight` (when present) supplies a VERIFIED total shipping cost and arrival
 * range from the selected variant's quote; delivery-cycle parsing is exact
 * ("3-5" → 3..5, "5" → 5..5, junk → UNKNOWN).
 */
export function evidenceFromSupplierRecord(
  r: SupplierProductRecord,
  market?: string,
  freight?: SupplierShippingEvidence | null
): CandidateEvidence {
  const observedAt = new Date().toISOString();
  const unknownFields: string[] = [];
  if (!r.sellPrice) unknownFields.push('price');
  if (r.usInventoryTotal === null) unknownFields.push('usInventory');
  if (r.deliveryCycle === null && !freight?.arrivalDays) unknownFields.push('shippingDays');
  if (r.weightGrams === null) unknownFields.push('weight');

  const country = normalizeCountryCode(market);
  const deliveryRange = parseDeliveryCycle(r.deliveryCycle) ?? (freight?.arrivalDays ? parseDeliveryCycle(freight.arrivalDays) : null);

  const shippingCostNote = freight
    ? `CJ freight quote (${freight.origin ?? 'origin unknown'} → ${freight.destination ?? 'US'}): ${freight.note}`
    : 'CJ freight requires a per-variant quote (freightCalculate). Not folded into this record; margin confidence LOW until quoted.';

  return {
    sourceUrl: r.sourceUrl,
    observedAt,
    title: { status: 'verified', value: r.title, source: `CJ pid ${r.productId}` },
    supplierPrice: {
      status: r.sellPrice !== null ? 'verified' : 'unknown',
      value: r.sellPrice,
      source: `CJ pid ${r.productId}${r.selectedVariant ? ` variant ${r.selectedVariant.variantId}` : ''}`,
    },
    shippingCost: {
      status: freight?.costUsd !== null && freight?.costUsd !== undefined ? 'verified' : 'unknown',
      value: freight?.costUsd ?? null,
      note: shippingCostNote,
    },
    shippingDays: {
      status: deliveryRange ? 'verified' : 'unknown',
      value: deliveryRange,
      source: r.deliveryCycle ? `CJ deliveryCycle ${r.deliveryCycle}` : (freight?.arrivalDays ? `CJ freight arrival ${freight.arrivalDays}` : undefined),
      note: deliveryRange ? `Delivery ${deliveryRange.min}-${deliveryRange.max} days (supplier evidence)` : 'No verified delivery window',
    },
    availability: {
      status: r.usInventoryInCountry ? 'verified' : 'unknown',
      value: r.usInventoryInCountry ? 'available' : 'unknown',
      note: country === 'US'
        ? (r.usInventoryTotal !== null ? `CJ reports ${r.usInventoryTotal} US inventory${r.selectedVariant?.usInventoryVerified !== null && r.selectedVariant?.usInventoryVerified !== undefined ? ` (${r.selectedVariant.usInventoryVerified} verified)` : ''}` : 'CJ reported no US inventory figure')
        : 'No US inventory claim (search did not target US)',
    },
    images: { status: r.images.length ? 'verified' : 'unknown', value: r.images, source: `CJ pid ${r.productId}` },
    rating: {
      status: 'unknown',
      value: null,
      note: 'CJ API does not return verified customer ratings/reviews — external demand evidence must come from Market Intelligence, never invented.',
    },
    origin: {
      status: r.selectedVariant?.originCountry ? 'verified' : (r.warehouse ? 'inferred' : 'unknown'),
      value: r.selectedVariant?.originCountry ?? r.warehouse,
      note: r.selectedVariant?.originCountry
        ? `Selected variant origin: ${r.selectedVariant.originCountry} (inventory/warehouse evidence)`
        : (r.warehouse ? `CJ warehouse: ${r.warehouse}` : 'CJ origin/warehouse unknown'),
    },
    category: { status: r.category ? 'verified' : 'unknown', value: r.category, source: 'CJ category' },
    sizes: {
      status: r.selectedVariant ? 'inferred' : 'unknown',
      value: r.selectedVariant ? [r.selectedVariant.sku] : null,
      note: r.selectedVariant ? `Selected variant ${r.selectedVariant.variantId} (sku ${r.selectedVariant.sku})` : 'No variant data — variant UNKNOWN',
    },
    unknownFields,
    riskNotes: [],
  };
}


/**
 * Free local ranking of a listV2 record (Stage A). Uses ONLY listV2 data —
 * no paid calls. Ranks what is worth a paid product/query enrichment:
 * US inventory signal, verified warehouse, viable price, image, delivery
 * cycle, listing count. Not a business score — just an enrichment selector.
 */
export function rankCjRecord(r: SupplierProductRecord, market?: string): number {
  let pts = 0;
  const country = normalizeCountryCode(market);
  if (country === 'US') {
    if (r.usInventoryInCountry) pts += 30;
    else if (r.usInventoryTotal !== null) pts += 15;
    if (r.usInventoryVerified !== null) pts += 10;
  }
  if (r.freeShipping) pts += 5;
  if (r.sellPrice !== null && r.sellPrice > 0) pts += 10;
  if (r.images.length) pts += 10;
  if (parseDeliveryCycle(r.deliveryCycle)) pts += 5;
  if (r.listedNum !== null && r.listedNum > 0) pts += 5;
  return pts;
}

/**
 * Run ONE controlled supplier search through the scout pipeline. Records the
 * three durable jobs (PRODUCT_RESEARCH → PRODUCT_SCORE → PRODUCT_QA), like
 * runScoutResearch, but sources candidates from a supplier API adapter.
 * Never approves/drafts/publishes/orders.
 *
 * TWO-STAGE ENRICHMENT (Phase 4C hardening):
 *   Stage A (free): prefilter + rank all listV2 records with listV2 data only.
 *   Stage B (paid, budget-gated): product/query for the TOP N ranked records,
 *     then freightCalculate for the TOP M that survive with a consistent
 *     selected variant. Enrichment caps derive from the run point budget —
 *     a run NEVER exceeds it. Freight origin comes from the selected
 *     variant's inventory/warehouse evidence (never hardcoded).
 */
export async function runSupplierSearch(opts: SupplierSearchRunOptions): Promise<SupplierSearchRunResult> {
  const { adapter, search, db, markup, onProgress } = opts;
  const progress = (m: string) => onProgress?.(m);
  const at = new Date().toISOString();

  // Hard per-run CJ point budget (owner-configured default; AI cannot raise it).
  const budget = new CjPointBudget(search.pointsBudget);
  const caps = enrichmentCaps(budget);

  const jobId = await createJob(db, 'PRODUCT_RESEARCH', {
    provider: adapter.provider,
    query: search.query,
    market: search.market || null,
    at,
    note: `Supplier-API discovery (CJ) → normalize → dedupe → Stage A filter/rank → Stage B enrichment (detail ≤${caps.detailMax}, freight ≤${caps.freightMax}) → persist`, // eslint-disable-line max-len
  });
  await addRun(db, jobId, 'supplier-search', 'running', `Searching ${adapter.provider.toUpperCase()}: ${search.query}`);
  await addLog(db, jobId, 'info', `SUPPLIER_SEARCH(${adapter.provider}) started for "${search.query}" (budget=${budget.budget}pts, retries=0)`);

  // 1) SEARCH — one listV2 call (50 pts). No pagination unless evidence justifies.
  let result;
  if (!budget.canSpend('listV2')) {
    await addLog(db, jobId, 'error', `CJ point budget ${budget.budget} exhausted before the search — run denied.`);
    await addRun(db, jobId, 'supplier-search', 'failed', 'CJ point budget exhausted before search');
    await completeJob(db, jobId, 'failed', { error: 'CJ point budget exhausted', points: budget.usage() });
    return { jobId, health: 'offline', searched: 0, duplicates: 0, prefilterRejected: 0, researched: 0, rejected: 0, shortlisted: 0, failed: 1, candidates: [], points: budget.usage() };
  }
  try {
    result = await adapter.searchProducts(search);
    budget.spend('listV2');
    // Prefer the server's reported points when provided.
    if (typeof result.points === 'number') {
      const diff = result.points - CJ_POINT_COST.listV2;
      if (diff > 0) budget.used = Math.min(budget.budget, budget.used + diff);
    }
  } catch (e) {
    await addLog(db, jobId, 'error', `SUPPLIER_SEARCH failed: ${(e as Error).message} (retries=0)`);
    await addRun(db, jobId, 'supplier-search', 'failed', `Search failed: ${(e as Error).message}`);
    await completeJob(db, jobId, 'failed', { error: (e as Error).message, retries: 0, points: budget.usage() });
    return { jobId, health: 'offline', searched: 0, duplicates: 0, prefilterRejected: 0, researched: 0, rejected: 0, shortlisted: 0, failed: 1, candidates: [], points: budget.usage() };
  }
  progress(`[search] ${adapter.provider.toUpperCase()} returned ${result.records.length} records (health=${result.health}, points used ${budget.used}/${budget.budget})${result.warning ? ' — ' + result.warning : ''}`);
  await addLog(db, jobId, 'info', `SUPPLIER_SEARCH: ${result.records.length} records, health=${result.health}${result.warning ? '; ' + result.warning : ''}`);

  // 2) DEDUPE against existing candidates (stable CJ pid/SKU keys)
  const existing = await db
    .list<{ id: string; source_url: string | null; title: string }>('product_candidates', { limit: 500 })
    .then((rows) => (Array.isArray(rows) ? rows : []))
    .catch(() => []);
  const known = new Set<string>();
  for (const row of existing) {
    // Rebuild CJ keys from previously persisted source URLs / titles.
    const url = row.source_url || '';
    const pidMatch = /\/product\/([A-F0-9-]+)\.html/i.exec(url);
    if (pidMatch) known.add(cjProductKey(pidMatch[1]));
  }
  const seenInRun = new Set<string>();
  const unique: SupplierProductRecord[] = [];
  let duplicates = 0;
  for (const r of result.records) {
    const key = r.productId ? cjProductKey(r.productId) : r.sku ? cjSkuKey(r.sku) : r.sourceUrl;
    if (known.has(key) || seenInRun.has(key)) { duplicates++; continue; }
    seenInRun.add(key);
    known.add(key);
    unique.push(r);
  }
  if (duplicates) progress(`[dedupe] ${duplicates} duplicate CJ records skipped (stable pid/SKU keys)`);

  // 3) STAGE A — FREE deterministic prefilter + rank (listV2 data only, no AI, no paid calls)
  const { kept, rejected: prefiltered } = prefilterCjRecords(unique, {
    market: search.market,
    minSupplierCost: search.minSupplierCost,
    maxSupplierCost: search.maxSupplierCost,
  });
  for (const rej of prefiltered) {
    progress(`[reject] ${rej.record.title.slice(0, 60)} — ${rej.reason}`);
    await addLog(db, jobId, 'warn', `PREFILTER reject: ${rej.record.title} — ${rej.reason}`);
  }
  const ranked = [...kept].sort((a, b) => rankCjRecord(b, search.market) - rankCjRecord(a, search.market));
  progress(`[stage A] ${kept.length} kept, ${prefiltered.length} rejected deterministically; ranked for enrichment`);

  // 4) STAGE B — PAID enrichment within the point budget:
  //    product/query for the top N, then freightCalculate for the top M.
  const detailTargets = ranked.slice(0, caps.detailMax);
  const enriched: { record: SupplierProductRecord; freight: SupplierShippingEvidence | null }[] = [];
  let detailCallsMade = 0;
  for (const r of detailTargets) {
    if (!budget.canSpend('productQuery')) {
      progress(`[stage B] point budget reached — ${enriched.length} enriched, further detail calls denied`);
      break;
    }
    try {
      const detail = await adapter.getProduct(r.productId, search.market || 'US');
      budget.spend('productQuery');
      detailCallsMade++;
      if (!detail) {
        progress(`[enrich] ${r.title.slice(0, 50)} — no usable detail (variant UNKNOWN)`);
        continue;
      }
      enriched.push({ record: detail, freight: null });
      progress(`[enrich] ${detail.title.slice(0, 50)} — detail ok (${detail.selectedVariant ? `variant ${detail.selectedVariant.variantId} ${detail.selectedVariant.originCountry ?? 'origin unknown'}` : 'variant UNKNOWN'})`);
    } catch (e) {
      budget.noteRetry();
      progress(`[enrich] ${r.title.slice(0, 50)} — detail failed: ${(e as Error).message}`);
    }
  }

  // Freight for the strongest subset ONLY — those with a consistent selected
  // variant and real price, ranked again by variant quality.
  const variantRank = (rec: SupplierProductRecord) => {
    const v = rec.selectedVariant;
    let s = 0;
    if (v?.usInventoryInCountry) s += 40;
    if (v?.verifiedWarehouse) s += 20;
    if (v?.originCountry) s += 10;
    if (v?.sellPrice !== null && v?.sellPrice !== undefined) s += 10;
    return s;
  };
  const freightTargets = enriched
    .filter((e) => e.record.selectedVariant && e.record.sellPrice !== null)
    .sort((a, b) => variantRank(b.record) - variantRank(a.record))
    .slice(0, caps.freightMax);
  for (const e of freightTargets) {
    const v = e.record.selectedVariant!;
    if (!budget.canSpend('freightCalculate')) {
      progress(`[freight] point budget reached — ${enriched.filter((x) => x.freight).length} freighted, further calls denied`);
      break;
    }
    try {
      const ev = await adapter.getShippingEvidence(e.record.productId, v.variantId, {
        market: search.market || 'US',
        originCountry: v.originCountry, // dynamic origin — never hardcoded
      });
      budget.spend('freightCalculate');
      e.freight = ev;
      progress(ev.costUsd !== null
        ? `[freight] ${e.record.title.slice(0, 50)} — total $${ev.costUsd.toFixed(2)} (${ev.origin ?? '?'}→${ev.destination ?? 'US'})${ev.arrivalDays ? ', ' + ev.arrivalDays : ''}`
        : `[freight] ${e.record.title.slice(0, 50)} — UNKNOWN: ${ev.note}`);
    } catch (err) {
      budget.noteRetry();
      progress(`[freight] ${e.record.title.slice(0, 50)} — failed: ${(err as Error).message}`);
    }
  }

  // 5) PERSIST candidates (researching) — admin JWT, RLS. Only enriched
  //    records become candidates (we never persist every search result).
  const candidates: ScoutCandidate[] = [];
  let failed = 0;
  for (const { record: r, freight } of enriched) {
    const shippingCost = freight?.costUsd ?? null;
    const margin = calculateMargin({ supplierPrice: r.sellPrice, shippingCost, markup });
    const candidate: ScoutCandidate = {
      id: '',
      title: r.title,
      source: 'CJ Dropshipping',
      sourceUrl: r.sourceUrl,
      supplierSlug: 'cj-dropshipping',
      images: r.images,
      evidence: evidenceFromSupplierRecord(r, search.market, freight),
      margin,
      score: null,
      status: 'researching',
      createdAt: new Date().toISOString(),
    };
    try {
      const sup = await ensureSupplier(db, {
        name: 'CJ Dropshipping',
        slug: 'cj-dropshipping',
        baseUrl: 'https://www.cjdropshipping.com',
      });
      const sp = await persistSupplierProduct(db, {
        supplierId: sup.id,
        title: r.title,
        url: r.sourceUrl,
        images: r.images,
        raw: {
          provider: 'cj',
          product_id: r.productId,
          sku: r.sku,
          selected_variant: r.selectedVariant ?? null,
          variant_id: r.selectedVariant?.variantId ?? null,
          sell_price: r.sellPrice,
          us_inventory_total: r.usInventoryTotal,
          us_inventory_verified: r.usInventoryVerified,
          warehouse: r.warehouse,
          delivery_cycle: r.deliveryCycle,
          free_shipping: r.freeShipping,
          freight: freight ? {
            cost_usd: freight.costUsd,
            base_freight_usd: freight.baseFreightUsd,
            taxes_fee_usd: freight.taxesFeeUsd,
            clearance_fee_usd: freight.clearanceFeeUsd,
            tariff_usd: freight.tariffUsd,
            carrier: freight.carrier,
            origin: freight.origin,
            destination: freight.destination,
            arrival_days: freight.arrivalDays,
            observed_at: freight.observedAt,
            note: freight.note,
          } : null,
          observed_at: r.observedAt,
        },
      });
      const cand = await persistCandidate(db, {
        supplierProductId: sp.id,
        title: r.title,
        source: 'CJ Dropshipping',
        sourceUrl: r.sourceUrl,
        images: r.images,
        evidence: candidate.evidence,
        status: 'researching',
      });
      candidate.id = cand.id;
      candidates.push(candidate);
      progress(`[ok] ${r.title.slice(0, 60)} — researched (CJ ${r.productId}${freight?.costUsd !== null ? ', landed cost verified' : ', freight UNKNOWN'})`);
    } catch (e) {
      failed++;
      progress(`[error] ${r.title.slice(0, 60)} — persistence failed: ${(e as Error).message}`);
    }
  }
  await addRun(db, jobId, 'supplier-search', 'completed', `${candidates.length} candidates researched from ${adapter.provider.toUpperCase()} (budget ${budget.used}/${budget.budget}pts)`);
  await completeJob(db, jobId, 'completed', {
    provider: adapter.provider,
    query: search.query,
    searched: result.records.length,
    duplicates,
    prefilterRejected: prefiltered.length,
    detailCalls: detailCallsMade,
    freightCalls: freightTargets.filter((e) => e.freight).length,
    researched: candidates.length,
    failed,
    retries: 0,
    points: budget.usage(),
  });

  // 5) PRODUCT_SCORE (reuse the existing phase)
  const scoreJobId = await createJob(db, 'PRODUCT_SCORE', {
    provider: adapter.provider,
    candidateIds: candidates.map((c) => c.id),
    at: new Date().toISOString(),
    note: 'Margin + hard-rejection + 100-pt score (CJ supplier evidence)',
  });
  await addRun(db, scoreJobId, 'supplier-search', 'running', `Scoring ${candidates.length} CJ candidates`);
  await addLog(db, scoreJobId, 'info', `PRODUCT_SCORE started for ${candidates.length} CJ candidates (retries=0)`);

  let rejected = 0;
  const scored: ScoutCandidate[] = [];
  for (const c of candidates) {
    const out = scoreSupplierCandidate(c, markup);
    scored.push(out);
    if (out.status === 'rejected') rejected++;
    try {
      await persistScore(db, c.id, out.score!);
      await db.update<{ id: string; status: string; rejection_reason: string | null }>(
        'product_candidates', c.id,
        { status: out.status, rejection_reason: out.rejectionReason ?? null }
      );
    } catch (e) {
      progress(`[error] ${out.title} — score persist failed: ${(e as Error).message}`);
    }
    progress(`[score] ${out.title.slice(0, 50)} — ${out.score?.overall ?? '?'}/100 (${out.status})${out.rejectionReason ? ' — REJECTED: ' + out.rejectionReason : ''}`);
  }
  const shortlisted = scored.filter((c) => c.status === 'qualified').length;
  await addLog(db, scoreJobId, 'info', `PRODUCT_SCORE finished: ${scored.length} scored, ${rejected} rejected, ${shortlisted} shortlisted (retries=0)`);
  await addRun(db, scoreJobId, 'supplier-search', 'completed', `${scored.length} scored, ${shortlisted} shortlisted`);
  await completeJob(db, scoreJobId, 'completed', { scored: scored.length, rejected, shortlisted, retries: 0 });

  // 6) PRODUCT_QA on shortlisted
  const qaTargets = scored.filter((c) => c.status === 'qualified');
  const qaJobId = await createJob(db, 'PRODUCT_QA', {
    provider: adapter.provider,
    candidateIds: qaTargets.map((c) => c.id),
    at: new Date().toISOString(),
    note: 'Evidence QA on CJ shortlisted candidates',
  });
  await addRun(db, qaJobId, 'supplier-search', 'running', `QA on ${qaTargets.length} shortlisted`);
  await addLog(db, qaJobId, 'info', `PRODUCT_QA started for ${qaTargets.length} shortlisted (retries=0)`);
  let qaPassed = 0;
  for (const c of qaTargets) {
    const out = qaCandidate(c);
    if (out.passed) qaPassed++;
    for (const issue of out.issues) await addLog(db, qaJobId, out.passed ? 'info' : 'warn', `[${out.title}] ${issue}`);
    progress(out.passed ? `[qa] ${out.title.slice(0, 50)} — PASS` : `[qa] ${out.title.slice(0, 50)} — FLAGGED: ${out.issues.join('; ')}`);
  }
  await addRun(db, qaJobId, 'supplier-search', 'completed', `${qaPassed} passed, ${qaTargets.length - qaPassed} flagged`);
  await completeJob(db, qaJobId, 'completed', { passed: qaPassed, flagged: qaTargets.length - qaPassed, retries: 0 });

  progress(`Done — searched ${result.records.length}, kept ${kept.length}, enriched ${enriched.length}, researched ${scored.length}, shortlisted ${shortlisted}, QA passed ${qaPassed}.`);
  return {
    jobId, scoreJobId, qaJobId,
    health: result.health,
    searched: result.records.length,
    duplicates,
    prefilterRejected: prefiltered.length,
    researched: scored.length,
    rejected,
    shortlisted,
    failed,
    candidates: scored,
    warning: result.warning,
    points: budget.usage(),
  };
}

/** Score one CJ-sourced candidate (same rules as URL research). */
export function scoreSupplierCandidate(candidate: ScoutCandidate, markup?: number): ScoutCandidate {
  const ev = candidate.evidence;
  const extract = {
    title: (ev.title.value as string) ?? null,
    price: (ev.supplierPrice.value as number | null) ?? null,
    images: (ev.images.value as string[]) ?? [],
    availability: (ev.availability.value as 'available' | 'unavailable' | 'unknown') ?? 'unknown',
    shippingDays: (ev.shippingDays.value as { min: number; max: number } | null) ?? null,
    freeShipping: ev.shippingCost?.value === 0,
    rating: (ev.rating.value as number | null) ?? null,
    reviewCount: null,
    origin: (ev.origin.value as string | null) ?? null,
    sizes: (ev.sizes.value as string[] | null) ?? null,
  };
  const margin = candidate.margin && candidate.margin.confidence !== 'low'
    ? candidate.margin
    : calculateMargin({ supplierPrice: extract.price, shippingCost: extract.freeShipping ? 0 : null, markup });

  const rejection = applyRejectFilters({ title: candidate.title, extract, margin, images: extract.images });
  const riskFlags = collectRiskFlags({ title: candidate.title, extract, margin });
  const score = scoreCandidate({
    title: candidate.title,
    extract,
    margin,
    supplierVerified: true,
    // Phase 4C hardening: a CJ official-API record is a VERIFIED supplier-
    // platform source — NOT automatically a manufacturer source. Manufacturer
    // reliability points require independently verified manufacturer status.
    sourceIsManufacturer: false,
    images: extract.images,
    riskFlags,
  });

  let status: ScoutCandidate['status'] = score.overall >= SHORTLIST_THRESHOLD ? 'qualified' : 'researching';
  let rejectionReason: string | undefined;
  if (rejection) {
    status = 'rejected';
    rejectionReason = `${rejection.reason}: ${rejection.detail}`;
  }
  const riskNotes = [...(ev.riskNotes || [])];
  if (margin.confidence === 'low' && status !== 'rejected') {
    riskNotes.push('Margin confidence LOW — CJ freight not quoted; requires freight evidence before any draft.');
  }

  return {
    ...candidate,
    margin,
    score,
    status,
    rejectionReason,
    evidence: {
      ...ev,
      category: { status: petCategoryFromTitle(candidate.title) ? 'inferred' : 'unknown', value: petCategoryFromTitle(candidate.title), note: 'Inferred from title keywords' },
      riskNotes,
    },
  };
}
