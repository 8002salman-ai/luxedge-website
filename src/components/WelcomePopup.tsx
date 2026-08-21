import { useEffect, useState } from 'react';
import { X, Gift, ShieldCheck, ArrowCounterClockwise } from '@phosphor-icons/react';

const STORE_KEY = 'luxedge-welcome-shown-v1';
const CLAIMED_KEY = 'luxedge-welcome-coupon';

// Welcome popup: appears once per visitor, makes the 100% safe/returnable
// promise, and trades an email for a real 10% welcome coupon created
// server-side (api/crm/welcome). Never auto-opens again after dismissal.
export default function WelcomePopup() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');
  const [coupon, setCoupon] = useState('');

  useEffect(() => {
    if (localStorage.getItem(STORE_KEY) === '1') return;
    const t = window.setTimeout(() => setOpen(true), 2200);
    return () => window.clearTimeout(t);
  }, []);

  const dismiss = () => {
    localStorage.setItem(STORE_KEY, '1');
    setOpen(false);
  };

  const claim = async () => {
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setState('error');
      setMsg('Please enter a valid email address.');
      return;
    }
    setState('busy');
    setMsg('');
    try {
      const r = await fetch('/api/crm/welcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), pageUrl: window.location.pathname, optedIn: true }),
      });
      const j = await r.json().catch(() => null);
      if (j?.ok && j?.couponCode) {
        setCoupon(j.couponCode);
        localStorage.setItem(CLAIMED_KEY, j.couponCode);
        setState('done');
      } else {
        setState('error');
        setMsg(j?.error || j?.message || 'Could not claim the coupon right now — try again.');
      }
    } catch {
      setState('error');
      setMsg('Network error — please try again.');
    }
  };

  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label="Welcome to Luxedge"
      className="fixed inset-0 z-[130] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-luxe-black/70 backdrop-blur-sm" onClick={dismiss} />
      <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden">
        {/* Header band */}
        <div className="bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 px-6 pt-7 pb-6 text-center relative">
          <button onClick={dismiss} aria-label="Close" className="absolute top-3.5 right-3.5 w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center transition-colors">
            <X size={16} weight="bold" />
          </button>
          <div className="mx-auto w-14 h-14 rounded-2xl bg-white/15 border border-white/25 flex items-center justify-center mb-3">
            <Gift size={26} className="text-white" />
          </div>
          <h2 className="text-xl font-extrabold text-white tracking-tight">Welcome to Luxedge! 🐾</h2>
          <p className="text-[13px] text-blue-100 mt-1.5">Get <span className="font-bold text-white">10% off</span> your first order</p>
        </div>

        <div className="px-6 py-6">
          {/* Trust line */}
          <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-100 rounded-xl px-3.5 py-2.5 mb-4">
            <ShieldCheck size={16} weight="fill" className="text-emerald-600 shrink-0" />
            <p className="text-[12px] text-emerald-800 leading-snug">
              <b>100% safe &amp; trusted.</b> Secure checkout, easy returns, real USA shipping.
            </p>
          </div>

          {state === 'done' ? (
            <div className="text-center">
              <p className="text-[13px] text-gray-600 mb-2">Your welcome code — copy it &amp; use at checkout:</p>
              <div className="flex items-center justify-between gap-2 bg-slate-900 rounded-xl px-4 py-3.5">
                <span className="font-mono font-bold text-lg tracking-wider text-amber-300 select-all">{coupon}</span>
                <button
                  onClick={() => { navigator.clipboard?.writeText(coupon).catch(() => undefined); setMsg('Copied!'); }}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors">
                  Copy
                </button>
              </div>
              <p className="text-[11px] text-gray-400 mt-2">{msg || 'One-time use · applies automatically at checkout'}</p>
              <button onClick={dismiss} className="mt-4 w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-sm font-bold rounded-xl transition-all">
                Start Shopping →
              </button>
            </div>
          ) : (
            <>
              <label className="block text-[12px] font-semibold text-gray-700 mb-1.5">Enter your email for the 10% code</label>
              <input
                type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
                onKeyDown={(e) => { if (e.key === 'Enter') void claim(); }}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 transition-all"
              />
              {state === 'error' && <p className="text-[12px] text-red-600 mt-2">{msg}</p>}
              <button onClick={claim} disabled={state === 'busy'}
                className="mt-3 w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-60 text-white text-sm font-bold rounded-xl transition-all flex items-center justify-center gap-2">
                {state === 'busy' ? (
                  <><ArrowCounterClockwise size={16} className="animate-spin" /> Claiming…</>
                ) : (
                  <><Gift size={16} /> Claim My 10% Coupon</>
                )}
              </button>
              <p className="text-[11px] text-gray-400 mt-3 text-center flex items-center justify-center gap-1">
                <ShieldCheck size={12} className="text-emerald-500" /> No spam — just the coupon &amp; pet-care updates. Unsubscribe anytime.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
