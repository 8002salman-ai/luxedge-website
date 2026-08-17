# LUXEDGE STATE — Agent Handoff

Updated after the Phase 2 storefront work (Claude). Phase 1 review fixes remain intact; nothing from the security work was undone.

## Current state

- **Current branch:** `luxedge-v2` (development). `main` = production (`luxedge.us`), untouched, NOT deployed from this branch.
- **Latest commit (start of Phase 2):** `2345723` (Claude Phase-1 review fixes)
- **Latest commit (end of Phase 2):** see `git log` — Phase 2 storefront work
- **Current phase:** Phase 2 complete (PASS). Phase 3 not started.
- **Stack:** Vite 7 · React 19 · TypeScript 5.9 · Tailwind 4 · React Router 7 (hash) · Zustand 5 · Vercel (static dist + serverless `/api/*`).

## Phase 1 summary (preserved — do not undo)

- AI provider keys are server-side only (`/api/ai/*`, `/api/fetch-page`), never in the browser bundle or localStorage.
- SSRF guard, fetch timeouts, model allowlist, per-instance rate limits, legacy-secret scrub (`scrubLegacySecrets()` at startup in `main.tsx`).
- Supabase migration `0001_initial_schema.sql` (30 tables, claim-based admin RLS) — reviewed + fixed, NOT applied anywhere yet.
- `src/services/db.ts` adapter boundary (LocalStorage active; Supabase activates when env vars set).
- 34 vitest tests covering security boundary + storage adapter.

## What Phase 2 changed (Claude storefront V2)

### Truthfulness (removed fabricated claims)
- Product cards: removed invented "N sold" counts (`reviews * 0.87`) and the fake wishlist button (toast only, nothing persisted).
- PDP: removed "N sold" display; rating shown only from verified user reviews, falling back to the catalog rating — never a derived stat.
- Homepage hero: removed "4.9/5 · 2,000+ happy pet parents" (invented stat) → replaced with factual trust row (free shipping, 30-day returns, real customer support).
- Trust bar: "Secure Checkout · 256-bit SSL encryption" → "Quality Checked · handpicked & tested by our team".
- Footer: removed "We accept: VISA/MC/AMEX/PayPal/Apple Pay" → honest "Online payments are in demo mode — a real provider is being integrated."
- Cart + checkout summaries: removed payment-method brand chips; checkout keeps the Phase-1 demo notice + added a summary note.
- **Deactivated 12 non-pet demo products** (ids 13–24: toothbrush, dumbbell, LED strip, neck fan, eye massager, yoga mat, etc. — categories Wellness/Tech & Gadgets/Home & Living/Accessories) whose descriptions contained fabricated claims ("top seller on AliExpress/Amazon", "viral TikTok bestseller"). Set `isActive: false` so the storefront is pet-only; data retained for admin.
- Newsletter: no longer a fake toast — saves the email to localStorage (`luxedge_newsletter`) and shows an honest success state.

### UX / conversion
- PDP: sticky mobile Add to Cart bar (IntersectionObserver on the inline CTA, `inert` when hidden, safe-area padding, hidden on desktop).
- Shop: fixed the sticky Filter/search/sort toolbar being hidden behind the header (now `top-16 lg:top-[7.1rem]`); Deals nav now works (`/shop?q=deal` filters to compare-at products, page title "Deals"); promo banner "Pet Favorites Under $30" now links to `/shop?max=30` (real price filter).
- Product card: kept blue premium style; sale badge guarded (`originalPrice > price`), image alt real (removed `aria-hidden`), rating labeled for screen readers.

### SEO / a11y
- RouteTitle: per-route meta description + og:description + og:url + canonical (`https://luxedge.us/#<path>`).
- PDP: Product + BreadcrumbList JSON-LD injected per product (canonical, meta description, og/twitter image); aggregateRating emitted ONLY when verified user reviews exist.
- Toast: `role="status"` + `aria-live="polite"`. Sticky bar `inert` when hidden. Focus-visible ring preserved. `text-balance` on headings, safe-area helper added to CSS.

### Files touched (Phase 2)
`src/App.tsx` (PCard, PDP, HomePage, ShopPage, CartPage, CheckoutPage, Footer, Header, RouteTitle, Toast), `src/index.css` (2 utilities). No new dependencies. No new component files.

