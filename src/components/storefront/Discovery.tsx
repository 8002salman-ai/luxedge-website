// ============================================================================
// LUXEDGE — DISCOVERY MODULES
//
// Category navigation as merchandising, not as a row of buttons.
//
// Both modules read from the taxonomy and the live catalog, so they stay
// honest: a collection with stock shows its real count and a real product
// photograph; a collection that is still being sourced shows an "Arriving
// soon" marker and a designed ink plate.
//
// The animal module surfaces the PRIMARY animals only — Horse and Cattle.
// Legacy Dog/Cat collections still resolve at their URLs and their products
// remain reachable through Shop All, search, tags and the need-based
// collections; they are simply not promoted in navigation.
// ============================================================================

import { Link } from 'react-router-dom';
import { ArrowRight } from '@untitledui/icons';
import { onDarkImageError, firstUsableImage, type Product } from './context';
import { Reveal, Stagger, staggerStyle } from './motion';
import {
  PRIMARY_ANIMAL_COLLECTIONS, NEED_COLLECTIONS, matchesCollection, countIn, type Collection,
} from '../../features/catalog/taxonomy';

/**
 * Image for a collection, in the order the brand requires:
 *   1. a real photograph from a product actually in that collection
 *   2. an approved repo-local editorial asset (`collection.image`)
 *   3. nothing — the card falls back to its designed ink plate
 *
 * There is deliberately no fourth option. Hotlinking a third-party stock photo
 * would make a host we do not control a permanent dependency of the storefront,
 * and would put imagery on the page that is not Luxedge's.
 */
function imageFor(collection: Collection, products: Product[]): string | undefined {
  const match = products.find((p) => matchesCollection(p, collection) && firstUsableImage(p));
  return (match && firstUsableImage(match)) || collection.image;
}

/**
 * Shop-by-animal module — the primary entry point into the catalog.
 *
 * Two panels rather than a four-card rail, because there are two primary
 * animals. A scroll rail sized for four would leave two cards adrift in empty
 * track; a deliberate two-up spread reads as a decision.
 */
export function AnimalPanels({ products }: { products: Product[] }) {
  return (
    <div className="animal-panels" role="list">
      {PRIMARY_ANIMAL_COLLECTIONS.map((c, i) => {
        const image = imageFor(c, products);
        const count = countIn(products, c);
        return (
          <Link
            key={c.slug}
            to={`/category/${c.slug}`}
            role="listitem"
            className="animal-card"
            style={staggerStyle(i)}
          >
            {image && (
              <img src={image} alt="" aria-hidden="true" loading="lazy" decoding="async" onError={onDarkImageError} />
            )}
            {count === 0 && <span className="animal-card-tag">Arriving soon</span>}
            <span className="animal-card-name">{c.label}</span>
            <span className="animal-card-desc">{c.blurb}</span>
            <span className="animal-card-cta">
              {count > 0 ? `Shop ${count} product${count === 1 ? '' : 's'}` : 'See what’s coming'}
              <ArrowRight strokeWidth={1.5} size={13} aria-hidden="true" />
            </span>
          </Link>
        );
      })}
    </div>
  );
}

/**
 * Need-based collection grid. The layout is deliberately asymmetric — the
 * first two tiles run wide — so the block reads as an editorial spread rather
 * than a uniform tile wall.
 */
export function CollectionGrid({ products }: { products: Product[] }) {
  return (
    <Stagger className="collection-grid" step={60}>
      {NEED_COLLECTIONS.map((c, i) => {
        const image = imageFor(c, products);
        const count = countIn(products, c);
        const wide = i < 2;
        const last = i === NEED_COLLECTIONS.length - 1;
        return (
          <div key={c.slug} className={last ? 'collection-tile-last' : wide ? 'collection-tile-wide' : 'collection-tile'} style={staggerStyle(i)}>
            <Link to={`/category/${c.slug}`} className={`tile${image ? '' : ' tile-blank'}`}>
              {image && (
                <img src={image} alt="" aria-hidden="true" loading="lazy" decoding="async" onError={onDarkImageError} />
              )}
              <span className="tile-name">{c.label}</span>
              <span className="tile-count num">
                {count > 0 ? `${count} product${count === 1 ? '' : 's'}` : 'Arriving soon'}
              </span>
              <ArrowRight strokeWidth={1.5} size={16} className="tile-arrow" aria-hidden="true" />
            </Link>
          </div>
        );
      })}
    </Stagger>
  );
}

/** Shared section header — eyebrow, display title, optional trailing link. */
export function SectionHead({
  eyebrow, title, intro, to, linkLabel = 'View all',
}: { eyebrow: string; title: string; intro?: string; to?: string; linkLabel?: string }) {
  return (
    <Reveal className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-8 sm:mb-10">
      <div>
        <p className="eyebrow mb-3">{eyebrow}</p>
        <h2 className="section-title">{title}</h2>
      </div>
      <div className="sm:text-right sm:max-w-xs">
        {intro && <p className="section-intro sm:ml-auto">{intro}</p>}
        {to && (
          <Link to={to} className="link-arrow mt-3 inline-flex">
            {linkLabel} <ArrowRight strokeWidth={1.5} size={13} aria-hidden="true" />
          </Link>
        )}
      </div>
    </Reveal>
  );
}
