// ============================================================================
// LUXEDGE V2 — SCOUT LISTING GENERATION + FACTUAL QA (Phase 4B)
//
// Generates a premium Luxedge listing DRAFT for an approved candidate using
// DeepSeek through the secure server proxy (key server-side only). The AI may
// rewrite PRESENT verified source facts but may NEVER invent certifications,
// dimensions, materials, shipping times, ratings, reviews, warranty, medical
// benefits, inventory or sales counts.
//
// Listing QA then classifies every material claim as SUPPORTED / UNSUPPORTED
// / UNKNOWN against the stored candidate evidence. Any UNSUPPORTED important
// claim fails QA and the listing must be corrected.
// ============================================================================

import { routerGenerate } from './aiRouter';
import type { ListingDraft, ListingQAResult, ListingClaim, ClaimStatus, ScoutCandidate } from './types';

// ---------------------------------------------------------------------------
// Listing generation
// ---------------------------------------------------------------------------

export interface ListingInput {
  title: string;
  sourceUrl: string;
  supplierName: string;
  price: number | null;
  /** Verified facts from the source page (evidence). */
  verifiedFacts: string[];
  /** Facts explicitly NOT verified — the AI must not assert them. */
  forbiddenFields: string[];
}

const LISTING_SYSTEM = 'You are a premium pet-retail copywriter for Luxedge (a USA pet store). You may rewrite and present ONLY the VERIFIED facts provided. You must NEVER invent certifications, dimensions, materials, shipping times, ratings, reviews, warranty, medical benefits, inventory, or sales counts. Anything unverified stays unstated. Return only JSON.';

/**
 * Build the DeepSeek prompt for listing generation. Grounded in evidence —
 * the AI has no license to invent.
 */
export function buildListingPrompt(input: ListingInput): string {
  const facts = input.verifiedFacts.length ? input.verifiedFacts.join('\n') : 'No verified facts were collected for this product beyond the title and source.';
  return `Create a premium Luxedge product listing for this real product.

PRODUCT TITLE: ${input.title}
SUPPLIER: ${input.supplierName}
SOURCE: ${input.sourceUrl}
OBSERVED PRICE: ${input.price !== null ? `$${input.price.toFixed(2)}` : 'UNKNOWN — do not state a price'}

VERIFIED FACTS (you may only use these):
${facts}

FORBIDDEN (never assert): ${input.forbiddenFields.join(', ')}

Return STRICT JSON (no markdown):
{
  "title": "premium title",
  "shortDescription": "2-3 sentence summary",
  "longDescription": "3-4 paragraph description",
  "features": ["..."],
  "benefits": ["..."],
  "specifications": {"name": "value"},
  "seoTitle": "max 60 chars",
  "metaDescription": "max 160 chars",
  "keywords": ["..."],
  "imageAlts": ["..."],
  "faqs": [{"q": "...", "a": "..."}]
}
Only include facts supported by the VERIFIED FACTS list. Leave unknown fields empty.`;
}

