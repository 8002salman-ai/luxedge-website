// ============================================================================
// LUXEDGE V2 — CJ API POINT BUDGET (Phase 4C pre-live hardening)
//
// Official CJ API V2 point rules (per the current docs):
//   product/listV2           = 50 points / call
//   product/query            = 10 points / call
//   logistic/freightCalculate = 10 points / call
//
// The owner's safe initial policy is a hard per-run budget (default 250).
// The budget is a deterministic business control — AI can never raise it.
// Every paid endpoint is estimated BEFORE the call and denied when the run
// budget would be exceeded. Usage is tracked (list/detail/freight/retries)
// and reported in the job audit record. No secrets here.
// ============================================================================

export type CjPointAction = 'listV2' | 'productQuery' | 'freightCalculate';

export const CJ_POINT_COST: Record<CjPointAction, number> = {
  listV2: 50,
  productQuery: 10,
  freightCalculate: 10,
};

/** Owner-configured safe per-run budget. AI must NOT raise it. */
export const CJ_POINTS_BUDGET_PER_RUN = 250;

/**
 * HARD SERVER MAX per run — the server clamps ANY requested budget to this.
 * A normal browser/scout/AI call may request LESS, but NEVER MORE.
 * Client "owner" flags are not trusted; a future owner-only override must be
 * a separate authenticated server-side policy.
 */
export const CJ_POINTS_HARD_MAX = 250;

export interface CjPointUsage {
  budget: number;
  used: number;
  remaining: number;
  listCalls: number;
  detailCalls: number;
  freightCalls: number;
  retries: number;
  denied: number;
}

/**
 * Per-run CJ point budget tracker. The engine calls `canSpend(action)`
 * before each paid request and `spend(action)` after it succeeds; when a
 * request is denied the engine must NOT call the supplier.
 */
export class CjPointBudget {
  readonly budget: number;
  used = 0;
  listCalls = 0;
  detailCalls = 0;
  freightCalls = 0;
  retries = 0;
  denied = 0;

  constructor(budget: number = CJ_POINTS_BUDGET_PER_RUN) {
    // Clamp: never below the cost of one search (a run must be able to
    // search) and NEVER above the HARD SERVER MAX (250). Client-side
    // forecasting mirrors the server's authoritative clamp.
    const req = Number.isFinite(budget) ? Math.floor(budget) : CJ_POINTS_BUDGET_PER_RUN;
    this.budget = Math.min(Math.max(req, CJ_POINT_COST.listV2), CJ_POINTS_HARD_MAX);
  }

  cost(action: CjPointAction): number {
    return CJ_POINT_COST[action];
  }

  remaining(): number {
    return this.budget - this.used;
  }

  /** Can this action be afforded with the CURRENT remaining budget? */
  canSpend(action: CjPointAction): boolean {
    return this.remaining() >= CJ_POINT_COST[action];
  }

  /**
   * Reserve points for an action. Throws when the budget would be exceeded
   * (so a caller cannot silently exceed the owner's budget). Records a
   * denial counter when blocked.
   */
  spend(action: CjPointAction): boolean {
    if (!this.canSpend(action)) {
      this.denied++;
      return false;
    }
    this.used += CJ_POINT_COST[action];
    if (action === 'listV2') this.listCalls++;
    else if (action === 'productQuery') this.detailCalls++;
    else this.freightCalls++;
    return true;
  }

  /** Record a retry (does not consume points — retries are capped separately). */
  noteRetry(): void {
    this.retries++;
  }

  usage(): CjPointUsage {
    return {
      budget: this.budget,
      used: this.used,
      remaining: this.remaining(),
      listCalls: this.listCalls,
      detailCalls: this.detailCalls,
      freightCalls: this.freightCalls,
      retries: this.retries,
      denied: this.denied,
    };
  }
}

/**
 * Default enrichment caps for a run, derived from the budget:
 *   Stage A (free): filter + rank all list records.
 *   Stage B (paid): product/query for the top N; freight for the top M.
 * N/M adapt to the budget so a run NEVER exceeds it.
 */
export function enrichmentCaps(budget: CjPointBudget = new CjPointBudget()): { detailMax: number; freightMax: number } {
  const afterSearch = budget.budget - CJ_POINT_COST.listV2;
  // Budget 250 → after 50 for the search → 200 → 12 details (120) + 6
  // freight (60) = 230 total ≤ 250. Caps stay within the run budget.
  const detailMax = Math.min(12, Math.max(1, Math.floor(afterSearch / CJ_POINT_COST.productQuery) - 1));
  const freightMax = Math.min(6, Math.max(1, Math.floor((afterSearch - detailMax * CJ_POINT_COST.productQuery) / CJ_POINT_COST.freightCalculate)));
  return { detailMax, freightMax };
}
