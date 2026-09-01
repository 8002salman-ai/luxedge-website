# AdSense — account setup & where to look (luxedge.us)

> **Identities (target, 2026-08-31):**
> - AdSense publisher/account owner = **basco.pk@gmail.com**
> - Google Cloud project / OAuth client owner = **8002salman@gmail.com** (dev identity)
> - OAuth consent for the AdSense API must be granted by **basco.pk@gmail.com**
>   (the account that has access to the AdSense account).
> - Luxedge code is email-agnostic — it uses OAuth/account IDs, never hardcoded Gmail.
>

> **Site side is already done (verified 2026-08-25):** the `adsbygoogle.js`
> script (`ca-pub-5473713135927706`), the `google-adsense-account` ownership
> meta tag, `/ads.txt`, and auto-ads config are all live and correct. The only
> missing piece is the AdSense **account** side below — Google currently returns
> **no ads** (`data-ad-status="unfilled"` on every page), which almost always
> means the account/site has not been approved yet.

## 1. Sign in / create the account

1. Go to **https://adsense.google.com/start/** and sign in with the Google
   account that OWNS the AdSense publisher (the AdSense account is
   `basco.pk@gmail.com`). The Google Cloud project / OAuth client (the
   developer identity, `8002salman@gmail.com`) is a DIFFERENT, separate
   Google identity — keep them distinct:
2. If you have never created an AdSense account:
   - Enter the site URL: **luxedge.us**
   - Pick a country (US) and agree to the terms.
   - You will be asked to add a snippet — **skip this**, Luxedge already has
     the ownership meta tag (`google-adsense-account`) live, so Google will
     detect the site automatically and verification passes instantly.
   - **Review starts automatically** — typical wait is 1–2 weeks.

## 2. Where to see approval status

- **Home / dashboard:** the top banner card shows the account state:
  - `Getting ready` → **under review** (normal; wait 1–2 weeks)
  - `Active` → **approved** — ads can now fill
  - `Needs attention` / action required → read the listed item
- **Sites tab** (left menu → **Sites**): each added site shows its own status:
  - `Getting ready` → site under review
  - `Active` → approved and eligible to show ads
  - `Needs attention` → click it for the specific fix

## 3. Add luxedge.us to the account (if not listed)

1. Left menu → **Sites**.
2. Click **+ Add site** (blue button, top right).
3. Enter **https://luxedge.us/** and click **Add**.
4. It may ask to verify ownership — click **Verify**. Because the
   `google-adsense-account` meta tag is already live on the site, verification
   completes automatically (no new code needed).
5. Submit the site for review if prompted. Status becomes `Getting ready`.

## 4. Turn on Auto ads (recommended for this storefront)

1. Left menu → **Ads** → **Auto ads** (or the "Auto ads" card on Home).
2. Select the **luxedge.us** site.
3. Toggle **Auto ads ON**.
4. Keep the default ad formats (Overlay, In-article, In-feed, Matched content
   are fine). You can preview with the blue "Preview" button before saving.
   The site config (`public/site-config.json`) already has
   `autoAdsEnabled: true` + `density: balanced` + mobile enabled, so nothing
   else to change on our side.

## 5. Where to find earnings

- **Earnings tab** (left menu → **Earnings**): the top card shows
  **estimated earnings** for Today / 7 days / 30 days / lifetime.
- **Reports** (left menu → **Reports**): detailed charts — filter by date,
  platform (web), country, page. Use this to see which pages earn.
- **Payments tab** (left menu → **Payments**):
  - Set up or confirm the **payment method** (bank account).
  - Complete **tax information** (W-9 for US / W-8BEN for non-US) — AdSense
    won't pay until this is done.
  - Verify your **PIN** (Google mails a PIN to your address after you pass
    ~$10; enter it in Payments → PIN verification).
  - Payment threshold: Google pays when you cross **$100** (US).
- **Home dashboard**: also shows a small earnings summary card.

## 6. What to expect

- **Before approval:** $0.00 — Google returns no ads (unfilled frames), which
  matches what we measured live on 2026-08-25.
- **After approval + traffic:** revenue = impressions × RPM. Pet niche RPM is
  roughly **$5–15 per 1,000 impressions**. With ~1,000 sessions/month expect
  single-digit dollars; with 5,000+ sessions/month expect tens of dollars.
  Real income comes from product sales, not ads.
- **After approval, if ads STILL show unfilled:** re-check (a) Auto ads ON for
  this site, (b) site status = Active, (c) enough content/traffic — then tell
  the agent to re-test the live pages.
