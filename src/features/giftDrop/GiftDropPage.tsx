// ============================================================================
// LUXEDGE — PET GIFT DROP landing + claim flow (/free-pet-gift)
//
// A genuine, limited, FREE product giveaway. The form collects ONLY what is
// needed: first name + email for the confirmation, pet type/size/interest to
// pick a suitable gift, and a shipping address because that is the only way
// to deliver the free product. There is NO payment step anywhere — the server
// creates a $0 promotional order with payment NOT_REQUIRED, and this page
// never asks for (or mentions needing) a card.
//
// Premium light redesign (2026-09): compact hero, claim form front-and-center,
// warm off-white + charcoal + restrained gold/tan. All claim logic, validation
// and server calls are unchanged — this file only changes presentation.
// ============================================================================
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
// Free Gift uses basic local address validation — Shippo is NOT required.
// Shippo is only needed for paid-shipping rate calculations.

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
  'w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-[15px] text-gray-900 placeholder:text-gray-400 focus:border-[#9a6f16] focus:outline-none focus:ring-2 focus:ring-[#9a6f16]/20 transition';
const labelCls = 'mb-1 block text-[13px] font-semibold text-[#3d4350]';
const optLabelCls = 'mb-1 block text-[12.5px] font-medium text-gray-400';
const req = (s: string) => (
  <>
    {s} <span className="text-rose-500">*</span>
  </>
);

