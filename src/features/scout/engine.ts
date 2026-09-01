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
import type { FetchedSourcePage, PageExtract, ScoutCandidate, ScoutRunResult, MarketAnalysis, ComparablePriceEvidence } from './types';
import { supplierFromUrl, dedupeKey, normalizeTitle } from './normalize';
import { extractPageFacts, describeExtract } from './extract';
import { calculateMargin } from './margin';
import { applyRejectFilters, collectRiskFlags } from './reject';
import { scoreCandidate, SHORTLIST_THRESHOLD } from './score';
import { signalsFromDiscovery, signalsFromExtracts, scoreMarketOpportunity, runMarketIntelligence } from './market';
import { evidenceFingerprint } from './aiCost';
import { newId } from './persist';
import {
  buildMarketEvidencePack, assessEvidenceQuality, countExtractEvidence, emptyEvidenceCounts,
  mergeComparablePriceEvidence, selectEvidencePagesDetailed,
  type EvidenceQualityThresholds,
} from './marketEvidence';
import { DuckDuckGoRetailDiscoveryAdapter, type RetailEvidenceSearchResult } from './retailDiscovery';
import { FetchingRetailNavigationAdapter, MAX_NAV_LISTING_SOURCES, MAX_NAV_PDP_LINKS, type RetailNavigationAdapter } from './retailNavigation';
import { collectDemandSignals, type MarketDemandAdapter, type DemandCollectionResult } from './marketDemand';
import { identityEvidenceFromExtract, hasExplicitIdentity, aggregateReviewEvidence } from './identity';
import {
  ensureSupplier, persistSupplierProduct, persistCandidate, persistScore,
  createJob, completeJob, addRun, addLog, queueHermesFallback,
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
    brand: (ev as { brand?: unknown }).brand as string | null ?? null,
    model: (ev as { model?: unknown }).model as string | null ?? null,
    mpn: (ev as { mpn?: unknown }).mpn as string | null ?? null,
    sku: (ev as { sku?: unknown }).sku as string | null ?? null,
    upc: (ev as { upc?: unknown }).upc as string | null ?? null,
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
  /**
   * Phase 4E: when set, discovery uses SITE-RESTRICTED retailer search
   * (Chewy/Target/Walmart, …) instead of one generic query — exact product
   * pages with real prices/availability. Market evidence only.
   */
  retailDomains?: string[];
  /**
   * Phase 4E.2: injectable retailer listing-page NAVIGATION adapter. Defaults
   * to FetchingRetailNavigationAdapter over `fetchPage` when retailDomains is
   * set. Listing pages are navigation sources only — they extract exact PDP
   * links and contribute ZERO evidence themselves.
   */
  retailNavigation?: RetailNavigationAdapter;
  /** Injectable AI call (defaults to DeepSeek via secure server proxy). */
  aiCall?: (prompt: string, model?: string) => Promise<string>;
  /**
   * Candidate extracts to fold into signals (from a previous research run).
   * When absent AND fetchPage is provided, the engine builds the evidence pack
   * itself: discovery → select 6-8 exact product pages → fetch → extract.
   */
  extracts?: { title: string; extract: PageExtract }[];
  /**
   * Secure page fetcher (the app's /api/fetch-page path). REQUIRED for the
   * Phase 4D evidence-pack flow — without it MI stays discovery-only (weak).
   */
  fetchPage?: (url: string) => Promise<FetchedSourcePage>;
  /** Max exact product pages to research for the evidence pack (default 8). */
  maxEvidencePages?: number;
  /** Evidence-quality gate thresholds (conservative configurable defaults). */
  evidenceThresholds?: EvidenceQualityThresholds;
  /**
   * Optional future demand-data adapter (no credentials needed in Phase 4D).
   * Phase 4G.1: the normal ProductScout MI flow passes the server-backed
   * GoogleAdsServerDemandAdapter (admin-JWT proxy, never browser secrets).
   */
  demand?: MarketDemandAdapter;
  /**
   * Explicit demand keywords for the demand adapter (Phase 4G.1 §D8).
   * Default [query]; max 5. For future CJ-seeded proofs the caller supplies
   * the exact concept vocabulary deterministically — never invented terms.
   */
  demandKeywords?: string[];
  /**
   * Phase 4H.2 — browser-verified MARKET-COMPARABLE price observations for
   * the CONCEPT (retailer PDP prices visibly rendered; variants/brands may
   * differ). They contribute concept-level price-band evidence to the market
   * gate and score, with full provenance — NEVER exact-SKU identity. Exact-
   * product identity rules (identity.ts) are untouched. Missing = no effect.
   */
  comparablePrices?: ComparablePriceEvidence[];
  onProgress?: (msg: string) => void;
}

