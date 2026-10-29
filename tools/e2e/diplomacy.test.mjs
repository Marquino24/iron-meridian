// Browser test of step 7A: diplomacy (treaties, opinion, trade, allies, betrayal,
// proposals) and win conditions (setup, score widget, leaderboard, end screen).
//   python3 -m http.server 3000   (in the project root), then:
//   node tools/e2e/diplomacy.test.mjs [screenshot-dir] [--mobile]
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000/';
const SHOTS = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const MOBILE = process.argv.includes('--mobile');
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errors = [];
let failures = 0;
const check = (cond, label) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) failures++; };
const tag = MOBILE ? 'phone' : 'desktop';
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${tag}-7a-${name}.png` }); };

const ctx = await browser.newContext(MOBILE
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  : { viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); });
const click = (sel) => (MOBILE ? page.tap(sel) : page.click(sel));
const IM = (fn, arg) => page.evaluate(fn, arg);
const id = (name) => IM((name) => window.ironMeridian.state.nations.find((n) => n.name === name || n.shortName === name)?.id, name);

await page.goto(`${BASE}?era=ww2`);
await page.waitForSelector('[data-action="demo"], #main-menu:not([hidden])');
if (await page.locator('[data-action="demo"]').count()) await page.click('[data-action="demo"]');
await page.waitForSelector('#main-menu:not([hidden])');
await page.click('[data-menu="single"]');
// First single-player game: the tutorial offer (step 12). Skip it.
await page.waitForSelector('#tutorial-offer:not([hidden]), #era-screen:not([hidden])');
if (await page.locator('#tutorial-offer:not([hidden])').count()) await page.click('[data-offer="skip"]');
await page.click('[data-era="ww2"]');
await page.waitForSelector('#start-screen:not([hidden]) .nation-row');

// --- Setup: win condition after difficulty ---
check(await page.locator('#victory-mode [data-victory]').count() === 3, 'win condition choices on the nation screen');
await click('#victory-mode [data-victory="domination"]');
check(/40%/.test(await page.textContent('#victory-note')), `domination note: ${(await page.textContent('#victory-note')).slice(0, 60)}`);
await click('#victory-mode [data-victory="points"]');
await page.selectOption('#time-limit', '10');
const note = await page.textContent('#victory-note');
check(/First to \d+ points/.test(note) && /10 years/.test(note), `points note: ${note.slice(0, 90)}`);
await page.fill('#nation-search', 'German');
await page.click('.nation-row');
await shot(page, '0-setup');
await page.click('#btn-deploy');
await page.waitForFunction(() => document.body.classList.contains('in-game'));
await IM(() => { window.ironMeridian.ai.enabled = false; window.ironMeridian.state.setSpeed(0); });
await page.waitForTimeout(1200);
await page.click('#province-panel [data-action="close"]').catch(() => {});

const me = await IM(() => window.ironMeridian.state.playerNationId);
const italy = await id('Kingdom of Italy'), poland = await id('Poland'), uk = await id('United Kingdom'), czech = await id('Czechoslovakia'), hungary = await id('Hungary');
const V = () => IM(() => { const v = window.ironMeridian.sim.victory; return { mode: v.config.mode, limit: v.config.timeLimit, target: v.target, mine: v.scoreOf(window.ironMeridian.state.playerNationId).points }; });
const v0 = await V();
check(v0.mode === 'points' && v0.limit === 10 && v0.target > 50 && v0.mine > 5, `victory: target ${v0.target}, you have ${v0.mine} points, 10-year limit`);

// --- Score widget and leaderboard ---
await page.waitForSelector('#score-widget:not([hidden])');
check(new RegExp(`${v0.mine}`).test(await page.textContent('#score-widget')), 'score widget shows your points');
await click('#score-widget');
await page.waitForSelector('#leaderboard:not([hidden])');
check(await page.locator('#leaderboard tbody tr').count() > 50 && await page.locator('#leaderboard tr.me').count() === 1, 'leaderboard lists every nation, you highlighted');
await shot(page, '1-leaderboard');
await click('#leaderboard [data-close-board]');

// --- Diplomacy window ---
if (MOBILE) await click('#command-bar [data-win="diplomacy"]'); else await page.keyboard.press('d');
await page.waitForSelector('.win-diplomacy:not([hidden])');
check(await page.locator('.dip-table tbody tr').count() >= 8, `diplomacy window lists ${await page.locator('.dip-table tbody tr').count()} nations`);
await click(`.dip-table tr[data-nation="${italy}"]`);
await page.waitForSelector('.dip-detail');
const reasons = await page.textContent('.dip-op');
check(/Historical ties/.test(reasons), 'Italy: opinion with reasons (historical ties)');
await click('.dip-detail [data-propose="alliance"]');
await page.waitForTimeout(200);
check(await IM(([a, b]) => window.ironMeridian.sim.diplomacy.has(a, b, 'alliance'), [me, italy]), `alliance with Italy signed${await IM(([a, b]) => { const D = window.ironMeridian.sim.diplomacy; return D.has(a, b, 'alliance') ? '' : ` (refused: ${D.accepts(b, a, 'alliance').reason})`; }, [me, italy])}`);
check(/Alliance/.test(await page.textContent(`.dip-table tr[data-nation="${italy}"]`)), 'relation column shows Alliance');
await shot(page, '2-diplomacy');

// Trade: preview, then a gift that raises opinion.
await IM(() => { const { sim, state } = window.ironMeridian; for (const k of sim.economy.keys) sim.economy.get(state.playerNationId)[k] += 5000; });
await click(`.dip-table tr[data-nation="${hungary}"]`);
await page.waitForSelector('.dip-detail');
const op0 = await IM(([h, m]) => window.ironMeridian.sim.diplomacy.opinion(h, m).value, [hungary, me]);
await page.selectOption('.dip-trade select[data-trade="give"]', 'money');
await page.fill('.dip-trade input[data-trade="giveAmt"]', '2000');
await page.locator('.dip-trade input[data-trade="giveAmt"]').dispatchEvent('change');
await page.waitForTimeout(200);
check((await page.textContent('.dip-verdict')).length > 5, `trade preview: "${(await page.textContent('.dip-verdict')).trim()}"`);
const money0 = await IM((m) => window.ironMeridian.sim.economy.get(m).money, me);
await click('.dip-detail [data-gift]');
await page.waitForTimeout(200);
const op1 = await IM(([h, m]) => { const D = window.ironMeridian.sim.diplomacy; D.cache.clear(); return D.opinion(h, m).value; }, [hungary, me]);
const money1 = await IM((m) => window.ironMeridian.sim.economy.get(m).money, me);
check(op1 > op0 && Math.round(money0 - money1) === 2000, `gift of 2000 money: Hungary's opinion ${op0} → ${op1}`);
const trade = await IM(([h, m]) => window.ironMeridian.sim.diplomacy.trade(m, h, { money: 1500 }, { food: 100 }), [hungary, me]);
check(trade.ok || /Not worth|don't have/.test(trade.reason), `trade answered: ${trade.ok ? 'accepted' : trade.reason}`);

// --- War: allies are called in ---
await IM(([u, p]) => window.ironMeridian.sim.diplomacy.sign(u, p, 'alliance'), [uk, poland]);
if (MOBILE) await click('.win-diplomacy .win-close'); else await page.keyboard.press('Escape');
await IM((p) => window.ironMeridian.sim.diplomacy.declareWar(window.ironMeridian.state.playerNationId, p), poland);
check(await IM(([u, m]) => window.ironMeridian.sim.combat.atWar(u, m), [uk, me]), 'Poland\'s ally the UK joined the war automatically');
// Ask Italy (our ally) to join.
const ask = await IM(([m, i, p]) => window.ironMeridian.sim.diplomacy.askToJoin(m, i, p), [me, italy, poland]);
check(ask.ok === true || typeof ask.reason === 'string', `asked Italy to join: ${ask.ok ? 'yes' : ask.reason}`);

// --- Breaking a pact: everyone thinks less of you ---
await IM(([m, c]) => window.ironMeridian.sim.diplomacy.sign(m, c, 'nap'), [me, czech]);
const others0 = await IM(([h, m]) => { const D = window.ironMeridian.sim.diplomacy; D.cache.clear(); return D.opinion(h, m).value; }, [hungary, me]);
await IM(([m, c]) => window.ironMeridian.sim.diplomacy.declareWar(m, c), [me, czech]);
const after = await IM(([h, c, m]) => { const D = window.ironMeridian.sim.diplomacy; D.cache.clear(); return { h: D.opinion(h, m), c: D.opinion(c, m) }; }, [hungary, czech, me]);
check(after.h.value < others0 && after.h.reasons.some((r) => /Broke a/.test(r.text)), `pact broken: Hungary ${others0} → ${after.h.value} ("${after.h.reasons.find((r) => /Broke/.test(r.text))?.text}")`);
check(after.c.reasons.some((r) => /Broke our/.test(r.text) && r.value <= -50), 'the victim remembers the betrayal');

// --- Right of passage lets armies cross ---
const swiss = await id('Switzerland');
const pass = await IM(([m, s]) => { const { sim, state } = window.ironMeridian; const p = state.provinces.find((q) => q.owner === s); const before = sim.armies.canEnter(m, p.id, 'land'); sim.diplomacy.sign(s, m, 'passage'); return { before, after: sim.armies.canEnter(m, p.id, 'land') }; }, [me, swiss]);
check(!pass.before && pass.after, 'right of passage opens their land to your armies');

// --- An AI proposal popup ---
const france = await id('France');
await IM(([f, m]) => window.ironMeridian.sim.diplomacy.propose(f, m, { kind: 'treaty', type: 'nap' }), [france, me]);
await page.waitForSelector('#diplo-modal:not([hidden]) .proposal');
check(/proposes/.test(await page.textContent('#diplo-modal')), 'proposal popup');
await shot(page, '3-proposal');
await click('#diplo-modal [data-diplo="accept"]');
await page.waitForTimeout(200);
check(await IM(([f, m]) => window.ironMeridian.sim.diplomacy.has(f, m, 'nap'), [france, me]), 'accepted: pact with France');
// Trade proposal.
await IM(([f, m]) => { const D = window.ironMeridian.sim.diplomacy; D.lastAny = -Infinity; D.lastFrom.clear(); D.propose(f, m, { kind: 'trade', give: { oil: 100 }, take: { money: 200 } }); }, [italy, me]);
await page.waitForSelector('#diplo-modal:not([hidden]) .proposal');
check(/offers a trade/.test(await page.textContent('#diplo-modal')), 'trade proposal popup');
const oil0 = await IM((m) => window.ironMeridian.sim.economy.get(m).oil, me);
await click('#diplo-modal [data-diplo="accept"]');
await page.waitForTimeout(200);
check(Math.round(await IM((m) => window.ironMeridian.sim.economy.get(m).oil, me) - oil0) === 100, 'trade accepted: +100 oil');

// --- Bloc outlines on the map ---
check(await IM(() => window.ironMeridian.sim.diplomacy.blocs().size >= 4), 'alliance blocs known to the map (outlined)');

// --- End screen: a quick domination win ---
await IM(() => {
  // Hand Germany the Soviet Union's land so it is the clear leader, then a 10% domination goal.
  const { sim, state } = window.ironMeridian;
  const ussr = state.nations.find((n) => n.name === 'Soviet Union').id;
  for (const p of state.provinces) if (p.owner === ussr) state.setOwner(p.id, state.playerNationId);
  const v = sim.victory; v.config.mode = 'domination'; v.config.dominationPct = 10; v.lastCheck = -Infinity; state.setSpeed(1);
});
await page.waitForSelector('#end-screen:not([hidden])', { timeout: 10000 });
check(/VICTORY/.test(await page.textContent('#end-screen')), 'victory screen');
check(await page.locator('#end-screen .chart polyline').count() === 1 && /Battles won/.test(await page.textContent('#end-screen')), 'chart and stats');
await shot(page, '4-victory');
await click('#end-screen [data-end="keep"]');
check(await page.locator('#end-screen').isHidden() && await IM(() => window.ironMeridian.state.clock.speed) > 0, 'keep playing resumes');

// --- Defeat: lose every city ---
await IM(() => {
  const { sim, state } = window.ironMeridian;
  sim.victory.start({ mode: 'points', timeLimit: 0 });
  const other = state.nations.find((n) => n.name === 'France').id;
  for (const p of state.provinces) if (p.owner === state.playerNationId && p.isCity) state.setOwner(p.id, other);
  sim.victory.lastCheck = -Infinity;
});
await page.waitForSelector('#end-screen:not([hidden])', { timeout: 10000 });
check(/DEFEAT/.test(await page.textContent('#end-screen')) && /lost your capital/.test(await page.textContent('#end-screen')), 'defeat when every city is lost');
await shot(page, '5-defeat');
await click('#end-screen [data-end="menu"]');
await page.waitForSelector('#main-menu:not([hidden])');
check(true, 'main menu from the end screen');

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
