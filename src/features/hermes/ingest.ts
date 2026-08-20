// ============================================================================
// LUXEDGE — HERMES INGEST VALIDATION (RESEARCH ONLY)
//
// Strict, dependency-free validation of incoming structured research data
// from Salman OS / Hermes. Guarantees:
//   - only whitelisted fields are accepted (anything else is dropped)
//   - text is trimmed, control-char-stripped, and length-capped
//   - numbers must be finite and within sane ranges
//   - URLs must be http/https and well-formed
//   - nothing here can trigger code execution, product creation, publishing,
//     or any other Luxedge write — it is pure validation of inert text.
//
// Incoming AI output is ALWAYS treated as untrusted data. Command-looking
// strings (shell, SQL, JS) are stored as inert text at most — never
// interpreted, never executed.
// ============================================================================

import type {
  HermesIngestInput,
  HermesMarketingIntelInput,
  HermesProductSuggestionInput,
  HermesSeoSuggestionInput,
} from './types';

export interface IngestResult {
  ok: boolean;
  input?: HermesIngestInput;
  errors: string[];
}

const TEXT_LIMITS: Record<string, number> = {
  productName: 300,
  category: 120,
  subcategory: 120,
  brand: 120,
  sourceUrl: 1000,
  supplier: 200,
  deliveryEstimate: 300,
  demandEvidence: 2000,
  competition: 2000,
  benefits: 4000,
  marketingPotential: 2000,
  adsPotential: 2000,
  risks: 4000,
  recommendation: 4000,
  sourceRef: 300,
  url: 1000,
  evidence: 4000,
  keyword: 200,
  intent: 300,
  title: 300,
  summary: 4000,
};

const SEO_TYPES = ['keyword', 'title', 'meta_description', 'content', 'internal_link', 'category', 'topic_cluster', 'marketing_language', 'other'] as const;
const SEO_PRIORITIES = ['low', 'medium', 'high'] as const;
const INTEL_TYPES = ['market', 'positioning', 'competitor', 'trend', 'seasonal', 'bundle', 'promotion', 'content', 'email', 'social', 'audience', 'offer', 'other'] as const;

/** Trim, strip control characters (keep newlines for narrative text), cap length. */
export function sanitizeText(value: unknown, field: string, max = 4000): string | null {
  if (typeof value !== 'string') return null;
  let s = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  const cap = TEXT_LIMITS[field] ?? max;
  if (s.length > cap) s = s.slice(0, cap);
  return s.length ? s : null;
}

/** Numbers: must be finite; optionally within a range. Null/undefined → null. */
export function sanitizeNumber(value: unknown, min?: number, max?: number): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  if (min !== undefined && n < min) return null;
  if (max !== undefined && n > max) return null;
  return n;
}

/** http/https URL only; must have a host. Returns trimmed URL or null. */
export function sanitizeUrl(value: unknown): string | null {
  const s = sanitizeText(value, 'sourceUrl');
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname || !u.hostname.includes('.')) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function validateProduct(raw: unknown): IngestResult {
  const errors: string[] = [];
  const r = (raw ?? {}) as Record<string, unknown>;
  const productName = sanitizeText(r.productName, 'productName');
  if (!productName) errors.push('productName is required (string ≤ 300 chars)');

  const supplierPrice = sanitizeNumber(r.supplierPrice, 0, 1_000_000);
  const shippingCost = sanitizeNumber(r.shippingCost, 0, 1_000_000);
  const landedCost = sanitizeNumber(r.landedCost, 0, 1_000_000);
  const expectedSellingPrice = sanitizeNumber(r.expectedSellingPrice, 0, 1_000_000);
  const marginEstimate = sanitizeNumber(r.marginEstimate, -1000, 1000);
  const ratings = sanitizeNumber(r.ratings, 0, 5);
  const reviews = sanitizeNumber(r.reviews, 0, 100_000_000);
  const confidence = sanitizeNumber(r.confidence, 0, 1);

  const currency = sanitizeText(r.currency, 'category');
  if (currency && !/^[A-Z]{3}$/.test(currency)) errors.push('currency must be a 3-letter ISO code');

  if (errors.length) return { ok: false, errors };

  const data: HermesProductSuggestionInput = {
    sourceRef: sanitizeText(r.sourceRef, 'sourceRef') ?? undefined,
    productName: productName!,
    category: sanitizeText(r.category, 'category') ?? undefined,
    subcategory: sanitizeText(r.subcategory, 'subcategory') ?? undefined,
    brand: sanitizeText(r.brand, 'brand') ?? undefined,
    sourceUrl: sanitizeUrl(r.sourceUrl) ?? undefined,
    supplier: sanitizeText(r.supplier, 'supplier') ?? undefined,
    supplierPrice: supplierPrice ?? undefined,
    currency: currency ?? 'USD',
    shippingCost: shippingCost ?? undefined,
    landedCost: landedCost ?? undefined,
    deliveryEstimate: sanitizeText(r.deliveryEstimate, 'deliveryEstimate') ?? undefined,
    expectedSellingPrice: expectedSellingPrice ?? undefined,
    marginEstimate: marginEstimate ?? undefined,
    ratings: ratings ?? undefined,
    reviews: reviews ?? undefined,
    demandEvidence: sanitizeText(r.demandEvidence, 'demandEvidence') ?? undefined,
    competition: sanitizeText(r.competition, 'competition') ?? undefined,
    benefits: sanitizeText(r.benefits, 'benefits') ?? undefined,
    marketingPotential: sanitizeText(r.marketingPotential, 'marketingPotential') ?? undefined,
    adsPotential: sanitizeText(r.adsPotential, 'adsPotential') ?? undefined,
    risks: sanitizeText(r.risks, 'risks') ?? undefined,
    recommendation: sanitizeText(r.recommendation, 'recommendation') ?? undefined,
    confidence: confidence ?? undefined,
  };
  return { ok: true, input: { kind: 'product', data }, errors };
}

