// ============================================================================
// LUXEDGE — HOMEPAGE HERO
//
// A pinned, scroll-driven opening rather than a static rectangle.
//
//   • The stage sticks for roughly three-quarters of a viewport of scroll while
//     the image drifts and scales down and the type lifts and dissolves —
//     a single `--p` custom property drives every layer, written once per
//     animation frame, so the whole sequence costs zero React renders.
//   • The headline unmasks line by line on load; the lede, actions and meta
//     follow on a fixed cadence.
//   • A branded ink plate is painted *underneath* the photograph. If the image
//     is slow or fails outright, the hero is still a designed composition —
//     never a hole in the page.
//   • Mobile gets its own geometry (shorter track, reduced amplitude, no
//     floating card), and `prefers-reduced-motion` collapses the whole thing
//     to a normal, static block via CSS.
// ============================================================================

import { Link } from 'react-router-dom';
import { ArrowRight, Truck01, ShieldTick, RefreshCcw01 } from '@untitledui/icons';
import {
  onImageError, firstUsableImage, LUXEDGE_IMAGE_FALLBACK, money, type Product,
} from './context';
import { useScrollProgressVar, usePrefersReducedMotion, staggerStyle } from './motion';

/**
 * Editorial hero photograph. Kept as a single named constant so it can be
 * swapped for owned brand photography without touching layout code.
 */
const HERO_IMAGE =
  'https://images.pexels.com/photos/635499/pexels-photo-635499.jpeg?auto=compress&cs=tinysrgb&w=1920';

const TITLE_LINES = ['Built for the', 'animals that', 'earn their keep.'];

interface HeroProps {
  /** A real, in-catalog product for the floating card. Omitted when empty. */
  featured?: Product;
  shippingNote: string;
}

export default function Hero({ featured, shippingNote }: HeroProps) {
  const reduced = usePrefersReducedMotion();
  const trackRef = useScrollProgressVar<HTMLDivElement>(!reduced);

  return (
    <section className="hero" aria-label="Luxedge">
      <div className="hero-track" ref={trackRef}>
        <div className="hero-stage grain">
          {/* Ink plate — always painted, so the hero can never be empty. */}
          <div className="hero-plate" aria-hidden="true" />

          <div className="hero-media" aria-hidden="true">
            <img
              src={HERO_IMAGE}
              alt=""
              fetchPriority="high"
              decoding="async"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          </div>
          <div className="hero-scrim" aria-hidden="true" />

          <div className="shell hero-content">
            <p className="eyebrow text-luxe-gold-light">Horse · Cattle · Dog · Cat</p>

            <h1 className="hero-title">
              {TITLE_LINES.map((line, i) => (
                <span key={line} className="hero-line">
                  <span style={staggerStyle(i)}>
                    {i === TITLE_LINES.length - 1 ? <em>{line}</em> : line}
                  </span>
                </span>
              ))}
            </h1>

            <p className="hero-lede">
              Feed, shelter, groom and travel. Every piece is chosen for how it
              holds up in a stall, a truck bed or a living room — then verified
              before it is ever listed.
            </p>

            <div className="hero-actions flex flex-wrap items-center gap-3 mt-7">
              <Link to="/shop" className="btn btn-accent">
                Shop the collection
                <ArrowRight strokeWidth={1.5} size={14} aria-hidden="true" />
              </Link>
              <Link to="/category/horse" className="btn btn-ghost-light">Horse &amp; stable</Link>
            </div>

            <div className="hero-meta">
              <span><Truck01 strokeWidth={1.5} size={13} aria-hidden="true" /> {shippingNote}</span>
              <span><RefreshCcw01 strokeWidth={1.5} size={13} aria-hidden="true" /> 30-day returns</span>
              <span><ShieldTick strokeWidth={1.5} size={13} aria-hidden="true" /> Verified before listing</span>
            </div>
          </div>

          {featured && (
            <div className="hero-card-slot">
              <Link to={`/product/${featured.id}`} className="hero-card" aria-label={`View ${featured.name}`}>
                <div className="hero-card-media">
                  <img
                    src={firstUsableImage(featured) || LUXEDGE_IMAGE_FALLBACK}
                    alt=""
                    aria-hidden="true"
                    loading="lazy"
                    decoding="async"
                    onError={onImageError}
                  />
                </div>
                <div className="px-1 pt-3 pb-1">
                  <p className="hero-card-kicker">From the collection</p>
                  <p className="hero-card-title line-clamp-2 mt-1">{featured.name}</p>
                  <p className="flex items-center justify-between mt-2 text-[13px] text-white/70">
                    <span className="num">{money(featured.price)}</span>
                    <ArrowRight strokeWidth={1.5} size={14} className="text-luxe-gold-light" aria-hidden="true" />
                  </p>
                </div>
              </Link>
            </div>
          )}

          <span className="hero-scroll-cue" aria-hidden="true">
            <i />
            Scroll
          </span>
        </div>
      </div>
    </section>
  );
}
