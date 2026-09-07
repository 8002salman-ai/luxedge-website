# Category hero polish — 6 September 2026

## Scope and baseline

Built on main 77524e8 / PR #114's existing CategoryHero, in an isolated worktree. No replacement site, dependency additions, database changes, ad changes or unrelated application changes.

The existing mobile header hid photography. Its tablet layout could stack the desktop-sized image awkwardly; five general collections used a bare fallback. Category links and CTA needed stronger grouping. Existing serif typography, blue accents, routes, product grid, filters, ads and metadata were retained.

## Research and direction

References: [Wild One collections](https://wildone.com/collections/all), [Dribbble pet ecommerce examples](https://dribbble.com/tags/pet-ecommerce-website), [Behance pet shop case study](https://www.behance.net/gallery/195803591/E-commerce-Pet-Shop-UIUX). Figma Community search did not yield an accessible source file; no claim of inspecting one.

Compared clean commercial (compact but generic), premium editorial (fits existing Fraunces typography and animal lifestyle photography), and conversion-first (would duplicate existing filters). Selected restrained editorial: clear breadcrumb, one headline, one shopping action, separate related-collection links. References informed principles, not copied layouts.

## Implementation

- Existing CategoryHero supports all ten current categories, plus unknown-category fallback.
- Dog, Cat, Horse, Bird, Cattle, Feeding & Water, Pet Accessories, Pet Beds, Pet Toys, Grooming.
- Mobile photograph first; desktop text/image split responds to the component's available width, including the existing ad column.
- Existing lifestyle sources reused. Responsive 360/540/720/1080 CDN variants, automatic format, quality 75; no new multi-megabyte source assets.
- Image dimensions, reserved media area, eager/high-priority loading. No carousel, additional animation or dependencies. Actual field Core Web Vitals require subsequent measurement; no fabricated performance score.
- Wrapped collection links, visible keyboard focus, descriptive alt text, one H1. Breadcrumbs and links remain real navigable anchors. CTA scroll target clears the sticky toolbar.
- Corrected bird crop after visual QA showed its head clipped.

## Local verification

- Full pre-final suite: 75 files passed, 3 skipped; 1,081 tests passed, 8 skipped.
- New component suite: 12 tests passed (all ten configurations, unknown fallback, CDN/custom image handling).
- TypeScript: `tsc --noEmit` passed.
- Build passed; existing large-bundle and mixed-import warnings remain. No lint command/configuration exists in this project, so no lint pass is claimed.
- Responsive geometry checked at 360, 390, 430, 768, 1024, 1366, 1440, 1920: no horizontal overflow, one H1, CTA fits. A first-frame image load check was inconclusive at 360; image loading is checked again after settling.
- Visual inspections: Dog desktop/mobile, Cat mobile, Horse desktop/mobile, Bird/Cattle tablet. All ten configurations inspected in browser DOM.
- Dog CTA reached the product grid below sticky controls; mobile filter panel opened; products loaded (Dog 6, Cat 1, Horse 5 observed). No product data was edited.
- Local console sample had no warnings/errors. Existing global widgets and ad column were intentionally preserved.

## Remaining non-blocking opportunities

Dedicated photography for general collections could replace reused animal lifestyle images later. Sitewide bundle size, advertising composition, and global floating widgets are outside this hero-only change. Conversion improvement is a design objective, not a measured result.

Deployment and production evidence are reported separately after the release.
