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
//   animal  — who they are shopping for (Horse, Cattle, Dog, Cat)
//
// Rules that make this safe:
//   • No product data is mutated, renamed or destroyed. A collection is a
//     PREDICATE over the live catalog, evaluated at render time.
//   • Every legacy `/category/<slug>` URL still resolves (see `aliases`), so
//     indexed URLs, the sitemap and existing links keep working.
//   • A collection with no matching products renders an honest empty state.
//     Horse and Cattle are first-class navigation *because the brand sells
//     into those categories* — they are never padded with invented products.
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
  /** Editorial imagery used when the collection has no product photo yet. */
  image?: string;
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

// ── Animal collections — Horse and Cattle lead, by design ──────────────────

export const ANIMAL_COLLECTIONS: Collection[] = [
  {
    slug: 'horse',
    label: 'Horse',
    kind: 'animal',
    blurb: 'Tack room, stall and turnout essentials for horses and ponies.',
    categories: [],
    keywords: /\b(horse|horses|equine|equestrian|pony|ponies|stallion|mare|foal|saddle|bridle|halter|hoof|mane|farrier|stall|tack)\b/,
    image: 'https://images.pexels.com/photos/12523634/pexels-photo-12523634.jpeg?auto=compress&cs=tinysrgb&w=900',
  },
  {
    slug: 'cattle',
    label: 'Cattle',
    kind: 'animal',
    blurb: 'Herd and homestead gear built for weather, weight and wear.',
    categories: [],
    keywords: /\b(cattle|cow|cows|calf|calves|bovine|heifer|steer|livestock|herd|ear tag)\b/,
    image: 'https://images.pexels.com/photos/11684963/pexels-photo-11684963.jpeg?auto=compress&cs=tinysrgb&w=900',
  },
  {
    slug: 'dog',
    label: 'Dog',
    kind: 'animal',
    blurb: 'Walking, training, rest and play for dogs of every size.',
    categories: ['Dog Supplies'],
    aliases: ['dog-supplies'],
    keywords: /\b(dog|dogs|puppy|puppies|canine|k9)\b/,
  },
  {
    slug: 'cat',
    label: 'Cat',
    kind: 'animal',
    blurb: 'Comfort, play and daily care for indoor and outdoor cats.',
    categories: ['Cat Supplies'],
    aliases: ['cat-supplies'],
    keywords: /\b(cat|cats|kitten|kittens|feline|litter|scratching)\b/,
  },
];

export const COLLECTIONS: Collection[] = [...ANIMAL_COLLECTIONS, ...NEED_COLLECTIONS];

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

/**
 * Collections that currently have stock, in navigation order. Used for
 * merchandising rails so an empty collection never fills a product slot —
 * it still gets a nav entry, just not a fake row of products.
 */
export function populatedCollections(products: MatchableProduct[], kind?: CollectionKind): Collection[] {
  const pool = kind ? COLLECTIONS.filter((c) => c.kind === kind) : COLLECTIONS;
  return pool.filter((c) => countIn(products, c) > 0);
}

/** Header mega-menu structure — derived from the taxonomy, never duplicated. */
export const MEGA_COLUMNS: { title: string; slugs: string[] }[] = [
  { title: 'Shop by animal', slugs: ['horse', 'cattle', 'dog', 'cat'] },
  { title: 'Feed & rest', slugs: ['feeding-water', 'comfort-rest'] },
  { title: 'Care & play', slugs: ['grooming-care', 'play-enrichment'] },
  { title: 'Out & about', slugs: ['travel-outdoor', 'stable-farm', 'accessories'] },
];
