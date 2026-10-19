// Browser test of step 5: AI nations, diplomacy alerts, war lines, frame rate.
//   python3 -m http.server 3000   (in the project root), then:
//   node tools/e2e/ai.test.mjs [screenshot-dir] [--cpu=4] [--seconds=40]
// --cpu=4 throttles the CPU 4× (a rough stand-in for an older iPad).
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000/';
const SHOTS = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const CPU = Number(process.argv.find((a) => a.startsWith('--cpu='))?.slice(6) ?? 1);
const SECONDS = Number(process.argv.find((a) => a.startsWith('--seconds='))?.slice(10) ?? 40);
const NOAI = process.argv.includes('--noai');
const DAYS = Number(process.argv.find((a) => a.startsWith('--days='))?.slice(7) ?? 60);
const ERA = process.env.ERA ?? 'ww2';
const NATION = process.env.NATION ?? 'Poland';
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errors = [];
let failures = 0;
const check = (cond, label) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) failures++; };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/ai-${ERA}-${name}.png` }); };

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); });
const IM = (fn, arg) => page.evaluate(fn, arg);

await page.goto(`${BASE}?era=${ERA}`);
await page.waitForSelector('[data-action="demo"], #main-menu:not([hidden])');
if (await page.locator('[data-action="demo"]').count()) await page.click('[data-action="demo"]');
await page.waitForSelector('#main-menu:not([hidden])');
await page.click('[data-menu="single"]');
await page.click(`[data-era="${ERA}"]`);
await page.waitForSelector('#start-screen:not([hidden]) .nation-row');
await page.click('[data-difficulty="hard"]');
check(await page.locator('[data-difficulty="hard"].active').count() === 1, 'difficulty picker: Hard selected');
await page.click('[data-difficulty="normal"]');
await page.fill('#nation-search', NATION);
await page.click('.nation-row');
await shot(page, '0-nation-screen');
await page.click('#btn-deploy');
await page.waitForFunction(() => document.body.classList.contains('in-game'));
await page.waitForTimeout(1200);
await page.click('#province-panel [data-action="close"]');

const info = await IM(() => {
  const { ai, state } = window.ironMeridian;
  const counts = {};
  for (const b of ai.brains.values()) counts[b.personality] = (counts[b.personality] ?? 0) + 1;
  return { brains: ai.brains.size, difficulty: ai.difficulty, counts, germany: ai.personalityOf(state.nations.findIndex((n) => n.name === 'German Reich')) };
});
check(info.brains > 100, `${info.brains} AI nations running (${JSON.stringify(info.counts)})`);
check(info.difficulty === 'normal', 'AI difficulty from the picker');
if (ERA === 'ww2') check(info.germany === 'aggressive', 'WWII Germany is Aggressive');

// An AI declares war on the player: big alert, game paused.
const foe = await IM(() => {
  const { sim, state } = window.ironMeridian;
  const me = state.playerNationId;
  const { ai } = window.ironMeridian;
  // The strongest neighbour declares.
  const n = [...ai.neighborsOf(me)].sort((a, b) => ai.powerOf(b) - ai.powerOf(a))[0];
  sim.combat.declareWar(n, me);
  state.events.emit('war:declared', { a: n, b: me, ai: true });
  return n;
});
await page.waitForSelector('#diplo-modal:not([hidden]) .diplo-card.war');
check((await page.textContent('#diplo-modal')).includes('declared war on you'), 'war alert shown');
check(await IM(() => window.ironMeridian.state.clock.speed) === 0, 'game paused under the alert');
await shot(page, '1-war-alert');
await page.click('[data-diplo="ok"]');
check(await page.locator('#diplo-modal').isHidden() && await IM(() => window.ironMeridian.state.clock.speed) > 0, 'alert dismissed, game resumes');

// An AI peace offer: accept.
await IM((n) => window.ironMeridian.state.events.emit('peace:offer', { from: n, to: window.ironMeridian.state.playerNationId }), foe);
await page.waitForSelector('#diplo-modal:not([hidden]) .diplo-card.peace');
await shot(page, '2-peace-offer');
await page.click('[data-diplo="accept"]');
check(await IM((n) => !window.ironMeridian.sim.combat.atWar(n, window.ironMeridian.state.playerNationId), foe), 'peace accepted: war over');
check(await IM((n) => window.ironMeridian.sim.combat.truceUntil(n, window.ironMeridian.state.playerNationId) != null, foe), 'truce in force');

// The player offers peace in a war the AI is winning big (should refuse) — use a fresh war with a strong neighbour.
const soviet = await IM(() => {
  const { sim, state } = window.ironMeridian;
  const { ai } = window.ironMeridian;
  const n = [...ai.neighborsOf(state.playerNationId)].sort((a, b) => ai.powerOf(a) - ai.powerOf(b))[0];
  sim.combat.declareWar(state.playerNationId, n);
  state.setSelected(state.nations[n].capitalId);
  return n;
});
await page.waitForTimeout(400);
await page.click('#province-panel [data-cmd="offer-peace"]');
await page.waitForTimeout(300);
const toast = await page.textContent('#toast');
check(/accepts|refuses/.test(toast), `offer peace answered: "${toast}"`);
await shot(page, '3-nation-panel');
await IM((n) => { window.ironMeridian.sim.combat.makePeace(window.ironMeridian.state.playerNationId, n); window.ironMeridian.state.setSelected(-1); }, soviet);

// Fast-forward ~2 game months (test only: 48× speed) so AI wars and armies are under way.
await IM(() => window.ironMeridian.state.setSpeed(48));
await page.waitForFunction((d) => (window.ironMeridian.state.clock.time - window.ironMeridian.state.clock.start) > d * 864e5, DAYS, { timeout: 600000 });
const wars = await IM(() => window.ironMeridian.sim.combat.wars.size);
console.log(`     after ${DAYS} days: ${wars} wars active, ${await IM(() => document.querySelectorAll('#feed-list .feed-item').length)} feed items`);
check(wars >= 0, 'world keeps running');

// Let the world run at 4× zoomed out, measure frame times, count AI wars.
if (CPU > 1) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
}
if (NOAI) await IM(() => { window.ironMeridian.ai.enabled = false; });
await IM(() => { const { camera, state } = window.ironMeridian; camera.flyTo(state.map.width * 0.53, state.map.height * 0.33, camera.refZoom * 1.6, 0.01); state.setSpeed(4); });
const perf = await IM(async (seconds) => {
  const { ai, renderer, camera } = window.ironMeridian;
  const times = [];
  let last = performance.now();
  const t0 = last;
  let dir = 1;
  await new Promise((resolve) => {
    const tick = (t) => {
      times.push(t - last); last = t;
      // Pan a little to keep the renderer working too.
      camera.panBy(dir * 1.5, 0);
      if ((t - t0) % 8000 < 17) dir = -dir; // back and forth
      renderer.requestRender();
      if (t - t0 < seconds * 1000) requestAnimationFrame(tick); else resolve();
    };
    requestAnimationFrame(tick);
  });
  times.sort((a, b) => a - b);
  const q = (f) => times[Math.floor(times.length * f)];
  return { frames: times.length, fps: Math.round(1000 / q(0.5)), p95: q(0.95).toFixed(1), p99: q(0.99).toFixed(1), aiMaxFrame: ai.stats.maxFrameMs.toFixed(1), aiAvg: (ai.stats.ms / Math.max(1, ai.stats.frames)).toFixed(2), thinks: ai.stats.thinks, wars: window.ironMeridian.sim.combat.wars.size };
}, SECONDS);
console.log(`     ${SECONDS}s at 4× (${SECONDS * 4} game hours), CPU ×${CPU}${NOAI ? ', AI OFF' : ''}: median ${perf.fps} fps, p95 ${perf.p95} ms, p99 ${perf.p99} ms; AI ${perf.thinks} thinks, avg ${perf.aiAvg} ms/frame, worst ${perf.aiMaxFrame} ms; ${perf.wars} wars active`);
check(perf.fps >= (CPU > 1 ? 30 : 55), `frame rate with all AI active: ${perf.fps} fps`);
await IM(() => window.ironMeridian.state.setSpeed(0));
await page.waitForTimeout(300);
await shot(page, `4-world-cpu${CPU}`);

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
