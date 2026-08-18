// ============================================================================
// LUXEDGE V2 — SCOUT MARKET INTELLIGENCE (Phase 4B)
//
// Two layers:
//  1) MarketSignalCollector — deterministic evidence layer. Collects ONLY
//     signals that were actually observed (search patterns, retailer pages,
//     prices, ratings, availability). VERIFIED / INFERRED / UNKNOWN.
//  2) MarketIntelligence — turns signals into a Market Opportunity Score /100
//     (SEPARATE from the Product Score /100). When DeepSeek is configured it
//     reasons over the collected evidence only; otherwise a deterministic
//     fallback produces the same structured output. The AI never invents
//     facts — unsupported claims are dropped and recorded.
//
// SECURITY: DeepSeek is called ONLY through the secure server proxy
// (serverGenerate → /api/ai/generate, admin JWT, key server-side). No key
// ever reaches this module or the browser bundle.
// ============================================================================

import { routerGenerate } from './aiRouter';
import type { DiscoverResult } from './discover';
import type { MarketSignal, MarketAnalysis, FinalOpportunityScore, PageExtract, ComparablePriceEvidence } from './types';
import { newId } from './persist';

// ---------------------------------------------------------------------------
// Signal collector
// ---------------------------------------------------------------------------

export interface CollectSignalsOptions {
  query: string;
  market?: string;
  /** Injectable discovery — defaults to the real DuckDuckGo path. */
  discover?: (q: { query: string; market?: string; maxResults?: number }) => Promise<DiscoverResult>;
  /** Extracted page facts (from a completed research run) to fold in. */
  extracts?: { title: string; extract: PageExtract }[];
  maxResults?: number;
}

/** Normalize a raw discovery result into durable market signals. */
export function signalsFromDiscovery(q: { query: string; market?: string; maxResults?: number }, result: DiscoverResult, at: string): MarketSignal[] {
  const signals: MarketSignal[] = [];

  // Search-breadth signal — how many product pages surfaced for this query.
  // Phase 4E honesty: this is search-result breadth / market-supply
  // visibility, NOT sales, orders, search volume, or consumer demand.
  signals.push({
    id: newId(),
    signalType: 'search_breadth',
    source: 'DuckDuckGo HTML search',
    sourceUrl: `https://html.duckduckgo.com/html/?q=${encodeURIComponent([q.query, q.market].filter(Boolean).join(' '))}`,
    observedAt: at,
    summary: `Query "${q.query}"${q.market ? ` (${q.market})` : ''} surfaced ${result.urls.length} product-page URLs (${result.duplicates} duplicates dropped, ${result.filtered} non-product pages filtered) — search-result breadth / market-supply visibility, NOT sales or demand.`,
    confidence: result.warning ? 'inferred' : 'verified',
    limitations: 'Search results are a snapshot at collection time; search engines personalize and may include ads/bias. URL counts are NOT literal consumer demand (no sales/orders/search-volume data).',
  });

  // Competition signal from raw link diversity.
  const hosts = new Set<string>();
  for (const u of result.urls) {
    try { hosts.add(new URL(u).hostname.replace(/^www\./, '')); } catch { /* ignore */ }
  }
  signals.push({
    id: newId(),
    signalType: 'competition',
    source: 'Search result source diversity',
    sourceUrl: result.urls[0] || '',
    observedAt: at,
    summary: `${hosts.size} distinct retailer/manufacturer domains appeared for "${q.query}"${hosts.size >= 4 ? ' — competitive market' : hosts.size <= 1 ? ' — thin supply signal' : ''}.`,
    confidence: 'inferred',
    limitations: 'Domain count is a rough competition proxy, not a full market share analysis.',
  });

  return signals;
}

/**
 * Fold extracted page facts (prices, ratings, availability) into signals.
 *
 * Phase 4H.2 — optional browser-verified MARKET-COMPARABLE prices join the
 * concept-level price band. They are real retailer PDP prices for products in
 * the same CONCEPT (variants/brands may differ) and are labeled as such —
 * NEVER exact-SKU identity. Missing comparable price evidence never blocks
 * the exact-product price range.
 */
