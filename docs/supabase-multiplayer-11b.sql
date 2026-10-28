-- =============================================================================
-- Iron Meridian — multiplayer step 11B: playable games
--
-- Run AFTER docs/supabase-setup.sql and docs/supabase-multiplayer.sql. Paste
-- the whole file into Supabase → SQL Editor → New query → Run. Safe to run
-- again: it adds what's missing and replaces functions, triggers and policies.
-- It never deletes games, players or states.
--
-- What it adds
--   • game lifecycle: start (by the creator, or by itself when the game is
--     full), pause / resume, finished games with a winner; inactive players
--     (inactive_days, per game) are handed to the AI by the tick
--   • game_views: what each player may see (fog of war, written by the tick).
--     Players no longer read the full game_states: only the server does
--   • limits that keep the free tier safe: active games in total, games per
--     creator, seats per player, orders per minute, on-demand tick cooldown
--   • claim_tick() / finish_tick() / due_games(): used by the tick Edge
--     Function (service role only) so two ticks never run on one game at once
--   • Realtime on games (tick, status) and game_commands (order results)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Limits (edit here, then run this file again). Owners are exempt from the
-- per-user limits, not from the total.
-- -----------------------------------------------------------------------------
create table if not exists private.mp_limits (
  id                     int primary key default 1 check (id = 1),
  max_active_games       int not null default 40,   -- open + running + paused, all users
  max_games_per_user     int not null default 2,    -- active games a user created
  max_seats_per_user     int not null default 3,    -- active games a user plays in
  orders_per_minute      int not null default 20,   -- per player
  tick_minutes           numeric not null default 5, -- scheduled tick interval
  tick_cooldown_seconds  int not null default 20     -- on-demand ticks per game
);
revoke all on private.mp_limits from public, anon, authenticated;
insert into private.mp_limits (id) values (1) on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Columns
-- -----------------------------------------------------------------------------
alter table public.games add column if not exists difficulty text not null default 'normal';
alter table public.games add column if not exists win_mode text not null default 'points';
alter table public.games add column if not exists time_limit numeric not null default 0;
alter table public.games add column if not exists inactive_days int not null default 7;
alter table public.games add column if not exists auto_start boolean not null default true;
alter table public.games add column if not exists ended_at timestamptz;
alter table public.games add column if not exists winner int;
alter table public.games add column if not exists end_reason text;
alter table public.games add column if not exists tick_lease_until timestamptz;
alter table public.games add column if not exists tick_requested_at timestamptz;
alter table public.games add column if not exists last_tick_ms int;

