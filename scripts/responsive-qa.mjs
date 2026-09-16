// LUXEDGE — responsive / console QA runner.
//
// Drives a real Chrome over the DevTools Protocol (no new dependency: Node's
// global WebSocket and fetch are enough) and measures the app at the viewport
// widths the release gate names — 320, 375, 768 and 1440 — checking for the
// failures that actually hurt mobile users and reviewers:
//
//   * horizontal page overflow (content wider than the screen)
//   * clipped content with no scrollable rail (truncated without an ellipsis)
//   * missing or multiple visible H1s on a primary route
//   * console errors and uncaught exceptions during load and hydration
//   * a footer policy link covered by a floating widget after scrolling to it
//   * images rendered without alt text
//
// Usage:
//   node scripts/responsive-qa.mjs                       # local dev server :5173
//   node scripts/responsive-qa.mjs --site https://luxedge.us
//   node scripts/responsive-qa.mjs --routes /,/shop --widths 320,1440
//   node scripts/responsive-qa.mjs --json
//
// Exit code is non-zero when a hard failure is found, so it can gate a release.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const AS_JSON = args.includes('--json');
const SITE = flag('--site', 'http://localhost:5173').replace(/\/$/, '');
const ROUTES = flag('--routes', '/,/shop,/category/dog-supplies,/category/pet-toys,/blog,/blog/how-to-fit-no-pull-dog-harness,/about,/contact,/cart,/copyright').split(',');
const WIDTHS = flag('--widths', '320,375,768,1440').split(',').map(Number);
const PORT = Number(flag('--port', '9333'));

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const chromePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!chromePath) {
  console.error('No Chrome/Edge binary found. Set CHROME_PATH to a Chromium-based browser.');
  process.exit(2);
}

