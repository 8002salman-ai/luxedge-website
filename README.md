# LuxEdge Commerce

LuxEdge is migrating from its preserved Vite demo into a production-oriented Next.js, Supabase, Stripe and Shippo commerce application. The storefront visual language remains LuxEdge; the legacy prototype is retained under `legacy-vite/` for reference.

## Local setup

1. Copy `.env.example` to `.env.local` and add Supabase project values.
2. Link the Supabase CLI project and apply migrations with `supabase db push`.
3. Set one-time `ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD` values locally.
4. Run `npm run admin:bootstrap`, then immediately remove the password from `.env.local`.
5. Run `npm run dev` and sign in at `/login`.

The bootstrap command stores the password in Supabase Auth, not the repository. Admin authorization is assigned through protected `app_metadata`; public signup always creates a customer.

## Integration policy

- Stripe, Shippo, Supabase service, Resend, OpenRouter and HubSpot secrets are server environment variables only.
- `/admin/api-keys` shows masked configuration status but never reads secret values back to the browser.
- PaymentIntent amounts come from stored orders, not browser totals.
- Stripe settlement is webhook-driven with signature verification and replay protection.
- Guest order ownership uses a signed cookie whose token is stored only as a hash.
- Shippo calls use the server token and server-owned ship-from address.

## Verification

```bash
npm run typecheck
npm run build
npm audit --audit-level=high
```

Payments and shipping fail closed with HTTP 503 until their server keys are configured. Do not switch to live keys before test-mode checkout, webhook and label flows pass end-to-end verification.
