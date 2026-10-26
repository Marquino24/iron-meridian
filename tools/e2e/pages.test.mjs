// The real site, as GitHub Pages serves it: every request to
// https://marquino24.github.io/iron-meridian/… is answered from this folder,
// while Supabase requests go to the real project. Checks the build works
// under /iron-meridian/, never offers demo sign-in, and that each provider
// button reaches Supabase with the right return address (stopping before the
// provider's own login page).
//   node tools/e2e/pages.test.mjs [screenshot-dir]
import { chromium } from 'playwright-core';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SITE = 'https://marquino24.github.io/iron-meridian/';
const SHOTS = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
let failures = 0;
const check = (cond, label) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) failures++; };
const errors = [];

async function sitePage(viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const served = [];
  // GitHub Pages: files from the repository root under /iron-meridian/, 404 otherwise.
  await ctx.route('https://marquino24.github.io/**', (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/iron-meridian/')) return route.fulfill({ status: 404, body: 'Not found' });
    let rel = decodeURIComponent(url.pathname.slice('/iron-meridian/'.length));
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const file = join(ROOT, rel);
    if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) return route.fulfill({ status: 404, body: 'Not found' });
    served.push(rel);
    return route.fulfill({ status: 200, contentType: TYPES[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) });
  });
  // Never actually open the providers' login pages.
  await ctx.route(/accounts\.google\.com|discord\.com|github\.com\/login|twitch\.tv/, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>provider login page</h1>' }));
  const page = await ctx.newPage();
  // Only errors on our own pages count (not the providers' login pages).
  page.on('pageerror', (e) => { if (page.url().startsWith(SITE)) errors.push(e.message); });
  return { ctx, page, served };
}

// 1. The site loads under /iron-meridian/ with real sign-in only.
{
  const { ctx, page, served } = await sitePage();
  await page.goto(SITE);
  await page.waitForSelector('.provider-btn', { timeout: 20000 });
  await page.waitForFunction(() => window.ironMeridian?.state.map, null, { timeout: 30000 });
  const labels = await page.$$eval('.provider-btn', (b) => b.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  check(labels.length === 4, `real site: ${labels.join(' | ')}`);
  const text = await page.textContent('body');
  check(!(await page.locator('[data-action="demo"]').count()) && !/DEMO SIGN-IN|Demo sign-in|DEMO DATA|\[Sample\]/.test(text), 'no demo sign-in, no DEMO DATA, no sample testers');
  check(await page.evaluate(() => typeof window.supabase?.createClient === 'function'), 'Supabase client loaded from vendor/');
  check(served.includes('vendor/supabase-js-2.117.3.js') && served.some((f) => f.startsWith('data/eras/')), `assets served from /iron-meridian/ (${served.length} files: era data, vendor, js, css)`);
  check(await page.evaluate(() => window.ironMeridian.state.map.provinces.length > 100), 'map data loaded behind the sign-in screen');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pages-1-signin.png` });

  // 2. Each provider: the browser goes to Supabase with the canonical return address, then on to the provider.
  for (const p of ['google', 'discord', 'github', 'twitch']) {
    await page.goto(`${SITE}index.html?era=ww2`);
    await page.waitForSelector(`[data-provider="${p}"]`, { timeout: 20000 });
    const auth = page.waitForRequest((r) => r.url().includes('/auth/v1/authorize'), { timeout: 15000 });
    await page.click(`[data-provider="${p}"]`);
    const req = new URL((await auth).url());
    await page.waitForURL((u) => !u.href.startsWith(SITE), { timeout: 15000 });
    const landed = new URL(page.url()).host;
    check(req.searchParams.get('provider') === p && req.searchParams.get('redirect_to') === SITE && req.searchParams.get('code_challenge'),
      `${p}: Supabase authorize (PKCE) → back to ${req.searchParams.get('redirect_to')} · provider page ${landed}`);
  }
  await ctx.close();
}

// 3. Phone, and the email note.
{
  const { ctx, page } = await sitePage({ width: 390, height: 844 });
  await page.goto(SITE);
  await page.waitForSelector('.magic-note', { timeout: 20000 });
  check(/Discord or Google/.test(await page.textContent('.magic-note')), 'email note shown on the real site');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pages-2-phone.png` });
  await ctx.close();
}

await browser.close();
check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
process.exit(failures ? 1 : 0);
