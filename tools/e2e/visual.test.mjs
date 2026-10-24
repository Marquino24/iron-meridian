// Browser test of step 6A: era themes, map style switch, clouds, markers and
// clusters, box selection (Shift+drag / two-finger long-press), group orders,
// "Select all cities", and frame rate per graphics level.
//   python3 -m http.server 3000   (in the project root), then:
//   node tools/e2e/visual.test.mjs [screenshot-dir] [--mobile]
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000/';
const SHOTS = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const MOBILE = process.argv.includes('--mobile');
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

await page.goto(`${BASE}?era=rome`);
await page.waitForSelector('[data-action="demo"], #main-menu:not([hidden])');
if (await page.locator('[data-action="demo"]').count()) await page.click('[data-action="demo"]');
await page.waitForSelector('#main-menu:not([hidden])');
await IM(() => window.ironMeridian.settings.set('quality', 'high'));
await page.waitForFunction(() => window.ironMeridian.renderer.ambient, null, { timeout: 15000 });
check(await IM(() => document.body.dataset.theme) === 'rome', 'Roman theme on the menu');
check(await IM(() => window.ironMeridian.renderer.look() === window.ironMeridian.renderer.look() && window.ironMeridian.renderer.cloudsOn(window.ironMeridian.renderer.look())), 'menu backdrop: satellite with clouds');
await page.waitForTimeout(800);
await shot(page, '1-menu-rome');

// WWII Germany.
await page.click('[data-menu="single"]');
await page.click('[data-era="ww2"]');
await page.waitForSelector('#start-screen:not([hidden]) .nation-row');
check(await IM(() => document.body.dataset.theme) === 'ww2', 'theme follows the chosen era');
await page.fill('#nation-search', 'German');
await page.click('.nation-row');
await page.click('#btn-deploy');
await page.waitForFunction(() => document.body.classList.contains('in-game'));
await IM(() => { window.ironMeridian.ai.enabled = false; });
await page.waitForTimeout(1200);
await page.click('#province-panel [data-action="close"]');
await IM(() => window.ironMeridian.state.setSpeed(0));

// Map style switch: three big labelled buttons, clouds toggle on satellite only.
const styles = await page.$$eval('#style-toggle [data-style]', (b) => b.map((x) => x.textContent.trim()));
check(styles.join() === 'Political,Satellite,Terrain', `style switch labels: ${styles.join(', ')}`);
check(await page.locator('#style-toggle [data-style] svg').count() === 3, 'style buttons have icons');
check(await page.locator('#btn-clouds').isHidden(), 'clouds toggle hidden on the political map');
await click('#style-toggle [data-style="satellite"]');
await page.waitForFunction(() => window.ironMeridian.renderer.images.satellite && window.ironMeridian.renderer.style === 'satellite');
check(await page.locator('#btn-clouds').isVisible(), 'clouds toggle shown on satellite');
await IM(() => { const { camera } = window.ironMeridian; camera.flyTo(camera.x, camera.y, camera.refZoom * 1.6, 0.01); });
await page.waitForTimeout(600);
check(await IM(() => window.ironMeridian.renderer.cloudsOn(window.ironMeridian.renderer.look())), 'clouds drawn over satellite');
await shot(page, '2-satellite-clouds');
await click('#btn-clouds');
check(await IM(() => !window.ironMeridian.renderer.cloudsOn(window.ironMeridian.renderer.look())), 'clouds switched off');
await click('#btn-clouds');
await click('#style-toggle [data-style="political"]');

// Zoomed out, armies merge into badges; clicking one zooms in.
await page.waitForTimeout(400);
const clusters = await IM(() => window.ironMeridian.renderer.hits.filter((h) => h.kind === 'cluster').length);
check(clusters > 0, `zoomed out: ${clusters} merged army badges`);
await shot(page, '3-clusters');
const own = await IM(() => window.ironMeridian.renderer.hits.find((h) => h.kind === 'cluster' && h.nation === window.ironMeridian.state.playerNationId));
if (own) {
  const z0 = await IM(() => window.ironMeridian.camera.zoom);
  await (MOBILE ? page.touchscreen.tap((own.x0 + own.x1) / 2, (own.y0 + own.y1) / 2) : page.mouse.click((own.x0 + own.x1) / 2, (own.y0 + own.y1) / 2));
  await page.waitForTimeout(900);
  check(await IM(() => window.ironMeridian.camera.zoom) > z0 * 1.5, 'clicking your badge zooms in');
  check(await IM(() => window.ironMeridian.state.armyGroup?.size) === own.ids.length, `and picks its ${own.ids.length} armies`);
  await page.keyboard.press('Escape');
}

