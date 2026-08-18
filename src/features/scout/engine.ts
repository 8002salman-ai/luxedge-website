// ============================================================================
// LUXEDGE V2 — PRODUCT SCOUT ENGINE (Phase 4A + closure)
//
// Pipeline: DISCOVER → VERIFY SOURCE → NORMALIZE → SCORE → REJECT/SHORTLIST
//          → OWNER APPROVAL (UI) → PRODUCT DRAFT (explicit owner action)
//
// The engine never publishes, never approves, never drafts. Candidates reach
// 'qualified' (shortlist) when they pass the hard-rejection filters AND score
// >= 75; margin confidence LOW is recorded as a risk flag, never auto-approved.
//
// DURABLE JOB AUDIT TRAIL (Phase 4A closure): every run records THREE distinct
// agent_jobs — PRODUCT_RESEARCH (fetch+extract+persist) → PRODUCT_SCORE
// (margin+reject+score) → PRODUCT_QA (evidence QA on shortlisted). Each job
// carries status, start/end, input, output summary, error, retry count. No AI
// provider is required — all extraction/scoring/QA is deterministic. No
// secrets are ever stored in job records.
//
// SECURITY: persistence goes through the injected db adapter, which must be
// configured with the ADMIN JWT (setAccessToken) so RLS governs every write.
// ============================================================================

import type { DbAdapter } from '../../services/db';
import type { FetchedSourcePage, PageExtract, ScoutCandidate, ScoutRunResult, MarketAnalysis } from './types';
import { supplierFromUrl, dedupeKey, normalizeTitle } from './normalize';
import { extractPageFacts, describeExtract } from './extract';
import { calculateMargin } from './margin';
import { applyRejectFilters, collectRiskFlags } from './reject';
import { scoreCandidate, SHORTLIST_THRESHOLD } from './score';
import { signalsFromDiscovery, signalsFromExtracts, scoreMarketOpportunity, runMarketIntelligence } from './market';
import { evidenceFingerprint } from './aiCost';
import {
  ensureSupplier, persistSupplierProduct, persistCandidate, persistScore,
  createJob, completeJob, addRun, addLog,
} from './persist';
import type { DiscoverResult } from './discover';

export interface ScoutRunOptions {
  /** Source URLs to research (pet products only). */
  urls: string[];
  /** Admin-JWT-configured db adapter. */
  db: DbAdapter;
  /** Injectable page fetcher — defaults to the app's fetch+parse path. */
  fetchPage?: (url: string) => Promise<FetchedSourcePage>;
  /** Retail markup over landed cost (default 2.5). */
  markup?: number;
  /** Progress callback for the admin UI. */
  onProgress?: (msg: string) => void;
}

function petCategorySignal(title: string): string | null {
  const t = title.toLowerCase();
  if (/dog|puppy|canine/i.test(t)) return 'Dog';
  if (/cat|kitten|feline/i.test(t)) return 'Cat';
  if (/pet/i.test(t)) return 'Pet';
  return null;
}

