// Browser test of step 4B: Research window, tree states, start/finish, feed.
//   python3 -m http.server 3000   (in the project root), then:
//   node tools/e2e/research.test.mjs [screenshot-dir] [--mobile]
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
const tag = `${MOBILE ? 'phone' : 'desktop'}-${ERA}`;
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

const bar = await page.$$eval('#command-bar [data-win]', (b) => b.map((x) => x.dataset.win));
check(bar.join() === 'army,production,buildings,research', `command bar: ${bar.join(', ')}`);
await page.waitForTimeout(700);
check((await page.textContent('#command-bar [data-win="research"] .cb-badge').catch(() => '')) === '1', 'badge on Research: 1 idle slot');
if (MOBILE) await click('#command-bar [data-win="research"]'); else await page.keyboard.press('r');
await page.waitForSelector('.win-research:not([hidden])');
const tree = await IM(() => window.ironMeridian.sim.research.tree.map((t) => ({ id: t.id, req: t.req.length })));
check(await page.locator('.tech').count() === tree.length, `${tree.length} tech cards`);
check(await page.locator('.tree-lines path').count() === tree.reduce((n, t) => n + t.req, 0), 'one line per requirement');
check(await page.locator('.tech.st-available').count() === 9 && await page.locator('.tech.st-locked').count() === tree.length - 9, '9 tier-1 techs available, the rest locked');
await shot(page, '1-tree');

// A locked tech explains what it needs.
await click('.tech[data-tech="m4"]');
check(/Requires/.test(await page.textContent('.tech-detail')), 'locked tech lists its requirement');
// Start the first military tech and the slot fills.
await click('.tech[data-tech="m1"]');
const fx = await page.textContent('.td-fx');
check(/level 2/.test(fx), `effects shown: ${fx.trim()}`);
await shot(page, '1b-detail');
await click('.tech-detail [data-start]');
await page.waitForTimeout(300);
check(await page.locator('.tech.st-active').count() === 1, 'card shows researching');
check(await page.locator('.slot.busy').count() === 1, 'slot in use');
check(await page.locator('#command-bar [data-win="research"] .cb-badge').count() === 0 || (await page.waitForTimeout(700), await page.locator('#command-bar [data-win="research"] .cb-badge').count() === 0), 'badge gone once the slot is busy');
await click('.tech[data-tech="m3"]');
check(/slot busy/i.test(await page.textContent('.tech-detail')), 'second tech: slot busy');
await click('.tech-detail [data-enqueue]');
await page.waitForTimeout(200);
check(await page.locator('.r-queue .q-item').count() === 1 && await page.locator('.tech[data-tech="m3"].queued').count() === 1, 'added to the queue');
// A tech whose requirement is only queued can join too.
await click('.tech[data-tech="m8"]');
check(/Queue .* first/.test(await page.textContent('.tech-detail')) || await page.locator('.tech-detail [data-enqueue]').count() === 0, 'm8 needs m5 queued first');
await click('.tech[data-tech="m1"]');
await IM(() => window.ironMeridian.state.setSpeed(4));
await page.waitForTimeout(6000);
const w = await page.$eval('.tech[data-tech="m1"] .progress i', (e) => parseFloat(e.style.width));
check(w > 0, `progress bar moving (${w}%)`);
await shot(page, '2-researching');
await page.waitForFunction(() => window.ironMeridian.sim.research.status(window.ironMeridian.state.playerNationId, 'm1') === 'done', null, { timeout: 90000 });
await page.waitForTimeout(150);
const toast = await page.textContent('#toast');
await IM(() => window.ironMeridian.state.setSpeed(0));
check(/Research complete/.test(toast), `toast: "${toast}"`);
await page.waitForTimeout(400);
check(await IM(() => window.ironMeridian.sim.research.status(window.ironMeridian.state.playerNationId, 'm3')) === 'active', 'queued tech started by itself');
check(await page.locator('.tech[data-tech="m1"].st-done').count() === 1, 'card shows done');
check(await page.locator('.tech[data-tech="m5"].st-available').count() === 1, 'its follow-up became available');
check((await page.textContent('#feed')).includes('Research complete'), 'feed: research complete');
// Give a few more so the tree shows every state, then screenshot.
await IM(() => {
  const { sim, state } = window.ironMeridian;
  const me = state.playerNationId;
  for (const id of ['e2', 'e1', 'i2', 'e4', 'i1']) sim.research.grant(me, id);
  for (const k of sim.economy.keys) sim.economy.get(me)[k] += 50000;
  for (const id of ['e5', 'm5', 'i4', 'm8', 'i6']) sim.research.enqueue(me, id);
});
await page.waitForTimeout(600);
check(await page.locator('.slot.busy').count() === 2, 'two slots busy after the slot tech');
await click('.tech[data-tech="m5"]');
await page.waitForTimeout(300);
await shot(page, '3-states');
await click('.win-research [data-rtab="bonuses"]');
await page.waitForTimeout(300);
const bon = await page.textContent('.bonuses');
check(/Level II/.test(bon) && /Research slots/.test(bon) && /\+10%/.test(bon), 'Bonuses tab lists unit levels, slots and production');
await shot(page, '4-bonuses');
await click('.win-research [data-rtab="tree"]');
if (MOBILE) await click('.win-research .win-close'); else await page.keyboard.press('Escape');
check(await page.locator('.win-research').isHidden(), 'window closes');

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
