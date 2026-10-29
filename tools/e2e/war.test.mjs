// Browser test of step 3: armies, orders, war, battle, recruiting, feed, report.
//   python3 -m http.server 3000   (in the project root), then:
//   node tools/e2e/war.test.mjs [screenshot-dir] [--mobile]
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000/';
const SHOTS = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const MOBILE = process.argv.includes('--mobile');
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errors = [];
let failures = 0;
const check = (cond, label) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) failures++; };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

const ctx = await browser.newContext(MOBILE
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  : { viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); });
const tap = async (x, y) => (MOBILE ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));

await page.goto(BASE + '?era=ww2');
// Demo sign-in (or straight to the menu if a demo session is remembered).
await page.waitForSelector('[data-action="demo"], #main-menu:not([hidden])');
if (await page.locator('[data-action="demo"]').count()) await page.click('[data-action="demo"]');
await page.waitForSelector('#main-menu:not([hidden])');
await page.click('[data-menu="single"]');
// First single-player game: the tutorial offer (step 12). Skip it.
await page.waitForSelector('#tutorial-offer:not([hidden]), #era-screen:not([hidden])');
if (await page.locator('#tutorial-offer:not([hidden])').count()) await page.click('[data-offer="skip"]');
await page.click('[data-era="ww2"]');
await page.waitForSelector('#start-screen:not([hidden]) .nation-row');
await page.fill('#nation-search', 'German');
await page.click('.nation-row');
await page.click('#btn-deploy');
await page.waitForFunction(() => document.body.classList.contains('in-game'));
// Computer nations stay idle here (tools/e2e/ai.test.mjs covers them), so no AI war alert interrupts the test.
await page.evaluate(() => { window.ironMeridian.ai.enabled = false; });
await page.waitForTimeout(1500);
// The capital's panel opens on deploy; close it so the map is clear (it covers half a phone screen).
await page.click('#province-panel [data-action="close"]');
await page.waitForTimeout(300);

const IM = (fn, arg) => page.evaluate(fn, arg);
const info = await IM(() => {
  const { state, sim } = window.ironMeridian;
  const me = state.playerNationId;
  const mine = [...sim.armies.list.values()].filter((a) => a.nation === me);
  return { me, name: state.playerNation.name, armies: mine.length, field: mine.filter((a) => !a.garrison && a.kind === 'land').map((a) => a.id), money: sim.economy.get(me).money };
});
check(info.name === 'German Reich', `playing ${info.name}`);
check(info.armies >= 3, `player has ${info.armies} armies (field: ${info.field.length})`);
const resText = await page.textContent('[data-res-val="money"]');
check(Number(resText.replace(/[^\d.]/g, '')) > 0, `money shown in top bar: ${resText}`);

// Income tooltip.
if (!MOBILE) await page.hover('.res'); else await page.tap('.res');
await page.waitForSelector('#res-tip:not([hidden])');
check((await page.textContent('#res-tip')).includes('DAILY INCOME'), 'income tooltip');
await shot(page, 'w1-topbar-income');
if (MOBILE) await page.tap('.res'); else await page.mouse.move(700, 500);
check(await page.locator('#res-tip').isHidden(), 'tooltip closes');
const menuBox = await page.locator('#btn-menu').boundingBox();
check(menuBox && menuBox.x + menuBox.width <= (MOBILE ? 390 : 1440), `MENU button fits in the top bar (right edge ${menuBox && Math.round(menuBox.x + menuBox.width)})`);

// Fly to the Czech border and pick the field army closest to Prague by clicking its counter.
const czech = await IM(() => {
  const { state } = window.ironMeridian;
  const n = state.nations.find((x) => x.name === 'Czechoslovakia');
  return { id: n.id, capital: n.capitalId };
});
async function screenOf(node) {
  return IM((node) => {
    const { camera, sim } = window.ironMeridian;
    const p = sim.armies.pos[node];
    return camera.worldToScreen(p.x, p.y);
  }, node);
}
async function flyTo(node, rel = 5) {
  await IM(([node, rel]) => {
    const { camera, sim } = window.ironMeridian;
    const p = sim.armies.pos[node];
    camera.flyTo(p.x, p.y, camera.refZoom * rel, 0.01);
  }, [node, rel]);
  await page.waitForTimeout(400);
}
const army = await IM((cap) => {
  const { sim, state } = window.ironMeridian;
  const A = sim.armies;
  const c = A.pos[cap];
  const list = [...A.list.values()].filter((a) => a.nation === state.playerNationId && !a.garrison && a.kind === 'land');
  list.sort((a, b) => Math.hypot(A.pos[a.node].x - c.x, A.pos[a.node].y - c.y) - Math.hypot(A.pos[b.node].x - c.x, A.pos[b.node].y - c.y));
  return { id: list[0].id, node: list[0].node };
}, czech.capital);
await flyTo(czech.capital, MOBILE ? 7 : 9);
const hit = await IM((id) => window.ironMeridian.renderer.hits.find((h) => h.kind === 'army' && h.id === id), army.id);
check(!!hit, 'field army counter drawn on the map');
await tap((hit.x0 + hit.x1) / 2, (hit.y0 + hit.y1) / 2);
await page.waitForTimeout(900);
check(await IM(() => window.ironMeridian.state.selectedArmyId) === army.id, 'clicking the counter selects the army');
check((await page.textContent('#province-panel')).includes('UNITS'), 'army panel shows units');
await shot(page, 'w2-army-panel');

// At peace: ordering into Czechoslovakia fails with a notice.
let s = await screenOf(czech.capital);
await tap(s.x, s.y + 4);
await page.waitForTimeout(300);
const toast = await page.textContent('#toast');
check(/peace/i.test(toast), `peace blocks the move: "${toast}"`);

