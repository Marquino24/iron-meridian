-- =============================================================================
-- Iron Meridian — schedule the multiplayer tick (step 11B)
--
-- Run AFTER docs/supabase-multiplayer-11b.sql, and after the `tick` Edge
-- Function is deployed with its TICK_SECRET (see docs/MULTIPLAYER.md, "Going
-- live"). Safe to run again: it replaces the job.
--
-- Every minute, pg_cron asks due_games() which running games are due (their
-- last tick is older than mp_limits.tick_minutes) and pg_net posts one request
-- per due game to the tick function. Each game is ticked in its own request,
-- so a tick never shares the 2 s CPU limit with another game.
--
-- The function URL and the shared secret are read from Supabase Vault, never
-- written here. Create them once (Dashboard → Project Settings → Vault, or in
-- the SQL editor, typing the real values there and not saving them in a file):
--   select vault.create_secret('https://kzdixrmlqcedgiqsrsdy.supabase.co/functions/v1/tick', 'iron_meridian_tick_url');
--   select vault.create_secret('<the same value as the function''s TICK_SECRET>', 'iron_meridian_tick_secret');
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$ begin
  perform cron.unschedule('iron-meridian-tick');
exception when others then null; end $$;

select cron.schedule(
  'iron-meridian-tick',
  '* * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'iron_meridian_tick_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-tick-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'iron_meridian_tick_secret')
    ),
    body := jsonb_build_object('game', g::text),
    timeout_milliseconds := 30000
  )
  from public.due_games() as g;
  $job$
);

-- Check it (after a few minutes):
--   select jobname, schedule, active from cron.job;
--   select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
--   select status_code, content::text, created from net._http_response order by created desc limit 5;
