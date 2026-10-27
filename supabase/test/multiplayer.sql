-- Behaviour tests for docs/supabase-multiplayer.sql (run after policies.sql's
-- setup by supabase/test/run.sh). Acts as each user the way PostgREST does.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.expect_error(sql text, label text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'FAIL (should have been refused): %', label;
exception
  when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'ok   refused: % (%)', label, sqlerrm;
  when others then raise notice 'ok   refused: % (%)', label, sqlerrm;
end $$;
create function pg_temp.check(cond boolean, label text) returns void language plpgsql as $$
begin
  if not cond then raise exception 'FAIL: %', label; end if;
  raise notice 'ok   %', label;
end $$;

-- Users: owner (…a), alice approved (…b), bob denied (…c, from policies.sql), carol and dave approved, erin pending.
insert into auth.users values
  ('00000000-0000-0000-0000-000000000021', 'carol@example.com', now(), '{"provider":"google"}', '{"full_name":"Carol"}'),
  ('00000000-0000-0000-0000-000000000022', 'dave@example.com', now(), '{"provider":"google"}', '{"full_name":"Dave"}'),
  ('00000000-0000-0000-0000-000000000023', 'erin@example.com', now(), '{"provider":"google"}', '{"full_name":"Erin"}');
begin;
select pg_temp.act_as('00000000-0000-0000-0000-000000000021');
insert into public.beta_users (user_id, provider) values (auth.uid(), 'x');
select pg_temp.act_as('00000000-0000-0000-0000-000000000022');
insert into public.beta_users (user_id, provider) values (auth.uid(), 'x');
select pg_temp.act_as('00000000-0000-0000-0000-000000000023');
insert into public.beta_users (user_id, provider) values (auth.uid(), 'x');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
update public.beta_users set status = 'approved' where user_id in ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000022');
commit;

-- Creating games.
begin;
select pg_temp.act_as('00000000-0000-0000-0000-000000000023');
select pg_temp.check(not public.is_approved(), 'erin (pending) is not approved');
select pg_temp.expect_error($$insert into public.games (name, era) values ('Erin''s war', 'ww2')$$, 'pending user creating a game');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect_error($$insert into public.games (name, era) values ('Bob''s war', 'ww2')$$, 'denied user creating a game');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
insert into public.games (name, era, status, created_by, tick, max_players)
values ('  Alice''s Europe ', 'ww2', 'running', '00000000-0000-0000-0000-00000000000c', 99, 3);
select pg_temp.check((select status = 'open' and created_by = auth.uid() and tick = 0 and name = 'Alice''s Europe' from public.games), 'game created open, by alice, clock at 0 (forged fields ignored)');
select pg_temp.expect_error($$insert into public.games (name, era) values ('No seed', 'fictional')$$, 'fictional game without a map seed');
select pg_temp.expect_error($$insert into public.games (name, era, max_players) values ('Huge', 'ww2', 50)$$, 'more than 20 players');
select pg_temp.expect_error($$insert into public.games (name, era) values ('Mars', 'mars')$$, 'unknown era');
commit;

-- The lobby: approved users list open games; nobody reads a game's row before joining.
begin;
select pg_temp.act_as('00000000-0000-0000-0000-000000000021');
select pg_temp.check((select count(*) = 1 and bool_and(players = 0 and not mine) from public.open_games()), 'carol lists the open game (0 players)');
select pg_temp.check((select count(*) = 0 from public.games), 'carol cannot read the game row before joining');
select pg_temp.act_as('00000000-0000-0000-0000-000000000023');
select pg_temp.check((select count(*) = 0 from public.open_games()), 'pending erin lists no games');
commit;

-- Joining and picking nations.
begin;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
insert into public.game_players (game_id, nation_id) select id, 3 from public.games;
select pg_temp.act_as('00000000-0000-0000-0000-000000000021');
select pg_temp.expect_error($$insert into public.game_players (game_id, nation_id) select id, 3 from public.open_games()$$, 'carol taking alice''s nation');
insert into public.game_players (game_id, nation_id) select id, 5 from public.open_games();
select pg_temp.check((select count(*) = 1 from public.games), 'carol reads the game once she has joined');
select pg_temp.check((select count(*) = 2 from public.game_players), 'carol sees both players');
select pg_temp.check((select public.taken_nations(id) = '{3,5}' from public.open_games()), 'taken nations: 3 and 5');
select pg_temp.expect_error($$insert into public.game_players (game_id, user_id, nation_id) select id, '00000000-0000-0000-0000-000000000022', 7 from public.open_games()$$, 'carol signing dave up');
select pg_temp.expect_error($$update public.game_players set nation_id = 9 where user_id = auth.uid()$$, 'carol switching nation by update');
select pg_temp.act_as('00000000-0000-0000-0000-000000000023');
select pg_temp.expect_error($$insert into public.game_players (game_id, nation_id) values ((select id from public.games limit 1), 8)$$, 'pending erin joining');
select pg_temp.act_as('00000000-0000-0000-0000-000000000022');
insert into public.game_players (game_id, nation_id) select id, 7 from public.open_games();
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error($$insert into public.game_players (game_id, nation_id) select id, 1 from public.games$$, 'a fourth player in a 3-player game');
commit;

-- Commands.
begin;
select pg_temp.act_as('00000000-0000-0000-0000-000000000021');
select pg_temp.expect_error($$insert into public.game_commands (game_id, nation_id, kind, payload) select id, 3, 'army.move', '{"army":1,"to":9}' from public.games$$, 'carol ordering alice''s nation');
insert into public.game_commands (game_id, nation_id, kind, payload, status, result)
select id, 5, 'army.move', '{"army":1,"to":9}', 'applied', 'forged' from public.games;
select pg_temp.check((select status = 'pending' and result is null from public.game_commands), 'carol''s command stored as pending (forged status ignored)');
select pg_temp.expect_error($$insert into public.game_commands (game_id, nation_id, kind) select id, 5, 'DROP TABLE' from public.games$$, 'a malformed command kind');
select pg_temp.expect_error($$insert into public.game_commands (game_id, nation_id, kind, payload) select id, 5, 'army.move', jsonb_build_object('junk', repeat('x', 5000)) from public.games$$, 'an oversized payload');
select pg_temp.expect_error($$update public.game_commands set status = 'applied'$$, 'carol marking her command applied');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) = 0 from public.game_commands), 'alice cannot read carol''s orders');
commit;

