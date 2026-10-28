// Multiplayer go-live (step 11B), with a Supabase personal access token in the
// environment (never in a file):
//   SUPABASE_ACCESS_TOKEN=sbp_… node tools/mp-deploy.mjs [--measure-only] [--ticks=8] [--interval=auto]
// It:
//   1. builds and deploys the tick Edge Function (Supabase CLI, verify_jwt off)
//   2. creates a random TICK_SECRET and stores it as a function secret and in
//      Vault (iron_meridian_tick_secret), with the function URL
//      (iron_meridian_tick_url). The secret is never printed or written to disk
//   3. runs docs/supabase-multiplayer.sql (if its tables are missing) and
//      docs/supabase-multiplayer-11b.sql (both safe to run again)
//   4. measures real ticks on Supabase: a throwaway WWII game, N scheduled
//      ticks of 30 game hours (5 real minutes at the default speed), deleted after
//   5. sets the tick interval from those numbers (5 min if a 30-game-hour tick
//      takes under ~1.2 s, else 3, else 2) and schedules the job
//      (docs/supabase-multiplayer-cron.sql)
// SQL runs through the Management API (POST /v1/projects/{ref}/database/query).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';

const REF = 'kzdixrmlqcedgiqsrsdy';
const URL_BASE = `https://${REF}.supabase.co`;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
if (!TOKEN) { console.error('Set SUPABASE_ACCESS_TOKEN in the environment (a Supabase personal access token).'); process.exit(1); }
const root = new URL('../', import.meta.url);
const sh = (cmd, a, env = {}) => execFileSync(cmd, a, { cwd: root, stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, ...env } });
const supabase = (a) => sh('npx', ['--yes', 'supabase@2.54.11', ...a]);

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL failed (${res.status}): ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}
const lit = (s) => `'${String(s).replaceAll("'", "''")}'`;

const secret = randomBytes(32).toString('hex');
if (!args.includes('--measure-only')) {
  console.log('1. build and deploy the tick function');
  sh('node', ['tools/build-functions.mjs']);
  supabase(['functions', 'deploy', 'tick', '--project-ref', REF, '--no-verify-jwt', '--use-api']);
  console.log('2. TICK_SECRET (function secret + Vault); not printed');
  supabase(['secrets', 'set', `TICK_SECRET=${secret}`, '--project-ref', REF]);
  await sql(`
    do $$ begin
      perform vault.update_secret(id, ${lit(secret)}) from vault.secrets where name = 'iron_meridian_tick_secret';
      if not found then perform vault.create_secret(${lit(secret)}, 'iron_meridian_tick_secret'); end if;
      perform vault.update_secret(id, ${lit(`${URL_BASE}/functions/v1/tick`)}) from vault.secrets where name = 'iron_meridian_tick_url';
      if not found then perform vault.create_secret(${lit(`${URL_BASE}/functions/v1/tick`)}, 'iron_meridian_tick_url'); end if;
    end $$;`);
  // Step 11A's tables first, if they aren't there yet (both files are safe to run again).
  const has = await sql("select to_regclass('public.games') is not null as ok");
  if (!has[0].ok) {
    console.log('3a. docs/supabase-multiplayer.sql (step 11A: not run on this project yet)');
    await sql(readFileSync(new URL('docs/supabase-multiplayer.sql', root), 'utf8'));
  }
  console.log('3. docs/supabase-multiplayer-11b.sql');
  await sql(readFileSync(new URL('docs/supabase-multiplayer-11b.sql', root), 'utf8'));
}

// 4. Measure on Supabase: a throwaway game, scheduled ticks of 30 game hours.
console.log('4. measuring real ticks on Supabase');
const tickSecret = args.includes('--measure-only')
  ? (await sql("select decrypted_secret as s from vault.decrypted_secrets where name = 'iron_meridian_tick_secret'"))[0].s
  : secret;
const gid = randomUUID();
const owner = (await sql("select u.id from auth.users u join private.owner_emails o on o.email = lower(u.email) limit 1"))[0]?.id;
if (!owner) throw new Error('No owner account has signed in yet: sign in to the game once as the owner first.');
// As the owner (the triggers check who creates and joins), then started.
await sql(`select set_config('request.jwt.claims', json_build_object('sub', ${lit(owner)}, 'role', 'authenticated')::text, false);
  insert into public.games (id, name, era, minutes_per_day, max_players) values (${lit(gid)}, '[measure] tick timing', 'ww2', 4, 2);
  insert into public.game_players (game_id, user_id, nation_id) values (${lit(gid)}, ${lit(owner)}, 31);
  update public.games set status = 'running' where id = ${lit(gid)};
  select set_config('request.jwt.claims', '', false);`);
const ticks = [];
try {
  for (let i = 0; i < Number(opt('ticks', 8)); i++) {
    if (i) await sql(`update public.games set ticked_at = now() - interval '5 minutes' where id = ${lit(gid)}`);
    const t0 = Date.now();
    const res = await fetch(`${URL_BASE}/functions/v1/tick`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-tick-secret': tickSecret }, body: JSON.stringify({ game: gid }) });
    const body = await res.json();
    if (!res.ok || body.error) throw new Error(`tick ${i} failed: ${res.status} ${JSON.stringify(body)}`);
    ticks.push({ ...body, roundTrip: Date.now() - t0 });
    console.log(`   tick ${body.tick}: ${body.hours} game h · server ${body.cpuMs} ms (simulation ${body.ms} ms) · round trip ${Date.now() - t0} ms · state ${(body.bytes / 1024).toFixed(0)} KB`);
  }
} finally {
  await sql(`delete from public.games where id = ${lit(gid)}`);
}
const thirty = ticks.filter((t) => Math.abs(t.hours - 30) < 0.5).map((t) => t.ms).sort((a, b) => a - b);
const median = thirty[Math.floor(thirty.length / 2)], worst = thirty.at(-1);
const interval = opt('interval', 'auto') !== 'auto' ? Number(opt('interval')) : worst < 1200 ? 5 : worst < 1800 ? 3 : 2;
console.log(`   30-game-hour ticks: median ${median} ms, worst ${worst} ms → tick every ${interval} min`);

if (!args.includes('--measure-only')) {
  console.log(`5. schedule: every ${interval} min`);
  await sql(`update private.mp_limits set tick_minutes = ${interval} where id = 1`);
  await sql(readFileSync(new URL('docs/supabase-multiplayer-cron.sql', root), 'utf8'));
  console.log((await sql("select jobname, schedule, active from cron.job where jobname = 'iron-meridian-tick'")));
}
const perDay = (24 * 60) / interval;
console.log(`invocations per running game: ${perDay.toFixed(0)} a day (schedule) + on-demand ticks while players are online`);
