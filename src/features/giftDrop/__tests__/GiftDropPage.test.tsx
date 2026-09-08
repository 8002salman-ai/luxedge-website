import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import GiftDropPage from '../GiftDropPage';

describe('GiftDropPage premium redesign', () => {
  it('renders the compact premium hero and availability pill', () => {
    const html = renderToStaticMarkup(<GiftDropPage />);
    // Compact hero replaces the old oversized "50 real gifts" block
    expect(html).toContain('A complimentary gift for your dog or cat');
    expect(html).toContain('on us.');
    expect(html).toContain('One real Luxedge product and standard shipping — $0');
    expect(html).not.toContain('50 real gifts');
    expect(html).not.toContain('For real pet owners');
    // Warm off-white premium page background + charcoal text
    expect(html).toContain('bg-[#faf8f3]');
    expect(html).toContain('text-[#1b1f27]');
    // Availability pill renders while the campaign state loads
    expect(html).toContain('Checking real gift availability');
  });
});