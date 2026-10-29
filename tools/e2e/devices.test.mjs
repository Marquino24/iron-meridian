// Phones and tablets, in Chromium and WebKit (Safari's engine): iPhone 390×844
// and iPad 820×1180, portrait and landscape. For each: the sign-in and Pending
// screens, the menus, the game HUD and every window (fits, closes), page
// overflow, tap targets (44 px), text size, touch pan / pinch / two-finger box
// select, safe-area insets, and the frame rate with Auto graphics.
//   python3 -m http.server 3000   (in the project root), then:
//   node tools/e2e/devices.test.mjs [screenshot-dir] [--browser=webkit|chromium] [--device=iphone|ipad] [--orient=portrait|landscape]
import { chromium, webkit } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000/';
const SHOTS = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const mock = readFileSync(new URL('./mock-supabase.js', import.meta.url), 'utf8');

const DEVICES = {
  iphone: { w: 390, h: 844, dpr: 3, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    safe: { portrait: { top: 59, bottom: 34, left: 0, right: 0 }, landscape: { top: 0, bottom: 21, left: 59, right: 59 } } },
  ipad: { w: 820, h: 1180, dpr: 2, ua: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    safe: { portrait: { top: 24, bottom: 20, left: 0, right: 0 }, landscape: { top: 24, bottom: 20, left: 0, right: 0 } } },
};
const BROWSERS = { chromium: () => chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }), webkit: () => webkit.launch() };
const MIN_TAP = 44;     // Apple's minimum touch target (CSS px)
const MIN_TEXT = 11;    // smallest readable text (CSS px)

let failures = 0;
const results = [];
const check = (cond, label) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) failures++; };

/** Elements that fail the layout rules on the current screen. */
const audit = (page) => page.evaluate(({ MIN_TAP, MIN_TEXT }) => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05 && !el.closest('[hidden]');
  };
  const name = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.classList.length ? `.${[...el.classList].slice(0, 2).join('.')}` : ''}${el.dataset.win ? `[${el.dataset.win}]` : ''}${el.dataset.speed ? `[speed ${el.dataset.speed}]` : ''} "${(el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24)}"`;
  const overflow = document.documentElement.scrollWidth > vw + 1 || document.body.scrollWidth > vw + 1;
  const small = [], offscreen = [], tiny = [];
  for (const el of document.querySelectorAll('button, a[href], input, select, [role="button"], [data-action], .provider-btn')) {
    if (!visible(el) || el.disabled) continue;
    // A checkbox or radio is tapped through the label around it.
    const hit = /^(checkbox|radio)$/.test(el.type) ? el.closest('label') ?? el : el;
    const r = hit.getBoundingClientRect();
    // Clipped inside a scrolling list is fine; outside the window is not.
    if (r.bottom <= 0 || r.top >= vh) continue; // parked off-screen on purpose (e.g. the top bar on the menus)
    if (r.right > vw + 1 || r.left < -1 || r.top < -1) { if (!el.closest('.win-body, .saves-list, .nation-list, .era-list, .admin-table-wrap, .side-panel, .launcher-panel, .launcher, .panel-body, #province-panel, .menu-panel, .screen-left')) offscreen.push(name(el)); }
    if (Math.min(r.width, r.height) < MIN_TAP - 0.5) small.push(`${name(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || seen.has(el) || !n.textContent.trim() || !visible(el)) continue;
    seen.add(el);
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < MIN_TEXT - 0.01) tiny.push(`${name(el)} ${fs}px`);
  }
  return { overflow, small, offscreen, tiny };
}, { MIN_TAP, MIN_TEXT });

/** Synthetic touch pointers on the map canvas (pointerType "touch"). */
const touch = {
  async down(page, id, x, y) { await page.evaluate(([id, x, y]) => document.getElementById('map-canvas').dispatchEvent(new PointerEvent('pointerdown', { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, isPrimary: id === 1, bubbles: true, buttons: 1 })), [id, x, y]); },
  async move(page, id, x, y) { await page.evaluate(([id, x, y]) => document.getElementById('map-canvas').dispatchEvent(new PointerEvent('pointermove', { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, isPrimary: id === 1, bubbles: true, buttons: 1 })), [id, x, y]); },
  async up(page, id, x, y) { await page.evaluate(([id, x, y]) => document.getElementById('map-canvas').dispatchEvent(new PointerEvent('pointerup', { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, isPrimary: id === 1, bubbles: true })), [id, x, y]); },
};

