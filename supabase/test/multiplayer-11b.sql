-- Behaviour tests for docs/supabase-multiplayer-11b.sql (after multiplayer.sql's
-- tests, by supabase/test/run.sh): lifecycle, fogged views, limits, tick leases.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.as_service() returns void language plpgsql as $$
begin perform set_config('role', 'service_role', true); end $$;
create function pg_temp.expect_error(sql text, label text, pattern text default null) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'FAIL (should have been refused): %', label;
exception
  when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    if pattern is not null and sqlerrm !~ pattern then raise exception 'FAIL: % refused for the wrong reason: %', label, sqlerrm; end if;
    raise notice 'ok   refused: % (%)', label, sqlerrm;
  when others then
    if pattern is not null and sqlerrm !~ pattern then raise exception 'FAIL: % refused for the wrong reason: %', label, sqlerrm; end if;
    raise notice 'ok   refused: % (%)', label, sqlerrm;
end $$;
create function pg_temp.check(cond boolean, label text) returns void language plpgsql as $$
begin
  if not cond then raise exception 'FAIL: %', label; end if;
  raise notice 'ok   %', label;
end $$;

-- Users from the earlier tests: owner …a, alice …b (approved), carol …21, dave …22 (approved).
-- Lifecycle: a 2-player game starts by itself when full.
begin;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
insert into public.games (name, era, max_players) values ('Duel', 'ww2', 2);
insert into public.game_players (game_id, nation_id) select id, 31 from public.games where name = 'Duel';
select pg_temp.check((select status = 'open' from public.games where name = 'Duel'), 'one of two seats taken: still open');
select pg_temp.act_as('00000000-0000-0000-0000-000000000021');
insert into public.game_players (game_id, nation_id) select id, 4 from public.open_games() where name = 'Duel';
select pg_temp.check((select status = 'running' and started_at is not null and ticked_at is null from public.games where name = 'Duel'), 'last seat taken: the game started by itself');
commit;

-- Pause / resume / finish: creator (or owner) only.
begin;
select pg_temp.act_as('00000000-0000-0000-0000-000000000021');
update public.games set status = 'paused' where name = 'Duel';
select pg_temp.check((select status = 'running' from public.games where name = 'Duel'), 'carol (not the creator) cannot pause');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
update public.games set status = 'paused' where name = 'Duel';
select pg_temp.check((select status = 'paused' from public.games where name = 'Duel'), 'alice pauses her game');
update public.games set status = 'running' where name = 'Duel';
select pg_temp.check((select status = 'running' and ticked_at > now() - interval '1 minute' from public.games where name = 'Duel'), 'resumed: the pause is not made up (tick clock reset)');
select pg_temp.expect_error($$update public.games set status = 'open' where name = 'Duel'$$, 'back to the lobby', 'lobby');
commit;

-- Views (fog of war): the tick (service role) writes one per player; each player reads only theirs.
begin;
select pg_temp.as_service();
insert into public.game_states (game_id, tick, state) select id, 1, 'FULL' from public.games where name = 'Duel';
insert into public.game_views (game_id, nation_id, tick, state) select id, 31, 1, 'VIEW-31' from public.games where name = 'Duel';
insert into public.game_views (game_id, nation_id, tick, state) select id, 4, 1, 'VIEW-4' from public.games where name = 'Duel';
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) = 1 and min(state) = 'VIEW-31' from public.game_views), 'alice reads only her own view');
select pg_temp.check((select count(*) = 0 from public.game_states where game_id = (select id from public.games where name = 'Duel')), 'alice cannot read the full state (fog of war)');
select pg_temp.expect_error($$insert into public.game_views (game_id, nation_id, state) select id, 31, 'x' from public.games where name = 'Duel'$$, 'a player writing a view');
select pg_temp.act_as('00000000-0000-0000-0000-000000000022');
select pg_temp.check((select count(*) = 0 from public.game_views), 'dave (not in the game) reads no view');
select pg_temp.act_as('00000000-0000-0000-0000-000000000021');
select pg_temp.expect_error($$update public.game_players set ai_controlled = false where user_id = auth.uid()$$, 'a player clearing their computer-handover flag');
update public.game_players set last_seen = now() where user_id = auth.uid();
select pg_temp.check(true, 'a player marks themselves seen');
commit;

