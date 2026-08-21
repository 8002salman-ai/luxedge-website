// ============================================================================
// LUXEDGE — PRODUCT CARD
//
// One card, used everywhere (home rails, shop grid, related products). It has
// to read as premium *before* the customer opens the product, so the work is
// in restraint: a bone plate, an honest image crossfade, tabular prices, and
// exactly one affordance — quick add — that slides out of the plate on hover
// and is permanently visible on touch.
//
// Nothing here invents data: ratings render only from approved reviews, and
// the "Save %" badge only appears when a real compare-at price exists.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Star01, CheckCircle, Plus } from '@untitledui/icons';
import {
  useApp, onImageError, firstUsableImage, LUXEDGE_IMAGE_FALLBACK, money, verifiedRating,
  type Product,
} from './context';

interface ProductCardProps {
  product: Product;
  /** Above-the-fold cards skip lazy loading so the LCP image is not deferred. */
  priority?: boolean;
}

export default function ProductCard({ product, priority = false }: ProductCardProps) {
  const { addToCart, reviews } = useApp();
  const [added, setAdded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const image = firstUsableImage(product) || LUXEDGE_IMAGE_FALLBACK;
  const alt = product.imageAlts?.[0] || product.name;
  const secondImage = product.images.find((c) => c && c !== image);
  const hasCompareAt = product.originalPrice > product.price && product.price > 0;
  const savePct = hasCompareAt ? Math.round((1 - product.price / product.originalPrice) * 100) : 0;
  const rating = verifiedRating(reviews, product.id);
  const soldOut = product.usInventory === true && product.stock === 0;

  const quickAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (soldOut) return;
    addToCart(product);
    setAdded(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAdded(false), 1600);
  };

  return (
    <article className="pcard">
      <Link to={`/product/${product.id}`} className="block" aria-label={`View ${product.name}`}>
        <div className="pcard-media">
          <img
            src={image}
            alt={alt}
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            fetchPriority={priority ? 'high' : 'auto'}
            onError={onImageError}
            className="pcard-img pcard-img-primary"
          />
          {secondImage && (
            <img
              src={secondImage}
              alt=""
              aria-hidden="true"
              loading="lazy"
              decoding="async"
              onError={onImageError}
              className="pcard-img pcard-img-alt"
            />
          )}

          <div className="pcard-badges">
            {product.newArrival && <span className="pcard-badge">New</span>}
            {savePct > 0 && <span className="pcard-badge pcard-badge-sale">Save {savePct}%</span>}
            {soldOut && <span className="pcard-badge">Sold out</span>}
          </div>
        </div>
      </Link>

      <button
        type="button"
        onClick={quickAdd}
        disabled={soldOut}
        data-done={added || undefined}
        className="pcard-add"
        aria-label={soldOut ? `${product.name} is sold out` : `Add ${product.name} to cart`}
      >
        {added
          ? <><CheckCircle strokeWidth={1.5} size={13} aria-hidden="true" /> Added</>
          : <><Plus strokeWidth={1.5} size={13} aria-hidden="true" /> {soldOut ? 'Sold out' : 'Add to cart'}</>}
      </button>

      <div className="pcard-body">
        <p className="pcard-eyebrow">{product.category || product.brand}</p>
        <Link to={`/product/${product.id}`} className="pcard-title line-clamp-2">{product.name}</Link>
        <div className="pcard-price-row">
          <span className="pcard-price">{money(product.price)}</span>
          {hasCompareAt && <span className="pcard-compare">{money(product.originalPrice)}</span>}
          {rating.count > 0 && (
            <span
              className="pcard-rating"
              aria-label={`Rated ${rating.average.toFixed(1)} out of 5 from ${rating.count} verified review${rating.count === 1 ? '' : 's'}`}
            >
              <Star01 strokeWidth={1.5} size={11} fill="currentColor" aria-hidden="true" />
              {rating.average.toFixed(1)}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

/**
 * Horizontal snap rail with real controls. Used for curated home rows, where a
 * fixed grid would either stretch three products across five tracks or hide
 * the rest behind a "view all".
 */
export function ProductRail({ products, label }: { products: Product[]; label: string }) {
  const railRef = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState<{ start: boolean; end: boolean }>({ start: true, end: false });

  const sync = () => {
    const el = railRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdge({ start: el.scrollLeft <= 2, end: el.scrollLeft >= max - 2 });
  };

  useEffect(() => {
    sync();
    const el = railRef.current;
    if (!el) return;
    el.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    return () => {
      el.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    };
  }, [products.length]);

  const nudge = (dir: 1 | -1) => {
    const el = railRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(240, el.clientWidth * 0.8), behavior: 'smooth' });
  };

  return (
    <div className="relative">
      <div ref={railRef} className="rail" role="list" aria-label={label}>
        {products.map((p, i) => (
          <div key={p.id} role="listitem">
            <ProductCard product={p} priority={i < 4} />
          </div>
        ))}
      </div>
      {products.length > 2 && (
        <div className="hidden sm:flex items-center gap-2 mt-6">
          <button type="button" className="rail-nav" onClick={() => nudge(-1)} disabled={edge.start} aria-label={`Scroll ${label} backward`}>
            <ArrowRight strokeWidth={1.5} size={15} className="rotate-180" aria-hidden="true" />
          </button>
          <button type="button" className="rail-nav" onClick={() => nudge(1)} disabled={edge.end} aria-label={`Scroll ${label} forward`}>
            <ArrowRight strokeWidth={1.5} size={15} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
