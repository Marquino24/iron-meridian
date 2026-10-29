// Browser test of the first-game tutorial (step 12): the offer on the first
// single-player game, then the whole tutorial played by tapping wherever the
// coach's ring points (so the highlights must be on the real buttons and
// places, and nothing may cover them). At every step the coach must not
// overlap its target. Then Skip, replay from Settings, first-open tips and
// the How to play page.
//   python3 -m http.server 3000   (in the project root), then:
//   node tools/e2e/tutorial.test.mjs [screenshot-dir] [--browser=chromium|webkit] [--device=desktop|iphone|android] [--orient=portrait|landscape]
import { chromium, webkit } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000/';
const SHOTS = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const BROWSER = arg('browser', 'chromium');
const DEVICE = arg('device', 'desktop');
const ORIENT = arg('orient', 'portrait');
const DEVICES = {
  desktop: { viewport: { width: 1440, height: 900 } },
  iphone: { w: 390, h: 844, dpr: 3, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' },
  android: { w: 412, h: 915, dpr: 2.625, ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36' },
};
const d = DEVICES[DEVICE];
const touch = DEVICE !== 'desktop';
const view = touch
  ? { viewport: ORIENT === 'landscape' ? { width: d.h, height: d.w } : { width: d.w, height: d.h }, deviceScaleFactor: d.dpr, isMobile: BROWSER !== 'webkit' || true, hasTouch: true, userAgent: d.ua }
  : d;
if (touch && BROWSER === 'webkit') delete view.isMobile; // WebKit takes the viewport and touch as given
const tag = `${BROWSER}-${DEVICE}${touch ? `-${ORIENT}` : ''}`;

const browser = await (BROWSER === 'webkit' ? webkit.launch() : chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }));
const errors = [];
let failures = 0;
const check = (cond, label) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) failures++; };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${tag}-${name}.png` }); };
const overlap = (a, b, m = 0) => !!a && !!b && a.x0 < b.x1 + m && a.x1 > b.x0 - m && a.y0 < b.y1 + m && a.y1 > b.y0 - m;
const center = (r) => ({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });

const ctx = await browser.newContext(view);
const page = await ctx.newPage();
if (process.env.TUT_LOG) await page.addInitScript(() => { window.__ev = []; for (const t of ['pointerdown', 'pointerup', 'pointercancel', 'click', 'touchstart', 'touchend']) window.addEventListener(t, (e) => { window.__ev.push(`${t}:${e.target.id || e.target.className}`); if (window.__ev.length > 40) window.__ev.shift(); }, true); });
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|404|Failed to load resource/.test(m.text())) errors.push(m.text()); });
const tap = async (x, y) => { if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); };
const press = async (sel) => { if (touch) await page.tap(sel); else await page.click(sel); };
const snap = () => page.evaluate(() => window.ironMeridian.tutorial.snapshot());

await page.goto(`${BASE}?era=ww2`);
await page.waitForSelector('[data-action="demo"], #main-menu:not([hidden])');
if (await page.locator('[data-action="demo"]').count()) await press('[data-action="demo"]');
await page.waitForSelector('#main-menu:not([hidden])');

// 1. First single-player game: the offer, with a clear Skip.
await press('[data-menu="single"]');
await page.waitForSelector('#tutorial-offer:not([hidden])');
check(/Play the tutorial/.test(await page.textContent('#tutorial-offer')) && /Skip/.test(await page.textContent('#tutorial-offer')), 'first Single Player: tutorial offered, with Skip');
await shot(page, 't0-offer');
await press('[data-offer="play"]');
await page.waitForFunction(() => window.ironMeridian.tutorial.active, null, { timeout: 30000 });
const start = await page.evaluate(() => { const im = window.ironMeridian; return { era: im.state.map.era.id, me: im.state.playerNation.name, ai: im.ai.enabled }; });
check(start.era === 'medieval' && start.me === 'León' && start.ai === false, `tutorial scenario: ${start.me}, ${start.era}, computer nations passive`);

// 2. Play it: tap where the ring points; Next on read-only steps.
const t0 = Date.now();
const seen = [];
const shots = { resources: 't1-resources', war: 't2-war', peace: 't3-peace' };
let dbg = 0, last = '', lastAt = 0, covered = 0, stepAt = Date.now();
while (Date.now() - t0 < 240000) {
  if (await page.locator('#tutorial-done:not([hidden])').count()) break;
  let s = await snap();
  if (!s.active) break;
  if (seen.at(-1) !== s.id) { seen.push(s.id); stepAt = Date.now(); if (process.env.TUT_LOG) console.log(JSON.stringify(await page.evaluate(() => window.ironMeridian.commands.log.slice(-4).map((c) => [c.kind, c.payload, c.ok])))); console.log(`     step ${s.index + 1}/${s.count}: ${s.id}`); }
  if (Date.now() - stepAt > 60000) {
    console.log(`FAIL stuck at ${s.id}: ${JSON.stringify(s)}`);
    console.log(JSON.stringify(await page.evaluate(() => window.ironMeridian.commands.log.slice(-10).map((c) => [c.kind, c.payload, c.ok, c.error]))));
    console.log(JSON.stringify(await page.evaluate(() => { const im = window.ironMeridian, t = im.tutorial; const r = t.ring.getBoundingClientRect(); const x = (r.left + r.right) / 2, y = (r.top + r.bottom) / 2; const el = document.elementFromPoint(x, y);
      return { all: document.elementsFromPoint(x, y).slice(0, 5).map((e) => `${e.tagName}#${e.id}.${e.className}`), actives: [...document.querySelectorAll('.active')].map((e) => { const r = e.getBoundingClientRect(); return `${e.tagName}.${e.className}[${e.dataset.style ?? e.dataset.speed ?? ''}] ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`; }), ev: window.__ev?.slice(-6), pointers: im.input.pointers.size, drag: im.input.drag, pinch: !!im.input.pinch, zoom: im.camera.zoom, maxZoom: im.camera.maxZoom, el: el && `${el.tagName}#${el.id}.${el.className}`, probe: t.probe(x, y), selArmy: im.state.selectedArmyId, selProv: im.state.selectedProvinceId }; })));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${tag}-stuck-${s.id}.png` });
    break;
  }
  // Let flights and windows settle: the ring must hold still before a tap.
  await page.waitForTimeout(250);
  const s2 = await snap();
  if (s2.id !== s.id || JSON.stringify(s2.ring) !== JSON.stringify(s.ring)) continue;
  s = s2;
  if (s.ring && overlap(s.coach, s.ring)) { covered++; console.log(`FAIL coach covers its target at ${s.id} (${s.hint})`); }
  if (shots[s.id] && !s.wait && (s.next || s.ring)) { await shot(page, shots[s.id]); delete shots[s.id]; }
  if (s.next) { await press('.coach [data-coach="next"]'); continue; }
  if (s.wait || !s.ring) { await page.waitForTimeout(400); continue; }
  const key = `${s.id}|${s.hint}`;
  if (key === last && Date.now() - lastAt < 3000) { await page.waitForTimeout(300); continue; }
  last = key; lastAt = Date.now();
  const c = center(s.ring);
  if (process.env.TUT_DEBUG && SHOTS) await page.screenshot({ path: `${SHOTS}/${tag}-dbg-${String(++dbg).padStart(3, '0')}-${s.id}.png` });
  // A marker drifted over the spot since the coach chose it (armies move): try again shortly.
  const probe = await page.evaluate(([x, y]) => window.ironMeridian.tutorial.probe(x, y), [c.x, c.y]);
  if (s.map && !s.army && probe.marker) { last = ''; await page.waitForTimeout(300); continue; }
  if (process.env.TUT_LOG) console.log('     tap', s.hint, JSON.stringify(await page.evaluate(([x, y]) => window.ironMeridian.tutorial.probe(x, y), [c.x, c.y])));
  await tap(c.x, c.y);
  await page.waitForTimeout(300);
}
const secs = ((Date.now() - t0) / 1000).toFixed(0);
const steps = await page.evaluate(() => window.ironMeridian.tutorial.steps.map((s) => s.id));
check(await page.locator('#tutorial-done:not([hidden])').count() === 1, `tutorial completed in ${secs} s of play: ${seen.join(' → ')}`);
check(steps.every((id) => seen.includes(id)), `every step was shown (${steps.length})`);
check(covered === 0, 'the coach never covered its target');
const after = await page.evaluate(() => { const im = window.ironMeridian, st = im.state; const me = st.playerNationId; const foe = st.nations.find((n) => n.name === 'Castilla').id;
  return { atWar: im.sim.combat.atWar(me, foe), kept: st.provinces.filter((p) => p.owner === me && p.homeOf === foe).length, research: im.sim.research.of(me).active.length, ai: im.ai.enabled }; });
