import { isLinkablePublicPath } from './reviewHolds';

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
// performance claim about a product. Measured on production, category pages
// carried under 300 words of visible text, which is the profile Google's thin
// content guidance describes, so each set is written to be genuinely useful to
// someone choosing between listings rather than to hit a length.
//
// Keys are category slugs (see CAT_LIST / toSlug in src/App.tsx).
export interface CategoryContent {
  /** One-line intro (mirrors the categories.description shown in the UI). */
  desc: string;
  /** 4–6 genuine selection considerations for this category. */
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
      'For anything worn, the fit check matters more than the size label. Two flat fingers should slide under every strap, and nothing should press on the throat or sit in the armpit.',
      'Think about the surface you walk on. Rough ground, hot pavement and winter salt each need something different from a plain collar and lead.',
      'Look for removable, washable parts on anything that touches the coat, so everyday gear can actually be kept clean.',
      'Introduce new equipment gradually and indoors first — a harness, booties or clothing worn for the first time on a full walk rarely goes well.',
      'Confirm the listed size, material and delivery details for the specific product before ordering; where a size chart is not published, ask us rather than guessing.',
    ],
    guides: [{ label: 'How to fit a no-pull dog harness', href: '/blog/how-to-fit-no-pull-dog-harness' }],
  },
  'cat-supplies': {
    desc: 'Play, comfort & everyday cat essentials',
    considerations: [
      'Cats prefer quiet, low-traffic spots — where you place something often matters more than what you buy.',
      'Check the listed dimensions against the space you actually have; cat furniture and tunnels look smaller in photos than on the floor.',
      'Height and escape routes matter to cats more than to dogs. Something they can sit above, or hide inside and leave from two directions, gets used far more.',
      'Rotating a small set of toys weekly keeps play novel for longer than leaving everything out at once.',
      'Weight limits matter on anything that mounts to a wall, window or door. If a limit is not published, ask before you rely on it.',
      'Watch how your cat uses new gear for the first few days and take it away if there is any sign of rubbing, wobbling or chewing.',
    ],
    guides: [{ label: 'How to choose a cat tunnel', href: '/blog/how-to-choose-a-cat-tunnel' }],
  },
  'pet-beds': {
    desc: 'Comfort-led pieces for deeper rest',
    considerations: [
      'Match the bed to how your pet sleeps: curlers want raised edges to lean against, stretchers want an open flat surface.',
      'Measure your pet nose-to-tail and add a few inches of room so it can stretch out. A bed that is too small gets ignored.',
      'Look for a removable, washable cover and read the stated inner material — an easy-to-clean bed gets cleaned more often.',
      'Think about where it will sit: out of draughts, on a non-slip surface, and away from a radiator for an older animal.',
      'A bed is a comfort product, not a treatment. For an older pet with mobility problems, a stable position and a non-slip floor help more than the bed alone.',
      'Wash covers as often as you would your own bedding, and replace a bed once the filling flattens or the cover tears.',
    ],
    guides: [],
  },
  'pet-toys': {
    desc: 'Interactive play and everyday enrichment',
    considerations: [
      'Choose for your pet’s natural behaviour — chase, chew or forage — rather than for how the toy looks.',
      'Supervise chewing, inspect toys regularly, and replace anything with cracked, split or detached parts.',
      'Match the size to your pet. A toy small enough to swallow, or a rope long enough to tangle, is a hazard rather than enrichment.',
      'Rotate a small selection weekly instead of leaving every toy out at once; novelty is what keeps play going.',
      'Retire any toy that has been chewed through — squeakers and stuffing are the parts that cause trouble.',
      'For interactive feeders, start easy and work up. A puzzle that is too hard gets abandoned rather than solved.',
    ],
    guides: [{ label: 'How to choose a cat tunnel', href: '/blog/how-to-choose-a-cat-tunnel' }],
  },
  'feeding-water': {
    desc: 'Considered pieces for daily mealtimes',
    considerations: [
      'Check the stated capacity against how often you want to refill, and confirm the listed dimensions fit where you will put it.',
      'Separating eating and drinking stations can help — many cats prefer water away from their food.',
      'Read the cleaning instructions first: filters and narrow openings need a routine you will realistically keep.',
      'Think about stability. A bowl that slides, or a mat that curls, gets pushed around the floor and spills.',
      'Whisker clearance matters for cats: a deep, narrow bowl can put them off eating, which is why shallow dishes are often preferred.',
      'For anything electric, plan where the cable and the water will be relative to each other, and check the manufacturer’s cleaning instructions before submerging any part of it.',
    ],
    // No guide in this category yet. A cattle-trough guide is not relevant to
    // dog and cat feeding gear, and linking it here would be a false match.
    guides: [],
  },
  grooming: {
    desc: 'Simple tools for everyday care',
    considerations: [
      'Choose tools for your animal’s coat type — short, long or double coat — and check the stated size and bristle or blade type.',
      'Work in short sessions and stop if the animal shows discomfort; introduce unfamiliar tools gradually.',
      'Keep tools clean and check them for wear before each use.',
      'Go slowly around the face, ears and paws. Most animals tolerate handling everywhere else long before they accept those areas.',
      'For nails, take small passes and stop well short of the quick. A grinder or clipper that takes too much at once is the usual reason grooming turns into a struggle.',
      'Clean hair out of brushes and grinder heads after every session; matted, dusty tools pull and hurt.',
    ],
    guides: [{ label: 'Horse grooming kit buyer’s guide', href: '/blog/horse-grooming-kit-buyers-guide' }],
  },
  'pet-accessories': {
    desc: 'Useful pieces for life together',
    considerations: [
      'Measure before ordering: straps, carriers and boots are sized, and poor fit is the most common reason gear gets retired.',
      'Confirm exactly what the listing includes — sets and multi-packs are named explicitly in each product.',
      'For carriers or restraints used while travelling, follow the maker’s instructions and check the airline’s or vehicle’s current requirements yourself.',
      'A car restraint is there to keep a pet in place during a journey; treat it as a restraint rather than a protective device. Tether to a harness rather than a collar, and check the fitting against your own vehicle.',
      'For anything with buckles, clips or vacuum cups, check it before each use — these are the parts that fail first, and they fail after wear rather than on day one.',
      'Keep consumables topped up. Pick-up bags and the like are the items you least want to run out of mid-walk.',
    ],
    guides: [{ label: 'How to fit a no-pull dog harness', href: '/blog/how-to-fit-no-pull-dog-harness' }],
  },
  'bird-supplies': {
    desc: 'Seed, feed & care essentials for feathered friends',
    considerations: [
      'Different feeders suit different birds: tube feeders favour smaller birds, while hopper and tray feeders suit larger ones.',
      'Keep seed and feeders dry — damp seed spoils quickly, which is why roofs, drainage and a cleaning routine matter.',
      'Check the stated capacity and the mounting or hanging method against where you plan to place it.',
      'Position counts: keep feeders clear of windows to reduce window strikes, and within reach of cover so birds can approach safely.',
      'Clean feeders regularly and discard damp or mouldy seed rather than topping it up — dirty feeders spread disease between garden birds.',
      'For water, freshen it often. Standing water and debris are the main hygiene risk with any bird bath.',
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
      'Salt and mineral needs depend on forage, workload and the individual animal, so a lick supports a diet rather than replacing one. Clean water always needs to be available alongside it.',
      'Check anything worn daily during the first week. Rubbing behind the ears, along the cheekbones or under a strap is the earliest sign that the fit is wrong.',
      'Keep equipment clean and dry, and inspect straps, mesh and hardware for wear before turnout.',
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
      'Think about footing and access: a full trough is heavy, so level ground and a clear approach for every animal in the group matter more than the trough itself.',
      'Empty and scrub between feed types, and check the rim and base for cracks if the trough gets moved.',
      'For anything collapsible or portable, the folding points are what wear out — drain and dry it fully before storing it away.',
    ],
    guides: [{ label: 'Choosing a cattle trough for feed or water', href: '/blog/how-to-choose-cattle-trough-feed-water-setup' }],
  },
};

/** Lookup by slug, tolerant of a display name ("Dog Supplies"). */
export function categoryContentFor(slugOrName: string): CategoryContent | null {
  const slug = String(slugOrName || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const entry = CATEGORY_CONTENT[slug];
  if (!entry) return null;
  // Guide links are filtered here, at the one lookup both render paths and the
  // category hero already share, so a category page can never advertise a guide
  // whose URL is retired (or held). Nothing else needs to know the rule.
  return { ...entry, guides: entry.guides.filter((g) => isLinkablePublicPath(g.href)) };
}
