// ============================================================================
// LUXEDGE — FOOTER
//
// The previous footer was four stacked bars (links, a category strip, a trust
// strip, a legal strip) — roughly a full viewport of sitemap. This is one
// four-column band, a newsletter that is a single underlined field, one legal
// line, and an oversized wordmark to close the page.
//
// Nothing was dropped that mattered: every destination is still linked, just
// once, in the column where a customer would look for it.
// ============================================================================

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Mail01, Phone, MarkerPin01, CheckCircle } from '@untitledui/icons';
import { PRIMARY_ANIMAL_COLLECTIONS, NEED_COLLECTIONS } from '../../features/catalog/taxonomy';

const HELP = [
  { to: '/contact', label: 'Contact' },
  { to: '/faq', label: 'FAQs' },
  { to: '/shipping-policy', label: 'Shipping' },
  { to: '/returns', label: 'Returns' },
  { to: '/orders', label: 'Track order' },
];

const COMPANY = [
  { to: '/about', label: 'About' },
  { to: '/blog', label: 'Journal' },
  { to: '/careers', label: 'Careers' },
  { to: '/privacy', label: 'Privacy' },
  { to: '/terms', label: 'Terms' },
];

const SOCIAL = ['Facebook', 'Instagram', 'TikTok', 'YouTube'];

export default function Footer() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);

  const subscribe = (e: React.FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!value) return;
    try {
      const list = JSON.parse(localStorage.getItem('luxedge_newsletter') || '[]');
      list.push({ email: value, at: new Date().toISOString() });
      localStorage.setItem('luxedge_newsletter', JSON.stringify(list));
    } catch { /* storage unavailable — the intent is still acknowledged */ }
    setDone(true);
  };

  // Shown once, in the shop column: the navigable animals (Horse, Cattle)
  // first, then the need-based collections. Legacy Dog/Cat collections resolve
  // but are not linked from navigation.
  const shopLinks = [...PRIMARY_ANIMAL_COLLECTIONS, ...NEED_COLLECTIONS];

  return (
    <footer className="footer">
      <div className="shell">
        <div className="footer-top">
          {/* Brand + newsletter */}
          <div>
            <Link to="/" className="inline-flex items-center gap-3 mb-4" aria-label="Luxedge — home">
              <img src="/luxedge-mark.svg" alt="" aria-hidden="true" className="w-9 h-9" />
              <span className="wordmark-text text-luxe-white">LUXEDGE</span>
            </Link>
            <p className="text-[13px] leading-relaxed text-white/55 max-w-xs">
              Considered essentials for horses, cattle, dogs and cats — sourced,
              verified and shipped from the United States.
            </p>

            <div className="mt-6 max-w-xs">
              <p className="footer-title">Letters from the barn</p>
              {done ? (
                <p className="flex items-center gap-2 text-[13px] text-luxe-gold-light">
                  <CheckCircle strokeWidth={1.5} size={15} aria-hidden="true" /> You're on the list.
                </p>
              ) : (
                <form onSubmit={subscribe} className="footer-newsletter">
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email address"
                    aria-label="Email address"
                  />
                  <button type="submit" aria-label="Subscribe">
                    <ArrowRight strokeWidth={1.5} size={17} aria-hidden="true" />
                  </button>
                </form>
              )}
            </div>

            <div className="flex gap-2 mt-6">
              {SOCIAL.map((s) => (
                <a key={s} href="#" className="footer-social" aria-label={s} title={s}>{s[0]}</a>
              ))}
            </div>
          </div>

          <nav aria-label="Shop">
            <p className="footer-title">Shop</p>
            {shopLinks.map((c) => (
              <Link key={c.slug} to={`/category/${c.slug}`} className="footer-link">{c.label}</Link>
            ))}
            <Link to="/shop" className="footer-link">All products</Link>
          </nav>

          <nav aria-label="Help">
            <p className="footer-title">Help</p>
            {HELP.map((l) => <Link key={l.to} to={l.to} className="footer-link">{l.label}</Link>)}
          </nav>

          <div>
            <nav aria-label="Company">
              <p className="footer-title">Company</p>
              {COMPANY.map((l) => <Link key={l.to} to={l.to} className="footer-link">{l.label}</Link>)}
            </nav>

            <div className="mt-6 space-y-1.5">
              <a href="mailto:hello@luxedge.us" className="flex items-center gap-2 text-[13px] text-white/60 hover:text-luxe-gold-light transition-colors">
                <Mail01 strokeWidth={1.5} size={14} className="text-luxe-gold-light shrink-0" aria-hidden="true" />
                hello@luxedge.us
              </a>
              <a href="tel:4409418002" className="flex items-center gap-2 text-[13px] text-white/60 hover:text-luxe-gold-light transition-colors">
                <Phone strokeWidth={1.5} size={14} className="text-luxe-gold-light shrink-0" aria-hidden="true" />
                (440) 941-8002
              </a>
              <a
                href="https://maps.google.com/?q=5041+Courtside+Dr,+Irving,+TX+75038"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-2 text-[13px] text-white/60 hover:text-luxe-gold-light transition-colors"
              >
                <MarkerPin01 strokeWidth={1.5} size={14} className="text-luxe-gold-light shrink-0 mt-0.5" aria-hidden="true" />
                5041 Courtside Dr, Irving, TX 75038
              </a>
            </div>
          </div>
        </div>

        <div className="footer-bottom">
          <p>© {new Date().getFullYear()} Luxedge. All rights reserved.</p>
          <p className="flex items-center gap-3">
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
            <Link to="/returns">Returns</Link>
            <span>USD ($)</span>
          </p>
        </div>

        <span className="footer-mark" aria-hidden="true">LUXEDGE</span>
      </div>
    </footer>
  );
}
