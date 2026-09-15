// ============================================================================
// LUXEDGE — shared static page content (single source of truth)
//
// Used by both the React pages (src/App.tsx) and the worker pre-render
// (worker/seo-meta.ts) so crawlers and users see the same substantive
// content in the initial HTML. Every fact is drawn from the live policies.
// ============================================================================

/**
 * Public contact details.
 *
 * EMAIL ONLY, deliberately. The support phone number is not published: it is
 * released to signed-in customers who have placed an order (see
 * api/support/contact.ts). Do not add the number here — this array is
 * pre-rendered into the crawl HTML on every page, so anything listed becomes
 * public and scrapable.
 */
export const CONTACT_INFO = [
  { label: 'Email', value: 'hello@luxedge.us', sub: 'We reply within 24hrs' },
  { label: 'Address', value: '1500 N Grant St, Denver, CO 80203', sub: 'United States' },
  { label: 'Hours', value: 'Mon - Fri', sub: '9:00 AM - 6:00 PM CT' },
];

export interface PolicySection {
  title: string;
  body: string;
}

export const PRIVACY_SECTIONS: PolicySection[] = [
  { title: 'Introduction', body: 'At Luxedge, we value your privacy and are committed to protecting your personal information. This Privacy Policy explains what information we collect, how we use it, and the choices you have when using our website. Luxedge is operated by Embani LLC, 1500 N Grant St, Denver, CO 80203, United States.' },
  { title: 'Information We Collect', body: 'Name, billing and shipping address, email address, phone number, payment and transaction information (Luxedge does not store complete card numbers), order history, messages and support details, IP address, browser type, device information, and website usage through cookies and analytics.' },
  { title: 'How We Use Your Information', body: 'To process and fulfill orders, communicate regarding orders and customer service, respond to inquiries, improve our website, prevent fraud, comply with legal obligations, and send promotional emails if you have opted in.' },
  { title: 'Cookies and Analytics', body: 'Our website uses essential browser storage for the cart, account sessions, and preferences. With your consent, we load analytics and advertising technologies to understand traffic and show relevant ads.' },
  { title: 'Sharing Your Information', body: 'We do not sell or rent your personal information. We share only with trusted service providers including payment processors, shipping carriers, website hosting, analytics, and AI service providers that help operate support tools.' },
  { title: 'Data Security', body: 'We use reasonable administrative, technical, and physical safeguards. While no method of transmission is completely secure, we strive to use industry-standard practices.' },
  { title: 'Your Privacy Choices', body: 'You may request access to, correction of, or deletion of personal information. We do not sell personal information. To make a privacy request, email hello@luxedge.us.' },
  { title: 'Children\'s Privacy', body: 'Luxedge is not directed to children under 13, and we do not knowingly collect personal information from children under 13.' },
  { title: 'Contact Us', body: 'Questions about this Privacy Policy? Email hello@luxedge.us and we will reply within 24 hours. Luxedge is operated by Embani LLC, 1500 N Grant St, Denver, CO 80203, United States.' },
];

export const TERMS_SECTIONS: PolicySection[] = [
  { title: 'Using Luxedge', body: 'By using this website, you agree to these Terms of Service and our Privacy Policy. Luxedge is operated by Embani LLC, 1500 N Grant St, Denver, CO 80203, United States.' },
  { title: 'Products, Pricing, and Availability', body: 'Product availability, pricing, images, specifications, and descriptions may change. We work to keep details accurate, but occasional errors may occur.' },
  { title: 'Orders and Payment', body: 'Submitting checkout is not acceptance of an order. An order is accepted only after the payment provider confirms a successful transaction and Luxedge sends a confirmation.' },
  { title: 'Shipping and Delivery', body: 'Shipping availability, cost, and estimated delivery windows are shown at checkout or on product pages. Estimates are not guarantees.' },
  { title: 'Returns, Replacements, and Refunds', body: 'Returns and replacements are governed by our Return & Replacement Policy. Luxedge does not offer change-of-mind refunds as a standard remedy.' },
  { title: 'Product Information', body: 'Product information is for general shopping purposes. Follow product labels, instructions, intended species, and warnings. Animal food and feed: check the label, ingredients, intended species, and warnings before use.' },
  { title: 'Disclaimers and Liability', body: 'The website and its content are provided without warranties beyond those that cannot legally be excluded. Luxedge is not liable for indirect, incidental, or consequential losses except where liability cannot be limited.' },
  { title: 'Changes and Contact', body: 'We may update these Terms by posting a revised version. Questions: email hello@luxedge.us.' },
];

