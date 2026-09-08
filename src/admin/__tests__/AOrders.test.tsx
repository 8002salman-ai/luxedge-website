import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// AOrders only needs useApp().notify + Modal at initial render; effects
// (fetch, localStorage, getAccessToken) never run under renderToStaticMarkup.
vi.mock('../../App', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../App')>();
  return {
    ...mod,
    useApp: () => ({ notify: () => {} }),
  };
});

import { AOrders } from '../AdminSection';

describe('AOrders responsive redesign', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the fluid header, KPI row, ERP panel and orders card without crashing', () => {
    const html = renderToStaticMarkup(<AOrders />);
    // Header
    expect(html).toContain('Orders');
    expect(html).toContain('Track, fulfil and sync orders to your ERP.');
    // KPI row — four metric cards
    expect(html).toContain('Total Orders');
    expect(html).toContain('Revenue');
    expect(html).toContain('Needs Fulfilment');
    expect(html).toContain('Shipped / Delivered');
    // ERP sync panel
    expect(html).toContain('ERP Sync');
    expect(html).toContain('Export CSV');
    // Orders card header + loading state
    expect(html).toContain('AUTHORITATIVE');
    expect(html).toContain('Loading orders');
  });
});