async function run(browserName, deviceName, orient) {
  const D = DEVICES[deviceName];
  const [w, h] = orient === 'portrait' ? [D.w, D.h] : [D.h, D.w];
  const tag = `${browserName}-${deviceName}-${orient}`;
  console.log(`\n== ${tag} (${w}×${h})`);
  const browser = await BROWSERS[browserName]();
  const errors = [];
  const ctxOpts = { viewport: { width: w, height: h }, screen: { width: w, height: h }, deviceScaleFactor: D.dpr, isMobile: true, hasTouch: true, userAgent: D.ua };
  const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${tag}-${name}.png` }); };
  const issues = { small: new Set(), tiny: new Set(), offscreen: new Set() };
  const look = async (page, where) => {
    const a = await audit(page);
    check(!a.overflow, `${where}: no sideways overflow`);
    check(!a.offscreen.length, `${where}: every control on screen${a.offscreen.length ? ` (off: ${a.offscreen.slice(0, 4).join(', ')})` : ''}`);
    for (const k of ['small', 'tiny']) for (const x of a[k]) issues[k].add(`${where}: ${x}`);
  };

  // --- Sign-in and Pending (real sign-in flow, fake server) ---
  {
    const ctx = await browser.newContext(ctxOpts);
    await ctx.addInitScript(mock);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}?era=ww2`);
    await page.waitForSelector('.provider-btn', { timeout: 30000 });
    await page.waitForTimeout(500);
    await look(page, 'sign-in');
    await shot(page, '1-signin');
    await page.tap('[data-provider="discord"]');
    await page.waitForSelector('text=Pending approval', { timeout: 20000 });
    await page.waitForTimeout(400);
    await look(page, 'pending');
    await shot(page, '2-pending');
    await ctx.close();
  }

  // --- The game (demo sign-in on localhost) ---
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}?era=ww2`);
  await page.waitForSelector('[data-action="demo"]', { timeout: 30000 });
  await page.tap('[data-action="demo"]');
  await page.waitForSelector('#main-menu:not([hidden])');
  await page.waitForTimeout(400);
  await look(page, 'main menu');
  await shot(page, '3-menu');
  await page.tap('[data-menu="settings"]');
  await page.waitForSelector('#settings-screen:not([hidden])');
  await look(page, 'settings');
  await page.tap('#settings-screen [data-back]');
  await page.tap('[data-menu="load"]');
  await page.waitForSelector('#saves-screen:not([hidden])');
  await look(page, 'load game');
  await page.tap('#saves-screen [data-back]');
  await page.tap('[data-menu="single"]');
  // First single-player game: the tutorial offer (step 12). Skip it.
  await page.waitForSelector('#tutorial-offer:not([hidden]), #era-screen:not([hidden])');
  if (await page.locator('#tutorial-offer:not([hidden])').count()) await page.tap('[data-offer="skip"]');
  await page.waitForSelector('#era-screen:not([hidden])');
  await look(page, 'era select');
  await page.tap('[data-era="ww2"]');
  await page.waitForSelector('#start-screen:not([hidden]) .nation-row', { timeout: 30000 });
  await page.fill('#nation-search', 'German');
  await page.tap('.nation-row');
  await page.waitForTimeout(300);
  await look(page, 'nation select');
  await shot(page, '4-nation');
  await page.evaluate(() => document.getElementById('btn-deploy').scrollIntoView());
  await page.tap('#btn-deploy');
  await page.waitForFunction(() => document.body.classList.contains('in-game'));
  await page.evaluate(() => { const im = window.ironMeridian; im.state.setSpeed(0); im.sim.diplomacy.propose = () => null; im.ai.enabled = false; });
  await page.waitForTimeout(1500);
  const quality = await page.evaluate(() => window.ironMeridian.renderer.quality);
  await look(page, 'game + province panel');
  await shot(page, '5-game');
  // Close the province panel.
  const closePanel = page.locator('#province-panel [data-action="close"]');
  if (await closePanel.isVisible()) { await closePanel.tap(); await page.waitForTimeout(300); }
  check(!(await page.locator('#province-panel').isVisible()) || await page.evaluate(() => window.ironMeridian.state.selectedProvinceId < 0), 'province panel closes');
  await look(page, 'game HUD');

  // Every command window: fits and closes.
  for (const id of ['army', 'production', 'buildings', 'research', 'diplomacy']) {
    await page.tap(`#command-bar [data-win="${id}"]`);
    const win = page.locator(`.win[data-id="${id}"], .win-${id}`).first();
    await win.waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(350);
    const r = await win.boundingBox();
    const close = win.locator('.win-close');
    const cr = await close.boundingBox();
    check(r && r.x >= -1 && r.y >= -1 && r.x + r.width <= w + 1 && r.y + r.height <= h + 1, `${id} window fits the screen (${r ? `${Math.round(r.width)}×${Math.round(r.height)} at ${Math.round(r.x)},${Math.round(r.y)}` : 'none'})`);
    check(cr && cr.x >= 0 && cr.y >= 0 && cr.x + cr.width <= w && cr.y + cr.height <= h, `${id} window close button on screen`);
    await look(page, `${id} window`);
    if (id === 'research') await shot(page, '6-window');
    await close.tap();
    await page.waitForTimeout(250);
    check(!(await win.isVisible()), `${id} window closes`);
  }

  // Touch: pan with one finger, pinch with two, hold two fingers for a selection box.
  const cam = () => page.evaluate(() => { const c = window.ironMeridian.camera; return { x: c.x, y: c.y, zoom: c.zoom }; });
  const cx = Math.round(w / 2), cy = Math.round(h / 2);
  let c0 = await cam();
  await touch.down(page, 1, cx, cy);
  for (let i = 1; i <= 8; i++) { await touch.move(page, 1, cx - i * 15, cy - i * 6); await page.waitForTimeout(16); }
  await touch.up(page, 1, cx - 120, cy - 48);
  await page.waitForTimeout(400);
  let c1 = await cam();
  check(Math.hypot(c1.x - c0.x, c1.y - c0.y) > 5, `one-finger pan moves the map (${Math.round(Math.hypot(c1.x - c0.x, c1.y - c0.y))} units)`);
  await page.evaluate(() => { const c = window.ironMeridian.camera; c.zoom = c.targetZoom = c.refZoom * 1.2; });
  c0 = await cam();
  await touch.down(page, 1, cx - 30, cy);
  await touch.down(page, 2, cx + 30, cy);
  for (let i = 1; i <= 8; i++) { await touch.move(page, 1, cx - 30 - i * 12, cy); await touch.move(page, 2, cx + 30 + i * 12, cy); await page.waitForTimeout(16); }
  await touch.up(page, 1, cx - 126, cy); await touch.up(page, 2, cx + 126, cy);
  await page.waitForTimeout(400);
  c1 = await cam();
  check(c1.zoom > c0.zoom * 1.3, `pinch zooms in (×${(c1.zoom / c0.zoom).toFixed(2)})`);
  await page.evaluate(() => { const { state, camera, sim } = window.ironMeridian; const me = state.playerNationId; const a = [...sim.armies.list.values()].find((x) => x.nation === me && !x.garrison); const p = sim.armies.armyPos(a); camera.x = p.x; camera.y = p.y; camera.zoom = camera.targetZoom = camera.refZoom * 3; window.ironMeridian.renderer.requestRender(); });
  await page.waitForTimeout(400);
  await touch.down(page, 1, cx - 80, cy - 80);
  await touch.down(page, 2, cx + 80, cy + 80);
  await page.waitForTimeout(700); // hold still: long press starts a box
  const boxed = await page.evaluate(() => !!window.ironMeridian.renderer.selectBox);
  await touch.move(page, 2, cx + 100, cy + 100);
  await touch.up(page, 2, cx + 100, cy + 100); await touch.up(page, 1, cx - 80, cy - 80);
  await page.waitForTimeout(300);
  const picked = await page.evaluate(() => { const s = window.ironMeridian.state; return s.armyGroup?.size ?? (s.selectedArmyId >= 0 ? 1 : 0); });
  check(boxed, 'two-finger long press draws a selection box');
  check(picked >= 1, `the box selects armies (${picked})`);
  await page.evaluate(() => window.ironMeridian.state.setSelectedArmy(-1));

  // Safe areas: with the notch / home-bar insets the HUD stays clear of them.
  const S = D.safe[orient];
  await page.addStyleTag({ content: `:root { --safe-top: ${S.top}px !important; --safe-bottom: ${S.bottom}px !important; --safe-left: ${S.left}px !important; --safe-right: ${S.right}px !important; }` });
  await page.waitForTimeout(400);
  const clash = await page.evaluate((S) => {
    const vw = window.innerWidth, vh = window.innerHeight, out = [];
    const sel = '#topbar button, #topbar .player, #player-name, #speed-group, #resources .chip, #resources > *, #command-bar button, #statusbar > *, #score-widget, .style-toggle button, #btn-menu';
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || el.closest('[hidden]')) continue;
      if (r.top < S.top - 0.5 || r.bottom > vh - S.bottom + 0.5 || r.left < S.left - 0.5 || r.right > vw - S.right + 0.5) out.push(`${el.id || el.className || el.tagName} (${Math.round(r.left)},${Math.round(r.top)}–${Math.round(r.right)},${Math.round(r.bottom)})`);
    }
    return out;
  }, S);
  check(!clash.length, `safe areas (top ${S.top}, bottom ${S.bottom}, sides ${S.left}): HUD clear of the notch and home bar${clash.length ? ` — under it: ${clash.slice(0, 5).join('; ')}` : ''}`);
  await shot(page, '7-safe-area');

  // Frame rate on the main map with Auto graphics, while the map pans and the game runs.
  await page.evaluate(() => { const im = window.ironMeridian; im.ai.enabled = true; im.state.setSpeed(4); im.camera.zoom = im.camera.targetZoom = im.camera.refZoom * 1.5; });
  const fps = await page.evaluate(() => new Promise((resolve) => {
    const cam = window.ironMeridian.camera;
    const times = [];
    let last = performance.now(), t0 = last, dir = 1;
    const step = (now) => {
      times.push(now - last); last = now;
      cam.panBy(dir * 6, 0); if ((now - t0) % 2000 < 20) dir = -dir;
      window.ironMeridian.renderer.requestRender();
      if (now - t0 < 4000) requestAnimationFrame(step); else {
        const s = times.slice(5).sort((a, b) => a - b);
        resolve({ median: 1000 / s[Math.floor(s.length / 2)], p95ms: s[Math.floor(s.length * 0.95)], quality: window.ironMeridian.renderer.quality });
      }
    };
    requestAnimationFrame(step);
  }));
  console.log(`     fps (Auto → ${quality}, now ${fps.quality}): median ${fps.median.toFixed(0)}, p95 frame ${fps.p95ms.toFixed(1)} ms`);
  check(!errors.length, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  results.push({ tag, w, h, quality, fps: fps.median, p95: fps.p95ms, small: [...issues.small], tiny: [...issues.tiny] });
  if (SHOTS) writeFileSync(`${SHOTS}/${tag}-issues.json`, JSON.stringify({ small: [...issues.small], tiny: [...issues.tiny] }, null, 1));
  for (const k of ['small', 'tiny']) {
    const list = [...issues[k]];
    check(!list.length, `${k === 'small' ? `tap targets ≥ ${MIN_TAP} px` : `text ≥ ${MIN_TEXT} px`}${list.length ? ` — ${list.length}: ${list.slice(0, 8).join('; ')}${list.length > 8 ? ' …' : ''}` : ''}`);
  }
  await browser.close();
}

