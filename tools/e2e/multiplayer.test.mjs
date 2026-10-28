// Two-account multiplayer test (step 11B), with the fake Supabase client: two
// tabs signed in as two players, one game. Lobby → join two nations → start →
// both enter; orders from both land through on-demand ticks (pending →
// applied), a bad order is rejected with its reason, fog of war, pause, and a
// stretch of scheduled ticks with nobody online while the computer runs the rest.
// The "server" here is the real js/game-server.js inside the fake client.
//   python3 -m http.server 3000   (in the project root), then:
//   node tools/e2e/multiplayer.test.mjs [screenshot-dir]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000/';
const SHOTS = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const mock = fs.readFileSync(new URL('./mock-supabase.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errors = [];
let failures = 0;
const check = (cond, label) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) failures++; };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
await ctx.addInitScript(`window.__mockSessionPerTab = true; window.__mockOwners = ['owner@example.com', 'second@example.com']; window.__mockTickCooldownMs = 1500;\n${mock}`);
async function player(email, name) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
  await page.goto(BASE + '?era=ww2');
  await page.waitForSelector('.provider-btn');
  await page.evaluate(([e, n]) => { window.__mockNextEmail = e; window.__mockNextName = n; }, [email, name]);
  await page.click('[data-provider="google"]');
  await page.waitForSelector('#main-menu:not([hidden])', { timeout: 60000 });
  return page;
}
const A = await player('owner@example.com', 'Ada');
const B = await player('second@example.com', 'Bea');
check(true, 'two accounts signed in, one per tab');

// Ada creates a 3-player game (so it waits to be started), both join.
await A.click('[data-menu="multi"]');
await A.waitForSelector('[data-lobby="create"]');
await A.click('[data-lobby="create"]');
await A.fill('.lobby-form [name="name"]', 'Two fronts');
await A.selectOption('.lobby-form [name="era"]', 'ww2');
await A.fill('.lobby-form [name="players"]', '3');
await A.click('.lobby-form [type="submit"]');
await A.waitForSelector('.lobby-nation');
await A.fill('#lobby-filter', 'German Reich');
await A.click('.lobby-nation:has-text("German Reich")');
await A.click('[data-lobby="join"]');
await A.waitForSelector('[data-lobby="start"]');

await B.click('[data-menu="multi"]');
await B.waitForSelector('.lobby-open:has-text("Two fronts")');
await B.click('.lobby-open:has-text("Two fronts")');
await B.waitForSelector('.lobby-nation');
await B.fill('#lobby-filter', 'France');
check(await B.locator('.lobby-nation:has-text("German Reich")').count() === 0 || await B.locator('.lobby-nation[disabled]:has-text("German Reich")').count() === 1, 'German Reich taken for Bea');
await B.click('.lobby-nation:has-text("France") >> nth=0');
await B.click('[data-lobby="join"]');
await B.waitForSelector('.lobby-seat');
check(/waiting for the creator/i.test(await B.textContent('.lobby-body')), 'Bea waits for Ada to start');
await shot(B, 'mp1-lobby-waiting');

// Ada starts; both enter.
await A.click('[data-lobby="start"]');
await A.waitForSelector('[data-lobby="enter"]');
await A.click('[data-lobby="enter"]');
await A.waitForFunction(() => document.body.classList.contains('mp') && window.ironMeridian.mpClient?.tick >= 1, null, { timeout: 60000 })
  .catch(async (e) => { console.log('A lobby:', await A.evaluate(() => JSON.stringify({ mp: document.body.classList.contains('mp'), tick: window.ironMeridian.mpClient?.tick, game: window.ironMeridian.mpClient?.game?.status, screen: document.body.dataset.screen, toast: document.getElementById('toast').textContent, db: Object.keys(JSON.parse(localStorage.getItem('mock-supabase')).views ?? {}) })), errors); throw e; });
