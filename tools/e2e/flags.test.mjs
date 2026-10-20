// Browser test of step 6C: real flags per era, heraldry for the rest.
//   python3 -m http.server 3000   (in the project root), then:
//   node tools/e2e/flags.test.mjs [screenshot-dir] [--mobile]
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000/';
const SHOTS = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const MOBILE = process.argv.includes('--mobile');
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errors = [];
let failures = 0;
const check = (cond, label) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) failures++; };
const tag = MOBILE ? 'phone' : 'desktop';
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${tag}-flags-${name}.png` }); };

const ctx = await browser.newContext(MOBILE
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  : { viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); });
const IM = (fn, arg) => page.evaluate(fn, arg);

/** Average colour of a horizontal band of a canvas (fractions of its height). */
const band = (sel, y0, y1) => IM(([sel, y0, y1]) => {
  const c = document.querySelector(sel);
  const g = c.getContext('2d');
  const d = g.getImageData(Math.round(c.width * 0.2), Math.round(c.height * y0), Math.round(c.width * 0.6), Math.max(1, Math.round(c.height * (y1 - y0)))).data;
  let r = 0, gg = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
  const n = d.length / 4;
  return [r / n, gg / n, b / n].map(Math.round);
}, [sel, y0, y1]);

async function openEra(era) {
  await page.click('[data-menu="single"]');
  await page.click(`[data-era="${era}"]`);
  await page.waitForSelector('#start-screen:not([hidden]) .nation-row');
  await page.waitForFunction(() => window.ironMeridian.state.map && window.ironMeridian.renderer, null);
  await page.waitForTimeout(1200);
}

await page.goto(`${BASE}?era=ww2`);
await page.waitForSelector('[data-action="demo"], #main-menu:not([hidden])');
if (await page.locator('[data-action="demo"]').count()) await page.click('[data-action="demo"]');
await page.waitForSelector('#main-menu:not([hidden])');

// --- WWII ---
await openEra('ww2');
const ww2 = await IM(() => {
  const ns = window.ironMeridian.state.nations;
  const by = (n) => ns.find((x) => x.name === n)?.flag;
  return { real: ns.filter((n) => n.flag.real != null).length, total: ns.length, reich: by('German Reich'), ussr: by('Soviet Union'), xinjiang: by('Xinjiang') };
});
check(ww2.real >= 100, `WWII: ${ww2.real}/${ww2.total} nations with a real flag`);
check(ww2.reich?.real != null && ww2.ussr?.real != null, 'German Reich and USSR have real flags');
check(ww2.xinjiang?.real == null, 'Xinjiang (no flag known) gets heraldry');
// Pick the German Reich and read its flag in the top bar of the nation card.
await page.click('[data-filter="all"]').catch(() => {});
await page.fill('#nation-search', 'German Reich');
await page.waitForTimeout(400);
await page.click('.nation-row');
await page.waitForTimeout(800);
await shot(page, 'ww2-select');
await page.click('#btn-deploy');
await page.waitForFunction(() => document.body.classList.contains('in-game'));
await IM(() => { window.ironMeridian.ai.enabled = false; window.ironMeridian.state.setSpeed(0); });
await page.waitForTimeout(1200);
// Black-white-red tricolour (no swastika): three clean horizontal bands.
const [top, mid, bot] = [await band('#player-flag', 0.06, 0.22), await band('#player-flag', 0.4, 0.6), await band('#player-flag', 0.8, 0.94)];
check(top.every((v) => v < 60), `Reich flag top band black ${top}`);
check(mid.every((v) => v > 200), `middle band white ${mid}`);
check(bot[0] > 170 && bot[1] < 60 && bot[2] < 60, `bottom band red ${bot}`);
// Army markers carry flags (sprites rebuilt once the sheet is in).
check(await IM(() => window.ironMeridian.renderer.fx.sprites.size > 0), 'army marker sprites drawn');
await shot(page, 'ww2-game');

// --- Modern ---
await page.click('#btn-menu');
await page.waitForSelector('#main-menu:not([hidden])');
await openEra('modern');
const modern = await IM(() => {
  const ns = window.ironMeridian.state.nations;
  return { real: ns.filter((n) => n.flag.real != null).length, total: ns.length, generated: ns.filter((n) => n.flag.real == null).map((n) => n.name) };
});
check(modern.real >= 195, `Modern: ${modern.real}/${modern.total} real flags (generated: ${modern.generated.join(', ')})`);
await page.click('.nation-row');
await page.waitForTimeout(800);
// The list's flags are drawn from the sheet: not the dark placeholder.
const listFlag = await IM(() => {
  const c = document.querySelector('.nation-row canvas.flag');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let placeholder = 0;
  for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 42) < 4 && Math.abs(d[i + 1] - 47) < 4 && Math.abs(d[i + 2] - 58) < 4) placeholder++;
  return placeholder / (d.length / 4);
});
check(listFlag < 0.2, `nation list flag is the real one (${(listFlag * 100).toFixed(0)}% placeholder pixels)`);
await shot(page, 'modern-select');

// --- Rome: SPQR banner, heraldry elsewhere ---
await page.click('#start-screen [data-back]');
await page.waitForSelector('#era-screen:not([hidden])');
await page.click('[data-era="rome"]');
await page.waitForSelector('#start-screen:not([hidden]) .nation-row');
await page.waitForTimeout(800);
const rome = await IM(() => { const ns = window.ironMeridian.state.nations; return { rome: ns.find((n) => n.name === 'Roman Empire').flag.real, han: ns.find((n) => n.name === 'Han Empire').flag.real, others: ns.filter((n) => n.flag.real == null).length }; });
check(rome.rome != null && rome.han != null && rome.others > 20, `Rome: SPQR and Han banners, ${rome.others} heraldic shields`);
await page.click('[data-filter="all"]').catch(() => {});
await page.waitForTimeout(500);
await shot(page, 'rome-select');

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
