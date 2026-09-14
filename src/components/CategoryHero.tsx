import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUpRight } from '@phosphor-icons/react';
import { BuyerGuidance } from './BuyerGuidance';

/**
 * CATEGORY HERO CONFIG — one source of truth for every catalog category header.
 * Vary only image, copy, and accent mood per category (per the design brief);
 * the CategoryHero component below renders all of them through the same
 * premium structure: breadcrumb → label → headline → rule → description →
 * CTA → subcategory chips, with the editorial pet image on the right.
 *
 * Mood mapping (per the brief):
 *   Dog    = warm, active, friendly
 *   Cat    = soft, elegant, calm
 *   Horse  = premium, powerful, refined
 *   Bird   = fresh, light, natural
 *   Cattle = strong, practical, trustworthy
 *
 * `tint` selects a subtle band background (classes in index.css); everything
 * else stays on Luxedge's existing luxe-gold / serif design system.
 */

export interface CategoryHeroConfig {
  label: string;          // eyebrow — e.g. "Dog Supplies"
  headline: string;       // strong H1 — e.g. "Gear That Keeps Up With Your Dog"
  desc: string;           // one-line value statement
  image: string;          // editorial pet/lifestyle photo
  imageAlt: string;
  mobileImage?: string;
  imagePosition?: string;
  badge?: string;
  tint: 'dog' | 'cat' | 'horse' | 'bird' | 'cattle' | 'neutral';
  ctaHref: string;        // primary action (scrolls to the product grid)
  ctaLabel: string;
  buyerNote: string;
  chips: { label: string; href: string }[]; // subcategory shortcuts (real links)
}

export const CATEGORY_HERO_CONFIG: Record<string, CategoryHeroConfig> = {
  'Dog Supplies': {
    label: 'Dog Supplies',
    headline: 'Gear That Keeps Up With Your Dog',
    desc: 'Walking, training & everyday dog essentials — picked for comfort, durability and real everyday use.',
    image: 'https://images.unsplash.com/photo-1552053831-71594a27632d?w=720&h=820&fit=crop&crop=faces&auto=format&q=88',
    imageAlt: 'Golden retriever holding a stick on a wooden deck',
    imagePosition: '50% 55%',
    tint: 'dog',
    ctaHref: '#product-grid',
    ctaLabel: 'Shop dog essentials',
    buyerNote: 'Start with the routine you are shopping for—walking, play, rest, feeding, or grooming—then compare the details shown on each listing.',
    chips: [
      { label: 'Toys', href: '/category/pet-toys' },
      { label: 'Beds', href: '/category/pet-beds' },
      { label: 'Grooming', href: '/category/grooming' },
      { label: 'Feeding & Water', href: '/category/feeding-water' },
    ],
  },
  'Cat Supplies': {
    label: 'Cat Supplies',
    headline: 'Soft Comfort for Curious Cats',
    desc: 'Play, comfort & everyday cat essentials — calm, considered pieces your cat will actually love.',
    image: 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=720&h=820&fit=crop&crop=faces&auto=format&q=88',
    imageAlt: 'Black and white cat looking toward the camera',
    tint: 'cat',
    ctaHref: '#product-grid',
    ctaLabel: 'Shop cat essentials',
    buyerNote: 'Choose by the space and routine you have in mind, then compare the product details provided for play, rest, feeding, or travel.',
    chips: [
      { label: 'Toys', href: '/category/pet-toys' },
      { label: 'Beds', href: '/category/pet-beds' },
      { label: 'Accessories', href: '/category/pet-accessories' },
      { label: 'Grooming', href: '/category/grooming' },
    ],
  },
  'Horse': {
    label: 'Horse',
    headline: 'Stable & Field Essentials, Built to Last',
    desc: 'Practical care and stable essentials for horses — quality tack and care you can depend on.',
    image: 'https://images.unsplash.com/photo-1553284965-83fd3e82fa5a?w=720&h=820&fit=crop&crop=faces&auto=format&q=88',
    imageAlt: 'White horse moving beside trees',
    tint: 'horse',
    ctaHref: '#product-grid',
    ctaLabel: 'Shop horse care',
    buyerNote: 'For stable and field supplies, begin with the intended task and compare the product’s listed size, materials, and use details.',
    chips: [
      { label: 'Feeding & Water', href: '/category/feeding-water' },
      { label: 'Cattle & Livestock', href: '/category/cattle' },
      { label: 'Accessories', href: '/category/pet-accessories' },
    ],
  },
  'Bird Supplies': {
    label: 'Bird Supplies',
    headline: 'Fresh Care for Feathered Friends',
    desc: 'Seed, feed & care essentials for birds — light, natural and made for everyday feeding.',
    image: 'https://images.unsplash.com/photo-1552728089-57bdde30beb3?w=720&h=820&fit=crop&crop=top&auto=format&q=88',
    imageAlt: 'Colorful bird perched on a branch',
    imagePosition: '50% 15%',
    tint: 'bird',
    ctaHref: '#product-grid',
    ctaLabel: 'Shop bird supplies',
    buyerNote: 'Start with the type of feeding, care, or enrichment item you need and use the listing details to compare options.',
    chips: [
      { label: 'Feeding & Water', href: '/category/feeding-water' },
      { label: 'Toys', href: '/category/pet-toys' },
    ],
  },
  'Cattle': {
    label: 'Cattle',
    headline: 'Dependable Feeding & Care for Livestock',
    desc: 'Useful feeding and care essentials for cattle and livestock — practical tools for working farms.',
    image: 'https://images.unsplash.com/photo-1500595046743-cd271d694d30?w=720&h=820&fit=crop&crop=faces&auto=format&q=88',
    imageAlt: 'Sturdy cattle on the pasture',
    tint: 'cattle',
    ctaHref: '#product-grid',
    ctaLabel: 'Shop livestock care',
    buyerNote: 'For livestock supplies, match the item to the intended feeding or care task and review the listed size and materials before ordering.',
    chips: [
      { label: 'Feeding & Water', href: '/category/feeding-water' },
      { label: 'Horse Care', href: '/category/horse' },
    ],
  },
};

