// ============================================================================
// LUXEDGE — ON-SITE CHECKOUT PAGE (PaymentElement)
//
// Replaces the "redirect to Stripe" step with an embedded, Stripe-hosted card
// form on luxedge.us. The page:
//   1. collects contact + shipping address (validated against Shippo/USPS with
//      an explicit "did you mean" suggestion when a correction is proposed),
//   2. fetches live carrier rates for the address + cart (falls back to the
//      store flat rate honestly when items/Shippo can't produce rates),
//   3. lets the customer pick a rate, apply a coupon and review totals
//      (display copies only — the server recomputes everything),
//   4. calls /api/checkout/onsite which reserves inventory, persists a
//      pending order and creates the PaymentIntent,
//   5. renders the Stripe PaymentElement and confirms payment ON-SITE,
//   6. verifies the intent server-side (/api/checkout/verify) before showing
//      success — never a client-side fake.
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../../App';
import {
  fetchOnsiteConfig,
  fetchCheckoutRates,
  validateCheckoutAddress,
  startOnsiteCheckout,
  verifyOnsitePayment,
  type OnsiteCheckoutConfig,
  type CheckoutAddress,
  type ShippoRate,
  type AddressValidationResult,
  type OnsiteIntentResult,
} from '../../services/checkoutOnsite';
import OnsitePaymentForm from './OnsitePaymentForm';

const FREE_SHIPPING_FALLBACK = 4.99;
const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

interface FieldState {
  email: string; phone: string; fullName: string;
  addressLine1: string; addressLine2: string; city: string; state: string; postalCode: string; country: string;
}

