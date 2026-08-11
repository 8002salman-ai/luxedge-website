# Himalayan Koh reference audit

Reference repository: `8002salman-ai/himalayan-koh`

Purpose: identify architecture patterns for LuxEdge. This is not a copy list, and no credentials or environment values are included.

## Reference map

| Concern | Himalayan Koh reference | LuxEdge adaptation |
| --- | --- | --- |
| Pending order creation | `src/app/api/orders/create/route.ts` | Authenticate the request or verify a signed guest session before creating an order |
| Server pricing and snapshots | `src/lib/orders/serverCreateOrder.ts` | Reload LuxEdge products/variants from Supabase; validate inventory; calculate money with integer minor units or a decimal-safe library |
| PaymentIntent creation | `src/app/api/stripe/create-payment-intent/route.ts` | Require order ownership/access token, use the persisted total, store the intent ID, and provide a stable idempotency key |
| Request validation | `src/lib/stripe/server/validation.ts` | Use schema validation and reject unknown/invalid money, quantity, address, and identifier inputs |
| Stripe server client | `src/lib/stripe/server/stripe.ts` | Keep Stripe secret and webhook secret in server-only deployment environment variables; no general admin/browser secret storage |
| Webhook verification | `src/app/api/stripe/webhook/route.ts` | Verify the raw body/signature and validate event livemode, currency, amount, order ID, and stored intent before state changes |
| Idempotent payment update | `src/lib/stripe/server/updateOrderPayment.ts` | Use constrained state transitions and a processed-webhook-events table; keep notification dispatch idempotent |
| Return verification | `src/app/api/stripe/verify-payment/route.ts` | Retrieve the intent server-side and require exact metadata/order/amount/currency match; treat it as UX recovery, not payment authority |
| Guest cart/session concept | `src/lib/supabase/api/cart.ts` | Replace predictable local-storage session IDs with a cryptographically random signed/server-bound guest credential |
| Guest order RLS correction | `supabase/migrations/024_restrict_guest_order_select.sql` | Do not expose blanket anonymous order reads; mediate narrowly scoped guest access on the server |
| Payment Element UI flow | `src/components/checkout/StripePaymentForm.tsx` | Rebuild within LuxEdge visual design after the server APIs and test-mode gates exist |

## Safe sequence to adapt

1. Establish the Supabase schema, RLS, server client, and typed data model.
2. Establish authenticated and signed-guest checkout identity.
3. Implement server-side catalog lookup, price calculation, stock validation, pending order creation, and line-item snapshots.
4. Implement one PaymentIntent per order with idempotency and persisted intent linkage.
5. Implement signed webhook verification and idempotent payment/order state transitions.
6. Add Stripe Elements and return verification in test mode.
7. Test tampered prices, someone else's order ID, expired guest token, duplicate submissions, duplicate/out-of-order webhooks, failed payments, redirects, and amount/currency mismatch.

## Reference weaknesses not to inherit

- `orders/create` may fall back to a body-provided user ID when no bearer token is present. LuxEdge must derive identity only from a verified session/token.
- PaymentIntent creation looks up an order by ID without demonstrating caller ownership. LuxEdge must require ownership or signed guest order access.
- PaymentIntent creation does not show a Stripe idempotency key or persisted one-intent-per-order constraint.
- The webhook uses metadata order ID but does not itself compare the event amount/currency and stored PaymentIntent ID to the order before marking it paid.
- The early guest cart session generator uses `Math.random()` plus time and stores it in local storage; this is not a strong authorization credential.
- Guest order lookup by UUID alone still exposes data to anyone who obtains that UUID. LuxEdge should use a signed order-access token or another explicit proof.
- General settings-backed secret resolution expands the secret-access surface. LuxEdge should keep payment and service-role secrets in server-only managed environment variables.
- Money calculations use JavaScript numbers. LuxEdge should store integer cents or use decimal-safe arithmetic and defined rounding rules.

## Secrets rule

Only public identifiers may reach client code. Stripe secret keys, webhook secrets, Supabase service-role credentials, and private integration credentials must never be committed, printed in logs, returned by APIs, or stored in browser persistence.
