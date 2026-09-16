/**
 * Sitewide navigation, defined once.
 *
 * Four surfaces render from this module: the React header strip, the mobile
 * drawer, the React footer, and the flat crawlable footer the worker
 * pre-renders into #root (worker/seo-meta.ts) so utility pages have inbound SSR
 * links. Those surfaces used to keep private copies of the same lists, which is
 * how a route rename or a menu edit could land in one and not the others.
 *
 * Labels stay per surface on purpose — a crawlable footer, a 13px strip and a
 * thumb-sized drawer tile do not want the same words ("Shop All" vs "All
 * Products" vs "Shop All Products"). Every destination they point at is named
 * once in NAV_PATHS, so a route rename is a one-line edit here.
 */

/** Every route sitewide navigation links to. Nothing outside this map. */
export const NAV_PATHS = {
  home: '/',
  shop: '/shop',
  deals: '/shop?q=deal',
  blog: '/blog',
  about: '/about',
  contact: '/contact',
  faq: '/faq',
  orders: '/orders',
  shipping: '/shipping-policy',
  returns: '/returns',
  copyright: '/copyright',
  editorialPolicy: '/editorial-policy',
  disclaimer: '/disclaimer',
  privacy: '/privacy',
  terms: '/terms',
  sitemap: '/sitemap',
  dogSupplies: '/category/dog-supplies',
  catSupplies: '/category/cat-supplies',
  birdSupplies: '/category/bird-supplies',
  horseSupplies: '/category/horse',
  livestock: '/category/cattle',
  accessories: '/category/pet-accessories',
  beds: '/category/pet-beds',
  feeding: '/category/feeding-water',
  grooming: '/category/grooming',
  toys: '/category/pet-toys',
} as const;

export type NavLink = { label: string; to: string };

/** A dropdown panel: `label` must match the strip item that opens it. */
export type MegaPanel = {
  label: string;
  to: string;
  groups: { title: string; links: NavLink[] }[];
};

/** Top utility bar, above the main header. */
export const UTILITY_NAV: NavLink[] = [
  { label: 'Track Order', to: NAV_PATHS.orders },
  { label: 'Contact', to: NAV_PATHS.contact },
  { label: 'FAQ', to: NAV_PATHS.faq },
];

/**
 * Desktop strip. `all` and `deals` are separated in the markup (left cluster,
 * amber pill on the right), so they are named rather than positional.
 * A `megaKey` marks the items backed by a MEGA_MENU panel; Bird has none
 * because birds have a single category, so a panel would only repeat it.
 */
export const STRIP_NAV: { all: NavLink; items: (NavLink & { megaKey?: string })[]; deals: NavLink } = {
  all: { label: 'Shop All', to: NAV_PATHS.shop },
  items: [
    { label: 'Dog', to: NAV_PATHS.dogSupplies, megaKey: 'Dog' },
    { label: 'Cat', to: NAV_PATHS.catSupplies, megaKey: 'Cat' },
    { label: 'Bird', to: NAV_PATHS.birdSupplies },
    { label: 'Horse', to: NAV_PATHS.horseSupplies },
    { label: 'Livestock', to: NAV_PATHS.livestock },
    { label: 'Accessories', to: NAV_PATHS.accessories },
    { label: 'Blog', to: NAV_PATHS.blog },
    { label: 'About', to: NAV_PATHS.about },
  ],
  deals: { label: 'Deals', to: NAV_PATHS.deals },
};

/**
 * Panels open from the strip. Paired labels that opened one category were
 * merged into a single label, so no two links in a panel lead to the same page.
 */
export const MEGA_MENU: MegaPanel[] = [
  {
    label: 'Dog', to: NAV_PATHS.dogSupplies,
    groups: [
      { title: 'Walking & Gear', links: [{ label: 'Harnesses & Collars', to: NAV_PATHS.dogSupplies }, { label: 'Travel Accessories', to: NAV_PATHS.accessories }] },
      { title: 'Comfort', links: [{ label: 'Beds, Blankets & Mats', to: NAV_PATHS.beds }] },
      { title: 'Feeding', links: [{ label: 'Bowls, Feeders & Water Bottles', to: NAV_PATHS.feeding }] },
      { title: 'Grooming', links: [{ label: 'Brushes & Grooming Tools', to: NAV_PATHS.grooming }] },
      { title: 'Play', links: [{ label: 'Chew, Rope & Tug Toys', to: NAV_PATHS.toys }] },
    ],
  },
  {
    label: 'Cat', to: NAV_PATHS.catSupplies,
    groups: [
      { title: 'Play', links: [{ label: 'Toys & Wands', to: NAV_PATHS.toys }] },
      { title: 'Comfort', links: [{ label: 'Beds & Caves', to: NAV_PATHS.beds }, { label: 'Perches, Towers & Scratching', to: NAV_PATHS.catSupplies }] },
      { title: 'Feeding', links: [{ label: 'Bowls, Fountains & Feeders', to: NAV_PATHS.feeding }] },
      { title: 'Grooming', links: [{ label: 'Brushes & Nail Care', to: NAV_PATHS.grooming }] },
    ],
  },
];

