import type { JSX } from 'react';
import type { FaqCategory } from '../content/policies';

/**
 * Renders the FAQ list from the shared module (src/content/policies.ts).
 *
 * Two rules this component exists to keep:
 *
 *  1. The data comes in as a prop from that one module — the worker pre-renders
 *     the same array into the crawl HTML. The page used to carry its own
 *     second copy, which drifted until the crawl HTML promised payment
 *     "handled by the configured third-party provider" while checkout reported
 *     payment as unavailable. A duplicate list is now impossible here.
 *  2. Every answer is rendered, not revealed on click, and uses the same h3/p
 *     shape the worker emits. An accordion that mounts answers only on
 *     interaction would put the crawled copy and the rendered DOM back out of
 *     step — the failure this page was fixed for.
 */
export function FaqContent({ faqs }: { faqs: FaqCategory[] }): JSX.Element {
  return (
    <>
      {faqs.map((section) => (
        <div key={section.category}>
          <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <span className="w-1.5 h-4 rounded-full bg-luxe-gold shrink-0" aria-hidden="true" />
            {section.category}
          </h2>
          <div className="space-y-2">
            {section.items.map((faq) => (
              <div key={faq.q} className="bg-white rounded-xl border px-5 py-4">
                <h3 className="text-sm font-semibold text-gray-900">{faq.q}</h3>
                <p className="mt-2 text-sm text-gray-600 leading-relaxed">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