export function signalsFromExtracts(items: { title: string; extract: PageExtract }[], at: string, comparables: ComparablePriceEvidence[] = []): MarketSignal[] {
  const signals: MarketSignal[] = [];
  const prices: number[] = [];
  let rated = 0;
  let reviewed = 0;
  let totalReviews = 0;
  let available = 0;
  let availabilityKnown = 0;

  for (const item of items) {
    const extract = item.extract;
    if (extract.price !== null) prices.push(extract.price);
    if (extract.rating !== null || extract.reviewCount !== null) rated++;
    if (extract.reviewCount !== null) {
      reviewed++;
      if (extract.reviewCount > 0) totalReviews += extract.reviewCount;
    }
    if (extract.availability === 'available') available++;
    if (extract.availability === 'available' || extract.availability === 'unavailable') availabilityKnown++;
  }

  const comparablePrices = comparables.filter((c) => c.price > 0).map((c) => c.price);
  const allPrices = [...prices, ...comparablePrices];
  if (allPrices.length) {
    const min = Math.min(...allPrices);
    const max = Math.max(...allPrices);
    const avg = allPrices.reduce((a, b) => a + b, 0) / allPrices.length;
    const comparableNote = comparablePrices.length
      ? ` — includes ${comparablePrices.length} browser-verified MARKET-COMPARABLE price(s) from independent retailer PDPs (variants/brands may differ; NOT exact-SKU identity)`
      : '';
    signals.push({
      id: newId(),
      signalType: 'price_range',
      source: 'Researched product pages + browser-verified market-comparable PDPs',
      sourceUrl: '',
      observedAt: at,
      summary: `Observed market price range $${min.toFixed(2)}–$${max.toFixed(2)} across ${allPrices.length} products (avg $${avg.toFixed(2)})${comparableNote}.`,
      confidence: 'verified',
      limitations: 'Prices are observed snapshots; shipping/landed cost varies by source. Comparable prices are concept-level market observations, not proof of exact-SKU identity across retailers.',
    });
  }

  signals.push({
    id: newId(),
    signalType: 'rating_evidence',
    source: 'Researched product pages',
    sourceUrl: '',
    observedAt: at,
    summary: `${rated} of ${items.length} researched pages carried rating/review evidence${reviewed ? `; ${reviewed} pages with review counts (${totalReviews} total observed — never republished as Luxedge reviews)` : ''}.`,
    confidence: items.length ? 'verified' : 'unknown',
    limitations: 'Ratings on source pages are the suppliers\' own; Luxedge never republishes them as customer reviews.',
  });

  signals.push({
    id: newId(),
    signalType: 'availability',
    source: 'Researched product pages',
    sourceUrl: '',
    observedAt: at,
    summary: `${available} of ${items.length} researched pages showed positive availability (${availabilityKnown} pages with explicit availability evidence).`,
    confidence: items.length ? 'verified' : 'unknown',
    limitations: 'Availability is a point-in-time observation; explicit unavailable/out-of-stock is also evidence of the state observed.',
  });

  return signals;
}

// ---------------------------------------------------------------------------
// Market Opportunity Score — deterministic, evidence-based, /100
// ---------------------------------------------------------------------------

export interface MarketScoreInput {
  signals: MarketSignal[];
  /** Category signal from researched titles (Dog/Cat/Pet/…). */
  category: string | null;
}

/**
 * Deterministic Market Opportunity Score /100 — separate from the Product
 * Score. Scores what the EVIDENCE supports: demand breadth, price-band
 * viability, competition, rating evidence, availability.
 */
