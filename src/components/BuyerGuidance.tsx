import { Fragment, type JSX } from 'react';
import { Link } from 'react-router-dom';

/**
 * Small, evidence-neutral shopping guidance shared by collection surfaces.
 *
 * When a collection has shared content (src/content/categoryContent.ts) the
 * component also renders that collection's selection considerations and related
 * guides. This matters for parity, not decoration: the worker pre-renders those
 * same considerations into the crawl HTML, so without them here a visitor would
 * see less guidance on the page than Google does — the same divergence that
 * previously hid the real shipping page behind a 404.
 */
export function BuyerGuidance({
  title = 'A simple way to compare',
  note,
  categoryHref = '/shop',
  topic,
  items,
  guides,
}: {
  title?: string;
  note: string;
  categoryHref?: string;
  /** Lowercase collection name used in the considerations heading. */
  topic?: string;
  /** Shared selection considerations for this collection. */
  items?: string[];
  /** Related guides — only guides that genuinely apply to this collection. */
  guides?: { label: string; href: string }[];
}): JSX.Element {
  const considerations = items?.length ? items : [];
  const related = guides?.length ? guides : [];
  return (
    <aside className="rounded-xl border border-luxe-silver bg-white px-5 py-4 text-sm text-luxe-gray" aria-label="Buyer guidance">
      <h2 className="font-serif text-lg font-bold text-luxe-black">{title}</h2>
      <p className="mt-1 leading-relaxed">{note}</p>
      {considerations.length > 0 && (
        <>
          <h3 className="mt-4 font-serif text-base font-bold text-luxe-black">What to look for in {topic || title.replace(/^Choosing /i, '')}</h3>
          <ul className="mt-2 space-y-2 list-disc pl-5 text-xs sm:text-sm leading-relaxed">
            {considerations.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </>
      )}
      <p className="mt-2 text-xs leading-relaxed">Check the listed dimensions, materials, availability, and delivery details before choosing.</p>
      {related.length > 0 && (
        <p className="mt-2 text-xs leading-relaxed">
          Related guides:{' '}
          {related.map((g, i) => (
            <Fragment key={g.href}>
              {i > 0 && ' · '}
              <Link to={g.href} className="font-semibold text-luxe-gold-dark underline decoration-luxe-gold/40 underline-offset-2 hover:text-luxe-gold">{g.label}</Link>
            </Fragment>
          ))}
        </p>
      )}
      <Link to={categoryHref} className="mt-3 inline-block text-xs font-bold text-luxe-gold-dark hover:text-luxe-gold">Browse the collection →</Link>
    </aside>
  );
}