/** Build the durable evidence record from extraction results. */
function buildEvidence(url: string, extract: PageExtract, category: string | null): ScoutCandidate['evidence'] {
  const observedAt = new Date().toISOString();
  const unknownFields: string[] = [];
  if (extract.title === null) unknownFields.push('title');
  if (extract.price === null) unknownFields.push('price');
  if (extract.availability === 'unknown') unknownFields.push('availability');
  if (extract.shippingDays === null) unknownFields.push('shippingDays');
  if (extract.rating === null) unknownFields.push('rating');
  if (extract.origin === null) unknownFields.push('origin');

  const shippingCostValue = extract.freeShipping ? 0 : null;
  return {
    sourceUrl: url,
    observedAt,
    title: { status: extract.title ? 'verified' : 'unknown', value: extract.title ?? null, source: url },
    supplierPrice: { status: extract.price !== null ? 'verified' : 'unknown', value: extract.price, source: url },
    shippingCost: {
      status: extract.freeShipping ? 'inferred' : 'unknown',
      value: shippingCostValue,
      note: extract.freeShipping ? 'Source states Free Shipping → $0 shipping (inferred)' : 'Not stated on source page; margin confidence LOW.',
    },
    shippingDays: { status: extract.shippingDays ? 'verified' : 'unknown', value: extract.shippingDays, source: url },
    availability: { status: extract.availability === 'unknown' ? 'unknown' : 'verified', value: extract.availability, source: url },
    images: { status: extract.images.length > 0 ? 'verified' : 'unknown', value: extract.images, source: url },
    rating: { status: extract.rating !== null || extract.reviewCount !== null ? 'verified' : 'unknown', value: extract.rating, source: url },
    origin: { status: extract.origin ? 'verified' : 'unknown', value: extract.origin, source: url },
    category: { status: category ? 'inferred' : 'unknown', value: category, note: 'Inferred from title keywords' },
    sizes: { status: extract.sizes ? 'verified' : 'unknown', value: extract.sizes, source: url },
    unknownFields,
    riskNotes: [],
  };
}

// ---------------------------------------------------------------------------
// PHASE 1 — PRODUCT_RESEARCH: fetch, verify source, normalize, persist
// ---------------------------------------------------------------------------

/**
 * Research a single URL: fetch + extract + persist the candidate as
 * 'researching' (scoring happens in the separate PRODUCT_SCORE job). Returns
 * null when the source cannot be verified (no fabricated candidates).
 */
export async function researchUrl(
  opts: ScoutRunOptions & { url: string },
  existingKeys: { dedupeKey: string; title: string }[]
): Promise<ScoutCandidate | null> {
  const { url, db, markup, onProgress } = opts;
  const fetchPage = opts.fetchPage;
  const progress = (m: string) => onProgress?.(m);

  // 1) DISCOVER + VERIFY SOURCE
  let page: FetchedSourcePage;
  try {
    if (!fetchPage) throw new Error('No page fetcher configured');
    page = await fetchPage(url);
  } catch (e) {
    progress(`[fail] ${url} — fetch failed: ${(e as Error).message}`);
    return null;
  }
  if (!page.text || page.text.trim().length < 50) {
    progress(`[fail] ${url} — page returned no usable content`);
    return null;
  }

  // 2) NORMALIZE
  const extract = extractPageFacts(page);
  const supplier = supplierFromUrl(url);
  const title = extract.title ? normalizeTitle(extract.title) : '';
  if (!title) {
    progress(`[fail] ${url} — no product title extractable`);
    return null;
  }
  const key = dedupeKey(url, title);
  const dup = existingKeys.find((e) => e.dedupeKey === key);
  if (dup) {
    progress(`[skip] ${title} — duplicate of ${dup.title}`);
    return null;
  }

  // 3) MARGIN (computed here so the SCORE job has the numbers ready; status
  //    decisions still happen only in the SCORE job).
  const margin = calculateMargin({ supplierPrice: extract.price, shippingCost: extract.freeShipping ? 0 : null, markup });
  const category = petCategorySignal(title);

  const candidate: ScoutCandidate = {
    id: '',
    title,
    source: supplier.name,
    sourceUrl: url,
    supplierSlug: supplier.slug,
    images: extract.images,
    evidence: buildEvidence(url, extract, category),
    margin,
    score: null,
    status: 'researching',
    createdAt: new Date().toISOString(),
  };

  // 4) PERSIST (admin JWT — RLS enforces admin-only writes)
  try {
    const sup = await ensureSupplier(db, supplier);
    const sp = await persistSupplierProduct(db, {
      supplierId: sup.id,
      title,
      url,
      images: extract.images,
      raw: { extract: describeExtract(extract), fetchedAt: new Date().toISOString() },
    });
    const cand = await persistCandidate(db, {
      supplierProductId: sp.id,
      title,
      source: supplier.name,
      sourceUrl: url,
      images: extract.images,
      evidence: candidate.evidence,
      status: 'researching',
    });
    candidate.id = cand.id;
  } catch (e) {
    progress(`[error] ${title} — persistence failed: ${(e as Error).message}`);
    return null;
  }

  progress(`[ok] ${title} — researched (scoring in next job)`);
  return candidate;
}

