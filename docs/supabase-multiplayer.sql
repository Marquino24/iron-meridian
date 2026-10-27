-- =============================================================================
-- Iron Meridian — multiplayer foundation (step 11A) for Supabase
--
-- Run docs/supabase-setup.sql first (beta testers and owners), then paste this
-- whole file into Supabase → SQL Editor → New query → Run. Safe to run again:
-- it creates what's missing and replaces functions, triggers and policies. It
-- never deletes games or players.
--
-- Tables
--   games          one persistent game: era, map, speed, player limit, clock
--   game_players   who plays which nation in a game
--   game_states    the saved game (gzip JSON, base64), written by the authority
--   game_commands  player orders (recruit, move, build, research, diplomacy…)
--                  waiting for the authority to validate and apply them
--
-- Who can do what
--   • only approved beta users (or owners) can create or join games
--   • players read only the games they're in (their state, their players);
--     open games are listed for approved users through public.open_games(),
--     which shows lobby facts only (name, era, speed, seats taken)
--   • a player sends commands only for their own nation, and reads only their
--     own commands (opponents' orders stay hidden)
--   • game state and command results are written by the authority: the
--     service role (an Edge Function or scheduled worker; it bypasses RLS) —
--     or an owner, for testing
--   • owners see and manage everything
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Helpers (security definer: they read tables the caller can't).
-- -----------------------------------------------------------------------------

create or replace function public.is_approved()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_owner() or exists (
    select 1 from public.beta_users b
    where b.user_id = auth.uid() and b.status = 'approved'
  );
$$;
revoke all on function public.is_approved() from public, anon;
grant execute on function public.is_approved() to authenticated;

-- -----------------------------------------------------------------------------
-- Games
-- -----------------------------------------------------------------------------

create table if not exists public.games (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (char_length(btrim(name)) between 1 and 60),
  era              text not null check (era in ('rome', 'medieval', 'ww1', 'ww2', 'coldwar', 'modern', 'fictional')),
  map_seed         text check (map_seed is null or char_length(map_seed) between 1 and 40),
  -- Real minutes per game day (1 game day ≈ a few real minutes).
  minutes_per_day  numeric not null default 4 check (minutes_per_day between 0.5 and 120),
  max_players      int not null default 10 check (max_players between 2 and 20),
  status           text not null default 'open' check (status in ('open', 'running', 'paused', 'finished')),
  created_by       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  -- The authority's clock: the game time reached and the last tick.
  game_time        bigint,
  tick             bigint not null default 0,
  ticked_at        timestamptz,
  constraint fictional_needs_seed check (era <> 'fictional' or map_seed is not null)
);
comment on table public.games is 'Iron Meridian persistent multiplayer games.';

create table if not exists public.game_players (
  game_id     uuid not null references public.games (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nation_id   int not null check (nation_id >= 0),
  joined_at   timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  primary key (game_id, user_id),
  unique (game_id, nation_id)
);
comment on table public.game_players is 'Who plays which nation in a game (nations without a player are computer-run).';

create table if not exists public.game_states (
  game_id     uuid primary key references public.games (id) on delete cascade,
  tick        bigint not null default 0,
  version     int not null default 2,
  state       text not null,             -- base64 of the gzip'd save JSON (js/save.js)
  bytes       int generated always as (octet_length(state)) stored,
  updated_at  timestamptz not null default now()
);
comment on table public.game_states is 'Saved game state, written by the game authority.';

create table if not exists public.game_commands (
  id          bigint generated always as identity primary key,
  game_id     uuid not null references public.games (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nation_id   int not null,
  kind        text not null check (kind ~ '^[a-z][a-z.-]{1,39}$'),
  payload     jsonb not null default '{}' check (pg_column_size(payload) <= 4096),
  created_at  timestamptz not null default now(),
  status      text not null default 'pending' check (status in ('pending', 'applied', 'rejected')),
  tick        bigint,                    -- set by the authority when applied
  result      text
);
create index if not exists game_commands_pending on public.game_commands (game_id, id) where status = 'pending';
comment on table public.game_commands is 'Player orders, validated and applied by the game authority (js/commands.js kinds).';

-- Is the signed-in user in this game? (security definer: avoids RLS recursion)
create or replace function public.in_game(g uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.game_players p where p.game_id = g and p.user_id = auth.uid());
$$;
revoke all on function public.in_game(uuid) from public, anon;
grant execute on function public.in_game(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Triggers: games are created as "open" by their creator; joining checks the
-- game is open or running, has a free seat, and the user is approved.
-- -----------------------------------------------------------------------------

create or replace function private.games_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_approved() then raise exception 'Only approved beta testers can create games'; end if;
  new.created_by := auth.uid();
  new.status     := 'open';
  new.created_at := now();
  new.started_at := null;
  new.game_time  := null;
  new.tick       := 0;
  new.ticked_at  := null;
  new.name       := btrim(new.name);
  return new;
end;
$$;

create or replace function private.game_players_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.games%rowtype;
  seats int;
begin
  if not public.is_approved() then raise exception 'Only approved beta testers can join games'; end if;
  if new.user_id is distinct from auth.uid() and not public.is_owner() then
    raise exception 'You can only join as yourself';
  end if;
  -- Lock the game row so two players can't take the last seat at once.
  select * into g from public.games where id = new.game_id for update;
  if g.id is null then raise exception 'No such game'; end if;
  if g.status not in ('open', 'running') then raise exception 'This game is not taking players'; end if;
  select count(*) into seats from public.game_players where game_id = new.game_id;
  if seats >= g.max_players then raise exception 'This game is full'; end if;
  new.joined_at := now();
  new.last_seen := now();
  return new;
end;
$$;

-- A command must come from a player of that game, for their own nation, while it runs.
create or replace function private.game_commands_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  st text;
begin
  if not exists (
    select 1 from public.game_players p
    where p.game_id = new.game_id and p.user_id = auth.uid() and p.nation_id = new.nation_id
  ) then
    raise exception 'You can only give orders to your own nation';
  end if;
  select status into st from public.games where id = new.game_id;
  if st not in ('open', 'running') then raise exception 'This game is not running'; end if;
  new.user_id    := auth.uid();
  new.created_at := now();
  new.status     := 'pending';
  new.tick       := null;
  new.result     := null;
  return new;
end;
$$;

revoke all on function private.games_before_insert() from public, anon, authenticated;
revoke all on function private.game_players_before_insert() from public, anon, authenticated;
revoke all on function private.game_commands_before_insert() from public, anon, authenticated;

drop trigger if exists games_before_insert on public.games;
create trigger games_before_insert before insert on public.games
  for each row execute function private.games_before_insert();
drop trigger if exists game_players_before_insert on public.game_players;
create trigger game_players_before_insert before insert on public.game_players
  for each row execute function private.game_players_before_insert();
drop trigger if exists game_commands_before_insert on public.game_commands;
create trigger game_commands_before_insert before insert on public.game_commands
  for each row execute function private.game_commands_before_insert();

-- -----------------------------------------------------------------------------
-- Lobby: open games for approved users (lobby facts only), and the nations
-- already taken in a game (ids only, so a joining player can pick a free one).
-- -----------------------------------------------------------------------------

create or replace function public.open_games()
returns table (id uuid, name text, era text, map_seed text, minutes_per_day numeric, max_players int,
               players int, status text, created_at timestamptz, mine boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, g.name, g.era, g.map_seed, g.minutes_per_day, g.max_players,
         (select count(*)::int from public.game_players p where p.game_id = g.id),
         g.status, g.created_at,
         exists (select 1 from public.game_players p where p.game_id = g.id and p.user_id = auth.uid())
  from public.games g
  where public.is_approved() and g.status in ('open', 'running')
  order by g.created_at desc
  limit 100;
$$;
revoke all on function public.open_games() from public, anon;
grant execute on function public.open_games() to authenticated;

create or replace function public.taken_nations(g uuid)
returns int[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(nation_id order by nation_id), '{}')
  from public.game_players
  where game_id = g and public.is_approved();
$$;
revoke all on function public.taken_nations(uuid) from public, anon;
grant execute on function public.taken_nations(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Grants and row-level security
-- -----------------------------------------------------------------------------

grant usage on schema public to authenticated;

revoke all on public.games, public.game_players, public.game_states, public.game_commands from public, anon, authenticated;
grant select, insert, delete on public.games to authenticated;
grant update (name, status, max_players, minutes_per_day) on public.games to authenticated;
grant select, insert, delete on public.game_players to authenticated;
grant update (last_seen) on public.game_players to authenticated;
grant select, insert, update, delete on public.game_states to authenticated;
grant select, insert on public.game_commands to authenticated;

alter table public.games enable row level security;
alter table public.game_players enable row level security;
alter table public.game_states enable row level security;
alter table public.game_commands enable row level security;

-- games
drop policy if exists "players read their games" on public.games;
create policy "players read their games" on public.games for select to authenticated
  using (created_by = (select auth.uid()) or (select public.in_game(id)) or (select public.is_owner()));
drop policy if exists "approved users create games" on public.games;
create policy "approved users create games" on public.games for insert to authenticated
  with check ((select public.is_approved()));
drop policy if exists "creator or owner manages a game" on public.games;
create policy "creator or owner manages a game" on public.games for update to authenticated
  using (created_by = (select auth.uid()) or (select public.is_owner()))
  with check (created_by = (select auth.uid()) or (select public.is_owner()));
drop policy if exists "creator deletes an open game, owner any" on public.games;
create policy "creator deletes an open game, owner any" on public.games for delete to authenticated
  using ((created_by = (select auth.uid()) and status = 'open') or (select public.is_owner()));

-- game_players
drop policy if exists "players see who plays their games" on public.game_players;
create policy "players see who plays their games" on public.game_players for select to authenticated
  using ((select public.in_game(game_id)) or (select public.is_owner()));
drop policy if exists "approved users join as themselves" on public.game_players;
create policy "approved users join as themselves" on public.game_players for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_approved()));
drop policy if exists "players leave, owner removes anyone" on public.game_players;
create policy "players leave, owner removes anyone" on public.game_players for delete to authenticated
  using (user_id = (select auth.uid()) or (select public.is_owner()));
drop policy if exists "players mark themselves seen" on public.game_players;
create policy "players mark themselves seen" on public.game_players for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- game_states: players read; only the authority (service role) or an owner writes.
drop policy if exists "players read their game state" on public.game_states;
create policy "players read their game state" on public.game_states for select to authenticated
  using ((select public.in_game(game_id)) or (select public.is_owner()));
drop policy if exists "owner writes game state" on public.game_states;
create policy "owner writes game state" on public.game_states for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

-- game_commands: players send orders for their own nation and read their own.
drop policy if exists "players read their own commands" on public.game_commands;
create policy "players read their own commands" on public.game_commands for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_owner()));
drop policy if exists "players send commands" on public.game_commands;
create policy "players send commands" on public.game_commands for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.in_game(game_id)));
