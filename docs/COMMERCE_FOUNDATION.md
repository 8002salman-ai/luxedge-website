# LuxEdge commerce foundation

Status: planning baseline only. No production commerce or payment behavior is enabled by this document.

## Fixed decisions

- Keep the LuxEdge name, `luxedge.us` domain, visual identity, and reusable storefront/admin concepts.
- Treat the current Vite application as a UI prototype, not as the production commerce backend.
- Do not connect Stripe to the current simulated checkout.
- Migrate the commerce core toward Next.js App Router, Supabase, and Stripe server APIs/webhooks.
- Use `8002salman-ai/himalayan-koh` only as a reference for payment, order, and server-validation patterns. Do not copy its storefront, product model, secrets, or brand-specific behavior.
- Product and supplier approval remains a gate before production catalog import or fulfillment integration.

## Current-state inventory

| Area | Current implementation | Disposition |
| --- | --- | --- |
| Runtime | Vite + React Router static SPA | Replace with Next.js in a controlled migration |
| Storefront UI | LuxEdge pages/components and styling | Preserve selectively |
| Admin UI | Dashboard, product, order, user, review, category, settings concepts | Preserve concepts; reconnect to server-authorized data |
| Products | Hard-coded/demo data and browser state | Replace with approved Supabase catalog |
| Cart | Zustand/browser persistence | Replace commerce authority; UI state may remain a client concern |
| Checkout | Simulated card/PayPal flow and browser-created order | Disable as a production path; replace only after server foundation exists |
| Orders | Demo records persisted in the browser | Replace with server-created Supabase orders |
| Authentication | Browser-stored users/passwords and demo admin credentials | Remove from production architecture; replace with Supabase Auth and server role checks |
| Settings/secrets | API keys stored in browser state; some direct provider calls | Remove secret handling from the browser; use server-only environment variables |
| Deployment | Static Vite output through Vercel | Change only with the Next.js migration gate |

## Target checkout boundary

1. Browser sends product identifiers, quantities, delivery address, and a guest/authenticated checkout credential.
2. A Next.js server route verifies identity or a signed guest session.
3. Server reloads active products and prices from Supabase, validates inventory and quantity limits, calculates discount, shipping, tax, and total, then creates a pending order and immutable line-item snapshots.
4. Server creates or reuses one Stripe PaymentIntent for that order using an idempotency key. Amount comes only from the persisted server-calculated total.
5. Stripe Elements confirms payment in the browser. Raw card data never passes through LuxEdge code or storage.
6. A signed Stripe webhook is the primary payment-state authority. It validates the stored PaymentIntent, order, currency, and amount before an idempotent transition to paid/processing.
7. A server verification endpoint supports customer return UX, but never replaces the webhook as final authority.

## Guest checkout requirements

- Guest checkout is supported without creating an account.
- Use a cryptographically random, server-bound guest checkout token in a secure cookie or equivalent signed mechanism.
- Never accept a browser-supplied `userId` as identity.
- Guest order reads require a signed order-access token, one-time link, or a deliberately scoped order-number/email flow with rate limiting.
- Supabase anonymous RLS must not allow enumeration of guest orders or order items.
- Service-role credentials and Stripe secrets stay in server-only environment variables.

## Migration gates

### Gate 0 — preserve and freeze

- Keep the current production branch untouched.
- Record reusable UI/admin areas and demo-only areas.
- Do not import products or enable payments.

### Gate 1 — approved catalog model

- Approve product/supplier data requirements.
- Define products, variants, inventory, supplier mappings, price history, and publish status.
- Add Supabase schema and RLS with migrations and tests.

### Gate 2 — identity and server boundary

- Add Supabase Auth for customers and role-based admin authorization.
- Add signed guest cart/checkout sessions.
- Move privileged integrations and secrets behind server routes.

### Gate 3 — authoritative orders

- Reprice products, shipping, discounts, and tax server-side.
- Create pending orders and line-item snapshots transactionally.
- Add ownership, idempotency, inventory, and replay controls.

### Gate 4 — Stripe test mode

- Add PaymentIntent creation, Stripe Elements, signed webhook handling, and return verification.
- Use test keys only and prove success, failure, retry, redirect, duplicate event, and amount-mismatch cases.
- Do not enable live mode until deployment and security review pass.

### Gate 5 — controlled cutover

- Migrate preserved LuxEdge UI/admin concepts to the new data boundary.
- Remove demo credentials, sample orders/reviews/products, simulated payment controls, and browser secret storage.
- Run end-to-end checkout, RLS, webhook, reconciliation, and rollback checks before production release.

## Explicitly out of scope for this preparation branch

- Live Stripe configuration or charges
- Production database changes
- Storefront redesign
- Broad Next.js rewrite
- Product import or supplier automation
- Copying Himalayan Koh branding or business-specific rules