// ---------------------------------------------------------------------------
// PHASE 2 — PRODUCT_SCORE: margin checks, hard rejection, 100-pt score
// ---------------------------------------------------------------------------

/** Score one researched candidate: reject filters → score → status. */
export function scorePhaseCandidate(
  candidate: ScoutCandidate,
  markup?: number
): ScoutCandidate {
  const { title, evidence: ev } = candidate;
  const extract: PageExtract = {
    title: (ev.title.value as string) ?? null,
    price: (ev.supplierPrice.value as number | null) ?? null,
    images: (ev.images.value as string[]) ?? [],
    availability: (ev.availability.value as 'available' | 'unavailable' | 'unknown') ?? 'unknown',
    shippingDays: (ev.shippingDays.value as { min: number; max: number } | null) ?? null,
    freeShipping: ev.shippingCost?.value === 0,
    rating: (ev.rating.value as number | null) ?? null,
    reviewCount: (ev as { reviewCount?: unknown }).reviewCount as number | null ?? null,
    origin: (ev.origin.value as string | null) ?? null,
    sizes: (ev.sizes.value as string[] | null) ?? null,
  };

  const margin = candidate.margin && candidate.margin.confidence !== 'low'
    ? candidate.margin
    : calculateMargin({ supplierPrice: extract.price, shippingCost: extract.freeShipping ? 0 : null, markup });

  const rejection = applyRejectFilters({ title, extract, margin, images: extract.images });
  const riskFlags = collectRiskFlags({ title, extract, margin });
  const category = petCategorySignal(title);

  const score = scoreCandidate({
    title,
    extract,
    margin,
    supplierVerified: true,
    sourceIsManufacturer: extract.title !== null,
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
    riskNotes.push('Margin confidence LOW — shipping cost not verified; requires owner review before any draft.');
  }

  return {
    ...candidate,
    margin,
    score,
    status,
    rejectionReason,
    evidence: {
      ...ev,
      category: { status: category ? 'inferred' : 'unknown', value: category, note: 'Inferred from title keywords' },
      riskNotes,
    },
  };
}

// ---------------------------------------------------------------------------
// PHASE 3 — PRODUCT_QA: evidence checks on shortlisted candidates
// ---------------------------------------------------------------------------

export interface QAOutcome {
  candidateId: string;
  title: string;
  passed: boolean;
  issues: string[];
}

/**
 * Deterministic QA pass over a candidate's evidence. Checks exactly what is
 * verifiable: images, price, availability, shipping-days, unknown fields,
 * margin confidence. Never invents facts; failures are recorded with reasons.
 */
export function qaCandidate(candidate: ScoutCandidate): QAOutcome {
  const issues: string[] = [];
  const ev = candidate.evidence;

  const images = (ev.images?.value as string[] | null) ?? null;
  if (!images || images.length === 0) issues.push('No usable product images verified');
  else if (images.some((i) => !/^https?:\/\//i.test(i))) issues.push('Some image URLs are not http(s)');

  const price = (ev.supplierPrice?.value as number | null) ?? null;
  if (price === null || price <= 0) issues.push('No verified supplier price (unclear landed cost)');
  else if (price < 1) issues.push('Suspiciously low price (< $1) — verify source');

  if (ev.availability?.value === 'unavailable') issues.push('Source marks product unavailable');
  else if (ev.availability?.status === 'unknown') issues.push('Availability not verified on source page');

  if (ev.shippingDays?.status === 'unknown') issues.push('Delivery window not stated on source');
  if (ev.shippingCost?.status === 'unknown') issues.push('Shipping cost not stated on source (margin confidence LOW)');

  if (candidate.margin?.confidence === 'low') issues.push('Margin confidence LOW — no silent cost estimates');

  if (candidate.score && candidate.score.overall < SHORTLIST_THRESHOLD) {
    issues.push(`Score ${candidate.score.overall} below the ${SHORTLIST_THRESHOLD} shortlist threshold`);
  }

  // Unknown critical fields.
  const critical = ['title', 'price', 'availability', 'images'];
  for (const f of critical) {
    if ((ev.unknownFields || []).includes(f)) issues.push(`Critical field unknown: ${f}`);
  }

  return { candidateId: candidate.id, title: candidate.title, passed: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// MARKET INTELLIGENCE JOB (Phase 4B) — separate from the product pipeline
// ---------------------------------------------------------------------------

export interface MarketIntelligenceOptions {
  /** Market/niche to investigate, e.g. "dog toys". */
  query: string;
  market?: string;
  db: DbAdapter;
  /** Injectable discovery (defaults to real DuckDuckGo path). */
  discover?: (q: { query: string; market?: string; maxResults?: number }) => Promise<DiscoverResult>;
  /** Injectable AI call (defaults to DeepSeek via secure server proxy). */
  aiCall?: (prompt: string, model?: string) => Promise<string>;
  /** Candidate extracts to fold into signals (from a previous research run). */
  extracts?: { title: string; extract: PageExtract }[];
  onProgress?: (msg: string) => void;
}

export interface MarketIntelligenceResult {
  jobId: string;
  query: string;
  signals: number;
  marketScore: number | null;
  aiUsed: boolean;
  analysis: MarketAnalysis | null;
  /** Fingerprint of the collected signals — persisted on the durable job. */
  evidenceFingerprint: string | null;
}

/**
 * Run one MARKET_INTELLIGENCE agent job: collect signals → score market
 * opportunity → (DeepSeek analysis when configured) → persist to candidates.
 * Deterministic fallback keeps it working with no AI keys configured.
 */
export async function runMarketIntelligenceJob(opts: MarketIntelligenceOptions): Promise<MarketIntelligenceResult> {
  const { query, market, db, extracts, onProgress } = opts;
  const progress = (m: string) => onProgress?.(m);
  const at = new Date().toISOString();

  const jobId = await createJob(db, 'MARKET_INTELLIGENCE', {
    query,
    market: market || null,
    at,
    note: 'Collect market signals → market opportunity score → (DeepSeek when configured)',
  });
  await addRun(db, jobId, 'market-intelligence', 'running', `Analyzing market: ${query}`);
  await addLog(db, jobId, 'info', `MARKET_INTELLIGENCE started for "${query}" (retries=0)`);

  let signals = [] as Awaited<ReturnType<typeof signalsFromDiscovery>>;
  let warning = '';
  try {
    const result = opts.discover
      ? await opts.discover({ query, market, maxResults: 12 })
      : await import('./discover').then((m) => m.discoverUrls({ query, market, maxResults: 12 }));
    signals = signalsFromDiscovery({ query, market, maxResults: 12 }, result, at);
    if (result.warning) warning = result.warning;
    progress(`[signals] ${query}: ${result.urls.length} product URLs discovered`);
  } catch (e) {
    warning = `Discovery failed: ${(e as Error).message}`;
    progress(`[warn] ${warning}`);
  }

  if (extracts?.length) {
    signals = [...signals, ...signalsFromExtracts(extracts, at)];
  }

  const category = query.toLowerCase().includes('cat')
    ? 'Cat' : query.toLowerCase().includes('dog') || query.toLowerCase().includes('puppy')
      ? 'Dog' : query.toLowerCase().includes('groom')
        ? 'Grooming' : 'Pet';

  const det = scoreMarketOpportunity({ signals, category });
  progress(`[market] ${query}: deterministic market score ${det.score}/100`);

  const analysis = await runMarketIntelligence({ signals, category }, det, opts.aiCall);
  if (analysis.aiUsed) {
    progress(`[ai] DeepSeek market analysis used (model ${analysis.model || 'deepseek-chat'})`);
  } else {
    progress(`[ai] ${analysis.unsupportedClaims[0] || 'Market Intelligence AI not configured — deterministic analysis used'}`);
  }

  // Evidence fingerprint of THIS analysis — persisted on the durable job so a
  // later supplier search can PROVE it is grounded in this exact evidence
  // (Phase 4C live-readiness: the DB job is the market-gate source of truth).
  const fp = evidenceFingerprint([
    query, market || '',
    ...signals.map((s) => `${s.signalType}:${s.summary}`),
  ]);
  await addLog(db, jobId, 'info',
    `MARKET_INTELLIGENCE finished: ${signals.length} signals, market score ${analysis.marketOpportunityScore}/100, ai=${analysis.aiUsed}${warning ? '; ' + warning : ''} (retries=0)`);
  await addRun(db, jobId, 'market-intelligence', 'completed', `${signals.length} signals · score ${analysis.marketOpportunityScore}/100 · ${analysis.aiUsed ? 'AI' : 'deterministic'}`);
  await completeJob(db, jobId, 'completed', {
    query,
    signals: signals.length,
    marketScore: analysis.marketOpportunityScore,
    aiUsed: analysis.aiUsed,
    warning: warning || null,
    evidenceFingerprint: fp,
    at: new Date().toISOString(),
  }, undefined, analysis.aiUsed
    ? { provider: 'deepseek', model: analysis.model || 'deepseek-chat' }
    : {});

  return {
    jobId,
    query,
    signals: signals.length,
    marketScore: analysis.marketOpportunityScore,
    aiUsed: analysis.aiUsed,
    analysis,
    evidenceFingerprint: fp,
  };
}

// ---------------------------------------------------------------------------
// Orchestrator — three durable jobs: RESEARCH → SCORE → QA
// ---------------------------------------------------------------------------

/**
 * Run one controlled research pass. Records three distinct agent_jobs
 * (PRODUCT_RESEARCH → PRODUCT_SCORE → PRODUCT_QA), each with its own runs,
 * logs, status, input/output summary, errors and retry count.
 *
 * NEVER approves or drafts anything — statuses reach at most 'qualified'
 * (shortlist). Owner actions are explicit UI-only operations.
 */
export async function runScoutResearch(opts: ScoutRunOptions): Promise<ScoutRunResult> {
  const { urls, db, onProgress, markup } = opts;
  const progress = (m: string) => onProgress?.(m);

  // ------------------------------------------------------------------ JOB 1
  const researchJobId = await createJob(db, 'PRODUCT_RESEARCH', {
    urls,
    at: new Date().toISOString(),
    note: 'Fetch + extract + persist candidates as researching',
  });
  await addRun(db, researchJobId, 'product-scout', 'running', `Researching ${urls.length} source URLs`);
  await addLog(db, researchJobId, 'info', `PRODUCT_RESEARCH started with ${urls.length} URLs (retries=0)`);

  const existing = await db
    .list<{ id: string; title: string; source_url?: string | null }>('product_candidates', { limit: 500 })
    .then((rows) => (Array.isArray(rows) ? rows : []))
    .catch(() => []);

  const seen: { dedupeKey: string; title: string }[] = [];
  for (const row of existing) {
    const k = row.source_url ? dedupeKey(row.source_url, row.title) : dedupeKey('', row.title);
    seen.push({ dedupeKey: k, title: row.title });
  }

  const candidates: ScoutCandidate[] = [];
  let failed = 0;
  let researchRetries = 0;
  for (const url of urls) {
    const c = await researchUrl({ ...opts, url }, seen);
    if (!c) {
      failed++;
      researchRetries++;
      continue;
    }
    candidates.push(c);
    seen.push({ dedupeKey: dedupeKey(c.sourceUrl, c.title), title: c.title });
  }
  await addLog(db, researchJobId, 'info',
    `PRODUCT_RESEARCH finished: ${candidates.length} researched, ${failed} failed/unverifiable (retries=${researchRetries})`);
  await addRun(db, researchJobId, 'product-scout', 'completed', `${candidates.length} candidates researched`);
  await completeJob(db, researchJobId, 'completed', {
    researched: candidates.length,
    failed,
    retries: researchRetries,
    candidateIds: candidates.map((c) => c.id),
  });

  // ------------------------------------------------------------------ JOB 2
  const scoreJobId = await createJob(db, 'PRODUCT_SCORE', {
    candidateIds: candidates.map((c) => c.id),
    at: new Date().toISOString(),
    note: 'Margin + hard-rejection filters + 100-pt weighted score',
  });
  await addRun(db, scoreJobId, 'product-scout', 'running', `Scoring ${candidates.length} candidates`);
  await addLog(db, scoreJobId, 'info', `PRODUCT_SCORE started for ${candidates.length} candidates (retries=0)`);

  let rejected = 0;
  const scored: ScoutCandidate[] = [];
  for (const c of candidates) {
    const out = scorePhaseCandidate(c, markup);
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
    progress(`[score] ${out.title} — ${out.score?.overall ?? '?'}/100 (${out.status})${out.rejectionReason ? ' — REJECTED: ' + out.rejectionReason : ''}`);
  }
  const shortlisted = scored.filter((c) => c.status === 'qualified').length;
  await addLog(db, scoreJobId, 'info',
    `PRODUCT_SCORE finished: ${scored.length} scored, ${rejected} rejected, ${shortlisted} shortlisted (retries=0)`);
  await addRun(db, scoreJobId, 'product-scout', 'completed', `${scored.length} scored, ${shortlisted} shortlisted`);
  await completeJob(db, scoreJobId, 'completed', {
    scored: scored.length,
    rejected,
    shortlisted,
    retries: 0,
  });

  // ------------------------------------------------------------------ JOB 3
  const qaTargets = scored.filter((c) => c.status === 'qualified');
  const qaJobId = await createJob(db, 'PRODUCT_QA', {
    candidateIds: qaTargets.map((c) => c.id),
    at: new Date().toISOString(),
    note: 'Evidence QA on shortlisted candidates (images/price/availability/shipping)',
  });
  await addRun(db, qaJobId, 'product-scout', 'running', `QA on ${qaTargets.length} shortlisted candidates`);
  await addLog(db, qaJobId, 'info', `PRODUCT_QA started for ${qaTargets.length} shortlisted candidates (retries=0)`);

  const qaOutcomes: QAOutcome[] = [];
  for (const c of qaTargets) {
    const out = qaCandidate(c);
    qaOutcomes.push(out);
    for (const issue of out.issues) await addLog(db, qaJobId, out.passed ? 'info' : 'warn', `[${out.title}] ${issue}`);
    progress(out.passed
      ? `[qa] ${out.title} — PASS`
      : `[qa] ${out.title} — FLAGGED: ${out.issues.join('; ')}`);
  }
  const qaPassed = qaOutcomes.filter((o) => o.passed).length;
  await addLog(db, qaJobId, 'info', `PRODUCT_QA finished: ${qaPassed} passed, ${qaOutcomes.length - qaPassed} flagged (retries=0)`);
  await addRun(db, qaJobId, 'product-scout', 'completed', `${qaPassed} passed, ${qaOutcomes.length - qaPassed} flagged`);
  await completeJob(db, qaJobId, 'completed', {
    passed: qaPassed,
    flagged: qaOutcomes.length - qaPassed,
    retries: 0,
  });

  progress(`Done — ${scored.length} researched, ${rejected} rejected, ${shortlisted} shortlisted, ${failed} failed. QA: ${qaPassed} passed / ${qaOutcomes.length - qaPassed} flagged.`);
  return { jobId: researchJobId, scoreJobId, qaJobId, researched: scored.length, rejected, shortlisted, failed, candidates: scored };
}