export default function CheckoutOnsitePage() {
  const { cart, coupon, applyCoupon, removeCoupon, freeShippingEnabled, freeShippingThreshold, user, clearCart, notify } = useApp();
  const nav = useNavigate();

  const [config, setConfig] = useState<OnsiteCheckoutConfig | null>(null);
  const [f, setF] = useState<FieldState>({
    email: user?.email || '', phone: '', fullName: user?.name || '',
    addressLine1: '', addressLine2: '', city: '', state: '', postalCode: '', country: 'US',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [couponInput, setCouponInput] = useState('');
  const [billingSame, setBillingSame] = useState(true);
  const [billing, setBilling] = useState<FieldState>({ ...f, fullName: user?.name || '' });
  const [couponApplied, setCouponApplied] = useState<string | null>(coupon?.code || null);

  // Address validation (Shippo)
  const [addrChecking, setAddrChecking] = useState(false);
  const [addrResult, setAddrResult] = useState<AddressValidationResult | null>(null);
  const [addrError, setAddrError] = useState('');
  const debounceRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Rates
  const [rates, setRates] = useState<ShippoRate[]>([]);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [ratesError, setRatesError] = useState('');
  const [ratesAttempted, setRatesAttempted] = useState(false);
  const [selectedRateId, setSelectedRateId] = useState<string | null>(null);

  // Payment
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const [paymentSession, setPaymentSession] = useState<OnsiteIntentResult | null>(null);
  const [confirmError, setConfirmError] = useState('');

  const addressComplete = Boolean(f.fullName.trim() && f.addressLine1.trim() && f.city.trim() && f.state.trim() && /^\d{5}/.test(f.postalCode));

  const shippingAddress = useMemo<CheckoutAddress>(() => ({
    fullName: f.fullName,
    addressLine1: f.addressLine1,
    addressLine2: f.addressLine2,
    city: f.city,
    state: f.state,
    postalCode: f.postalCode,
    country: f.country || 'US',
  }), [f]);

  useEffect(() => {
    let live = true;
    fetchOnsiteConfig().then((c) => { if (live) setConfig(c); }).catch(() => { if (live) setConfig({ stripeConfigured: false, stripePublishableKey: null, stripeMode: null, shippoConfigured: false }); });
    return () => { live = false; };
  }, []);

  const setField = (k: keyof FieldState, v: string) => setF((cur) => ({ ...cur, [k]: v }));

  // Debounced address validation → live rates.
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();
    if (!addressComplete) {
      setAddrResult(null);
      setAddrError('');
      setRates([]);
      setRatesAttempted(false);
      return;
    }
    debounceRef.current = window.setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      setAddrChecking(true);
      setAddrError('');
      try {
        const v = await validateCheckoutAddress(shippingAddress, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setAddrResult(v);
        // Auto-apply safe normalizations (state abbreviation + ZIP format)
        // when Shippo found no *street-level* correction.
        if (v.isValid && !v.recommendedAddress) {
          const n = v.normalizedAddress;
          setF((cur) => ({
            ...cur,
            state: n.state || cur.state,
            postalCode: n.postalCode || cur.postalCode,
          }));
        }
        // Live rates only after the address validates.
        if (v.isValid) {
          setRatesLoading(true);
          setRatesError('');
          try {
            const rateAddr: CheckoutAddress = {
              ...shippingAddress,
              state: v.normalizedAddress.state || shippingAddress.state,
              postalCode: v.normalizedAddress.postalCode || shippingAddress.postalCode,
            };
            const r = await fetchCheckoutRates(rateAddr, cart.map((i) => ({ productId: i.product.id, quantity: i.quantity })), { signal: controller.signal });
            if (controller.signal.aborted) return;
            setRates(r.rates);
            setRatesAttempted(true);
            setSelectedRateId((cur) => (cur && r.rates.some((x) => x.objectId === cur) ? cur : (r.rates[0]?.objectId || null)));
          } catch (e) {
            if (controller.signal.aborted) return;
            setRates([]);
            setRatesAttempted(true);
            setRatesError((e as Error).message || 'Live rates unavailable — store flat shipping applies.');
          } finally {
            if (!controller.signal.aborted) setRatesLoading(false);
          }
        } else {
          setRates([]);
          setRatesAttempted(false);
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        setAddrResult(null);
        setAddrError((e as Error).message || 'Could not validate the address right now.');
        setRates([]);
        setRatesAttempted(false);
      } finally {
        if (!controller.signal.aborted) setAddrChecking(false);
      }
    }, 750);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressComplete, shippingAddress, cart]);

  const acceptSuggestion = () => {
    if (!addrResult?.recommendedAddress) return;
    const s = addrResult.recommendedAddress;
    setF((cur) => ({ ...cur, addressLine1: s.addressLine1, addressLine2: s.addressLine2 || '', city: s.city, state: s.state, postalCode: s.postalCode, country: s.country || 'US' }));
    setAddrResult((cur) => (cur ? { ...cur, recommendedAddress: undefined, isValid: true, messages: [] } : cur));
  };

  // ---- Client display totals (server re-verifies every amount) ----
  const subtotal = cart.reduce((s, i) => s + (i.product.price || 0) * i.quantity, 0);
  const couponDiscount = coupon ? (coupon.discountType === 'percent' ? Math.round(subtotal * coupon.discountValue) / 100 : Math.min(subtotal, coupon.discountValue)) : 0;
  const discountedSubtotal = Math.max(0, subtotal - couponDiscount);
  const freeShippingNow = freeShippingEnabled && discountedSubtotal >= freeShippingThreshold;
  const selectedRate = rates.find((r) => r.objectId === selectedRateId) || null;
  const shipping = freeShippingNow ? 0 : selectedRate ? selectedRate.amount : FREE_SHIPPING_FALLBACK;
  const total = +(discountedSubtotal + shipping).toFixed(2);
  const shippingLabel = freeShippingNow
    ? 'FREE'
    : selectedRate
      ? `$${selectedRate.amount.toFixed(2)}`
      : ratesAttempted && rates.length === 0 && !ratesLoading
        ? `$${FREE_SHIPPING_FALLBACK.toFixed(2)} (store rate)`
        : '—';

  const applyCouponLocal = () => {
    const code = couponInput.trim().toUpperCase();
    if (!code) return;
    const errMsg = applyCoupon(code);
    if (errMsg) notify(errMsg, 'error');
    else { setCouponApplied(code); notify('Coupon applied!'); }
    setCouponInput('');
  };

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!f.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) e.email = 'Valid email required';
    if (!f.fullName.trim()) e.fullName = 'Required';
    if (!f.addressLine1.trim()) e.addressLine1 = 'Required';
    if (!f.city.trim()) e.city = 'Required';
    if (!f.state.trim()) e.state = 'Required';
    if (!/^\d{5}(-\d{4})?$/.test(f.postalCode.trim())) e.postalCode = 'Valid ZIP required';
    if (!billingSame) {
      if (!billing.fullName.trim()) e.billingName = 'Required';
      if (!billing.addressLine1.trim()) e.billingLine1 = 'Required';
      if (!billing.city.trim()) e.billingCity = 'Required';
      if (!billing.state.trim()) e.billingState = 'Required';
      if (!/^\d{5}(-\d{4})?$/.test(billing.postalCode.trim())) e.billingZip = 'Valid ZIP required';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const startPayment = useCallback(async () => {
    if (starting || paymentSession) return;
    setStartError('');
    if (!validate()) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    // Block an obviously unverifiable US address from reaching payment.
    if (addrResult && !addrResult.isValid && addrResult.messages.length > 0) {
      setStartError(addrResult.messages[0] || 'Please correct your shipping address before continuing.');
      return;
    }
    setStarting(true);
    try {
      const result = await startOnsiteCheckout({
        items: cart.map((i) => ({ productId: i.product.id, quantity: i.quantity })),
        couponCode: couponApplied || undefined,
        email: f.email,
        phone: f.phone || undefined,
        fullName: f.fullName,
        address: shippingAddress,
        shippingRateId: selectedRate?.objectId || undefined,
      });
      setPaymentSession(result);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setStartError((e as Error).message || 'Checkout could not start. Please try again.');
    } finally {
      setStarting(false);
    }
  }, [starting, paymentSession, addrResult, cart, couponApplied, f, shippingAddress, selectedRate, validate]);

  const handlePaid = useCallback(async (paymentIntentId: string) => {
    if (!paymentSession) return;
    setConfirmError('');
    try {
      const v = await verifyOnsitePayment(paymentSession.orderNumber, paymentIntentId);
      if (v.paid) {
        clearCart();
        removeCoupon();
        nav(`/checkout/success?source=onsite&intent=${encodeURIComponent(paymentIntentId)}&order=${encodeURIComponent(paymentSession.orderNumber)}`);
      } else {
        setConfirmError('Payment is still processing. If you were charged, the order will be confirmed by email shortly.');
      }
    } catch (e) {
      // A succeeded intent that just hadn't reached the DB yet must not look
      // like a failure — re-verify once after a short wait.
      try {
        await new Promise((r) => setTimeout(r, 1500));
        const v2 = await verifyOnsitePayment(paymentSession.orderNumber, paymentIntentId);
        if (v2.paid) {
          clearCart(); removeCoupon();
          nav(`/checkout/success?source=onsite&intent=${encodeURIComponent(paymentIntentId)}&order=${encodeURIComponent(paymentSession.orderNumber)}`);
          return;
        }
      } catch { /* fall through */ }
      setConfirmError((e as Error).message || 'Payment succeeded but we could not confirm it. Please check your email for a receipt.');
    }
  }, [paymentSession, nav, clearCart, removeCoupon]);

  if (cart.length === 0) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4 bg-luxe-cream">
        <div className="text-center max-w-md">
          <h1 className="font-serif text-2xl font-bold text-luxe-black mb-2">Your cart is empty</h1>
          <p className="text-sm text-luxe-gray mb-6">Add a product before checking out.</p>
          <Link to="/shop" className="inline-block px-6 py-3 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-bold rounded-full text-sm">Shop now</Link>
        </div>
      </div>
    );
  }

  const inputCls = 'w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-luxe-gold focus:ring-2 focus:ring-luxe-gold/20 transition-all';
  const labelCls = 'block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5';
  const err = (k: string) => (errors[k] ? <p className="text-red-500 text-xs mt-1">{errors[k]}</p> : null);

  return (
    <div className="bg-luxe-cream min-h-screen pb-24">
      <div className="max-w-6xl mx-auto px-4 py-10">
        <p className="eyebrow mb-2">Checkout</p>
        <h1 className="font-serif text-3xl font-bold text-luxe-black mb-1">Secure Checkout</h1>
        <p className="text-sm text-luxe-gray mb-8">Pay safely right here on luxedge.us — no redirects, no card details stored.</p>

        <div className="grid lg:grid-cols-5 gap-8">
          <div className="lg:col-span-3 space-y-6">
            {startError && (
              <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
                <div className="flex-1"><p className="text-sm font-semibold text-red-800">Checkout could not start</p><p className="text-xs text-red-700 mt-0.5">{startError}</p></div>
              </div>
            )}

            {/* CONTACT */}
            <section className="bg-white rounded-2xl border border-luxe-silver/70 p-6 shadow-sm">
              <h2 className="font-bold text-lg mb-5">Contact</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className={labelCls}>Email *</label>
                  <input type="email" value={f.email} onChange={(e) => setField('email', e.target.value)} className={inputCls} placeholder="you@example.com" autoComplete="email" />
                  {err('email')}
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>Phone (for delivery updates)</label>
                  <input type="tel" value={f.phone} onChange={(e) => setField('phone', e.target.value)} className={inputCls} placeholder="(555) 123-4567" autoComplete="tel" />
                </div>
              </div>
            </section>

            {/* SHIPPING */}
            <section className="bg-white rounded-2xl border border-luxe-silver/70 p-6 shadow-sm">
              <h2 className="font-bold text-lg mb-5">Shipping Address</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className={labelCls}>Full name *</label>
                  <input value={f.fullName} onChange={(e) => setField('fullName', e.target.value)} className={inputCls} autoComplete="name" />
                  {err('fullName')}
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>Street address *</label>
                  <input value={f.addressLine1} onChange={(e) => { setField('addressLine1', e.target.value); setAddrResult(null); }} className={inputCls} placeholder="123 Main Street" autoComplete="address-line1" />
                  {err('addressLine1')}
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>Apt / suite (optional)</label>
                  <input value={f.addressLine2} onChange={(e) => setField('addressLine2', e.target.value)} className={inputCls} autoComplete="address-line2" />
                </div>
                <div>
                  <label className={labelCls}>City *</label>
                  <input value={f.city} onChange={(e) => { setField('city', e.target.value); setAddrResult(null); }} className={inputCls} autoComplete="address-level2" />
                  {err('city')}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>State *</label>
                    <select value={f.state} onChange={(e) => { setField('state', e.target.value); setAddrResult(null); }} className={inputCls}>
                      <option value="">--</option>
                      {US_STATES.map((s) => <option key={s}>{s}</option>)}
                    </select>
                    {err('state')}
                  </div>
                  <div>
                    <label className={labelCls}>ZIP *</label>
                    <input value={f.postalCode} onChange={(e) => { setField('postalCode', e.target.value); setAddrResult(null); }} className={inputCls} placeholder="75038" maxLength={10} autoComplete="postal-code" />
                    {err('postalCode')}
                  </div>
                </div>
              </div>

              {/* Address validation status */}
              {addrChecking && <p className="mt-4 text-xs text-gray-500 flex items-center gap-2">Verifying your delivery address…</p>}
              {!addrChecking && addrError && (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <p className="font-semibold">Address check unavailable</p>
                  <p className="text-xs mt-0.5">{addrError} You can still continue — delivery will be confirmed at fulfilment.</p>
                </div>
              )}
              {!addrChecking && addrResult && addrResult.isValid && !addrResult.recommendedAddress && (
                <div className="mt-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 flex items-start gap-2">
                  <span>✓</span>
                  <span><b>Address verified</b>{addrResult.source === 'shippo' ? ' with USPS' : ''}. Live carrier rates use this address.</span>
                </div>
              )}
              {!addrChecking && addrResult?.recommendedAddress && (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <p className="font-semibold">Did you mean this address?</p>
                  <p className="mt-1.5 leading-6 text-amber-950">
                    {addrResult.recommendedAddress.addressLine1}
                    {addrResult.recommendedAddress.addressLine2 ? `, ${addrResult.recommendedAddress.addressLine2}` : ''}, {addrResult.recommendedAddress.city}, {addrResult.recommendedAddress.state} {addrResult.recommendedAddress.postalCode}
                  </p>
                  {addrResult.messages.length > 0 && <p className="mt-1 text-xs">{addrResult.messages[0]}</p>}
                  <div className="mt-2.5 flex gap-2">
                    <button type="button" onClick={acceptSuggestion} className="px-4 py-2 bg-luxe-gold hover:bg-luxe-gold-dark text-white rounded-lg text-xs font-bold">Use suggested address</button>
                    <button type="button" onClick={() => setAddrResult((cur) => (cur ? { ...cur, recommendedAddress: undefined, isValid: true } : cur))} className="px-4 py-2 border border-gray-200 text-gray-600 rounded-lg text-xs font-semibold">Keep mine</button>
                  </div>
                </div>
              )}
              {!addrChecking && addrResult && !addrResult.isValid && !addrResult.recommendedAddress && (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <p className="font-semibold">Please double-check your address</p>
                  <p className="text-xs mt-0.5">{addrResult.messages[0] || 'We could not fully verify this address. Fix any typos or use standard USPS formatting.'}</p>
                </div>
              )}
            </section>

            {/* SHIPPING METHOD */}
            <section className="bg-white rounded-2xl border border-luxe-silver/70 p-6 shadow-sm">
              <h2 className="font-bold text-lg mb-1">Shipping Method</h2>
              {freeShippingNow ? (
                <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800"><b>Free shipping</b> applies to this order.</div>
              ) : (
                <>
                  {ratesLoading && <p className="text-sm text-gray-500 mt-3">Fetching live carrier rates for your address…</p>}
                  {!ratesLoading && rates.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {rates.map((r) => (
                        <button key={r.objectId} type="button" onClick={() => setSelectedRateId(r.objectId)}
                          className={`w-full text-left rounded-xl border p-3 transition-colors ${selectedRateId === r.objectId ? 'border-luxe-gold bg-luxe-gold-soft/40 ring-1 ring-luxe-gold/30' : 'border-gray-200 hover:border-luxe-gold/40'}`}>
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="font-semibold text-sm text-luxe-black">{r.provider} — {r.serviceName}</p>
                              <p className="text-xs text-gray-500 mt-0.5">{r.estimatedDays ? `${r.estimatedDays} business days` : 'Estimated delivery varies'}</p>
                            </div>
                            <span className="font-bold text-luxe-gold-dark">${r.amount.toFixed(2)}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {!ratesLoading && ratesAttempted && rates.length === 0 && (
                    <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                      {ratesError ? <><b>{ratesError}</b> Store flat shipping applies.</> : 'Live carrier rates are not available for this order — store flat shipping applies.'}
                      <div className="mt-2"><p className="text-xs text-gray-500">Standard shipping · ${FREE_SHIPPING_FALLBACK.toFixed(2)}</p></div>
                    </div>
                  )}
                  {!ratesLoading && !ratesAttempted && addressComplete && <p className="text-xs text-gray-400 mt-3">Enter a complete delivery address to see carrier options.</p>}
                  {!ratesLoading && !ratesAttempted && !addressComplete && <p className="text-xs text-gray-400 mt-3">Complete your address above — standard ${FREE_SHIPPING_FALLBACK.toFixed(2)} shipping applies.</p>}
                </>
              )}
            </section>

            {/* BILLING */}
            <section className="bg-white rounded-2xl border border-luxe-silver/70 p-6 shadow-sm">
              <h2 className="font-bold text-lg mb-4">Billing Details</h2>
              <label className="flex items-center gap-2 cursor-pointer mb-4 text-sm">
                <input type="checkbox" checked={billingSame} onChange={(e) => setBillingSame(e.target.checked)} className="w-4 h-4" />
                Billing address is the same as shipping
              </label>
              {!billingSame && (
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2"><label className={labelCls}>Billing name *</label><input value={billing.fullName} onChange={(e) => setBilling({ ...billing, fullName: e.target.value })} className={inputCls} />{err('billingName')}</div>
                  <div className="sm:col-span-2"><label className={labelCls}>Billing address *</label><input value={billing.addressLine1} onChange={(e) => setBilling({ ...billing, addressLine1: e.target.value })} className={inputCls} />{err('billingLine1')}</div>
                  <div><label className={labelCls}>City *</label><input value={billing.city} onChange={(e) => setBilling({ ...billing, city: e.target.value })} className={inputCls} />{err('billingCity')}</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className={labelCls}>State *</label>
                      <select value={billing.state} onChange={(e) => setBilling({ ...billing, state: e.target.value })} className={inputCls}><option value="">--</option>{US_STATES.map((s) => <option key={s}>{s}</option>)}</select>
                      {err('billingState')}
                    </div>
                    <div><label className={labelCls}>ZIP *</label><input value={billing.postalCode} onChange={(e) => setBilling({ ...billing, postalCode: e.target.value })} className={inputCls} maxLength={10} />{err('billingZip')}</div>
                  </div>
                </div>
              )}
            </section>

            {/* PAYMENT */}
            <section className="bg-white rounded-2xl border border-luxe-silver/70 p-6 shadow-sm">
              <h2 className="font-bold text-lg mb-1">Payment</h2>
              <p className="text-xs text-gray-500 mb-4">Your card is charged only after you review the order below.</p>
              {!config ? (
                <p className="text-sm text-gray-500">Checking payment availability…</p>
              ) : !config.stripeConfigured ? (
                <div className="rounded-xl bg-luxe-gold-soft border border-luxe-gold/20 p-4 text-sm">
                  Card payments are not configured yet on this store. Your cart is saved — please try again later.
                </div>
              ) : paymentSession ? (
                <OnsitePaymentForm
                  publishableKey={config.stripePublishableKey || ''}
                  clientSecret={paymentSession.clientSecret || ''}
                  amountLabel={`$${(paymentSession.totals?.total ?? total).toFixed(2)}`}
                  onSuccess={handlePaid}
                  onError={(m) => { setConfirmError(m); }}
                />
              ) : (
                <p className="text-sm text-gray-500">
                  Complete your contact and shipping details, choose a shipping method, then press <b>Continue to payment</b> below to load the secure card form.
                </p>
              )}
              {confirmError && <p className="mt-3 text-sm text-red-600">{confirmError}</p>}
            </section>
          </div>

          {/* ORDER SUMMARY */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-2xl border border-luxe-silver/70 p-6 shadow-sm lg:sticky lg:top-20">
              <h2 className="font-bold text-lg mb-5">Order Summary</h2>
              <div className="space-y-4 mb-6 max-h-72 overflow-y-auto pr-1">
                {cart.map((item) => {
                  const img = (Array.isArray(item.product.images) && item.product.images[0]) || '';
                  return (
                    <div key={item.product.id} className="flex gap-3">
                      <div className="relative shrink-0">
                        <img src={img} alt="" className="w-14 h-14 object-cover rounded-lg border border-gray-100" />
                        <span className="absolute -top-2 -right-2 w-5 h-5 bg-gray-700 text-white text-[10px] font-bold rounded-full flex items-center justify-center">{item.quantity}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-luxe-black line-clamp-1">{item.product.name}</p>
                        <p className="text-xs text-gray-400">{(item.product.price || 0).toFixed(2)} each</p>
                      </div>
                      <p className="text-sm font-semibold shrink-0">${((item.product.price || 0) * item.quantity).toFixed(2)}</p>
                    </div>
                  );
                })}
              </div>

              <div className="mb-4">
                {couponApplied ? (
                  <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-xl">
                    <div><p className="text-xs font-bold text-green-700">{couponApplied} applied</p>{coupon ? <p className="text-[10px] text-green-600">{coupon.discountType === 'percent' ? `${coupon.discountValue}% off` : `$${coupon.discountValue} off`}</p> : null}</div>
                    <button onClick={() => { removeCoupon(); setCouponApplied(null); }} className="text-[11px] text-green-700 underline">Remove</button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input value={couponInput} onChange={(e) => setCouponInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), applyCouponLocal())} className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="Coupon code" />
                    <button onClick={applyCouponLocal} className="px-4 py-2 bg-luxe-charcoal text-white rounded-lg text-xs font-semibold">Apply</button>
                  </div>
                )}
              </div>

              <div className="border-t pt-4 space-y-2.5 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span className="font-medium">${subtotal.toFixed(2)}</span></div>
                {couponDiscount > 0 && <div className="flex justify-between"><span className="text-gray-500">Coupon ({couponApplied})</span><span className="font-medium text-green-600">−${couponDiscount.toFixed(2)}</span></div>}
                <div className="flex justify-between"><span className="text-gray-500">Shipping</span><span className={`font-medium ${shipping === 0 ? 'text-green-600' : ''}`}>{shippingLabel}</span></div>
                {shipping === 0 && freeShippingEnabled && <p className="text-xs text-luxe-gold">Free shipping applied — order qualifies!</p>}
                <div className="flex justify-between pt-3 border-t">
                  <span className="font-bold text-lg">Total</span>
                  <span className="font-bold text-xl text-gray-900">${total.toFixed(2)}</span>
                </div>
                <p className="text-[10px] text-gray-400">USD · final price — no tax or hidden fees at checkout</p>
              </div>

              <button
                onClick={startPayment}
                disabled={starting || !config?.stripeConfigured || Boolean(paymentSession)}
                className={`mt-6 w-full py-4 rounded-xl text-white font-bold text-sm transition-colors flex items-center justify-center gap-2 shadow-gold ${
                  starting || !config?.stripeConfigured || paymentSession ? 'bg-gray-300 cursor-not-allowed' : 'bg-luxe-gold hover:bg-luxe-gold-dark'
                }`}
              >
                {starting ? 'Reserving your items…' : paymentSession ? 'Card form above' : 'Continue to payment'}
              </button>
              <p className="mt-3 text-center text-[10px] text-gray-400">🔒 256-bit SSL · your order is reserved for 24 hours while you pay</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