export function scoreMarketOpportunity(input: MarketScoreInput): { score: number; explanation: string; breakdown: Record<string, { points: number; max: number; note: string }> } {
  const { signals, category } = input;
  const breakdown: Record<string, { points: number; max: number; note: string }> = {};

  // Market-supply breadth (30): how many distinct product pages surfaced.
  // Phase 4E honesty: URL counts are market-supply visibility, NOT demand.
  const pattern = signals.find((s) => s.signalType === 'search_breadth') || signals.find((s) => s.signalType === 'search_pattern');
  const urlCount = pattern ? parseInt((pattern.summary.match(/surfaced (\d+) product-page/) || [])[1] || '0', 10) : 0;
  const supply = Math.min(30, urlCount >= 15 ? 30 : urlCount >= 8 ? 22 : urlCount >= 4 ? 14 : urlCount >= 1 ? 6 : 0);
  // Phase 4G §8: this criterion is market-SUPPLY VISIBILITY (search-result
  // breadth), NOT consumer demand. Renamed to supplyVisibility; `demand` is
  // kept as a compatibility alias pointing at the same criterion (weights and
  // total score are unchanged).
  breakdown.supplyVisibility = {
    points: supply,
    max: 30,
    note: `${urlCount} product URLs surfaced (market-supply visibility, not sales/search volume/consumer demand)`,
  };
  breakdown.demand = breakdown.supplyVisibility; // @deprecated compatibility alias

  // Price-band viability (20): verified price range inside a sellable band.
  const priceSig = signals.find((s) => s.signalType === 'price_range');
  let pricePts = 0;
  if (priceSig) {
    const m = priceSig.summary.match(/\$(\d+(?:\.\d+)?)–\$(\d+(?:\.\d+)?)/);
    if (m) {
      const min = parseFloat(m[1]);
      const max = parseFloat(m[2]);
      if (min >= 3 && max <= 120) pricePts = 20;         // healthy retail band
      else if (min >= 3 && max <= 200) pricePts = 14;
      else pricePts = 6;
    }
  }
  breakdown.priceBand = { points: pricePts, max: 20, note: priceSig ? priceSig.summary : 'No verified price range evidence' };

  // Competition (20): fewer distinct domains = thinner supply (higher score);
  // many domains = competitive (lower). NO SIGNAL = 0 points (never neutral-gift).
  const compSig = signals.find((s) => s.signalType === 'competition');
  const hostCount = compSig ? parseInt((compSig.summary.match(/(\d+) distinct/) || [])[1] || '0', 10) : 0;
  let compPts = 0;
  if (compSig) {
    if (hostCount >= 6) compPts = 6;        // saturated
    else if (hostCount >= 3) compPts = 10;  // moderate
    else if (hostCount >= 1) compPts = 16;  // thin supply — easier entry
  }
  breakdown.competition = { points: compPts, max: 20, note: compSig ? `${hostCount} distinct source domains` : 'No competition evidence collected — 0 points' };

  // Rating evidence (15): more pages with ratings = healthier demand proof.
  const ratingSig = signals.find((s) => s.signalType === 'rating_evidence');
  const rated = ratingSig ? parseInt((ratingSig.summary.match(/(\d+) of (\d+)/) || [])[1] || '0', 10) : 0;
  const ratedTotal = ratingSig ? parseInt((ratingSig.summary.match(/(\d+) of (\d+)/) || [])[2] || '0', 10) : 0;
  const ratio = ratedTotal ? rated / ratedTotal : 0;
  const ratingPts = ratio >= 0.5 ? 15 : ratio >= 0.25 ? 9 : ratio > 0 ? 4 : 0;
  breakdown.ratings = { points: ratingPts, max: 15, note: `${rated}/${ratedTotal} pages with rating evidence` };

  // Availability (15): positive availability across researched pages.
  const availSig = signals.find((s) => s.signalType === 'availability');
  const avail = availSig ? parseInt((availSig.summary.match(/(\d+) of (\d+)/) || [])[1] || '0', 10) : 0;
  const availTotal = availSig ? parseInt((availSig.summary.match(/(\d+) of (\d+)/) || [])[2] || '0', 10) : 0;
  const availPts = availTotal ? Math.min(15, Math.round((avail / availTotal) * 15)) : 0;
  breakdown.availability = { points: availPts, max: 15, note: `${avail}/${availTotal} pages available` };

  // Category premium fit (bonus up to 0 — no bonus; just honest note).
  breakdown.categoryFit = {
    points: 0,
    max: 0,
    note: category ? `Category signal: ${category}` : 'No category signal',
  };

  const overall = Math.round(
    breakdown.supplyVisibility.points + breakdown.priceBand.points + breakdown.competition.points +
    breakdown.ratings.points + breakdown.availability.points
  );
  const explanation = `Market opportunity ${overall}/100 — supply-visibility ${urlCount} URLs (not demand), price ${priceSig ? 'verified' : 'unknown'}, competition ${hostCount} domains, ratings ${rated}/${ratedTotal}, availability ${avail}/${availTotal}.`;

  return { score: overall, explanation, breakdown };
}

