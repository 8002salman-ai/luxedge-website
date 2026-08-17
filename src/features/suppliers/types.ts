// ============================================================================
// LUXEDGE V2 — SUPPLIER DISCOVERY ADAPTERS (Phase 4C)
//
// Provider-neutral interface so Product Scout never hardwires to one
// supplier. Initial adapter: CJ Dropshipping V2 API. Future adapters
// (other approved suppliers) implement the same interface without touching
// the scout pipeline.
//
// HONESTY CONTRACT: normalized records carry VERIFIED / INFERRED / UNKNOWN
// statuses per field. Nothing is invented — if the supplier API does not
// provide a field it stays UNKNOWN. "US inventory verified" and "USA
// delivery verified" are DISTINCT facts and must never be conflated.
//
// SECURITY: this module is browser-safe. It never holds credentials — the
// browser adapter talks to the Luxedge server proxy (/api/suppliers/*) with
// the admin JWT; the server holds the supplier secrets and calls the
// supplier API. No supplier key ever reaches the browser.
// ============================================================================

/** Which supplier provider a record/adapter belongs to. */
export type SupplierProviderId = 'cj';

export type SupplierHealth =
  | 'configured'      // credentials present in server env
  | 'online'          // health probe succeeded
  | 'rate_limited'    // throttled by the supplier API
  | 'offline'         // provider error / unreachable
  | 'not_configured'; // no server-side credentials

/** Evidence status for a single observed fact (same contract as the scout). */
export type SupplierEvidenceStatus = 'verified' | 'inferred' | 'unknown';

export interface SupplierEvidenceField<T> {
  status: SupplierEvidenceStatus;
  value: T;
  source?: string;
  note?: string;
}

/**
 * One normalized supplier product record (supplier-API source of truth).
 * Fields CJ does not return stay UNKNOWN/NULL — never invented.
 */
export interface SupplierProductRecord {
  provider: SupplierProviderId;
  /** Supplier's stable product identifier (CJ pid). */
  productId: string;
  /** Supplier SKU / SPU code (stable across repeated searches). */
  sku: string;
  /**
   * The ONE internally-consistent variant selected for this candidate
   * (Phase 4C pre-live hardening). When null, the record is list-level only:
   * variant UNKNOWN → no freight quote, no high-confidence margin.
   */
  selectedVariant: SupplierVariantEvidence | null;
  title: string;
  imageUrl: string | null;
  images: string[];
  /** Supplier cost (sell price) — VERIFIED when the API returns it. */
  sellPrice: number | null;
  category: string | null;
  weightGrams: number | null;
  /** US inventory (countryCode=US): verified vs total. */
  usInventoryVerified: number | null;
  usInventoryTotal: number | null;
  /** True only when the API reports verified inventory in the US. */
  usInventoryInCountry: boolean;
  /** Warehouse evidence (e.g. "US Warehouse") when the API provides it. */
  warehouse: string | null;
  freeShipping: boolean;
  /** Delivery cycle from the supplier (e.g. "3-5" days) — VERIFIED only. */
  deliveryCycle: string | null;
  listedNum: number | null;
  supplierName: string | null;
  description: string | null;
  /** Stable source URL (CJ product page). */
  sourceUrl: string;
  observedAt: string;
  raw: Record<string, unknown>;
}

/**
 * The explicitly selected variant. THE SAME variant drives variantId,
 * variant SKU, variant price, weight, dimensions, US inventory,
 * verifiedWarehouse, the freight quote and the landed cost — they can never
 * come from different variants (Phase 4C hardening).
 */
export interface SupplierVariantEvidence {
  variantId: string;
  sku: string;
  sellPrice: number | null;
  weightGrams: number | null;
  dimensions: string | null;
  usInventoryVerified: number | null;
  usInventoryTotal: number | null;
  usInventoryInCountry: boolean;
  verifiedWarehouse: boolean;
  /** Origin country derived from inventory/warehouse evidence (e.g. "US"/"CN"). */
  originCountry: string | null;
  raw: Record<string, unknown>;
}

/**
 * USA delivery evidence — never conflated with US inventory. Enriched with
 * the REAL usable total (totalPostageFee preferred), origin/destination and
 * fee breakdown so landed cost never silently ignores applicable fees.
 */
export interface SupplierShippingEvidence {
  /** Usable total freight — totalPostageFee when returned, else logisticPrice. */
  costUsd: number | null;
  /** Base freight (logisticPrice) — the headline figure only. */
  baseFreightUsd: number | null;
  taxesFeeUsd: number | null;
  clearanceFeeUsd: number | null;
  tariffUsd: number | null;
  arrivalDays: string | null;
  carrier: string | null;
  origin: string | null;
  destination: string | null;
  observedAt: string;
  verified: boolean;
  note: string;
}

export interface SupplierSearchOptions {
  query: string;
  /** Target market, e.g. "US" / "USA". */
  market?: string;
  maxResults?: number;
  /**
   * Optional explicit strategy cost filters. These are NOT universal hard
   * rejects — they apply ONLY when supplied for a specific search strategy.
   */
  minSupplierCost?: number;
  maxSupplierCost?: number;
  /**
   * Hard per-run CJ point budget (Phase 4C hardening). Defaults to the
   * owner-configured CJ_POINTS_BUDGET_PER_RUN (250). AI can never raise it —
   * only the owner may supply a different value.
   */
  pointsBudget?: number;
}

export interface SupplierSearchResult {
  records: SupplierProductRecord[];
  health: SupplierHealth;
  warning?: string;
  /** Estimated/actual CJ points consumed by the search call, when known. */
  points?: number;
}

export interface SupplierHealthResult {
  provider: SupplierProviderId;
  health: SupplierHealth;
  detail?: string;
}

/**
 * Provider-neutral discovery adapter. The scout consumes ONLY this
 * interface — swapping CJ for another supplier never changes the pipeline.
 */
export interface SupplierDiscoveryAdapter {
  readonly provider: SupplierProviderId;
  searchProducts(opts: SupplierSearchOptions): Promise<SupplierSearchResult>;
  getProduct(productId: string, market?: string): Promise<SupplierProductRecord | null>;
  getShippingEvidence(
    productId: string,
    variantId: string,
    opts?: { market?: string; originCountry?: string | null }
  ): Promise<SupplierShippingEvidence>;
  healthCheck(): Promise<SupplierHealthResult>;
}
