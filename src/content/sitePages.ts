/**
 * Homepage and contact-page body copy — ONE source of truth.
 *
 * The worker pre-renders these exact strings into the crawl HTML
 * (`injectHomeBody` / `injectContactBody` in worker/seo-meta.ts) and the React
 * pages render the same module through src/components/SiteContent.tsx, so a
 * crawler and a visitor cannot be shown different content. This is the same
 * arrangement already used for product, category and policy copy.
 *
 * Ground rules for anything edited here:
 *  - Facts are mirrored from the policy modules (SHIPPING_SECTIONS,
 *    RETURNS_SECTIONS, PRIVACY_SECTIONS), from FAQ_DATA, or from what the
 *    catalogue actually lists. Where the store cannot evidence a detail
 *    (delivery window, carrier, handling time, certification), the copy says so
 *    instead of guessing.
 *  - Numbers are limited to ones the policy pages already publish: the 30-day
 *    return window, the 2-hour cancellation window, the 24-hour reply time and
 *    the Mon-Fri 9AM-6PM CT support hours.
 *  - No claim here may be wider than what the corresponding policy page says,
 *    because both are read by the same visitor.
 *  - The FAQ answers deliberately repeat wording that also appears in the
 *    policy pages or on the /faq page (the site-pages test pins the shared
 *    phrases), so the same question cannot be answered two different ways.
 *  - A FAQ answer never restates a section on its own page: a FAQ that repeats
 *    the surrounding copy is padding, not value.
 */

export interface SiteLink {
  label: string;
  href: string;
}

export interface SiteSection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
  links?: SiteLink[];
}

export interface SiteFaqItem {
  q: string;
  a: string;
}

export const HOME_SECTIONS: SiteSection[] = [
  {
    heading: 'What Luxedge sells',
    paragraphs: [
      'Luxedge is an animal-care store for dogs, cats, birds, horses and livestock. The catalogue is kept deliberately small and is organised by the animal and the everyday job you are shopping for — walking and training, sleeping and resting, feeding and water, grooming, travel and enrichment.',
      'Every listing states what the item is, the size or capacity the listing itself names, the price and whether it is currently available. Where a detail has not been confirmed, the product page says so rather than filling the gap with guesswork — you will see that noted as something to check before ordering.',
    ],
    links: [
      { label: 'Shop all products', href: '/shop' },
      { label: 'Buying guides', href: '/blog' },
    ],
  },
  {
    heading: 'Who it is for',
    paragraphs: [
      'The range covers five groups of animals. Dog supplies include walking and training gear, clothing, shoes, car tethers and carriers. Cat essentials include beds, blankets, bowls, fountains, window perches and play tunnels. Bird supplies cover feeders and baths. Horse and livestock shopping covers feeding and water equipment, including Himalayan salt blocks and rope-mounted salt licks for horses and cattle.',
      'It is for people buying for their own animals — pet owners, and smallholders keeping poultry, horses or cattle. It is not a veterinary service: our contact page sets out plainly what we can help with and what needs a vet or a feed adviser instead.',
    ],
    links: [
      { label: 'Dog', href: '/category/dog-supplies' },
      { label: 'Cat', href: '/category/cat-supplies' },
      { label: 'Bird', href: '/category/bird-supplies' },
      { label: 'Horse', href: '/category/horse' },
      { label: 'Livestock', href: '/category/cattle' },
    ],
  },
  {
    heading: 'How ordering works',
    paragraphs: [
      'Add what you need to the cart and check out. As our Terms explain, submitting checkout is not by itself acceptance of the order: an order is accepted once the payment provider confirms a successful transaction and you receive a confirmation from us.',
      'Shipping cost is calculated for your exact cart, products and destination and is shown in the cart and again at checkout. The amount displayed immediately before you pay is the amount that applies to your order.',
    ],
    links: [{ label: 'Terms of Service', href: '/terms' }],
  },
  {
    heading: 'Shipping, at a glance',
    bullets: [
      'We ship within the United States. International shipping is not currently offered.',
      'Shipping cost is calculated for your cart and destination and shown before you pay. A free-shipping promotion applies only where the cart or checkout shows it as eligible.',
      'Orders are prepared for dispatch once payment is confirmed. Items in one order can be fulfilled from different supplier locations, so preparation times can differ between items.',
      'Tracking is emailed to you when it becomes available, and order status is always visible in your account.',
      'Delivery windows are estimates, not guarantees. Delays can come from carrier or supplier issues, weather, public holidays or peak order volume.',
      'Check your address before paying. We are not responsible for orders shipped to an address entered incorrectly, and carrier correction fees are the customer\u2019s responsibility.',
    ],
    links: [{ label: 'Full Shipping Policy', href: '/shipping-policy' }],
  },
  {
    heading: 'Returns and replacements',
    paragraphs: [
      'If something arrives damaged, defective or incorrect, email hello@luxedge.us within 30 days of your order date with your order number and photos of the product and packaging. Returns need prior approval, and the product should be unused, unopened and in its original packaging; once we receive and inspect it we process a replacement.',
      'Change-of-mind refunds are not a standard remedy, and return shipping is the customer\u2019s responsibility — we recommend a trackable service. Where the law requires a refund, that right is not limited by our policy.',
    ],
    links: [{ label: 'Returns & Refunds', href: '/returns' }],
  },
  {
    heading: 'Support, by email or phone',
    paragraphs: [
      'Support runs on email and phone: hello@luxedge.us or (440) 941-8002, Monday to Friday, 9AM\u20136PM CT, with email replies within 24 hours. Include your order number if you have one, the product name, what went wrong, and photos if anything arrived damaged — that is usually everything needed to act on the first reply.',
    ],
    links: [
      { label: 'Contact us', href: '/contact' },
      { label: 'Frequently asked questions', href: '/faq' },
    ],
  },
  {
    heading: 'Before you buy',
    paragraphs: [
      'Our guides explain how to measure and fit walking gear, how to check and clean equipment, and what to compare when two listings look similar. They are written by the Luxedge Editorial Team from the product information we hold and from published animal-care guidance, and they flag the details only an owner or a vet can confirm.',
      'The guides cover the questions that come up before a purchase: how to fit walking gear so it does not rub, how to clean a feeder properly, where to site a livestock trough, and what to compare between two similar listings. If a guide does not cover something you need to know, email us — the answer usually helps the next buyer too.',
    ],
    links: [
      { label: 'All guides', href: '/blog' },
      { label: 'Site index', href: '/sitemap' },
    ],
  },
];