check(!after.atWar && after.kept >= 1 && after.research >= 1, `outcome: peace with Castilla, kept ${after.kept} province(s), ${after.research} research running`);
await shot(page, 't4-ready');
await press('[data-done="stay"]');
await page.waitForSelector('body[data-screen="game"]');
check(await page.evaluate(() => window.ironMeridian.ai.enabled && window.ironMeridian.state.phase === 'playing'), '"Keep playing": a normal game (computer nations on)');

// 3. First-open tip in a window (not during the tutorial), dismissed for good.
const tipWin = touch ? 'army' : 'production';
await press(`#command-bar [data-win="${tipWin}"]`);
await page.waitForSelector(`.win-${tipWin} .first-tip`);
check(true, `${tipWin} window: first-open tip shown`);
await shot(page, 't5-tip');
await press(`.win-${tipWin} [data-tip-ok]`);
check(await page.locator(`.win-${tipWin} .first-tip`).count() === 0, 'tip dismissed with Got it');
await press(`.win-${tipWin} .win-close`);
await press(`#command-bar [data-win="${tipWin}"]`);
check(await page.locator(`.win-${tipWin} .first-tip`).count() === 0, 'tip stays dismissed on the next open');
await press(`.win-${tipWin} .win-close`);

// 4. Settings: How to play, Show tips again, Replay the tutorial, then Skip.
await press('#btn-menu');
await page.waitForSelector('#main-menu:not([hidden])');
await press('[data-menu="settings"]');
await press('[data-help="open"]');
await page.waitForSelector('#help-screen:not([hidden])');
const help = await page.textContent('#help-screen');
check(/Controls/.test(help) && /war score/i.test(help) && /Integration/.test(help) && /pending/.test(help) && /keep running while you're away/.test(help), 'How to play: controls, core loop, war score / peace / integration, multiplayer');
await shot(page, 't6-help');
await press('#help-screen [data-back]');
await page.waitForSelector('#settings-screen:not([hidden])');
await press('[data-help="tips"]');
check(await page.evaluate(() => Object.keys(window.ironMeridian.onboarding.data.tips).length === 0), 'Show tips again: tips reset');
await press('[data-help="tutorial"]');
await page.waitForFunction(() => window.ironMeridian.tutorial.active && window.ironMeridian.tutorial.step === 0, null, { timeout: 30000 });
check(true, 'Replay the tutorial from Settings');
await page.waitForSelector('.coach:not([hidden])');
await press('.coach [data-coach="skip"]');
check(await page.evaluate(() => !window.ironMeridian.tutorial.active && window.ironMeridian.ai.enabled), 'Skip tutorial: coach gone, a normal game');

// 5. Second visit to Single Player: no offer.
await press('#btn-menu');
await page.waitForSelector('#main-menu:not([hidden])');
await press('[data-menu="single"]');
await page.waitForSelector('#era-screen:not([hidden])');
check(await page.locator('#tutorial-offer:not([hidden])').count() === 0 && await page.locator('#era-screen [data-tutorial]').isVisible(), 'no offer the second time; the Tutorial card stays on the era screen');

check(!errors.length, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
console.log(failures ? `${failures} failure(s)` : `all tutorial checks passed (${tag})`);
process.exit(failures ? 1 : 0);