await B.click('[data-lobby="list"]');
await B.waitForSelector('.lobby-open:has-text("Two fronts")');
await B.click('.lobby-open:has-text("Two fronts")');
await B.waitForSelector('[data-lobby="enter"]');
await B.click('[data-lobby="enter"]');
await B.waitForFunction(() => document.body.classList.contains('mp') && window.ironMeridian.mpClient?.tick >= 1, null, { timeout: 60000 });
for (const p of [A, B]) await p.evaluate(() => { window.ironMeridian.mpClient.net.tickCooldownMs = 1800; });
const me = (p) => p.evaluate(() => window.ironMeridian.state.playerNation.name);
check(await me(A) === 'German Reich' && await me(B) === 'France', `Ada plays ${await me(A)}, Bea plays ${await me(B)}`);
check(/RUNNING/.test(await A.textContent('#mp-bar')), 'game bar: RUNNING');

// Fog of war: each sees its own armies, few foreign ones.
const fog = await B.evaluate(() => {
  const { state, sim } = window.ironMeridian;
  const all = [...sim.armies.list.values()];
  return { mine: all.filter((a) => a.nation === state.playerNationId).length, foreign: all.length - all.filter((a) => a.nation === state.playerNationId).length, ai: sim.ai.enabled };
});
const aGerman = await A.evaluate(() => [...window.ironMeridian.sim.armies.list.values()].filter((a) => a.nation === window.ironMeridian.state.playerNationId).length);
check(fog.mine > 0 && fog.foreign < 120 && !fog.ai, `Bea's view: ${fog.mine} French armies, ${fog.foreign} foreign armies in sight (the world has hundreds); no computer players in the browser`);
check(aGerman > 0, `Ada's view: ${aGerman} German armies`);

// Orders from both: Ada moves an army, Bea recruits in Paris; Bea also tries to move a German army.
const order = (p, kind, payload) => p.evaluate(([k, pl]) => window.ironMeridian.commands.issue(k, pl), [kind, payload]);
const deMove = await A.evaluate(() => {
  const { state, sim } = window.ironMeridian;
  const a = [...sim.armies.list.values()].find((x) => x.nation === state.playerNationId && !x.garrison && x.kind === 'land' && !x.seg);
  const to = state.provinces.find((p) => p.owner === state.playerNationId && p.neighbors.includes(a.node));
  return { army: a.id, to: to.id };
});
const r1 = await order(A, 'army.move', deMove);
check(r1.ok, 'Ada\'s move answers at once (predicted locally)');
const paris = await B.evaluate(() => window.ironMeridian.state.playerNation.capitalId);
await order(B, 'unit.recruit', { province: paris, type: 'infantry' });
await order(B, 'army.move', { army: deMove.army, to: deMove.to });
check(await B.locator('#mp-orders .mpo').count() >= 1, 'Bea\'s orders listed');
await shot(A, 'mp2-orders-pending');
const statuses = (p) => p.evaluate(() => window.ironMeridian.mpClient.orders.map((o) => `${o.label}: ${o.status}${o.result ? ` (${o.result})` : ''}`));
await A.waitForFunction(() => window.ironMeridian.mpClient.orders.every((o) => o.status === 'applied' || o.status === 'rejected'), null, { timeout: 30000 }).catch(() => {});
await B.waitForFunction(() => window.ironMeridian.mpClient.orders.every((o) => o.status === 'applied' || o.status === 'rejected'), null, { timeout: 30000 }).catch(() => {});
const sa = await statuses(A), sb = await statuses(B);
check(sa.some((s) => /: applied/.test(s)), `Ada's orders: ${sa.join('; ')}`);
check(sb.some((s) => /Recruit .*: applied/.test(s)) && sb.some((s) => /rejected \(Not your army\.\)/.test(s)), `Bea's orders: ${sb.join('; ')}`);
check(/rejected: Not your army/.test(await B.textContent('#mp-orders')), 'the rejection and its reason shown in the orders list');
await shot(B, 'mp3-rejected');

// The server's state: the German army is moving, French infantry queued (both views updated).
const moved = await A.evaluate((id) => { const a = window.ironMeridian.sim.armies.list.get(id); return !!(a && (a.seg || a.path.length || a.dest != null)); }, deMove.army);
check(moved, 'Ada\'s army is on the move in the server\'s state');
const queued = await B.evaluate((pid) => (window.ironMeridian.sim.armies.queue(pid) ?? []).length, paris);
check(queued >= 1, `Bea's recruit queued in Paris (${queued})`);

