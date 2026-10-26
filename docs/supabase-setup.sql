-- =============================================================================
-- Iron Meridian — beta access setup for Supabase
--
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run again: it replaces functions, triggers and policies, and makes
-- the owner list match the one below. It never deletes testers.
--
-- Written for this project's settings: new tables are NOT exposed to the API
-- automatically (so this file grants exactly what the game needs) and RLS is
-- on for new tables (this file also turns it on explicitly).
--
-- What it allows:
--   • a signed-in user can create their OWN row (always as "pending") and
--     read their own row (their status)
--   • owners (the emails listed below) can read every row and change status
--   • nobody else can read other people's rows or change any status
-- =============================================================================

-- Private schema: not exposed through the API.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Owners. >>> EDIT THIS LIST <<< (keep it the same as OWNER_EMAILS in
-- js/config.js; `npm test` checks that they match). Matched by the CONFIRMED
-- email of whatever account the owner signs in with: Google, Discord, GitHub,
-- Twitch or an email link.
-- -----------------------------------------------------------------------------

create table if not exists private.owner_emails (
  email text primary key check (email = lower(email))
);
revoke all on private.owner_emails from public, anon, authenticated;

with wanted(email) as (
  values
    ('marcoferreirag3@gmail.com')
)
, added as (
  insert into private.owner_emails (email)
  select lower(email) from wanted
  on conflict (email) do nothing
)
delete from private.owner_emails o
where o.email not in (select lower(email) from wanted);

-- -----------------------------------------------------------------------------
-- Beta users
-- -----------------------------------------------------------------------------

do $$ begin
  create type public.beta_status as enum ('pending', 'approved', 'denied');
exception when duplicate_object then null; end $$;

create table if not exists public.beta_users (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  provider     text not null,
  display_name text,
  email        text,
  status       public.beta_status not null default 'pending',
  requested_at timestamptz not null default now(),
  decided_at   timestamptz,
  decided_by   uuid
);

comment on table public.beta_users is 'Iron Meridian beta testers. Users create their own row (always pending); only owners change status.';

-- -----------------------------------------------------------------------------
-- Owner check: the signed-in user's email is confirmed and on the owner list.
-- security definer so it can read auth.users and private.owner_emails.
-- -----------------------------------------------------------------------------

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    join private.owner_emails o on o.email = lower(u.email)
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
  );
$$;

revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

-- -----------------------------------------------------------------------------
-- Triggers: users can't forge their own row. On insert the server fills in
-- provider, name and email from the auth record and forces status = pending
-- (approved for an owner). On update the decision time and decider are stamped.
-- -----------------------------------------------------------------------------

create or replace function private.beta_users_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  u auth.users%rowtype;
begin
  select * into u from auth.users where id = auth.uid();
  if u.id is null or new.user_id is distinct from u.id then
    raise exception 'You can only request access for your own account';
  end if;

  new.email        := u.email;
  new.provider     := coalesce(u.raw_app_meta_data ->> 'provider', 'email');
  new.display_name := coalesce(
    nullif(u.raw_user_meta_data ->> 'full_name', ''),
    nullif(u.raw_user_meta_data ->> 'name', ''),
    nullif(u.raw_user_meta_data ->> 'user_name', ''),
    nullif(u.raw_user_meta_data ->> 'preferred_username', ''),
    split_part(u.email, '@', 1)
  );
  new.requested_at := now();
  new.status       := case when public.is_owner() then 'approved'::public.beta_status else 'pending'::public.beta_status end;
  new.decided_at   := null;
  new.decided_by   := null;
  return new;
end;
$$;

create or replace function private.beta_users_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.decided_at := now();
    new.decided_by := auth.uid();
  end if;
  return new;
end;
$$;

revoke all on function private.beta_users_before_insert() from public, anon, authenticated;
revoke all on function private.beta_users_before_update() from public, anon, authenticated;

drop trigger if exists beta_users_before_insert on public.beta_users;
create trigger beta_users_before_insert
  before insert on public.beta_users
  for each row execute function private.beta_users_before_insert();

drop trigger if exists beta_users_before_update on public.beta_users;
create trigger beta_users_before_update
  before update on public.beta_users
  for each row execute function private.beta_users_before_update();

-- -----------------------------------------------------------------------------
-- Grants (new tables aren't exposed automatically in this project) and
-- row-level security.
-- -----------------------------------------------------------------------------

grant usage on schema public to authenticated;
grant usage on type public.beta_status to authenticated;

revoke all on public.beta_users from public, anon, authenticated;
grant select, insert on public.beta_users to authenticated;
grant update (status) on public.beta_users to authenticated;

alter table public.beta_users enable row level security;

drop policy if exists "read own row or owner reads all" on public.beta_users;
create policy "read own row or owner reads all"
  on public.beta_users for select
  to authenticated
  using (user_id = (select auth.uid()) or (select public.is_owner()));

drop policy if exists "create own row" on public.beta_users;
create policy "create own row"
  on public.beta_users for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "owner changes status" on public.beta_users;
create policy "owner changes status"
  on public.beta_users for update
  to authenticated
  using ((select public.is_owner()))
  with check ((select public.is_owner()));

-- -----------------------------------------------------------------------------
-- Realtime: the "Pending approval" screen updates live when an owner approves.
-- (Realtime respects the policies above: testers only receive their own row.)
-- -----------------------------------------------------------------------------

do $$ begin
  alter publication supabase_realtime add table public.beta_users;
exception when duplicate_object then null; when undefined_object then null; end $$;
