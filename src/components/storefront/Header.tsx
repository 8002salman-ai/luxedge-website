// ============================================================================
// LUXEDGE — MASTHEAD
//
// A single compact bar that gets out of the way. Three deliberate decisions:
//
//  1. The header RETRACTS on sustained downward reading and returns instantly
//     on any upward intent, so a long product grid gets the full viewport.
//  2. Category discovery lives in one full-width glass mega panel driven by
//     the taxonomy module — Horse and Cattle sit in the top bar as first-class
//     destinations, not buried under a "more" menu.
//  3. Search is an overlay, not a permanently parked pill. It costs one icon
//     of chrome instead of a third of the bar, and opens on ⌘K / Ctrl-K.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ShoppingBag01, Menu01, X, SearchMd, User01 as UserIcon, LogOut01, Package,
  ChevronDown, ArrowRight, Truck01, RefreshCcw01, ShieldTick, LayoutGrid01,
} from '@untitledui/icons';
import { useApp, onImageError, firstUsableImage, LUXEDGE_IMAGE_FALLBACK, type Product } from './context';
import { useHeaderScroll, useScrollLock, useEscape, staggerStyle } from './motion';
import {
  PRIMARY_ANIMAL_COLLECTIONS, NEED_COLLECTIONS, MEGA_COLUMNS, NAV_COLLECTIONS,
  COLLECTIONS, countIn, type Collection,
} from '../../features/catalog/taxonomy';
import { trackEvent, utmParams } from '../../lib/marketing';

/** Truthful, non-promotional announcements only. */
const ANNOUNCEMENTS = [
  { icon: ShieldTick, text: 'Every product verified before it is listed' },
  { icon: Truck01, text: 'Ships from the United States' },
  { icon: RefreshCcw01, text: '30-day returns & replacements' },
];

const PAGES = [
  { to: '/shop', label: 'Shop All' },
  { to: '/blog', label: 'Journal' },
  { to: '/about', label: 'About' },
  { to: '/contact', label: 'Contact' },
];

/** Top-bar destinations — need-led, with the working animals promoted. */
const TOP_NAV: { slug: string; label: string }[] = [
  { slug: 'horse', label: 'Horse' },
  { slug: 'cattle', label: 'Cattle' },
  { slug: 'stable-farm', label: 'Stable & Farm' },
  { slug: 'feeding-water', label: 'Feeding' },
  { slug: 'grooming-care', label: 'Grooming' },
];

function bySlug(slug: string): Collection | undefined {
  return COLLECTIONS.find((c) => c.slug === slug);
}

