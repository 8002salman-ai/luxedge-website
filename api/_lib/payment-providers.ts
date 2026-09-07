// ============================================================================
// LUXEDGE — PAYMENT PROVIDER ENGINE
//
// Provider-neutral payment architecture. Each provider implements the same
// interface so checkout routing, admin config, and order management are
// gateway-agnostic. The "none" provider handles $0 / free-gift orders.
//
// SECURITY: Provider secrets live only in server env / app_settings.
// Client receives only public configuration (publishable keys, client IDs).
// ============================================================================

// ---------------------------------------------------------------------------
// Provider types
// ---------------------------------------------------------------------------

export type ProviderId = 'none' | 'stripe' | 'square' | 'paypal' | 'braintree' | 'payoneer' | 'authorize_net' | 'manual';

export type ProviderStatus = 'not_configured' | 'sandbox' | 'connected' | 'ready' | 'disabled' | 'error';

export type ProviderRole = 'primary' | 'backup' | 'available';

export interface ProviderConfig {
  id: ProviderId;
  name: string;
  enabled: boolean;
  role: ProviderRole;
  status: ProviderStatus;
  mode: 'sandbox' | 'production';
  configuredAt?: string;
  lastTestAt?: string;
  lastTestOk?: boolean;
  lastWebhookAt?: string;
  lastPaymentAt?: string;
  lastError?: string;
  /** Public keys needed by client SDK (publishable key, client ID, etc.) */
  clientConfig?: Record<string, string>;
}

export interface PaymentRequest {
  orderId: string;
  orderNumber: string;
  amountCents: number;
  currency: string;
  description?: string;
  customerEmail?: string;
  customerName?: string;
  /** Provider-specific metadata to pass through */
  metadata?: Record<string, string>;
}

export interface PaymentResult {
  ok: boolean;
  provider: ProviderId;
  /** Provider's payment/transaction ID */
  providerPaymentId?: string;
  /** Provider's order/payment ID */
  providerOrderId?: string;
  /** Client-side data needed to complete payment (e.g. clientSecret, token) */
  clientData?: Record<string, unknown>;
  /** Status from provider */
  status?: string;
  /** Human-readable message */
  message?: string;
  /** HTTP status for errors */
  httpStatus?: number;
}

export interface WebhookEvent {
  provider: ProviderId;
  type: string;
  /** Provider payment ID */
  paymentId?: string;
  /** Raw event data (safe for logging, secrets stripped) */
  safeData?: Record<string, unknown>;
}

export interface RefundRequest {
  orderId: string;
  providerPaymentId: string;
  amountCents?: number; // partial refund; null = full
  reason?: string;
}