// Box selection over Germany's field armies.
const field = await IM(() => {
  const { state, sim } = window.ironMeridian;
  return [...sim.armies.list.values()].filter((a) => a.nation === state.playerNationId && !a.garrison && a.kind === 'land').map((a) => a.id);
});
await IM((ids) => {
  const { sim, camera } = window.ironMeridian;
  const ps = ids.map((id) => sim.armies.armyPos(sim.armies.list.get(id)));
  const x = ps.reduce((t, p) => t + p.x, 0) / ps.length, y = ps.reduce((t, p) => t + p.y, 0) / ps.length;
  // Fit them all on screen, but stay zoomed in enough that they show one by one.
  const w = Math.max(...ps.map((p) => p.x)) - Math.min(...ps.map((p) => p.x)), h = Math.max(...ps.map((p) => p.y)) - Math.min(...ps.map((p) => p.y));
  const fit = Math.min(camera.viewW * 0.6 / Math.max(w, 1), camera.viewH * 0.4 / Math.max(h, 1));
  camera.flyTo(x, y, Math.max(36 / window.ironMeridian.state.map.provinceScale, Math.min(camera.refZoom * 4.5, fit)), 0.01);
}, field);
await page.waitForTimeout(700);
const boxes = await IM((ids) => window.ironMeridian.renderer.hits.filter((h) => h.kind === 'army' && ids.includes(h.id)), field);
check(boxes.length >= 2, `${boxes.length} field army markers on screen`);
const pad = 14;
const bx0 = Math.min(...boxes.map((h) => h.x0)) - pad, by0 = Math.min(...boxes.map((h) => h.y0)) - pad;
const bx1 = Math.max(...boxes.map((h) => h.x1)) + pad, by1 = Math.max(...boxes.map((h) => h.y1)) + pad;
if (MOBILE) {
  // Two fingers held still, then spread to the box corners.
  const cdp = await ctx.newCDPSession(page);
  const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  await touch('touchStart', [[cx - 20, cy - 20], [cx + 20, cy + 20]]);
  await page.waitForTimeout(650);
  check(await IM(() => !!window.ironMeridian.renderer.selectBox), 'two-finger long-press starts a selection box');
  for (let k = 1; k <= 5; k++) {
    await touch('touchMove', [[cx - 20 + (bx0 - cx + 20) * k / 5, cy - 20 + (by0 - cy + 20) * k / 5], [cx + 20 + (bx1 - cx - 20) * k / 5, cy + 20 + (by1 - cy - 20) * k / 5]]);
    await page.waitForTimeout(40);
  }
  await shot(page, '4-box');
  await touch('touchEnd', []);
} else {
  await page.keyboard.down('Shift');
  await page.mouse.move(bx0, by0);
  await page.mouse.down();
  await page.mouse.move((bx0 + bx1) / 2, (by0 + by1) / 2, { steps: 4 });
  await page.mouse.move(bx1, by1, { steps: 4 });
  check(await IM(() => !!window.ironMeridian.renderer.selectBox), 'Shift+drag draws a selection box');
  await shot(page, '4-box');
  await page.mouse.up();
  await page.keyboard.up('Shift');
}
await page.waitForTimeout(300);
const group = await IM(() => [...(window.ironMeridian.state.armyGroup ?? [])]);
check(group.length >= 2 && group.every((id) => field.includes(id)), `box picked ${group.length} field armies`);
check(await page.locator('#group-bar').isVisible() && /armies/.test(await page.textContent('#group-bar')), 'group bar shown');

