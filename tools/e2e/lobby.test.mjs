// Browser test of the multiplayer lobby (step 11A, owners only): with the fake
// Supabase client (the real SupabaseLobby code path) and with demo sign-in.
//   python3 -m http.server 3000   (in the project root), then:
//   node tools/e2e/lobby.test.mjs [screenshot-dir] [--mobile]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000/';
const SHOTS = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const MOBILE = process.argv.includes('--mobile');
const mock = fs.readFileSync(new URL('./mock-supabase.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errors = [];
let failures = 0;
const check = (cond, label) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) failures++; };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${MOBILE ? 'mobile' : 'desktop'}-${name}.png` }); };
const view = MOBILE ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } };

async function newPage(init = '') {
  const ctx = await browser.newContext(view);
  if (init != null) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|404|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return { ctx, page };
}
/** Sign in through the fake provider as `email`; lands on the menu once approved. */
async function signIn(page, email, name) {
  await page.goto(BASE + '?era=ww2');
  await page.waitForSelector('.provider-btn');
  await page.evaluate(([e, n]) => { window.__mockNextEmail = e; window.__mockNextName = n; }, [email, name]);
  await page.click('[data-provider="google"]');
  await page.waitForLoadState('load');
}
const multi = (page) => page.locator('[data-menu="multi"]');

// 1. The owner, real lobby code against the fake Supabase.
{
  const { ctx, page } = await newPage(mock);
  await signIn(page, 'owner@example.com', 'The Owner');
  await page.waitForSelector('#main-menu:not([hidden])');
  check(!(await multi(page).isDisabled()) && /Multiplayer · Beta/.test(await multi(page).textContent()), `owner: Multiplayer · Beta enabled ("${(await multi(page).textContent()).trim()}")`);
  await multi(page).click();
  await page.waitForSelector('#lobby-screen:not([hidden])');
  await page.waitForSelector('text=No open games yet');
  check(true, 'empty lobby says so');
  await page.click('[data-lobby="create"]');
  await page.fill('.lobby-form [name="name"]', 'Test Europe');
  await page.selectOption('.lobby-form [name="era"]', 'ww2');
  await page.selectOption('.lobby-form [name="speed"]', '10');
  await page.fill('.lobby-form [name="players"]', '3');
  check(await page.locator('.lobby-seed').isHidden(), 'no map seed for a historical era');
  await page.selectOption('.lobby-form [name="era"]', 'fictional');
  check(await page.locator('.lobby-seed').isVisible(), 'map seed shown for the Fictional World');
  await page.selectOption('.lobby-form [name="era"]', 'ww2');
  await shot(page, 'lb1-create');
  await page.click('.lobby-form [type="submit"]');
  await page.waitForSelector('.lobby-nations .lobby-nation');
  const head = await page.textContent('.lobby-game-head');
  check(/Test Europe/.test(head) && /World War II/.test(head) && /10 real min/.test(head) && /0\/3 players/.test(head), `game created: "${head.replace(/\s+/g, ' ').trim()}"`);
  const count = await page.locator('.lobby-nation').count();
  check(count >= 50, `${count} nations to pick from (major powers first)`);
  await page.fill('#lobby-filter', 'German');
  await page.click('.lobby-nation:has-text("German Reich")');
  check(/Join as German Reich/.test(await page.textContent('[data-lobby="join"]')), 'pick German Reich');
  await shot(page, 'lb2-pick');
  await page.click('[data-lobby="join"]');
  await page.waitForSelector('.lobby-seat');
  check(/You play German Reich/.test(await page.textContent('.lobby-seat')), 'joined: "You play German Reich"');
  check(/1\/3 players/.test(await page.textContent('.lobby-game-head')), 'seat counted');
  const db = await page.evaluate(() => JSON.parse(localStorage.getItem('mock-supabase')));
  check(db.games.length === 1 && db.games[0].minutes_per_day === 10 && db.games[0].max_players === 3 && db.players.length === 1 && db.players[0].nation_id >= 0, `stored: game ${JSON.stringify({ era: db.games[0].era, minutes_per_day: db.games[0].minutes_per_day, max_players: db.games[0].max_players })}, seat nation ${db.players[0]?.nation_id}`);
  await shot(page, 'lb3-seat');
  await page.click('[data-lobby="list"]');
  await page.waitForSelector('.lobby-game');
  check(/JOINED/.test(await page.textContent('.lobby-game')) && /1\/3/.test(await page.textContent('.lg-seats')), 'list shows the game as joined, 1/3');
  // Another nation in the same game is taken by someone else: shown greyed out.
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('mock-supabase')); d.players.push({ game_id: d.games[0].id, user_id: 'u-other', nation_id: 0 }); localStorage.setItem('mock-supabase', JSON.stringify(d)); });
  await page.click('.lobby-open');
  await page.waitForSelector('.lobby-seat');
  await page.click('[data-lobby="leave"]');
  await page.waitForSelector('.lobby-nations .lobby-nation');
  check(await page.locator('.lobby-seat').count() === 0, 'left the game');
  const taken = await page.locator('.lobby-nation[disabled]').count();
  check(taken === 1 && /taken/.test(await page.textContent('.lobby-nation[disabled]')), 'a nation taken by another player is greyed out');
  await page.click('[data-back]:visible');
  await page.waitForSelector('#main-menu:not([hidden])');
  check(true, 'Back returns to the menu');
  // Single player still starts normally after visiting the lobby.
  await page.click('[data-menu="single"]');
  // First single-player game: the tutorial offer (step 12). Skip it.
  await page.waitForSelector('#tutorial-offer:not([hidden]), #era-screen:not([hidden])');
  if (await page.locator('#tutorial-offer:not([hidden])').count()) await page.click('[data-offer="skip"]');
  await page.click('[data-era="ww2"]');
  await page.waitForSelector('#start-screen:not([hidden]) .nation-row');
  check(true, 'single player still reachable');
  await ctx.close();
}

// 2. An approved tester (not an owner): Multiplayer · Beta too (MULTIPLAYER_PREVIEW = 'everyone').
{
  const { ctx, page } = await newPage(mock);
  await signIn(page, 'alice@example.com', 'Alice');
  await page.waitForSelector('#launcher >> text=Pending');
  await page.evaluate(() => window.__mockDecide('u-alice@example.com', 'approved'));
  await page.waitForSelector('#main-menu:not([hidden])');
  check(!(await multi(page).isDisabled()) && /Multiplayer · Beta/.test(await multi(page).textContent()), 'approved tester: Multiplayer · Beta enabled');
  await multi(page).click();
  await page.waitForSelector('#lobby-screen:not([hidden])');
  check(/MULTIPLAYER · BETA/.test(await page.textContent('#lobby-screen .eyebrow')) && /Beta:/.test(await page.textContent('.lobby-note')), 'lobby labelled as a beta');
  await ctx.close();
}

// 3. The owner before the multiplayer SQL has been run: a clear message.
{
  const { ctx, page } = await newPage(`window.__mockNoMultiplayer = true;\n${mock}`);
  await signIn(page, 'owner@example.com', 'The Owner');
  await page.waitForSelector('#main-menu:not([hidden])');
  await multi(page).click();
  await page.waitForSelector('.lobby-msg');
  check(/supabase-multiplayer\.sql/.test(await page.textContent('.lobby-msg')), `tables missing → "${(await page.textContent('.lobby-msg')).trim()}"`);
  await ctx.close();
}

// 4. Demo sign-in (claude.ai preview, localhost): sample games in this browser.
{
  const { ctx, page } = await newPage(null);
  await page.goto(BASE + '?era=ww2');
  await page.waitForSelector('[data-action="demo"], #main-menu:not([hidden])');
  if (await page.locator('[data-action="demo"]').count()) await page.click('[data-action="demo"]');
  await page.waitForSelector('#main-menu:not([hidden])');
  await multi(page).click();
  await page.waitForSelector('.lobby-game');
  const names = await page.$$eval('.lg-name', (e) => e.map((x) => x.textContent.trim()));
  check(names.length === 2 && names.every((n) => /\[Sample\]/.test(n)), `demo lobby: ${names.join(', ')}`);
  await shot(page, 'lb4-demo-list');
  await page.click('.lobby-open:has-text("Fictional")');
  await page.waitForSelector('.lobby-nations .lobby-nation');
  await page.click('.lobby-nation >> nth=0');
  await page.click('[data-lobby="join"]');
  await page.waitForSelector('.lobby-seat');
  check(true, 'demo: joined a sample Fictional World game');
  await shot(page, 'lb5-demo-seat');
  await ctx.close();
}

check(!errors.length, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
console.log(failures ? `${failures} failure(s)` : 'all lobby checks passed');
process.exit(failures ? 1 : 0);