export const RETURNS_SECTIONS: PolicySection[] = [
  { title: 'Our Promise', body: 'If you receive a damaged, defective, or incorrect product, contact us within 30 days of your order date. We will work to resolve it quickly.' },
  { title: 'Return Eligibility', body: 'Return requests must be made within 30 days. Products must be unused, unopened, and in original packaging. Returns require prior approval.' },
  { title: 'Replacement Policy', body: 'Once we receive and inspect your returned product, we will process a replacement if the return meets policy requirements. Replacement items ship after the return is received and approved.' },
  { title: 'Refunds and Legal Rights', body: 'Luxedge does not offer change-of-mind refunds or store credit as a standard policy. Eligible damaged, defective, or incorrect products are handled by replacement. Where applicable law requires a refund, that right is not limited.' },
  { title: 'Return Shipping', body: 'Customers are responsible for return shipping label, packaging, and all return shipping costs. We recommend using a trackable shipping service.' },
  { title: 'Damaged or Incorrect Orders', body: 'Contact us within 30 days of delivery with your order number and photos of the product and packaging.' },
  { title: 'Contact Us', body: 'Questions about returns? Email hello@luxedge.us and we will reply within 24 hours. Luxedge is operated by Embani LLC, 1500 N Grant St, Denver, CO 80203, United States.' },
];

/**
 * Shipping policy, in reading order. This array is the single source of truth:
 * the worker pre-renders these exact strings into the crawl HTML and the React
 * page renders the same section titles, so a crawler and a visitor cannot be
 * shown different shipping terms. Facts stay deliberately conservative — we do
 * not publish a delivery window, carrier or processing time the checkout does
 * not actually stand behind. Nothing here may promise a number the storefront
 * cannot show.
 */
export const SHIPPING_SECTIONS: PolicySection[] = [
  { title: 'Overview', body: 'This page explains how Luxedge orders are shipped: where we deliver, how shipping is priced, what affects your delivery estimate, and what to do if something goes wrong with a shipment. Luxedge is operated by Embani LLC, 1500 N Grant St, Denver, CO 80203, United States.' },
  { title: 'Where We Ship', body: 'Luxedge offers shipping within the United States where the destination is supported by the product, supplier, and carrier. International shipping is not currently offered.' },
  { title: 'Shipping Costs', body: 'Shipping cost is calculated for your specific cart, products, and destination, and is shown in the cart and again at checkout before you pay. The amount displayed immediately before payment is the amount that applies to your order. Some orders qualify for a free-shipping promotion. Any such offer applies only to eligible products, destinations, and order values as displayed in the cart or checkout, may have exclusions, and can change or end without notice.' },
  { title: 'Processing Time', body: 'Orders are prepared for dispatch once payment is confirmed. Because different products may be fulfilled from different supplier locations, preparation time can vary between items in the same order. You will receive shipment and tracking information when it becomes available.' },
  { title: 'Shipping Methods & Times', body: 'Shipping methods and estimated delivery windows are shown on the product page and at checkout. Delivery estimates are estimates, not guarantees. Express shipping is not currently offered unless it is specifically shown as an option at checkout.' },
  { title: 'Order Tracking', body: 'Once your order ships, you will receive a confirmation email with a tracking number that you can use on the carrier\u2019s website. You can also check your order status at any time from your Luxedge account.' },
  { title: 'Delivery Delays', body: 'Delays can occasionally occur because of high order volume, supplier or carrier issues, weather events, public holidays, or other circumstances outside our control. Delivery estimates can be affected by your destination, the fulfilment location of each item, and carrier load during peak periods. If your order is significantly delayed, contact us and we will investigate.' },
  { title: 'Missing or Lost Packages', body: 'If tracking shows "delivered" but you have not received your package, check with neighbours, building management, or your local post office. If you still cannot locate your package after 48 hours, contact hello@luxedge.us and we will work with the carrier to resolve it.' },
  { title: 'Address Accuracy', body: 'Please double-check your shipping address before completing checkout. Luxedge is not responsible for orders shipped to an incorrect address provided by the customer. Address correction fees charged by carriers are the customer\u2019s responsibility.' },
  { title: 'P.O. Boxes & Military Addresses', body: 'P.O. Box and APO/FPO/DPO destinations are supported where a carrier can deliver to them, and the available options are shown at checkout. Delivery times to military addresses may vary, and express services may not be available for these destinations.' },
  { title: 'Related Information', body: 'See our Returns & Refunds policy for damaged, defective, or incorrect items, the FAQ for common delivery and tracking questions, or contact us and we will help.' },
];

