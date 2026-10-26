// Browser test of step 7B: save and load mid-war (armies, battles, research,
// diplomacy all restored), Continue after a reload, export/import as a file,
// the weekly autosave, and sandbox saves marked as such.
//   python3 -m http.server 3000   (in the project root), then:
//   node tools/e2e/save.test.mjs [screenshot-dir] [--mobile]
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000/';
const SHOTS = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const MOBILE = process.argv.includes('--mobile');
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errors = [];
let failures = 0;
const check = (cond, label) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) failures++; };
const tag = MOBILE ? 'phone' : 'desktop';
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${tag}-7b-${name}.png` }); };

const ctx = await browser.newContext({
  acceptDownloads: true,
  ...(MOBILE ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } }),
});
let page = await ctx.newPage();
const watch = (p) => {
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); });
};
watch(page);
/** Diplomacy popups (an AI declaring war on you...) pause the game at random: wave them off first. */
async function dismissPopups() {
  let any = false;
  for (let i = 0; i < 4 && await page.locator('#diplo-modal:not([hidden])').count(); i++) {
    any = true;
    await page.click('#diplo-modal [data-diplo="decline"], #diplo-modal [data-diplo="ok"], #diplo-modal [data-diplo="reject"], #diplo-modal button').catch(() => {});
    await page.waitForTimeout(100);
  }
  // Closing a popup resumes the speed it paused; the test drives the clock itself.
  if (any) await page.evaluate(() => window.ironMeridian.state.setSpeed(0));
}
const click = async (sel) => { await dismissPopups(); return MOBILE ? page.tap(sel) : page.click(sel); };
const IM = (fn, arg) => page.evaluate(fn, arg);
const inGame = () => page.waitForFunction(() => document.body.classList.contains('in-game') && window.ironMeridian.state.phase === 'playing', null, { timeout: 60000 });

/** Everything a save must bring back, as plain data. */
const fingerprint = () => IM(() => {
  const { state, sim, feed } = window.ironMeridian;
  const me = state.playerNationId;
  const r = (x) => Math.round(x * 1000) / 1000;
  const armies = [...sim.armies.list.values()].map((a) => [a.id, a.nation, a.name, a.node, a.seg ? [a.seg.from, a.seg.to, r(a.seg.done)] : null, a.path.join(','), a.units.map((u) => `${u.type}${u.lvl}:${r(u.hp)}`).join(' ')]);
  const battles = [...sim.combat.active.values()].map((b) => [b.id, b.node, r(b.hours), b.sides.map((s) => [s.nation, [...s.armies].map((a) => a.id).sort().join(',')])]);
  const res = sim.research.nations.get(me);
  sim.diplomacy.cache.clear(); sim.ai.strengthAt = -Infinity; sim.ai.refreshStrength(); // opinions and power are cached: compare fresh values
  return {
    clock: state.clock.time, player: me, sandbox: state.sandbox,
    owners: state.provinces.map((p) => p.owner).join(','),
    stock: Object.values(sim.economy.stock[me]).map(Math.round).join(','),
    armies: JSON.stringify(armies), battles: JSON.stringify(battles),
    wars: [...sim.combat.wars].sort().join(' '), occupations: JSON.stringify([...sim.combat.occupations]),
    research: JSON.stringify({ done: [...res.done].sort(), active: res.active.map((a) => [a.id, r(a.done)]), queue: res.queue }),
    treaties: JSON.stringify([...sim.diplomacy.treaties].map(([k, s]) => [k, [...s].sort()]).sort()),
    opinions: state.nations.slice(0, 60).map((n) => (n.id === me ? 0 : sim.diplomacy.opinion(n.id, me).value)).join(','),
    buildings: JSON.stringify([...sim.buildings.levels].filter(([pid]) => state.provinces[pid].owner === me)),
    construction: JSON.stringify([...sim.buildings.construction]),
    queues: JSON.stringify([...sim.armies.queues]),
    points: sim.victory.scoreOf(me).points, stats: JSON.stringify({ ...sim.victory.stats, played: 0 }),
    feed: feed.items.length, brains: sim.ai.brains.size, difficulty: sim.ai.difficulty,
  };
});
const sameAs = (a, b, label) => {
  const bad = Object.keys(a).filter((k) => a[k] !== b[k]);
  check(!bad.length, `${label}${bad.length ? ` — differs: ${bad.map((k) => `${k} (${String(a[k]).slice(0, 60)} ≠ ${String(b[k]).slice(0, 60)})`).join('; ')}` : ''}`);
};

async function boot(url = `${BASE}?era=ww2`) {
  await page.goto(url);
  await page.waitForSelector('[data-action="demo"], #main-menu:not([hidden])');
  if (await page.locator('[data-action="demo"]').count()) await page.click('[data-action="demo"]');
  await page.waitForSelector('#main-menu:not([hidden])');
}

// Start clean: no saves from an earlier run.
await boot();
await IM(() => new Promise((res) => { const r = indexedDB.deleteDatabase('iron-meridian'); r.onsuccess = r.onerror = r.onblocked = () => res(); }));
await boot();
check(await page.locator('[data-menu="continue"]').isHidden(), 'no Continue without saves');
check(await page.locator('[data-menu="load"]').isVisible(), 'Load Game on the main menu');

// --- A game in WWII, Hard, mid-war ---
await page.click('[data-menu="single"]');
await page.click('[data-era="ww2"]');
await page.waitForSelector('#start-screen:not([hidden]) .nation-row');
await click('#difficulty [data-difficulty="hard"]');
await page.fill('#nation-search', 'German');
await page.click('.nation-row');
await page.click('#btn-deploy');
await inGame();
await page.waitForTimeout(800);
await page.click('#province-panel [data-action="close"]').catch(() => {});
// Proposal popups pause the game at random; this test doesn't answer them.
await IM(() => { window.ironMeridian.sim.diplomacy.propose = () => null; });
const setup = await IM(() => {
  const { state, sim } = window.ironMeridian;
  const me = state.playerNationId;
  const id = (n) => state.nations.find((x) => x.name === n).id;
  const poland = id('Poland'), italy = id('Kingdom of Italy');
  sim.diplomacy.sign(me, italy, 'alliance');
  sim.diplomacy.declareWar(me, poland);
  const cap = state.getNation(poland).capitalId;
  for (const a of sim.armies.list.values()) if (a.nation === me && !a.garrison && a.kind === 'land') sim.armies.order(a.id, cap);
  const t = sim.research.tree.filter((t) => sim.research.check(me, t.id).ok).slice(0, 2);
  for (const x of t) sim.research.start(me, x.id);
  const city = state.provinces.find((p) => p.owner === me && p.isCity && sim.armies.recruitCheck(p.id, sim.armies.roster.byRole.inf.key).ok);
  if (city) sim.armies.recruit(city.id, sim.armies.roster.byRole.inf.key);
  state.setSpeed(4);
  return { techs: t.length, recruit: !!city };
});
check(setup.techs > 0, `research started (${setup.techs})`);
// Run on until a battle is being fought.
await IM(() => window.ironMeridian.state.setSpeed(4));
await page.evaluate(() => { const s = window.ironMeridian.state; s.speeds.includes(48) || s.speeds.push(48); });
await IM(() => window.ironMeridian.state.setSpeed(48));
await page.waitForFunction(() => window.ironMeridian.sim.combat.active.size > 0 && [...window.ironMeridian.sim.combat.active.values()].some((b) => b.sides.some((s) => s.nation === window.ironMeridian.state.playerNationId)), null, { timeout: 120000 });
await IM(() => window.ironMeridian.state.setSpeed(0));
await dismissPopups();
const before = await fingerprint();
const counts = await IM(() => { const { sim, state } = window.ironMeridian; return { armies: sim.armies.list.size, battles: sim.combat.active.size, wars: sim.combat.wars.size, treaties: sim.diplomacy.treaties.size, active: sim.research.nations.get(state.playerNationId).active.length, day: Math.round((state.clock.time - state.clock.start) / 864e5) }; });
console.log(`     mid-war on day ${counts.day}: ${counts.armies} armies, ${counts.battles} battles, ${counts.wars} wars, ${counts.treaties} treaty pairs, ${counts.active} research projects`);
check(counts.battles > 0 && counts.wars > 0 && counts.active > 0, 'battles, wars and research under way before saving');

// --- Save from the pause menu into slot 1 ---
await click('#btn-menu');
await page.waitForSelector('#main-menu:not([hidden])');
check(await page.locator('[data-menu="save"]').isVisible(), 'Save Game in the pause menu');
await click('[data-menu="save"]');
await page.waitForSelector('#saves-screen:not([hidden])');
check(/Save game/.test(await page.textContent('#saves-title')), 'save screen');
await click('[data-act="save"][data-slot="1"]');
await page.waitForSelector('.save-card[data-slot="1"]');
const card = await page.textContent('.save-card[data-slot="1"]');
check(/German Reich/.test(card) && /1939|1940/.test(card) && /Hard/.test(card) && /World War II/.test(card), `slot card: ${card.replace(/\s+/g, ' ').trim().slice(0, 110)}`);
check(await page.locator('.save-card[data-slot="1"] img.save-thumb').count() === 1, 'map thumbnail on the slot');
await shot(page, '1-save');
// Overwrite asks first.
await click('[data-act="save"][data-slot="1"]');
check(/Overwrite\?/.test(await page.textContent('.save-card[data-slot="1"]')), 'overwriting asks for a second click');

// Export slot 1 as a file.
const [download] = await Promise.all([page.waitForEvent('download'), click('[data-act="export"][data-slot="1"]')]);
const exportPath = `/tmp/im-save-${tag}.json`;
await download.saveAs(exportPath);
const exported = JSON.parse(readFileSync(exportPath, 'utf8'));
check(download.suggestedFilename().endsWith('.json') && exported.format === 'iron-meridian-save-file' && exported.meta.nationName === 'German Reich', `exported ${download.suggestedFilename()} (${Math.round(readFileSync(exportPath).length / 1024)} KB)`);

// --- Play on (things change), then load slot 1 ---
await click('.back-btn');
await click('[data-menu="resume"]');
await inGame();
await IM(() => window.ironMeridian.state.setSpeed(48));
await page.waitForTimeout(2500);
await IM(() => window.ironMeridian.state.setSpeed(0));
const moved = await fingerprint();
check(moved.clock !== before.clock && moved.armies !== before.armies, 'the game moved on after saving');
await click('#btn-menu');
await click('[data-menu="load"]');
await page.waitForSelector('#saves-screen:not([hidden]) .save-card[data-slot="1"]');
await shot(page, '2-load');
await click('[data-act="load"][data-slot="1"]');
await inGame();
await IM(() => window.ironMeridian.state.setSpeed(0));
await page.waitForTimeout(300);
sameAs(await fingerprint(), before, 'load restores everything (armies, battles, wars, research, treaties, opinions, buildings, stocks, score)');
await shot(page, '3-loaded');

// The loaded game keeps running: battles go on and finish.
await IM(() => window.ironMeridian.state.setSpeed(48));
await page.waitForTimeout(2000);
const after = await IM(() => ({ t: window.ironMeridian.state.clock.time, h: [...window.ironMeridian.sim.combat.battles.values()].reduce((s, b) => s + b.hours, 0) }));
check(after.t > before.clock && after.h > 0, 'the loaded game plays on (clock and battles advance)');
await IM(() => window.ironMeridian.state.setSpeed(0));

// --- Reload the page: Continue picks up the newest save ---
await boot(`${BASE}?era=ww1`);
check(await page.locator('[data-menu="continue"]').isVisible(), 'Continue on the main menu after a reload');
check(/German Reich/.test(await page.textContent('#continue-detail')), `continue detail: ${await page.textContent('#continue-detail')}`);
await shot(page, '0-menu');
const newest = await IM(() => window.ironMeridian.saveUI.slots[0].meta);
await click('[data-menu="continue"]');
await inGame();
await IM(() => { window.ironMeridian.state.setSpeed(0); window.ironMeridian.sim.diplomacy.propose = () => null; });
check(await IM((d) => window.ironMeridian.state.clock.time === d, newest.date), `Continue after a page reload loads the newest save (${newest.days} days in)`);
check(await IM(() => window.ironMeridian.state.clock.speed === 0), 'a loaded game starts paused');
await click('#btn-menu');
await click('[data-menu="load"]');
await click('[data-act="load"][data-slot="1"]');
await inGame();
await IM(() => { window.ironMeridian.state.setSpeed(0); window.ironMeridian.sim.diplomacy.propose = () => null; });
sameAs(await fingerprint(), before, 'slot 1 after a page reload restores the same game');

// --- Import the exported file into a fresh slot and load it ---
await click('#btn-menu');
await click('[data-menu="load"]');
await page.waitForSelector('#saves-screen:not([hidden])');
await click('[data-act="delete"][data-slot="1"]');
await click('[data-act="delete"][data-slot="1"]');
await page.waitForFunction(() => !document.querySelector('.save-card[data-slot="1"]'));
check(true, 'slot deleted (two clicks)');
await page.setInputFiles('#save-file', exportPath);
await page.waitForSelector('.save-card.fresh[data-slot="1"]');
check(true, 'imported file lands in slot 1');
await click('[data-act="load"][data-slot="1"]');
await inGame();
await IM(() => { window.ironMeridian.state.setSpeed(0); window.ironMeridian.sim.diplomacy.propose = () => null; });
sameAs(await fingerprint(), before, 'imported file restores the same game');

// A broken file is refused politely.
await click('#btn-menu');
await click('[data-menu="load"]');
await page.setInputFiles('#save-file', { name: 'junk.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
await page.waitForTimeout(400);
check(/Not an Iron Meridian save/.test(await page.textContent('#toast')), `bad file refused: "${await page.textContent('#toast')}"`);
await click('.back-btn');
await click('[data-menu="resume"]');
await inGame();

// --- Autosave every in-game week ---
const t0 = await IM(() => window.ironMeridian.state.clock.time);
await IM(() => { const s = window.ironMeridian.state; s.speeds.includes(48) || s.speeds.push(48); s.setSpeed(48); });
await page.waitForFunction((t0) => window.ironMeridian.state.clock.time > t0 + 7.3 * 864e5, t0, { timeout: 120000 });
await page.waitForTimeout(800);
await IM(() => window.ironMeridian.state.setSpeed(0));
const autos = await IM(async () => (await window.ironMeridian.saveUI.refreshMenu(), window.ironMeridian.saveUI.slots.filter((s) => s.slot === 'auto').map((s) => s.meta.date)));
check(autos.length === 1 && autos[0] > t0, `autosave written after an in-game week (${autos.length ? new Date(autos[0]).toISOString().slice(0, 10) : 'none'})`);

// --- Sandbox saves are marked ---
await click('#btn-menu');
await click('[data-menu="sandbox"]');
await click('[data-era="ww1"]');
await page.waitForSelector('#start-screen:not([hidden]) .nation-row');
await page.click('.nation-row');
await page.click('#btn-deploy');
await inGame();
await IM(() => { window.ironMeridian.state.setSpeed(0); window.ironMeridian.sim.diplomacy.propose = () => null; });
await click('#btn-menu');
await click('[data-menu="save"]');
await click('[data-act="save"][data-slot="2"]');
await page.waitForSelector('.save-card[data-slot="2"] .save-tag.sandbox');
check(true, 'sandbox save marked Sandbox');
await click('.back-btn');
await click('[data-menu="load"]');
await page.waitForSelector('.save-card[data-slot="auto"]');
await shot(page, '4-slots');
// Loading the WWII autosave from a sandbox game leaves sandbox mode; loading slot 2 brings it back.
await click('[data-act="load"][data-slot="auto"]');
await inGame();
check(await IM(() => !window.ironMeridian.state.sandbox && document.getElementById('sandbox-bar').hidden), 'normal save loads as a normal game');
await click('#btn-menu');
await click('[data-menu="load"]');
await click('[data-act="load"][data-slot="2"]');
await inGame();
check(await IM(() => window.ironMeridian.state.sandbox && window.ironMeridian.state.era.id === 'ww1'), 'sandbox save loads as a sandbox');

if (MOBILE) {
  await click('#btn-menu');
  await click('[data-menu="load"]');
  const fits = await IM(() => [...document.querySelectorAll('.save-card')].every((c) => c.getBoundingClientRect().right <= window.innerWidth + 1));
  check(fits, 'slot cards fit the phone screen');
  await shot(page, '5-phone');
}

check(!errors.length, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
console.log(failures ? `${failures} failure(s)` : 'all save checks passed');
process.exit(failures ? 1 : 0);
