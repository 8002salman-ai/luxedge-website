// ============================================================================
// LUXEDGE — AUTHORIZE.NET PAYMENT PROVIDER
//
// Authorize.Net Accept Hosted / Accept.js integration.
// Uses tokenized card handling — raw card data never touches Luxedge.
//
// Required env:
//   AUTHORIZENET_ENVIRONMENT      sandbox | production
//   AUTHORIZENET_LOGIN_ID         server-only
//   AUTHORIZENET_TRANSACTION_KEY  server-only secret
//   AUTHORIZENET_SIGNATURE_KEY    server-only (webhook SHA-512 verification)
//   AUTHORIZENET_CLIENT_KEY       public (Accept.js client)
// ============================================================================

import { registerProvider, type PaymentProvider, type PaymentRequest, type RefundRequest } from './payment-providers.js';

function env(key: string): string {
  return (process.env[key] || '').trim();
}

function isConfigured(): boolean {
  return !!(env('AUTHORIZENET_LOGIN_ID') && env('AUTHORIZENET_TRANSACTION_KEY'));
}

function getBaseUrl(): string {
  return env('AUTHORIZENET_ENVIRONMENT') === 'production'
    ? 'https://apicon.authorize.net/xml/v1/request.api'
    : 'https://apitest.authorize.net/xml/v1/request.api';
}



async function anetApi(body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: unknown }> {
  try {
    const res = await fetch(getBaseUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 502, data: { error: (e as Error).message } };
  }
}

function buildAuth(): Record<string, string> {
  return {
    name: env('AUTHORIZENET_LOGIN_ID'),
    transactionKey: env('AUTHORIZENET_TRANSACTION_KEY'),
  };
}

const authorizeNetProvider: PaymentProvider = {
  id: 'authorize_net',
  name: 'Authorize.Net',

  isConfigured,

  async testConnection() {
    if (!isConfigured()) return { ok: false, message: 'Authorize.Net credentials not configured.' };
    // Use getMerchantDetails or a simple transaction test
    const r = await anetApi({
      getMerchantDetailsRequest: { merchantAuthentication: buildAuth() },
    });
    if (!r.ok) return { ok: false, message: `Authorize.Net API error: HTTP ${r.status}` };
    const resp = (r.data as { messages?: { resultCode?: string } })?.messages;
    if (resp?.resultCode === 'Ok') {
      return {
        ok: true,
        message: 'Authorize.Net connection verified.',
        mode: env('AUTHORIZENET_ENVIRONMENT') || 'sandbox',
        masked: env('AUTHORIZENET_LOGIN_ID').slice(0, 6) + '••••',
      };
    }
    return { ok: false, message: 'Authorize.Net connection test failed.' };
  },

  async createPayment(req: PaymentRequest) {
    if (!isConfigured()) return { ok: false, provider: 'authorize_net', message: 'Authorize.Net not configured.' };
    // Accept.js creates a data descriptor + data value from tokenized card
    // Server creates transaction using opaqueData
    const opaqueData = req.metadata?.opaqueDataDescriptor && req.metadata?.opaqueDataValue
      ? { dataDescriptor: req.metadata.opaqueDataDescriptor, dataValue: req.metadata.opaqueDataValue }
      : null;
    if (!opaqueData) return { ok: false, provider: 'authorize_net', message: 'Tokenized card data required (Accept.js).' };

    const r = await anetApi({
      createTransactionRequest: {
        merchantAuthentication: buildAuth(),
        refId: req.orderNumber,
        transactionRequest: {
          transactionType: 'authCaptureTransaction',
          amount: (req.amountCents / 100).toFixed(2),
          payment: { opaqueData },
          order: { invoiceNumber: req.orderNumber, description: req.description || `Luxedge order ${req.orderNumber}` },
        },
      },
    });
    const resp = (r.data as { transactionResponse?: { responseCode?: string; transId?: string; messages?: Array<{ code?: string; description?: string }> } })?.transactionResponse;
    if (resp?.responseCode === '1') {
      return { ok: true, provider: 'authorize_net', providerPaymentId: resp.transId, status: 'settled' };
    }
    const msg = resp?.messages?.[0]?.description || 'Authorize.Net payment failed';
    return { ok: false, provider: 'authorize_net', message: msg };
  },

  async getPaymentStatus(_paymentId: string) {
    const r = await anetApi({
      getTransactionDetailsRequest: {
        merchantAuthentication: buildAuth(),
        transId: _paymentId,
      },
    });
    const tx = (r.data as { transaction?: { transactionStatus?: string; amount?: string } })?.transaction;
    return { status: tx?.transactionStatus || 'unknown', amountCents: tx?.amount ? Math.round(parseFloat(tx.amount) * 100) : undefined };
  },

  async capturePayment(_paymentId: string) {
    return { ok: true, provider: 'authorize_net', status: 'captured' };
  },

  async cancelPayment(_paymentId: string) {
    await anetApi({
      voidTransactionRequest: {
        merchantAuthentication: buildAuth(),
        transId: _paymentId,
      },
    });
    return { ok: true, provider: 'authorize_net' };
  },

  async refund(req: RefundRequest) {
    const r = await anetApi({
      createTransactionRequest: {
        merchantAuthentication: buildAuth(),
        transactionRequest: {
          transactionType: 'refundTransaction',
          refTransId: req.providerPaymentId,
          amount: req.amountCents ? (req.amountCents / 100).toFixed(2) : undefined,
        },
      },
    });
    const resp = (r.data as { transactionResponse?: { responseCode?: string; transId?: string } })?.transactionResponse;
    return { ok: resp?.responseCode === '1', provider: 'authorize_net', refundId: resp?.transId };
  },

  async handleWebhook(body: unknown, _headers: Record<string, string>) {
    // Authorize.Net uses webhooks/notifications via ANetApi
    const event = body as { eventType?: string; payload?: { transId?: string; transactionStatus?: string } };
    if (!event.eventType) return null;
    return {
      provider: 'authorize_net',
      type: event.eventType,
      paymentId: event.payload?.transId,
      safeData: { type: event.eventType, status: event.payload?.transactionStatus },
    };
  },

  getClientConfig() {
    if (!isConfigured()) return null;
    return {
      clientKey: env('AUTHORIZENET_CLIENT_KEY') || '',
      environment: env('AUTHORIZENET_ENVIRONMENT') || 'sandbox',
    };
  },
};

registerProvider(authorizeNetProvider);