export interface MarketEvidenceSummary {
  discoveredUrls: number;
  selectedUrls: string[];
  successfulExtracts: number;
  failedExtracts: number;
  independentDomains: number;
  priceEvidenceCount: number;
  ratingEvidenceCount: number;
  reviewCountEvidenceCount: number;
  totalObservedReviews: number;
  availabilityEvidenceCount: number;
  availableCount: number;
  unavailableCount: number;
  rejectedUrls: { url: string; reason: string }[];
  evidenceQuality: 'sufficient' | 'insufficient' | 'not-assessed';
  evidenceQualityReasons: string[];
  /** Phase 4E retailer-restricted discovery report (when used). */
  retail: {
    searchRequests: number;
    domainsAttempted: string[];
    domainsWithResults: string[];
    rejected: { url: string; reason: string }[];
    /** Phase 4E.2 — listing/search pages used as NAVIGATION sources (never evidence). */
    listingSources: number;  /** Phase 4E.2 — exact PDP URLs extracted from listing pages via navigation. */
  navigationPdpExtracted: number;
  } | null;
  /** Phase 4G — pages carrying explicit identity evidence (brand/model/MPN/SKU/UPC). */
  identityEvidencePages: number;
  /** Phase 4G — review-aggregation honesty note (never summed across non-exact identities). */
  reviewAggregationNote: string;
  /**
   * Phase 4H.2 — browser-verified MARKET-COMPARABLE prices ingested (with
   * provenance). Concept-level price-band evidence; never exact-SKU identity.
   */
  comparablePriceEvidenceCount: number;
  comparablePrices: ComparablePriceEvidence[];
}

export interface MarketIntelligenceResult {
  jobId: string;
  query: string;
  signals: number;
  /**
   * QUALIFYING Market Opportunity Score /100 — null when the evidence-quality
   * gate did NOT pass (Phase 4E.1 fail-closed). A diagnostic deterministic
   * score is exposed separately and is NEVER qualification-capable.
   */
  marketScore: number | null;
  /**
   * Deterministic score for debugging only — DIAGNOSTIC SCORE, NOT
   * QUALIFICATION ELIGIBLE when evidenceQuality is insufficient.
   */
  diagnosticDeterministicScore: number | null;
  /**
   * true ONLY when the evidence-quality gate passed. Gates DeepSeek spend AND
   * supplier-search qualification (BUSINESS_QUALIFIED requires this).
   */
  qualificationEligible: boolean;
  /**
   * Search hypotheses that may feed supplier qualification — EMPTY unless the
   * run is qualification-eligible (diagnostic suggestions stay separate).
   */
  recommendedSearchQueries: string[];
  aiUsed: boolean;
  analysis: MarketAnalysis | null;
  /** Fingerprint of the collected signals — persisted on the durable job. */
  evidenceFingerprint: string | null;
  /** Phase 4D evidence pack summary (what the score was grounded on). */
  evidence: MarketEvidenceSummary;
  /**
   * Phase 4G — direct-demand data collection status (Google Ads adapter when
   * configured). NEVER a substitute for evidence quality; factual metrics only.
   */
  demand: {
    provider: string | null;
    status: 'not_configured' | 'success' | 'error';
    errorSafe: string | null;
    errorCode: string | null;
    requestId: string | null;
    keywordsRequested: number;
    keywordsReturned: number;
    /** Actual normalized requested keywords (authoritative). */
    requestedKeywords: string[];
    /** Structured official facts — source of truth (not reverse-parsed). */
    returnedResults: import('./marketDemand').GoogleAdsReturnedResult[];
    /** Avg monthly searches PER returned keyword (official 12-month estimate). */
    avgMonthlySearches: number[] | null;
    monthlyHistory: { month: string; searches: number }[];
    /** Advertiser competition level per keyword (LOW/MEDIUM/HIGH). */
    competition: string[] | null;
    competitionIndex: number[] | null;
    /** Top-of-page bid range (USD) per keyword. */
    bidRangeUsd: { keyword: string; low: number; high: number }[] | null;
    observedAt: string | null;
  };
}

