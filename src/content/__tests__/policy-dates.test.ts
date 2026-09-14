import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { POLICY_LAST_UPDATED } from '../policies';

/**
 * Every legal page is served twice: the worker pre-renders the crawl HTML from
 * the shared section data, and React renders the interactive page. Their
 * "Last updated" dates used to be independent literals — the worker hardcoded
 * one date for all five pages while /copyright shipped a newer one, so a
 * crawler and a visitor saw different revision dates for the same URL.
 *
 * POLICY_LAST_UPDATED is now the single source for both. These tests pin that:
 * the worker may not reintroduce a hardcoded date, every pre-rendered legal
 * route must have an entry, and /copyright must not silently inherit an earlier
 * revision date than the day it was published.
 */
const worker = readFileSync('worker/seo-meta.ts', 'utf8');

const LEGAL_ROUTES = ['/privacy', '/terms', '/returns', '/shipping-policy', '/copyright'];

function legalRouteLines(): string[] {
  return worker
    .split('\n')
    .filter((line) => /staticKey === '\/[a-z-]+'\) out = injectLegalBody/.test(line));
}

describe('legal page last-updated dates', () => {
  it('dates every pre-rendered legal route from the shared map', () => {
    const lines = legalRouteLines();
    expect(lines.length).toBe(LEGAL_ROUTES.length);
    for (const line of lines) {
      expect(line, `not sourced from POLICY_LAST_UPDATED: ${line.trim()}`).toContain(
        'POLICY_LAST_UPDATED[staticKey]',
      );
    }
  });

  it('has no hardcoded policy date left in the worker', () => {
    expect(worker).not.toMatch(/Last updated: (January|February|March|April|May|June|July|August|September|October|November|December)/);
  });

  it('covers exactly the legal routes the worker pre-renders', () => {
    const covered = Object.keys(POLICY_LAST_UPDATED).sort();
    expect(covered).toEqual([...LEGAL_ROUTES].sort());
    for (const [route, label] of Object.entries(POLICY_LAST_UPDATED)) {
      expect(label, `${route} has an unusable date label`).toMatch(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/);
    }
  });

  it('dates /copyright to its own publication date, not an earlier revision', () => {
    expect(POLICY_LAST_UPDATED['/copyright']).toBe('September 14, 2026');
    expect(POLICY_LAST_UPDATED['/copyright']).not.toBe(POLICY_LAST_UPDATED['/privacy']);
  });
});
