// ============================================================================
// LUXEDGE V2 — SALMAN OS ADAPTER · TYPES (server + client-shared shapes)
//
// The Salman OS / SoSAi backend is Luxedge's PRIMARY AI intelligence source.
// Its endpoint contract is being finalized in parallel and will live in
// SALMAN_OS_LUXEDGE_AI_CONTRACT.md. Until that file exists AND the backend
// answers with matching fields, this adapter reports WAITING — it never
// invents paths, response fields, or model state.
//
// Security rule (server-to-server): credentials live ONLY in the Luxedge
// server environment (SALMAN_OS_BASE_URL / SALMAN_OS_TOKEN). Nothing here is
// ever shipped to the browser.
// ============================================================================

/** Overall AI-backend connection state, as reported by the SERVER only. */
export type SalmanOsConnectionState =
  | 'CONNECTED'   // contract present + env configured + live probe succeeded
  | 'OFFLINE'     // contract present + env configured but backend unreachable
  | 'WAITING';    // contract and/or credentials not yet in place

/** Stable project metadata Luxedge sends/exposes for Salman OS. */
export interface SalmanOsProjectInfo {
  project: 'luxedge';
  environment: 'PREVIEW' | 'PRODUCTION';
  freeFirst: boolean;
}

/**
 * Live Salman OS routing state. Values are authoritative from Salman OS —
 * never fabricated locally. All fields optional because the finalized
 * contract may expose a subset; absent = unknown.
 */
export interface SalmanOsLiveState {
  bridge?: string;
  scheduler?: string;
  freeModel?: string | null;
  defaultModel?: string;
  currentTaskModel?: string;
  lastTaskModel?: string;
  costClass?: 'FREE' | 'PAID' | 'UNKNOWN';
  fallbackUsed?: boolean;
  lastSync?: string | null;
  latestError?: string | null;
}

/** Safe status payload returned to the admin UI. */
export interface SalmanOsStatus {
  state: SalmanOsConnectionState;
  project: SalmanOsProjectInfo;
  reason: string;
  live: SalmanOsLiveState | null;
  checkedAt: string;
}

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

export type SalmanOsJobKind =
  | 'PRODUCT_RESEARCH'
  | 'SEO'
  | 'FREE_MARKETING'
  | 'FREE_LISTINGS'
  | 'MARKET_RESEARCH'
  | 'MARKETING_IDEAS'
  | 'ADS_INTELLIGENCE'
  | 'CATALOG_QA';

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
}

export interface SalmanOsJobToggleResult {
  ok: boolean;
  job: SalmanOsJob | null;
  error?: string | null;
}
