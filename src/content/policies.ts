// ============================================================================
// LUXEDGE — shared static page content (single source of truth)
//
// Used by both the React pages (src/App.tsx) and the worker pre-render
// (worker/seo-meta.ts) so crawlers and users see the same substantive
// content in the initial HTML. Every fact is drawn from the live policies.
// ============================================================================

export const CONTACT_INFO = [
  { label: 'Email', value: 'hello@luxedge.us', sub: 'We reply within 24hrs' },
  { label: 'Phone', value: '(440) 941-8002', sub: 'Mon-Fri, 9AM-6PM CT' },
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
  { title: 'Contact Us', body: 'Questions about this Privacy Policy? Email hello@luxedge.us or call (440) 941-8002.' },
];

export const TERMS_SECTIONS: PolicySection[] = [
  { title: 'Using Luxedge', body: 'By using this website, you agree to these Terms of Service and our Privacy Policy. Luxedge is operated by Embani LLC, 1500 N Grant St, Denver, CO 80203, United States.' },
  { title: 'Products, Pricing, and Availability', body: 'Product availability, pricing, images, specifications, and descriptions may change. We work to keep details accurate, but occasional errors may occur.' },
  { title: 'Orders and Payment', body: 'Submitting checkout is not acceptance of an order. An order is accepted only after the payment provider confirms a successful transaction and Luxedge sends a confirmation.' },
  { title: 'Shipping and Delivery', body: 'Shipping availability, cost, and estimated delivery windows are shown at checkout or on product pages. Estimates are not guarantees.' },
  { title: 'Returns, Replacements, and Refunds', body: 'Returns and replacements are governed by our Return & Replacement Policy. Luxedge does not offer change-of-mind refunds as a standard remedy.' },
  { title: 'Product Information', body: 'Product information is for general shopping purposes. Follow product labels, instructions, intended species, and warnings. Animal food and feed: check the label, ingredients, intended species, and warnings before use.' },
  { title: 'Disclaimers and Liability', body: 'The website and its content are provided without warranties beyond those that cannot legally be excluded. Luxedge is not liable for indirect, incidental, or consequential losses except where liability cannot be limited.' },
  { title: 'Changes and Contact', body: 'We may update these Terms by posting a revised version. Questions: hello@luxedge.us or (440) 941-8002.' },
];

export const RETURNS_SECTIONS: PolicySection[] = [
  { title: 'Our Promise', body: 'If you receive a damaged, defective, or incorrect product, contact us within 30 days of your order date. We will work to resolve it quickly.' },
  { title: 'Return Eligibility', body: 'Return requests must be made within 30 days. Products must be unused, unopened, and in original packaging. Returns require prior approval.' },
  { title: 'Replacement Policy', body: 'Once we receive and inspect your returned product, we will process a replacement if the return meets policy requirements. Replacement items ship after the return is received and approved.' },
  { title: 'Refunds and Legal Rights', body: 'Luxedge does not offer change-of-mind refunds or store credit as a standard policy. Eligible damaged, defective, or incorrect products are handled by replacement. Where applicable law requires a refund, that right is not limited.' },
  { title: 'Return Shipping', body: 'Customers are responsible for return shipping label, packaging, and all return shipping costs. We recommend using a trackable shipping service.' },
  { title: 'Damaged or Incorrect Orders', body: 'Contact us within 30 days of delivery with your order number and photos of the product and packaging.' },
  { title: 'Contact Us', body: 'Questions about returns? Email hello@luxedge.us or call (440) 941-8002. Luxedge is operated by Embani LLC, 1500 N Grant St, Denver, CO 80203, United States.' },
];

export const SHIPPING_SECTIONS: PolicySection[] = [
  { title: 'Where We Ship', body: 'Luxedge offers shipping within the United States where the destination is supported by the product, supplier, and carrier. International shipping is not currently offered. Luxedge is operated by Embani LLC, 1500 N Grant St, Denver, CO 80203, United States.' },
  { title: 'Processing Time', body: 'Orders are generally prepared within 1-3 business days after successful payment confirmation, unless a different estimate is shown on the product page or at checkout.' },
  { title: 'Shipping Methods & Times', body: 'Shipping methods and estimated delivery are shown per product and at checkout. Delivery estimates are estimates, not guarantees. Express shipping is not currently offered unless shown at checkout.' },
  { title: 'Shipping Promotions', body: 'Any free-shipping offer applies only to eligible products, destinations, and orders as displayed in the cart or checkout.' },
  { title: 'Order Tracking', body: 'Once your order ships, you will receive a confirmation email with a tracking number. You can also check order status by logging into your Luxedge account.' },
  { title: 'Delivery Delays', body: 'Delays may occasionally occur due to high order volume, carrier issues, weather, or other circumstances beyond our control.' },
  { title: 'Missing or Lost Packages', body: 'If tracking shows "delivered" but you have not received your package, check with neighbors, building management, or your local post office. If still missing after 48 hours, contact hello@luxedge.us.' },
  { title: 'Address Accuracy', body: 'Please double-check your shipping address before checkout. Luxedge is not responsible for orders shipped to incorrect addresses provided by the customer.' },
];

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
    { q: 'How long does shipping take?', a: 'Standard delivery is estimated at 5-14 business days depending on the product. Processing takes 1-3 business days before shipment.' },
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
    { q: 'How do I contact customer support?', a: 'Email hello@luxedge.us or call (440) 941-8002, Monday through Friday, 9AM to 6PM CT.' },
  ]},
];

/** Contact page — pre-rendered intro paragraph. */
export const CONTACT_INTRO = 'Have a question, concern, or just want to say hello? We\'d love to hear from you. Our team typically responds within 24 hours.';

/** Contact page — pre-rendered message-sent confirmation text. */
export const CONTACT_SENT = 'Message Received! Thank you for reaching out. We\'ll get back to you within 24 hours.';
