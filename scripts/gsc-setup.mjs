// Google Search Console verification helper for luxedge.us.
//
//   node scripts/gsc-setup.mjs html <googleXXXX.html> [--deploy]   ← automated
//   node scripts/gsc-setup.mjs dns "<google-site-verification=...>" ← prints DNS steps
//
// HTML method (recommended — fully automated, no DNS access needed):
//   1. https://search.google.com/search-console → Add property → URL prefix
//      → enter https://luxedge.us/
//   2. Choose the HTML file verification option → GSC shows a filename like
//      google1234567890abcdef.html (its content is always
//      "google-site-verification: google1234567890abcdef.html").
//   3. Run this script with that filename. With --deploy it rebuilds and
//      deploys so the file is live, then you click Verify in GSC — instant.
//
// DNS method (permanent, but needs Cloudflare dashboard access):
//   1. GSC → Add property → Domain → luxedge.us → copy the TXT value.
//   2. Run: node scripts/gsc-setup.mjs dns "google-site-verification=XXXX"
//      to print the exact Cloudflare DNS record to add (this machine's
//      Cloudflare token has no DNS permissions, so it cannot add it for you).
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const mode = (process.argv[2] || '').toLowerCase();
const value = (process.argv[3] || '').trim();
const wantDeploy = process.argv.includes('--deploy');

if (mode === 'html') {
  if (!/^google[0-9a-z]+\.html$/i.test(value)) {
    console.error('Usage: node scripts/gsc-setup.mjs html <googleXXXX.html> [--deploy]');
    console.error('Copy the exact filename GSC shows under "HTML file" verification — it starts with google and ends with .html.');
    process.exit(1);
  }
  const content = `google-site-verification: ${value}\n`;
  const outPath = path.join(root, 'public', value);
  fs.writeFileSync(outPath, content);
  console.log(`Created public/${value} → "google-site-verification: ${value}"`);
  if (wantDeploy) {
    execSync('npm run build', { cwd: root, stdio: 'inherit' });
    execSync('npx wrangler deploy', {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    });
    console.log(`Deployed. Now open GSC and click Verify — it fetches https://luxedge.us/${value} and confirms instantly.`);
  } else {
    console.log('File ready. Run with --deploy to build + deploy, or tell the agent to run it.');
  }
} else if (mode === 'dns') {
  if (!value.startsWith('google-site-verification=')) {
    console.error('Usage: node scripts/gsc-setup.mjs dns "<google-site-verification=...>"');
    console.error('In GSC → Add property → Domain → luxedge.us, copy the TXT value it gives you and paste it here.');
    process.exit(1);
  }
  console.log('\nAdd this record in the Cloudflare dashboard (dash.cloudflare.com → luxedge.us → DNS → Records → Add record):');
  console.log('  Type:    TXT');
  console.log('  Name:    @');
  console.log('  Content: ' + value);
  console.log('  TTL:     Auto');
  console.log('\nThen wait 2–5 minutes for propagation and click Verify in GSC.');
  console.log('Verify propagation with:  nslookup -type=TXT luxedge.us');
} else {
  console.error('Usage:');
  console.error('  node scripts/gsc-setup.mjs html <googleXXXX.html> [--deploy]    ← automated verification');
  console.error('  node scripts/gsc-setup.mjs dns "<google-site-verification=...>" ← prints manual DNS steps');
  process.exit(1);
}
