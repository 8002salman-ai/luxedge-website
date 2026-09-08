// ============================================================================
// LUXEDGE — BATCH IMPORT RUNNER
//
// Executes a Listing Task: discover product links from the source URL, then
// import each one through an injected single-product importer (the admin
// panel supplies the real one — scrape/AI, storage images, variants, DB
// writes). The runner itself is PURE with injected I/O so the orchestration
// is unit-testable: count cap, duplicate skipping (URL/title), failure
// isolation (one bad product never aborts the batch), and honest results.
//
// Rules enforced here (the playbook layer lives in the single importer):
//   - never import more than the task's productCount
//   - never import the same URL twice within a batch
//   - never abort the batch because one product failed
// ============================================================================

import type { ListingTask } from './listingTask';
import { discoverProductLinks } from './listingTask';

export type SingleImportResult =
  | { status: 'imported'; productId: string; title: string; finalStatus: string; imageCount: number }
  | { status: 'duplicate'; title: string }
  | { status: 'failed'; url: string; reason: string };

export type BatchItemResult = SingleImportResult & { url: string };

export interface BatchRunResult {
  task: ListingTask;
  discovered: number;
  results: BatchItemResult[];
  imported: number;
  duplicates: number;
  failed: number;
}

export interface BatchImportDeps {
  /** Fetch the raw page content for a URL (server-side /api/fetch-page). */
  fetchPage: (url: string) => Promise<string>;
  /**
   * Import ONE product from a fetched page. Returns a single-import verdict.
   * Must not throw for a single bad product — return { status:'failed' }.
   */
  importOne: (url: string, html: string, task: ListingTask, index: number, total: number) => Promise<SingleImportResult>;
  /** Optional per-product pause between fetches (ms) to respect rate limits. */
  delayMs?: number;
  onProgress?: (done: number, total: number, last: BatchItemResult | null) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runBatchImport(task: ListingTask, deps: BatchImportDeps): Promise<BatchRunResult> {
  const results: BatchItemResult[] = [];
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();

  // 1. Discover candidate product links from the source page.
  let html = '';
  let discoveredLinks: string[] = [];
  try {
    html = await deps.fetchPage(task.sourceUrl);
    discoveredLinks = discoverProductLinks(html, task.sourceUrl, task.sourcePlatform, task.productCount);
  } catch (e) {
    // Discovery failure is a batch-level failure — report honestly.
    return {
      task,
      discovered: 0,
      results: [{ status: 'failed', url: task.sourceUrl, reason: `Could not fetch source page: ${(e as Error).message}` }],
      imported: 0,
      duplicates: 0,
      failed: 1,
    };
  }

  // 2. Import up to productCount unique links, one at a time.
  const links = discoveredLinks.slice(0, task.productCount);
  for (let i = 0; i < links.length; i++) {
    const url = links[i];
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);
    let item: BatchItemResult;
    try {
      const page = i === 0 ? html : await deps.fetchPage(url);
      const r = await deps.importOne(url, page, task, i, links.length);
      if (r.status === 'imported') {
        if (seenTitles.has(r.title)) {
          item = { status: 'duplicate', url, title: r.title };
        } else {
          seenTitles.add(r.title);
          item = { status: 'imported', url, productId: r.productId, title: r.title, finalStatus: r.finalStatus, imageCount: r.imageCount };
        }
      } else if (r.status === 'duplicate') {
        item = { status: 'duplicate', url, title: r.title };
      } else {
        item = { status: 'failed', url, reason: r.reason };
      }
    } catch (e) {
      item = { status: 'failed', url, reason: (e as Error).message };
    }
    results.push(item);
    deps.onProgress?.(i + 1, links.length, item);
    if (deps.delayMs && i < links.length - 1) await sleep(deps.delayMs);
  }

  const imported = results.filter((r) => r.status === 'imported').length;
  const duplicates = results.filter((r) => r.status === 'duplicate').length;
  const failed = results.filter((r) => r.status === 'failed').length;

  return { task, discovered: discoveredLinks.length, results, imported, duplicates, failed };
}