export interface RefundResult {
  ok: boolean;
  provider: ProviderId;
  refundId?: string;
  amountCents?: number;
  message?: string;
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface PaymentProvider {
  readonly id: ProviderId;
  readonly name: string;

  /** Check if the provider has sufficient credentials configured */
  isConfigured(): boolean;

  /** Live connection test (safe, non-destructive) */
  testConnection(): Promise<{ ok: boolean; message: string; mode?: string; masked?: string }>;

  /** Create a payment / initiate checkout. Returns client data if needed. */
  createPayment(req: PaymentRequest): Promise<PaymentResult>;

  /** Verify payment status server-side (used after browser callback + webhook backup) */
  getPaymentStatus(paymentId: string): Promise<{ status: string; amountCents?: number }>;

  /** Capture an authorized payment (if applicable) */
  capturePayment(paymentId: string, amountCents?: number): Promise<PaymentResult>;

  /** Cancel / void a pending payment */
  cancelPayment(paymentId: string): Promise<PaymentResult>;

  /** Process a refund */
  refund(req: RefundRequest): Promise<RefundResult>;

  /** Handle webhook event from provider. Returns processed event. */
  handleWebhook(body: unknown, headers: Record<string, string>): Promise<WebhookEvent | null>;

  /** Get public client config for frontend SDK initialization */
  getClientConfig(): Record<string, string> | null;
}

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

const providers = new Map<ProviderId, PaymentProvider>();

export function registerProvider(p: PaymentProvider): void {
  providers.set(p.id, p);
}

export function getProvider(id: ProviderId): PaymentProvider | undefined {
  return providers.get(id);
}

export function getEnabledProviders(): PaymentProvider[] {
  return Array.from(providers.values()).filter(p => p.isConfigured());
}

export function getProviderForCheckout(): { cardProvider: PaymentProvider | null; paypalProvider: PaymentProvider | null } {
  const enabled = getEnabledProviders();
  // Exclude 'none' (free-gift only) and 'manual' and 'payoneer' from card providers
  const cardProvider = enabled.find(p => !['none', 'manual', 'paypal', 'payoneer'].includes(p.id)) || null;
  // Find PayPal if enabled
  const paypalProvider = enabled.find(p => p.id === 'paypal') || null;
  return { cardProvider, paypalProvider };
}

// ---------------------------------------------------------------------------
// None provider — $0 / free-gift orders
// ---------------------------------------------------------------------------

export const noneProvider: PaymentProvider = {
  id: 'none',
  name: 'No Payment Required',
  isConfigured: () => true,
  testConnection: async () => ({ ok: true, message: 'No payment provider needed for $0 orders.' }),
  createPayment: async () => ({
    ok: true,
    provider: 'none',
    status: 'not_required',
    message: `$0 order — no payment required.`,
  }),
  getPaymentStatus: async () => ({ status: 'not_required' }),
  capturePayment: async () => ({ ok: true, provider: 'none', status: 'not_required' }),
  cancelPayment: async () => ({ ok: true, provider: 'none' }),
  refund: async () => ({ ok: false, provider: 'none' as ProviderId, message: 'Free gift orders cannot be refunded — use cancellation.' }),
  handleWebhook: async () => null,
  getClientConfig: () => null,
};

registerProvider(noneProvider);

// ---------------------------------------------------------------------------
// Zero-total detection
// ---------------------------------------------------------------------------

export function requiresPayment(amountCents: number): boolean {
  return amountCents > 0;
}

export function orderTypeForAmount(amountCents: number, isGift: boolean): string {
  if (isGift || amountCents <= 0) return 'free_gift';
  return 'paid';
}

export function paymentProviderForAmount(amountCents: number, isGift: boolean): ProviderId {
  if (isGift || amountCents <= 0) return 'none';
  return 'stripe'; // default; overridden by admin config
}

// ---------------------------------------------------------------------------
// Admin payment settings storage
// ---------------------------------------------------------------------------



export interface PaymentProvidersConfig {
  primary: ProviderId;
  backup: ProviderId;
  providers: Record<ProviderId, {
    enabled: boolean;
    role: ProviderRole;
    mode: 'sandbox' | 'production';
    /** Keys stored server-side only via app_settings or env */
    keys?: Record<string, string>;
    lastTestAt?: string;
    lastTestOk?: boolean;
    lastWebhookAt?: string;
    lastPaymentAt?: string;
    lastError?: string;
  }>;
}

export function defaultPaymentConfig(): PaymentProvidersConfig {
  return {
    primary: 'none',
    backup: 'none',
    providers: {
      none: { enabled: true, role: 'available', mode: 'production' },
      stripe: { enabled: false, role: 'backup', mode: 'sandbox' },
      square: { enabled: false, role: 'available', mode: 'sandbox' },
      paypal: { enabled: false, role: 'available', mode: 'sandbox' },
      braintree: { enabled: false, role: 'available', mode: 'sandbox' },
      payoneer: { enabled: false, role: 'available', mode: 'sandbox' },
      authorize_net: { enabled: false, role: 'available', mode: 'sandbox' },
      manual: { enabled: false, role: 'available', mode: 'production' },
    },
  };
}

// ---------------------------------------------------------------------------
// Env-based provider detection (server secrets)
// ---------------------------------------------------------------------------

export function detectProviderFromEnv(): Record<ProviderId, Partial<ProviderConfig>> {
  const configs: Record<ProviderId, Partial<ProviderConfig>> = { none: {}, manual: {} } as Record<ProviderId, Partial<ProviderConfig>>;

  // Stripe — already integrated
  if (process.env.STRIPE_SECRET_KEY) {
    const isLive = process.env.STRIPE_SECRET_KEY.startsWith('sk_live');
    configs.stripe = {
      status: isLive ? 'ready' : 'sandbox',
      mode: isLive ? 'production' : 'sandbox',
    };
  }

  // Square
  if (process.env.SQUARE_ACCESS_TOKEN) {
    const isProd = process.env.SQUARE_ENVIRONMENT === 'production';
    configs.square = {
      status: isProd ? 'ready' : 'sandbox',
      mode: isProd ? 'production' : 'sandbox',
    };
  }

  // PayPal
  if (process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET) {
    const isProd = process.env.PAYPAL_ENVIRONMENT === 'production';
    configs.paypal = {
      status: isProd ? 'ready' : 'sandbox',
      mode: isProd ? 'production' : 'sandbox',
    };
  }

  // Braintree
  if (process.env.BRAINTREE_MERCHANT_ID && process.env.BRAINTREE_PRIVATE_KEY) {
    const isProd = process.env.BRAINTREE_ENVIRONMENT === 'production';
    configs.braintree = {
      status: isProd ? 'ready' : 'sandbox',
      mode: isProd ? 'production' : 'sandbox',
    };
  }

  // Payoneer
  if (process.env.PAYONEER_CLIENT_ID && process.env.PAYONEER_CLIENT_SECRET) {
    configs.payoneer = {
      status: 'sandbox',
      mode: 'sandbox',
    };
  }

  // Authorize.Net
  if (process.env.AUTHORIZENET_LOGIN_ID && process.env.AUTHORIZENET_TRANSACTION_KEY) {
    const isProd = process.env.AUTHORIZENET_ENVIRONMENT === 'production';
    configs.authorize_net = {
      status: isProd ? 'ready' : 'sandbox',
      mode: isProd ? 'production' : 'sandbox',
    };
  }

  return configs;
}