/** Parse the AI listing JSON; returns null when unparseable. */
export function parseListingJson(raw: string): ListingDraft | null {
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  const obj = candidate.match(/(\{[\s\S]*\})/);
  if (!obj) return null;
  try {
    const d = JSON.parse(obj[1]);
    if (!d || typeof d !== 'object') return null;
    const str = (v: unknown, fb: string) => (typeof v === 'string' ? v : fb);
    const arr = (v: unknown, fb: string[]) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : fb);
    const spec: Record<string, string> = {};
    if (d.specifications && typeof d.specifications === 'object') {
      for (const [k, v] of Object.entries(d.specifications)) spec[k] = String(v);
    }
    return {
      title: str(d.title, ''),
      shortDescription: str(d.shortDescription, ''),
      longDescription: str(d.longDescription, ''),
      features: arr(d.features, []),
      benefits: arr(d.benefits, []),
      specifications: spec,
      seoTitle: str(d.seoTitle, ''),
      metaDescription: str(d.metaDescription, ''),
      keywords: arr(d.keywords, []),
      imageAlts: arr(d.imageAlts, []),
      faqs: Array.isArray(d.faqs)
        ? d.faqs
            .filter((f: unknown): f is Record<string, unknown> => !!f && typeof f === 'object' && typeof (f as Record<string, unknown>).q === 'string' && typeof (f as Record<string, unknown>).a === 'string')
            .map((f: Record<string, unknown>) => ({ q: String(f.q), a: String(f.a) }))
        : [],
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Listing factual QA
// ---------------------------------------------------------------------------

const FORBIDDEN_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\b(?:certified|certification|FDA|USDA|OEKO|approved by)\b/i, label: 'certification' },
  { re: /\b\d+(?:\.\d+)?\s*(?:x|×)\s*\d+(?:\.\d+)?\s*(?:x|×)\s*\d+(?:\.\d+)?\s*(?:in|inch|cm)\b/i, label: 'dimensions' },
  { re: /\b(?:100%|pure)\s+(?:organic|natural|grain-free|hypoallergenic)\b/i, label: 'material claim' },
  { re: /\b(?:ships?|deliver(?:y|ed)?)\s+(?:in|within)\s+\d+\s*(?:-|to)\s*\d+\s*(?:business\s*)?days?\b/i, label: 'shipping time' },
  { re: /\b\d+(?:\.\d+)?\s*\/\s*5\s+stars?\b|\b(?:rating|rated|reviews?)\s*\d+/i, label: 'rating/review count' },
  { re: /\bwarrant(?:y|ied)?\b/i, label: 'warranty' },
  { re: /\b(?:cures?|treats?|heals?|relieves?)\s+(?:arthritis|anxiety|pain|allergy|infection)\b|\bmedical\s+grade\b|\bveterinary\s+(?:grade|strength)\b/i, label: 'medical benefit' },
  { re: /\b\d+\s*(?:units?|in\s+stock|pcs?)\b/i, label: 'inventory count' },
  { re: /\bbestseller\b|\b#1\s+(?:best\s+)?seller\b|\bsold\s+\d+/i, label: 'sales count' },
];

/**
 * Classify every material claim in the listing against the candidate evidence.
 * SUPPORTED = traceable to evidence; UNKNOWN = not in evidence (allowed but
 * flagged); UNSUPPORTED = contradicts evidence or asserts a forbidden field.
 */
export function qaListing(candidate: ScoutCandidate, listing: ListingDraft): ListingQAResult {
  const claims: ListingClaim[] = [];
  const unsupported: string[] = [];
  const unknown: string[] = [];
  const importantUnsupported: string[] = [];
  const ev = candidate.evidence;
  const verifiedTitle = (ev.title?.value as string | null) ?? null;
  const verifiedPrice = (ev.supplierPrice?.value as number | null) ?? null;
  const verifiedOrigin = (ev.origin?.value as string | null) ?? null;
  const verifiedShipping = (ev.shippingDays?.value as { min: number; max: number } | null) ?? null;

  const classify = (claim: string): { status: ClaimStatus; important: boolean } => {
    // 1) Forbidden-field check — hard fail if asserted.
    for (const { re } of FORBIDDEN_PATTERNS) {
      if (re.test(claim)) return { status: 'unsupported', important: true };
    }
    // 2) Price: if a price appears in the listing text, it must match evidence.
    const priceMatch = claim.match(/\$\s?(\d+(?:\.\d{1,2})?)/);
    if (priceMatch) {
      const p = parseFloat(priceMatch[1]);
      if (verifiedPrice !== null && Math.abs(p - verifiedPrice) < 0.01) return { status: 'supported', important: false };
      return { status: 'unsupported', important: true }; // wrong price is misleading
    }
    // 3) Origin/materials: only supported if evidence has it.
    if (/usa|united states|america/i.test(claim)) {
      return verifiedOrigin && /usa|united states|america/i.test(verifiedOrigin)
        ? { status: 'supported', important: false }
        : { status: 'unsupported', important: true };
    }
    if (/\b(?:made|manufactured|built)\b/i.test(claim) && verifiedOrigin === null) return { status: 'unknown', important: false };
    // 4) Shipping window: only if evidence has it.
    const shipMatch = claim.match(/(\d+)\s*[-–to ]+\s*(\d+)\s*(?:business\s*)?days/i);
    if (shipMatch) {
      if (!verifiedShipping) return { status: 'unsupported', important: true };
      const [a, b] = [parseInt(shipMatch[1], 10), parseInt(shipMatch[2], 10)];
      return a === verifiedShipping.min && b === verifiedShipping.max
        ? { status: 'supported', important: false }
        : { status: 'unknown', important: false };
    }
    // 5) Title-derived claims are supported when they echo the verified title.
    if (verifiedTitle && claim.length < 120 && normalizedOverlap(claim, verifiedTitle) > 0.6) {
      return { status: 'supported', important: false };
    }
    return { status: 'unknown', important: false };
  };

  const push = (text: string) => {
    if (!text.trim()) return;
    const { status, important } = classify(text);
    claims.push({ claim: text.trim().slice(0, 180), status, reason: statusReason(status) });
    if (status === 'unsupported') {
      unsupported.push(text.trim().slice(0, 120));
      if (important) importantUnsupported.push(text.trim().slice(0, 120));
    }
    if (status === 'unknown') unknown.push(text.trim().slice(0, 120));
  };

  push(listing.title);
  push(listing.shortDescription);
  push(listing.longDescription);
  listing.features.forEach((f) => push(f));
  listing.benefits.forEach((b) => push(b));
  listing.faqs.forEach((f) => push(`${f.q} ${f.a}`));
  for (const v of Object.values(listing.specifications)) push(v);

  const passed = importantUnsupported.length === 0;

  return { claims, passed, unsupported, unknown };
}

function normalizedOverlap(a: string, b: string): number {
  const wa = a.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const wb = b.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  if (!wa.length || !wb.length) return 0;
  const set = new Set(wb);
  const hits = wa.filter((w) => set.has(w)).length;
  return hits / wa.length;
}

function statusReason(status: ClaimStatus): string {
  if (status === 'supported') return 'Traceable to verified source evidence.';
  if (status === 'unsupported') return 'Asserts a forbidden or evidence-contradicting fact.';
  return 'Not present in the collected evidence — treated as UNKNOWN, not fact.';
}

// ---------------------------------------------------------------------------
// Orchestration helpers
// ---------------------------------------------------------------------------

/**
 * Generate a listing draft via DeepSeek (secure server proxy). Returns null
 * when the AI is unavailable so callers can keep the deterministic pipeline.
 */
export async function generateListingDraft(
  candidate: ScoutCandidate,
  aiCall: (prompt: string, model?: string) => Promise<string> = async (prompt, model) => {
    const r = await routerGenerate(prompt, {
      task: 'LISTING_GENERATE',
      important: true,
      explicit: true,
      model,
      system: LISTING_SYSTEM,
    });
    return r.text;
  }
): Promise<{ listing: ListingDraft; raw: string } | null> {
  const verifiedFacts: string[] = [];
  const ev = candidate.evidence;
  if (ev.title?.value) verifiedFacts.push(`Title: ${ev.title.value}`);
  if (ev.supplierPrice?.value !== null && ev.supplierPrice?.value !== undefined) verifiedFacts.push(`Observed price: $${Number(ev.supplierPrice.value).toFixed(2)}`);
  if (ev.origin?.value) verifiedFacts.push(`Origin evidence: ${ev.origin.value}`);
  if (ev.shippingDays?.value) {
    const d = ev.shippingDays.value as { min: number; max: number };
    verifiedFacts.push(`Shipping window evidence: ${d.min}-${d.max} business days`);
  }
  if (ev.availability?.value) verifiedFacts.push(`Availability: ${ev.availability.value}`);
  if (ev.sizes?.value && Array.isArray(ev.sizes.value)) verifiedFacts.push(`Sizes: ${ev.sizes.value.join(', ')}`);
  if (ev.rating?.value !== null && ev.rating?.value !== undefined) verifiedFacts.push(`Source-page rating evidence: ${ev.rating.value}/5`);
  if (ev.unknownFields?.length) verifiedFacts.push(`Explicitly unknown (do not state): ${ev.unknownFields.join(', ')}`);

  const prompt = buildListingPrompt({
    title: candidate.title,
    sourceUrl: candidate.sourceUrl,
    supplierName: candidate.source,
    price: (ev.supplierPrice?.value as number | null) ?? null,
    verifiedFacts,
    forbiddenFields: ['certifications', 'dimensions', 'materials', 'shipping times', 'ratings', 'reviews', 'warranty', 'medical benefits', 'inventory', 'sales counts'],
  });
  try {
    const raw = await aiCall(prompt);
    const listing = parseListingJson(raw);
    return listing ? { listing, raw } : null;
  } catch {
    return null;
  }
}

/**
 * Deterministic listing built ONLY from verified evidence — the DeepSeek
 * missing-key fallback. No AI, no invented facts: every field traces to a
 * stored evidence item or stays empty. Clearly labelled so the owner can
 * distinguish a deterministic draft from an AI-polished one.
 */
export function buildDeterministicListing(candidate: ScoutCandidate): ListingDraft {
  const ev = candidate.evidence;
  const title = (ev.title?.value as string | null) ?? candidate.title;
  const price = (ev.supplierPrice?.value as number | null) ?? null;
  const origin = (ev.origin?.value as string | null) ?? null;
  const sizes = (ev.sizes?.value as string[] | null) ?? null;
  const availability = (ev.availability?.value as string | null) ?? null;

  const features: string[] = [];
  if (price !== null) features.push(`Real supplier price observed: $${price.toFixed(2)} (source evidence)`);
  if (origin) features.push(`Origin evidence: ${origin}`);
  if (sizes?.length) features.push(`Available sizes: ${sizes.join(', ')}`);
  if (availability) features.push(`Availability observed: ${availability}`);

  const spec: Record<string, string> = {};
  if (origin) spec['Origin'] = origin;
  if (sizes?.length) spec['Sizes'] = sizes.join(', ');

  const shortDescription = `${title} — verified from ${candidate.source} (${candidate.sourceUrl}). ${price !== null ? `Observed supplier price $${price.toFixed(2)}.` : ''} All facts sourced; unverified details intentionally omitted.`;

  return {
    title: `Luxedge ${title}`.slice(0, 120),
    shortDescription,
    longDescription: `${shortDescription}\n\nThis listing is a deterministic draft assembled strictly from verified source evidence. No ratings, reviews, certifications, shipping promises, medical claims or inventory counts are asserted.`,
    features,
    benefits: origin ? [`Sourced from ${origin}`] : [],
    specifications: spec,
    seoTitle: title.slice(0, 60),
    metaDescription: shortDescription.slice(0, 160),
    keywords: [candidate.source, ...(sizes ?? [])].slice(0, 10),
    imageAlts: (ev.images?.value as string[] | null)?.map((_, i) => `${title} — image ${i + 1}`) ?? [],
    faqs: [
      {
        q: 'Where does this product come from?',
        a: origin ? `Verified source origin: ${origin}.` : 'Origin evidence was not collected — we do not assert one.',
      },
      {
        q: 'What is the observed price?',
        a: price !== null ? `Observed supplier price $${price.toFixed(2)} at the source.` : 'No verified price was collected.',
      },
    ],
  };
}
