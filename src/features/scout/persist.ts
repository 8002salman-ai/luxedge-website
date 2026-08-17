// ============================================================================
// LUXEDGE V2 — SCOUT PERSISTENCE (Phase 4A)
//
// Writes scout records to Supabase through the db adapter using the ADMIN's
// own JWT (set via setAccessToken). RLS grants admin full access to the
// scout tables and denies anon/customer writes, so persisting here never
// bypasses authorization. No service-role key is ever used client-side.
//
// Honesty: evidence jsonb stores VERIFIED/INFERRED/UNKNOWN statuses; nothing
// is fabricated. The product draft is written with status 'draft' only —
// publishing requires explicit owner approval later.
// ============================================================================

import type { DbAdapter } from '../../services/db';
import type { ScoutCandidate, ScoutSupplier, ScoreBreakdown, CandidateEvidence } from './types';
import { canonicalDomain } from './normalize';

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function now(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export interface SupplierRow {
  id: string;
  name: string;
  slug: string;
  base_url: string;
  api_configured: boolean;
  is_active: boolean;
  notes: string;
  created_at: string;
  updated_at: string;
}

/** Find a supplier by canonical domain, then slug, then name — else create it. */
export async function ensureSupplier(db: DbAdapter, s: { name: string; slug: string; baseUrl: string }): Promise<ScoutSupplier> {
  // 1) Canonical-domain match (preferred): www.kongcompany.com and
  //    kongcompany.com are the SAME supplier — never split them.
  const wantDomain = canonicalDomain(s.baseUrl);
  if (wantDomain) {
    const byDomain = await db.findFirst<SupplierRow>('suppliers', 'base_url', s.baseUrl);
    if (!byDomain) {
      // base_url may store the www form or not; match on the canonical domain.
      const all = await db.list<SupplierRow>('suppliers');
      const hit = (Array.isArray(all) ? all : []).find((r) => canonicalDomain(r.base_url || '') === wantDomain);
      if (hit) return { id: hit.id, name: hit.name, slug: hit.slug, baseUrl: hit.base_url };
    } else {
      return { id: byDomain.id, name: byDomain.name, slug: byDomain.slug, baseUrl: byDomain.base_url };
    }
  }
  // 2) Slug match (legacy behavior)
  const existing = await db.findFirst<SupplierRow>('suppliers', 'slug', s.slug);
  if (existing) {
    return { id: existing.id, name: existing.name, slug: existing.slug, baseUrl: existing.base_url };
  }
  // 3) Name match (case-insensitive) — same real supplier under a different slug
  const all = await db.list<SupplierRow>('suppliers');
  const byName = (Array.isArray(all) ? all : []).find(
    (r) => r.name.trim().toLowerCase() === s.name.trim().toLowerCase()
  );
  if (byName) return { id: byName.id, name: byName.name, slug: byName.slug, baseUrl: byName.base_url };

  const t = now();
  const row: SupplierRow = {
    id: newId(),
    name: s.name,
    slug: s.slug,
    base_url: s.baseUrl,
    api_configured: false,
    is_active: true,
    notes: 'Registered by Product Scout (Phase 4A)',
    created_at: t,
    updated_at: t,
  };
  const inserted = await db.insert<SupplierRow>('suppliers', row);
  return { id: inserted.id, name: inserted.name, slug: inserted.slug, baseUrl: inserted.base_url };
}

// ---------------------------------------------------------------------------
// Supplier products + evidence
// ---------------------------------------------------------------------------

export interface SupplierProductRow {
  id: string;
  supplier_id: string;
  supplier_sku: string | null;
  title: string;
  url: string | null;
  images: string[];
  raw_data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** Persist a supplier product with its raw evidence. */
export async function persistSupplierProduct(
  db: DbAdapter,
  input: { supplierId: string; title: string; url: string; images: string[]; raw: Record<string, unknown> }
): Promise<{ id: string; existing: boolean }> {
  const existing = await db.findFirst<SupplierProductRow>('supplier_products', 'url', input.url);
  if (existing) return { id: existing.id, existing: true };
  const t = now();
  const row: SupplierProductRow = {
    id: newId(),
    supplier_id: input.supplierId,
    supplier_sku: null,
    title: input.title,
    url: input.url,
    images: input.images,
    raw_data: input.raw,
    created_at: t,
    updated_at: t,
  };
  const inserted = await db.insert<SupplierProductRow>('supplier_products', row);
  return { id: inserted.id, existing: false };
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

export interface CandidateRow {
  id: string;
  supplier_product_id: string | null;
  title: string;
  source: string;
  source_url: string;
  images: string[];
  evidence: CandidateEvidence;
  status: ScoutCandidate['status'];
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

/** Persist a candidate; skips when the source_url already exists (dedupe). */
export async function persistCandidate(
  db: DbAdapter,
  input: {
    supplierProductId: string | null;
    title: string;
    source: string;
    sourceUrl: string;
    images: string[];
    evidence: CandidateEvidence;
    status: ScoutCandidate['status'];
    rejectionReason?: string;
  }
): Promise<{ id: string; existing: boolean }> {
  const existing = await db.findFirst<CandidateRow>('product_candidates', 'source_url', input.sourceUrl);
  if (existing) return { id: existing.id, existing: true };
  const t = now();
  const row: CandidateRow = {
    id: newId(),
    supplier_product_id: input.supplierProductId,
    title: input.title,
    source: input.source,
    source_url: input.sourceUrl,
    images: input.images,
    evidence: input.evidence,
    status: input.status,
    rejection_reason: input.rejectionReason ?? null,
    created_at: t,
    updated_at: t,
  };
  const inserted = await db.insert<CandidateRow>('product_candidates', row);
  return { id: inserted.id, existing: false };
}

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------

export interface ScoreRow {
  id: string;
  candidate_id: string;
  overall: number;
  explanation: string;
  weights: Record<string, number>;
  breakdown: Record<string, { points: number; max: number; note: string }>;
  scored_at: string;
}

/** Persist a candidate score (one per candidate; latest wins). */
export async function persistScore(db: DbAdapter, candidateId: string, score: ScoreBreakdown): Promise<void> {
  const existing = await db.findFirst<ScoreRow>('product_scores', 'candidate_id', candidateId);
  const row: ScoreRow = {
    id: existing?.id ?? newId(),
    candidate_id: candidateId,
    overall: score.overall,
    explanation: score.explanation,
    weights: score.weights,
    breakdown: score.breakdown,
    scored_at: now(),
  };
  if (existing) {
    await db.update<ScoreRow>('product_scores', existing.id, row);
  } else {
    await db.insert<ScoreRow>('product_scores', row);
  }
}

// ---------------------------------------------------------------------------
// Agent jobs / runs / logs
// ---------------------------------------------------------------------------

export interface AgentJobRow {
  id: string;
  type: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  input: unknown;
  output: unknown;
  error: string | null;
  provider: string | null;
  model: string | null;
  token_cost: Record<string, unknown> | null;
  retries: number;
  max_retries: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export async function createJob(db: DbAdapter, type: string, input: unknown): Promise<string> {
  const row: AgentJobRow = {
    id: newId(),
    type,
    status: 'running',
    input,
    output: null,
    error: null,
    provider: null,
    model: null,
    token_cost: null,
    retries: 0,
    max_retries: 3,
    created_at: now(),
    started_at: now(),
    finished_at: null,
  };
  const inserted = await db.insert<AgentJobRow>('agent_jobs', row);
  return inserted.id;
}

export async function completeJob(
  db: DbAdapter,
  jobId: string,
  status: 'completed' | 'failed',
  output: unknown,
  error?: string
): Promise<void> {
  await db.update<AgentJobRow>('agent_jobs', jobId, {
    status,
    output,
    error: error ?? null,
    finished_at: now(),
  } as Partial<AgentJobRow>);
}

export async function addRun(
  db: DbAdapter,
  jobId: string,
  agent: string,
  status: string,
  summary: string
): Promise<void> {
  await db.insert('agent_runs', {
    id: newId(),
    job_id: jobId,
    agent,
    status,
    summary,
    created_at: now(),
    finished_at: status === 'running' ? null : now(),
  });
}

export async function addLog(db: DbAdapter, jobId: string, level: 'info' | 'warn' | 'error', message: string): Promise<void> {
  await db.insert('agent_logs', {
    id: newId(),
    job_id: jobId,
    level,
    message,
    created_at: now(),
  });
}

// ---------------------------------------------------------------------------
// Product draft (owner-approval gate → status 'draft', never published)
// ---------------------------------------------------------------------------

export interface ProductDraftInput {
  title: string;
  slug: string;
  categoryId: string | null;
  price: number | null;
  compareAtPrice: number | null;
  costPrice: number | null;
  landedCost: number | null;
  grossMargin: number | null;
  images: string[];
  shortDesc: string;
  sourceUrl: string;
  supplierName: string;
  scoreOverall: number | null;
}

const LEGACY_TAX_CODE = 'txcd_99999999';

/**
 * Create a products row (status 'draft') + product_images rows, honoring the
 * reconciled schema's legacy NOT NULL columns (title, description,
 * short_description, tax_code, is_featured, features/benefits/specifications
 * jsonb, inventory_qty). Never sets status='published'.
 */
export async function createProductDraft(db: DbAdapter, input: ProductDraftInput): Promise<{ id: string; existing: boolean }> {
  const existing = await db.findFirst<{ id: string }>('products', 'slug', input.slug);
  if (existing) return { id: existing.id, existing: true };

  const t = now();
  const desc = `${input.shortDesc || input.title} — ${input.supplierName}. Source: ${input.sourceUrl}`;
  const features = input.shortDesc ? [input.shortDesc] : [];
  const product = {
    id: newId(),
    slug: input.slug,
    title: input.title,
    name: input.title,
    description: desc,
    short_description: input.shortDesc || input.title,
    status: 'draft',
    currency: 'USD',
    tax_code: LEGACY_TAX_CODE,
    is_featured: false,
    features,
    benefits: [],
    specifications: {},
    seo_keywords: [],
    brand: input.supplierName,
    price: input.price,
    compare_at_price: input.compareAtPrice,
    cost_price: input.costPrice,
    landed_cost: input.landedCost,
    gross_margin: input.grossMargin,
    inventory_qty: 0,
    category_id: input.categoryId,
    product_source_evidence: {
      sourceUrl: input.sourceUrl,
      supplier: input.supplierName,
      score: input.scoreOverall,
      draftedAt: t,
      status: 'draft',
    },
    created_at: t,
    updated_at: t,
  };
  const inserted = await db.insert<{ id: string } & Record<string, unknown>>('products', product);

  // product_images legacy NOT NULLs: storage_path, public_url, alt_text.
  const imageRows = input.images.map((url, i) => ({
    id: newId(),
    product_id: inserted.id,
    storage_path: url,
    public_url: url,
    url,
    alt_text: input.title,
    kind: 'product',
    is_primary: i === 0,
    sort_order: i,
    created_at: t,
  }));
  for (const row of imageRows) {
    await db.insert('product_images', row);
  }
  return { id: inserted.id, existing: false };
}

/** Resolve a category by exact name; null when it does not exist. */
export async function findCategoryId(db: DbAdapter, name: string): Promise<string | null> {
  const row = await db.findFirst<{ id: string }>('categories', 'name', name);
  return row ? row.id : null;
}

// ---------------------------------------------------------------------------
// Phase 4B — market intelligence persistence
// ---------------------------------------------------------------------------

/** Read the evidence jsonb of a candidate row (defensive about legacy shapes). */
export async function readCandidateEvidence(db: DbAdapter, id: string): Promise<Record<string, unknown> | null> {
  const row = await db.findFirst<{ id: string; evidence: Record<string, unknown> | null }>('product_candidates', 'id', id);
  if (!row) return null;
  return row.evidence && typeof row.evidence === 'object' ? row.evidence : {};
}

/** Merge market-intelligence fields into a candidate's evidence jsonb. */
export async function persistMarketIntelligence(
  db: DbAdapter,
  candidateId: string,
  analysis: { marketOpportunityScore: number; aiUsed: boolean; reasoningSummary: string; unsupportedClaims: string[] }
): Promise<void> {
  const current = (await readCandidateEvidence(db, candidateId)) || {};
  await db.update<{ id: string; evidence: Record<string, unknown> }>('product_candidates', candidateId, {
    evidence: {
      ...current,
      market: {
        marketOpportunityScore: analysis.marketOpportunityScore,
        aiUsed: analysis.aiUsed,
        reasoningSummary: analysis.reasoningSummary.slice(0, 400),
        unsupportedClaims: analysis.unsupportedClaims,
        analyzedAt: new Date().toISOString(),
      },
    },
  });
}
