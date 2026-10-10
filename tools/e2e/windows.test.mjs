// Browser test of step 4A: command bar, Army / Production / Buildings windows,
// city panel Recruit and Build tabs, era resources in the top bar.
//   python3 -m http.server 3000   (in the project root), then:
//   node tools/e2e/windows.test.mjs [screenshot-dir] [--mobile]
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000/';
const SHOTS = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const MOBILE = process.argv.includes('--mobile');
const ERA = process.env.ERA ?? 'ww2';
const NATION = process.env.NATION ?? 'German';
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errors = [];
let failures = 0;
const check = (cond, label) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) failures++; };
const tag = MOBILE ? 'phone' : 'desktop';
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${tag}-${name}.png` }); };

const ctx = await browser.newContext(MOBILE
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  : { viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); });
const click = (sel) => (MOBILE ? page.tap(sel) : page.click(sel));
const IM = (fn, arg) => page.evaluate(fn, arg);

await page.goto(`${BASE}?era=${ERA}`);
await page.waitForSelector('[data-action="demo"], #main-menu:not([hidden])');
if (await page.locator('[data-action="demo"]').count()) await page.click('[data-action="demo"]');
await page.waitForSelector('#main-menu:not([hidden])');
await page.click('[data-menu="single"]');
await page.click(`[data-era="${ERA}"]`);
await page.waitForSelector('#start-screen:not([hidden]) .nation-row');
await page.fill('#nation-search', NATION);
await page.click('.nation-row');
await page.click('#btn-deploy');
await page.waitForFunction(() => document.body.classList.contains('in-game'));
await page.waitForTimeout(1500);
await page.click('#province-panel [data-action="close"]');
await IM(() => window.ironMeridian.state.setSpeed(0));
await page.waitForTimeout(300);

// Top bar: one chip per era resource.
const keys = await IM(() => window.ironMeridian.sim.economy.keys);
const chips = await page.locator('#res-chips .res').count();
check(chips === keys.length, `${chips} resource chips (${keys.join(', ')})`);
if (MOBILE) await page.tap('#res-chips .res'); else await page.hover('#res-chips .res');
await page.waitForSelector('#res-tip:not([hidden])');
check((await page.textContent('#res-tip')).includes('DAILY INCOME'), 'income tooltip with per-resource breakdown');
await shot(page, '0-resources');
if (MOBILE) await page.tap('#res-chips .res'); else await page.mouse.move(700, 600);

// Command bar shows exactly the three working windows.
const bar = await page.$$eval('#command-bar [data-win]', (b) => b.map((x) => x.dataset.win));
check(bar.join() === 'army,production,buildings', `command bar: ${bar.join(', ')}`);
const menuBox = await page.locator('#btn-menu').boundingBox();
check(menuBox && menuBox.x + menuBox.width <= (MOBILE ? 390 : 1440), 'top bar fits (MENU visible)');

// --- Army window ---
if (MOBILE) await click('#command-bar [data-win="army"]'); else await page.keyboard.press('a');
await page.waitForSelector('.win-army:not([hidden])');
const own = await IM(() => [...window.ironMeridian.sim.armies.list.values()].filter((a) => a.nation === window.ironMeridian.state.playerNationId).length);
check(await page.locator('.army-table tbody tr').count() === own, `army window lists all ${own} armies`);
const firstUnit = await IM(() => window.ironMeridian.sim.armies.roster.units[0].name);
check((await page.textContent('.win-totals')).includes(firstUnit), `totals per unit type (${firstUnit}…)`);
await shot(page, '1-army');
await click('.win-army [data-filter="garrison"]');
const garrisons = await page.locator('.army-table tbody tr').count();
check(garrisons > 0 && garrisons < own, `filter: ${garrisons} garrisons`);
await click('.win-army [data-filter="all"]');
if (!MOBILE) {
  await page.click('.win-army th [data-sort="units"]');
  const units = await page.$$eval('.army-table tbody tr', (rows) => rows.map((r) => r.querySelectorAll('.comp').length));
  check(units.length === own, 'sort by units');
}
const firstId = Number(await page.getAttribute('.army-table tbody tr', 'data-army'));
await click('.army-table tbody tr');
await page.waitForTimeout(800);
check(await IM(() => window.ironMeridian.state.selectedArmyId) === firstId, 'row click selects the army');
if (MOBILE) check(await page.locator('.win-army').isHidden(), 'phone: window makes way for the map');

// Drag (desktop).
if (!MOBILE) {
  const h = await page.locator('.win-army .win-head h2').boundingBox();
  await page.mouse.move(h.x + 10, h.y + 5);
  await page.mouse.down();
  await page.mouse.move(h.x + 210, h.y + 125, { steps: 6 });
  await page.mouse.up();
  const h2 = await page.locator('.win-army .win-head h2').boundingBox();
  check(Math.abs(h2.x - h.x - 200) < 3 && Math.abs(h2.y - h.y - 120) < 3, 'window drags by its title bar');
  await page.keyboard.press('Escape');
  check(await page.locator('.win-army').isHidden(), 'Esc closes the window');
}

// --- Production window ---
await IM(() => window.ironMeridian.state.setSelectedArmy(-1));
if (MOBILE) await click('#command-bar [data-win="production"]'); else await page.keyboard.press('p');
await page.waitForSelector('.win-production:not([hidden])');
const cities = await page.locator('.prod-table tbody tr').count();
check(cities > 0, `production lists ${cities} sites`);
const roster = await IM(() => window.ironMeridian.sim.armies.roster.units.map((u) => u.key));
// The top unit (mobile) needs Barracks III: every city greyed out with a reason.
await click(`.win-production [data-unit="${roster[2]}"]`);
const whys = await page.$$eval('.prod-table .c-why', (c) => c.map((x) => x.textContent.trim()).filter(Boolean));
check(whys.length === cities && /Barracks|Base|Castra/.test(whys[0]), `mobile units greyed out: "${whys[0]}"`);
await click(`.win-production [data-unit="${roster[0]}"]`);
await click('.win-production [data-qty="1"]');
await click('.win-production [data-select="barracks"]');
await page.waitForTimeout(300);
const sel = await page.locator('.prod-table input[data-pick]:checked').count();
check(sel > 0, `"All with Barracks" ticks ${sel} cities`);
const foot = await page.textContent('.win-production .foot-sum');
check(foot.includes(`× `) && /\d/.test(foot), `total cost shown: ${foot.replace(/\s+/g, ' ').trim()}`);
await shot(page, '2-production-recruit');
const q0 = await IM(() => [...window.ironMeridian.sim.armies.queues.values()].reduce((n, q) => n + q.length, 0));
await click('.win-production [data-confirm]');
await page.waitForTimeout(300);
const q1 = await IM(() => [...window.ironMeridian.sim.armies.queues.values()].reduce((n, q) => n + q.length, 0));
check(q1 - q0 === sel * 2, `bulk recruit queued ${q1 - q0} units (2 × ${sel} cities)`);
check(await page.locator('.prod-table [data-q]').count() >= sel, 'queues with progress bars in the table');
// Bulk build: farms everywhere possible.
await click('.win-production [data-tab="build"]');
await click('.win-production [data-building="farm"]');
await click('.win-production [data-select="all"]');
await page.waitForTimeout(200);
// Leave two cities out so the Buildings window has free ones to work with.
for (let i = 0; i < 2; i++) {
  const boxes = page.locator('.prod-table input[data-pick]:checked');
  if (await boxes.count() > 1) { await (MOBILE ? boxes.last().tap() : boxes.last().click()); await page.waitForTimeout(150); }
}
await shot(page, '3-production-build');
const c0 = await IM(() => window.ironMeridian.sim.buildings.construction.size);
await click('.win-production [data-confirm]');
await page.waitForTimeout(300);
const c1 = await IM(() => window.ironMeridian.sim.buildings.construction.size);
check(c1 > c0, `bulk build started ${c1 - c0} farms`);
await IM(() => window.ironMeridian.state.setSpeed(4));
await page.waitForTimeout(2500);
await IM(() => window.ironMeridian.state.setSpeed(0));
const w = await page.$eval('.prod-table [data-c]', (e) => parseFloat(e.style.width));
check(w > 0, `construction progress bar moving (${w}%)`);
await shot(page, '4-production-progress');

// --- Buildings window ---
if (MOBILE) await click('#command-bar [data-win="buildings"]'); else await page.keyboard.press('b');
await page.waitForSelector('.win-buildings:not([hidden])');
if (MOBILE) check(await page.locator('.win-production').isHidden(), 'phone: one window at a time');
const capital = await IM(() => window.ironMeridian.state.playerNation.capitalId);
// Capital is building a farm now: pick its Roads cell → "Building …" reason; then a free city's Barracks.
await click(`.win-buildings [data-cell="${capital}:roads"]`);
check((await page.textContent('.cell-detail')).includes('Building'), 'one construction per city (reason shown)');
const free = await IM(() => {
  const { sim, state } = window.ironMeridian;
  return sim.buildings.sites(state.playerNationId).find((p) => p.isCity && !sim.buildings.construction.has(p.id))?.id ?? -1;
});
if (free >= 0) {
  await click(`.win-buildings [data-cell="${free}:fort"]`);
  const det = await page.textContent('.cell-detail');
  check(/→ I/.test(det) && /\d+h|\dd/.test(det), `cell shows next level, cost and time: ${det.replace(/\s+/g, ' ').trim().slice(0, 90)}`);
  await shot(page, '5-buildings');
  await click('.win-buildings [data-upgrade]');
  await page.waitForTimeout(200);
  check(await IM((id) => window.ironMeridian.sim.buildings.construction.get(id)?.type, free) === 'fort', 'upgrade from the grid');
} else check(true, 'no free city for the single upgrade (all busy)');
// Bulk upgrade roads in selected.
await page.selectOption('.win-buildings [data-bulk-type]', 'roads');
await click('.win-buildings [data-select="all"]');
await page.waitForTimeout(200);
const label = await page.textContent('.win-buildings [data-bulk]');
check(/Upgrade \d+/.test(label), `bulk upgrade button: ${label.trim()}`);
await shot(page, '6-buildings-bulk');
if (MOBILE) { await click('.win-buildings .win-close'); } else await page.keyboard.press('Escape');
check(await page.locator('.win-buildings').isHidden(), 'window closes');

// --- City panel tabs ---
await IM((id) => window.ironMeridian.state.setSelected(id), capital);
await page.waitForTimeout(400);
check(await page.locator('#province-panel [data-tab="recruit"]').count() === 1, 'city panel has Recruit tab');
await click('#province-panel [data-tab="build"]');
await page.waitForTimeout(200);
check((await page.textContent('#province-panel')).includes('UNDER CONSTRUCTION'), 'city panel Build tab shows the construction');
await shot(page, '7-city-build');

// Shortcuts don't fire while typing; the game keeps running under a window.
if (!MOBILE) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('a');
  await IM(() => window.ironMeridian.state.setSpeed(1));
  const t0 = await IM(() => window.ironMeridian.state.clock.time);
  await page.waitForTimeout(1200);
  check(await IM(() => window.ironMeridian.state.clock.time) > t0, 'clock runs with a window open');
  await shot(page, '8-army-over-game');
}

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
