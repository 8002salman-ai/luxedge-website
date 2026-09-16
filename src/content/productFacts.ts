/**
 * Product facts — the owner-editable catalog fields, formatted once for both
 * render paths.
 *
 * `long_description`, `features`, `specifications` and `weight_oz` are
 * admin-editable columns on `products`, but until now neither the worker
 * pre-render nor the React product page read any of them: a product page could
 * not grow a single word when the owner filled them in. They are also the only
 * honest way the remaining thin product pages can deepen — no dimension,
 * material or care detail may be invented, so it has to come from the catalog.
 *
 * Rules (all pinned by src/content/__tests__/product-facts.test.ts):
 *
 *  - EMPTY IS EMPTY. A field that is missing, null, blank, `[]`, `{}` or the
 *    string "[]" (an admin form writes JSON into a jsonb column as text, so
 *    both shapes occur in the live catalog) contributes NOTHING: no section, no
 *    placeholder row, no default value. A product with no owner data gains no
 *    markup at all.
 *  - NOTHING IS GUESSED. Values render as the admin typed them: numbers as
 *    numbers, `true`/`false` as Yes/No, arrays of scalars joined with commas.
 *    A nested object is skipped rather than flattened into something it does
 *    not say, and a JSON blob we cannot parse is never printed raw.
 *  - NO DUPLICATE TEXT. In the live catalog `long_description` is byte-identical
 *    to `description` for every product that has it, so it is published only
 *    when it differs from the description the page already shows.
 *  - WEIGHT IS CONVERTED, NOT ROUNDED. `weight_oz` prints in ounces; a pound
 *    figure is appended only when the conversion is exact (16 oz steps), so no
 *    derived number is ever shown that the stored value does not state.
 */

/**
 * The storefront's free-shipping claim, worded once for both render paths.
 *
 * The checkout grants free shipping only when EVERY line in the cart carries
 * the flag (`quoteShipping` → `cart.every(…)`), and /shipping-policy states
 * that cost and eligibility are confirmed in the cart and again at checkout.
 * A flat "Free shipping" on the product page therefore promised more than the
 * store delivers — and on supplier-imported rows, where `shipping_cost` is 0
 * and `free_shipping` defaults to true, it was a feed artifact rather than a
 * decision anyone made. This wording is true of the flag itself and consistent
 * with the published policy.
 */
export const FREE_SHIPPING_CLAIM = 'Qualifies for free shipping';

export interface ProductFactRow {
  label: string;
  value: string;
}

export interface ProductFacts {
  /** Owner bullet points, in the order they were entered, de-duplicated. */
  features: string[];
  /** Owner label/value rows, plus Weight when `weight_oz` is set. */
  specifications: ProductFactRow[];
  /** Long description, or null when it is empty or repeats `description`. */
  longDescription: string | null;
}

export interface ProductFactInput {
  features?: unknown;
  specifications?: unknown;
  longDescription?: unknown;
  weightOz?: unknown;
  /** The description the page already shows — used only to avoid printing it twice. */
  description?: unknown;
}

const UNIT_SUFFIX = /^(.*?)[-_](cm|mm|in|ft|kg|g|lbs?|oz|ml|l|w|v|pcs|pack|count|qty)$/i;

const text = (v: unknown): string =>
  typeof v === 'string' ? v.trim() : v == null ? '' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';

/** A jsonb column can hold a real array/object, or JSON text the admin form wrote. */
function asJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  if (!t || (t[0] !== '[' && t[0] !== '{')) return value;
  try {
    return JSON.parse(t);
  } catch {
    return value;
  }
}

/** `handles_material` → `Handles (material)`, `capacity` → `Capacity`. */
export function specLabel(key: string): string {
  const k = String(key || '').trim();
  if (!k) return '';
  const m = k.match(UNIT_SUFFIX);
  const base = (m ? m[1] : k).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!base) return '';
  const label = base.charAt(0).toUpperCase() + base.slice(1);
  return m ? `${label} (${m[2].toLowerCase()})` : label;
}

/** One row value, or '' when the value cannot be shown without guessing. */
export function specValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    const scalars = value.filter((v) => v == null || typeof v !== 'object');
    if (scalars.length !== value.length) return ''; // mixed/objects: no honest single cell
    return scalars.map((v) => specValue(v)).filter(Boolean).join(', ');
  }
  return ''; // nested object: never flattened
}

function readFeatures(value: unknown): string[] {
  const parsed = asJson(value);
  const list = Array.isArray(parsed) ? parsed : text(parsed) ? [text(parsed)] : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (item != null && typeof item === 'object') continue; // no shape we can render honestly
    const line = text(item);
    if (!line) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

function readSpecifications(value: unknown): ProductFactRow[] {
  const parsed = asJson(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const rows: ProductFactRow[] = [];
  const seen = new Set<string>();
  for (const [key, raw] of Object.entries(parsed as Record<string, unknown>)) {
    const label = specLabel(key);
    const val = specValue(raw);
    if (!label || !val) continue;
    const dedupe = label.toLowerCase();
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    rows.push({ label, value: val });
  }
  return rows;
}

/** `weight_oz` → a Weight row, or null when there is no usable weight. */
export function weightFactRow(weightOz: unknown): ProductFactRow | null {
  const oz = typeof weightOz === 'number' ? weightOz : Number(text(weightOz));
  if (!Number.isFinite(oz) || oz <= 0) return null;
  const ozLabel = Number.isInteger(oz) ? String(oz) : String(oz);
  const exactPounds = oz >= 16 && oz % 16 === 0;
  return { label: 'Weight', value: exactPounds ? `${ozLabel} oz (${oz / 16} lb)` : `${ozLabel} oz` };
}

const normalise = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

export function productFacts(input: ProductFactInput): ProductFacts {
  const features = readFeatures(input.features);
  // One list, de-duplicated across the weight row and the owner's own keys: a
  // spec key literally named "weight" must not print a second Weight row.
  const specifications: ProductFactRow[] = [];
  const seenRows = new Set<string>();
  const weight = weightFactRow(input.weightOz);
  if (weight) {
    specifications.push(weight);
    seenRows.add(weight.label.toLowerCase());
  }
  for (const rowSpec of readSpecifications(input.specifications)) {
    const key = rowSpec.label.toLowerCase();
    if (seenRows.has(key)) continue;
    seenRows.add(key);
    specifications.push(rowSpec);
  }

  const long = typeof input.longDescription === 'string' ? input.longDescription.trim() : text(input.longDescription);
  const shown = text(input.description);
  const longDescription = long && normalise(long) !== normalise(shown) ? long : null;

  return { features, specifications, longDescription };
}

/** True when there is something to render at all. */
export function hasProductFacts(facts: ProductFacts): boolean {
  return facts.features.length > 0 || facts.specifications.length > 0 || facts.longDescription !== null;
}
