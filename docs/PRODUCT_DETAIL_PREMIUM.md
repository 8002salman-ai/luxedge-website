# Product detail premium pass — 7 September 2026

Scope: existing reusable product detail page. No DB, checkout, payment, ad configuration, route or SEO architecture changes.

## Design

Marketplace-inspired gallery-first layout, not an Amazon/eBay clone. Large contained product photograph, vertical thumbnail rail on desktop and horizontal thumbnails on mobile. Native full-size photo dialog with keyboard focus management, Escape dismissal, and arrow navigation. Existing product photos only; duplicates and failed sources are excluded without fabricated replacements. Variant image selection retains the original image mapping. Swipe and previous/next navigation support multi-image products.

Clear white purchase panel, stronger price hierarchy, full-width shopping actions, keyboard focus and labeled quantity controls. Existing seller, delivery, stock, options, review and related-product data retained. Existing AdSense and Adsterra components remain below product information, unchanged. Removed unsupported 'limited time' wording; blank descriptions fall back to the existing short description.

Reference: [eBay picture guidance](https://www.ebay.com/help/ebay/blows/chunks?id=4148) supports clear, multiple high-quality listing photos. No marketplace conversion gains are claimed. Brainstorming and React-review workflows guided scope and component isolation.

## Verification

- Linked dog-shoes product loaded and inspected before and after.
- Built preview at 360, 390, 430, 768, 1024, 1366, 1440: one H1, no horizontal overflow, main photo loaded.
- Full-size dialog opened and closed; initial focus was on its close button.
- Quantity 2 added correctly to local test cart, then removed. No order or payment submitted.
- Secondary dog apparel and horse grooming products inspected.
- TypeScript and build pass. Full initial suite: 1,097 passed, 8 skipped. Final gallery suite: 5 passed, including added duplicate-variant regression.
- No new dependencies. Existing large-bundle warnings remain. No configured lint task.

## Catalog issues discovered (not fabricated or silently overwritten)

- `pet-shoes-wear-dog-shoes`: one usable photo; alternate source failed. One thumbnail is therefore correct until additional real product photos are supplied.
- `horse-grooming-kit-12-piece`: existing main photograph depicts people, not the listed grooming kit. Needs a verified catalog-image replacement.
- Product loading briefly displays the existing not-found state before asynchronous catalog arrival. This pre-existing behavior was observed, not redesigned in this gallery/purchase-panel change.
- Multi-image controls are covered by rendering/configuration tests; sampled real products had only one usable unique photo, so multi-image switching was not exercised against a real multi-photo listing.

Screenshots and deployment verification are stored separately in the task QA folder.