// Declare war through the nation panel.
await page.keyboard.press('Escape');
s = await screenOf(czech.capital);
await IM((id) => window.ironMeridian.state.setSelected(id), czech.capital);
await page.waitForTimeout(300);
await page.click('[data-cmd="war"]');
check((await page.textContent('#province-panel')).includes('Declare war on'), 'war needs confirmation');
await shot(page, 'w3-declare-war');
await page.click('[data-cmd="war-confirm"]');
check(await IM((id) => window.ironMeridian.sim.combat.atWar(window.ironMeridian.state.playerNationId, id), czech.id), 'at war with Czechoslovakia');
check((await page.textContent('#feed')).includes('declared war'), 'feed: war declared');

// Order the army to Prague (counter click, then province click).
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await page.waitForTimeout(500); // panel slides away
const hit2 = await IM((id) => window.ironMeridian.renderer.hits.find((h) => h.kind === 'army' && h.id === id), army.id);
await tap((hit2.x0 + hit2.x1) / 2, (hit2.y0 + hit2.y1) / 2);
await page.waitForTimeout(800);
s = await screenOf(czech.capital);
await shot(page, 'w3b-before-order');
if (!MOBILE) { await page.mouse.move(s.x, s.y + 4); await page.waitForTimeout(200); }
await tap(s.x, s.y + 4);
await page.waitForTimeout(300);
const order = await IM((id) => { const a = window.ironMeridian.sim.armies.list.get(id); return { dest: a.dest, moving: !!a.seg, path: a.path.length }; }, army.id);
check(order.moving, `army marching (dest ${order.dest}, ${order.path} more hops)`);
await IM(() => window.ironMeridian.state.setSpeed(4));
await page.waitForTimeout(2500);
await shot(page, 'w4-army-moving');

// Fast-forward to the battle.
const t0 = Date.now();
await page.waitForFunction(() => window.ironMeridian.sim.combat.active.size > 0 || window.ironMeridian.sim.combat.history.length > 0, null, { timeout: 120000 });
console.log(`     battle reached after ${((Date.now() - t0) / 1000).toFixed(0)} s real at 4×`);
await IM(() => window.ironMeridian.state.setSpeed(1));
await page.waitForTimeout(1500);
const live = await IM(() => [...window.ironMeridian.sim.combat.active.values()][0]);
if (live) {
  const sp = await screenOf(live.node);
  await IM(([x, y]) => window.ironMeridian.camera.flyTo(...Object.values(window.ironMeridian.camera.screenToWorld(x, y)), window.ironMeridian.camera.zoom, 0.01), [sp.x, sp.y]);
  await page.waitForTimeout(500);
  await shot(page, 'w5-battle');
  const sw = await IM(() => window.ironMeridian.renderer.hits.find((h) => h.kind === 'battle'));
  check(!!sw, 'crossed swords drawn on the battle');
  if (sw) {
    await tap((sw.x0 + sw.x1) / 2, (sw.y0 + sw.y1) / 2);
    await page.waitForSelector('#battle-report:not([hidden])');
    check((await page.textContent('#battle-report')).includes('ONGOING'), 'live battle report');
    await page.keyboard.press('Escape');
  }
}
await IM(() => window.ironMeridian.state.setSpeed(4));
await page.waitForFunction(() => window.ironMeridian.sim.combat.history.length > 0, null, { timeout: 120000 });
await IM(() => window.ironMeridian.state.setSpeed(0));
// Open the finished battle from the feed.
await page.click('.feed-item.link >> text=/Victory|Defeat|Stalemate/');
await page.waitForSelector('#battle-report:not([hidden])');
const rep = await page.textContent('#battle-report');
check(/VICTORY|DEFEAT/.test(rep) && rep.includes('Lost'), 'finished battle report with losses');
await shot(page, 'w6-battle-report');
await page.click('[data-close-report]');

// Occupation → capture of Prague.
await IM(() => window.ironMeridian.state.setSpeed(4));
await page.waitForFunction((cap) => window.ironMeridian.sim.combat.occupations.has(cap) || window.ironMeridian.state.provinces[cap].owner === window.ironMeridian.state.playerNationId, czech.capital, { timeout: 60000 });
await IM(() => window.ironMeridian.state.setSpeed(1));
await page.waitForTimeout(1200);
await shot(page, 'w7-occupation');
await IM(() => window.ironMeridian.state.setSpeed(4));
await page.waitForFunction((cap) => window.ironMeridian.state.provinces[cap].owner === window.ironMeridian.state.playerNationId, czech.capital, { timeout: 60000 });
check(true, 'Prague captured');
check(await IM((id) => window.ironMeridian.sim.economy.capitalLost(id), czech.id), 'Czechoslovakia flagged capital lost');
check((await page.textContent('#feed')).includes('Captured'), 'feed: captured');

// Recruit in Berlin.
await IM(() => window.ironMeridian.state.setSpeed(0));
const berlin = await IM(() => window.ironMeridian.state.playerNation.capitalId);
await IM((id) => window.ironMeridian.state.setSelected(id), berlin);
await page.waitForTimeout(300);
await page.click('[data-cmd="recruit"][data-type="infantry"]');
await page.click('[data-cmd="recruit"][data-type="artillery"]');
check(await page.locator('.queue-row').count() === 2, 'two units queued');
await IM(() => window.ironMeridian.state.setSpeed(4));
await page.waitForTimeout(2500);
await shot(page, 'w8-recruit-queue');
await IM(() => window.ironMeridian.state.setSpeed(0));
const width = await page.$eval('[data-qbar]', (e) => parseFloat(e.style.width));
check(width > 0, `queue progress bar moving (${width}%)`);

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