// Small gold check icon used across trust items / success states.
function CheckMark({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

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

  // Basic local address validation state (no Shippo required for free gifts).
  const [validatedFor, setValidatedFor] = useState(''); // address fingerprint validated

  const addrFingerprint = useCallback(() =>
    [form.line1, form.line2, form.city, form.state, form.zip]
      .map((s) => String(s || '').trim().toLowerCase())
      .join('|'),
    [form.line1, form.line2, form.city, form.state, form.zip],
  );

  const addressComplete = Boolean(
    form.line1.trim() && form.city.trim() && form.state.trim() && /^\d{5}/.test(form.zip),
  );

  // ---- Basic local address validation (no Shippo required for free gifts) ----
  useEffect(() => {
    if (!addressComplete || (petType !== 'dog' && petType !== 'cat')) {
      setValidatedFor('');
      return;
    }
    // Basic format validation — no async calls, no Shippo.
    const fp = addrFingerprint();
    if (fp === validatedFor) return; // already validated
    // Simple format checks
    const zip = form.zip.trim();
    const state = form.state.trim();
    const valid = form.line1.trim() && form.city.trim() && state && zip && /^\d{5}(-\d{4})?$/.test(zip);
    if (valid) {
      setValidatedFor(fp);
    } else {
      setValidatedFor('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressComplete, form.line1, form.line2, form.city, form.state, form.zip, petType]);

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
    // Basic address validation — no Shippo required for free gifts.
    if (!form.line1.trim() || !form.city.trim() || !form.state.trim() || !form.zip.trim()) {
      showError('Please complete your shipping address.');
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

  // Numbered section header — small gold numeral + brand-style title.
  const SectionHeading = ({ n, title, sub }: { n: number; title: string; sub?: string }) => (
    <div className="flex items-center gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#f6efdd] text-[12px] font-bold text-[#9a6f16]">{n}</span>
      <div>
        <h2 className="text-[13px] font-bold uppercase tracking-[0.14em] text-[#3d4350]">{title}</h2>
        {sub && <p className="mt-0.5 text-[12.5px] text-gray-500">{sub}</p>}
      </div>
    </div>
  );

  // ------------------------------------------------------------------ UI
  return (
    <div className="min-h-screen bg-[#faf8f3] text-[#1b1f27]">
      {/* ============ COMPACT HERO ============ */}
      <section className="relative overflow-hidden border-b border-[#ece5d4]">
        <div className="pointer-events-none absolute -top-20 right-0 h-56 w-56 rounded-full bg-[#9a6f16]/[0.07] blur-3xl" aria-hidden />
        <div className="mx-auto max-w-3xl px-4 pb-8 pt-9 text-center sm:px-6 sm:pt-12">
          <p className="inline-flex items-center gap-2 rounded-full border border-[#e2d3a8] bg-[#f6efdd] px-3.5 py-1.5 text-[10.5px] font-bold uppercase tracking-[0.16em] text-[#7c5a10]">
            🎁 Limited new-customer gift
          </p>
          <h1 className="mx-auto mt-4 max-w-2xl text-3xl font-bold leading-[1.12] tracking-tight text-[#1b1f27] sm:text-4xl">
            A complimentary gift for your dog or cat, <span className="text-[#9a6f16]">on us.</span>
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-[14px] leading-relaxed text-[#5b626e] sm:text-[15px]">
            One real Luxedge product and standard shipping — $0. No purchase, no credit card, nothing to pay. Ever.
          </p>

          {/* Live inventory — real numbers from the server, never fake scarcity */}
          {state.phase === 'open' ? (
            <div className="mt-5 inline-flex items-center gap-2.5 rounded-full border border-[#e2d3a8] bg-white px-4 py-2 shadow-[0_2px_10px_-4px_rgba(154,111,22,0.25)]">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#9a6f16]/40" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#9a6f16]" />
              </span>
              <span className="text-[12.5px] font-semibold text-[#3d4350]">
                <span className="font-bold text-[#1b1f27]">{state.remaining}</span> complimentary gifts available · while supplies last
              </span>
            </div>
          ) : state.phase === 'loading' ? (
            <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-[#ece5d4] bg-white px-4 py-2 text-[12.5px] font-medium text-gray-500">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[#9a6f16]" /> Checking real gift availability…
            </div>
          ) : null}
        </div>
      </section>

      {/* ============ MAIN BODY — form front and center ============ */}
      <section className="mx-auto max-w-3xl px-4 py-7 sm:px-6 sm:py-9" ref={topRef}>
        {state.phase === 'loading' && (
          <div className="flex items-center justify-center rounded-2xl border border-[#ece5d4] bg-white py-20 text-[#5b626e] shadow-sm">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#e5d9b6] border-t-[#9a6f16]" />
            <span className="ml-3 text-sm">Checking real gift availability…</span>
          </div>
        )}

        {state.phase === 'error' && (
          <div className="rounded-2xl border border-[#ece5d4] bg-white p-8 text-center shadow-sm">
            <p className="text-lg font-bold text-[#1b1f27]">We could not check availability right now.</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-[#5b626e]">
              Please refresh in a moment — if this keeps happening, email{' '}
              <a className="font-semibold text-[#9a6f16] underline" href="mailto:hello@luxedge.us">hello@luxedge.us</a>.
            </p>
          </div>
        )}

        {state.phase === 'closed' && (
          <div className="rounded-2xl border border-[#ece5d4] bg-white p-8 text-center shadow-sm">
            <p className="text-3xl">🎁</p>
            <h2 className="mt-2 text-xl font-bold text-[#1b1f27]">This Pet Gift Drop is not open right now.</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[#5b626e]">
              We run drops in small batches for real pet owners. When the next drop opens it will be announced on our{' '}
              <a className="font-semibold text-[#9a6f16] underline" href="https://luxedge.us/blog">blog</a> and social channels.
            </p>
            <WaitlistForm />
          </div>
        )}

        {state.phase === 'full' && (
          <div className="rounded-2xl border border-[#ece5d4] bg-white p-8 text-center shadow-sm">
            <p className="text-3xl">🎉</p>
            <h2 className="mt-2 text-2xl font-bold text-[#1b1f27]">This Pet Gift Drop has been fully claimed.</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[#5b626e]">
              All {state.total} real gifts are now matched with pet owners. No payment was ever required, and nobody is
              charged for anything, ever. Follow the Luxedge blog for the next drop.
            </p>
            <WaitlistForm />
          </div>
        )}

        {state.phase === 'open' && !success && (
          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:gap-8">
            {/* ---- form column ---- */}
<form onSubmit={submit} noValidate>
              {error && (
                <div role="alert" className="mb-4 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                  <span className="mt-0.5" aria-hidden="true">⚠️</span> {error}
                </div>
              )}

              {/* Single premium claim card with numbered sections */}
              <div className="overflow-hidden rounded-2xl border border-[#ece5d4] bg-white shadow-[0_1px_2px_rgba(27,31,39,0.04),0_12px_32px_-16px_rgba(27,31,39,0.14)]">
                {/* 1. Your pet */}
                <div className="p-5 sm:p-6">
                  <SectionHeading n={1} title="Your pet" sub="This drop currently covers dogs and cats." />
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {PET_TYPES.map((p) => {
                      const active = petType === p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setPetType(p.id)}
                          aria-pressed={active}
                          className={`relative rounded-xl border p-4 text-left transition ${
                            active
                              ? 'border-[#9a6f16] bg-[#faf4e4] shadow-[0_2px_12px_-4px_rgba(154,111,22,0.35)] ring-1 ring-[#9a6f16]/25'
                              : 'border-gray-200 bg-white hover:border-[#d8c59a]'
                          }`}
                        >
                          {active && (
                            <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-[#9a6f16] text-white">
                              <CheckMark className="h-3 w-3" />
                            </span>
                          )}
                          <span className="text-2xl" aria-hidden="true">{p.emoji}</span>
                          <p className="mt-1.5 text-[15px] font-bold text-[#1b1f27]">{p.label}</p>
                          <p className="text-[12px] leading-snug text-gray-500">{p.blurb}</p>
                        </button>
                      );
                    })}
                  </div>

                  {/* Optional pet details — collapsed by default */}
                  <details className="group mt-4">
                    <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg border border-gray-200 bg-[#fafaf8] px-3.5 py-2.5 text-[12.5px] font-semibold text-gray-500 transition hover:border-[#d8c59a] hover:text-[#7c5a10]">
                      <span>Tell us more about your pet <span className="font-normal text-gray-400">(optional — helps us match the right gift)</span></span>
                      <span className="text-[#9a6f16] transition-transform group-open:rotate-180" aria-hidden="true">▾</span>
                    </summary>
                    <div className="mt-3 grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className={optLabelCls} htmlFor="gd-petname">Pet name (optional)</label>
                        <input id="gd-petname" className={inputCls} value={form.petName} onChange={set('petName')} placeholder="e.g. Biscuit" autoComplete="off" />
                      </div>
                      <div>
                        <label className={optLabelCls} htmlFor="gd-petsize">Pet size (optional)</label>
                        <select id="gd-petsize" className={inputCls} value={form.petSize} onChange={set('petSize')}>
                          <option value="">Choose a size…</option>
                          {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div className="sm:col-span-2">
                        <label className={optLabelCls} htmlFor="gd-interest">What is your pet into? (optional)</label>
                        <div className="flex flex-wrap gap-2">
                          {INTERESTS.map((i) => (
                            <button
                              key={i}
                              type="button"
                              onClick={() => setForm((f) => ({ ...f, petInterest: f.petInterest === i ? '' : i }))}
                              className={`rounded-full border px-3.5 py-2 text-[12.5px] font-medium transition ${
                                form.petInterest === i ? 'border-[#9a6f16] bg-[#faf4e4] text-[#7c5a10]' : 'border-gray-300 bg-white text-gray-600 hover:border-[#d8c59a]'
                              }`}
                            >
                              {i}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </details>
                </div>

                {/* 2. Your details */}
                <div className="border-t border-[#f0ead8] p-5 sm:p-6">
                  <SectionHeading n={2} title="Your details" sub="Your email is where your confirmation goes." />
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

                {/* 3. Delivery address */}
                <div className="border-t border-[#f0ead8] p-5 sm:p-6">
                  <SectionHeading n={3} title="Delivery address" sub="Collected only to deliver the free gift — standard shipping is complimentary." />
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label className={labelCls} htmlFor="gd-line1">{req('Street address')}</label>
                      <input id="gd-line1" className={inputCls} value={form.line1} onChange={set('line1')} placeholder="Street address" autoComplete="address-line1" required />
                    </div>
                    <div className="sm:col-span-2">
                      <label className={optLabelCls} htmlFor="gd-line2">Apt / suite (optional)</label>
                      <input id="gd-line2" className={inputCls} value={form.line2} onChange={set('line2')} placeholder="Apt, suite, unit…" autoComplete="address-line2" />
                    </div>
                    <div>
                      <label className={labelCls} htmlFor="gd-city">{req('City')}</label>
                      <input id="gd-city" className={inputCls} value={form.city} onChange={set('city')} autoComplete="address-level2" required />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls} htmlFor="gd-state">State</label>
                        <input id="gd-state" className={inputCls} value={form.state} onChange={set('state')} autoComplete="address-level1" />
                      </div>
                      <div>
                        <label className={labelCls} htmlFor="gd-zip">{req('ZIP')}</label>
                        <input id="gd-zip" className={inputCls} value={form.zip} onChange={set('zip')} autoComplete="postal-code" required />
                      </div>
                    </div>

                    {/* ---- Address validation feedback ---- */}
                    {validatedFor && validatedFor === addrFingerprint() && (
                      <div className="col-span-full mt-1 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[12.5px] font-medium text-emerald-700">
                        <CheckMark className="h-3.5 w-3.5 text-emerald-500" /> Address looks good — ready for delivery
                      </div>
                    )}
                  </div>
                  <p className="mt-3 flex items-start gap-2 text-[12px] leading-snug text-gray-500">
                    <span aria-hidden="true">🔒</span> United States delivery for this drop. Your details are used only to send your gift and are never sold.
                  </p>
                </div>

                {/* Consent + fine print — compact */}
                <div className="border-t border-[#f0ead8] px-5 py-4 sm:px-6">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      checked={form.marketing}
                      onChange={(e) => setForm((f) => ({ ...f, marketing: e.target.checked }))}
                      className="mt-0.5 h-5 w-5 rounded accent-[#9a6f16]"
                    />
                    <span className="text-[12.5px] leading-snug text-gray-600">
                      <span className="font-semibold text-[#3d4350]">Optional:</span> keep me posted on future Luxedge drops, deals and
                      pet-care guides. Unticked by default — we never send marketing without your say-so.
                    </span>
                  </label>
                </div>

                {/* Honeypot + review note */}
                <input type="text" name="company" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />

                {/* CTA */}
                <div className="border-t border-[#f0ead8] bg-[#fbfaf6] px-5 py-5 sm:px-6">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1b1f27] px-6 py-4 text-[15px] font-bold text-white shadow-[0_12px_28px_-12px_rgba(27,31,39,0.55)] transition hover:bg-[#2b3140] hover:shadow-[0_14px_30px_-12px_rgba(27,31,39,0.6)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submitting ? (
                      <>
                        <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        Reserving your gift…
                      </>
                    ) : (
                      <>
                        <span aria-hidden="true">🎁</span> Reserve My Complimentary Gift
                      </>
                    )}
                  </button>
                  <p className="mt-3 text-center text-[12px] font-medium text-[#5b626e]">
                    $0 product · $0 standard shipping · No credit card · One per household
                  </p>
                </div>
              </div>
            </form>

            {/* ---- compact info column ---- */}
<aside>
              <div className="rounded-2xl border border-[#ece5d4] bg-white p-5 shadow-[0_1px_2px_rgba(27,31,39,0.04)] sm:p-6">
                <h3 className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.14em] text-[#7c5a10]">
                  <span aria-hidden="true">🤝</span> Why we give gifts
                </h3>
                <p className="mt-2.5 text-[13px] leading-relaxed text-[#5b626e]">
                  We'd rather put a real product in your pet's paws than spend the same money on ads. Tell us about your dog or cat and we'll send a complimentary gift from our current stock.
                </p>
                <ul className="mt-4 space-y-2 text-[13px] text-[#3d4350]">
                  {[
                    'No purchase, no card, no payment step',
                    'Product + standard shipping: $0',
                    'Real inventory — the number you see is real',
                    'One gift per eligible household',
                  ].map((t) => (
                    <li key={t} className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#f6efdd] text-[#9a6f16]">
                        <CheckMark />
                      </span>
                      {t}
                    </li>
                  ))}
                </ul>
                <p className="mt-4 rounded-xl border border-[#f0ead8] bg-[#fbfaf6] p-3.5 text-[12px] leading-relaxed text-gray-500">
                  <span className="font-semibold text-[#3d4350]">Fine print, plainly:</span> limited to real inventory. One gift per email and per household. When gifts run out, the form closes — we never oversell. After you try it, we'd appreciate your <em>honest</em> feedback — positive or negative.
                </p>
              </div>
            </aside>
          </div>
        )}

        {/* ---- success ---- */}
        {success && (
          <div className="mx-auto max-w-xl text-center">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-[#f6efdd] shadow-[0_0_0_10px_rgba(154,111,22,0.08)]">
              <span className="text-3xl" aria-hidden="true">✓</span>
            </div>
            <h2 className="mt-5 text-2xl font-bold tracking-tight text-[#1b1f27] sm:text-3xl">
              Your gift is reserved{success.test ? ' (TEST)' : ''}!
            </h2>
            <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-[#5b626e]">
              <strong className="font-semibold text-[#1b1f27]">{success.giftName}</strong> is matched to your pet and headed your way soon.
            </p>

            <div className="mx-auto mt-6 max-w-md overflow-hidden rounded-2xl border border-[#ece5d4] bg-white text-left shadow-[0_12px_32px_-16px_rgba(27,31,39,0.18)]">
              <div className="flex items-center justify-between border-b border-[#f0ead8] px-5 py-3.5">
                <span className="text-[13px] text-gray-500">Claim reference</span>
                <span className="font-mono text-[14px] font-bold text-[#7c5a10]">{success.orderNumber}</span>
              </div>
              <div className="flex items-center justify-between border-b border-[#f0ead8] px-5 py-3.5">
                <span className="text-[13px] text-gray-500">Cost</span>
                <span className="text-[13px] font-bold text-emerald-700">$0.00 — nothing to pay</span>
              </div>
              <div className="flex items-center justify-between border-b border-[#f0ead8] px-5 py-3.5">
                <span className="text-[13px] text-gray-500">Payment collected</span>
                <span className="text-[13px] font-semibold text-[#1b1f27]">None — no card was ever asked for</span>
              </div>
              <div className="flex items-center justify-between px-5 py-3.5">
                <span className="text-[13px] text-gray-500">Confirmation email</span>
                <span className="text-[13px] font-semibold text-[#1b1f27]">On its way 🎉</span>
              </div>
            </div>

            <div className="mx-auto mt-6 max-w-md rounded-2xl border border-[#ece5d4] bg-white p-5 text-left shadow-[0_12px_32px_-16px_rgba(27,31,39,0.14)]">
              <p className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#7c5a10]">What happens next</p>
              <ol className="mt-3 space-y-3">
                {[
                  'We email your confirmation with the reference above.',
                  'We prepare and ship your gift — complimentary standard shipping.',
                  'After you try it, we may ask for honest feedback. No review is ever required for the gift itself.',
                ].map((t, i) => (
                  <li key={t} className="flex items-start gap-3 text-[13px] leading-snug text-[#3d4350]">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#f6efdd] text-[11px] font-bold text-[#9a6f16]">{i + 1}</span>
                    {t}
                  </li>
                ))}
              </ol>
            </div>

            <a href="/" className="mt-7 inline-block rounded-full border border-[#1b1f27]/15 bg-white px-6 py-2.5 text-sm font-semibold text-[#1b1f27] transition hover:border-[#9a6f16] hover:text-[#7c5a10]">
              ← Back to Luxedge
            </a>
          </div>
        )}

        {/* ============ COMPACT FAQ + FOOTNOTE ============ */}
        {state.phase === 'open' && (
          <div className="mx-auto mt-10 max-w-3xl border-t border-[#ece5d4] pt-6">
            <div className="grid gap-5 sm:grid-cols-3">
              {[
                { q: 'Is this really free?', a: 'Yes — product and standard shipping are $0. There is no payment step on this page at all.' },
                { q: 'Is a review required?', a: 'No. Your gift is unconditional once confirmed; honest feedback later is appreciated, never required.' },
                { q: 'Why the address?', a: 'Only to deliver the free product. We never sell it and never use it for marketing.' },
              ].map((f) => (
                <div key={f.q}>
                  <p className="text-[13px] font-bold text-[#1b1f27]">{f.q}</p>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-gray-500">{f.a}</p>
                </div>
              ))}
            </div>
            <p className="mt-6 text-center text-[12px] text-gray-400">
              Genuine Luxedge promotion · One gift per household · Questions?{' '}
              <a className="font-semibold text-[#9a6f16] underline" href="mailto:hello@luxedge.us">hello@luxedge.us</a>
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

// ============================================================================
// WAITLIST — shown only when the drop is paused or fully claimed.
//
// Explicit consent: the visitor submits their email *only* to be notified
// about the next Pet Gift Drop, and the submit itself is the opt-in. The lead
// is stored through the existing CRM capture endpoint (source=manual) with
// message metadata = pet-gift-drop-waitlist, so the owner can segment it.
// ============================================================================
function WaitlistForm() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  const join = async (e: FormEvent) => {
    e.preventDefault();
    const em = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      setState('error');
      setMsg('That email address does not look valid.');
      return;
    }
    setState('sending');
    setMsg('');
    try {
      const res = await fetch('/api/crm/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: em,
          source: 'manual',
          optedIn: true,
          pageUrl: typeof window !== 'undefined' ? window.location.href : 'https://luxedge.us/free-pet-gift',
          message: 'pet-gift-drop-waitlist',
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.ok) {
        setState('done');
      } else {
        setState('error');
        setMsg(d.error || 'We could not save your email just now — please try again.');
      }
    } catch {
      setState('error');
      setMsg('Network error — please check your connection and try again.');
    }
  };

  if (state === 'done') {
    return (
      <div className="mx-auto mt-6 max-w-sm rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-left">
        <p className="text-sm font-bold text-emerald-800">You're on the list! ✓</p>
        <p className="mt-1 text-[12.5px] leading-snug text-emerald-700">
          We'll email you only when the next Pet Gift Drop opens — no spam, and you can unsubscribe anytime.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={join} className="mx-auto mt-6 max-w-sm text-left">
      <p className="text-sm font-semibold text-[#1b1f27]">Notify me about the next Pet Gift Drop</p>
      <p className="mt-1 text-[12px] text-gray-500">
        Submitting your email is your opt-in — we'll only use it to tell you when a new drop opens.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-[15px] text-gray-900 placeholder:text-gray-400 focus:border-[#9a6f16] focus:outline-none focus:ring-2 focus:ring-[#9a6f16]/20"
        />
        <button
          type="submit"
          disabled={state === 'sending'}
          className="rounded-lg bg-[#1b1f27] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#2b3140] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {state === 'sending' ? 'Saving…' : 'Notify me'}
        </button>
      </div>
      {state === 'error' && msg && <p className="mt-2 text-center text-[12px] text-rose-600">{msg}</p>}
    </form>
  );
}