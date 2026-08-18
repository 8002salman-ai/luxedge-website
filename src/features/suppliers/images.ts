// ============================================================================
// LUXEDGE V2 — SUPPLIER IMAGE CONTENT CURATION (Phase 4H.3 image content)
//
// The actual IMAGE CONTENT layer — distinct from the storefront presentation
// (gallery CSS) layer. This module turns raw supplier/CJ image URLs into a
// structured, TRUTHFUL image set for a product listing:
//
//   primaryImage  — the strongest hero (supplier's own full-size URL)
//   galleryImages — hero + deduped unique images, stable order
//   variantImages — ONLY images the supplier ties to a specific variant
//   altText       — derived from the REAL product title (+ real variant), never invented
//
// HONESTY CONTRACT:
//   * We NEVER invent image URLs, dimensions, or alt descriptions.
//   * Resolution (width/height) is recorded ONLY when the URL itself encodes
//     a real size hint (e.g. "_800x800", "w=800&h=800", OSS resize) — otherwise
//     it stays null (UNKNOWN). We do NOT upscale and do NOT claim a higher
//     resolution than the supplier actually serves.
//   * "Highest resolution" means: prefer the supplier's own full-size image
//     set (CJ product/query productImageSet) over the list-level thumbnail
//     (bigImage). No fabrication.
//   * Duplicate removal is EXACT (normalized URL key), never content-based
//     guessing. Obviously-weak URLs (thumb/small tokens) are only used to
//     RANK the hero, never silently deleted.
//   * Variant images are populated ONLY from a real supplier variant→image
//     linkage supplied by the caller. When the adapter cannot verify that
//     linkage, variantImages stays EMPTY (never guessed from title color
//     words).
// ============================================================================

/** Provenance of a supplier image. */
export type SupplierImageKind = 'product' | 'variant' | 'unknown';

/** One curated supplier image with honest provenance + alt text. */
export interface SupplierImage {
  /** The supplier's real image URL (unmodified, full-size as served). */
  url: string;
  kind: SupplierImageKind;
  /** Supplier variant id when the supplier ties this image to a variant. */
  variantId?: string | null;
  /** Supplier variant label (color/size) when provided — never guessed. */
  variantLabel?: string | null;
  /** Width in px — ONLY when the URL itself encodes it; else null (UNKNOWN). */
  width?: number | null;
  /** Height in px — ONLY when the URL itself encodes it; else null (UNKNOWN). */
  height?: number | null;
  /** Alt text derived from the REAL product title (+ variant) — never invented. */
  alt?: string | null;
}

/** The structured, curated image set for one supplier product. */
export interface SupplierImageSet {
  /** The selected hero image URL (null when no usable image exists). */
  primaryImage: string | null;
  /** Deduped gallery in display order (hero first, then supplier order). */
  galleryImages: SupplierImage[];
  /** Only genuine variant-linked images (never guessed). */
  variantImages: SupplierImage[];
  /** Alt text for each gallery image, in the same order. */
  altText: string[];
  /** Number of distinct usable images after dedupe. */
  dedupedCount: number;
  /** Normalized keys of exact duplicate images removed (for audit). */
  removedDuplicates: string[];
}

/** One supplier-supplied variant→image linkage (only passed when real). */
export interface SupplierVariantImageLink {
  url: string;
  variantId?: string | null;
  variantLabel?: string | null;
}

/** Query params that are tracking noise — removed ONLY for dedupe keys. */
const TRACKING_PARAMS = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'spm', 'ref', 'source', 'from', 'click', 'xid', 'ssr', '_t']);

/**
 * Normalize a URL for EXACT dedupe: lowercases the host, strips the fragment
 * and known tracking query params, keeps the path + any genuine size/identity
 * params. Returns null for junk (empty / non-http). The returned key is used
 * ONLY for equality — the original URL is never rewritten.
 */
export function normalizeImageUrlForDedupe(url: string): string | null {
  const raw = (url || '').trim();
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hostname = u.hostname.toLowerCase();
  u.hash = '';
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) u.searchParams.delete(key);
  }
  return u.toString();
}

/** Result of exact image URL dedupe. */
export interface DedupeResult {
  /** First-occurrence URLs, in original order. */
  unique: string[];
  /** Normalized keys of the exact duplicates that were removed. */
  removed: string[];
}

/** Remove exact duplicate (and junk) image URLs, preserving first occurrence. */
export function dedupeImageUrls(urls: (string | null | undefined)[]): DedupeResult {
  const unique: string[] = [];
  const removed: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    const url = (raw || '').trim();
    if (!url) continue;
    const key = normalizeImageUrlForDedupe(url);
    if (!key) continue; // junk (non-http / empty) is dropped, not recorded
    if (seen.has(key)) {
      removed.push(key);
      continue;
    }
    seen.add(key);
    unique.push(url);
  }
  return { unique, removed };
}