// Existing lifestyle sources keep the collection photography consistent.
// General collections use context-setting photography, not product thumbnails.
const generalCollections = [
  { name: 'Feeding & Water', headline: 'A little care, every mealtime.', desc: 'Explore bowls, feeders and water essentials for your everyday routine.', source: 'Cat Supplies', chips: ['Dog Supplies', 'Cat Supplies', 'Cattle'] },
  { name: 'Pet Accessories', headline: 'For all the places you go together.', desc: 'Explore useful extras for days out, travel and life at home.', source: 'Dog Supplies', chips: ['Dog Supplies', 'Cat Supplies', 'Grooming'] },
  { name: 'Pet Beds', headline: 'Their own little place to unwind.', desc: 'Find a comfortable corner with beds and resting essentials for dogs and cats.', source: 'Cat Supplies', chips: ['Dog Supplies', 'Cat Supplies', 'Pet Accessories'] },
  { name: 'Pet Toys', headline: 'Make room for a little play.', desc: 'Explore toys for curious noses, playful paws and time together.', source: 'Dog Supplies', chips: ['Dog Supplies', 'Cat Supplies', 'Bird Supplies'] },
  { name: 'Grooming', headline: 'Everyday care. A closer connection.', desc: 'Browse grooming tools and care accessories for your companion’s routine.', source: 'Horse', chips: ['Dog Supplies', 'Cat Supplies', 'Horse'] },
];
const collectionSlugs: Record<string, string> = {
  'Dog Supplies': 'dog-supplies', 'Cat Supplies': 'cat-supplies', Horse: 'horse',
  Cattle: 'cattle', 'Bird Supplies': 'bird-supplies', 'Pet Accessories': 'pet-accessories', Grooming: 'grooming',
};
for (const collection of generalCollections) {
  const source = CATEGORY_HERO_CONFIG[collection.source];
  CATEGORY_HERO_CONFIG[collection.name] = {
    ...source, label: collection.name, headline: collection.headline, desc: collection.desc,
    tint: 'neutral', ctaLabel: `Shop ${collection.name.toLowerCase()}`,
    chips: collection.chips.map(label => ({ label, href: `/category/${collectionSlugs[label]}` })),
  };
}

