// ============================================================================
// LUXEDGE V2 — MARKET-PAGE PRODUCT IDENTITY (Phase 4G §C)
//
// A PRODUCT FAMILY is not automatically the SAME exact product. Review and
// rating evidence from different retailer pages may only be treated as the
// SAME product when exact identity is sufficiently verified (shared GTIN/UPC,
// shared MPN, or brand + exact model/SKU). Title similarity alone is a
// CONCEPT match — not exact product identity.
//
// identityMatch levels:
//   exact   — shared non-null UPC/GTIN, or shared non-null MPN, or
//             same brand AND same exact model, or same brand AND same SKU.
//   concept — no exact match, but normalized title tokens overlap strongly
//             (>= 0.5 Jaccard) — same product concept, NOT proven identical.
//   unknown — no usable identity evidence.
//
// REVIEW AGGREGATION RULE (§4): never sum review counts across pages and
// imply they are the same product unless exact identity is verified. For
// multiple different products within one concept, report "X market PDPs
// carried review evidence" — do NOT silently aggregate them as one product's
// review count.
// ============================================================================

import type { PageExtract } from './types';
import { conceptTokens, tokenSetSimilarity } from './cjSeedDiscovery';

/** Explicit market-page identity evidence (observable only; unknown = null). */
export interface PageIdentityEvidence {
  brand: string | null;
  model: string | null;
  /** Manufacturer part number. */
  mpn: string | null;
  sku: string | null;
  /** UPC / GTIN (12–14 digit code when observable). */
  upc: string | null;
  /** Canonical normalized title (concept-level evidence, not exact identity). */
  canonicalTitle: string | null;
}

export type IdentityMatchLevel = 'exact' | 'concept' | 'unknown';

/** Map a PageExtract into explicit identity evidence (unknown fields null). */
export function identityEvidenceFromExtract(e: PageExtract): PageIdentityEvidence {
  return {
    brand: e.brand ?? null,
    model: e.model ?? null,
    mpn: e.mpn ?? null,
    sku: e.sku ?? null,
    upc: e.upc ?? null,
    canonicalTitle: e.title ?? null,
  };
}

/** True when the page carries at least one explicit identity field. */
export function hasExplicitIdentity(e: PageIdentityEvidence): boolean {
  return Boolean(e.brand || e.model || e.mpn || e.sku || e.upc);
}

/** Same non-empty string, case-insensitive and whitespace-collapsed. */
function sameCode(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Identity match level between two market-page identities.
 * EXACT requires a strong identity code match (GTIN/UPC, MPN, or brand+model
 * / brand+SKU). Title-only similarity is NEVER exact — it is a concept match.
 */
export function identityMatchLevel(a: PageIdentityEvidence, b: PageIdentityEvidence): IdentityMatchLevel {
  // Exact: shared GTIN/UPC.
  if (sameCode(a.upc, b.upc)) return 'exact';
  // Exact: shared manufacturer part number.
  if (sameCode(a.mpn, b.mpn)) return 'exact';
  // Exact: same brand AND same exact model.
  if (sameCode(a.brand, b.brand) && sameCode(a.model, b.model) && a.model) return 'exact';
  // Exact: same brand AND same SKU.
  if (sameCode(a.brand, b.brand) && sameCode(a.sku, b.sku) && a.sku) return 'exact';

  // Concept: strong normalized-title overlap — SAME CONCEPT, NOT exact.
  if (a.canonicalTitle && b.canonicalTitle) {
    const ta = conceptTokens(a.canonicalTitle);
    const tb = conceptTokens(b.canonicalTitle);
    if (ta.length && tb.length && tokenSetSimilarity(ta, tb) >= 0.5) return 'concept';
  }
  return 'unknown';
}

export interface ReviewAggregationReport {
  /** Market PDPs that carried review/rating evidence (NOT summed across identities). */
  pagesWithReviewEvidence: number;
  /** Distinct exact-identity groups among those pages (only when evidence allowed). */
  exactIdentityGroups: number;
  /** Pages whose identity could not be proven exact (concept/unknown). */
  conceptOnlyPages: number;
  /** The honest statement to persist — never a silently-aggregated single count. */
  note: string;
}

/**
 * Aggregate review evidence across market PDPs WITHOUT implying they are the
 * same product. Reports how many pages carried review evidence; sums are only
 * meaningful within an exact-identity group (and even then, retailer-reported
 * counts are not Luxedge reviews — they are market observation).
 */
export function aggregateReviewEvidence(pages: PageIdentityEvidence[]): ReviewAggregationReport {
  const withReviews = pages.filter((p) => p.canonicalTitle);
  const pagesWithReviewEvidence = withReviews.length;

  // Group into exact-identity clusters (only pages with explicit identity).
  const explicit = pages.filter((p) => hasExplicitIdentity(p));
  const groups: PageIdentityEvidence[][] = [];
  for (const p of explicit) {
    let placed = false;
    for (const g of groups) {
      if (identityMatchLevel(p, g[0]) === 'exact') {
        g.push(p);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push([p]);
  }
  const exactIdentityGroups = groups.length;
  const conceptOnlyPages = pages.filter((p) => !hasExplicitIdentity(p)).length;

  const note = pagesWithReviewEvidence
    ? `${pagesWithReviewEvidence} market PDPs carried review/rating evidence — counts are NOT summed across products unless exact identity (GTIN/UPC/MPN/brand+model) was verified; ${exactIdentityGroups} exact-identity group(s) and ${conceptOnlyPages} concept/unknown page(s). These are retailer-observed counts, never Luxedge reviews.`
    : 'No market pages carried review/rating evidence.';

  return { pagesWithReviewEvidence, exactIdentityGroups, conceptOnlyPages, note };
}
