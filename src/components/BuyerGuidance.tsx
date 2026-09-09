import type { JSX } from 'react';
import { Link } from 'react-router-dom';

/** Small, evidence-neutral shopping guidance shared by collection surfaces. */
export function BuyerGuidance({ title = 'A simple way to compare', note, categoryHref = '/shop' }: { title?: string; note: string; categoryHref?: string }): JSX.Element {
  return (
    <aside className="rounded-xl border border-luxe-silver bg-white px-5 py-4 text-sm text-luxe-gray" aria-label="Buyer guidance">
      <h2 className="font-serif text-lg font-bold text-luxe-black">{title}</h2>
      <p className="mt-1 leading-relaxed">{note}</p>
      <p className="mt-2 text-xs leading-relaxed">Check the listed dimensions, materials, availability, and delivery details before choosing.</p>
      <Link to={categoryHref} className="mt-3 inline-block text-xs font-bold text-luxe-gold-dark hover:text-luxe-gold">Browse the collection →</Link>
    </aside>
  );
}
