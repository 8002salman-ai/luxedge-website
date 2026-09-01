// ============================================================================
// LUXEDGE — PRODUCT MARKET INTELLIGENCE ENGINE (types)
//
// PET-ONLY product-validation engine. Comparable in PURPOSE to Jungle Scout
// but built on free/official/current data sources with honest provenance —
// never fabricated sales estimates, never claimed proprietary data we lack.
// ============================================================================

/** Honest status for every research source — never silently faked. */
export type SourceStatus =
  | 'AVAILABLE'
  | 'FAILED'
  | 'NOT_CONFIGURED'
  | 'LOGIN_REQUIRED'
  | 'LIMIT_REACHED'
  | 'PAID_FEATURE'
  | 'DISABLED'
  | 'SKIPPED';

/** Normalized Google Trends direction (trend score input). */
export type TrendDirection =
  | 'STRONGLY_RISING'
  | 'RISING'
  | 'STABLE'
  | 'SEASONAL'
  | 'DECLINING'
  | 'INSUFFICIENT_DATA';

export interface TrendEvidence {
  status: SourceStatus;
  keyword: string;
  country?: string;
  period?: string;
  direction: TrendDirection;
  /** 0..100 trend score — only from verified data, never invented. */
  score: number | null;
  relatedQueries?: string[];
  risingQueries?: string[];
  note?: string;
  source?: 'official_api' | 'bigquery' | 'hermes_browser' | 'unavailable';
}

export interface AmazonPublicEvidence {
  status: SourceStatus;
  bestSellersRank?: number | null;
  category?: string;
  priceRange?: { min: number | null; max: number | null };
  reviewCount?: number | null;
  rating?: number | null;
  velocity?: 'rising' | 'stable' | 'declining' | null;
  sourcePages: string[];
  note?: string;
}

export interface AmazonOpportunityEvidence {
  status: SourceStatus;
  searchVolume?: number | null;
  searchGrowth?: string | null;
  nicheSaturation?: 'low' | 'medium' | 'high' | null;
  unmetDemand?: boolean | null;
  note?: string;
}

export interface EbayMarketEvidence {
  status: SourceStatus;
  activeListings?: number | null;
  soldQuantity?: number | null;
  watchers?: number | null;
  competitorCount?: number | null;
  avgSoldPrice?: number | null;
  priceRange?: { min: number | null; max: number | null };
  note?: string;
}

export interface SupplierEconomicsEvidence {
  status: SourceStatus;
  supplierName?: string | null;
  unitCost?: number | null;
  shippingCost?: number | null;
  landedCost?: number | null;
  moq?: number | null;
  usaWarehouse?: boolean | null;
  deliveryDays?: { min: number | null; max: number | null };
  note?: string;
}

/** Provenance — stored with every research result so AI never presents guesses as facts. */
export interface ResearchProvenance {
  researchDate: string;
  keyword: string;
  queries: string[];
  aiProvider: string | null;
  trend: TrendEvidence;
  amazonOpportunity: AmazonOpportunityEvidence;
  amazonPublic: AmazonPublicEvidence;
  ebay: EbayMarketEvidence;
  supplier: SupplierEconomicsEvidence;
  confidence: number;
  finalScore: number;
}

export interface ProfitEconomics {
  landedCost: number | null;
  targetSellingPrice: number | null;
  expectedNetProfit: number | null;
  marginPct: number | null;
  roiPct: number | null;
}

export interface OpportunityBreakdown {
  trend: number;            // 15
  amazonDemand: number;     // 20
  ebayDemand: number;       // 20
  competition: number;      // 10
  supplier: number;         // 10
  profit: number;           // 15
  shipping: number;         // 5
  safety: number;           // 5
  max: number;              // 100
  covered: number;          // how many components had real data
  components: number;       // how many components exist (8)
}

export type Verdict = 'STRONG BUY' | 'BUY TEST' | 'TEST SMALL' | 'WATCH' | 'SKIP' | 'HIGH RISK';

export interface VerdictDetail {
  verdict: Verdict;
  recommendedTestQuantity: number | null;
  expectedInvestment: number | null;
  note: string;
}

export interface ProductOpportunityResult {
  keyword: string;
  opportunityScore: number;      // /100
  confidence: number;            // /100 — separate, honest
  breakdown: OpportunityBreakdown;
  economics: ProfitEconomics;
  verdict: VerdictDetail;
  provenance: ResearchProvenance;
  /** Whether any provider failed — result may be PARTIAL but system stays functional. */
  partial: boolean;
}

/** Trending pet product family (merged/deduped across sources). */
export interface TrendingPetProduct {
  keyword: string;
  aliases: string[];
  sources: string[];
  trendDirection: TrendDirection;
  trendScore: number | null;
  opportunityScore: number | null;
  confidence: number | null;
  verdict: Verdict | null;
}
