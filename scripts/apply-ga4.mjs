// Apply a GA4 Measurement ID to the live site with one command.
//
//   node scripts/apply-ga4.mjs G-XXXXXXXXXX            # update config only
//   node scripts/apply-ga4.mjs G-XXXXXXXXXX --deploy   # update + rebuild + deploy
//
// Where to get the ID: https://analytics.google.com → Admin → Data streams →
// your web stream → Measurement ID (looks like G-ABC123XYZ). One stream is
// enough for the whole site.
//
// The storefront already ships the GA4 loader (src/components/MarketingManager.tsx)
// and fires page_view on every route; it respects the visitor's cookie-consent
// choice. Setting gaEnabled + ga4Id here turns it on for ALL visitors after deploy.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const raw = (process.argv[2] || '').trim();
const wantDeploy = process.argv.includes('--deploy');

if (!/^G-[A-Z0-9]{4,}$/i.test(raw)) {
  console.error('Usage: node scripts/apply-ga4.mjs G-XXXXXXXXXX [--deploy]');
  console.error('The ID looks like G-ABC123XYZ — copy it from GA4 → Admin → Data streams → Measurement ID.');
  process.exit(1);
}

const cfgPath = path.join(root, 'public', 'site-config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
cfg.gaEnabled = true;
cfg.ga4Id = raw.toUpperCase();
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
console.log(`site-config.json updated → gaEnabled: true, ga4Id: ${cfg.ga4Id}`);

if (wantDeploy) {
  execSync('npm run build', { cwd: root, stdio: 'inherit' });
  execSync('npx wrangler deploy', {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  console.log(`Deployed. GA4 (${cfg.ga4Id}) will collect data once a visitor accepts the cookie banner.`);
} else {
  console.log('Config updated locally. Run with --deploy to build + deploy, or tell the agent to run it.');
}
