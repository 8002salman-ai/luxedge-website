// Shared category content — ONE source for the category intro, the selection
// considerations and the related guides.
//
// The worker's server-rendered category page and the client collection page
// both read this module, so the crawl HTML and the hydrated DOM always agree.
// Before this, the intro existed twice (CAT_META in src/App.tsx and
// CATEGORY_DESC in worker/seo-meta.ts) with a "keep in sync" comment, while the
// pages themselves carried only a single descriptive line and the product grid.
//
// The considerations are deliberately practical and evidence-free: sizing,
// placement, cleaning and fit-check guidance a buyer can verify against the
// listing itself. Nothing here states a specification, certification or
// performance claim about a product.
//
// Keys are category slugs (see CAT_LIST / toSlug in src/App.tsx).
export interface CategoryContent {
  /** One-line intro (mirrors the categories.description shown in the UI). */
  desc: string;
  /** 2–4 genuine selection considerations for this category. */
  considerations: string[];
  /** Related published guides — only guides that exist and are indexable. */
  guides: { label: string; href: string }[];
}

export const CATEGORY_CONTENT: Record<string, CategoryContent> = {
  'dog-supplies': {
    desc: 'Walking, training & everyday dog essentials',
    considerations: [
      'Measure your dog before choosing a harness, collar or bed — chest girth decides harness size far more reliably than breed, age or weight.',
      'Match the hardware to the job: a front-clip harness for a dog that pulls, a back-clip for relaxed walking, and check the buckle style where a strap takes daily load.',
      'Look for a removable, washable cover or strap so everyday gear can be kept clean.',
      'Confirm the listed size, material and delivery details before ordering.',
    ],
    guides: [{ label: 'How to fit a no-pull dog harness', href: '/blog/how-to-fit-no-pull-dog-harness' }],
  },
  'cat-supplies': {
    desc: 'Play, comfort & everyday cat essentials',
    considerations: [
      'Cats prefer quiet, low-traffic spots — where you place something often matters more than what you buy.',
      'Check the listed dimensions against the space you actually have; cat furniture and tunnels look smaller in photos than on the floor.',
      'Rotating a small set of toys weekly keeps play novel for longer than leaving everything out at once.',
    ],
    guides: [{ label: 'How to choose a cat tunnel', href: '/blog/how-to-choose-a-cat-tunnel' }],
  },
  'pet-beds': {
    desc: 'Comfort-led pieces for deeper rest',
    considerations: [
      'Match the bed to how your pet sleeps: curlers want raised edges to lean against, stretchers want an open flat surface.',
      'Measure your pet nose-to-tail and add a few inches of room so it can stretch out.',
      'Look for a removable, washable cover and read the stated inner material — an easy-to-clean bed gets cleaned more often.',
    ],
    guides: [],
  },
  'pet-toys': {
    desc: 'Interactive play and everyday enrichment',
    considerations: [
      'Choose for your pet’s natural behaviour — chase, chew or forage — rather than for how the toy looks.',
      'Check the stated material and size, supervise chewing, and replace anything with cracked or detached parts.',
      'Rotate a small selection weekly instead of leaving every toy out at once.',
    ],
    guides: [{ label: 'How to choose a cat tunnel', href: '/blog/how-to-choose-a-cat-tunnel' }],
  },
  'feeding-water': {
    desc: 'Considered pieces for daily mealtimes',
    considerations: [
      'Check the stated capacity against how often you want to refill, and confirm the listed dimensions fit where you will put it.',
      'Separating eating and drinking stations can help — many cats prefer water away from their food.',
      'Read the cleaning instructions first: filters and narrow openings need a routine you will realistically keep.',
    ],
    guides: [],
  },
  grooming: {
    desc: 'Simple tools for everyday care',
    considerations: [
      'Choose tools for your animal’s coat type — short, long or double coat — and check the stated size and bristle or blade type.',
      'Work in short sessions and stop if the animal shows discomfort; introduce unfamiliar tools gradually.',
      'Keep tools clean and check them for wear before each use.',
    ],
    guides: [{ label: 'Horse grooming kit buyer’s guide', href: '/blog/horse-grooming-kit-buyers-guide' }],
  },
  'pet-accessories': {
    desc: 'Useful pieces for life together',
    considerations: [
      'Measure before ordering: straps, carriers and boots are sized, and poor fit is the most common reason gear gets retired.',
      'Confirm exactly what the listing includes — sets and multi-packs are named explicitly in each product.',
      'For carriers or restraints used while travelling, follow the maker’s instructions and check the airline’s or vehicle’s current requirements yourself.',
    ],
    guides: [{ label: 'How to fit a no-pull dog harness', href: '/blog/how-to-fit-no-pull-dog-harness' }],
  },
  'bird-supplies': {
    desc: 'Seed, feed & care essentials for feathered friends',
    considerations: [
      'Different feeders suit different birds: tube feeders favour smaller birds, while hopper and tray feeders suit larger ones.',
      'Keep seed and feeders dry — damp seed spoils quickly, which is why roofs, drainage and a cleaning routine matter.',
      'Check the stated capacity and the mounting or hanging method against where you plan to place it.',
    ],
    guides: [
      { label: 'Best bird feeder buyer’s guide', href: '/blog/best-bird-feeder-buyers-guide' },
      { label: 'How to clean a bird feeder', href: '/blog/how-to-clean-a-bird-feeder' },
    ],
  },
  horse: {
    desc: 'Practical care and stable essentials for horses',
    considerations: [
      'Fit matters more than brand on anything the horse wears: check the maker’s sizing chart and adjust for even pressure, with no rubbing at the eyes, noseband or shoulders.',
      'Measure before ordering halters, masks and blankets — sizing differs between makers.',
      'For feed and mineral products, read the label and confirm suitability for your horse with your vet or a nutrition professional.',
    ],
    guides: [
      { label: 'Horse grooming kit buyer’s guide', href: '/blog/horse-grooming-kit-buyers-guide' },
      { label: 'Horse halter & lead rope sizing', href: '/blog/horse-halter-lead-rope-buyers-guide' },
      { label: 'Horse fly mask fit guide', href: '/blog/horse-fly-mask-buyers-guide' },
    ],
  },
  cattle: {
    desc: 'Useful feeding and care essentials for cattle and livestock',
    considerations: [
      'Decide whether the item is for feed or water first — cleaning, placement and daily-check needs differ.',
      'Measure the site and plan refilling, cleaning and drainage before buying a trough.',
      'Confirm the capacity, dimensions and material stated for the specific listing.',
    ],
    guides: [{ label: 'Choosing a cattle trough for feed or water', href: '/blog/how-to-choose-cattle-trough-feed-water-setup' }],
  },
};

/** Lookup by slug, tolerant of a display name ("Dog Supplies"). */
export function categoryContentFor(slugOrName: string): CategoryContent | null {
  const slug = String(slugOrName || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return CATEGORY_CONTENT[slug] || null;
}
