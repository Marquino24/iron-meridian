// Browser test of step 10: integration of conquered land (panel, map overlay,
// unrest warning, revolt), war score, the peace window and AI peace demands.
//   python3 -m http.server 3000   (in the project root), then:
//   node tools/e2e/peace.test.mjs [screenshot-dir] [--mobile]
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

await page.goto(BASE + '?era=ww2');
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
await page.evaluate(() => { window.ironMeridian.ai.enabled = false; });
await page.waitForTimeout(1200);
await page.click('#province-panel [data-action="close"]');
const IM = (fn, arg) => page.evaluate(fn, arg);

// War on Poland; take Polish border provinces the way an army would (combat.capture).
const setup = await IM(() => {
  const { state, sim } = window.ironMeridian;
  const me = state.playerNationId;
  const pl = state.nations.find((n) => n.name.includes('Poland')).id;
  sim.combat.declareWar(me, pl);
  const cap = state.nations[pl].capitalId;
  const taken = [];
  // Breadth-first from the German border, skipping the capital.
  let frontier = state.provinces.filter((p) => p.owner === pl && p.id !== cap && p.neighbors.some((q) => state.provinces[q].owner === me));
  while (taken.length < 6 && frontier.length) {
    const next = [];
    for (const p of frontier) {
      if (taken.length >= 6 || p.owner !== pl) continue;
      sim.combat.capture(p, me);
      taken.push(p.id);
      for (const q of p.neighbors) if (state.provinces[q].owner === pl && q !== cap) next.push(state.provinces[q]);
    }
    frontier = next;
  }
  return { me, pl, taken, homes: state.provinces.filter((p) => p.homeOf === pl).length };
});
check(setup.taken.length >= 3, `took ${setup.taken.length} Polish provinces (Poland has ${setup.homes})`);
const integ = await IM((ids) => ids.map((id) => window.ironMeridian.state.provinces[id].integ), setup.taken);
check(integ.every((v) => Math.abs(v - 0.45) < 1e-9), `conquered land starts at 45%: ${integ.map((v) => v.toFixed(2)).join(', ')}`);

// Province panel: integration row.
await IM((id) => window.ironMeridian.state.setSelected(id), setup.taken[0]);
await page.waitForSelector('#province-panel dd.integ');
const row = await page.textContent('#province-panel dd.integ');
check(/45%/.test(row) && /full in \d+/.test(row), `panel shows integration: "${row.replace(/\s+/g, ' ').trim()}"`);
await shot(page, 'p1-integration-panel');

// Map overlay: the hatch pattern is on the static layer for these provinces.
check(await IM(() => !!window.ironMeridian.renderer.hatch), 'integration hatch pattern created');

// Days pass: integration climbs; Roads make it quicker.
const climb = await IM((ids) => {
  const { state, sim } = window.ironMeridian;
  const I = sim.integration, p = state.provinces[ids[0]], q = state.provinces[ids[1]];
  const days0 = I.daysLeft(p);
  sim.buildings.setLevel(q.id, 'roads', 2);
  const roadsDays = I.daysLeft(q);
  for (let d = 0; d < 30; d++) I.day();
  return { days0, roadsDays, after: p.integ };
}, setup.taken);
check(climb.days0 >= 90 && climb.days0 <= 125, `full integration in ${climb.days0} days`);
check(climb.after > 0.6 && climb.after < 0.65, `after 30 days: ${(climb.after * 100).toFixed(1)}%`);
console.log(`     with Roads 2: ${climb.roadsDays} days`);

// Unrest: an ungarrisoned, freshly taken province is warned about, then may revolt.
const unrest = await IM(() => {
  const { state, sim } = window.ironMeridian;
  const I = sim.integration;
  const p = state.provinces.find((x) => x.integ != null && x.integ < 1);
  if (p) p.integ = 0.5; // freshly taken
  if (!p || !I.restless(p)) return null;
  if (!p) return null;
  const before = I.stats.warnings;
  I.fresh = [];
  I.unrest(p, true);
  I.report(I.fresh);
  I.fresh = [];
  const feed = [...document.querySelectorAll('#feed-list .feed-item')].map((e) => e.textContent).find((t) => /Unrest in/.test(t)) ?? '';
  I.revolt(p);
  return { warned: I.stats.warnings - before, feed, owner: p.owner, home: p.homeOf, revolts: I.stats.revolts, integ: p.integ };
});
check(unrest && unrest.warned === 1 && /station troops/.test(unrest.feed), `unrest warning in the feed: "${unrest?.feed.trim()}"`);
check(unrest && unrest.owner === unrest.home && unrest.integ === undefined, 'revolt: the province rejoins Poland, whole');
await IM(() => window.ironMeridian.state.setSelected(-1));

