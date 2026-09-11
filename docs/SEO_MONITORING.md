# Read-only SEO monitoring

`scripts/seo-monitor.mjs` makes public `GET` requests to the live sitemap,
each listed URL, and `robots.txt`. It prints one JSON report to stdout. It
checks HTTP status, self-canonical tags, `noindex`, and whether robots
references the exact sitemap URL.

It never reads credentials, calls authenticated APIs, submits URLs, changes
Search Console, or writes to the repository, database, deployment, or site.

Run it locally:

```powershell
node scripts/seo-monitor.mjs --json
node scripts/seo-monitor.mjs --site https://luxedge.us --json
```

## Scheduled GitHub Action (default)

The daily monitor runs as a scheduled GitHub Action
(`.github/workflows/seo-monitor.yml`) — no local machine, no n8n, nothing to
keep running. It replaces the previous local-n8n workflow
(`n8n/luxedge-seo-daily-monitor.json`, removed) so monitoring cannot silently
lapse when a local instance is off or unconfigured.

What it does every day at **07:00 UTC** (and on manual dispatch via
**Actions → SEO monitor (daily) → Run workflow**):

1. Runs `node scripts/seo-monitor.mjs --site https://luxedge.us` and saves the
   JSON report as a `seo-report` artifact (uploaded on every run, pass or
   fail, so the report is always inspectable).
2. Files a GitHub issue when the report alerts. Alerts are deduplicated with
   the `seo-monitor` label:
   - no open alert issue → a new issue is created with the failing URLs and
     their issues;
   - an alert issue is already open → the new failure is appended as a
     comment (repeated daily failures never spam the tracker);
   - the site recovers (report clean while an alert issue is open) → the
     issue is closed with a recovery note.

The Action needs no secrets: it uses the built-in `GITHUB_TOKEN` with
`issues: write` permission only. The monitor itself stays read-only.

### Managing the schedule

- **Change the time/frequency**: edit the `cron` line in
  `.github/workflows/seo-monitor.yml` (cron is UTC).
- **Run once now**: Actions → SEO monitor (daily) → **Run workflow**.
- **Disable temporarily**: add a `#` before the `schedule:` block (or set the
  workflow to disabled in the Actions UI). Keep the `workflow_dispatch`
  trigger so it can still be run manually.

### Adding alert delivery beyond issues

The Action files GitHub issues only. If email/Slack delivery is wanted later,
add a step that posts the report (e.g. a Slack webhook or an SMTP sender)
after the monitor step — the report JSON is already on disk at that point.

## Optional: Search Console reporting

The old n8n workflow had a disabled Search Console reporting node. It was not
carried over. If Search Console read-only metrics are wanted, add a separate
action (or a second job) using a Google OAuth credential stored as GitHub
secrets — the monitor script itself has no GSC integration and should stay
read-only.