// Browser test of sign-in → beta gate → game, using the fake Supabase client.
//   python3 -m http.server 3000   (in the project root), then:
//   node tools/e2e/launcher.test.mjs [screenshot-dir]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000/';
const SHOTS = process.argv[2] ?? null;
const mock = fs.readFileSync(new URL('./mock-supabase.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errors = [];
let failures = 0;
const check = (cond, label) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) failures++; };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

async function newPage(viewport = { width: 1440, height: 900 }, extra = '') {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(extra + mock);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); });
  return { ctx, page };
}
const launcherCard = (page) => page.locator('#launcher-card');
const gated = (page) => page.evaluate(() => document.body.classList.contains('gated'));

// 1. New visitor sees the sign-in screen.
{
  const { ctx, page } = await newPage();
  await page.goto(BASE + '?era=ww2');
  await page.waitForSelector('.provider-btn');
  const labels = await page.$$eval('.provider-btn', (b) => b.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  check(labels.length === 7, `7 provider buttons: ${labels.join(' | ')}`);
  check(await page.locator('[data-provider="apple"]').isDisabled(), 'Apple button disabled ("Coming soon")');
  check((await page.locator('[data-action="demo"]').count()) === 0, 'real sign-in build shows no demo button');
  check(await gated(page), 'game hidden behind the launcher');
  await page.waitForTimeout(800);
  await shot(page, 'l1-signin');

  // 2. A provider that isn't configured in Supabase shows a friendly message.
  await page.click('[data-provider="twitch"]');
  await page.waitForTimeout(200);
  check((await page.textContent('.card-msg')).includes("isn't switched on yet"), 'unconfigured provider → friendly error');

  // 7a. Magic link.
  await page.fill('#magic-email', 'not-an-email');
  await page.click('.magic-form button');
  check((await page.textContent('.card-msg')).includes('valid email'), 'invalid email rejected');
  await page.fill('#magic-email', 'tester@example.com');
  await page.click('.magic-form button');
  await page.waitForSelector('text=Check your email');
  check(true, 'magic link → "Check your email"');
  await ctx.close();
}

// 3. Request → pending → approved live; 4. returning player skips sign-in.
{
  const { ctx, page } = await newPage();
  await page.goto(BASE + '?era=ww2');
  await page.click('[data-provider="discord"]');
  await page.waitForSelector('text=Request beta access', { timeout: 10000 });
  check(true, 'after sign-in: "Request beta access"');
  await shot(page, 'l2-request');
  await page.click('[data-action="request"]');
  await page.waitForSelector('text=Pending approval');
  check(true, 'request → "Pending approval"');
  await page.waitForTimeout(500);
  await shot(page, 'l3-pending');
  await page.evaluate(() => window.__mockDecide('u-discord.player@example.com', 'approved'));
  await page.waitForFunction(() => !document.body.classList.contains('gated'), null, { timeout: 5000 });
  check(true, 'approval arrives live → game unlocked without reload');
  check(await page.isVisible('#main-menu') && await page.isVisible('#account'), 'approved → main menu with signed-in account');
  check(!(await page.isVisible('#main-menu [data-open-admin]')), 'no Admin button for a tester');
  await page.reload();
  await page.waitForFunction(() => window.ironMeridian?.state.map, null, { timeout: 10000 });
  await page.waitForTimeout(600);
  check(!(await gated(page)) && !(await page.isVisible('.provider-btn')) && await page.isVisible('#main-menu'), 'returning approved player skips sign-in → main menu');
  await ctx.close();
}

// 5. Denied.
{
  const { ctx, page } = await newPage();
  await page.goto(BASE + '?era=ww2');
  await page.click('[data-provider="github"]');
  await page.waitForSelector('[data-action="request"]', { timeout: 10000 });
  await page.click('[data-action="request"]');
  await page.waitForSelector('text=Pending approval');
  await page.evaluate(() => window.__mockDecide('u-github.player@example.com', 'denied'));
  await page.waitForSelector('text=Access not granted', { timeout: 5000 });
  check(true, 'denial arrives live → "Access not granted"');
  await shot(page, 'l4-denied');
  check(await gated(page), 'denied player stays locked out');
  await page.click('[data-action="sign-out"]');
  await page.waitForSelector('.provider-btn', { timeout: 10000 });
  check(true, 'sign out → back to sign-in');
  await ctx.close();
}

// 6. Owner: always in, Admin button everywhere, approve from the panel.
{
  const seed = `localStorage.setItem('mock-supabase', JSON.stringify({ session: null, rows: [
    { user_id: 'u-a', provider: 'google', display_name: 'Ada Lovelace', email: 'ada@example.com', status: 'pending', requested_at: '2026-10-08T09:14:00Z' },
    { user_id: 'u-b', provider: 'discord', display_name: 'Basil Hart', email: 'basil@example.com', status: 'pending', requested_at: '2026-10-08T11:02:00Z' },
    { user_id: 'u-c', provider: 'azure', display_name: 'Chen Wei', email: 'chen@example.com', status: 'approved', requested_at: '2026-10-07T18:40:00Z' },
    { user_id: 'u-d', provider: 'x', display_name: 'Dana Ruiz', email: 'dana@example.com', status: 'denied', requested_at: '2026-10-06T08:00:00Z' },
    { user_id: 'u-e', provider: 'email', display_name: 'eli', email: 'eli@example.com', status: 'approved', requested_at: '2026-10-05T21:30:00Z' }
  ] })); window.__mockNextEmail = 'owner@example.com'; window.__mockNextName = 'The Commander';`;
  const { ctx, page } = await newPage(undefined, `if (!localStorage.getItem('mock-supabase')) { ${seed} } window.__mockNextEmail = 'owner@example.com'; window.__mockNextName = 'The Commander';`);
  await page.goto(BASE + '?era=ww2');
  await page.click('[data-provider="google"]');
  await page.waitForFunction(() => !document.body.classList.contains('gated'), null, { timeout: 10000 });
  check(true, 'owner goes straight in (auto-approved)');
  check(await page.isVisible('#main-menu [data-open-admin]'), 'Admin in the main menu');
  await page.click('[data-menu="single"]');
  check(await page.isVisible('#btn-admin-fab'), 'Admin button on the era screen');
  await page.click('#era-screen [data-back]');
  await page.click('#main-menu [data-open-admin]');
  await page.waitForSelector('.admin-table');
  const tabs = await page.$$eval('.admin-tabs button', (b) => b.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  const total = await page.textContent('.admin-head .total');
  check(tabs.join(',') === 'Pending 2,Approved 3,Denied 1' && total.includes('6'), `tabs ${tabs.join(' / ')} · ${total}`);
  await shot(page, 'l5-admin');
  await page.click('button.act.approve[data-user="u-a"]');
  await page.waitForFunction(() => document.querySelector('.admin-tabs button')?.textContent.includes('1'));
  check(true, 'approve moves a tester out of Pending');
  await page.click('[data-tab="approved"]');
  const approvedRows = await page.$$eval('.admin-table tbody tr', (r) => r.length);
  check(approvedRows === 4, `approved tab now lists ${approvedRows} (incl. owner)`);
  await page.click('button.act.revoke[data-user="u-c"]');
  await page.waitForTimeout(200);
  await page.click('[data-tab="pending"]');
  check((await page.textContent('.admin-table')).includes('Chen Wei'), 'revoke sends a tester back to Pending');
  await shot(page, 'l6-admin-pending');
  await page.click('[data-admin="close"]');
  await page.click('[data-menu="single"]');
  await page.click('[data-era="ww2"]');
  await page.waitForSelector('#start-screen:not([hidden]) .nation-row', { timeout: 15000 });
  check(await page.isVisible('#btn-admin-fab'), 'Admin button on the nation screen');
  await page.click('.nation-row');
  await page.click('#btn-deploy');
  await page.waitForTimeout(1300);
  check(await page.isVisible('#btn-admin-top') && !(await page.isVisible('#btn-admin-fab')), 'in game: Admin button in the top bar');
  await shot(page, 'l7-owner-ingame');
  await ctx.close();
}

// 7b. Phone layout of the launcher.
{
  const { ctx, page } = await newPage({ width: 390, height: 844 });
  await page.goto(BASE + '?era=ww2');
  await page.waitForSelector('.provider-btn');
  await page.waitForTimeout(600);
  check(!(await page.evaluate(() => {
    const wide = (el) => el.scrollWidth > el.clientWidth + 1;
    const offscreen = [...document.querySelectorAll('#launcher-card *')].some((el) => el.getBoundingClientRect().right > window.innerWidth + 1);
    return wide(document.documentElement) || wide(document.getElementById('launcher')) || offscreen;
  })), 'phone: nothing wider than the screen');
  await shot(page, 'l8-phone');
  await ctx.close();
}

await browser.close();
check(errors.length === 0, `no page errors ${errors.length ? JSON.stringify(errors) : ''}`);
process.exit(failures ? 1 : 0);
