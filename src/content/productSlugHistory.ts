// ============================================================================
// LUXEDGE — PRODUCT SLUG HISTORY (supplier slug → clean Luxedge slug)
//
// WHY THIS FILE EXISTS
// The catalogue was imported from a supplier feed, so a third of the public PDP
// URLs were the feed's own keyword strings rather than product names — up to
// 122 characters of concatenated attributes. Two of them also carried an
// unsupported claim *inside the URL itself*
// (`foldable-pet-carrier-backpack-airline-approved-…`,
// `orthopedic-memory-foam-dog-bed-joint-support-…`), which the served-text
// claim scan cannot see because it only reads page copy, and one began with a
// garbled supplier token (`love-my-owneri-…`). A URL is public-facing copy: a
// reviewer reads it in the sitemap and a buyer reads it in the address bar.
//
// WHAT THIS MAP IS FOR
//   1. `worker/index.ts` builds a permanent redirect for every OLD path, so an
//      indexed or bookmarked supplier URL merges into the canonical clean URL
//      instead of dead-ending (an internal link to a renamed slug would 301,
//      which the crawl audit reports).
//   2. The regression test asserts the rename was applied completely: every old
//      slug must be gone from the curated copy map, and every new slug that had
//      curated copy must still have it (renaming a key without renaming the
//      database row would silently thin that PDP back to a fallback page).
//
// ADDING A RENAME: add the pair here, rename the matching `PRODUCT_CONTENT` key,
// and update `products.slug` in the database to the same value. Nothing else.
// ============================================================================

/** old (supplier feed) slug → new (Luxedge) slug */
export const PRODUCT_SLUG_RENAMES: Record<string, string> = {
  '2pcs-pet-dog-seat-belt-leash-adjustable-pet-dog-cat-safety-leads-harness-car-vehicle-nylon-fabric-seatbelt-strap':
    'adjustable-pet-car-seatbelt-tether-2-pack',
  'durable-pet-cat-dog-vehicle-leash-nylon-adjustable-car-seat-dog-safety-belt-pet-leashes':
    'bungee-pet-car-seatbelt-leash',
  'pet-dog-carrier-bag-carrier-for-dogs-backpack-out-double-shoulder-portable-travel-backpack-outdoor-dog-carrier-bag-travel':
    'dual-shoulder-pet-carrier-backpack',
  'pet-dog-collars-pet-training-dog-training-equipment':
    'nylon-training-collar-quick-release',
  'silicone-flying-saucer-funny-pets-dog-cat-toy-dog-game-flying-discs-resistant-chew-puppy-training-interactive-pet-supplies':
    'silicone-flying-disc-dog-toy',
  'spot-pet-mat-waterproof-and-easy-to-clean-silicone-dog-mat-cat-mat-square-pet-placemat-pet-supplies-3':
    'silicone-feeding-placemat-dogs-cats',
  'foldable-pet-carrier-backpack-airline-approved-travel-bag-for-cats-small-dogs':
    'foldable-pet-travel-carrier-backpack',
  'orthopedic-memory-foam-dog-bed-joint-support-for-senior-large-dogs':
    'orthopedic-memory-foam-dog-bed',
  'love-my-owneri-love-my-dog-pet-dog-bone-necklace': 'bone-charm-pendant-necklace',
  'dot-turtleneck-dog-bottoming-shirt': 'polka-dot-turtleneck-dog-sweater',
  // The last two slugs that still named a claim the published copy deliberately
  // does not make. scripts/product-claim-audit.mjs tracks both token classes and
  // reports them: "public URL still names a claim the visible copy no longer
  // makes". Its own note says a rename needs a 301 and is an owner decision —
  // the redirect layer above makes that the same one-line change.
  'horse-fly-mask-with-ears-uv-protection': 'horse-fly-mask-with-ears',
  'heavy-duty-cattle-feed-trough-50-gallon': 'heavy-duty-cattle-feed-trough',
};

/** Slugs that must never appear in a public product URL again. A product slug
 * is customer-facing copy, so it is held to the same standard as the page:
 * no unsupported claim (airline approval, joint/health benefit), no supplier
 * feed token, no `-2`/`-3` duplicate marker, and short enough to read. */
export const FORBIDDEN_SLUG_PATTERNS: RegExp[] = [
  /airline[- ]approved/i,
  /tsa[- ]approved/i,
  /iata[- ]approved/i,
  /joint[- ]support/i,
  /orthopedic-.*joint/i,
  /\b2pcs\b|\b\d+pcs\b/i,
  /-pet-supplies-\d+$/,
  /owneri/i,
  /bottoming/i,
  /explosion[- ]proof/i,
];

/** Longest acceptable public product slug. The clean names in this catalogue
 * top out well below this; the supplier feed produced 87–122 character URLs. */
export const MAX_SLUG_LENGTH = 70;

/**
 * Old public paths that must permanently redirect to the clean URL.
 * Consumed by `LEGACY_PATH_REDIRECTS` in the worker.
 */
export function productSlugRedirects(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [oldSlug, newSlug] of Object.entries(PRODUCT_SLUG_RENAMES)) {
    out[`/product/${oldSlug}`] = `/product/${newSlug}`;
  }
  return out;
}
