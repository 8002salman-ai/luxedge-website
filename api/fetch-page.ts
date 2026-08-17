// GET /api/fetch-page?url=...
//
// Credential-backed page fetching. When SCRAPE_DO_TOKEN is configured on the
// server, scraping goes through scrape.do from the server (token never ships
// to the browser). Falls back to the public Jina Reader when no token is set.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, sendText } from './_lib/providers';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  const url = new URL(req.url || '/', 'http://localhost').searchParams.get('url') || '';
  if (!/^https?:\/\//i.test(url) || url.length > 2048) {
    sendJson(res, 400, { error: 'A valid http(s) url parameter is required' });
    return;
  }

  const token = (process.env.SCRAPE_DO_TOKEN || '').trim();
  const targets: { label: string; url: string }[] = token
    ? [{ label: 'scrape.do', url: `https://api.scrape.do/?token=${encodeURIComponent(token)}&url=${encodeURIComponent(url)}&render=true&countryCode=US` }]
    : [{ label: 'Jina Reader', url: `https://r.jina.ai/${encodeURIComponent(url)}` }];

  let lastErr = 'no proxy available';
  for (const { label, url: proxyUrl } of targets) {
    try {
      const r = await fetch(proxyUrl, { signal: AbortSignal.timeout(40000), redirect: 'follow' });
      if (!r.ok) {
        lastErr = `${label}: HTTP ${r.status}`;
        continue;
      }
      const text = await r.text();
      if (text.trim().length < 100) {
        lastErr = `${label}: too little content`;
        continue;
      }
      sendText(res, 200, text);
      return;
    } catch (e) {
      lastErr = `${label}: ${(e as Error).message}`;
    }
  }
  sendJson(res, 502, { error: `Could not fetch page (${lastErr})` });
}