/**
 * Conservative "obviously weak" heuristic used ONLY to rank the hero — a URL
 * whose own name advertises a thumbnail/small rendition. Never used to delete
 * images. Substring-based because "_" is a word char in JS regex (\b cannot
 * see the "_thumb" boundary). False positives are acceptable because the
 * fallback is always the first image.
 */
export function isObviouslyWeakImageUrl(url: string): boolean {
  return /(thumb|thumbnail|small)/i.test(url || '');
}

/**
 * Extract a REAL size hint embedded in the URL (e.g. "_800x800", "/800x800/",
 * "w=800&h=800", Aliyun OSS "x-oss-process=image/resize,w_800,h_800").
 * Returns null when the URL does not literally encode a size — we NEVER
 * guess dimensions and NEVER treat this as a verified pixel dimension beyond
 * "the URL encodes this size".
 */
export function imageUrlResolutionHint(url: string): { width: number; height: number } | null {
  const u = (url || '').trim();
  if (!u) return null;

  // Aliyun OSS resize: x-oss-process=image/resize,w_800,h_800
  const oss = /x-oss-process=image\/resize[^&\s]*w_(\d+)(?:[^&\s]*h_(\d+))?/i.exec(u);
  if (oss) {
    const w = parseInt(oss[1], 10);
    const h = oss[2] ? parseInt(oss[2], 10) : null;
    if (Number.isFinite(w) && w > 0) return { width: w, height: h ?? w };
  }

  // Query form: w=800&h=800 (or w=800 alone)
  const q = /[?&]w=(\d{2,5})(?:&[^=]*=[^&]*)*&h=(\d{2,5})/i.exec(u);
  if (q) {
    const w = parseInt(q[1], 10);
    const h = parseInt(q[2], 10);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return { width: w, height: h };
  }

  // Path suffix: _800x800 or /800x800/ before the extension
  const path = /[_\/(](\d{2,4})x(\d{2,4})(?:[._)\/-]|$)/i.exec(u);
  if (path) {
    const w = parseInt(path[1], 10);
    const h = parseInt(path[2], 10);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return { width: w, height: h };
  }

  return null;
}

/** Input to the curation function. */
export interface CurateSupplierImageOptions {
  /** REAL product title (source of all alt text — never invented). */
  title: string;
  /** Raw supplier gallery URLs (list bigImage or detail productImageSet). */
  images: (string | null | undefined)[];
  /** Real variant→image linkages ONLY (empty when the supplier cannot be verified). */
  variantImages?: SupplierVariantImageLink[];
}

/** Build a curated image entry from a URL + title (+ optional variant link). */
function toImage(url: string, title: string, kind: SupplierImageKind, index: number, variant?: SupplierVariantImageLink): SupplierImage {
  const res = imageUrlResolutionHint(url);
  const alt = kind === 'variant'
    ? (variant?.variantLabel ? `${title} — ${variant.variantLabel}` : `${title} — variant`)
    : (index === 0 ? title : `${title} — image ${index + 1}`);
  return {
    url,
    kind,
    variantId: variant?.variantId ?? null,
    variantLabel: variant?.variantLabel ?? null,
    width: res?.width ?? null,
    height: res?.height ?? null,
    alt,
  };
}

/**
 * Curate a raw supplier image set into a truthful listing-ready structure:
 * exact dedupe → hero selection (first non-weak URL) → stable gallery order →
 * honest alt text. Variant images are included ONLY when a real linkage is
 * supplied — they are never guessed.
 */
export function curateSupplierImageSet(opts: CurateSupplierImageOptions): SupplierImageSet {
  const title = (opts.title || '').trim() || 'Product';
  const deduped = dedupeImageUrls(opts.images);

  // Hero: first non-weak image; fall back to the first image; else none.
  const heroUrl = deduped.unique.find((u) => !isObviouslyWeakImageUrl(u)) ?? deduped.unique[0] ?? null;

  // Gallery: hero FIRST, then the remaining unique images in supplier order.
  const galleryOrder = heroUrl
    ? [heroUrl, ...deduped.unique.filter((u) => u !== heroUrl)]
    : deduped.unique;
  const galleryImages = galleryOrder.map((url, i) =>
    toImage(url, title, 'product', i, undefined)
  );

  const variantImages = dedupeImageUrls((opts.variantImages ?? []).map((v) => v.url)).unique
    .map((url) => {
      const link = (opts.variantImages ?? []).find((v) => v.url.trim() === url);
      return toImage(url, title, 'variant', 0, link);
    });

  return {
    primaryImage: heroUrl,
    galleryImages,
    variantImages,
    altText: galleryImages.map((g) => g.alt ?? ''),
    dedupedCount: deduped.unique.length,
    removedDuplicates: deduped.removed,
  };
}
