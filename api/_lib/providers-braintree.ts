// ============================================================================
// LUXEDGE — BRAINTREE PAYMENT PROVIDER
//
// Braintree Direct: eBay-style card → bank payout.
// Client: Braintree JS SDK with Hosted Fields (card tokenization).
// Server: Braintree Transaction API.
// Raw card data never passes through Luxedge.
//
// Required env:
//   BRAINTREE_ENVIRONMENT      sandbox | production
//   BRAINTREE_MERCHANT_ID      server-only
//   BRAINTREE_PUBLIC_KEY       public (client SDK)
//   BRAINTREE_PRIVATE_KEY      server-only secret
// ============================================================================

import { registerProvider, type PaymentProvider, type PaymentRequest, type RefundRequest } from './payment-providers.js';

function env(key: string): string {
  return (process.env[key] || '').trim();
}

function isConfigured(): boolean {
  return !!(env('BRAINTREE_MERCHANT_ID') && env('BRAINTREE_PUBLIC_KEY') && env('BRAINTREE_PRIVATE_KEY'));
}

// Braintree uses braintree npm package for server-side operations
let braintreeModule: typeof import('braintree') | null = null;

async function getGateway() {
  if (!isConfigured()) return null;
  if (!braintreeModule) {
    try {
      braintreeModule = await import('braintree') as typeof import('braintree');
    } catch {
      return null;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bt = braintreeModule as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gateway = new (bt.gateway || bt.BraintreeGateway)({
    environment: env('BRAINTREE_ENVIRONMENT') === 'production' ? 'production' : 'sandbox',
    merchantId: env('BRAINTREE_MERCHANT_ID'),
    publicKey: env('BRAINTREE_PUBLIC_KEY'),
    privateKey: env('BRAINTREE_PRIVATE_KEY'),
  });
  return gateway;
}

const braintreeProvider: PaymentProvider = {
  id: 'braintree',
  name: 'Braintree',

  isConfigured,

  async testConnection() {
    if (!isConfigured()) return { ok: false, message: 'Braintree credentials not configured.' };
    const gateway = await getGateway();
    if (!gateway) return { ok: false, message: 'Braintree SDK not available.' };
    try {
      const result = await gateway.clientToken.generate({});
      if (result.clientToken) {
        return {
          ok: true,
          message: 'Braintree connection verified.',
          mode: env('BRAINTREE_ENVIRONMENT') || 'sandbox',
          masked: env('BRAINTREE_MERCHANT_ID').slice(0, 6) + '••••',
        };
      }
      return { ok: false, message: 'Braintree client token generation failed.' };
    } catch (e) {
      return { ok: false, message: `Braintree error: ${(e as Error).message}` };
    }
  },

  async createPayment(req: PaymentRequest) {
    if (!isConfigured()) return { ok: false, provider: 'braintree', message: 'Braintree not configured.' };
    const gateway = await getGateway();
    if (!gateway) return { ok: false, provider: 'braintree', message: 'Braintree SDK not available.' };

    try {
      const nonce = req.metadata?.nonce;
      if (!nonce) return { ok: false, provider: 'braintree', message: 'Payment nonce required.' };

      const result = await gateway.transaction.sale({
        amount: (req.amountCents / 100).toFixed(2),
        paymentMethodNonce: nonce,
        options: { submitForSettlement: true },
        order_id: req.orderNumber,
        customer: { email: req.customerEmail },
        descriptor: { name: 'LUXEDGE*' },
      });

      if (!result?.success) {
        const msg = result?.transaction?.status || 'Braintree payment failed';
        return { ok: false, provider: 'braintree', message: msg };
      }

      return {
        ok: true,
        provider: 'braintree',
        providerPaymentId: result.transaction?.id,
        status: result.transaction?.status,
      };
    } catch (e) {
      return { ok: false, provider: 'braintree', message: (e as Error).message };
    }
  },

  async getPaymentStatus(paymentId: string) {
    const gateway = await getGateway();
    if (!gateway) return { status: 'unknown' };
    try {
      const tx = await gateway.transaction.find(paymentId);
      return { status: tx.status, amountCents: Math.round(parseFloat(tx.amount) * 100) };
    } catch {
      return { status: 'unknown' };
    }
  },

  async capturePayment(paymentId: string, amountCents?: number) {
    const gateway = await getGateway();
    if (!gateway) return { ok: false, provider: 'braintree', message: 'SDK not available.' };
    try {
      const amount = amountCents ? (amountCents / 100).toFixed(2) : undefined;
      await gateway.transaction.submitForSettlement(paymentId, amount);
      return { ok: true, provider: 'braintree', status: 'settled' };
    } catch (e) {
      return { ok: false, provider: 'braintree', message: (e as Error).message };
    }
  },

  async cancelPayment(paymentId: string) {
    const gateway = await getGateway();
    if (!gateway) return { ok: false, provider: 'braintree', message: 'SDK not available.' };
    try {
      await gateway.transaction.void(paymentId);
      return { ok: true, provider: 'braintree' };
    } catch (e) {
      return { ok: false, provider: 'braintree', message: (e as Error).message };
    }
  },

  async refund(req: RefundRequest) {
    const gateway = await getGateway();
    if (!gateway) return { ok: false, provider: 'braintree', message: 'SDK not available.' };
    try {
      const result = await gateway.transaction.refund(req.providerPaymentId, req.amountCents ? (req.amountCents / 100).toFixed(2) : undefined);
      return { ok: result?.success || false, provider: 'braintree', refundId: result?.refund?.id };
    } catch (e) {
      return { ok: false, provider: 'braintree', message: (e as Error).message };
    }
  },

  async handleWebhook(body: unknown, _headers: Record<string, string>) {
    const event = body as { kind?: string; transaction?: { id?: string; status?: string } };
    if (!event.kind) return null;
    return {
      provider: 'braintree',
      type: event.kind,
      paymentId: event.transaction?.id,
      safeData: { kind: event.kind, transactionStatus: event.transaction?.status },
    };
  },

  getClientConfig() {
    if (!isConfigured()) return null;
    return {
      merchantId: env('BRAINTREE_MERCHANT_ID'),
      publicKey: env('BRAINTREE_PUBLIC_KEY'),
      environment: env('BRAINTREE_ENVIRONMENT') || 'sandbox',
    };
  },
};

registerProvider(braintreeProvider);