-- Game state: written by the authority (service role, or an owner); read by players only.
begin;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$insert into public.game_states (game_id, state) select id, 'x' from public.games$$, 'a player writing the game state');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
insert into public.game_states (game_id, tick, state) select id, 1, 'H4sIAAAA' from public.games;
select pg_temp.act_as('00000000-0000-0000-0000-000000000021');
select pg_temp.check((select count(*) = 1 and min(bytes) = 8 from public.game_states), 'carol reads her game''s state');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) = 0 from public.game_states) and (select count(*) = 0 from public.game_players) and (select count(*) = 0 from public.games), 'bob (not in the game) reads nothing of it');
commit;

-- Managing: only the creator (or an owner) changes a game; leaving.
begin;
select pg_temp.act_as('00000000-0000-0000-0000-000000000021');
update public.games set status = 'finished';
select pg_temp.check((select status = 'open' from public.games), 'carol (not the creator) cannot change the game');
select pg_temp.expect_error($$update public.games set tick = 5$$, 'anyone setting the clock via the API');
delete from public.game_players where user_id = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check((select count(*) = 3 from public.game_players), 'carol cannot remove alice');
delete from public.game_players where user_id = auth.uid();
select pg_temp.check((select count(*) = 0 from public.game_players), 'carol left (and no longer sees the game)');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
update public.games set status = 'finished';
select pg_temp.check((select status = 'finished' from public.games), 'alice (creator) finishes the game');
select pg_temp.act_as('00000000-0000-0000-0000-000000000021');
select pg_temp.expect_error($$insert into public.game_players (game_id, nation_id) values ((select g.id from public.games g limit 1), 5)$$, 'joining a finished game');
select pg_temp.check((select count(*) = 0 from public.open_games()), 'finished games leave the lobby');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$insert into public.game_commands (game_id, nation_id, kind) select id, 3, 'army.move' from public.games$$, 'orders in a finished game');
delete from public.games;
select pg_temp.check((select count(*) = 1 from public.games), 'creator cannot delete a game once it has started');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) = 1 from public.games) and (select count(*) = 1 from public.game_commands), 'owner sees every game and command');
commit;

begin;
set local role anon;
select pg_temp.expect_error($$select * from public.games$$, 'anon reading games');
select pg_temp.expect_error($$select * from public.open_games()$$, 'anon listing games');
commit;

\echo ALL MULTIPLAYER POLICY TESTS PASSED
