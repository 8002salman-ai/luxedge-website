// ============================================================================
// LUXEDGE V2 — SALMAN OS ADAPTER · TYPES (server + client-shared shapes)
//
// Aligned to the FROZEN Salman OS contract v1.0 (vendored at
// docs/SALMAN_OS_LUXEDGE_AI_CONTRACT.md). Endpoint paths and module ids are
// frozen — nothing here is invented. The backend is Luxedge's PRIMARY AI
// intelligence source; until SALMAN_OS_BASE_URL + SALMAN_OS_TOKEN are
// configured (server env) AND the live handshake succeeds, the adapter
// reports WAITING / OFFLINE and the UI shows "AI BACKEND — WAITING FOR
// SALMAN OS". Commerce never depends on this.
//
// Security rule (server-to-server): credentials live ONLY in the Luxedge
// server environment (SALMAN_OS_BASE_URL / SALMAN_OS_TOKEN). Nothing here is
// ever shipped to the browser.
// ============================================================================

/** Overall AI-backend connection state, as reported by the SERVER only. */
export type SalmanOsConnectionState =
  | 'CONNECTED'      // env configured + live handshake succeeded (project registered, contract version matches)
  | 'OFFLINE'        // env configured but backend unreachable / project unregistered / contract mismatch
  | 'WAITING';       // server env (base URL / token) not yet in place

/** Stable project metadata Luxedge sends/exposes for Salman OS. */
export interface SalmanOsProjectInfo {
  project: 'luxedge';
  environment: 'PREVIEW' | 'PRODUCTION';
  freeFirst: boolean;
}

/**
 * Live Salman OS routing state. Values are authoritative from Salman OS —
 * never fabricated locally. All fields optional because the backend may
 * expose a subset; absent = unknown and the UI shows "—".
 */
export interface SalmanOsLiveState {
  /** Bridge / Hermes agent state as reported by the backend. */
  bridge?: string;
  /** Scheduler state ('ENABLED' | 'DISABLED'). */
  scheduler?: string;
  /** Default free model (backend router.current_free_model). */
  freeModel?: string | null;
  /** Default/current free model per the backend router registry. */
  defaultModel?: string;
  /** Model chosen at dispatch — only when the backend reports it. */
  currentTaskModel?: string | null;
  /** Model recorded on the last completed result (authoritative). */
  lastTaskModel?: string | null;
  costClass?: 'FREE' | 'PAID' | 'UNKNOWN';
  fallbackUsed?: boolean;
  /** Fallback reason from the stored result envelope. */
  fallbackReason?: string | null;
  /** Last research completion timestamp. */
  lastSync?: string | null;
  latestError?: string | null;
  /** Module ids currently paused (backend module registry ids). */
  pausedModules?: string[];
}

/** Safe status payload returned to the admin UI. */
export interface SalmanOsStatus {
  state: SalmanOsConnectionState;
  project: SalmanOsProjectInfo;
  reason: string;
  live: SalmanOsLiveState | null;
  /** Contract version this adapter targets (backend CONTRACT_VERSION = 1). */
  contractVersion: number;
  checkedAt: string;
}

// ---------------------------------------------------------------------------
// Frozen module ids (Salman OS contract §4 + AI_MODULES registry)
// ---------------------------------------------------------------------------

export type SalmanOsJobKind =
  | 'PRODUCT_RESEARCH'
  | 'SEO'
  | 'FREE_MARKETING'
  | 'FREE_LISTINGS'
  | 'MARKET_RESEARCH'
  | 'MARKETING_IDEAS'
  | 'ADS_INTELLIGENCE'
  | 'CATALOG_QA';

/** Internal kind → frozen Salman OS module id (contract §4). Shared so the
 *  browser can render module ids without importing the server adapter. */
export const SALMAN_OS_MODULE_IDS: Record<SalmanOsJobKind, string> = {
  PRODUCT_RESEARCH: 'product_research',
  SEO: 'seo_research',
  FREE_MARKETING: 'free_marketing',
  FREE_LISTINGS: 'free_listing_opportunities',
  MARKET_RESEARCH: 'market_research',
  MARKETING_IDEAS: 'marketing_research',
  ADS_INTELLIGENCE: 'ads_intelligence',
  CATALOG_QA: 'catalog_quality_review',
};

/** Frozen module id → internal kind (reverse lookup). */
export const SALMAN_OS_KIND_BY_MODULE: Record<string, SalmanOsJobKind> = Object.fromEntries(
  Object.entries(SALMAN_OS_MODULE_IDS).map(([kind, moduleId]) => [moduleId, kind as SalmanOsJobKind]),
);

/** Hermes task_type → internal kind (backend module registry taskType). */
export const SALMAN_OS_TASK_TYPE_TO_KIND: Record<string, SalmanOsJobKind> = {
  product_discovery: 'PRODUCT_RESEARCH',
  seo_research: 'SEO',
  marketing_research: 'FREE_MARKETING',
  free_listing_opportunities: 'FREE_LISTINGS',
  market_research: 'MARKET_RESEARCH',
  content_research: 'MARKETING_IDEAS',
  ads_research: 'ADS_INTELLIGENCE',
  catalog_quality_review: 'CATALOG_QA',
};

// ---------------------------------------------------------------------------
// Intelligence items (Phase J)
// ---------------------------------------------------------------------------

export type SalmanOsIntelligenceKind =
  | 'PRODUCT'
  | 'SEO'
  | 'FREE_MARKETING'
  | 'FREE_LISTINGS'
  | 'MARKET'
  | 'MARKETING'
  | 'ADS'
  | 'CATALOG_QA';

export interface SalmanOsIntelligenceItem {
  id: string;
  kind: SalmanOsIntelligenceKind;
  /** Actual model that produced this item (from Salman OS). */
  model?: string | null;
  provider?: string | null;
  costClass?: 'FREE' | 'PAID' | 'UNKNOWN';
  fallbackUsed?: boolean;
  evidence: string[];
  inference: string;
  unknowns: string[];
  confidence?: number | null;
  risk?: string | null;
  sources: string[];
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Jobs (Phase I)
// ---------------------------------------------------------------------------

export type SalmanOsJobStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'PAUSED';

export interface SalmanOsJob {
  id: string;
  kind: SalmanOsJobKind;
  status: SalmanOsJobStatus;
  model?: string | null;
  costClass?: 'FREE' | 'PAID' | 'UNKNOWN';
  fallbackUsed?: boolean;
  createdAt: string;
  completedAt?: string | null;
  error?: string | null;
}

export interface SalmanOsJobRunResult {
  ok: boolean;
  job: SalmanOsJob | null;
  error?: string | null;
  /** true when the router paused the job (FREE unavailable, non-critical) — NOT a failure. */
  paused?: boolean;
  /** Router reason, e.g. "PAUSED — FREE MODEL UNAVAILABLE". */
  reason?: string | null;
}

export interface SalmanOsJobToggleResult {
  ok: boolean;
  job: SalmanOsJob | null;
  error?: string | null;
}