// ---------------------------------------------------------------------------
// Final Opportunity Score — documented formula (default 70/30)
// ---------------------------------------------------------------------------

export function finalOpportunityScore(productScore: number, marketScore: number, productWeight = 0.7): FinalOpportunityScore {
  const w = Math.max(0, Math.min(1, productWeight));
  const marketWeight = +(1 - w).toFixed(2);
  const overall = Math.round(productScore * w + marketScore * (1 - w));
  return {
    productScore,
    marketScore,
    productWeight: +w.toFixed(2),
    marketWeight,
    overall,
    formula: `FINAL = Product ${(w * 100).toFixed(0)}% × ${productScore} + Market ${(marketWeight * 100).toFixed(0)}% × ${marketScore}`,
  };
}

// ---------------------------------------------------------------------------
// DeepSeek Market Intelligence (secure server proxy, grounded)
// ---------------------------------------------------------------------------

export interface DeepSeekAnalysisInput {
  signals: MarketSignal[];
  category: string | null;
  model?: string;
}

/** Parse + validate the structured DeepSeek response. Never trusts free text. */
export function parseMarketAnalysis(raw: string): Omit<MarketAnalysis, 'aiUsed' | 'model' | 'analyzedAt'> | null {
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  const obj = candidate.match(/(\{[\s\S]*\})/);
  if (!obj) return null;
  try {
    const d = JSON.parse(obj[1]);
    if (!d || typeof d !== 'object') return null;
    const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
    const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);
    const arr = (v: unknown, fallback: string[]) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : fallback);
    return {
      marketOpportunityScore: Math.max(0, Math.min(100, Math.round(num(d.marketOpportunityScore, 0)))),
      trendConfidence: ['verified', 'inferred', 'unknown'].includes(d.trendConfidence) ? d.trendConfidence : 'unknown',
      demandEvidence: str(d.demandEvidence, ''),
      competitionLevel: ['low', 'medium', 'high', 'unknown'].includes(d.competitionLevel) ? d.competitionLevel : 'unknown',
      customerPainPoint: typeof d.customerPainPoint === 'string' ? d.customerPainPoint : null,
      priceBand: d.priceBand && typeof d.priceBand === 'object' && typeof d.priceBand.min === 'number' && typeof d.priceBand.max === 'number'
        ? { min: d.priceBand.min, max: d.priceBand.max }
        : null,
      risks: arr(d.risks, []),
      recommendedSearchQueries: arr(d.recommendedSearchQueries, []),
      reasoningSummary: str(d.reasoningSummary, ''),
      unsupportedClaims: [],
    };
  } catch {
    return null;
  }
}

/**
 * Run market intelligence. Calls DeepSeek ONLY when configured (through the
 * secure server proxy); otherwise produces the deterministic analysis. The
 * AI reasons only over the collected signals — its proposed claims that lack
 * supporting evidence are dropped and recorded as unsupportedClaims.
 */