/** What runs inside the page. Returns a plain object per measurement. */
const MEASURE = `(async () => {
  const raf = () => new Promise((r) => setTimeout(r, 50));
  await raf();
  const de = document.documentElement;
  const vw = de.clientWidth;
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? r : null;
  };

  // Content wider than the viewport, split into deliberate horizontal rails and
  // genuinely clipped content.
  const clipped = [], rails = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = visible(el);
    if (!r || r.right <= vw + 1 || r.left >= vw || r.right <= 0) continue;
    // An element with no text and no replaced content cannot truncate anything
    // a reader would miss — a decorative blurred circle or an off-canvas drawer
    // deliberately parked past the edge is not a mobile defect. Real content
    // overflow still reports: text, img, svg, video and canvas all count.
    if (!el.textContent.trim() && !el.querySelector('img,svg,video,canvas,picture')) continue;
    const cls = (typeof el.className === 'string' ? el.className : '').split(/\\s+/).slice(0, 2).join('.');
    const label = el.tagName.toLowerCase() + (cls ? '.' + cls : '');
    let node = el.parentElement, rail = false;
    while (node) { const ox = getComputedStyle(node).overflowX; if (ox === 'auto' || ox === 'scroll') { rail = true; break; } node = node.parentElement; }
    if (rail) { rails.push(label); continue; }
    const cs = getComputedStyle(el);
    const selfClips = cs.overflowX === 'hidden' || cs.overflowX === 'clip' || cs.textOverflow === 'ellipsis';
    clipped.push(label + (selfClips ? '(self-clipped)' : '(no-ellipsis)'));
  }

  const h1 = [...document.querySelectorAll('h1')].filter((el) => visible(el)).map((el) => el.textContent.trim().slice(0, 56));
  const imgs = [...document.images].filter((i) => visible(i));
  // \`alt=""\` is the CORRECT treatment for a decorative image, and this app
  // renders every product card's hover duplicate that way (with aria-hidden).
  // Counting those as failures made this gate permanently red on the product
  // routes, which hides the real case it exists to catch: a content image with
  // no alt text at all.
  const decorativeImg = (i) => {
    if (i.getAttribute('aria-hidden') === 'true') return true;
    if (i.getAttribute('role') === 'presentation' || i.getAttribute('role') === 'none') return true;
    // An \`alt=""\` image inside a control that already carries the accessible
    // name is also correct: the product gallery's thumbnail sits in a
    // <button aria-label="View product photo N">, so naming the image again
    // would only make a screen reader repeat it.
    for (let n = i.parentElement; n && n !== document.body; n = n.parentElement) {
      if (n.tagName === 'BUTTON' || n.tagName === 'A') {
        if (n.getAttribute('aria-label') || n.textContent.trim()) return true;
      }
    }
    return false;
  };
  const imgNoAlt = imgs.filter((i) => !i.alt && !decorativeImg(i)).length;
  const widgets = [...document.querySelectorAll('body *')].filter((el) => {
    if (getComputedStyle(el).position !== 'fixed') return false;
    const r = visible(el);
    return r && r.right > 0 && r.left < vw && r.bottom > 0 && r.top < innerHeight && r.width <= 420 && r.height <= 420;
  }).length;

  // Covered policy links: scroll each footer legal link into view, then ask what
  // element actually receives a tap at its centre.
  const LEGAL = ['/privacy', '/terms', '/returns', '/shipping-policy', '/copyright', '/faq'];
  const legal = [...document.querySelectorAll('a')].filter((a) => LEGAL.includes(a.getAttribute('href') || ''));
  const covered = [];
  for (const a of legal) {
    a.scrollIntoView({ block: 'center' });
    await raf();
    const r = a.getBoundingClientRect();
    if (r.width === 0 || r.bottom < 0 || r.top > innerHeight) continue;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    // hit.contains(a) = the point landed on an ancestor (e.g. the paragraph a
    // multi-line inline link is written in, or the consent banner the link sits
    // inside). That is not occlusion, so it must not be reported as covered.
    if (hit && hit !== a && !a.contains(hit) && !hit.contains(a)) {
      // Find the floating thing responsible: a chat/WhatsApp widget over a
      // policy link is a real defect, while a dismissible cookie banner is
      // expected to sit there until the visitor chooses.
      let floating = null, node = hit;
      while (node && node !== document.body) {
        if (getComputedStyle(node).position === 'fixed') { floating = node; break; }
        node = node.parentElement;
      }
      const text = floating ? (floating.innerText || '').slice(0, 120) : (hit.innerText || '').slice(0, 120);
      const kind = /cookie|consent|privacy choices/i.test(text) ? 'consent-banner' : (floating ? 'floating-widget' : 'in-flow');
      const hcls = (typeof hit.className === 'string' ? hit.className : '').split(/\\s+/).slice(0, 2).join('.');
      // Include a snippet of the covering element: a failure that names only
      // "button.absolute.inset-0" cannot be acted on without knowing which one.
      const snippet = (hit.outerHTML || '').replace(/\\s+/g, ' ').slice(0, 110);
      covered.push(kind + ':' + a.getAttribute('href') + '<-' + hit.tagName.toLowerCase() + (hcls ? '.' + hcls : '') + ' [' + snippet + ']');
    }
  }

  // Header row geometry: the responsive header is where controls get pushed off
  // a narrow screen, and a control you cannot reach is a broken CTA.
  const hdr = document.querySelector('header');
  const headerChildren = hdr
    ? [...hdr.querySelectorAll(':scope > div > *')].map((el) => {
        const r = el.getBoundingClientRect();
        const cls = (typeof el.className === 'string' ? el.className : '').split(/\\s+/).slice(0, 2).join('.');
        return el.tagName.toLowerCase() + (cls ? '.' + cls : '') + '@' + Math.round(r.left) + '..' + Math.round(r.right);
      })
    : [];

  // Interactive controls that leave the viewport. One inside a fixed/transformed
  // panel is an off-canvas drawer (expected); one in normal flow is a lost CTA.
  const offscreen = [];
  for (const el of document.querySelectorAll('header button, header a[href], a[role="button"], button[role="button"]')) {
    const r = visible(el);
    if (!r) continue;
    const fully = r.left >= vw || r.right <= 0;
    const partial = !fully && r.right > vw + 1;
    if (!fully && !partial) continue;
    let node = el.parentElement, panel = false;
    while (node && node !== document.body) {
      const cs = getComputedStyle(node);
      if (cs.position === 'fixed' || cs.transform !== 'none') { panel = true; break; }
      node = node.parentElement;
    }
    const name = (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 28);
    offscreen.push((panel ? 'panel:' : 'LOST:') + name + '@' + Math.round(r.left) + '..' + Math.round(r.right));
  }

  return {
    width: vw,
    hOverflow: de.scrollWidth - vw,
    headerChildren,
    offscreen: [...new Set(offscreen)].slice(0, 6),
    clipped: [...new Set(clipped)].slice(0, 5),
    rails: [...new Set(rails)].slice(0, 3),
    h1, title: document.title,
    text: (document.body.innerText || '').replace(/\\s+/g, ' ').trim().length,
    images: imgs.length, imgNoAlt, widgets,
    legalLinks: legal.length, covered: [...new Set(covered)],
    viteOverlay: !!document.querySelector('vite-error-overlay'),
  };
})()`;