/**
 * Market Opportunity Score required for a supplier run to be market-grounded
 * (Phase 4E.1). Matches the business gate used by supplierSearch (60).
 */
export const MARKET_QUALIFICATION_GATE = 60;

export interface CjMarketContextArm {
  marketAnalysisId: string;
  hypothesis: string;
  recommendedSearchQueries: string[];
}

/**
 * Phase 4E.1 — FAIL-CLOSED CJ arming decision. The Product Scout UI arms a
 * market-grounded CJ run ONLY when the MI run is qualification-eligible AND
 * the QUALIFYING market score meets the business gate (>= 60) AND the analysis
 * produced search hypotheses. Returns null otherwise — an insufficient-
 * evidence run can NEVER arm CJ, no matter how high its diagnostic score was.
 */
export function cjMarketContextFor(result: MarketIntelligenceResult): CjMarketContextArm | null {
  if (!result.qualificationEligible) return null;
  if (result.marketScore === null || result.marketScore < MARKET_QUALIFICATION_GATE) return null;
  const recs = result.analysis?.recommendedSearchQueries ?? [];
  if (recs.length === 0) return null;
  return { marketAnalysisId: result.jobId, hypothesis: recs[0], recommendedSearchQueries: recs };
}

/**
 * Run one MARKET_INTELLIGENCE agent job: collect signals → score market
 * opportunity → (DeepSeek analysis when configured) → persist to candidates.
 * Deterministic fallback keeps it working with no AI keys configured.
 */