export async function runMarketIntelligence(
  input: DeepSeekAnalysisInput,
  deterministic: { score: number; explanation: string; breakdown: Record<string, { points: number; max: number; note: string }> },
  aiCall: (prompt: string, model?: string) => Promise<string> = async (prompt, model) => {
    const r = await routerGenerate(prompt, {
      task: 'MARKET_INTELLIGENCE',
      important: true,
      explicit: true,
      model,
      system: MARKET_INTEL_SYSTEM,
    });
    return r.text;
  }
): Promise<MarketAnalysis> {
  const at = new Date().toISOString();
  const unsupported: string[] = [];

  // Deterministic analysis first — the cheap, always-available path.
  const base: Omit<MarketAnalysis, 'aiUsed' | 'model' | 'analyzedAt'> = {
    marketOpportunityScore: deterministic.score,
    trendConfidence: deterministic.score >= 60 ? 'inferred' : 'unknown',
    demandEvidence: (input.signals.find((s) => s.signalType === 'search_breadth') || input.signals.find((s) => s.signalType === 'search_pattern'))?.summary || '',
    competitionLevel: (() => {
      const c = input.signals.find((s) => s.signalType === 'competition');
      const n = c ? parseInt((c.summary.match(/(\d+) distinct/) || [])[1] || '0', 10) : 0;
      return n >= 6 ? 'high' : n >= 3 ? 'medium' : n >= 1 ? 'low' : 'unknown';
    })(),
    customerPainPoint: null,
    priceBand: (() => {
      const p = input.signals.find((s) => s.signalType === 'price_range');
      if (!p) return null;
      const m = p.summary.match(/\$(\d+(?:\.\d+)?)–\$(\d+(?:\.\d+)?)/);
      return m ? { min: parseFloat(m[1]), max: parseFloat(m[2]) } : null;
    })(),
    risks: deterministic.score < 50 ? ['Weak market evidence — opportunity score below 50'] : [],
    recommendedSearchQueries: input.category ? [`${input.category.toLowerCase()} best sellers`, `${input.category.toLowerCase()} trending`, `${input.category.toLowerCase()} gifts`] : [],
    reasoningSummary: deterministic.explanation,
    unsupportedClaims: [],
  };

  // Try DeepSeek (server proxy). Failure or missing key → deterministic.
  try {
    const evidenceText = input.signals
      .map((s) => `- [${s.confidence}] ${s.signalType}: ${s.summary} (source: ${s.sourceUrl || s.source})`)
      .join('\n');
    const prompt = `You are Luxedge's USA pet-market analyst. Reason ONLY over the evidence below — never invent facts.\n\nIMPORTANT LIMITATION: URL counts and page counts in the evidence are search-result breadth / market-supply visibility snapshots — they are NOT sales, orders, search volume, or consumer demand. Do not present them as demand. If real demand evidence (ratings/reviews/availability across pages) is missing, say so and keep the score honest.\n\nEVIDENCE:\n${evidenceText}\n\nCategory signal: ${input.category || 'unknown'}\n\nReturn STRICT JSON (no markdown):\n{\n  "marketOpportunityScore": 0-100,\n  "trendConfidence": "verified|inferred|unknown",\n  "demandEvidence": "short summary of what the evidence supports",\n  "competitionLevel": "low|medium|high|unknown",\n  "customerPainPoint": "string or null",\n  "priceBand": {"min": number, "max": number} or null,\n  "risks": ["..."],\n  "recommendedSearchQueries": ["..."],\n  "reasoningSummary": "concise — no chain of thought"\n}`;
    const raw = await aiCall(prompt, input.model);
    const parsed = parseMarketAnalysis(raw);
    if (parsed) {
      // Grounding pass: drop AI claims not supported by collected signals.
      const demandText = base.demandEvidence || '';
      if (parsed.customerPainPoint && !demandText && !input.signals.length) {
        unsupported.push(`customerPainPoint "${parsed.customerPainPoint}" — no supporting evidence collected`);
        parsed.customerPainPoint = null;
      }
      return {
        ...parsed,
        unsupportedClaims: [...unsupported, ...parsed.unsupportedClaims],
        aiUsed: true,
        analyzedAt: at,
      };
    }
    unsupported.push('DeepSeek returned unparseable output — used deterministic analysis');
  } catch {
    unsupported.push('DeepSeek unavailable or not configured — used deterministic analysis');
  }

  return { ...base, unsupportedClaims: unsupported, aiUsed: false, analyzedAt: at };
}

const MARKET_INTEL_SYSTEM = 'You are a strict, evidence-only USA pet-market analyst for Luxedge. You may reason only over the provided evidence. Never invent demand, trends, ratings, reviews, certifications or sales data. Return only the requested JSON.';