function validateSeo(raw: unknown): IngestResult {
  const errors: string[] = [];
  const r = (raw ?? {}) as Record<string, unknown>;
  const recommendation = sanitizeText(r.recommendation, 'recommendation');
  if (!recommendation) errors.push('recommendation is required (string ≤ 4000 chars)');

  const suggestionTypeRaw = sanitizeText(r.suggestionType, 'category');
  const suggestionType = suggestionTypeRaw && (SEO_TYPES as readonly string[]).includes(suggestionTypeRaw)
    ? (suggestionTypeRaw as HermesSeoSuggestionInput['suggestionType'])
    : 'other';

  const priorityRaw = sanitizeText(r.priority, 'category');
  const priority = priorityRaw && (SEO_PRIORITIES as readonly string[]).includes(priorityRaw)
    ? (priorityRaw as HermesSeoSuggestionInput['priority'])
    : 'medium';

  const confidence = sanitizeNumber(r.confidence, 0, 1);

  if (errors.length) return { ok: false, errors };

  const data: HermesSeoSuggestionInput = {
    sourceRef: sanitizeText(r.sourceRef, 'sourceRef') ?? undefined,
    url: sanitizeUrl(r.url) ?? undefined,
    suggestionType,
    recommendation: recommendation!,
    evidence: sanitizeText(r.evidence, 'evidence') ?? undefined,
    keyword: sanitizeText(r.keyword, 'keyword') ?? undefined,
    intent: sanitizeText(r.intent, 'intent') ?? undefined,
    priority,
    confidence: confidence ?? undefined,
  };
  return { ok: true, input: { kind: 'seo', data }, errors };
}

function validateMarketing(raw: unknown): IngestResult {
  const errors: string[] = [];
  const r = (raw ?? {}) as Record<string, unknown>;
  const title = sanitizeText(r.title, 'title');
  if (!title) errors.push('title is required (string ≤ 300 chars)');
  const summary = sanitizeText(r.summary, 'summary');
  if (!summary) errors.push('summary is required (string ≤ 4000 chars)');

  const intelTypeRaw = sanitizeText(r.intelType, 'category');
  const intelType = intelTypeRaw && (INTEL_TYPES as readonly string[]).includes(intelTypeRaw)
    ? (intelTypeRaw as HermesMarketingIntelInput['intelType'])
    : 'other';

  const details = (r.details ?? {}) as Record<string, unknown>;
  if (details !== null && typeof details !== 'object') errors.push('details must be an object');
  if (details && JSON.stringify(details).length > 40_000) errors.push('details is too large');

  const confidence = sanitizeNumber(r.confidence, 0, 1);

  if (errors.length) return { ok: false, errors };

  const data: HermesMarketingIntelInput = {
    sourceRef: sanitizeText(r.sourceRef, 'sourceRef') ?? undefined,
    intelType,
    title: title!,
    summary: summary!,
    details: details ?? {},
    confidence: confidence ?? undefined,
  };
  return { ok: true, input: { kind: 'marketing', data }, errors };
}

/**
 * Parse + validate an incoming ingest body. The body must be
 * { kind: 'product' | 'seo' | 'marketing', data: {...} }.
 * Returns normalized input or a list of reject reasons. Never throws.
 */
export function parseIngestBody(body: unknown): IngestResult {
  if (!body || typeof body !== 'object') return { ok: false, errors: ['body must be a JSON object'] };
  const b = body as Record<string, unknown>;
  const kind = b.kind;
  if (kind === 'product') return validateProduct(b.data);
  if (kind === 'seo') return validateSeo(b.data);
  if (kind === 'marketing') return validateMarketing(b.data);
  return { ok: false, errors: ['kind must be one of: product, seo, marketing'] };
}

/**
 * Detect content that looks like an execution attempt (shell/SQL/JS/URL
 * scheme abuse). We NEVER execute it — this exists so the ingest layer can
 * flag and store it as suspicious inert evidence for review.
 */
export function flagSuspiciousContent(text: unknown): string[] {
  if (typeof text !== 'string' || !text) return [];
  const flags: string[] = [];
  if (/(\brm\s+-rf\b|\bdel\s+\/s\b|\bformat\s+[a-z]:|--force\b|;|\|\||&&|`)/i.test(text)) flags.push('shell-like');
  if (/\b(drop|truncate|alter)\s+(table|database)\b/i.test(text)) flags.push('sql-ddl-like');
  if (/<script|javascript:|onerror=|document\.cookie/i.test(text)) flags.push('script-like');
  return flags;
}
