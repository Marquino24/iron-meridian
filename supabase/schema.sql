-- =============================================================================
-- Iron Meridian — beta access schema for Supabase
--
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- It is safe to run again (it replaces functions and policies).
--
-- BEFORE RUNNING: replace owner@example.com on the line marked  >>> OWNER <<<
-- with the email of the account YOU will sign in with (for example the
-- Google account you'll use). The owner is always approved and is the only
-- person who can approve, deny or revoke testers.
-- =============================================================================

-- Private schema: not exposed through the public API.
create schema if not exists private;

create table if not exists private.settings (
  key   text primary key,
  value text not null
);

insert into private.settings (key, value)
values ('owner_email', lower('owner@example.com'))          -- >>> OWNER <<<
on conflict (key) do update set value = excluded.value;

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

comment on table public.beta_users is 'Iron Meridian beta testers. Rows are created by the users themselves (as pending); only the owner can change status.';

-- -----------------------------------------------------------------------------
-- Owner check. The owner is the signed-in user whose CONFIRMED email matches
-- private.settings.owner_email. security definer lets it read auth.users.
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
    join private.settings s on s.key = 'owner_email'
    where u.id = auth.uid()
      and lower(u.email) = s.value
      and u.email_confirmed_at is not null
  );
$$;

revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

-- -----------------------------------------------------------------------------
-- Triggers: users can't forge their own row. On insert the server fills in
-- provider, name and email from the auth record and forces status = pending
-- (approved for the owner). On update the decision time and decider are stamped.
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

drop trigger if exists beta_users_before_insert on public.beta_users;
create trigger beta_users_before_insert
  before insert on public.beta_users
  for each row execute function private.beta_users_before_insert();

drop trigger if exists beta_users_before_update on public.beta_users;
create trigger beta_users_before_update
  before update on public.beta_users
  for each row execute function private.beta_users_before_update();

-- -----------------------------------------------------------------------------
-- Row-level security
--   • a user can create and read only their own row
--   • the owner can read every row and change status
--   • nobody (not even the owner, through the API) can edit other columns
-- -----------------------------------------------------------------------------

alter table public.beta_users enable row level security;

revoke all on public.beta_users from anon, authenticated;
grant select, insert on public.beta_users to authenticated;
grant update (status) on public.beta_users to authenticated;

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
-- Realtime: the "Pending approval" screen updates live when you approve.
-- (Realtime respects the policies above: testers only receive their own row.)
-- -----------------------------------------------------------------------------

do $$ begin
  alter publication supabase_realtime add table public.beta_users;
exception when duplicate_object then null; end $$;