/** Mobile drawer: six category tiles, then the general links. */
export const DRAWER_NAV: { tiles: NavLink[]; links: (NavLink & { highlight?: boolean })[] } = {
  tiles: [
    { label: '🐶 Dog Supplies', to: NAV_PATHS.dogSupplies },
    { label: '🐱 Cat Supplies', to: NAV_PATHS.catSupplies },
    { label: '🦜 Bird Supplies', to: NAV_PATHS.birdSupplies },
    { label: '🐴 Horse Supplies', to: NAV_PATHS.horseSupplies },
    { label: '🐄 Livestock', to: NAV_PATHS.livestock },
    { label: '✨ Accessories', to: NAV_PATHS.accessories },
  ],
  links: [
    { label: 'Shop All Products', to: NAV_PATHS.shop },
    { label: 'Care Guides & Blog', to: NAV_PATHS.blog },
    { label: 'About Us', to: NAV_PATHS.about },
    { label: 'Contact & Help', to: NAV_PATHS.contact },
    { label: '🔥 Special Deals', to: NAV_PATHS.deals, highlight: true },
  ],
};

/** React footer columns. The last column carries the secure-payments note. */
export const FOOTER_COLUMNS: { title: string; links: NavLink[]; paymentsNote?: boolean }[] = [
  {
    title: 'Shop',
    links: [
      { label: 'All Products', to: NAV_PATHS.shop },
      { label: 'Dog Supplies', to: NAV_PATHS.dogSupplies },
      { label: 'Cat Supplies', to: NAV_PATHS.catSupplies },
      { label: 'Bird Supplies', to: NAV_PATHS.birdSupplies },
      { label: 'Horse Supplies', to: NAV_PATHS.horseSupplies },
      { label: 'Livestock Supplies', to: NAV_PATHS.livestock },
      { label: 'Accessories', to: NAV_PATHS.accessories },
    ],
  },
  { title: 'Learn', links: [{ label: 'Blog & Guides', to: NAV_PATHS.blog }] },
  {
    title: 'Help',
    links: [
      { label: 'Track Order', to: NAV_PATHS.orders },
      { label: 'Shipping Policy', to: NAV_PATHS.shipping },
      { label: 'Returns & Refunds', to: NAV_PATHS.returns },
      { label: 'FAQs', to: NAV_PATHS.faq },
      { label: 'Contact Us', to: NAV_PATHS.contact },
    ],
  },
  {
    title: 'Company',
    paymentsNote: true,
    links: [
      { label: 'About Luxedge', to: NAV_PATHS.about },
      { label: 'Copyright & DMCA', to: NAV_PATHS.copyright },
      { label: 'Editorial Policy', to: NAV_PATHS.editorialPolicy },
      { label: 'Disclaimer', to: NAV_PATHS.disclaimer },
      { label: 'Privacy Policy', to: NAV_PATHS.privacy },
      { label: 'Terms of Service', to: NAV_PATHS.terms },
      { label: 'Sitemap', to: NAV_PATHS.sitemap },
    ],
  },
];

/**
 * The flat footer the worker renders into #root before hydration, so crawlers
 * and no-JS visitors reach the utility pages. Plain inline styling: Tailwind
 * does not scan worker/seo-meta.ts. Shorter, crawl-first labels than the React
 * footer, pointing at the same routes.
 */
export const SSR_FOOTER_NAV: NavLink[] = [
  { label: 'Shop All', to: NAV_PATHS.shop },
  { label: 'Blog', to: NAV_PATHS.blog },
  { label: 'About', to: NAV_PATHS.about },
  { label: 'Contact', to: NAV_PATHS.contact },
  { label: 'FAQ', to: NAV_PATHS.faq },
  { label: 'Shipping Policy', to: NAV_PATHS.shipping },
  { label: 'Returns', to: NAV_PATHS.returns },
  { label: 'Copyright & DMCA', to: NAV_PATHS.copyright },
  { label: 'Editorial Policy', to: NAV_PATHS.editorialPolicy },
  { label: 'Disclaimer', to: NAV_PATHS.disclaimer },
  { label: 'Privacy Policy', to: NAV_PATHS.privacy },
  { label: 'Terms of Service', to: NAV_PATHS.terms },
  { label: 'Sitemap', to: NAV_PATHS.sitemap },
];
