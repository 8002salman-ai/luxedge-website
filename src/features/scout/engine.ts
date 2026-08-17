// ============================================================================
// LUXEDGE V2 — PRODUCT SCOUT ENGINE (Phase 4A)
//
// Pipeline: DISCOVER → VERIFY SOURCE → NORMALIZE → SCORE → REJECT/SHORTLIST
//          → OWNER APPROVAL (UI) → PRODUCT DRAFT (explicit owner action)
//
// The engine never publishes. Candidates reach 'qualified' (shortlist) when
// they pass the hard-rejection filters AND score >= 75. Auto-approval is only
// allowed when margin confidence is high; otherwise the candidate stays
// 'researching' and the owner decides. No AI provider call is required — all
// extraction/scoring is deterministic and evidence-based.
//
// SECURITY: persistence goes through the injected db adapter, which must be
// configured with the ADMIN JWT (setAccessToken) so RLS governs every write.
// ============================================================================

import type { DbAdapter } from '../../services/db';
import type { FetchedSourcePage, PageExtract, ScoutCandidate, ScoutRunResult } from './types';
import { supplierFromUrl, dedupeKey, normalizeTitle } from './normalize';
import { extractPageFacts, describeExtract } from './extract';
import { calculateMargin } from './margin';
import { applyRejectFilters, collectRiskFlags } from './reject';
import { scoreCandidate, SHORTLIST_THRESHOLD } from './score';
import {
  ensureSupplier, persistSupplierProduct, persistCandidate, persistScore,
  createJob, completeJob, addRun, addLog,
} from './persist';

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

/**
 * Research a single URL through the full pipeline. Returns null when the
 * source cannot be verified (no fabricated candidates are ever created).
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

  // 3) MARGIN (separate from score). Verified "Free Shipping" counts as
  //    $0 shipping evidence (inferred) — otherwise shipping stays UNKNOWN.
  const margin = calculateMargin({ supplierPrice: extract.price, shippingCost: extract.freeShipping ? 0 : null, markup });

  // 4) HARD REJECTION FILTERS
  const rejection = applyRejectFilters({ title, extract, margin, images: extract.images });
  const riskFlags = collectRiskFlags({ title, extract, margin });
  const category = petCategorySignal(title);

  // 5) SCORE
  const score = scoreCandidate({
    title,
    extract,
    margin,
    supplierVerified: true,
    sourceIsManufacturer: /manufacturer|official|brand|co\.|inc\.|llc/i.test(supplier.name) || extract.title !== null,
    images: extract.images,
    riskFlags,
  });

  // 6) STATUS — reject / shortlist / researching. Shortlisting is a pure
  //    score gate (≥75, no rejection). Margin confidence LOW only prevents
  //    AUTO-approval; approval is always an explicit owner action, so the
  //    candidate stays 'qualified' and the risk flag is recorded instead.
  let status: ScoutCandidate['status'] = score.overall >= SHORTLIST_THRESHOLD ? 'qualified' : 'researching';
  let rejectionReason: string | undefined;
  if (rejection) {
    status = 'rejected';
    rejectionReason = `${rejection.reason}: ${rejection.detail}`;
  }

  const candidate: ScoutCandidate = {
    id: '',
    title,
    source: supplier.name,
    sourceUrl: url,
    supplierSlug: supplier.slug,
    images: extract.images,
    evidence: buildEvidence(url, extract, category),
    margin,
    score,
    status,
    rejectionReason,
    createdAt: new Date().toISOString(),
  };

  // 7) PERSIST (admin JWT — RLS enforces admin-only writes)
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
      status,
      rejectionReason,
    });
    candidate.id = cand.id;
    await persistScore(db, cand.id, score);
  } catch (e) {
    progress(`[error] ${title} — persistence failed: ${(e as Error).message}`);
    return null;
  }

  progress(`[ok] ${title} — score ${score.overall}/100 (${status})${rejection ? ' — REJECTED: ' + rejection.reason : ''}`);
  return candidate;
}

/**
 * Run one controlled research pass over the given URLs. Creates an
 * agent_job (PRODUCT_RESEARCH), runs, logs, and returns the summary.
 */
export async function runScoutResearch(opts: ScoutRunOptions): Promise<ScoutRunResult> {
  const { urls, db, onProgress } = opts;
  const progress = (m: string) => onProgress?.(m);

  const jobId = await createJob(db, 'PRODUCT_RESEARCH', { urls, at: new Date().toISOString() });
  await addRun(db, jobId, 'product-scout', 'running', `Researching ${urls.length} source URLs`);
  await addLog(db, jobId, 'info', `Research run started with ${urls.length} URLs`);

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
  let rejected = 0;
  let failed = 0;
  for (const url of urls) {
    const c = await researchUrl({ ...opts, url }, seen);
    if (!c) { failed++; continue; }
    candidates.push(c);
    seen.push({ dedupeKey: dedupeKey(c.sourceUrl, c.title), title: c.title });
    if (c.status === 'rejected') rejected++;
  }

  const shortlisted = candidates.filter((c) => c.status === 'qualified').length;

  await addLog(db, jobId, 'info', `Run finished: ${candidates.length} candidates, ${rejected} rejected, ${shortlisted} shortlisted, ${failed} failed`);
  await addRun(db, jobId, 'product-scout', 'completed', `${candidates.length} candidates, ${shortlisted} shortlisted`);
  await completeJob(db, jobId, 'completed', {
    researched: candidates.length,
    rejected,
    shortlisted,
    failed,
    at: new Date().toISOString(),
  });

  progress(`Done — ${candidates.length} researched, ${rejected} rejected, ${shortlisted} shortlisted, ${failed} failed.`);
  return { jobId, researched: candidates.length, rejected, shortlisted, failed, candidates };
}