/** Copyright / DMCA page — one page, not four. Deliberately conservative:
 * it states what we own, what we use with permission, how to send a notice,
 * what a notice should contain, and that false notices are not acceptable. It
 * does not claim any registration, legal-agent designation or statutory
 * obligation the business has not established. */
export const COPYRIGHT_SECTIONS: PolicySection[] = [
  { title: 'Copyright', body: 'The original content published on luxedge.us — our product write-ups, buying guides, page copy, the site design and layout, and the Luxedge name and logo — is owned by Embani LLC (operating as Luxedge) or used with permission. Copyright \u00a9 2026 Embani LLC. All rights reserved. Product names, brand names and supplier photography that appear in a listing stay the property of their respective owners.' },
  { title: 'Using Our Content', body: 'You are welcome to quote a short excerpt of a guide or product description if you link back to the page you took it from. Republishing an article in full, reselling our images, or presenting our content as your own is not permitted without written permission from us. If you are unsure whether your intended use is allowed, email us before you publish.' },
  { title: 'Reporting Infringing Material', body: 'If you believe material published on luxedge.us infringes a copyright you own or represent, email hello@luxedge.us with the subject line \u201cCopyright Notice\u201d. Include the page address (URL) of the material so we can find it, and we will review the notice and remove or disable access to material that is properly identified.' },
  { title: 'What a Notice Should Include', body: 'To let us act quickly, a notice should contain:\n\u2022 identification of the copyrighted work you say is infringed;\n\u2022 the exact URL of the material you are asking us to remove;\n\u2022 your name, address, telephone number and email address;\n\u2022 a statement that you have a good-faith belief the use is not authorised by the owner, its agent, or the law;\n\u2022 a statement that the information in your notice is accurate and that you are the owner or are authorised to act for the owner;\n\u2022 your physical or electronic signature.\nWe may ask for clarification if a notice is incomplete.' },
  { title: 'If Your Material Was Removed', body: 'If we remove material that you published and you believe the removal was a mistake, you can reply to the same address with your contact details, the URL concerned, and an explanation of why the material should be restored. We will review it and may restore the material where the law allows.' },
  { title: 'Misleading or Abusive Notices', body: 'Please do not send notices you know to be false or misleading, and do not use this process to remove legitimate criticism or a competitor\u2019s genuine listing. We may decline to act on notices that are incomplete, that are not about copyright, or that appear to be an attempt to misuse the process. Sending a knowingly false notice can carry legal consequences for the sender.' },
  { title: 'Contact', body: 'Copyright questions and notices: email hello@luxedge.us. We monitor this inbox Monday to Friday, 9AM\u20136PM CT. Luxedge is operated by Embani LLC, 1500 N Grant St, Denver, CO 80203, United States.' },
];

/**
 * Last-updated label per policy route. ONE source, read by both the worker's
 * pre-rendered HTML and the React page, so the crawl copy and the hydrated copy
 * cannot disagree about when a policy last changed. /copyright is dated to the
 * day it was published rather than inheriting an earlier revision date.
 */
