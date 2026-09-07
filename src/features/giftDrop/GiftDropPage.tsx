// ============================================================================
// LUXEDGE — PET GIFT DROP landing + claim flow (/free-pet-gift)
//
// A genuine, limited, FREE product giveaway. The form collects ONLY what is
// needed: first name + email for the confirmation, pet type/size/interest to
// pick a suitable gift, and a shipping address because that is the only way
// to deliver the free product. There is NO payment step anywhere — the server
// creates a $0 promotional order with payment NOT_REQUIRED, and this page
// never asks for (or mentions needing) a card.
// ============================================================================
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';

type CampaignState =
  | { phase: 'loading' }
  | {
      phase: 'open' | 'full' | 'closed';
      title: string;
      message: string;
      giftName: string;
      total: number;
      remaining: number;
    }
  | { phase: 'error' };

type SuccessState = {
  orderNumber: string;
  giftName: string;
  test?: boolean;
};

const PET_TYPES = [
  { id: 'dog', label: 'Dog', emoji: '🐶', blurb: 'Toys, treats, walking & grooming' },
  { id: 'cat', label: 'Cat', emoji: '🐱', blurb: 'Toys, grooming & everyday comfort' },
] as const;

const INTERESTS = ['Feeding', 'Grooming', 'Toys', 'Walking', 'Accessories', 'Health', 'Training'];

const SIZES = ['Small', 'Medium', 'Large', 'Giant / Multiple pets'];

const inputCls =
  'w-full rounded-xl border border-gray-300 bg-white px-3.5 py-3 text-[15px] text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 transition';
const labelCls = 'mb-1.5 block text-[13px] font-semibold text-gray-700';
const req = (s: string) => (
  <>
    {s} <span className="text-rose-500">*</span>
  </>
);

