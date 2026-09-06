// ============================================================================
// LUXEDGE — shared /about copy (single source of truth)
//
// Used by BOTH the client AboutPage (src/App.tsx) and the worker pre-render
// (worker/seo-meta.ts) so the initial server HTML and the hydrated page can
// never drift. Every statement here is drawn from the live catalog or the
// published Luxedge policies — nothing invented.
// ============================================================================

export const ABOUT_QUOTE = 'A curated online store for practical pet and animal essentials.';

export const ABOUT_LEAD =
  'Luxedge is an online store for thoughtfully selected pet and animal essentials — dog walking ' +
  'and training gear, cat toys and comfort pieces, bird feeders and seed, horse grooming and stable ' +
  'essentials, and cattle and livestock care items.';

export interface AboutSection {
  title: string;
  body: string;
}

export const ABOUT_SECTIONS: AboutSection[] = [
  {
    title: 'What we sell',
    body:
      'Our catalog focuses on practical, everyday essentials: grooming kits and brushes, collars and ' +
      'leashes, beds and mats, feeding and water pieces, salt licks and mineral blocks, food and seed, and ' +
      'travel accessories. Products are organized by pet — from dogs, cats and birds to horses and cattle — ' +
      'so it is easy to find what your animal actually needs.',
  },
  {
    title: 'How we source and curate',
    body:
      'Product listings use information supplied by manufacturers and suppliers. A listing is not a claim ' +
      'that Luxedge has independently tested or certified the product. Check the selected size, materials, ' +
      'pack quantity and delivery information before ordering. For animal feed or supplements, verify the ' +
      'label and intended species with the supplier and your animal-care professional.',
  },
  {
    title: 'Our buying guides',
    body:
      'Our guides explain product choices, fit and everyday care. Luxedge Editorial Team is the site’s ' +
      'publishing byline, not a claim of professional credentials or independent laboratory testing. ' +
      'Luxedge sells products linked from its guides and may earn advertising revenue. Product links are ' +
      'commercial recommendations, not proof of test results. For a correction or a source question, ' +
      'email hello@luxedge.us with the page URL and the passage concerned.',
  },
  {
    title: 'Customer support',
    body:
      'Our team is available Monday to Friday, 9AM\u20136PM CT. Order processing takes about 1\u20133 business days, and ' +
      'eligible products ship across the United States where the destination is supported. We offer 30-day return ' +
      'and replacement support for damaged, defective, or incorrect items. Questions? Contact hello@luxedge.us ' +
      'or call (440) 941-8002.',
  },
];