// The peace window: war score, candidates, chance, a valid demand.
await IM((pl) => window.ironMeridian.peaceUI.open(pl), setup.pl);
await page.waitForSelector('#peace-window:not([hidden]) .peace-card');
const pw = await IM(() => ({
  score: document.querySelector('.ps-total b').textContent,
  cands: document.querySelectorAll('#peace-window input[data-pid]').length,
  chance: document.querySelector('.peace-chance b').textContent,
  send: document.querySelector('[data-peace="send"]').textContent,
}));
check(Number(pw.score) > 0, `war score shown: ${pw.score}`);
check(pw.cands >= 2, `${pw.cands} provinces to choose from`);
check(/white peace/i.test(pw.send) && /%/.test(pw.chance), `white peace offer by default (${pw.chance})`);
await page.click('#peace-window input[data-pid] >> nth=0');
await page.waitForTimeout(100);
const picked = await IM(() => ({ chance: document.querySelector('.peace-chance b').textContent, send: document.querySelector('[data-peace="send"]').textContent, disabled: document.querySelector('[data-peace="send"]').disabled }));
check(/Demand 1 province/.test(picked.send) && !picked.disabled, `one picked: "${picked.send}", chance ${picked.chance}`);
await shot(page, 'p2-peace-window');
// Accept for sure: make Poland exhausted, then send.
const kept = await IM(({ pl, me }) => {
  const { state, sim, peaceUI } = window.ironMeridian;
  const pid = [...peaceUI.picked][0];
  const r0 = Math.random; Math.random = () => 0;
  peaceUI.send();
  Math.random = r0;
  return { atWar: sim.combat.atWar(me, pl), owner: state.provinces[pid].owner, hidden: document.getElementById('peace-window').hidden, others: state.provinces.filter((p) => p.homeOf === pl && p.owner === me).length };
}, setup);
check(!kept.atWar && kept.owner === setup.me && kept.hidden, 'demand accepted: war over, province kept, window closed');
check(kept.others === 1, `the rest went back: Germany holds ${kept.others} Polish province`);

// Invalid terms: a province not joined to the border is refused.
const invalid = await IM(({ me, pl }) => {
  const { state, sim } = window.ironMeridian;
  sim.combat.truces.clear();
  sim.combat.declareWar(me, pl);
  const cap = state.nations[pl].capitalId;
  const far = state.provinces.find((p) => p.owner === pl && p.id !== cap && !p.neighbors.some((q) => state.provinces[q].owner === me) && !p.neighbors.some((q) => state.provinces[q].homeOf === me));
  if (!far) return null;
  sim.combat.capture(far, me);
  return sim.combat.validTerms(me, pl, [far.id]);
}, setup);
check(invalid && !invalid.ok && /border/.test(invalid.reason), `detached province refused: "${invalid?.reason}"`);

// The AI demands land from a losing player.
await IM(({ me, pl }) => {
  const { state, sim } = window.ironMeridian;
  sim.combat.makePeace(me, pl);
  sim.combat.truces.clear();
  sim.combat.declareWar(pl, me);
  const mine = state.provinces.filter((p) => p.owner === me && p.neighbors.some((q) => state.provinces[q].owner === pl) && p.id !== state.nations[me].capitalId).slice(0, 2);
  for (const p of mine) sim.combat.capture(p, pl);
  state.events.emit('peace:demand', { from: pl, to: me, provinces: mine.map((p) => p.id), score: 30 });
}, setup);
await page.waitForSelector('#diplo-modal:not([hidden])');
const demand = await page.textContent('#diplo-modal');
check(/demands/i.test(demand), 'AI demand popup shown');
await shot(page, 'p3-ai-demand');
await page.click('#diplo-modal [data-diplo="accept"]');
const after = await IM(({ me, pl }) => ({ atWar: window.ironMeridian.sim.combat.atWar(me, pl), lost: window.ironMeridian.state.provinces.filter((p) => p.homeOf === me && p.owner === pl).length }), setup);
check(!after.atWar && after.lost === 2, `accepted: war over, Poland keeps ${after.lost} German provinces`);

check(!errors.length, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
console.log(failures ? `${failures} failure(s)` : 'all peace checks passed');
process.exit(failures ? 1 : 0);