// Nobody online: both leave; the schedule ticks four times (30 game hours each).
await A.click('#mp-bar [data-mp="menu"]');
await B.click('#mp-bar [data-mp="menu"]');
await A.waitForSelector('#lobby-screen:not([hidden])');
const gameId = await A.evaluate(() => JSON.parse(localStorage.getItem('mock-supabase')).games[0].id);
const t0 = await A.evaluate(() => JSON.parse(localStorage.getItem('mock-supabase')).games[0].game_time);
const server = await ctx.newPage();
await server.goto(BASE + '?era=ww2');
const ticks = [];
for (let i = 0; i < 4; i++) {
  await server.evaluate((g) => { const d = JSON.parse(localStorage.getItem('mock-supabase')); d.games[0].ticked_at = new Date(Date.now() - 5 * 60000).toISOString(); localStorage.setItem('mock-supabase', JSON.stringify(d)); }, gameId);
  ticks.push(await server.evaluate((g) => window.__mockScheduleTick(g), gameId));
}
const t1 = await A.evaluate(() => JSON.parse(localStorage.getItem('mock-supabase')).games[0].game_time);
check(ticks.every((t) => Math.abs(t.hours - 30) < 0.1), `4 scheduled ticks with nobody online: ${ticks.map((t) => `${t.hours} h in ${t.ms} ms`).join(', ')}`);
check(Math.abs((t1 - t0) / 864e5 - 5) < 0.05, `the world moved on ${((t1 - t0) / 864e5).toFixed(1)} game days while nobody was online`);
const ai = await server.evaluate(async () => {
  const [{ unpack, decode }, { fromB64 }] = await Promise.all([import('./js/save.js'), import('./js/game-server.js')]);
  const d = JSON.parse(localStorage.getItem('mock-supabase'));
  const s = decode((await unpack(fromB64(d.states[d.games[0].id].state))).state);
  const brains = new Map(s.ai.brains);
  return { brains: brains.size, humansFree: !brains.has(31) && !brains.has(4), units: s.armies.list.length };
});
check(ai.brains > 100 && ai.humansFree, `the computer runs ${ai.brains} nations, not the two players'`);

// Ada comes back: the newer state loads; she pauses; Bea sees it.
await A.click('.lobby-open:has-text("Two fronts")');
await A.waitForSelector('[data-lobby="enter"]');
await A.click('[data-lobby="enter"]');
await A.waitForFunction(() => window.ironMeridian.mpClient?.tick >= 5, null, { timeout: 60000 });
check(true, `Ada back in: tick ${await A.evaluate(() => window.ironMeridian.mpClient.tick)}`);
// Offers and alerts that came in while away pop up: answer them first.
const offers = await A.evaluate(() => { let n = 0; while (!document.getElementById('diplo-modal').hidden && n < 10) { document.querySelector('#diplo-modal [data-diplo="decline"], #diplo-modal [data-diplo]')?.click(); n++; } return n; });
console.log(`     ${offers} popup(s) waiting for Ada on her return`);
await A.click('#mp-bar [data-mp="pause"]');
await A.waitForFunction(() => /PAUSED/.test(document.getElementById('mp-bar').textContent));
await B.click('.lobby-open:has-text("Two fronts")');
await B.waitForSelector('[data-lobby="enter"]');
await B.click('[data-lobby="enter"]');
await B.waitForFunction(() => /PAUSED/.test(document.getElementById('mp-bar')?.textContent ?? ''), null, { timeout: 60000 });
await B.evaluate(() => { let n = 0; while (!document.getElementById('diplo-modal').hidden && n < 10) { document.querySelector('#diplo-modal [data-diplo="decline"], #diplo-modal [data-diplo]')?.click(); n++; } });
check(true, 'Bea enters the paused game: PAUSED, the clock stopped');
const blocked = await B.evaluate(async () => {
  const { commands, state, sim } = window.ironMeridian;
  const a = [...sim.armies.list.values()].find((x) => x.nation === state.playerNationId);
  commands.issue('army.stop', { army: a.id });
  await new Promise((r) => setTimeout(r, 800));
  return window.ironMeridian.mpClient.orders[0];
});
check(blocked.status === 'rejected' && /not running/.test(blocked.result ?? ''), `an order to a paused game: ${blocked.status} (${blocked.result})`);
await shot(B, 'mp4-paused');

check(!errors.length, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
console.log(failures ? `${failures} failure(s)` : 'all multiplayer checks passed');
process.exit(failures ? 1 : 0);