export async function runMarketIntelligenceJob(opts: MarketIntelligenceOptions): Promise<MarketIntelligenceResult> {
  const { query, market, db, extracts, onProgress, fetchPage, maxEvidencePages, evidenceThresholds, demand, demandKeywords, comparablePrices: comparablePriceInput } = opts;
  const comparablePrices: ComparablePriceEvidence[] = comparablePriceInput ?? [];
  const progress = (m: string) => onProgress?.(m);
  const at = new Date().toISOString();

  const jobId = await createJob(db, 'MARKET_INTELLIGENCE', {
    query,
    market: market || null,
    at,
    note: 'Discovery → market evidence pack (select/fetch/extract) → quality gate → score → (DeepSeek only when evidence is sufficient)',
  });
  await addRun(db, jobId, 'market-intelligence', 'running', `Analyzing market: ${query}`);
  await addLog(db, jobId, 'info', `MARKET_INTELLIGENCE started for "${query}" (retries=0)`);

  let signals = [] as Awaited<ReturnType<typeof signalsFromDiscovery>>;
  let warning = '';
  let discoveredUrls: string[] = [];
  let retailReport: RetailEvidenceSearchResult | null = null;
  let navPdp: string[] = []; // Phase 4E.2 — PDPs found via listing-page navigation
  try {
    if (opts.retailDomains && opts.retailDomains.length > 0) {
      // Phase 4E — retailer-restricted discovery: site:<domain> searches so
      // the evidence pack gets EXACT retailer product pages (market evidence
      // only; not supplier sourcing, not CJ research).
      const adapter = new DuckDuckGoRetailDiscoveryAdapter();
      retailReport = await adapter.searchExactProducts({ query, market, domains: opts.retailDomains, maxPerDomain: 2, maxTotal: 8 });
      const directPdp = retailReport.candidates.map((c) => c.url);
      // Phase 4E.2 — retailer LISTING/search pages are NAVIGATION sources only:
      // fetch up to MAX_NAV_LISTING_SOURCES of them, extract exact PDP links,
      // validate. The listing page itself contributes ZERO price/rating/
      // availability evidence and ZERO Market Score points.
      const listingSources = retailReport.listingSources ?? [];
      if (listingSources.length && opts.fetchPage) {
        const nav: RetailNavigationAdapter = opts.retailNavigation
          ?? new FetchingRetailNavigationAdapter(opts.fetchPage);
        for (const ls of listingSources.slice(0, MAX_NAV_LISTING_SOURCES)) {
          try {
            const navRes = await nav.discoverProductLinks({ sourceUrl: ls.url, maxLinks: MAX_NAV_PDP_LINKS });
            progress(`[nav] ${ls.domain} listing ${ls.url.slice(0, 64)}… → ${navRes.pdpUrls.length} exact PDP link(s)${navRes.pdpUrls.length ? '' : ' (no valid PDPs on the listing page)'}`);
            navPdp.push(...navRes.pdpUrls);
          } catch (e) {
            progress(`[nav] listing ${ls.url.slice(0, 64)}… failed: ${(e as Error).message}`);
          }
        }
      } else if (listingSources.length && !opts.fetchPage) {
        progress('[nav] retailer listing pages found but no page fetcher available — skipping navigation (direct PDPs only)');
      }
      // Global dedupe + domain round-robin caps (≤8 total, ≤2 per retailer).
      discoveredUrls = selectEvidencePagesDetailed([...directPdp, ...navPdp], 8, 2).selected;
      const navTotal = navPdp.length;
      signals = signalsFromDiscovery(
        { query, market, maxResults: 12 },
        { query, rawLinks: discoveredUrls, urls: discoveredUrls, filtered: 0, duplicates: 0, warning: retailReport.warning },
        at
      );
      signals.push({
        id: newId(),
        signalType: 'retail_coverage',
        source: 'Site-restricted retailer search (DuckDuckGo HTML) + listing navigation',
        sourceUrl: '',
        observedAt: at,
        summary: `Retailer-restricted search: ${discoveredUrls.length} exact product URLs (${directPdp.length} direct + ${navTotal} via ${listingSources.length} listing-page navigation sources) across ${retailReport.domainsWithResults.length} of ${retailReport.domainsAttempted.length} attempted retailer domains (${retailReport.searchRequests} search requests) — market-supply visibility, NOT sales or demand. Listing pages are navigation sources only and contribute no evidence themselves.`,
        confidence: retailReport.domainsWithResults.length ? 'verified' : 'inferred',
        limitations: 'Retailer domain coverage varies; a URL list is not consumer demand evidence; navigation-derived PDPs still require content validation.',
      });
      progress(`[signals] ${query}: retailer-restricted — ${discoveredUrls.length} exact product URLs (${directPdp.length} direct, ${navTotal} via navigation), ${retailReport.domainsWithResults.length}/${retailReport.domainsAttempted.length} domains with results`);
      if (retailReport.warning) warning = retailReport.warning;
    } else {
      const result = opts.discover
        ? await opts.discover({ query, market, maxResults: 12 })
        : await import('./discover').then((m) => m.discoverUrls({ query, market, maxResults: 12 }));
      discoveredUrls = result.urls;
      signals = signalsFromDiscovery({ query, market, maxResults: 12 }, result, at);
      if (result.warning) warning = result.warning;
      progress(`[signals] ${query}: ${result.urls.length} product URLs discovered`);
    }
  } catch (e) {
    warning = `Discovery failed: ${(e as Error).message}`;
    progress(`[warn] ${warning}`);
  }

  // Phase 4D — build the MARKET EVIDENCE PACK: when no extracts were supplied
  // and a secure fetcher is available, the engine itself does
  //   discovery → select 6-8 exact product pages → fetch → extract
  // so price/rating/availability signals can participate in the score. When
  // extracts ARE supplied (previous research run), they are the pack.
  let pack: Awaited<ReturnType<typeof buildMarketEvidencePack>> | null = null;
  if (extracts && extracts.length > 0) {
    const identities = extracts.map((x) => identityEvidenceFromExtract(x.extract));
    const reviewAgg = aggregateReviewEvidence(identities);
    pack = {
      selectedUrls: [],
      extracts: extracts.map((x) => ({ url: '', ...x })),
      failedUrls: [],
      rejectedUrls: [],
      independentDomains: 0, // not derivable from extracts without source URLs
      counts: { ...countExtractEvidence(extracts), independentDomains: 0 },
      identityEvidencePages: identities.filter((i) => hasExplicitIdentity(i)).length,
      reviewAggregationNote: reviewAgg.note,
      comparablePrices: [],
    };
  } else if (fetchPage) {
    progress('[evidence] building market evidence pack (select → fetch → extract)');
    try {
      pack = await buildMarketEvidencePack({
        urls: discoveredUrls,
        fetchPage,
        maxPages: maxEvidencePages ?? 8,
        onProgress,
      });
    } catch (e) {
      warning = `${warning ? warning + '; ' : ''}evidence pack failed: ${(e as Error).message}`;
      progress(`[warn] evidence pack failed: ${(e as Error).message}`);
    }
  } else {
    progress('[warn] no extracts and no fetchPage — Market Intelligence is discovery-only (weak evidence, see Phase 4D)');
  }
  // Phase 4H.2 — fold browser-verified MARKET-COMPARABLE prices into the
  // pack (concept-level price-band evidence; provenance persisted). The gate
  // counts them toward minPriceEvidence as distinct concept price observations
  // (never double-counted against an extract price of the same PDP URL).
  if (pack && comparablePrices.length) {
    const pricedExtractUrls = pack.extracts.filter((x) => x.extract.price !== null).map((x) => x.url);
    const before = pack.counts.priceEvidenceCount;
    pack = {
      ...pack,
      comparablePrices,
      counts: mergeComparablePriceEvidence(pack.counts, comparablePrices, pricedExtractUrls),
    };
    progress(`[evidence] ingested ${comparablePrices.length} browser-verified MARKET-COMPARABLE prices → concept price evidence ${before} → ${pack.counts.priceEvidenceCount} (${pack.counts.comparablePriceEvidenceCount} comparable, full provenance persisted)`);
  }
  if (pack && pack.extracts.length) {
    signals = [...signals, ...signalsFromExtracts(pack.extracts, at, pack.comparablePrices)];
  }

  // Phase 4G — demand-data adapter with a STRUCTURED result. A configured-
  // but-failed demand source must NOT silently look identical to "no demand
  // provider configured": status is not_configured / success / error.
  const demandCollection: DemandCollectionResult = await collectDemandSignals(
    demand,
    { query, market, keywords: demandKeywords && demandKeywords.length ? demandKeywords : undefined }
  );
  if (demandCollection.signals.length) signals = [...signals, ...demandCollection.signals];

  const category = query.toLowerCase().includes('cat')
    ? 'Cat' : query.toLowerCase().includes('dog') || query.toLowerCase().includes('puppy')
      ? 'Dog' : query.toLowerCase().includes('groom')
        ? 'Grooming' : 'Pet';

  const det = scoreMarketOpportunity({ signals, category });
  progress(`[market] ${query}: deterministic market score ${det.score}/100`);

  // EVIDENCE QUALITY GATE — before any DeepSeek spend. A thin pack means
  // DEEPSEEK CALL = NO and MARKET EVIDENCE INSUFFICIENT is reported with the
  // exact missing evidence. The gate is conservative + configurable.
  const gate = pack
    ? assessEvidenceQuality(pack.counts, evidenceThresholds)
    : assessEvidenceQuality(emptyEvidenceCounts(), evidenceThresholds);
  if (!gate.pass) {
    progress(`[evidence] MARKET EVIDENCE INSUFFICIENT — missing: ${gate.missing.join('; ')}`);
  } else {
    progress(`[evidence] market evidence sufficient: ${gate.reasons.join('; ')}`);
  }

  // DeepSeek only after the quality gate passes; otherwise the throwing
  // aiCall routes through the existing deterministic fallback (aiUsed=false).
  const aiUsed = gate.pass;
  const analysis = await runMarketIntelligence({ signals, category }, det, aiUsed
    ? opts.aiCall
    : async () => { throw new Error('DEEPSEEK CALL SKIPPED — MARKET EVIDENCE INSUFFICIENT'); });

  // Phase 4E.1 — FAIL-CLOSED semantics. When the evidence-quality gate did NOT
  // pass, the diagnostic deterministic score is NOT a qualifying Market Score:
  //   * marketScore = null (no qualification-capable score)
  //   * qualificationEligible = false
  //   * recommendedSearchQueries = [] (no supplier hypotheses)
  //   * DeepSeek calls = 0 (already enforced by the gate)
  // The diagnostic score + its suggested queries are still persisted for
  // debugging under diagnosticDeterministicScore / diagnosticSuggestedQueries
  // and must NEVER be accepted as supplier hypotheses by market provenance.
  const evidenceQuality: 'sufficient' | 'insufficient' = gate.pass ? 'sufficient' : 'insufficient';
  const qualificationEligible = gate.pass;
  const qualifyingMarketScore = gate.pass ? analysis.marketOpportunityScore : null;
  const qualifyingQueries = gate.pass ? analysis.recommendedSearchQueries : [];
  if (analysis.aiUsed) {
    progress(`[ai] DeepSeek market analysis used (model ${analysis.model || 'deepseek-chat'})`);
  } else if (gate.pass) {
    progress(`[ai] ${analysis.unsupportedClaims[0] || 'Market Intelligence AI not configured — deterministic analysis used'}`);
  } else {
    progress(`[ai] DeepSeek skipped (evidence gate) — deterministic analysis used`);
  }

  // Evidence fingerprint of THIS analysis — persisted on the durable job so a
  // later supplier search can PROVE it is grounded in this exact evidence
  // (Phase 4C live-readiness: the DB job is the market-gate source of truth).
  const fp = evidenceFingerprint([
    query, market || '',
    ...signals.map((s) => `${s.signalType}:${s.summary}`),
  ]);
  await addLog(db, jobId, 'info',
    `MARKET_INTELLIGENCE finished: ${signals.length} signals, market score ${qualifyingMarketScore ?? 'NULL (evidence insufficient)'}/100, diagnostic ${det.score}/100, ai=${analysis.aiUsed}, evidence_quality=${evidenceQuality}${warning ? '; ' + warning : ''} (retries=0)`);
  await addRun(db, jobId, 'market-intelligence', 'completed', `${signals.length} signals · market ${qualifyingMarketScore ?? 'NULL'}/100 · diagnostic ${det.score}/100 · ${analysis.aiUsed ? 'AI' : 'deterministic'} · evidence ${gate.pass ? 'OK' : 'INSUFFICIENT'}`);
  // Persist the recommended search hypotheses + opportunity/category on the
  // durable job output (Phase 4C migration-security revision, §9) so a later
  // supplier search can PROVE the query it ran follows THIS analysis. Phase 4D
  // additionally persists the evidence-pack provenance (what grounded the
  // score) — never any credentials. Phase 4E.1: the QUALIFYING marketScore and
  // recommendedSearchQueries are persisted ONLY when the evidence gate passed;
  // the deterministic diagnostic score + its suggested queries are stored
  // SEPARATELY (diagnosticDeterministicScore / diagnosticSuggestedQueries) and
  // are never qualification-capable.
  await completeJob(db, jobId, 'completed', {
    query,
    signals: signals.length,
    diagnosticDeterministicScore: det.score,
    marketScore: qualifyingMarketScore,
    qualificationEligible,
    aiUsed: analysis.aiUsed,
    warning: warning || null,
    evidenceFingerprint: fp,
    recommendedSearchQueries: qualifyingQueries,
    diagnosticSuggestedQueries: analysis.recommendedSearchQueries,
    opportunity: category,
    discoveredUrls: discoveredUrls.length,
    selectedUrls: pack?.selectedUrls ?? [],
    successfulExtracts: pack?.counts.successfulExtracts ?? 0,
    failedExtracts: pack?.counts.failedExtracts ?? 0,
    independentDomains: pack?.independentDomains ?? 0,
    priceEvidenceCount: pack?.counts.priceEvidenceCount ?? 0,
    ratingEvidenceCount: pack?.counts.ratingEvidenceCount ?? 0,
    reviewCountEvidenceCount: pack?.counts.reviewCountEvidenceCount ?? 0,
    totalObservedReviews: pack?.counts.totalObservedReviews ?? 0,
    availabilityEvidenceCount: pack?.counts.availabilityEvidenceCount ?? 0,
    availableCount: pack?.counts.availableCount ?? 0,
    unavailableCount: pack?.counts.unavailableCount ?? 0,
    rejectedUrls: pack?.rejectedUrls ?? [],
    // Phase 4G — product identity honesty on the evidence pack.
    identityEvidencePages: pack?.identityEvidencePages ?? 0,
    reviewAggregationNote: pack?.reviewAggregationNote ?? '',
    // Phase 4H.2 — browser-verified MARKET-COMPARABLE prices (concept-level
    // price-band evidence with provenance; never exact-SKU identity).
    comparablePriceEvidenceCount: pack?.counts.comparablePriceEvidenceCount ?? 0,
    comparablePrices: pack?.comparablePrices ?? [],
    // Phase 4G.1 — direct-demand evidence (Google Ads adapter when configured;
    // never secret values). Structured facts are primary; signals are derived
    // from them. Persisted so the audit UI can show them.
    demandProvider: demandCollection.provider,
    demandStatus: demandCollection.status,
    demandErrorSafe: demandCollection.errorSafe ?? null,
    demandErrorCode: demandCollection.errorCode ?? null,
    demandRequestId: demandCollection.requestId ?? null,
    demandRequestedKeywords: demandCollection.requestedKeywords,
    demandReturnedResults: demandCollection.returnedResults,
    keywordsRequested: demandCollection.keywordsRequested,
    keywordsReturned: demandCollection.keywordsReturned,
    avgMonthlySearches: demandCollection.avgMonthlySearches,
    demandMonthlyHistory: demandCollection.monthlyHistory,
    keywordAdCompetition: demandCollection.competition,
    competitionIndex: demandCollection.competitionIndex,
    bidRangeUsd: demandCollection.bidRangeUsd,
    demandObservedAt: demandCollection.observedAt,
    retailSearchRequests: retailReport?.searchRequests ?? 0,
    retailDomainsAttempted: retailReport?.domainsAttempted ?? [],
    retailDomainsWithResults: retailReport?.domainsWithResults ?? [],
    retailRejectedUrls: retailReport?.rejected ?? [],
    retailListingSources: retailReport?.listingSources?.length ?? 0,
    retailNavigationPdpUrls: navPdp.length,
    evidenceQuality,
    evidenceQualityReasons: [...gate.missing, ...gate.reasons],
    at: new Date().toISOString(),
  }, undefined, analysis.aiUsed
    ? { provider: 'deepseek', model: analysis.model || 'deepseek-chat' }
    : {});

  const evidence: MarketEvidenceSummary = {
    discoveredUrls: discoveredUrls.length,
    selectedUrls: pack?.selectedUrls ?? [],
    successfulExtracts: pack?.counts.successfulExtracts ?? 0,
    failedExtracts: pack?.counts.failedExtracts ?? 0,
    independentDomains: pack?.independentDomains ?? 0,
    priceEvidenceCount: pack?.counts.priceEvidenceCount ?? 0,
    ratingEvidenceCount: pack?.counts.ratingEvidenceCount ?? 0,
    reviewCountEvidenceCount: pack?.counts.reviewCountEvidenceCount ?? 0,
    totalObservedReviews: pack?.counts.totalObservedReviews ?? 0,
    availabilityEvidenceCount: pack?.counts.availabilityEvidenceCount ?? 0,
    availableCount: pack?.counts.availableCount ?? 0,
    unavailableCount: pack?.counts.unavailableCount ?? 0,
    rejectedUrls: pack?.rejectedUrls ?? [],
    identityEvidencePages: pack?.identityEvidencePages ?? 0,
    reviewAggregationNote: pack?.reviewAggregationNote ?? '',
    comparablePriceEvidenceCount: pack?.counts.comparablePriceEvidenceCount ?? 0,
    comparablePrices: pack?.comparablePrices ?? [],
    evidenceQuality: gate.pass ? 'sufficient' : 'insufficient',
    evidenceQualityReasons: [...gate.missing, ...gate.reasons],
    retail: retailReport
      ? {
          searchRequests: retailReport.searchRequests,
          domainsAttempted: retailReport.domainsAttempted,
          domainsWithResults: retailReport.domainsWithResults,
          rejected: retailReport.rejected,
          listingSources: retailReport.listingSources?.length ?? 0,
          navigationPdpExtracted: navPdp.length,
        }
      : null,
  };

  return {
    jobId,
    query,
    signals: signals.length,
    marketScore: qualifyingMarketScore,
    diagnosticDeterministicScore: det.score,
    qualificationEligible,
    recommendedSearchQueries: qualifyingQueries,
    aiUsed: analysis.aiUsed,
    analysis,
    evidenceFingerprint: fp,
    evidence,
    demand: {
      provider: demandCollection.provider,
      status: demandCollection.status,
      errorSafe: demandCollection.errorSafe ?? null,
      errorCode: demandCollection.errorCode ?? null,
      requestId: demandCollection.requestId ?? null,
      keywordsRequested: demandCollection.keywordsRequested,
      keywordsReturned: demandCollection.keywordsReturned,
      requestedKeywords: demandCollection.requestedKeywords,
      returnedResults: demandCollection.returnedResults,
      avgMonthlySearches: demandCollection.avgMonthlySearches,
      monthlyHistory: demandCollection.monthlyHistory ?? [],
      competition: demandCollection.competition,
      competitionIndex: demandCollection.competitionIndex,
      bidRangeUsd: demandCollection.bidRangeUsd,
      observedAt: demandCollection.observedAt,
    },
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

  // Page-read resilience: when EVERY URL failed automated fetch/extract (all
  // proxies down or all pages JS-only), queue the batch for Hermes
  // browser/computer-use instead of ending the run with zero candidates and
  // no handoff. The pipeline continues (score/QA still run on what survived).
  if (failed > 0 && candidates.length === 0) {
    await queueHermesFallback(db, 'page-read', {
      urls,
      jobId: researchJobId,
      reason: `${failed} URLs failed automated fetch/extract`,
    });
    progress(`[queue] ${failed} URLs queued for Hermes browser page-read`);
  }

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
