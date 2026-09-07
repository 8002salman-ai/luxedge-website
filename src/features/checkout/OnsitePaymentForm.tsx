// ============================================================================
// LUXEDGE — STRIPE PAYMENT ELEMENT (on-site)
//
// The customer stays on luxedge.us. `clientSecret` comes from the server's
// /api/checkout/onsite after server-authoritative validation. confirmPayment
// runs INSIDE this page; 3DS/redirects are handled by Stripe automatically.
// Success is never assumed — the caller verifies the intent server-side.
// ============================================================================
import { useEffect, useState } from 'react';
import { loadStripe, type Stripe, type StripePaymentElement, type StripeElements } from '@stripe/stripe-js';

export interface OnsitePaymentFormProps {
  publishableKey: string;
  clientSecret: string;
  amountLabel: string;
  onSuccess: (paymentIntentId: string) => Promise<void>;
  onError: (message: string) => void;
}

let stripePromiseCache: Stripe | null = null;
async function getStripe(publishableKey: string): Promise<Stripe | null> {
  if (stripePromiseCache) return stripePromiseCache;
  try {
    stripePromiseCache = await loadStripe(publishableKey);
    return stripePromiseCache;
  } catch {
    return null;
  }
}

export default function OnsitePaymentForm({ publishableKey, clientSecret, amountLabel, onSuccess, onError }: OnsitePaymentFormProps) {
  const [stripe, setStripe] = useState<Stripe | null>(null);
  const [elements, setElements] = useState<StripeElements | null>(null);
  const [element, setElement] = useState<StripePaymentElement | null>(null);
  const [elementReady, setElementReady] = useState(false);
  const [paying, setPaying] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    let mountedElement: StripePaymentElement | null = null;
    (async () => {
      const s = await getStripe(publishableKey);
      if (!live || !s) return;
      try {
        const els = s.elements({ clientSecret });
        const paymentElement = els.create('payment', {
          layout: { type: 'tabs' },
          paymentMethodOrder: ['card'],
        });
        const container = document.getElementById('luxe-payment-element');
        if (!container) return;
        paymentElement.mount(container);
        paymentElement.on('ready', () => { if (live) { setElementReady(true); setFailed(false); } });
        paymentElement.on('change', (e) => { if (live && e && e.complete === false) setFailed(false); });
        mountedElement = paymentElement;
        setStripe(s);
        setElements(els);
        setElement(paymentElement);
      } catch {
        onError('Stripe payment fields could not load. Please refresh and try again.');
      }
    })();
    return () => {
      live = false;
      try { mountedElement?.unmount(); } catch { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientSecret, publishableKey]);

  const pay = async () => {
    if (!stripe || !element || !elements || paying) return;
    setPaying(true);
    setFailed(false);
    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/checkout/success?source=onsite&intent={PAYMENT_INTENT_ID}`,
        },
        redirect: 'if_required',
      });
      if (error) {
        setFailed(true);
        onError(error.message || 'Card payment failed. Please check your details and try again.');
        return;
      }
      if (paymentIntent && paymentIntent.status !== 'succeeded') {
        // Stripe handles 3DS via return_url redirect (handled on the success
        // page). If it returned without redirecting, surface honestly.
        if (paymentIntent.status === 'requires_action' || paymentIntent.status === 'requires_confirmation') {
          onError('Your bank requested additional verification — follow the steps Stripe shows to finish payment.');
          return;
        }
        onError('Payment is still processing. Please wait a moment.');
        return;
      }
      if (paymentIntent) {
        await onSuccess(paymentIntent.id);
      }
    } catch {
      setFailed(true);
      onError('Card payment failed. Please try again.');
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="space-y-4">
      {!elementReady && !failed && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
          Loading secure card payment…
        </div>
      )}
      <div id="luxe-payment-element" />
      <button
        type="button"
        onClick={pay}
        disabled={!elementReady || paying}
        className={`w-full flex items-center justify-center gap-2 py-4 rounded-xl text-white font-bold text-sm transition-colors shadow-gold ${
          !elementReady || paying ? 'bg-gray-300 cursor-not-allowed' : 'bg-luxe-gold hover:bg-luxe-gold-dark'
        }`}
      >
        {paying ? 'Processing payment…' : `Pay ${amountLabel}`}
      </button>
      {failed && (
        <p className="text-xs text-red-600">
          Payment not completed — nothing was charged. Check the card details or try another card.
        </p>
      )}
      <p className="text-[11px] text-gray-400 text-center">
        🔒 Secure payment powered by Stripe · card details never touch Luxedge servers
      </p>
    </div>
  );
}