// ------------------------------------------------------------------ CDP plumbing
const cdp = (() => {
  let ws = null;
  let nextId = 1;
  const pending = new Map();
  const events = [];

  return {
    async connect(url) {
      ws = new WebSocket(url);
      await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true });
        ws.addEventListener('error', reject, { once: true });
      });
      ws.addEventListener('message', (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
          const { resolve, reject } = pending.get(msg.id);
          pending.delete(msg.id);
          msg.error ? reject(new Error(`${msg.error.message} (${msg.error.code})`)) : resolve(msg.result);
        } else if (msg.method) {
          events.push(msg);
        }
      });
    },
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
        setTimeout(() => {
          if (pending.has(id)) { pending.delete(id); reject(new Error(`${method} timed out`)); }
        }, 30000);
      });
    },
    drain() { const out = events.splice(0, events.length); return out; },
    close() { try { ws.close(); } catch { /* already closed */ } },
  };
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevTools(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error(`DevTools endpoint never answered: ${url}`);
}

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luxedge-qa-'));
const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profileDir}`,
  'about:blank',
], { stdio: 'ignore' });

const results = [];
let hardFailures = 0;

async function evaluate(expression) {
  const res = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || 'evaluation failed');
  return res.result.value;
}

try {
  await waitForDevTools(`http://127.0.0.1:${PORT}/json/version`);
  const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  await cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');

  for (const route of ROUTES) {
    for (const width of WIDTHS) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width, height: 900, deviceScaleFactor: 1, mobile: width < 768,
      });
      cdp.drain();
      await cdp.send('Page.navigate', { url: SITE + route });
      // Lazy route chunks (blog, cart, checkout) arrive after first paint, so
      // wait for the page's own H1 instead of guessing a fixed delay — a fixed
      // wait produced false "missing h1" failures on the lazy routes.
      for (let i = 0; i < 30; i++) {
        await sleep(200);
        try {
          const ready = await evaluate('document.readyState === "complete" && !!document.querySelector("h1")');
          if (ready) break;
        } catch { /* mid-navigation */ }
      }
      await sleep(400);

      let measured = null;
      try {
        measured = await evaluate(MEASURE);
      } catch (e) {
        measured = { error: e.message };
      }
      const events = cdp.drain();
      const consoleErrors = events
        .filter((e) => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')
        .map((e) => (e.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 160));
      const exceptions = events
        .filter((e) => e.method === 'Runtime.exceptionThrown')
        .map((e) => (e.params.exceptionDetails?.exception?.description || e.params.exceptionDetails?.text || '').split('\n')[0].slice(0, 160));
      const networkErrors = events
        .filter((e) => e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
        .map((e) => e.params.entry.text.slice(0, 160));

      const row = { route, ...measured, consoleErrors, exceptions, networkErrors };
      results.push(row);

      const hard = [];
      if (row.hOverflow > 0) hard.push(`horizontal overflow ${row.hOverflow}px`);
      if (row.clipped?.length) hard.push(`clipped: ${row.clipped.join(', ')}`);
      if (row.h1?.length !== 1) hard.push(`h1 count ${row.h1?.length ?? '?'}`);
      if (row.offscreen?.some((o) => o.startsWith('LOST:'))) hard.push(`off-screen control: ${row.offscreen.filter((o) => o.startsWith('LOST:')).join(', ')}`);
      const blocking = (row.covered || []).filter((c) => !c.startsWith('consent-banner:'));
      if (blocking.length) hard.push(`covered legal links: ${blocking.join(', ')}`);
      if (row.exceptions?.length) hard.push(`runtime exception: ${row.exceptions[0]}`);
      if (row.viteOverlay) hard.push('vite error overlay');
      if (row.imgNoAlt > 0) hard.push(`${row.imgNoAlt} image(s) without alt`);
      if (hard.length) hardFailures++;

      if (!AS_JSON) {
        console.log(`ROUTE ${route} @${width}px ${hard.length ? 'FAIL' : 'ok'}`);
        console.log(`  hOverflow=${row.hOverflow} clipped=${row.clipped?.length ?? 0}${row.clipped?.length ? ' [' + row.clipped.join(', ') + ']' : ''} rails=${row.rails?.length ?? 0} h1=${row.h1?.length ?? 0} text=${row.text} imgs=${row.images}(noalt=${row.imgNoAlt}) widgets=${row.widgets} legal=${row.legalLinks} covered=${row.covered?.length ?? 0} consoleErrors=${row.consoleErrors?.length ?? 0}`);
        if (row.offscreen?.length) console.log(`  offscreen: ${row.offscreen.join(', ')}`);
        if (row.covered?.length) console.log(`  covered: ${row.covered.join(', ')}`);
        console.log(`  header: ${(row.headerChildren || []).join(' | ')}`);
        for (const h of hard) console.log(`  !! ${h}`);
        if (row.consoleErrors?.length) console.log(`  console: ${row.consoleErrors.join(' | ')}`);
        if (row.networkErrors?.length) console.log(`  network: ${row.networkErrors.join(' | ')}`);
      }
    }
  }
} catch (e) {
  console.error(`QA run failed: ${e.message}`);
  hardFailures++;
} finally {
  cdp.close();
  chrome.kill();
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* windows lock */ }
}

if (AS_JSON) console.log(JSON.stringify({ site: SITE, routes: ROUTES, widths: WIDTHS, hardFailures, results }, null, 2));
else {
  console.log(`\n${ROUTES.length * WIDTHS.length} measurements · ${hardFailures} with hard failures`);
}
process.exitCode = hardFailures ? 1 : 0;
