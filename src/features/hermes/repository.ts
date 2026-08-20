// ============================================================================
// LUXEDGE — HERMES RESEARCH REPOSITORY (browser/admin side)
//
// CRUD for the migration-0012 tables through the existing DbAdapter
// (src/services/db.ts). Writes flow through the signed-in ADMIN JWT
// (setDbToken) so RLS governs every mutation. All data here is RESEARCH
// EVIDENCE: reading/reviewing it can never create, publish, or modify a
// Luxedge product — that requires Luxedge's own pipeline + owner action.
//
// Tables: hermes_recommendations, hermes_seo_suggestions,
//         hermes_marketing_intel, ads_readiness
// ============================================================================

import { getDb } from '../../services/db';
import { setDbToken as catalogSetDbToken, uid } from '../catalog/repository';
import type {
  AdsReadinessRow,
  HermesMarketingIntelRow,
  HermesRecommendationRow,
  HermesRecommendationStatus,
  HermesSeoSuggestionRow,
  HermesSeoStatus,
} from './types';

export { uid };

/** Point the shared db adapter at the signed-in user's JWT (admin). */
export function setDbToken(token: string | null): void {
  catalogSetDbToken(token);
}

const T = {
  recs: 'hermes_recommendations',
  seo: 'hermes_seo_suggestions',
  intel: 'hermes_marketing_intel',
  ads: 'ads_readiness',
} as const;

// ---------------------------------------------------------------------------
// Reads (admin review feeds)
// ---------------------------------------------------------------------------

export async function listRecommendations(limit = 100): Promise<HermesRecommendationRow[]> {
  try {
    const rows = await getDb().list<HermesRecommendationRow>(T.recs, { orderBy: 'created_at.desc', limit });
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export async function listSeoSuggestions(limit = 100): Promise<HermesSeoSuggestionRow[]> {
  try {
    const rows = await getDb().list<HermesSeoSuggestionRow>(T.seo, { orderBy: 'created_at.desc', limit });
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export async function listMarketingIntel(limit = 100): Promise<HermesMarketingIntelRow[]> {
  try {
    const rows = await getDb().list<HermesMarketingIntelRow>(T.intel, { orderBy: 'created_at.desc', limit });
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export async function listAdsReadiness(limit = 100): Promise<AdsReadinessRow[]> {
  try {
    const rows = await getDb().list<AdsReadinessRow>(T.ads, { orderBy: 'created_at.desc', limit });
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Inserts (research evidence only)
// ---------------------------------------------------------------------------

export async function insertRecommendation(row: HermesRecommendationRow): Promise<HermesRecommendationRow> {
  return getDb().insert(T.recs, row);
}

export async function insertSeoSuggestion(row: HermesSeoSuggestionRow): Promise<HermesSeoSuggestionRow> {
  return getDb().insert(T.seo, row);
}

export async function insertMarketingIntel(row: HermesMarketingIntelRow): Promise<HermesMarketingIntelRow> {
  return getDb().insert(T.intel, row);
}

export async function insertAdsReadiness(row: AdsReadinessRow): Promise<AdsReadinessRow> {
  return getDb().insert(T.ads, row);
}

// ---------------------------------------------------------------------------
// Updates (admin review lifecycle — Luxedge decides)
// ---------------------------------------------------------------------------

export async function updateRecommendation(
  id: string,
  patch: Partial<Pick<HermesRecommendationRow, 'status' | 'review_note' | 'luxedge_score' | 'validation'>>,
): Promise<HermesRecommendationRow | null> {
  return getDb().update<HermesRecommendationRow>(T.recs, id, { ...patch, updated_at: new Date().toISOString() });
}

export async function updateSeoSuggestion(
  id: string,
  patch: Partial<Pick<HermesSeoSuggestionRow, 'status' | 'review_note'>>,
): Promise<HermesSeoSuggestionRow | null> {
  return getDb().update<HermesSeoSuggestionRow>(T.seo, id, { ...patch, updated_at: new Date().toISOString() });
}

export async function updateMarketingIntel(
  id: string,
  patch: Partial<Pick<HermesMarketingIntelRow, 'status'>>,
): Promise<HermesMarketingIntelRow | null> {
  return getDb().update<HermesMarketingIntelRow>(T.intel, id, { ...patch, updated_at: new Date().toISOString() });
}

export const RECOMMENDATION_STATUSES: HermesRecommendationStatus[] = ['new', 'reviewed', 'accepted', 'rejected', 'imported'];
export const SEO_STATUSES: HermesSeoStatus[] = ['new', 'reviewed', 'accepted', 'rejected', 'implemented'];

// ---------------------------------------------------------------------------
// Deletes (admin review only; nothing here touches product tables)
// ---------------------------------------------------------------------------

export async function deleteRecommendation(id: string): Promise<void> {
  await getDb().remove(T.recs, id);
}

export async function deleteSeoSuggestion(id: string): Promise<void> {
  await getDb().remove(T.seo, id);
}

export async function deleteMarketingIntel(id: string): Promise<void> {
  await getDb().remove(T.intel, id);
}

/** Remove an ads-readiness assessment row (keeps history if omitted). */
export async function deleteAdsReadiness(id: string): Promise<void> {
  await getDb().remove(T.ads, id);
}
