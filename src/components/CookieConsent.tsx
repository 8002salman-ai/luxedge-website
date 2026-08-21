import { useState } from 'react';
import { Link } from 'react-router-dom';
import { getConsent, setConsent } from '../lib/consent';

export default function CookieConsent() {
  const [choice, setChoice] = useState<null | 'accepted' | 'declined'>(() => getConsent());
  if (choice !== null) return null;

  const decide = (c: 'accepted' | 'declined') => {
    setConsent(c);
    setChoice(c);
    window.dispatchEvent(new Event('luxedge-consent'));
  };

  return (
    <div role="region" aria-label="Cookie consent" className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:right-6 sm:max-w-md z-[120]">
      <div className="glass-dark rounded-[14px] shadow-[0_28px_70px_-34px_rgba(0,0,0,0.7)] p-5 text-luxe-white">
        <p className="text-sm leading-relaxed text-luxe-white/85">
          We use cookies to improve your experience, analyze traffic, and show relevant ads.
          See our{' '}
          <Link to="/privacy" className="text-luxe-gold-light underline underline-offset-2 hover:text-white">Privacy Policy</Link>.
        </p>
        <div className="mt-4 flex items-center gap-2.5">
          <button onClick={() => decide('accepted')}
            className="btn btn-accent flex-1">
            Accept All
          </button>
          <button onClick={() => decide('declined')}
            className="btn btn-ghost-light">
            Decline
          </button>
        </div>
      </div>
    </div>
  );
}
