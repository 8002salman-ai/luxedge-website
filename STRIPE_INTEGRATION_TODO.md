# Stripe Integration TODO — Luxedge.us

Scenario A: an existing Checkout Session creation was found and updated. This file is the
single source of truth for everything remaining before (and after) going live.

## Values to Replace

**None — no placeholder values remain in code.** Luxedge uses Scenario A (the Checkout
Session call already existed), so real values were preserved, never replaced with samples:

| Field | Current Value | What to Set |
|-------|--------------|-------------|
| mode | `payment` (one-time purchases only) | Keep. Never "subscription" unless the owner explicitly changes the product model. |
| success_url | `{appBaseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}` (real site URL, server-built) | Keep. |
| cancel_url | `{appBaseUrl}/checkout` (real site URL, server-built) | Keep. |
| line_items | Catalog prices, quantities and images computed **server-side** from the database per cart | Keep. Prices are never accepted from the browser. |

## Configured Parameters

Applied inside the existing call in [api/_lib/stripe.ts](api/_lib/stripe.ts) (`createCheckoutSession`),
in REST wire format:

| Parameter | Value |
|-----------|-------|
| ui_mode | `hosted` (the REST wire value; the SDK ≥21 enum is `hosted_page` — Luxedge does not use the Stripe SDK, so no version dependency) |
| mode | `payment` (one-time) |
| billing_address_collection | `auto` |
| phone_number_collection | `{ enabled: true }` |
| allow_promotion_codes | `true` |
| submit_type | `auto` |
| payment_intent_data.setup_future_usage | `on_session` |
| shipping_address_collection | `US` (kept from existing config — required for the shipping rate) |
| payment_method_types | `card` (kept from existing config) |

### Deliberate deviations from the Checkout Studio intents (owner constraints)

| Studio intent | Status | Why |
|---------------|--------|-----|
| automatic_tax `{enabled: true}` | **NOT enabled** | Stripe Tax is a paid per-transaction add-on (≈50¢/transaction). The owner explicitly requires **no paid add-ons** and removed it in PR #68. To enable later (owner approval only): add `parts.set('automatic_tax[enabled]', 'true')` in `createCheckoutSession` + `parts.set('line_items[i][price_data][tax_behavior]', 'exclusive')`, and complete Stripe Tax setup (head office, registration) in the Dashboard — the account's tax settings are currently `pending`. |
| payment_method_collection `always` | **Omitted** | Per the integration rule: only valid/meaningful for `mode: "subscription"`. Luxedge is `payment` mode. |
| integration_identifier `hosted_web_0001` | **Omitted** | Not a Checkout Session REST parameter (Studio bookkeeping) — the API rejects unknown params. |
| origin_context `web` | **Omitted** | Same — not a Checkout Session REST parameter. |

## Environment Variables

Server-only (Cloudflare Worker secrets — set via `wrangler secret put`, or attached in
**Admin → Payments** into `app_settings`; no redeploy needed):

| Variable | Where | Notes |
|----------|-------|-------|
| `STRIPE_SECRET_KEY` | Cloudflare secret **or** Admin → Payments | Currently the **live** key. For test mode, set the `sk_test_…` key instead. |
| `STRIPE_WEBHOOK_SECRET` | Cloudflare secret **or** Admin → Payments | Live webhook endpoint `we_1UCJFu4…` exists; test mode needs its own test webhook + `whsec_test_…`. |

No `VITE_`-prefixed Stripe variables are needed: checkout is Stripe-**hosted** (no client SDK),
so the publishable key is never sent to the browser. Never add `VITE_STRIPE_SECRET_KEY`.

## How It Works (flow)

1. Customer checks out → client probes `/api/checkout?probe=1` (server is the authority on whether payment is configured).
2. Client POSTs the cart to `/api/checkout` → server re-reads products + prices from the DB, validates the coupon, computes totals, reserves inventory.
3. Server calls Stripe Checkout Session `create` with `mode=payment`, `ui_mode=hosted` (full-page hosted checkout on Stripe's domain — no custom domain, no $10/mo fee), server-set line items + shipping.
4. Customer pays on `checkout.stripe.com` → returns to `/checkout/success?session_id=…`.
5. Stripe sends `checkout.session.completed` to `/api/webhook` → signature verified → idempotent order record + stock release/fulfillment.

## Setup & Next Steps

- **Test mode first (owner action — currently blocked on this):** paste the **test secret key** (`sk_test_…`) from Stripe Dashboard → Developers → API keys. The agent will swap the secret, create a test webhook endpoint + secret, and verify the full flow with test card **4242 4242 4242 4242** (any future expiry, any CVC). No real charge happens in test mode.
- **Go live (owner action):** Stripe Dashboard → activate the account for live charges (bank/payout details). Account `acct_1TKzt74EhtoRoQHH` (Embani LLC) is `charges_enabled: false` today; requirements show nothing currently due, so this is the Dashboard activation/review step. Then swap back to the live `sk_live_…` key.
- **Webhook:** endpoint already exists (`https://luxedge.us/api/webhook`, `checkout.session.completed`). Add `charge.refunded` later if refunds should update order status.
- **Fulfillment/orders:** paid orders land in the existing orders table (idempotent by `checkout_session_id`); Admin → Orders is the surface.
- **Resources:** https://docs.stripe.com/checkout · https://docs.stripe.com/webhooks · https://support.stripe.com