const browsers = arg('browser') ? [arg('browser')] : ['chromium', 'webkit'];
const devices = arg('device') ? [arg('device')] : ['iphone', 'ipad'];
const orients = arg('orient') ? [arg('orient')] : ['portrait', 'landscape'];
// Headless WebKitGTK here renders without a GPU (Mesa software) and its page process
// occasionally dies mid-run; such a run is repeated once, and reported.
const retried = [];
for (const b of browsers) for (const d of devices) for (const o of orients) {
  for (let attempt = 1; ; attempt++) {
    const before = failures;
    try { await run(b, d, o); break; } catch (e) {
      const crashed = /Target crashed|Target page, context or browser has been closed/.test(e.message);
      if (crashed && attempt === 1 && b === 'webkit') { failures = before; retried.push(`${b}-${d}-${o}`); console.log(`RETRY ${b}-${d}-${o}: WebKit's page process crashed (${e.message.split('\n')[0]})`); continue; }
      failures++; console.log(`FAIL ${b}-${d}-${o}: ${e.message.split('\n')[0]}`); break;
    }
  }
}
if (retried.length) console.log(`WebKit page-process crashes retried: ${retried.join(', ')}`);
console.log('\nfps with Auto graphics (headless, software rendering on this machine):');
for (const r of results) console.log(`  ${r.tag.padEnd(28)} ${`${r.w}×${r.h}`.padEnd(10)} Auto → ${r.quality.padEnd(7)} median ${r.fps.toFixed(0)} fps, p95 ${r.p95.toFixed(1)} ms`);
console.log(failures ? `${failures} failure(s)` : 'all device checks passed');
process.exit(failures ? 1 : 0);
