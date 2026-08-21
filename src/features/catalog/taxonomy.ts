// ============================================================================
// LUXEDGE — STOREFRONT TAXONOMY
//
// The database stores a flat list of legacy category names ("Dog Supplies",
// "Cat Supplies", "Pet Beds", …). That is a *storage* concern and it must not
// dictate how the store is merchandised.
//
// This module is the presentation-layer taxonomy: a set of COLLECTIONS the
// storefront navigates by. Two kinds:
//
//   need    — what the customer is solving for (Feeding, Comfort, Grooming,
//             Travel & Outdoor, Stable & Farm, Play, Accessories)
//   animal  — who they are shopping for
//
// NAVIGATION vs RESOLUTION — the important distinction in this file:
//
//   Horse and Cattle are the animal collections surfaced in primary customer
//   navigation (header, mega menu, homepage discovery, shop filters, footer).
//
//   Dog and Cat are `legacy: true`. They are DELIBERATELY absent from every
//   navigation surface, but they still RESOLVE: `/category/dog`,
//   `/category/cat`, `/category/dog-supplies` and `/category/cat-supplies`
//   all render a working, indexable collection page. Existing Dog/Cat product
//   rows are untouched and remain reachable through search, Shop All, tags and
//   their own product URLs.
//
//   Use NAV_COLLECTIONS to build navigation. Use COLLECTIONS (or
//   resolveCollection) to resolve a URL. Never build nav from COLLECTIONS.
//
// Other rules that make this safe:
//   • No product data is mutated, renamed or destroyed. A collection is a
//     PREDICATE over the live catalog, evaluated at render time.
//   • A collection with no matching products renders an honest empty state.
//     Horse and Cattle are first-class navigation *because the brand sells
//     into those categories* — they are never padded with invented products.
//   • `image` must be a repo-local asset or a real catalog photograph. No
//     third-party hotlinks: a remote host we do not control must never be a
//     permanent dependency of storefront category imagery.
// ============================================================================

export type CollectionKind = 'need' | 'animal';

export interface Collection {
  /** Route slug — /category/<slug> */
  slug: string;
  label: string;
  kind: CollectionKind;
  /** Short line used on tiles, page heads and meta descriptions. */
  blurb: string;
  /** Legacy DB category names that belong here. */
  categories: string[];
  /** Matched against "name + tags + category", lowercased. */
  keywords?: RegExp;
  /** Legacy slugs that must keep resolving to this collection. */
  aliases?: string[];
  /**
   * Optional repo-local editorial image (e.g. '/collections/horse.jpg') used
   * when the collection has no product photograph yet. NEVER a remote URL —
   * see the header note. Absent by default: the card falls back to its
   * designed ink plate, which is preferable to borrowed stock photography.
   */
  image?: string;
  /**
   * Resolves and indexes, but is excluded from primary navigation.
   * Kept for backwards compatibility with existing products and URLs.
   */
  legacy?: boolean;
}

/** Minimal structural shape a product must satisfy to be matched. */
export interface MatchableProduct {
  name: string;
  category: string;
  tags: string[];
}

// ── Need-based collections — the primary top-level architecture ────────────
// Deliberately NOT "Dog / Cat first". Luxedge merchandises by the job to be
// done; the animal is a lens applied on top.

