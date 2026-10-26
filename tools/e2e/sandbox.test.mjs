// Browser test of step 6B: Sandbox mode — every tool, the label, 16× time,
// switching nations, and that a normal game afterwards has none of it.
//   python3 -m http.server 3000   (in the project root), then:
//   node tools/e2e/sandbox.test.mjs [screenshot-dir] [--mobile]
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000/';
const SHOTS = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const MOBILE = process.argv.includes('--mobile');
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errors = [];
let failures = 0;
const check = (cond, label) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) failures++; };
const tag = MOBILE ? 'phone' : 'desktop';
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${tag}-sb-${name}.png` }); };

const ctx = await browser.newContext(MOBILE
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  : { viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); });
const click = (sel) => (MOBILE ? page.tap(sel) : page.click(sel));
const tapAt = (x, y) => (MOBILE ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));
const IM = (fn, arg) => page.evaluate(fn, arg);
const nationId = (name) => IM((name) => window.ironMeridian.state.nations.find((n) => n.shortName === name || n.name === name)?.id, name);
const select = async (key, id) => { await page.selectOption(`.sb-panel select[data-nation="${key}"]`, String(id)); await page.waitForTimeout(150); };
const tool = async (id) => { await click(`.sb-tools [data-tool="${id}"]`); await page.waitForSelector(`.sb-panel[data-tool="${id}"]:not([hidden])`); };
/** Screen point of a province's centre after flying there. */
const flyToProvince = async (pid, rel = 6) => {
  await IM(([pid, rel]) => { const { state, camera } = window.ironMeridian; const p = state.provinces[pid]; camera.flyTo(p.center.x, p.center.y, camera.refZoom * rel, 0.01); }, [pid, rel]);
  await page.waitForTimeout(400);
  return IM((pid) => { const { state, camera } = window.ironMeridian; const p = state.provinces[pid]; return camera.worldToScreen(p.center.x, p.center.y); }, pid);
};

await page.goto(`${BASE}?era=ww2`);
await page.waitForSelector('[data-action="demo"], #main-menu:not([hidden])');
if (await page.locator('[data-action="demo"]').count()) await page.click('[data-action="demo"]');
await page.waitForSelector('#main-menu:not([hidden])');
check(await page.locator('[data-menu="sandbox"]').isEnabled(), 'Sandbox button enabled on the main menu');
await page.click('[data-menu="sandbox"]');
await page.waitForSelector('#era-screen:not([hidden])');
check((await page.textContent('#era-screen .eyebrow')).includes('SANDBOX'), 'era screen says SANDBOX');
await page.click('[data-era="ww2"]');
await page.waitForSelector('#start-screen:not([hidden]) .nation-row');
await page.fill('#nation-search', 'German');
await page.click('.nation-row');
check(/START SANDBOX/.test(await page.textContent('#btn-deploy')), `deploy button: ${await page.textContent('#btn-deploy')}`);
await page.click('#btn-deploy');
await page.waitForFunction(() => document.body.classList.contains('in-game'));
// AI proposals pop up modals at random; this test is about the sandbox tools.
await IM(() => { window.ironMeridian.sim.diplomacy.propose = () => null; });
await page.waitForTimeout(1200);
await page.click('#province-panel [data-action="close"]').catch(() => {});
await IM(() => window.ironMeridian.state.setSpeed(0));

// Label and toolbar.
check(await IM(() => window.ironMeridian.state.sandbox) === true, 'game is a sandbox');
check(await page.locator('#sandbox-tag').isVisible() && (await page.textContent('#sandbox-tag')).trim() === 'SANDBOX', 'SANDBOX tag in the top bar');
check(await page.locator('.sb-tools [data-tool]').count() === 7, '7 sandbox tools');
const speeds = await page.$$eval('#speed-group [data-speed]', (b) => b.map((x) => Number(x.dataset.speed)));
check(speeds.includes(16) && speeds.includes(8), `speeds: ${speeds.join(', ')}`);
await shot(page, '0-toolbar');

// Paint: give German provinces to France by dragging.
const me = await IM(() => window.ironMeridian.state.playerNationId);
const france = await nationId('France');
const poland = await nationId('Poland');
await tool('paint');
await select('paint', france);
const berlin = await IM(() => window.ironMeridian.state.playerNation.capitalId);
const route = await IM((cap) => {
  // A line of German provinces west of Berlin.
  const { state } = window.ironMeridian;
  const c = state.provinces[cap].center;
  return state.provinces.filter((p) => p.owner === state.playerNationId && p.center.x < c.x && Math.abs(p.center.y - c.y) < 40).sort((a, b) => b.center.x - a.center.x).slice(0, 6).map((p) => p.id);
}, berlin);
const s0 = await flyToProvince(route[2], 7);
const pts = await IM((ids) => ids.map((id) => { const { state, camera } = window.ironMeridian; const p = state.provinces[id]; return camera.worldToScreen(p.center.x, p.center.y); }), route);
if (MOBILE) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0].x, y: pts[0].y, id: 1 }] });
  for (const p of pts.slice(1)) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x, y: p.y, id: 1 }] }); await page.waitForTimeout(30); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
} else {
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(p.x, p.y, { steps: 3 });
  await page.mouse.up();
}
await page.waitForTimeout(300);
const painted = await IM(([ids, f]) => ids.filter((id) => window.ironMeridian.state.provinces[id].owner === f).length, [route, france]);
check(painted >= Math.min(4, route.length), `drag painted ${painted}/${route.length} provinces for France`);
check(Math.abs((await IM(() => window.ironMeridian.camera.x)) - (await IM((id) => window.ironMeridian.state.provinces[id].center.x, route[2]))) < 2, 'the brush stroke did not pan the map');
await shot(page, '1-paint');

// Pick a nation from the map (eyedropper).
await click('.sb-panel [data-pick="paint"]');
if (MOBILE) check(await page.locator('.sb-panel .sb-body').isHidden(), 'picking folds the panel on phones');
const polCap = await IM((id) => window.ironMeridian.state.getNation(id).capitalId, poland);
const sp = await flyToProvince(polCap, 6);
await tapAt(sp.x, sp.y + 4);
await page.waitForTimeout(200);
check(Number(await page.inputValue('.sb-panel select[data-nation="paint"]')) === poland, 'pick-on-map chose Poland');

// Armies: 10 tanks for Poland at Berlin; ships at sea.
await tool('army');
await select('army', poland);
const tankKey = await IM(() => window.ironMeridian.sim.armies.roster.byRole.mob.key);
await click(`.sb-panel [data-unit="${tankKey}"]`);
await click('.sb-panel [data-setcount="10"]');
// Phones: fold the panel so the map is free to tap.
if (MOBILE) await click('.sb-panel [data-min]');
const before = await IM(() => window.ironMeridian.sim.armies.list.size);
const sb = await flyToProvince(berlin, 7);
await tapAt(sb.x, sb.y + 4);
await page.waitForTimeout(300);
const spawned = await IM(([pol, b]) => [...window.ironMeridian.sim.armies.list.values()].filter((a) => a.nation === pol && a.node === b), [poland, berlin]);
check(await IM(() => window.ironMeridian.sim.armies.list.size) === before + 1 && spawned.length === 1 && spawned[0].units.length === 10, `spawned ${spawned[0]?.units.length} tanks for Poland in Berlin`);
await shot(page, '2-army');
// Ships go on water; land units refuse it.
const sea = await IM((cap) => { const { state, sim } = window.ironMeridian; const p = state.provinces.find((q) => q.owner === state.playerNationId && q.seaNeighbors.length); return sim.armies.P + p.seaNeighbors[0]; }, berlin);
const seaSpawn = await IM(([node, me]) => { const { sim } = window.ironMeridian; return { ship: !!sim.sandbox.spawn(node, me, sim.armies.roster.byRole.nav.key, 3).army, tank: sim.sandbox.spawn(node, me, sim.armies.roster.byRole.mob.key, 3).error ?? null }; }, [sea, me]);
check(seaSpawn.ship && /province/.test(seaSpawn.tank ?? ''), `ships spawn at sea; tanks refused there ("${seaSpawn.tank}")`);

// Resources.
if (MOBILE) { await click('.sb-panel [data-min]'); check(await page.locator('.sb-panel .sb-body').isVisible(), 'panel unfolds'); }
await tool('res');
await select('res', france);
await click('.sb-panel [data-setamount="100000"]');
const m0 = await IM((f) => window.ironMeridian.sim.economy.get(f).money, france);
await click('.sb-panel [data-res="money"][data-sign="1"]');
const m1 = await IM((f) => window.ironMeridian.sim.economy.get(f).money, france);
check(Math.round(m1 - m0) === 100000, `France +100,000 money (${Math.round(m0)} → ${Math.round(m1)})`);
await shot(page, '3-resources');
await click('.sb-panel [data-res="zero"]');
check(await IM((f) => Object.values(window.ironMeridian.sim.economy.get(f)).every((v) => v === 0), france), 'empty all: France has nothing');
await click('.sb-panel [data-res="all"]');
check(await IM((f) => Object.values(window.ironMeridian.sim.economy.get(f)).every((v) => v === 100000), france), 'everything +100,000');

// Diplomacy: France vs Poland, then peace keeping borders and no truce.
await tool('diplo');
await select('diA', france);
await select('diB', poland);
await click('.sb-panel [data-war="1"]');
check(await IM(([a, b]) => window.ironMeridian.sim.combat.atWar(a, b), [france, poland]), 'France and Poland at war');
await shot(page, '4-diplomacy');
// Give France a Polish province, then make peace: it stays French.
const polProv = await IM((pol) => window.ironMeridian.state.provinces.find((p) => p.owner === pol && !p.isCapital).id, poland);
await IM(([pid, f]) => window.ironMeridian.sim.sandbox.paint(pid, f), [polProv, france]);
await click('.sb-panel [data-war="0"]');
check(!(await IM(([a, b]) => window.ironMeridian.sim.combat.atWar(a, b), [france, poland])), 'peace made');
check(await IM(([a, b]) => window.ironMeridian.sim.combat.truceUntil(a, b), [france, poland]) === null, 'no truce after sandbox peace');
check(await IM((pid) => window.ironMeridian.state.provinces[pid].owner, polProv) === france, 'borders kept');
// War with a nation you have a truce with still works in the sandbox.
await IM(([a, b]) => { const { sim } = window.ironMeridian; sim.combat.declareWar(a, b); sim.combat.makePeace(a, b); }, [me, poland]);
check(await IM(([a, b]) => window.ironMeridian.sim.combat.truceUntil(a, b), [me, poland]) !== null, '(normal peace leaves a truce)');
check(await IM(([a, b]) => window.ironMeridian.sim.sandbox.setWar(a, b, true), [me, poland]), 'sandbox war ignores the truce');
await IM(([a, b]) => window.ironMeridian.sim.sandbox.setWar(a, b, false), [me, poland]);

// AI.
await tool('ai');
await select('ai', france);
await click('.sb-panel [data-ai] + span');
check(await IM((f) => window.ironMeridian.sim.ai.disabled.has(f) && !window.ironMeridian.sim.ai.controls(f), france), 'AI off for France');
await shot(page, '5-ai');
await click('.sb-panel [data-allai] + span');
check(await IM(() => !window.ironMeridian.sim.ai.enabled), 'all AI off');
await click('.sb-panel [data-allai] + span');
check(await IM((f) => window.ironMeridian.sim.ai.enabled && !window.ironMeridian.sim.ai.disabled.has(f)), 'all AI back on (France too)');

// Instant modes (the clock stays paused: they still finish).
await tool('instant');
for (const k of ['build', 'recruit', 'research']) await click(`.sb-panel [data-instant="${k}"] + span`);
check(await IM(() => Object.values(window.ironMeridian.sim.sandbox.instant).every(Boolean)), 'instant build, recruit, research on');
await shot(page, '6-instant');
const inst = await IM(async () => {
  const { state, sim } = window.ironMeridian;
  const me = state.playerNationId;
  for (const k of sim.economy.keys) sim.economy.get(me)[k] += 1e6;
  const city = state.provinces.find((p) => p.owner === me && p.isCity && sim.buildings.check(p.id, 'farm').ok);
  const lv0 = sim.buildings.level(city.id, 'farm');
  sim.buildings.build(city.id, 'farm');
  const barracks = state.provinces.find((p) => p.owner === me && sim.armies.canRecruit(p.id, sim.armies.roster.byRole.inf.key));
  const units0 = [...sim.armies.list.values()].filter((a) => a.nation === me).reduce((t, a) => t + a.units.length, 0);
  for (let i = 0; i < 3; i++) sim.armies.recruit(barracks.id, sim.armies.roster.byRole.inf.key);
  const tech = sim.research.tree.find((t) => sim.research.status(me, t.id) === 'available');
  sim.research.start(me, tech.id);
  await new Promise((r) => setTimeout(r, 300));
  const units1 = [...sim.armies.list.values()].filter((a) => a.nation === me).reduce((t, a) => t + a.units.length, 0);
  return { built: sim.buildings.level(city.id, 'farm') === lv0 + 1, queue: sim.armies.queue(barracks.id).length, units: units1 - units0, tech: sim.research.status(me, tech.id) };
});
check(inst.built, 'instant build: farm finished while paused');
check(inst.queue === 0 && inst.units === 3, `instant recruit: 3 units ready (${inst.units})`);
check(inst.tech === 'done', `instant research: tech ${inst.tech}`);

// 16× time.
if (MOBILE) {
  // Phones show two speed buttons: pause, and one that cycles 1× → 2× → 4× → 8× → 16×.
  for (let i = 0; i < 6 && await IM(() => window.ironMeridian.state.clock.speed) !== 16; i++) await click('#speed-group button.cur');
} else await click('#speed-group [data-speed="16"]');
const t0 = await IM(() => window.ironMeridian.state.clock.time);
await page.waitForTimeout(1000);
const hours = (await IM(() => window.ironMeridian.state.clock.time) - t0) / 36e5;
await IM(() => window.ironMeridian.state.setSpeed(0));
check(hours > 13 && hours < 19, `16×: ${hours.toFixed(1)} game hours in 1 s (1× is 1 hour per second)`);

// Play as France.
await tool('play');
await select('play', france);
await shot(page, '7-play-as');
await click('.sb-panel [data-playas]');
await page.waitForTimeout(300);
check(await IM(() => window.ironMeridian.state.playerNationId) === france, 'now playing as France');
check(await IM(([f, g]) => !window.ironMeridian.sim.ai.brains.has(f) && window.ironMeridian.sim.ai.brains.has(g), [france, me]), 'computer took Germany, not France');
check(/FRANCE|FRENCH/.test(await page.textContent('#player-name')), `top bar: ${await page.textContent('#player-name')}`);
await page.waitForTimeout(800);
await shot(page, '8-france');

// Back to the menu and a normal game: no sandbox left over.
await page.click('#btn-menu');
await page.waitForSelector('#main-menu:not([hidden])');
await page.click('[data-menu="single"]');
check((await page.textContent('#era-screen .eyebrow')).includes('SINGLE PLAYER'), 'single player label back');
await page.click('[data-era="ww1"]');
await page.waitForSelector('#start-screen:not([hidden]) .nation-row');
await page.click('.nation-row');
check(/ASSUME COMMAND/.test(await page.textContent('#btn-deploy')), 'normal deploy button');
await page.click('#btn-deploy');
await page.waitForFunction(() => document.body.classList.contains('in-game'));
await page.waitForTimeout(800);
check(await IM(() => window.ironMeridian.state.sandbox) === false, 'normal game is not a sandbox');
check(await page.locator('#sandbox-tag').isHidden() && await page.locator('#sandbox-bar').isHidden(), 'no sandbox tag or toolbar');
check(!(await page.$$eval('#speed-group [data-speed]', (b) => b.map((x) => Number(x.dataset.speed)))).includes(16), 'no 16× in a normal game');
check(await IM(() => !Object.values(window.ironMeridian.sim.sandbox.instant).some(Boolean)), 'instant modes reset');

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