do $$ begin
  alter table public.games add constraint games_difficulty_check check (difficulty in ('easy', 'normal', 'hard'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.games add constraint games_win_mode_check check (win_mode in ('points', 'domination', 'none'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.games add constraint games_time_limit_check check (time_limit between 0 and 50);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.games add constraint games_inactive_days_check check (inactive_days between 1 and 60);
exception when duplicate_object then null; end $$;

alter table public.game_players add column if not exists ai_controlled boolean not null default false;

create table if not exists public.game_views (
  game_id     uuid not null references public.games (id) on delete cascade,
  nation_id   int not null,
  tick        bigint not null default 0,
  state       text not null,             -- base64 of the gzip'd save JSON, fogged for this nation
  bytes       int generated always as (octet_length(state)) stored,
  updated_at  timestamptz not null default now(),
  primary key (game_id, nation_id)
);
comment on table public.game_views is 'What each player sees of a game (fog of war), written by the tick.';

-- -----------------------------------------------------------------------------
-- Lifecycle: status changes go through this trigger.
--   open → running      creator or owner (or by itself when the game fills up)
--   running ⇄ paused     creator or owner; resuming doesn't make up the pause
--   any → finished       creator or owner (or the tick, by the win conditions)
-- -----------------------------------------------------------------------------
create or replace function private.games_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    if old.status = 'finished' then raise exception 'This game has ended'; end if;
    if new.status = 'open' then raise exception 'A game can''t go back to the lobby'; end if;
    if new.status = 'running' and old.status = 'open' then
      new.started_at := now();
      new.ticked_at  := null;   -- the first tick sets up the world
    end if;
    if new.status = 'running' and old.status = 'paused' then new.ticked_at := now(); end if;
    if new.status = 'finished' then new.ended_at := coalesce(new.ended_at, now()); end if;
  end if;
  return new;
end;
$$;
revoke all on function private.games_before_update() from public, anon, authenticated;
drop trigger if exists games_before_update on public.games;
create trigger games_before_update before update on public.games
  for each row execute function private.games_before_update();

-- Starts by itself when the last seat is taken.
create or replace function private.game_players_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.games g set status = 'running'
  where g.id = new.game_id and g.status = 'open' and g.auto_start
    and (select count(*) from public.game_players p where p.game_id = g.id) >= g.max_players;
  return new;
end;
$$;
revoke all on function private.game_players_after_insert() from public, anon, authenticated;
drop trigger if exists game_players_after_insert on public.game_players;
create trigger game_players_after_insert after insert on public.game_players
  for each row execute function private.game_players_after_insert();

-- -----------------------------------------------------------------------------
-- Limits on creating, joining and ordering (on top of 11A's checks).
-- -----------------------------------------------------------------------------
create or replace function private.games_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  l private.mp_limits%rowtype;
  n int;
begin
  select * into l from private.mp_limits where id = 1;
  select count(*) into n from public.games where status in ('open', 'running', 'paused');
  if n >= l.max_active_games then
    raise exception 'The server is full: % active games (the free tier''s limit). Try again when one ends.', n;
  end if;
  if not public.is_owner() then
    select count(*) into n from public.games where created_by = auth.uid() and status in ('open', 'running', 'paused');
    if n >= l.max_games_per_user then
      raise exception 'You already run % active games (limit %). Finish one first.', n, l.max_games_per_user;
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.game_players_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  l private.mp_limits%rowtype;
  n int;
begin
  select * into l from private.mp_limits where id = 1;
  if not public.is_owner() then
    select count(*) into n from public.game_players p join public.games g on g.id = p.game_id
    where p.user_id = auth.uid() and g.status in ('open', 'running', 'paused');
    if n >= l.max_seats_per_user then
      raise exception 'You already play in % active games (limit %).', n, l.max_seats_per_user;
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.game_commands_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  l private.mp_limits%rowtype;
  n int;
begin
  select * into l from private.mp_limits where id = 1;
  select count(*) into n from public.game_commands
  where user_id = auth.uid() and created_at > now() - interval '1 minute';
  if n >= l.orders_per_minute then
    raise exception 'Too many orders: at most % a minute. Wait a moment.', l.orders_per_minute;
  end if;
  return new;
end;
$$;

revoke all on function private.games_limits() from public, anon, authenticated;
revoke all on function private.game_players_limits() from public, anon, authenticated;
revoke all on function private.game_commands_limits() from public, anon, authenticated;
-- "a_" so these run before 11A's insert triggers (same timing: alphabetical order).
drop trigger if exists a_games_limits on public.games;
create trigger a_games_limits before insert on public.games
  for each row execute function private.games_limits();
drop trigger if exists a_game_players_limits on public.game_players;
create trigger a_game_players_limits before insert on public.game_players
  for each row execute function private.game_players_limits();
drop trigger if exists a_game_commands_limits on public.game_commands;
create trigger a_game_commands_limits before insert on public.game_commands
  for each row execute function private.game_commands_limits();

-- A player can't change their own computer-handover flag.
revoke update on public.game_players from authenticated;
grant update (last_seen) on public.game_players to authenticated;
-- Lobby settings a creator may set when creating a game.
grant update (name, status, max_players, minutes_per_day, inactive_days, auto_start) on public.games to authenticated;

-- open_games() also reports the new settings.
drop function if exists public.open_games();
create or replace function public.open_games()
returns table (id uuid, name text, era text, map_seed text, minutes_per_day numeric, max_players int,
               players int, status text, created_at timestamptz, mine boolean, created_by_me boolean,
               inactive_days int, started_at timestamptz, game_time bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, g.name, g.era, g.map_seed, g.minutes_per_day, g.max_players,
         (select count(*)::int from public.game_players p where p.game_id = g.id),
         g.status, g.created_at,
         exists (select 1 from public.game_players p where p.game_id = g.id and p.user_id = auth.uid()),
         g.created_by = auth.uid(), g.inactive_days, g.started_at, g.game_time
  from public.games g
  where public.is_approved()
    and (g.status in ('open', 'running', 'paused')
         or exists (select 1 from public.game_players p where p.game_id = g.id and p.user_id = auth.uid()))
  order by (g.status = 'finished'), g.created_at desc
  limit 100;
$$;
revoke all on function public.open_games() from public, anon;
grant execute on function public.open_games() to authenticated;

-- -----------------------------------------------------------------------------
-- The tick (service role only): lease a game so two ticks never overlap.
--   claim_tick(g, on_demand) → true if this caller may tick it now. On-demand
--   ticks (a player just sent an order) wait tick_cooldown_seconds between them.
-- -----------------------------------------------------------------------------
create or replace function public.claim_tick(g uuid, on_demand boolean default false)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  l private.mp_limits%rowtype;
  got uuid;
begin
  select * into l from private.mp_limits where id = 1;
  update public.games set
    tick_lease_until = now() + interval '90 seconds',
    tick_requested_at = case when on_demand then now() else tick_requested_at end
  where id = g and status = 'running'
    and (tick_lease_until is null or tick_lease_until < now())
    and (not on_demand or tick_requested_at is null or tick_requested_at < now() - make_interval(secs => l.tick_cooldown_seconds))
  returning id into got;
  return got is not null;
end;
$$;

create or replace function public.finish_tick(g uuid, ms int)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.games set tick_lease_until = null, last_tick_ms = ms where id = g;
$$;

-- Games the schedule should tick now.
create or replace function public.due_games()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select g.id from public.games g, private.mp_limits l
  where l.id = 1 and g.status = 'running'
    and (g.ticked_at is null or g.ticked_at < now() - make_interval(secs => (l.tick_minutes * 60)::int) + interval '15 seconds')
    and (g.tick_lease_until is null or g.tick_lease_until < now());
$$;

-- The tick Edge Function uses the service role. New tables aren't exposed
-- automatically in this project, so grant it exactly what the tick needs.
do $$ begin
  grant usage on schema public to service_role;
  grant select, insert, update, delete on public.games, public.game_players, public.game_states, public.game_views, public.game_commands to service_role;
exception when undefined_object then null; end $$;

revoke all on function public.claim_tick(uuid, boolean) from public, anon, authenticated;
revoke all on function public.finish_tick(uuid, int) from public, anon, authenticated;
revoke all on function public.due_games() from public, anon, authenticated;
do $$ begin
  grant execute on function public.claim_tick(uuid, boolean) to service_role;
  grant execute on function public.finish_tick(uuid, int) to service_role;
  grant execute on function public.due_games() to service_role;
exception when undefined_object then null; end $$;

-- -----------------------------------------------------------------------------
-- Grants and row-level security for the new pieces.
-- -----------------------------------------------------------------------------
revoke all on public.game_views from public, anon, authenticated;
grant select on public.game_views to authenticated;
alter table public.game_views enable row level security;

drop policy if exists "players read their own view" on public.game_views;
create policy "players read their own view" on public.game_views for select to authenticated
  using (exists (select 1 from public.game_players p
                 where p.game_id = game_views.game_id and p.user_id = (select auth.uid()) and p.nation_id = game_views.nation_id)
         or (select public.is_owner()));

-- Fog of war: players read their view, not the whole state.
drop policy if exists "players read their game state" on public.game_states;

-- -----------------------------------------------------------------------------
-- Realtime: clients hear about new ticks (games) and their orders' results
-- (game_commands). Realtime applies the policies above.
-- -----------------------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.games;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.game_commands;
exception when duplicate_object then null; when undefined_object then null; end $$;