export default function GiftDropPage() {
  const [state, setState] = useState<CampaignState>({ phase: 'loading' });
  const [success, setSuccess] = useState<SuccessState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [petType, setPetType] = useState<'dog' | 'cat' | ''>('');
  const [form, setForm] = useState({
    firstName: '',
    email: '',
    petName: '',
    petSize: '',
    petInterest: '',
    line1: '',
    line2: '',
    city: '',
    state: '',
    zip: '',
    marketing: false,
  });
  const startedAt = useRef<number>(Date.now());
  const topRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/gift-drop/state')
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (!d || typeof d !== 'object') {
          setState({ phase: 'error' });
          return;
        }
        const total = Number(d.total) || 0;
        const remaining = Number(d.remaining) || 0;
        if (!d.active) setState({ phase: 'closed', title: String(d.title || 'Luxedge Pet Gift Drop'), message: String(d.message || ''), giftName: String(d.giftName || ''), total, remaining });
        else if (total > 0 && remaining <= 0) setState({ phase: 'full', title: String(d.title || 'Luxedge Pet Gift Drop'), message: String(d.message || ''), giftName: String(d.giftName || ''), total, remaining });
        else setState({ phase: 'open', title: String(d.title || 'Luxedge Pet Gift Drop'), message: String(d.message || ''), giftName: String(d.giftName || ''), total, remaining });
      })
      .catch(() => alive && setState({ phase: 'error' }));
    return () => {
      alive = false;
    };
  }, []);

  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const showError = (msg: string) => {
    setError(msg);
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!petType) {
      showError('Please choose your pet type — Dog or Cat.');
      return;
    }
    if (!form.firstName.trim() || !form.email.trim() || !form.line1.trim() || !form.city.trim() || !form.zip.trim()) {
      showError('Please complete your name, email and shipping address — we need the address only to deliver your free gift.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      showError('That email address does not look valid.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/gift-drop/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: form.firstName.trim(),
          email: form.email.trim(),
          petType,
          petName: form.petName.trim(),
          petSize: form.petSize,
          petInterest: form.petInterest,
          address: {
            line1: form.line1.trim(),
            line2: form.line2.trim(),
            city: form.city.trim(),
            state: form.state.trim(),
            zip: form.zip.trim(),
            country: 'US',
          },
          marketingOptIn: form.marketing,
          company: '', // honey-pot
          formSeconds: Math.round((Date.now() - startedAt.current) / 1000),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.ok) {
        setSuccess({ orderNumber: d.orderNumber, giftName: d.giftName || 'your complimentary Luxedge gift', test: d.test });
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        showError(d.error || 'We could not complete your claim just now — please try again.');
      }
    } catch {
      showError('Network error — please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ------------------------------------------------------------------ UI
  return (
    <div className="min-h-screen bg-[#0b1120]">
      {/* ============ HERO ============ */}
      <section className="relative overflow-hidden bg-[#0b1120]">
        <div className="pointer-events-none absolute -top-24 -right-24 h-80 w-80 rounded-full bg-blue-500/20 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute top-40 -left-24 h-72 w-72 rounded-full bg-amber-400/10 blur-3xl" aria-hidden />
        <div className="mx-auto max-w-5xl px-4 pt-10 pb-12 sm:px-6 lg:pt-16">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-amber-300">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-300" /> Limited real giveaway
          </p>
          <h1 className="mt-5 max-w-2xl text-4xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-5xl lg:text-6xl">                {state.phase === 'open' || state.phase === 'loading' ? (
                  <>
                    {state.phase === 'loading' ? 'Luxedge Pet Gift Drop' : `${state.total} real gifts.`}
                    <br />
                    <span className="bg-gradient-to-r from-amber-300 to-orange-300 bg-clip-text text-transparent">
                      {state.phase === 'loading' ? '' : 'For real pet owners.'}
                    </span>
                  </>
                ) : state.phase === 'error' ? (
                  'Luxedge Pet Gift Drop'
                ) : (
                  state.title
                )}
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-slate-300 sm:text-lg">
            {state.phase === 'open' ? state.message : 'Complimentary Luxedge pet gifts, no purchase required.'}
          </p>

          {/* Live inventory — real numbers from the server, never fake scarcity */}
          {state.phase === 'open' && (
            <div className="mt-6 inline-flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
              <span className="text-2xl font-black text-white">{state.remaining}</span>
              <span className="text-[13px] leading-tight text-slate-300">
                of {state.total} real gifts remaining
                <br />
                <span className="text-amber-300">while supplies last</span>
              </span>
              <span className="h-8 w-px bg-white/15" aria-hidden />
              <span className="text-[13px] leading-tight text-slate-300">
                <span className="font-bold text-white">$0</span> gift
                <br />
                <span className="text-emerald-300">+ $0 shipping</span>
              </span>
            </div>
          )}
        </div>
      </section>

      {/* ============ TRUST ============ */}
      <section className="border-y border-white/10 bg-white/[0.03]">
        <div className="mx-auto grid max-w-5xl grid-cols-2 gap-x-4 gap-y-3 px-4 py-5 text-[12.5px] text-slate-200 sm:grid-cols-4 sm:px-6 sm:text-[13px]">
          {[
            'No purchase required',
            'No credit card needed',
            'Genuine Luxedge promotion',
            'One gift per household',
          ].map((t) => (
            <div key={t} className="flex items-center gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-400/20 text-emerald-300">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5"><path d="M20 6 9 17l-5-5" /></svg>
              </span>
              {t}
            </div>
          ))}
        </div>
      </section>

      {/* ============ MAIN BODY ============ */}
      <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:py-14" ref={topRef}>
        {state.phase === 'loading' && (
          <div className="flex items-center justify-center py-24 text-slate-300">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-600 border-t-amber-300" />
            <span className="ml-3 text-sm">Checking real gift availability…</span>
          </div>
        )}

        {state.phase === 'error' && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
            <p className="text-lg font-semibold text-white">We could not check availability right now.</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-300">
              Please refresh in a moment — if this keeps happening, email{' '}
              <a className="text-amber-300 underline" href="mailto:hello@luxedge.us">hello@luxedge.us</a>.
            </p>
          </div>
        )}

        {state.phase === 'closed' && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
            <p className="text-2xl">🎁</p>
            <h2 className="mt-2 text-xl font-bold text-white">This Pet Gift Drop is not open right now.</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-300">
              We run drops in small batches for real pet owners. When the next drop opens it will be announced on our{' '}
              <a className="text-amber-300 underline" href="https://luxedge.us/blog">blog</a> and social channels.
            </p>
          </div>
        )}

        {state.phase === 'full' && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
            <p className="text-3xl">🎉</p>
            <h2 className="mt-2 text-2xl font-bold text-white">This Pet Gift Drop has been fully claimed.</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-300">
              All {state.total} real gifts are now matched with pet owners. No payment was ever required, and nobody is
              charged for anything, ever. Follow the Luxedge blog for the next drop.
            </p>
          </div>
        )}

        {state.phase === 'open' && !success && (
          <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:gap-12">
            {/* ---- form column ---- */}
            <form onSubmit={submit} noValidate className="order-2 lg:order-1">
              {error && (
                <div role="alert" className="mb-5 flex items-start gap-3 rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                  <span className="mt-0.5 text-rose-300">⚠️</span> {error}
                </div>
              )}

              {/* 1. Your pet */}
              <div className="rounded-2xl border border-white/10 bg-white p-5 shadow-sm sm:p-6">
                <h2 className="text-[13px] font-black uppercase tracking-wider text-gray-500">1 · Your pet</h2>
                <p className="mt-0.5 text-[13px] text-gray-500">This drop currently covers dogs and cats.</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {PET_TYPES.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPetType(p.id)}
                      aria-pressed={petType === p.id}
                      className={`rounded-xl border-2 p-4 text-left transition ${
                        petType === p.id
                          ? 'border-blue-500 bg-blue-50 shadow-sm'
                          : 'border-gray-200 bg-white hover:border-blue-300'
                      }`}
                    >
                      <span className="text-2xl">{p.emoji}</span>
                      <p className="mt-1 text-[15px] font-bold text-gray-900">{p.label}</p>
                      <p className="text-[12px] leading-snug text-gray-500">{p.blurb}</p>
                    </button>
                  ))}
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelCls} htmlFor="gd-petname">Pet name (optional)</label>
                    <input id="gd-petname" className={inputCls} value={form.petName} onChange={set('petName')} placeholder="e.g. Biscuit" autoComplete="off" />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="gd-petsize">Pet size (optional)</label>
                    <select id="gd-petsize" className={inputCls} value={form.petSize} onChange={set('petSize')}>
                      <option value="">Choose a size…</option>
                      {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
                <div className="mt-4">
                  <label className={labelCls} htmlFor="gd-interest">What is your pet into? (optional)</label>
                  <div className="flex flex-wrap gap-2">
                    {INTERESTS.map((i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, petInterest: f.petInterest === i ? '' : i }))}
                        className={`rounded-full border px-3.5 py-2 text-[13px] font-medium transition ${
                          form.petInterest === i ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400'
                        }`}
                      >
                        {i}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 2. Who it's for */}
              <div className="mt-5 rounded-2xl border border-white/10 bg-white p-5 shadow-sm sm:p-6">
                <h2 className="text-[13px] font-black uppercase tracking-wider text-gray-500">2 · Who it&apos;s for</h2>
                <p className="mt-0.5 text-[13px] text-gray-500">Your name + email — the email is where your confirmation goes.</p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelCls} htmlFor="gd-first">{req('First name')}</label>
                    <input id="gd-first" className={inputCls} value={form.firstName} onChange={set('firstName')} placeholder="First name" autoComplete="given-name" required />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="gd-email">{req('Email')}</label>
                    <input id="gd-email" type="email" className={inputCls} value={form.email} onChange={set('email')} placeholder="you@example.com" autoComplete="email" required />
                  </div>
                </div>
              </div>

              {/* 3. Shipping */}
              <div className="mt-5 rounded-2xl border border-white/10 bg-white p-5 shadow-sm sm:p-6">
                <h2 className="text-[13px] font-black uppercase tracking-wider text-gray-500">3 · Where to send it</h2>
                <p className="mt-0.5 text-[13px] text-gray-500">
                  We collect your shipping address <strong>only to deliver the free gift</strong>. Standard shipping is complimentary.
                </p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className={labelCls} htmlFor="gd-line1">{req('Street address')}</label>
                    <input id="gd-line1" className={inputCls} value={form.line1} onChange={set('line1')} placeholder="Street address" autoComplete="address-line1" required />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelCls} htmlFor="gd-line2">Apt / suite (optional)</label>
                    <input id="gd-line2" className={inputCls} value={form.line2} onChange={set('line2')} placeholder="Apt, suite, unit…" autoComplete="address-line2" />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="gd-city">{req('City')}</label>
                    <input id="gd-city" className={inputCls} value={form.city} onChange={set('city')} autoComplete="address-level2" required />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls} htmlFor="gd-state">State</label>
                      <input id="gd-state" className={inputCls} value={form.state} onChange={set('state')} autoComplete="address-level1" />
                    </div>
                    <div>
                      <label className={labelCls} htmlFor="gd-zip">{req('ZIP')}</label>
                      <input id="gd-zip" className={inputCls} value={form.zip} onChange={set('zip')} autoComplete="postal-code" required />
                    </div>
                  </div>
                </div>
                <p className="mt-3 flex items-start gap-2 text-[12px] leading-snug text-gray-500">
                  <span>🔒</span> United States delivery for this drop. Your details are used only to send your gift and are never sold.
                </p>
              </div>

              {/* 4. Consent */}
              <div className="mt-5 rounded-2xl border border-white/10 bg-white p-5 shadow-sm sm:p-6">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={form.marketing}
                    onChange={(e) => setForm((f) => ({ ...f, marketing: e.target.checked }))}
                    className="mt-0.5 h-5 w-5 accent-blue-600"
                  />
                  <span className="text-[13px] leading-snug text-gray-600">
                    <span className="font-semibold text-gray-800">Optional:</span> keep me posted on future Luxedge drops, deals and
                    pet-care guides. Unticked by default — we never send marketing without your say-so.
                  </span>
                </label>
              </div>

              {/* Honeypot + review note */}
              <input type="text" name="company" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />

              <button
                type="submit"
                disabled={submitting}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-400 px-6 py-4 text-base font-black text-gray-900 shadow-lg shadow-amber-500/20 transition hover:from-amber-300 hover:to-orange-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? (
                  <>
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-gray-800/30 border-t-gray-900" />
                    Reserving your gift…
                  </>
                ) : (
                  <>Claim my free gift · $0 · no card needed</>
                )}
              </button>
              <p className="mt-3 text-center text-[12px] text-gray-500">
                No purchase, no credit card, no payment step. Gift is unconditional once claimed. One gift per household, while supplies last.
              </p>
            </form>

            {/* ---- info column ---- */}
            <aside className="order-1 lg:order-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">Why Luxedge gives gifts</h3>
                <p className="mt-3 text-[13.5px] leading-relaxed text-slate-300">
                  We would rather put a real product in your pet&apos;s paws than spend the same money on ads. Tell us about your
                  dog or cat and we&apos;ll send a complimentary gift matched from our current stock.
                </p>
                <ul className="mt-4 space-y-2.5 text-[13.5px] text-slate-200">
                  {[
                    'No purchase, no credit card, no payment step',
                    'Product + standard shipping are complimentary',
                    'Real inventory — the number you see is the real number',
                    'One gift per eligible household',
                    'No review or social post is ever required for your gift',
                  ].map((t) => (
                    <li key={t} className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-400/20 text-emerald-300">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5"><path d="M20 6 9 17l-5-5" /></svg>
                      </span>
                      {t}
                    </li>
                  ))}
                </ul>
                <div className="mt-5 rounded-xl border border-white/10 bg-black/20 p-4 text-[12.5px] leading-relaxed text-slate-400">
                  <p className="font-semibold text-slate-200">Fine print — stated plainly</p>
                  <p className="mt-1.5">Limited to the real inventory shown above. One gift per email and per household address. If all gifts are claimed, we stop taking claims — we never pretend more exist. Later, after you&apos;ve tried your gift, we&apos;d appreciate your <em>honest</em> feedback — positive or negative.</p>
                </div>
              </div>
            </aside>
          </div>
        )}

        {/* ---- success ---- */}
        {success && (
          <div className="mx-auto max-w-xl text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-400/15 text-3xl">🎁</div>
            <h2 className="mt-5 text-3xl font-black text-white">Your gift is reserved{success.test ? ' (TEST)' : ''}!</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-slate-300">
              <strong className="text-white">{success.giftName}</strong> is matched to your pet and headed your way soon.
            </p>
            <div className="mx-auto mt-6 max-w-md rounded-2xl border border-white/10 bg-white/5 p-6 text-left text-[13.5px] text-slate-300">
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <span>Claim reference</span>
                <span className="font-mono text-sm font-bold text-amber-300">{success.orderNumber}</span>
              </div>
              <div className="flex items-center justify-between border-b border-white/10 py-3">
                <span>Cost</span>
                <span className="font-bold text-emerald-300">$0.00 — nothing to pay</span>
              </div>
              <div className="flex items-center justify-between border-b border-white/10 py-3">
                <span>Payment collected</span>
                <span className="font-semibold text-white">None — no card was ever asked for</span>
              </div>
              <div className="flex items-center justify-between pt-3">
                <span>Confirmation email</span>
                <span className="font-semibold text-white">On its way 🎉</span>
              </div>
            </div>
            <div className="mx-auto mt-6 max-w-md rounded-2xl border border-white/10 bg-white/5 p-5 text-left text-[13px] leading-relaxed text-slate-300">
              <p className="font-bold text-white">What happens next</p>
              <ul className="mt-2 space-y-1.5">
                <li>· We email your confirmation with the reference above.</li>
                <li>· We prepare and ship your gift — complimentary standard shipping.</li>
                <li>· After you&apos;ve tried it, we may ask for honest feedback. No star-rating is ever required for the gift itself.</li>
              </ul>
            </div>
            <a href="/" className="mt-8 inline-block rounded-full border border-white/20 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10">
              ← Back to Luxedge
            </a>
          </div>
        )}
      </section>

      {/* ============ FAQ STRIP ============ */}
      <section className="border-t border-white/10 bg-white/[0.02]">
        <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
          <h2 className="text-lg font-bold text-white">Plain-language answers</h2>
          <div className="mt-5 grid gap-6 sm:grid-cols-2">
            {[
              { q: 'Is this really free?', a: 'Yes. Product and standard shipping are $0. We never ask for a credit card or any payment method on this page — there is no payment step at all.' },
              { q: 'Is my review required?', a: 'No. Your gift is unconditional once your claim is confirmed. After you try it, we may ask for honest feedback, but nothing about the gift depends on it.' },
              { q: 'Why do you need my address?', a: 'Only so we can deliver the free product. We do not use it for marketing and we never sell it.' },
              { q: 'What if all gifts run out?', a: 'We show the real remaining number from our inventory. When it hits zero the form closes and we say so — we never oversell or fake scarcity.' },
            ].map((f) => (
              <div key={f.q}>
                <p className="text-[14px] font-bold text-white">{f.q}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-slate-400">{f.a}</p>
              </div>
            ))}
          </div>
          <p className="mt-8 text-center text-[12px] text-slate-500">
            Genuine Luxedge promotion · Questions? <a className="text-amber-300/90 underline" href="mailto:hello@luxedge.us">hello@luxedge.us</a>
          </p>
        </div>
      </section>
    </div>
  );
}