export const POLICY_LAST_UPDATED: Record<string, string> = {
  '/privacy': 'August 26, 2026',
  '/terms': 'August 26, 2026',
  '/returns': 'August 26, 2026',
  '/shipping-policy': 'September 15, 2026',
  '/copyright': 'September 14, 2026',
};

export interface FaqItem {
  q: string;
  a: string;
}

export interface FaqCategory {
  category: string;
  items: FaqItem[];
}

export const FAQ_DATA: FaqCategory[] = [
  { category: 'Orders & Shipping', items: [
    { q: 'How long does shipping take?', a: 'Delivery timing is confirmed during order processing. Tracking is shared when available.' },
    { q: 'Do you offer free shipping?', a: 'Some products or orders may qualify for a free-shipping promotion. Eligibility is shown in the cart or at checkout.' },
    { q: 'How can I track my order?', a: 'Once your order ships, you will receive an email with a tracking number. You can also log into your Luxedge account and check "My Orders."' },
    { q: 'Do you ship internationally?', a: 'Currently, Luxedge offers shipping within the United States. International shipping is not currently offered.' },
    { q: 'Can I change my shipping address after ordering?', a: 'If your order has not shipped yet, contact us immediately at hello@luxedge.us.' },
  ]},
  { category: 'Returns & Refunds', items: [
    { q: 'What is your return policy?', a: 'We offer a 30-day return and replacement policy. Products must be unused, unopened, and in original packaging. Email hello@luxedge.us within 30 days.' },
    { q: 'How does the replacement process work?', a: 'Once we receive and inspect your return, we normally ship a replacement of the same product. Change-of-mind refunds are not standard.' },
    { q: 'Who pays for return shipping?', a: 'Customers are responsible for return shipping costs and packaging. We recommend using a trackable service.' },
    { q: 'What if I receive a damaged or incorrect item?', a: 'Contact us within 30 days of delivery with your order number and photos of the product and packaging.' },
  ]},
  { category: 'Payment & Security', items: [
    { q: 'What payment methods do you accept?', a: 'Online payment is handled by the configured third-party provider. Luxedge does not store complete card details.' },
    { q: 'Is my payment information secure?', a: 'Payment is handled by the third-party provider and Luxedge does not store complete card details.' },
    { q: 'Can I cancel an order?', a: 'Orders can be canceled within 2 hours of placement. After that, contact us at hello@luxedge.us.' },
  ]},
  { category: 'Products & Quality', items: [
    { q: 'Do you sell pet food or animal feed?', a: 'Some listings may be animal food, feed, treats, seed, supplements, or mineral products. Check the product label, ingredients, intended species, and warnings before use. Follow the label for product-specific guidance.' },
    { q: 'How do you select your products?', a: 'Every product goes through a curation process. We evaluate quality, design, value, and supplier information before listing.' },
    { q: 'Are your products authentic?', a: 'We aim to source products from verified manufacturers and authorized distributors. Every item is reviewed before listing.' },
    { q: 'Do you offer warranties?', a: 'Warranty coverage varies by product and manufacturer. Check the product description for specific details. Our 30-day return policy covers general quality issues.' },
  ]},
  { category: 'Account & Support', items: [
    { q: 'Do I need an account to shop?', a: 'No. Guest checkout is available. You can also create an account to view order history and manage your profile.' },
    { q: 'How do I contact customer support?', a: 'Email hello@luxedge.us — we reply within 24 hours, Monday through Friday. Customers with an order can also find a phone line for their order in their account.' },
  ]},
];

/** Contact page — pre-rendered intro paragraph. */
export const CONTACT_INTRO = 'Have a question, concern, or just want to say hello? We\'d love to hear from you. Our team typically responds within 24 hours.';

/** Contact page — pre-rendered message-sent confirmation text. */
export const CONTACT_SENT = 'Message Received! Thank you for reaching out. We\'ll get back to you within 24 hours.';