export const NEED_COLLECTIONS: Collection[] = [
  {
    slug: 'feeding-water',
    label: 'Feeding & Water',
    kind: 'need',
    blurb: 'Bowls, feeders, fountains, buckets and troughs for every daily feed.',
    categories: ['Feeding & Water'],
    keywords: /\b(bowl|feeder|feeding|fountain|waterer|trough|bucket|hay net|slow feed|dispenser|scoop)\b/,
  },
  {
    slug: 'comfort-rest',
    label: 'Comfort & Rest',
    kind: 'need',
    blurb: 'Beds, mats, blankets and bedding built for real, repeated use.',
    categories: ['Pet Beds'],
    aliases: ['pet-beds'],
    keywords: /\b(bed|mattress|mat|blanket|cushion|bolster|crate pad|sofa|nest|bedding|rug)\b/,
  },
  {
    slug: 'grooming-care',
    label: 'Grooming & Care',
    kind: 'need',
    blurb: 'Brushes, combs, clippers and coat care — barn stall to bathroom.',
    categories: ['Grooming'],
    aliases: ['grooming'],
    keywords: /\b(brush|comb|groom|grooming|shampoo|clipper|nail|deshed|de-shed|curry|hoof pick|shear|trimmer|towel)\b/,
  },
  {
    slug: 'travel-outdoor',
    label: 'Travel & Outdoor',
    kind: 'need',
    blurb: 'Carriers, car gear, trail kit and weather protection for the road.',
    categories: [],
    keywords: /\b(carrier|backpack|travel|car seat|seat cover|crate|trailer|hike|hiking|outdoor|trail|boots?|cooling|rain|waterproof|portable|camp)\b/,
  },
  {
    slug: 'stable-farm',
    label: 'Stable & Farm',
    kind: 'need',
    blurb: 'Barn, paddock and pasture essentials for working animals.',
    categories: [],
    keywords: /\b(stable|stall|barn|paddock|pasture|fence|halter|lead rope|saddle|bridle|girth|farrier|hoof|livestock|equine|bovine|tack|manure|pitchfork|feed bag)\b/,
  },
  {
    slug: 'play-enrichment',
    label: 'Play & Enrichment',
    kind: 'need',
    blurb: 'Toys and puzzles that answer real instinct, not shelf filler.',
    categories: ['Pet Toys'],
    aliases: ['pet-toys'],
    keywords: /\b(toy|ball|rope|chew|teaser|wand|puzzle|disc|frisbee|tug|squeak|enrich|scratch|treat dispens)\b/,
  },
  {
    slug: 'accessories',
    label: 'Accessories',
    kind: 'need',
    blurb: 'Collars, leads, harnesses, tags and the small things worn daily.',
    categories: ['Pet Accessories'],
    aliases: ['pet-accessories'],
    keywords: /\b(collar|leash|lead|harness|tag|id tag|apparel|coat|vest|bandana|clip|hook|strap)\b/,
  },
];

// ── Animal collections ─────────────────────────────────────────────────────
// Horse and Cattle are the navigable animals. Dog and Cat are legacy: they
// resolve for existing products and indexed URLs but are not promoted.

export const ANIMAL_COLLECTIONS: Collection[] = [
  {
    slug: 'horse',
    label: 'Horse',
    kind: 'animal',
    blurb: 'Tack room, stall and turnout essentials for horses and ponies.',
    categories: [],
    keywords: /\b(horse|horses|equine|equestrian|pony|ponies|stallion|mare|foal|saddle|bridle|halter|hoof|mane|farrier|stall|tack)\b/,
  },
  {
    slug: 'cattle',
    label: 'Cattle',
    kind: 'animal',
    blurb: 'Herd and homestead gear built for weather, weight and wear.',
    categories: [],
    keywords: /\b(cattle|cow|cows|calf|calves|bovine|heifer|steer|livestock|herd|ear tag)\b/,
  },
  {
    slug: 'dog',
    label: 'Dog',
    kind: 'animal',
    blurb: 'Walking, training, rest and play for dogs of every size.',
    categories: ['Dog Supplies'],
    aliases: ['dog-supplies'],
    legacy: true,
    keywords: /\b(dog|dogs|puppy|puppies|canine|k9)\b/,
  },
  {
    slug: 'cat',
    label: 'Cat',
    kind: 'animal',
    blurb: 'Comfort, play and daily care for indoor and outdoor cats.',
    categories: ['Cat Supplies'],
    aliases: ['cat-supplies'],
    legacy: true,
    keywords: /\b(cat|cats|kitten|kittens|feline|litter|scratching)\b/,
  },
];

/** Every collection, navigable or legacy. Use for URL resolution, not for nav. */
export const COLLECTIONS: Collection[] = [...ANIMAL_COLLECTIONS, ...NEED_COLLECTIONS];

/** Animal collections that appear in navigation — Horse and Cattle. */
export const PRIMARY_ANIMAL_COLLECTIONS: Collection[] = ANIMAL_COLLECTIONS.filter((c) => !c.legacy);

/**
 * The ONLY list navigation surfaces should build from. Excludes legacy
 * collections (Dog, Cat) while leaving their URLs fully functional.
 */
export const NAV_COLLECTIONS: Collection[] = COLLECTIONS.filter((c) => !c.legacy);

/** Slug → collection, including every legacy alias. */
const BY_SLUG: Map<string, Collection> = (() => {
  const m = new Map<string, Collection>();
  for (const c of COLLECTIONS) {
    m.set(c.slug, c);
    for (const a of c.aliases || []) m.set(a, c);
  }
  return m;
})();

/** Resolve a route slug (new or legacy) to a collection. */
export function resolveCollection(slug?: string | null): Collection | null {
  if (!slug) return null;
  return BY_SLUG.get(slug.toLowerCase()) || null;
}

