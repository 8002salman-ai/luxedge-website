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
      <div className="bg-luxe-black/95 backdrop-blur border border-luxe-white/10 rounded-2xl shadow-2xl p-5 text-luxe-white">
        <p className="text-sm leading-relaxed text-luxe-white/85">
          We use optional cookies for analytics and personalized advertising only after you accept.
          See our{' '}
          <Link to="/privacy" className="text-blue-400 underline underline-offset-2 hover:text-blue-300">Privacy Policy</Link>.
          {' '}Learn how{' '}
          <a href="https://business.safety.google/privacy/" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline underline-offset-2 hover:text-blue-300">Google uses data</a>{' '}
          when you use its partner sites.
        </p>
        <div className="mt-4 flex items-center gap-2.5">
          <button onClick={() => decide('accepted')}
            className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-xl transition-colors">
            Accept All
          </button>
          <button onClick={() => decide('declined')}
            className="px-4 py-2.5 border border-luxe-white/20 hover:border-luxe-white/40 text-luxe-white/80 hover:text-luxe-white text-sm font-medium rounded-xl transition-colors">
            Decline
          </button>
        </div>
      </div>
    </div>
  );
}
