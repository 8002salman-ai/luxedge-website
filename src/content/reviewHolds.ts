/** Reversible public-display holds from the September 2026 editorial audit.
 * CMS records remain intact and editable by admins. Remove individual holds
 * only after the underlying content has been corrected and reviewed.
 */
const heldMedia = new Set([
  '05-05-hollow-crystal-sphere', '09-09-spiral-crystal-discs',
  '07-07-amber-honey-crystal', '08-08-purple-core-crystal',
  '04-04-crystal-cube-crunch', '10-10-ultimate-crystal-crunch',
  '06-06-ice-blue-candy-bar', '03-03-brittle-candy-sheet-snap',
  '02-02-rainbow-crystal-jelly', '01-01-crystal-block-clean-cut',
  'how-pomegranate-juice-is-made-in-a-1-million-bottle-factory',
  'reality-peel-apartment-to-desert-oasis',
]);
// Legacy article withheld after the production content audit: it is too thin
// and makes unsupported care claims. The CMS row remains available to admins.
const heldBlog = new Set(['grooming-routine-long-haired-pets']);
export function isHeldMedia(slug: string): boolean { return heldMedia.has(slug); }
export function isHeldBlog(slug: string): boolean { return heldBlog.has(slug); }
const heldProduct = new Set([
  'promo-probe-1788640230930',
  // Withheld until independently verified product facts replace thin or
  // contradictory supplier-derived copy. CMS/admin records stay intact.
  'kong-classic-durable-natural-rubber-dog-toy',
  'adjustable-nylon-horse-halter-lead-rope',
  'horse-grooming-kit-12-piece',
]);
export function isHeldProduct(slug?: string | null): boolean {
  return !!slug && heldProduct.has(slug);
}