/**
 * Legacy DB category names that never resolved to a collection still need a
 * working URL (an admin can create any category at any time). This builds an
 * ad-hoc collection so `/category/<anything>` never 404s into an empty shop.
 */
export function collectionForCategoryName(name: string): Collection {
  const existing = COLLECTIONS.find((c) => c.categories.includes(name));
  if (existing) return existing;
  return {
    slug: slugify(name),
    label: name,
    kind: 'need',
    blurb: `Browse the Luxedge ${name} selection.`,
    categories: [name],
  };
}

export function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function haystack(p: MatchableProduct): string {
  return `${p.name} ${(p.tags || []).join(' ')} ${p.category}`.toLowerCase();
}

/** Does this product belong in this collection? */
export function matchesCollection(product: MatchableProduct, collection: Collection): boolean {
  if (collection.categories.length && collection.categories.includes(product.category)) return true;
  if (collection.keywords) return collection.keywords.test(haystack(product));
  return false;
}

export function filterByCollection<T extends MatchableProduct>(products: T[], collection: Collection | null): T[] {
  if (!collection) return products;
  return products.filter((p) => matchesCollection(p, collection));
}

export function countIn(products: MatchableProduct[], collection: Collection): number {
  let n = 0;
  for (const p of products) if (matchesCollection(p, collection)) n++;
  return n;
}

/** True when this collection resolves but is kept out of navigation. */
export function isLegacyCollection(c: Collection | null | undefined): boolean {
  return Boolean(c?.legacy);
}

/**
 * Collections that currently have stock, in navigation order. Used for
 * merchandising rails so an empty collection never fills a product slot —
 * it still gets a nav entry, just not a fake row of products.
 */
export function populatedCollections(products: MatchableProduct[], kind?: CollectionKind): Collection[] {
  const pool = kind ? NAV_COLLECTIONS.filter((c) => c.kind === kind) : NAV_COLLECTIONS;
  return pool.filter((c) => countIn(products, c) > 0);
}

/**
 * Best collection to *describe* a product (PDP breadcrumb, related-products
 * heading). Prefers a navigable collection so a breadcrumb never sends the
 * customer into a collection that navigation does not acknowledge; falls back
 * to the legacy one only when nothing else matches.
 */
export function primaryCollectionFor(product: MatchableProduct): Collection | undefined {
  return NAV_COLLECTIONS.find((c) => matchesCollection(product, c))
    || COLLECTIONS.find((c) => matchesCollection(product, c));
}

/**
 * Header mega-menu structure — derived from the taxonomy, never duplicated.
 * Deliberately contains no legacy slugs; `legacySlugsInNav` guards this and is
 * asserted in the taxonomy tests.
 */
export const MEGA_COLUMNS: { title: string; slugs: string[] }[] = [
  { title: 'Shop by animal', slugs: ['horse', 'cattle'] },
  { title: 'Feed & rest', slugs: ['feeding-water', 'comfort-rest'] },
  { title: 'Care & play', slugs: ['grooming-care', 'play-enrichment'] },
  { title: 'Out & about', slugs: ['travel-outdoor', 'stable-farm', 'accessories'] },
];

/**
 * Guard for the "legacy resolves but is never promoted" invariant. Returns any
 * legacy slug that has leaked into a navigation surface. Asserted in tests so
 * re-promoting Dog or Cat into the header, mega menu, homepage discovery or
 * shop filters fails CI rather than shipping quietly.
 */
export function legacySlugsInNav(): string[] {
  const legacy = new Set(COLLECTIONS.filter((c) => c.legacy).map((c) => c.slug));
  const leaked = new Set<string>();
  for (const c of NAV_COLLECTIONS) if (legacy.has(c.slug)) leaked.add(c.slug);
  for (const col of MEGA_COLUMNS) for (const slug of col.slugs) if (legacy.has(slug)) leaked.add(slug);
  return [...leaked];
}

/**
 * Collection slugs that belong in the generated sitemap. Legacy ALIASES stay
 * (e.g. /category/dog-supplies was already indexed and must keep resolving),
 * but the legacy canonical slugs this taxonomy introduced — /category/dog and
 * /category/cat — are NOT newly promoted, because they are not part of the
 * primary taxonomy. They still resolve if a crawler or an old link reaches
 * them; they are simply not advertised.
 */
export function sitemapCollectionSlugs(): string[] {
  const slugs = NAV_COLLECTIONS.map((c) => c.slug);
  for (const c of COLLECTIONS) {
    if (!c.legacy) continue;
    for (const alias of c.aliases || []) slugs.push(alias);
  }
  return slugs;
}
