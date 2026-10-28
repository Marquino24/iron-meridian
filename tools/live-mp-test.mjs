// Live two-account multiplayer test against the real project (step 11B).
//   SUPABASE_ACCESS_TOKEN=sbp_… node tools/live-mp-test.mjs [--wait-minutes=6]
// Uses the Management API (the token) to:
//   • create two throwaway accounts (confirmed email + random password), approve
//     them as beta testers and, because multiplayer is owner-only, add them to
//     the owner list for the length of the test
// then drives the LIVE site (GitHub Pages) in two browser contexts signed in as
// them: lobby → create → join two nations → start → enter → orders from both
// (on-demand ticks through the deployed tick function) → leave → waits for the
// pg_cron schedule to tick the game with nobody online → comes back.
// Everything it created (accounts, owner entries, the game) is removed at the
// end, also when a step fails. Keys and passwords are never printed.
import { chromium } from 'playwright-core';
import { randomBytes } from 'node:crypto';

const REF = 'kzdixrmlqcedgiqsrsdy';
const URL_BASE = `https://${REF}.supabase.co`;
const SITE = process.env.SITE_URL ?? 'https://marquino24.github.io/iron-meridian/';
const PUBLISHABLE = 'sb_publishable_zMloPRCzrr45_irjARhcRQ_6NtetEZE';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { console.error('Set SUPABASE_ACCESS_TOKEN.'); process.exit(1); }
const WAIT_MIN = Number(process.argv.find((a) => a.startsWith('--wait-minutes='))?.split('=')[1] ?? 6);
let failures = 0;
const check = (cond, label) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) failures++; };
const lit = (s) => `'${String(s).replaceAll("'", "''")}'`;

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL failed (${res.status}): ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
const keys = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
const SERVICE = keys.find((k) => k.name === 'service_role')?.api_key;
if (!SERVICE) throw new Error('no service_role key');
const admin = (path, init = {}) => fetch(`${URL_BASE}/auth/v1/admin/${path}`, { ...init, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });

