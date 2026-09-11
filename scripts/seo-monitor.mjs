#!/usr/bin/env node
/** Read-only live SEO monitor. Public HTTP GET requests only; JSON stdout. */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const DEFAULT_SITE = 'https://luxedge.us';
const TIMEOUT_MS = 20_000;

export function normalizeSite(value) {
  const site = new URL(value || DEFAULT_SITE);
  site.pathname = '/'; site.search = ''; site.hash = '';
  return site.toString().replace(/\/$/, '');
}
export function parseSitemapUrls(xml) {
  return [...new Set([...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => m[1].trim()).filter(Boolean))];
}
export function parsePageSignals(html, requestedUrl) {
  const canonical = html.match(/<link\b[^>]*\brel\s*=\s*["']?canonical["']?[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/i) || html.match(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*\brel\s*=\s*["']?canonical["']?[^>]*>/i);
  const robots = html.match(/<meta\b[^>]*\bname\s*=\s*["']?robots["']?[^>]*\bcontent\s*=\s*["']([^"']*)["'][^>]*>/i) || html.match(/<meta\b[^>]*\bcontent\s*=\s*["']([^"']*)["'][^>]*\bname\s*=\s*["']?robots["']?[^>]*>/i);
  const robotsContent = robots?.[1]?.trim().toLowerCase() || null;
  return { canonical: canonical?.[1] ? new URL(canonical[1], requestedUrl).toString() : null, noindex: Boolean(robotsContent && /(?:^|[\s,])noindex(?:$|[\s,])/.test(robotsContent)), robots: robotsContent };
}
export function classifyUrl({ url, status, canonical, noindex }) {
  const issues = [];
  if (status !== 200) issues.push(`http_${status ?? 'error'}`);
  if (!canonical) issues.push('missing_canonical'); else if (canonical !== url) issues.push('canonical_mismatch');
  if (noindex) issues.push('noindex');
  return { url, status, canonical, noindex, state: issues.length ? 'fail' : 'pass', issues };
}
export function classifyRobots({ status, text, sitemapUrl }) {
  const referenced = new RegExp(`^\\s*sitemap:\\s*${escapeRegex(sitemapUrl)}\\s*$`, 'im').test(text || '');
  const issues = [];
  if (status !== 200) issues.push(`http_${status ?? 'error'}`);
  if (!referenced) issues.push('sitemap_not_referenced');
  return { url: sitemapUrl.replace(/\/sitemap\.xml$/, '/robots.txt'), status, sitemap_referenced: referenced, state: issues.length ? 'fail' : 'pass', issues };
}
export function shouldAlert(report) { return report.summary.failed_urls > 0 || report.robots.state === 'fail' || report.sitemap.state === 'fail'; }
function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
async function request(url) {
  try { const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) }); return { status: response.status, text: await response.text() }; }
  catch { return { status: null, text: '' }; }
}
export async function runMonitor({ site = DEFAULT_SITE, fetchImpl = request } = {}) {
  const base = normalizeSite(site); const sitemapUrl = `${base}/sitemap.xml`; const robotsUrl = `${base}/robots.txt`;
  const sitemapResponse = await fetchImpl(sitemapUrl); const urls = sitemapResponse.status === 200 ? parseSitemapUrls(sitemapResponse.text) : [];
  const sitemapIssues = []; if (sitemapResponse.status !== 200) sitemapIssues.push(`http_${sitemapResponse.status ?? 'error'}`); if (sitemapResponse.status === 200 && !urls.length) sitemapIssues.push('empty_sitemap');
  const pages = await Promise.all(urls.map(async (url) => { const page = await fetchImpl(url); return classifyUrl({ url, status: page.status, ...parsePageSignals(page.text, url) }); }));
  const robotsResponse = await fetchImpl(robotsUrl); const robots = classifyRobots({ status: robotsResponse.status, text: robotsResponse.text, sitemapUrl });
  const report = { schema_version: '1.0', generated_at: new Date().toISOString(), mode: 'read_only', site: base, sitemap: { url: sitemapUrl, status: sitemapResponse.status, urls_discovered: urls.length, state: sitemapIssues.length ? 'fail' : 'pass', issues: sitemapIssues }, robots, pages, summary: { checked_urls: pages.length, failed_urls: pages.filter((page) => page.state === 'fail').length, alert: false } };
  report.summary.alert = shouldAlert(report); return report;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const index = process.argv.indexOf('--site'); const site = index >= 0 ? process.argv[index + 1] : DEFAULT_SITE;
  runMonitor({ site }).then((report) => console.log(JSON.stringify(report))).catch((error) => { console.log(JSON.stringify({ schema_version: '1.0', mode: 'read_only', error: error instanceof Error ? error.message : 'monitor_failed' })); process.exitCode = 1; });
}


