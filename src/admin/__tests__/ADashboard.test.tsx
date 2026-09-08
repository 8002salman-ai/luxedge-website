import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

// ADashboard only needs useApp().users at initial render; effects (fetch,
// listProducts, getAccessToken) never run under renderToStaticMarkup.
vi.mock('../../App', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../App')>();
  return {
    ...mod,
    useApp: () => ({ users: [] }),
  };
});

import { ADashboard } from '../AdminSection';

describe('ADashboard premium operations panel', () => {
  it('renders the header, KPI row, main grid, operational cards and quick actions without crashing', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ADashboard />
      </MemoryRouter>,
    );
    // Header: title, subtitle, Live indicator, action buttons
    expect(html).toContain('Dashboard');
    expect(html).toContain('Store performance and catalog overview.');
    expect(html).toContain('Live');
    expect(html).toContain('View store');
    expect(html).toContain('AI Import');
    expect(html).toContain('Add to Catalog');
    // KPI row — six metric cards
    expect(html).toContain('Revenue (7 days)');
    expect(html).toContain('Avg order value');
    expect(html).toContain('Active products');
    expect(html).toContain('Low-stock products');
    // Left column: chart with range selector + recent orders
    // (the ampersand is HTML-escaped in static markup)
    expect(html).toContain('Revenue &amp; Orders');
    expect(html).toContain('7D');
    expect(html).toContain('30D');
    expect(html).toContain('90D');
    expect(html).toContain('Recent Orders');
    expect(html).toContain('View all orders');
    // Right column: order status, low stock, gift drop, publishing queue
    expect(html).toContain('Order Status');
    expect(html).toContain('Low Stock');
    expect(html).toContain('Gift Drop');
    expect(html).toContain('Publishing Queue');
    // Empty states (no data in static render)
    expect(html).toContain('No orders yet');
    expect(html).toContain('No drafts waiting for review.');
    // Quick actions — 2x3 grid
    expect(html).toContain('Import Product');
    expect(html).toContain('Add Product Manually');
    expect(html).toContain('Generate Product Content');
    expect(html).toContain('Create Variants');
    expect(html).toContain('SEO Optimize');
    expect(html).toContain('Open AI Intelligence');
  });
});