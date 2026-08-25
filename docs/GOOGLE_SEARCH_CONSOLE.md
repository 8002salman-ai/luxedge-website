# Google Search Console — luxedge.us setup (step by step)

Goal: verify you own the site, submit the sitemap, and let Google index the
product/category/blog pages. Free, no code changes required.

## Part 1 — Add & verify the property

1. Go to https://search.google.com/search-console and sign in with the Google
   account that owns the business (use the same account as Google Business
   Profile so data links later).
2. Click **Add property** → choose the **Domain** type.
3. Enter `luxedge.us` (domain type covers `www.luxedge.us` and all subdomains
   automatically — one property, not two).
4. Verification options Google offers for a domain property:
   - **DNS TXT record** (recommended, most durable). Google gives you a TXT
     value like `google-site-verification=xxxxx`.
   - Add it at your DNS provider (Cloudflare dashboard → **DNS → Records →
     Add record** → type `TXT`, name `@`, content = the Google value).
   - Wait a few minutes for propagation (check with
     `nslookup -type=TXT luxedge.us`), then click **Verify**.
   - (Alternative) **HTML file** method: upload the `googleXXXX.html` file to
     the repo `public/` folder, deploy to the worker, then verify — but the DNS
     TXT method is simpler and permanent.
5. Verification is instant once the TXT record resolves. Remove the TXT record
   later only if you must (leaving it is harmless).

## Part 2 — Submit the sitemap

1. In Search Console, open the property → left sidebar **Sitemaps**.
2. In the **Add a new sitemap** box enter: `sitemap.xml`
   (full URL becomes `https://luxedge.us/sitemap.xml` — already live, 56 URLs).
3. Click **Submit**. Within a day or two Google shows "Success" with the URL
   count (currently 56: 17 commerce-ready products, 11 categories, 18 blogs,
   10 static pages).
4. Also submit the product feed later (Merchant Center), not Search Console.

## Part 3 — What to check after indexing starts (2–7 days)

| Report | What to look for |
|---|---|
| **Performance** | Impressions/clicks per query; shows which pet keywords actually rank |
| **Indexing → Pages** | Products with "Indexed" status; fix any "Discovered but not indexed" |
| **URL Inspection** | Paste a product URL → **Request Indexing** for the top products |
| **Enhancements** | Product/Breadcrumb rich results from the JSON-LD already on pages |

## Part 4 — Request indexing for priority pages

Once verified, use **URL Inspection** to request indexing for:

- `https://luxedge.us/` (homepage)
- `https://luxedge.us/shop`
- All 18 blog posts (`/blog/<slug>`)
- The 17 commerce-ready product pages (slug URLs — see `docs/PRODUCT_SEO_REPORT.md`)

You can request ~10–20 URLs/day manually; Google discovers the rest from the
sitemap. This only needs doing once per URL.

## Part 5 — After verification (do these too)

1. **Bing Webmaster Tools** (bing.com/webmasters) — import from Search Console
   (one click), submit the same sitemap. Free extra traffic.
2. **Link to Google Business Profile** — in Search Console → **Settings →
   Associations**, connect the GMB listing. This lets GMB show which pages are
   indexed and can surface product pages in local results.
3. Keep the sitemap fresh — the Salman OS SEO bridge regenerates it weekly
   (`node scripts/salman-seo.mjs sitemap`), so no manual updates needed.

## Current live SEO state (verified 2026-08-25)

- `https://luxedge.us/sitemap.xml` — HTTP 200, 56 URLs ✅
- `https://luxedge.us/robots.txt` — HTTP 200, sitemap referenced, Googlebot allowed ✅
- Product pages: slug URLs + canonical + Product/Breadcrumb JSON-LD ✅
- `https://luxedge.us/google-products.xml` — HTTP 200 (Merchant Center feed, 17 items) ✅