-- Tick leases (service role only).
begin;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$select public.claim_tick((select id from public.games where name = 'Duel'))$$, 'a player calling claim_tick');
select pg_temp.as_service();
select pg_temp.check((select (select id from public.games where name = 'Duel') not in (select * from public.due_games())), 'just resumed: not due yet');
update public.games set ticked_at = now() - interval '6 minutes' where name = 'Duel';
select pg_temp.check((select (select id from public.games where name = 'Duel') in (select * from public.due_games())), 'due_games lists it once 5 minutes have passed');
select pg_temp.check(public.claim_tick((select id from public.games where name = 'Duel')), 'first claim gets the lease');
select pg_temp.check(not public.claim_tick((select id from public.games where name = 'Duel')), 'a second tick while leased is refused');
select pg_temp.check((select (select id from public.games where name = 'Duel') not in (select * from public.due_games())), 'a leased game is not due');
select public.finish_tick((select id from public.games where name = 'Duel'), 321);
select pg_temp.check((select tick_lease_until is null and last_tick_ms = 321 from public.games where name = 'Duel'), 'finish_tick releases the lease');
select pg_temp.check(public.claim_tick((select id from public.games where name = 'Duel'), true), 'on-demand tick allowed');
select public.finish_tick((select id from public.games where name = 'Duel'), 300);
select pg_temp.check(not public.claim_tick((select id from public.games where name = 'Duel'), true), 'another on-demand tick within 20 s refused (cooldown)');
select pg_temp.check(public.claim_tick((select id from public.games where name = 'Duel'), false), 'the schedule still ticks it');
select public.finish_tick((select id from public.games where name = 'Duel'), 300);
commit;

-- Limits.
begin;
select pg_temp.act_as('00000000-0000-0000-0000-000000000022');
insert into public.games (name, era) values ('Dave 1', 'ww1');
insert into public.games (name, era) values ('Dave 2', 'ww1');
select pg_temp.expect_error($$insert into public.games (name, era) values ('Dave 3', 'ww1')$$, 'a third active game for dave', 'limit 2');
commit;

begin;
select pg_temp.act_as('00000000-0000-0000-0000-000000000021');
-- carol already sits in Duel (running); two more seats, then the limit.
insert into public.game_players (game_id, nation_id) select id, 1 from public.open_games() where name = 'Dave 1';
insert into public.game_players (game_id, nation_id) select id, 1 from public.open_games() where name = 'Dave 2';
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
insert into public.games (name, era) values ('Alice 2', 'rome');
select pg_temp.act_as('00000000-0000-0000-0000-000000000021');
select pg_temp.expect_error($$insert into public.game_players (game_id, nation_id) select id, 1 from public.open_games() where name = 'Alice 2'$$, 'a fourth seat for carol', 'limit 3');
commit;

begin;
select pg_temp.act_as('00000000-0000-0000-0000-000000000021');
-- One order at a time until refused: the limit is reached at exactly 20 in the last minute.
do $$ declare i int := 0; begin
  loop
    begin
      insert into public.game_commands (game_id, nation_id, kind) select id, 4, 'army.stop' from public.games where name = 'Duel';
    exception when raise_exception then
      if sqlerrm !~ 'at most 20 a minute' then raise; end if;
      exit;
    end;
    i := i + 1;
    if i > 30 then raise exception 'FAIL: no order limit'; end if;
  end loop;
end $$;
select pg_temp.check((select count(*) = 20 from public.game_commands where user_id = auth.uid() and created_at > now() - interval '1 minute'), 'orders refused after 20 in a minute ("Too many orders: at most 20 a minute")');
commit;

begin;
update private.mp_limits set max_active_games = (select count(*) from public.games where status in ('open', 'running', 'paused'));
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error($$insert into public.games (name, era) values ('Owner game', 'ww2')$$, 'a new game when the server is full (even for the owner)', 'server is full');
reset role;
update private.mp_limits set max_active_games = 40;
commit;

-- Finished games stay readable and can't be restarted.
begin;
select pg_temp.as_service();
update public.games set status = 'finished', winner = 31, end_reason = 'German Reich reached 50 victory points.' where name = 'Duel';
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select status = 'finished' and winner = 31 and ended_at is not null from public.games where name = 'Duel'), 'finished: winner and end time kept, still readable');
select pg_temp.check((select count(*) = 1 from public.game_views), 'the last view of a finished game stays readable');
select pg_temp.check((select count(*) >= 1 from public.open_games() where name = 'Duel' and status = 'finished'), 'the lobby still lists it for its players');
select pg_temp.expect_error($$update public.games set status = 'running' where name = 'Duel'$$, 'restarting a finished game', 'has ended');
commit;

\echo ALL MULTIPLAYER 11B POLICY TESTS PASSED
