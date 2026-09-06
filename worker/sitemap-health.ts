// ============================================================================
// LUXEDGE — nightly sitemap health check
//
// Prevents the sitemap from silently going stale (the exact failure mode that
// fed GSC "Not found: 41" in the indexing audit). The scheduled handler runs
// this nightly: it fetches the LIVE /sitemap.xml, crawls every listed URL and
// records any that return non-200 (or fail to connect), and — only when
// something is actually broken — sends one alert email via the SEND_MAIL
// binding. A clean run sends nothing, so this is quiet by default and loud
// only when there is a real regression.
//
// Reuses the live sitemap the way a crawler would (HTTP GET to the site), so
// it validates exactly what Google sees — the worker's request-time build AND
// the served response — rather than re-deriving the list in-process.
// ============================================================================

export interface SitemapHealthResult {
  ok: boolean;
  checked: number;
  broken: Array<{ url: string; status: string }>;
  source: string;
}

type HealthEnv = {
  SEND_MAIL?: {
    send: (msg: { from: string; to: string; subject: string; html?: string; text?: string; reply_to?: string }) => Promise<void>;
  };
  SITEMAP_ALERT_EMAIL?: string;
};

const root = 'https://luxedge.us';
const SITEMAP_URL = `${root}/sitemap.xml`;
// Fall back to the documented support address if no dedicated alert address is
// configured; a non-empty explicit binding always wins.
const DEFAULT_ALERT_EMAIL = 'hello@luxedge.us';

/** Extract absolute <loc> URLs from a sitemap XML document. */
export function parseSitemapUrls(xml: string): string[] {
  const urls: string[] = [];
  const re = /<loc>([^<]+)<\/loc>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const u = m[1].trim();
    if (u && !urls.includes(u)) urls.push(u);
  }
  return urls;
}

/**
 * Crawl a single URL and return a human label of its outcome. Accepts any HTTP
 * response (the exact status is recorded); network/abort failures are labeled
 * 'ERR'. Redirects are followed so a temporary 3xx chain that lands on 200 is
 * not a false alarm.
 */
async function checkUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });
    return String(res.status);
  } catch {
    return 'ERR';
  }
}

/**
 * Fetch the live sitemap and return its XML, or null on any network/parse
 * failure (so a broken sitemap endpoint itself is reported rather than
 * silently proceeding with an empty list).
 */
async function fetchSitemapXml(): Promise<string | null> {
  try {
    const res = await fetch(SITEMAP_URL, { signal: AbortSignal.timeout(25_000) });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Run the nightly sitemap health check. Returns a summary the caller can log.
 * Sends an alert email ONLY when at least one URL is broken (non-200 or ERR).
 */
export async function runSitemapHealth(env: HealthEnv): Promise<SitemapHealthResult> {
  const xml = await fetchSitemapXml();
  if (xml === null) {
    const broken = [{ url: SITEMAP_URL, status: 'UNREACHABLE' }];
    await sendAlert(env, 0, broken);
    return { ok: false, checked: 0, broken, source: SITEMAP_URL };
  }

  const urls = parseSitemapUrls(xml);
  if (!urls.length) {
    const broken = [{ url: SITEMAP_URL, status: 'EMPTY_SITEMAP' }];
    await sendAlert(env, 0, broken);
    return { ok: false, checked: 0, broken, source: SITEMAP_URL };
  }

  // Crawl in bounded concurrency so a large sitemap doesn't hammer the origin.
  const broken: SitemapHealthResult['broken'] = [];
  const concurrency = 8;
  let idx = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (idx < urls.length) {
      const url = urls[idx++];
      const status = await checkUrl(url);
      if (status !== '200') broken.push({ url, status });
    }
  });
  await Promise.all(workers);
  broken.sort((a, b) => a.url.localeCompare(b.url));

  if (broken.length) await sendAlert(env, urls.length, broken);

  return { ok: broken.length === 0, checked: urls.length, broken, source: SITEMAP_URL };
}

async function sendAlert(env: HealthEnv, total: number, broken: SitemapHealthResult['broken']): Promise<void> {
  const binding = env?.SEND_MAIL;
  const to = (env?.SITEMAP_ALERT_EMAIL || '').trim() || DEFAULT_ALERT_EMAIL;
  if (!binding) {
    // No email binding on this deployment — log loudly so the run is auditable
    // even though a mail cannot be sent.
    console.error(`[sitemap-health] ${broken.length}/${total} URLs broken; SEND_MAIL binding missing, alert NOT emailed to ${to}`);
    return;
  }
  const lines = broken.map((b) => `${b.status}  ${b.url}`).join('\n');
  const subject = `[Luxedge] Sitemap health alert: ${broken.length}/${total} URLs broken`;
  const text = `The nightly sitemap crawl found ${broken.length} of ${total} URLs not returning HTTP 200.\n\n${lines}\n\nSource: ${SITEMAP_URL}\nFix the broken URLs or remove them from the sitemap; the sitemap should only ever list canonical, indexable, HTTP-200 URLs.`;
  const html = `<p>The nightly sitemap crawl found <b>${broken.length} of ${total}</b> URLs not returning HTTP 200.</p><ul>${broken
    .map((b) => `<li><code>${b.status}</code> &nbsp; <a href="${b.url}">${b.url}</a></li>`)
    .join('')}</ul><p>Source: ${SITEMAP_URL}</p>`;
  try {
    await binding.send({
      from: 'sales@luxedge.us',
      to,
      subject,
      text,
      html,
    });
    console.error(`[sitemap-health] alert emailed to ${to}: ${broken.length}/${total} broken`);
  } catch (e) {
    console.error(`[sitemap-health] alert send failed to ${to}: ${e instanceof Error ? e.message : 'unknown error'}`);
  }
}