import type { JSX } from 'react';
import { hasProductFacts, type ProductFacts } from '../content/productFacts';

/**
 * The visitor-side half of the owner-editable product detail (features, long
 * description, specifications, weight).
 *
 * The worker pre-renders the same rows from the same formatter
 * (src/content/productFacts.ts) via injectProductBody, so a crawler and a
 * visitor cannot be shown different facts. Both components return null when
 * there is nothing to say: a product whose owner fields are empty gets no
 * section, no placeholder row and no default — the page stays exactly as long
 * as its real data.
 */
export function ProductFactSections({ facts }: { facts: ProductFacts }): JSX.Element | null {
  if (!facts.longDescription && facts.features.length === 0) return null;
  return (
    <>
      {facts.longDescription && (
        <section className="mt-8 border-t border-gray-100 pt-6">
          <h2 className="text-base font-bold text-luxe-black">Full description</h2>
          <p className="mt-2 text-[15px] text-luxe-gray leading-relaxed whitespace-pre-line">{facts.longDescription}</p>
        </section>
      )}
      {facts.features.length > 0 && (
        <section className="mt-8 border-t border-gray-100 pt-6">
          <h2 className="text-base font-bold text-luxe-black">Features</h2>
          <ul className="mt-2 space-y-1.5 list-disc pl-5 text-[15px] text-luxe-gray leading-relaxed">
            {facts.features.map((f) => <li key={f}>{f}</li>)}
          </ul>
        </section>
      )}
    </>
  );
}

/** Rows for the product's Specifications table. Empty fields add no rows.
 *  Rows only: the table element (and its optional screen-reader caption) belongs
 *  to the product page, because a <caption> is only valid as a direct child of
 *  <table> — rendering it here put it inside <tbody> and React reported the
 *  invalid nesting (and a hydration mismatch) in the console. */
export function ProductSpecRows({ facts }: { facts: ProductFacts }): JSX.Element | null {
  if (!hasProductFacts(facts) || facts.specifications.length === 0) return null;
  return (
    <>
      {facts.specifications.map((row) => (
        <tr key={row.label} className="border-t border-gray-100">
          <td className="px-3 py-2.5 font-medium text-gray-600 w-1/3">{row.label}</td>
          <td className="px-3 py-2.5 text-gray-900">{row.value}</td>
        </tr>
      ))}
    </>
  );
}