/** Sized variants only for the existing image CDN; custom CMS sources pass through. */
export function categoryImageVariant(source: string, width: number): string {
  if (!source.startsWith('https://images.unsplash.com/')) return source;
  const url = new URL(source);
  url.searchParams.set('w', String(width));
  url.searchParams.set('h', String(Math.round(width * 0.9)));
  url.searchParams.set('q', '75');
  url.searchParams.set('auto', 'format');
  return url.toString();
}

// Unknown future categories remain usable without a fabricated photo or links.
const NEUTRAL_CONFIG: Omit<CategoryHeroConfig, 'label' | 'headline' | 'desc' | 'buyerNote'> = {
  image: '',
  imageAlt: '',
  tint: 'neutral',
  ctaHref: '#product-grid',
  ctaLabel: 'Browse all products',
  chips: [],
};

/** Resolve existing collections, with a neutral fallback for future categories. */
export function categoryHeroConfig(name: string, fallbackDesc: string): CategoryHeroConfig {
  return (
    CATEGORY_HERO_CONFIG[name] || {
      ...NEUTRAL_CONFIG,
      label: name,
      headline: name,
      desc: fallbackDesc,
      buyerNote: 'Start with the task you need to complete, then compare the details supplied on each product listing.',
    }
  );
}

interface Props {
  config: CategoryHeroConfig;
}

/**
 * Premium, reusable category-page hero: breadcrumb → eyebrow label → strong
 * headline → description → CTA → related collection links on the left,
 * editorial pet image on the right, all inside a subtle per-category tinted
 * band. Mobile presents the photo first and keeps collection links available;
 * lightweight — no carousel, no autoplay, no text baked into the image.
 */
export default function CategoryHero({ config }: Props): JSX.Element {
  const { label, headline, desc, image, imageAlt, tint, ctaHref, ctaLabel, buyerNote, chips, mobileImage, imagePosition, badge } = config;
  return (
    <div className={`category-hero category-hero--${tint}`}>
      <nav aria-label="Breadcrumb" className="category-hero__breadcrumb">
        <ol>
          <li><Link to="/">Home</Link></li>
          <li aria-hidden="true">/</li>
          <li><Link to="/shop">Shop</Link></li>
          <li aria-hidden="true">/</li>
          <li aria-current="page">{label}</li>
        </ol>
      </nav>
      <div className={`category-hero__body${image ? '' : ' category-hero__body--text'}`}>
        {image && (
          <picture className="category-hero__media">
            {mobileImage && <source media="(max-width: 599px)" srcSet={mobileImage} />}
            <img src={categoryImageVariant(image, 720)}
              srcSet={image.startsWith('https://images.unsplash.com/') ? [360, 540, 720, 1080].map(w => `${categoryImageVariant(image, w)} ${w}w`).join(', ') : undefined}
              sizes="(min-width: 1440px) 380px, (min-width: 1024px) 32vw, (min-width: 640px) 44vw, 100vw"
              alt={imageAlt} width="720" height="648" loading="eager" fetchPriority="high" decoding="async"
              style={{ objectPosition: imagePosition || '50% 50%' }} />
          </picture>
        )}
        <div className="category-hero__copy">
          <p className="category-hero__eyebrow">{label}{badge && <span>{badge}</span>}</p>
          <h1>{headline}</h1>
          <p className="category-hero__description">{desc}</p>
          <a href={ctaHref} className="category-hero__cta">{ctaLabel}<ArrowDown size={16} aria-hidden="true" /></a>
        </div>
      </div>
      <div className="px-5 pb-5 sm:px-7"><BuyerGuidance title={`Choosing ${label.toLowerCase()}`} note={buyerNote} categoryHref={ctaHref === '#product-grid' ? '/shop' : ctaHref} /></div>
      {chips.length > 0 && <nav aria-label={`Explore related ${label.toLowerCase()} collections`} className="category-hero__browse">
        <p>Explore more</p>
        <ul>{chips.map(chip => <li key={chip.href}><Link to={chip.href}>{chip.label}<ArrowUpRight size={13} aria-hidden="true" /></Link></li>)}</ul>
      </nav>}
    </div>
  );
}
