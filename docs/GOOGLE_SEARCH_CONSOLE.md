# Google Search Console — luxedge.us setup (paste-token flow)

Goal: verify ownership, submit the sitemap, and let Google index all product /
blog / category pages (80 URLs). Free, takes ~10 minutes.

> **Current state (verified 2026-08-25):** GSC is NOT yet verified — there is no
> `google-site-verification` TXT record and no verification HTML file on the
> live site, so the sitemap has never been submitted. The site only has 2 of 80
> URLs indexed. Do Part 1 below first.

## Part 1 — Verify the site (pick ONE method)

### Method A — HTML file (automated, recommended)

1. Go to https://search.google.com/search-console → sign in with the same
   Google account as the business profile.
2. **Add property** → choose **URL prefix** → enter exactly
   `https://luxedge.us/`
3. Choose the **HTML file** verification option. Google shows a filename like
   `google1234567890abcdef.html` — copy it.
4. Run (or paste it to the agent who runs it):
   ```bash
   node scripts/gsc-setup.mjs html google1234567890abcdef.html --deploy
   ```
   This creates `public/<filename>` with the required content, rebuilds, and
   deploys to Cloudflare. Verify it is live:
   ```bash
   curl -s https://luxedge.us/google1234567890abcdef.html
   # → google-site-verification: google1234567890abcdef.html
   ```
5. Back in GSC click **Verify** — it fetches that URL and confirms instantly.

### Method B — DNS TXT (permanent, needs Cloudflare dashboard)

1. **Add property** → choose **Domain** → enter `luxedge.us` (covers www too).
2. Copy the TXT value Google shows (`google-site-verification=xxxxx`).
3. Run to print the exact record:
   ```bash
   node scripts/gsc-setup.mjs dns "google-site-verification=xxxxx"
   ```
4. Add it in the Cloudflare dashboard (DNS → Records → Add record → TXT,
   name `@`). Wait 2–5 min, check with `nslookup -type=TXT luxedge.us`, click
   **Verify**.

> Note: this machine's Cloudflare token has Workers permissions only, so the
> script prints the manual steps rather than adding the record itself.

## Part 2 — Submit the sitemap

1. In the GSC property → left sidebar **Sitemaps**.
2. Enter `sitemap.xml` (already live, **80 URLs** — 35 commerce-ready products,
   11 categories, 24 blogs, 10 static pages).
3. Click **Submit**. Google shows "Success" within a day or two.

## Part 3 — Request indexing for priority pages

Use **URL Inspection** → **Request Indexing** for (once per URL):

- `https://luxedge.us/`
- `https://luxedge.us/shop`
- Top 10 products (e.g. `/product/dog-bed`, `/product/outdoor-hanging-bird-feeder`,
  `/product/automatic-pet-feeder-*`)
- Top blogs (`/blog/best-bird-feeder-buyers-guide`,
  `/blog/dog-cooling-mat-buyers-guide`, …)

~10–20 requests/day max; the sitemap covers the rest. **The worker now serves
per-route server-side meta (unique title, description, canonical, JSON-LD) to
crawlers, so indexed pages will show correct titles and can get rich results.**

## Part 4 — What to check after indexing starts (2–7 days)

| Report | What to look for |
|---|---|
| Performance | Impressions/clicks per query; which pet keywords rank |
| Indexing → Pages | Products "Indexed"; fix "Discovered but not indexed" |
| Enhancements | Product / Breadcrumb rich results from the injected JSON-LD |

## Part 5 — After verification

1. **Bing Webmaster Tools** — bing.com/webmasters → import from Search Console,
   submit the same sitemap (free extra traffic).
2. **Google Business Profile link** — GSC → Settings → Associations → connect
   the GBP listing so it can surface product pages in local results.
3. Keep the sitemap fresh — `node scripts/regenerate-sitemap.mjs` regenerates
   it from the live catalog (run + build + deploy after catalog changes).

## Live SEO state (verified 2026-08-25, after the crawler-meta deploy)

- `https://luxedge.us/sitemap.xml` — HTTP 200, 80 URLs ✅
- `https://luxedge.us/robots.txt` — HTTP 200, sitemap referenced ✅
- Googlebot UA on `/product/*`, `/blog/*`, `/category/*` — unique server-side
  title + canonical + JSON-LD ✅ (real users unaffected)
- `https://luxedge.us/google-products.xml` — HTTP 200 (Merchant Center feed) ✅