## Post-Phase-2 truthfulness fixes (pre-Phase-3)

- **Ratings are verified-only.** Catalog rating/reviewCount fields are stub data and are no longer displayed as customer ratings. Stars/ratings appear only when approved user review records exist (currently 2 products). PCard, PDP rating row, PDP reviews-tab header and the shop rating filter all use verified-review averages. Product JSON-LD aggregateRating was already verified-only and remains so.
- **Trust claims de-claimed.** "Quality Checked · Handpicked & tested by our team" (homepage trust bar, footer chip, hero floating chip, PDP trust grid) → "Thoughtfully Curated · Selected for pet owners" (no documented physical-testing process). About page "We test, compare, and reject..." → "We carefully compare and curate...".
- **About page fabricated stats removed** ("2,000+ Happy Customers", "99% Satisfaction Rate", "24/7 Customer Support") → real policy facts (Free Shipping 0+, 30-Day Returns, 1-3 days processing, Mon–Fri support).
- **FAQ honesty:** "256-bit SSL / PCI-DSS compliant processors" payment claim → demo-mode statement consistent with the checkout notice; "Every item is quality-checked" → "carefully selected and reviewed".
- **Verified policies:** Free shipping 0+ matches the Shipping Policy page and checkout logic (.99 under 0, free at 0+). 30-day returns matches the Returns & Replacement Policy (30-day window) and checkout/FAQ copy.

## Known issues (documented)

## Known issues (documented)

- Storefront commerce data is still hard-coded demo data (`INIT_PRODUCTS`/`EXTRA_PRODUCTS`) with ratings/review-count fields that are catalog stubs, not real reviews. Phase 3 (real data layer) must replace with verified data.
- Checkout payment is demo mode (no processor) — explicit notice shown. Real Stripe/PayPal later phase.
- `/api/ai/*` + `/api/fetch-page` still unauthenticated (defense-in-depth only: rate limits, caps, SSRF guard). Real auth is a Phase 3 requirement before autonomous agents.
- Admin auth is demo (client-side password).
- `vercel.json` deploys `/api/*` alongside static build — verify on first Vercel deploy of this branch.
- Deactivated products 13–24 still exist in admin (isActive false) — safe to delete or repurpose later.

## Security status

Unchanged from Phase 1: no secrets in bundle/localStorage, server-only keys, SSRF guard active, RLS claim-based. Bundle scan after Phase 2: no `sk-*` values; only the literal `luxedge_api_keys` cleanup string.

## Database status

Unchanged: migration ready but unapplied; adapter boundary LocalStorage-active.

## Build / test status

- `npm install` ✅ · `npx tsc --noEmit` ✅ 0 errors · `npm test` ✅ 34/34 · `npm run build` ✅
- Bundle: storefront `index-*.js` ~402.5 KB (gzip ~114.9 KB; was ~397.9 KB pre-Phase-2 — +4.7 KB for sticky CTA + SEO), admin lazy chunk ~242 KB (unchanged), react/icons split chunks preserved.
- Routes tested (dev, desktop + mobile/tablet widths): `/`, `#/shop`, `#/shop?q=deal`, `#/shop?max=30`, `#/category/dog-supplies`, `#/product/1`, `#/cart`, `#/checkout` (demo flow), `#/blog`, `#/about`, `#/contact`, `#/privacy`, `#/admin/login` — all render, zero console errors.
- Verified flows: newsletter persistence, sticky mobile Add to Cart, cart drawer + free-shipping progress, demo-payment notice, JSON-LD injection.

## Credentials genuinely required (later)

1. Supabase project → `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; apply migration.
2. AI provider keys (server env): `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`.
3. Scraping: `SCRAPE_DO_TOKEN` (optional).
4. Payments (Phase 3+): Stripe/PayPal server keys.

## Exact recommended next task

**Phase 3 — Admin Command Center + real auth/data connection on `luxedge-v2`:** real authentication boundary for `/api/*` and admin (Supabase Auth + service-role or gateway), provision Supabase + apply migration + integration-test `src/services/db.ts`, replace hard-coded catalog with DB-backed data, and upgrade the admin UI into the Command Center (products, candidates, suppliers, orders, AI agents, jobs, logs, campaigns with hard spend limits). Do NOT deploy to production from this branch; `main` stays live.
