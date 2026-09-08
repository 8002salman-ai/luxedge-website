import { describe, it, expect } from 'vitest';
import { runBatchImport, type BatchImportDeps } from '../batchImport';
import { normalizeListingTask } from '../listingTask';

function task(overrides: Record<string, unknown> = {}) {
  return normalizeListingTask({
    sourcePlatform: 'AliExpress',
    sourceUrl: 'https://www.aliexpress.com/category/1234',
    productCount: 5,
    category: 'Dog',
    pricing: { mode: 'markup', markupPct: 40 },
    status: 'draft',
    specialInstructions: '',
    ...overrides,
  });
}

function pageHtml(n: number): string {
  return Array.from({ length: n }, (_, i) => `<a href="/item/${i}000000000000000000.html">p${i}</a>`).join('\n');
}

function deps(overrides: Partial<BatchImportDeps> = {}): BatchImportDeps {
  return {
    fetchPage: async (u) => (u.includes('category') ? pageHtml(4) : pageHtml(0)),
    importOne: async (url) => {
      const id = url.match(/\/(?:item|dp|products)\/([^/]+)/)?.[1] || url.slice(-8);
      return {
        status: 'imported',
        productId: `id-${id}`,
        title: `Product ${id}`,
        finalStatus: 'draft',
        imageCount: 3,
      };
    },
    ...overrides,
  };
}

describe('batch import runner', () => {
  it('imports discovered products up to the task count', async () => {
    const r = await runBatchImport(task({ productCount: 3 }), deps());
    expect(r.discovered).toBe(3); // discovery is capped at productCount
    expect(r.imported).toBe(3);
    expect(r.results).toHaveLength(3);
    expect(r.duplicates).toBe(0);
    expect(r.failed).toBe(0);
  });

  it('never imports the same URL twice within a batch', async () => {
    const importOne = async (url: string) => ({ status: 'imported' as const, productId: 'p', title: `T-${url.slice(-3)}`, finalStatus: 'draft', imageCount: 3 });
    const r = await runBatchImport(task({ productCount: 5 }), deps({ importOne }));
    expect(r.results.length).toBeLessThanOrEqual(4);
    const urls = r.results.map((x) => x.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('isolates failures — one bad product does not abort the batch', async () => {
    let calls = 0;
    const importOne = async (url: string) => {
      calls += 1;
      if (calls === 2) return { status: 'failed' as const, url, reason: 'boom' };
      return { status: 'imported' as const, productId: `p${calls}`, title: `P${calls}`, finalStatus: 'draft', imageCount: 3 };
    };
    const r = await runBatchImport(task({ productCount: 4 }), deps({ importOne }));
    expect(r.imported).toBe(3);
    expect(r.failed).toBe(1);
    const second = r.results[1];
    expect(second.status).toBe('failed');
    if (second.status === 'failed') expect(second.reason).toBe('boom');
  });

  it('skips duplicate titles within the batch (counted as duplicates)', async () => {
    const importOne = async () => ({ status: 'imported' as const, productId: 'p', title: 'Same Product', finalStatus: 'draft', imageCount: 3 });
    const r = await runBatchImport(task({ productCount: 5 }), deps({ importOne }));
    expect(r.imported).toBe(1);
    expect(r.duplicates).toBe(3);
  });

  it('reports an honest batch-level failure when the source page cannot be fetched', async () => {
    const r = await runBatchImport(task(), deps({ fetchPage: async () => { throw new Error('fetch 429'); } }));
    expect(r.failed).toBe(1);
    expect(r.imported).toBe(0);
    const first = r.results[0];
    if (first.status === 'failed') expect(first.reason).toMatch(/429/);
  });

  it('no product links on the source page → zero imported, no crash', async () => {
    const r = await runBatchImport(task(), deps({ fetchPage: async () => '<a href="/">home</a>' }));
    expect(r.discovered).toBe(0);
    expect(r.imported).toBe(0);
    expect(r.failed).toBe(0);
  });
});