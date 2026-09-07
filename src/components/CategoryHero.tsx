import type { JSX } from 'react';

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
  tint: 'dog' | 'cat' | 'horse' | 'bird' | 'cattle' | 'neutral';
  ctaHref: string;        // primary action (scrolls to the product grid)
  ctaLabel: string;
  chips: { label: string; href: string }[]; // subcategory shortcuts (real links)
}

export const CATEGORY_HERO_CONFIG: Record<string, CategoryHeroConfig> = {
  'Dog Supplies': {
    label: 'Dog Supplies',
    headline: 'Gear That Keeps Up With Your Dog',
    desc: 'Walking, training & everyday dog essentials — picked for comfort, durability and real everyday use.',
    image: 'https://images.unsplash.com/photo-1552053831-71594a27632d?w=720&h=820&fit=crop&crop=faces&auto=format&q=88',
    imageAlt: 'Happy dog smiling beside walking gear',
    tint: 'dog',
    ctaHref: '#product-grid',
    ctaLabel: 'Shop dog essentials',
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
    imageAlt: 'Elegant cat lounging peacefully',
    tint: 'cat',
    ctaHref: '#product-grid',
    ctaLabel: 'Shop cat essentials',
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
    imageAlt: 'Powerful horse in a quiet field',
    tint: 'horse',
    ctaHref: '#product-grid',
    ctaLabel: 'Shop horse care',
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
    image: 'https://images.unsplash.com/photo-1552728089-57bdde30beb3?w=720&h=820&fit=crop&crop=faces&auto=format&q=88',
    imageAlt: 'Bright, healthy bird perched close',
    tint: 'bird',
    ctaHref: '#product-grid',
    ctaLabel: 'Shop bird supplies',
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
    chips: [
      { label: 'Feeding & Water', href: '/category/feeding-water' },
      { label: 'Horse Care', href: '/category/horse' },
    ],
  },
};

// Non-pet general categories (Pet Beds, Pet Toys, Grooming, ...) keep the
// neutral luxe-cream band but still get the premium header via the fallback.
const NEUTRAL_CONFIG: Omit<CategoryHeroConfig, 'label' | 'headline' | 'desc'> = {
  image: '',
  imageAlt: '',
  tint: 'neutral',
  ctaHref: '#product-grid',
  ctaLabel: 'Browse all products',
  chips: [],
};

/** Resolve a config for any category name; general categories fall back to the
 * neutral treatment (no pet image, standard headline). */
export function categoryHeroConfig(name: string, fallbackDesc: string): CategoryHeroConfig {
  return (
    CATEGORY_HERO_CONFIG[name] || {
      ...NEUTRAL_CONFIG,
      label: name,
      headline: name,
      desc: fallbackDesc,
    }
  );
}

interface Props {
  config: CategoryHeroConfig;
}

/**
 * Premium, reusable category-page hero: breadcrumb → eyebrow label → strong
 * headline → gold rule → description → CTA → subcategory chips on the left,
 * editorial pet image on the right, all inside a subtle per-category tinted
 * band. Fully responsive (image + chips hide gracefully on mobile) and
 * lightweight — no carousel, no autoplay, no text baked into the image.
 */
export default function CategoryHero({ config }: Props): JSX.Element {
  const { label, headline, desc, image, imageAlt, tint, ctaHref, ctaLabel, chips } = config;
  return (
    <div className={`w-full rounded-2xl px-5 py-8 sm:px-8 sm:py-10 category-tint category-tint-${tint}`}>
      <div className="grid gap-8 items-center lg:grid-cols-[minmax(0,1fr)_auto]">
        {/* Text stack */}
        <div className="max-w-xl">
          <nav aria-label="Breadcrumb" className="mb-3">
            <ol className="flex items-center gap-1.5 text-[11px] font-medium text-luxe-gray">
              <li><a href="/" className="hover:text-luxe-gold transition-colors">Home</a></li>
              <li aria-hidden="true" className="text-luxe-silver">/</li>
              <li><a href="/shop" className="hover:text-luxe-gold transition-colors">Shop</a></li>
              <li aria-hidden="true" className="text-luxe-silver">/</li>
              <li aria-current="page" className="text-luxe-charcoal font-semibold truncate">{label}</li>
            </ol>
          </nav>
          <p className="eyebrow mb-2">{label}</p>
          <h1 className="font-serif text-3xl sm:text-4xl lg:text-[2.85rem] font-extrabold text-luxe-black tracking-tight leading-[1.05]">
            {headline}
          </h1>
          <div className="h-1 w-14 bg-luxe-gold rounded-full mt-3" aria-hidden="true" />
          <p className="text-luxe-gray text-xs sm:text-sm mt-3">{desc}</p>
          <a
            href={ctaHref}
            className="mt-5 inline-flex items-center gap-2 bg-luxe-gold hover:bg-luxe-gold-dark text-white text-sm font-bold px-5 py-2.5 rounded-full shadow-sm transition-colors"
          >
            {ctaLabel}
          </a>
          {chips.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-2">
              {chips.map((chip) => (
                <a
                  key={chip.href}
                  href={chip.href}
                  className="text-[12px] font-semibold text-luxe-charcoal bg-white/70 hover:bg-white hover:text-luxe-gold border border-luxe-silver rounded-full px-3.5 py-1.5 transition-colors"
                >
                  {chip.label}
                </a>
              ))}
            </div>
          )}
        </div>
        {/* Pet image */}
        {image && (
          <div className="hidden md:block w-52 sm:w-60 lg:w-72 shrink-0">
            <img
              src={image}
              alt={imageAlt}
              loading="eager"
              fetchPriority="high"
              decoding="async"
              className="w-full aspect-[5/6] object-cover rounded-2xl shadow-lg ring-1 ring-luxe-gold/20"
            />
          </div>
        )}
      </div>
    </div>
  );
}