export default function Header() {
  const loc = useLocation();
  const nav = useNavigate();
  const { user, cart, logout, openCart, products } = useApp();

  const [megaOpen, setMegaOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [announceIndex, setAnnounceIndex] = useState(0);

  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const count = cart.reduce((s, i) => s + i.quantity, 0);

  // Any overlay pins the header in place; retracting under an open panel
  // would tear the panel off its anchor.
  const { scrolled, hidden } = useHeaderScroll(megaOpen || sheetOpen || searchOpen);

  useScrollLock(sheetOpen || searchOpen);

  // Close everything on navigation.
  useEffect(() => {
    setMegaOpen(false);
    setSheetOpen(false);
    setSearchOpen(false);
    setAccountOpen(false);
  }, [loc.pathname, loc.search]);

  // Rotating announcements — crossfade, pauses for reduced motion via CSS.
  useEffect(() => {
    const id = setInterval(() => setAnnounceIndex((i) => (i + 1) % ANNOUNCEMENTS.length), 4600);
    return () => clearInterval(id);
  }, []);

  // ⌘K / Ctrl-K opens search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openMega = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setMegaOpen(true);
  }, []);

  // Small grace period so a diagonal cursor path to the panel does not close it.
  const scheduleCloseMega = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setMegaOpen(false), 140);
  }, []);

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  useEscape(megaOpen, () => setMegaOpen(false));
  useEscape(sheetOpen, () => setSheetOpen(false));
  useEscape(accountOpen, () => setAccountOpen(false));

  const isActive = (path: string) => (path === '/' ? loc.pathname === '/' : loc.pathname.startsWith(path));

  return (
    <>
      {/* ── Announcement ─────────────────────────────────────────────── */}
      <div className="announce" aria-live="off">
        <div className="announce-track shell">
          {ANNOUNCEMENTS.map((a, i) => (
            <span key={a.text} className="announce-item" data-active={i === announceIndex}>
              <a.icon strokeWidth={1.5} size={12} aria-hidden="true" />
              {a.text}
            </span>
          ))}
        </div>
      </div>

      {/* ── Masthead ─────────────────────────────────────────────────── */}
      <header
        className="masthead"
        data-scrolled={scrolled || undefined}
        data-hidden={hidden || undefined}
        onMouseLeave={scheduleCloseMega}
      >
        <div className="shell masthead-inner">
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="icon-btn lg:hidden -ml-2"
            aria-label="Open menu"
            aria-expanded={sheetOpen}
          >
            <Menu01 strokeWidth={1.5} size={20} aria-hidden="true" />
          </button>

          <Link to="/" className="wordmark" aria-label="Luxedge — home">
            <img src="/luxedge-mark.svg" alt="" aria-hidden="true" className="h-8 w-8" />
            <span className="leading-none">
              <span className="wordmark-text">LUXEDGE</span>
              <span className="wordmark-sub hidden sm:block">PREMIUM PET ESSENTIALS</span>
            </span>
          </Link>

          {/* Desktop navigation */}
          <nav className="hidden lg:flex items-center gap-7 ml-8" aria-label="Primary">
            <button
              type="button"
              className="nav-link"
              aria-expanded={megaOpen}
              aria-haspopup="true"
              onMouseEnter={openMega}
              onFocus={openMega}
              onClick={() => setMegaOpen((v) => !v)}
            >
              Collections
              <ChevronDown strokeWidth={1.5} size={13} aria-hidden="true" />
            </button>
            {TOP_NAV.map((item) => (
              <Link
                key={item.slug}
                to={`/category/${item.slug}`}
                className="nav-link"
                data-active={loc.pathname === `/category/${item.slug}` || undefined}
                onMouseEnter={scheduleCloseMega}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Actions */}
          <div className="flex items-center gap-0.5 ml-auto">
            <button type="button" onClick={() => setSearchOpen(true)} className="icon-btn" aria-label="Search products">
              <SearchMd strokeWidth={1.5} size={19} aria-hidden="true" />
            </button>

            {user ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setAccountOpen((v) => !v)}
                  className="icon-btn"
                  aria-label="Account menu"
                  aria-expanded={accountOpen}
                >
                  <span className="w-7 h-7 rounded-full bg-luxe-black text-white flex items-center justify-center text-[11px] font-semibold font-brand">
                    {user.name[0]?.toUpperCase()}
                  </span>
                </button>
                {accountOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setAccountOpen(false)} aria-hidden="true" />
                    <div className="absolute right-0 top-full mt-2 w-60 z-50 rounded-lg glass-panel py-2 animate-scale-in">
                      <div className="px-4 py-2.5 border-b border-luxe-silver/70">
                        <p className="text-[13px] font-semibold text-luxe-black">{user.name}</p>
                        <p className="text-[11px] text-luxe-gray truncate">{user.email}</p>
                      </div>
                      {user.role === 'admin' && (
                        <Link to="/admin" className="flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-luxe-charcoal hover:bg-luxe-light transition-colors">
                          <LayoutGrid01 strokeWidth={1.5} size={15} className="text-luxe-gold" aria-hidden="true" />Admin Panel
                        </Link>
                      )}
                      <Link to="/orders" className="flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-luxe-charcoal hover:bg-luxe-light transition-colors">
                        <Package strokeWidth={1.5} size={15} className="text-luxe-gray" aria-hidden="true" />My Orders
                      </Link>
                      <button
                        type="button"
                        onClick={logout}
                        className="flex items-center gap-2.5 px-4 py-2.5 w-full text-left text-[13px] text-luxe-red hover:bg-luxe-light transition-colors"
                      >
                        <LogOut01 strokeWidth={1.5} size={15} aria-hidden="true" />Log Out
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <Link to="/login" className="icon-btn" aria-label="Sign in">
                <UserIcon strokeWidth={1.5} size={19} aria-hidden="true" />
              </Link>
            )}

            <button
              type="button"
              onClick={openCart}
              className="icon-btn"
              aria-label={`Open cart, ${count} item${count === 1 ? '' : 's'}`}
            >
              <ShoppingBag01 strokeWidth={1.5} size={19} aria-hidden="true" />
              {count > 0 && <span key={count} className="cart-count num">{count}</span>}
            </button>
          </div>
        </div>

        {/* ── Mega panel ─────────────────────────────────────────────── */}
        {megaOpen && (
          <div className="mega hidden lg:block" onMouseEnter={openMega} onMouseLeave={scheduleCloseMega}>
            <div className="shell mega-grid">
              {MEGA_COLUMNS.map((col) => (
                <div key={col.title}>
                  <p className="mega-col-title">{col.title}</p>
                  {col.slugs.map((slug) => {
                    const c = bySlug(slug);
                    if (!c) return null;
                    const n = countIn(products, c);
                    return (
                      <Link key={slug} to={`/category/${slug}`} className="mega-item">
                        <span>{c.label}</span>
                        <span className="num">{n > 0 ? n : 'Soon'}</span>
                      </Link>
                    );
                  })}
                </div>
              ))}

              <MegaFeature products={products} />
            </div>
          </div>
        )}
      </header>

      {/* ── Search overlay ─────────────────────────────────────────────── */}
      {searchOpen && <SearchOverlay onClose={() => setSearchOpen(false)} onSubmit={(q) => {
        if (q) trackEvent('search', { search_term: q, ...utmParams() });
        nav(q ? `/shop?q=${encodeURIComponent(q)}` : '/shop');
        setSearchOpen(false);
      }} />}

      {/* ── Mobile sheet ───────────────────────────────────────────────── */}
      {sheetOpen && (
        <div className="sheet lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="shell flex items-center justify-between" style={{ height: 'var(--header-h)' }}>
            <span className="wordmark-text">LUXEDGE</span>
            <button type="button" onClick={() => setSheetOpen(false)} className="icon-btn -mr-2" aria-label="Close menu">
              <X strokeWidth={1.5} size={20} aria-hidden="true" />
            </button>
          </div>

          <div className="shell flex-1 overflow-y-auto pb-10">
            <button
              type="button"
              onClick={() => { setSheetOpen(false); setSearchOpen(true); }}
              className="flex items-center gap-2.5 w-full px-4 py-3 mb-6 rounded-full border border-luxe-silver text-luxe-gray text-sm bg-white/60"
            >
              <SearchMd strokeWidth={1.5} size={16} aria-hidden="true" /> Search products
            </button>

            <p className="mega-col-title">Shop by animal</p>
            <nav aria-label="Animals">
              {PRIMARY_ANIMAL_COLLECTIONS.map((c, i) => (
                <Link key={c.slug} to={`/category/${c.slug}`} className="sheet-link" style={staggerStyle(i)}>
                  {c.label}
                  <ArrowRight strokeWidth={1.5} size={17} aria-hidden="true" />
                </Link>
              ))}
            </nav>

            <p className="mega-col-title mt-8">Collections</p>
            <nav aria-label="Collections">
              {NEED_COLLECTIONS.map((c, i) => (
                <Link key={c.slug} to={`/category/${c.slug}`} className="sheet-link" style={staggerStyle(i + PRIMARY_ANIMAL_COLLECTIONS.length)}>
                  {c.label}
                  <ArrowRight strokeWidth={1.5} size={17} aria-hidden="true" />
                </Link>
              ))}
            </nav>

            <div className="mt-8 flex flex-wrap gap-2">
              {PAGES.map((p) => (
                <Link
                  key={p.to}
                  to={p.to}
                  className="chip"
                  data-active={isActive(p.to) || undefined}
                >
                  {p.label}
                </Link>
              ))}
              {!user && <Link to="/login" className="chip">Sign In</Link>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Mega-panel feature slot. Uses a real catalog product when one exists; falls
 * back to a typographic plate rather than a placeholder photograph.
 */
function MegaFeature({ products }: { products: Product[] }) {
  const featured = products.find((p) => p.featured && firstUsableImage(p)) || products.find((p) => firstUsableImage(p));

  if (!featured) {
    return (
      <div className="mega-feature tile-blank flex flex-col justify-end p-5">
        <p className="eyebrow eyebrow-plain text-luxe-gold-light">The collection</p>
        <p className="font-serif text-2xl text-white mt-1 leading-none">Curated,<br />never catalogued.</p>
        <Link to="/shop" className="link-arrow text-luxe-gold-light mt-3">
          Browse all <ArrowRight strokeWidth={1.5} size={13} aria-hidden="true" />
        </Link>
      </div>
    );
  }

  return (
    <Link to={`/product/${featured.id}`} className="mega-feature">
      <img
        src={firstUsableImage(featured) || LUXEDGE_IMAGE_FALLBACK}
        alt={featured.name}
        loading="lazy"
        decoding="async"
        onError={onImageError}
      />
      <div className="mega-feature-copy">
        <p className="eyebrow eyebrow-plain text-luxe-gold-light">Featured</p>
        <p className="font-serif text-lg leading-tight mt-1 line-clamp-2">{featured.name}</p>
      </div>
    </Link>
  );
}

/** Full-screen search — one large serif field plus quick collection jumps. */
function SearchOverlay({ onClose, onSubmit }: { onClose: () => void; onSubmit: (q: string) => void }) {
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEscape(true, onClose);
  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <div className="search-overlay" role="dialog" aria-modal="true" aria-label="Search">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="search-card relative">
        <form onSubmit={(e) => { e.preventDefault(); onSubmit(q.trim()); }} role="search">
          <div className="flex items-center gap-4 border-b border-luxe-silver pb-3">
            <SearchMd strokeWidth={1.5} size={22} className="text-luxe-gray shrink-0" aria-hidden="true" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="search-input"
              placeholder="What are you looking for?"
              aria-label="Search products"
            />
            <button type="button" onClick={onClose} className="icon-btn shrink-0" aria-label="Close search">
              <X strokeWidth={1.5} size={18} aria-hidden="true" />
            </button>
          </div>
        </form>

        <p className="mega-col-title mt-6 border-0 pb-0">Jump to</p>
        <div className="flex flex-wrap gap-2 mt-3">
          {NAV_COLLECTIONS.map((c) => (
            <Link key={c.slug} to={`/category/${c.slug}`} className="search-chip" onClick={onClose}>
              {c.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