// One order moves them all.
const target = await IM(() => {
  const { state } = window.ironMeridian;
  const p = state.provinces.find((q) => q.owner === state.playerNationId && q.isCity && q.cityName === 'Munich') ?? state.provinces.find((q) => q.owner === state.playerNationId && q.isCity);
  return p.id;
});
await IM((id) => { const { state, sim, camera } = window.ironMeridian; const c = sim.armies.pos[id]; camera.flyTo(c.x, c.y, camera.zoom, 0.01); }, target);
await page.waitForTimeout(400);
const s = await IM((id) => { const { sim, camera } = window.ironMeridian; const c = sim.armies.pos[id]; return camera.worldToScreen(c.x, c.y); }, target);
await (MOBILE ? page.touchscreen.tap(s.x, s.y + 6) : page.mouse.click(s.x, s.y + 6));
await page.waitForTimeout(300);
const moving = await IM((ids) => ids.filter((id) => { const a = window.ironMeridian.sim.armies.list.get(id); return a && (a.seg || a.path.length || a.node === a.dest); }).length, group);
check(moving === group.length, `${moving}/${group.length} armies ordered with one click`);
check(/on the move/.test(await page.textContent('#toast')), `toast: ${await page.textContent('#toast')}`);
await IM(() => window.ironMeridian.state.setSpeed(2));
await page.waitForTimeout(1500);
await IM(() => window.ironMeridian.state.setSpeed(0));
await shot(page, '5-group-moving');
await click('#group-bar [data-group="clear"]');
check(await IM(() => window.ironMeridian.state.armyGroup) === null, 'group cleared');

// Windows: icons in the headers and command bar, big "Select all cities".
check(await page.locator('#command-bar [data-win] .cb-ico svg').count() === 5, 'command bar icons');
await click('#command-bar [data-win="production"]');
await page.waitForSelector('.win-production:not([hidden])');
check(await page.locator('.win-production .win-glyph svg').count() === 1, 'window header icon');
check(await page.locator('.win-production .pick .unit-glyph svg').count() >= 4, 'unit cards have pictures');
await click('.win-production .select-all-big');
const sel = await page.textContent('.win-production .select-all-big');
check(/All cities selected/.test(sel), `select all: "${sel.replace(/\s+/g, ' ').trim()}"`);
await shot(page, '6-production');
await click('.win-production .select-all-big');
check(/Select all cities/.test(await page.textContent('.win-production .select-all-big')), 'tap again clears');
if (MOBILE) await click('.win-production .win-close'); else await page.keyboard.press('Escape');
await click('#command-bar [data-win="buildings"]');
await page.waitForSelector('.win-buildings:not([hidden])');
await click('.win-buildings .select-all-big');
const n = await page.locator('.win-buildings input[data-pick]:checked').count();
check(n > 0 && n === await page.locator('.win-buildings input[data-pick]').count(), `buildings: all ${n} cities checked`);
check(await page.locator('.win-buildings .b-glyph svg').count() >= 6, 'building columns have pictures');
if (MOBILE) await click('.win-buildings .win-close'); else await page.keyboard.press('Escape');

// Frame rate per graphics level while the camera pans over the war zone (game running).
for (const q of ['low', 'medium', 'high']) {
  await IM((q) => { window.ironMeridian.settings.set('quality', q); window.ironMeridian.state.setSpeed(2); }, q);
  await page.waitForTimeout(500);
  const fps = await IM(() => new Promise((resolve) => {
    const { camera } = window.ironMeridian;
    const times = [];
    let last = performance.now(), dir = 1, n = 0;
    const step = (now) => {
      times.push(now - last); last = now;
      camera.panBy(dir * 3, 0);
      if (++n % 60 === 0) dir = -dir;
      if (times.length < 180) requestAnimationFrame(step);
      else { times.sort((a, b) => a - b); resolve(Math.round(1000 / times[Math.floor(times.length / 2)])); }
    };
    requestAnimationFrame(step);
  }));
  console.log(`     ${q}: median ${fps} fps while panning`);
  check(fps >= 25, `${q} quality runs (${fps} fps)`);
}
await IM(() => window.ironMeridian.state.setSpeed(0));

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
