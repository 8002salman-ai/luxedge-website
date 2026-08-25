# Luxedge × Salman OS — SEO Bridge

This is the **execution half** of the SEO bridge. Salman OS / Hermes stays
**research-only** (per the frozen `LUXEDGE_AI_CONTRACT.md` — it must never edit
files, run git, or deploy). This repo side is the deterministic executor that
applies that research to the real catalog.

```
Hermes (research only)                     Luxedge repo (execution)
─────────────────────────────              ─────────────────────────
keyword_research / seo_research   ──JSON──▶ scripts/salman-seo.mjs
  (structured findings)                        │  audit / keywords / sitemap / verify
                                               ▼
                                   Supabase (products) → sitemap.xml → git → deploy
```

No AI is needed to apply the research: the engine is deterministic, factual,
and only ever writes the exact fields provided.

---

## 1. What the engine does

| Command | What it does |
|---|---|
| `node scripts/salman-seo.mjs audit` | Pulls every ACTIVE product and reports SEO gaps (missing/short/long title, missing/thin meta description, missing/short keywords, no images, no delivery estimate, no supplier ref). Output is Hermes-style structured JSON (`findings` + `summary`), stamped `source: live_production`. |
| `node scripts/salman-seo.mjs keywords --file k.json` | Bulk-applies `seo_keywords` / `seo_title` / `seo_description` to ACTIVE products matched by `slug` (or by name substring). Only provided fields are written. |
| `node scripts/salman-seo.mjs sitemap` | Regenerates `public/sitemap.xml` from the live catalog (commerce-ready products only). |
| `node scripts/salman-seo.mjs verify` | Live HTTP checks of `/`, `/shop`, `/blog`, `/sitemap.xml`, `/robots.txt`, `/google-products.xml` + one sample product page. |

k.json shape (exactly what a Hermes `keyword_research` task should output):

```json
[
  {
    "slug": "cooling-pet-mat-ice-silk",
    "keywords": ["dog cooling mat", "cooling pad for dogs", "ice silk pet mat"],
    "focusKeyword": "dog cooling mat",
    "title": "Dog Cooling Mat — Ice Silk Pad for Summer (≤60 chars)",
    "description": "… (≤160 chars)"
  }
]
```

Requires `.env` with `VITE_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (already
present in this repo; the key never leaves the server machine).

---

## 2. Full prompt for Salman OS (Hermes / agent task)

Paste this as a Hermes `seo_research` / `keyword_research` task, or as an n8n
agent instruction:

> You are the Luxedge SEO researcher (project: luxedge.us, a US pet-essentials
> store: dog, cat, bird, horse, cattle/livestock supplies).
>
> RESEARCH ONLY. You have zero write access — you produce structured JSON that
> a separate executor applies. Never attempt shell, git, file edits, or deploys.
>
> Each cycle (run now, then weekly):
> 1. **Keyword research** — for the focus areas below, find real search demand
>    keywords (US English, long-tail where possible). Use public keyword tools
>    and competitor sites (Chewy, Petco, Amazon) as evidence. 5–8 keywords per
>    product, one focus keyword each.
>    Focus areas: dog travel & cooling, cat enrichment, bird feeders/seeds,
>    horse grooming, livestock feeding.
> 2. **On-page review** — check the live catalog snapshot for: missing/short
>    meta descriptions, titles over 60 chars, products with no keywords, thin
>    descriptions under 80 chars. Report each as a finding with the product
>    slug and the exact fix.
> 3. **Content ideas** — 1 blog topic per week per major category (buyer-guide
>    style, 800+ words) with 3–5 internal links to specific products (use their
>    slugs).
> 4. **Output** — strict JSON only:
>    ```json
>    {
>      "generated_at": "ISO",
>      "keywords": [ { "slug": "...", "keywords": [...], "focusKeyword": "...",
>                      "title": "...", "description": "..." } ],
>      "findings": [ { "severity": "high|medium|low", "entity": "slug-or-page",
>                      "issue": "...", "evidence": "..." } ],
>      "blog_ideas": [ { "title": "...", "slug": "...", "category": "...",
>                        "internal_links": ["slug1","slug2"] } ]
>    }
>    ```
> 5. **Rules**: real data only — no fake reviews, ratings, GTIN, brand, or
>    availability claims. Titles ≤60 chars, descriptions ≤160 chars, natural
>    language. Payment is not live: never suggest "secure checkout" claims.
>
> After output, stop. The executor applies it and reports back.

---

## 3. n8n workflow (weekly automation)

1. **Schedule** — Cron trigger, weekly (e.g. Monday 08:00).
2. **Research** — Call Salman OS `POST /api/projects/luxedge/jobs/run` with
   `{ "module": "seo_research", "environment": "production" }` (or run Hermes
   locally with the prompt above). Get the JSON result.
3. **Prepare** — Map the `keywords` array to a `k.json` file.
4. **Execute** — On this machine (the repo checkout):
   ```bash
   cd C:\Users\basco\Downloads\luxedge-website
   node scripts/salman-seo.mjs keywords --file k.json
   node scripts/salman-seo.mjs sitemap
   git add -A && git commit -m "SEO: apply researched keywords (weekly cycle)"
   git push origin main
   WRANGLER_SEND_METRICS=false npx wrangler deploy --name luxedge-production
   node scripts/salman-seo.mjs verify
   ```
5. **Notify** — Send the audit summary (high/medium counts) + verify status to
   Telegram: `/luxedge run seo` → summary. Only alert on regressions, not every
   run (per contract §12: one concise daily brief, no repeated noise).
6. **Blog** — When a blog idea is approved, create the post in the storefront
   (`src/App.tsx` BLOGS array), add its URL to `scripts/regenerate-sitemap.mjs`
   blogSlugs, regenerate the sitemap, then commit + deploy.

If the bridge cannot run git/deploy yet (read-only phase), the workflow stops
after producing `k.json` + the audit report and requests owner approval — never
silently skipping.

---

## 4. Manual quick start

```bash
# 1. See current gaps
node scripts/salman-seo.mjs audit

# 2. Apply keywords (file from Hermes research or hand-written)
node scripts/salman-seo.mjs keywords --file .freebuff/keywords-bird-horse-cattle.json

# 3. Regenerate sitemap + verify live
node scripts/salman-seo.mjs sitemap
node scripts/salman-seo.mjs verify
```

---

## 5. What this deliberately does NOT do

- Hermes stays read-only — no repo edits, no git, no deploy from the agent.
- No fake SEO data — keywords/titles must be researched, not invented.
- No paid traffic, no ad spend, no "secure checkout" claims (payment is not live).
- Sitemap/feed never include DRAFT or SOURCE_PENDING products.