const tag = randomBytes(3).toString('hex');
const people = [
  { name: 'Live Test Ada', email: `im-live-test-ada-${tag}@example.com`, nation: 'German Reich' },
  { name: 'Live Test Bea', email: `im-live-test-bea-${tag}@example.com`, nation: 'France' },
];
let browser = null, gameId = null;
try {
  // --- Accounts ---
  for (const p of people) {
    p.password = randomBytes(18).toString('base64url');
    const r = await admin('users', { method: 'POST', body: JSON.stringify({ email: p.email, password: p.password, email_confirm: true, user_metadata: { full_name: p.name } }) });
    const u = await r.json();
    if (!r.ok) throw new Error(`create user: ${JSON.stringify(u).slice(0, 200)}`);
    p.id = u.id;
    // Beta access the way the app asks for it, then approved; owners for the test.
    await sql(`select set_config('request.jwt.claims', json_build_object('sub', ${lit(p.id)}, 'role', 'authenticated')::text, false);
      insert into public.beta_users (user_id, provider) values (${lit(p.id)}, 'email');
      select set_config('request.jwt.claims', '', false);
      update public.beta_users set status = 'approved' where user_id = ${lit(p.id)};
      insert into private.owner_emails (email) values (${lit(p.email.toLowerCase())}) on conflict do nothing;`);
    const s = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: PUBLISHABLE, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: p.email, password: p.password }) });
    p.session = await s.json();
    if (!s.ok) throw new Error(`sign-in: ${p.session.error_description ?? s.status}`);
  }
  check(true, 'two test accounts created, approved, signed in (owner list for the test)');

  // --- Browsers on the live site ---
  browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errors = [];
  for (const p of people) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await ctx.addInitScript(([k, v]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, JSON.stringify(p.session)]);
    p.page = await ctx.newPage();
    p.page.on('pageerror', (e) => errors.push(`${p.name}: ${e.message}`));
    await p.page.goto(`${SITE}?era=ww2`);
    await p.page.waitForSelector('#main-menu:not([hidden])', { timeout: 90000 });
    check(!(await p.page.locator('[data-menu="multi"]').isDisabled()), `${p.name}: signed in on the live site, Multiplayer enabled`);
  }
  const [A, B] = people.map((p) => p.page);

  // Lobby: Ada creates, both join, Ada starts.
  await A.click('[data-menu="multi"]');
  await A.waitForSelector('[data-lobby="create"]');
  await A.click('[data-lobby="create"]');
  await A.fill('.lobby-form [name="name"]', `Live test ${tag}`);
  await A.selectOption('.lobby-form [name="era"]', 'ww2');
  await A.fill('.lobby-form [name="players"]', '3');
  await A.click('.lobby-form [type="submit"]');
  await A.waitForSelector('.lobby-nation', { timeout: 60000 });
  gameId = (await sql(`select id from public.games where name = ${lit(`Live test ${tag}`)}`))[0]?.id;
  check(!!gameId, 'game created in the live database');
  await A.fill('#lobby-filter', people[0].nation);
  await A.click(`.lobby-nation:has-text("${people[0].nation}")`);
  await A.click('[data-lobby="join"]');
  await A.waitForSelector('[data-lobby="start"]');
  await B.click('[data-menu="multi"]');
  await B.waitForSelector(`.lobby-open:has-text("Live test ${tag}")`, { timeout: 60000 });
  await B.click(`.lobby-open:has-text("Live test ${tag}")`);
  await B.waitForSelector('.lobby-nation');
  await B.fill('#lobby-filter', people[1].nation);
  await B.click(`.lobby-nation:has-text("${people[1].nation}") >> nth=0`);
  await B.click('[data-lobby="join"]');
  await B.waitForSelector('.lobby-seat');
  await A.click('[data-lobby="start"]');
  await A.waitForSelector('[data-lobby="enter"]');
  const t0 = Date.now();
  await A.click('[data-lobby="enter"]');
  await A.waitForFunction(() => window.ironMeridian.mpClient?.tick >= 1, null, { timeout: 120000 });
  check(true, `Ada entered: the first server tick set up the world (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  await B.click('[data-lobby="list"]');
  await B.click(`.lobby-open:has-text("Live test ${tag}")`);
  await B.waitForSelector('[data-lobby="enter"]');
  await B.click('[data-lobby="enter"]');
  await B.waitForFunction(() => window.ironMeridian.mpClient?.tick >= 1, null, { timeout: 120000 });
  const nations = await Promise.all([A, B].map((p) => p.evaluate(() => window.ironMeridian.state.playerNation.name)));
  check(nations[0] === people[0].nation && nations[1] === people[1].nation, `Ada plays ${nations[0]}, Bea plays ${nations[1]}`);
  const fog = await B.evaluate(() => { const { state, sim } = window.ironMeridian; const all = [...sim.armies.list.values()]; return { mine: all.filter((a) => a.nation === state.playerNationId).length, other: all.filter((a) => a.nation !== state.playerNationId).length }; });
  check(fog.mine > 0 && fog.other < 120, `fog of war: Bea sees ${fog.mine} French armies and ${fog.other} foreign ones (of hundreds)`);

  // Orders from both, through the live tick function.
  const move = await A.evaluate(() => {
    const { state, sim, commands } = window.ironMeridian;
    const a = [...sim.armies.list.values()].find((x) => x.nation === state.playerNationId && !x.garrison && x.kind === 'land' && !x.seg);
    const to = state.provinces.find((p) => p.owner === state.playerNationId && p.neighbors.includes(a.node));
    commands.issue('army.move', { army: a.id, to: to.id });
    return { army: a.id, to: to.id };
  });
  await B.evaluate((m) => {
    const { state, commands } = window.ironMeridian;
    commands.issue('unit.recruit', { province: state.playerNation.capitalId, type: 'infantry' });
    commands.issue('army.move', m); // someone else's army: must be rejected
  }, move);
  const settled = (p) => p.waitForFunction(() => window.ironMeridian.mpClient.orders.length && window.ironMeridian.mpClient.orders.every((o) => o.status === 'applied' || o.status === 'rejected'), null, { timeout: 120000 });
  await Promise.all([settled(A), settled(B)]);
  const list = (p) => p.evaluate(() => window.ironMeridian.mpClient.orders.map((o) => `${o.label}: ${o.status}${o.result ? ` (${o.result})` : ''}`));
  const la = await list(A), lb = await list(B);
  check(la.some((s) => /applied/.test(s)), `Ada's orders: ${la.join('; ')}`);
  check(lb.some((s) => /Recruit.*applied/.test(s)) && lb.some((s) => /rejected \(Not your army\.\)/.test(s)), `Bea's orders: ${lb.join('; ')}`);
  const cmds = await sql(`select kind, status, result, tick from public.game_commands where game_id = ${lit(gameId)} order by id`);
  check(cmds.length === 3, `in the database: ${cmds.map((c) => `${c.kind} ${c.status}${c.result ? ` (${c.result})` : ''} @tick ${c.tick}`).join('; ')}`);

  // Nobody online: both leave; the schedule ticks the game.
  for (const p of [A, B]) await p.click('#mp-bar [data-mp="menu"]');
  for (const p of people) await p.page.context().close();
  const before = (await sql(`select tick, game_time, ticked_at from public.games where id = ${lit(gameId)}`))[0];
  console.log(`     waiting ${WAIT_MIN} minutes with nobody online (tick ${before.tick})…`);
  await new Promise((r) => setTimeout(r, WAIT_MIN * 60000));
  const after = (await sql(`select tick, game_time, ticked_at, last_tick_ms from public.games where id = ${lit(gameId)}`))[0];
  const days = (Number(after.game_time) - Number(before.game_time)) / 864e5;
  check(after.tick > before.tick, `the schedule ticked it with nobody online: tick ${before.tick} → ${after.tick}, ${days.toFixed(2)} game days, last tick ${after.last_tick_ms} ms`);
  const runs = await sql(`select status, return_message, start_time from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'iron-meridian-tick') order by start_time desc limit 5`);
  console.log('     cron runs:', runs.map((r) => `${r.start_time} ${r.status}`).join(' | '));
  const http = await sql(`select status_code, left(content::text, 180) as body, created from net._http_response order by created desc limit 8`);
  const ours = http.filter((h) => (h.body ?? '').includes('"by":"schedule"'));
  check(ours.length >= 1 && ours.every((h) => h.status_code === 200), `pg_net → tick function: ${ours.length} scheduled tick response(s), e.g. ${ours[0]?.body ?? '-'}`);

  // Ada comes back to the newer world.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript(([k, v]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, JSON.stringify(people[0].session)]);
  const A2 = await ctx.newPage();
  await A2.goto(`${SITE}?era=ww2`);
  await A2.waitForSelector('#main-menu:not([hidden])', { timeout: 90000 });
  await A2.click('[data-menu="multi"]');
  await A2.click(`.lobby-open:has-text("Live test ${tag}")`);
  await A2.waitForSelector('[data-lobby="enter"]');
  await A2.click('[data-lobby="enter"]');
  await A2.waitForFunction((t) => window.ironMeridian.mpClient?.tick >= t, after.tick, { timeout: 120000 });
  check(true, `Ada back: she sees tick ${await A2.evaluate(() => window.ironMeridian.mpClient.tick)}`);
  check(!errors.length, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
} catch (e) {
  failures++;
  console.log(`FAIL ${e.message}`);
} finally {
  // Clean up everything the test created.
  await browser?.close().catch(() => {});
  if (gameId) await sql(`delete from public.games where id = ${lit(gameId)}`).catch((e) => console.log('cleanup game:', e.message));
  for (const p of people) {
    await sql(`delete from private.owner_emails where email = ${lit(p.email.toLowerCase())}`).catch(() => {});
    if (p.id) await admin(`users/${p.id}`, { method: 'DELETE' }).catch(() => {});
  }
  const left = await sql(`select (select count(*) from private.owner_emails where email like 'im-live-test-%') as owners, (select count(*) from auth.users where email like 'im-live-test-%') as users`).catch(() => null);
  console.log(`     cleanup: test owners left ${left?.[0]?.owners ?? '?'}, test accounts left ${left?.[0]?.users ?? '?'}`);
}
console.log(failures ? `${failures} failure(s)` : 'all live multiplayer checks passed');
process.exit(failures ? 1 : 0);