export const CONTACT_SECTIONS: SiteSection[] = [
  {
    heading: 'Email or phone — both reach us',
    paragraphs: [
      'Send support requests to hello@luxedge.us or call (440) 941-8002. We monitor both Monday to Friday, 9AM\u20136PM CT, and reply to email within 24 hours. The form on this page reaches the same inbox, so either route works — use whichever is easier.',
      'If your message is about an order, sign in before you write. It lets us see the order next to your message, which usually removes a round trip.',
    ],
    links: [
      { label: 'Track an order', href: '/orders' },
      { label: 'Returns & Refunds', href: '/returns' },
      { label: 'Shipping Policy', href: '/shipping-policy' },
    ],
  },
  {
    heading: 'What to include',
    bullets: [
      'Your order number, if you have one — it is on your confirmation email.',
      'The email address you used at checkout, if you are writing from a different one.',
      'The product name exactly as it appears on the listing, so we can identify the right item straight away.',
      'What went wrong, and what outcome you are asking for — a replacement, a missing part, or guidance on using the item.',
      'Photos of the item and its packaging for anything that arrived damaged, defective or incorrect.',
      'For a return: confirmation that the product is unused, unopened and in its original packaging.',
    ],
    paragraphs: [
      'If you have already emailed about the same issue, reply on that thread rather than starting a new one — the history stays in one place and we do not ask you to explain it twice.',
    ],
  },
  {
    heading: 'What we can — and cannot — help with',
    paragraphs: [
      'We can help with order status, shipping problems, damaged, defective or incorrect items, and questions about what a listing says: what is included, the size or capacity the listing names, and whether an item is right for the animal you are buying for.',
      'We cannot give veterinary or medical advice. Product information on this site is general shopping information, so follow the label, the instructions, the intended species and the warnings on the product itself — and speak to a vet or a feed adviser about your animal\u2019s health, diet or mineral needs.',
    ],
  },
  {
    heading: 'Business details',
    paragraphs: [
      'Luxedge is operated by Embani LLC, 1500 N Grant St, Denver, CO 80203, United States. Our policies explain how we handle orders, returns, privacy and site content, and they are written to match how we actually operate.',
    ],
    links: [
      { label: 'FAQ', href: '/faq' },
      { label: 'Privacy Policy', href: '/privacy' },
      { label: 'Terms of Service', href: '/terms' },
      { label: 'Shipping Policy', href: '/shipping-policy' },
      { label: 'Returns & Refunds', href: '/returns' },
      { label: 'Copyright & DMCA', href: '/copyright' },
    ],
  },
];

/**
 * Few short questions, each answer repeating wording that already appears on a
 * policy page — never a second, wider version of the same promise. Deliberately
 * not a copy of FAQ_DATA: the /faq page owns the long-form answers, and these
 * link to it for anything more detailed.
 */
export const HOME_FAQ: SiteFaqItem[] = [
  {
    q: 'How long does shipping take?',
    a: 'Delivery timing is confirmed during order processing. Express shipping is not currently offered unless it is specifically shown as an option at checkout.',
  },
  {
    q: 'Do you sell pet food or animal feed?',
    a: 'Some listings may be animal food, feed, treats, seed, supplements, or mineral products. Review the product label, ingredients, intended species, warnings, and lot or expiry information before use, and follow the label for product-specific guidance.',
  },
  {
    q: 'Do you offer warranties?',
    a: 'Warranty coverage varies by product and manufacturer, so check the individual product description. Our 30-day return policy covers general quality issues.',
  },
];

// The contact page has NO FAQ block on purpose: its sections already answer the
// contact questions (cancellations, address changes, where an order is, what we
// can and cannot help with) and everything longer belongs on /faq. A block here
// previously repeated three /faq answers almost verbatim — duplicate content
// across two indexed URLs — so the sections link to /faq instead.
