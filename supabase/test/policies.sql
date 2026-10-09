-- Behaviour tests for schema.sql. Each block acts as a specific user, the way
-- PostgREST does (role + JWT claims), and asserts what must succeed or fail.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
update private.settings set value = 'owner@example.com' where key = 'owner_email';

insert into auth.users values
  ('00000000-0000-0000-0000-00000000000a', 'owner@example.com', now(), '{"provider":"google"}', '{"full_name":"The Owner"}'),
  ('00000000-0000-0000-0000-00000000000b', 'alice@example.com', now(), '{"provider":"discord"}', '{"full_name":"Alice"}'),
  ('00000000-0000-0000-0000-00000000000c', 'bob@example.com', now(), '{"provider":"github"}', '{"user_name":"bobcodes"}'),
  ('00000000-0000-0000-0000-00000000000d', 'owner@example.com.evil', now(), '{"provider":"x"}', '{}'),
  ('00000000-0000-0000-0000-00000000000e', 'OWNER@example.com', null, '{"provider":"twitch"}', '{}');

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

-- Alice requests access and tries to forge her row.
begin;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
insert into public.beta_users (user_id, provider, display_name, email, status)
values ('00000000-0000-0000-0000-00000000000b', 'fake', 'Fake Name', 'fake@x.com', 'approved');
select pg_temp.check((select status = 'pending' and provider = 'discord' and email = 'alice@example.com' and display_name = 'Alice' from public.beta_users), 'alice row forced to pending, provider/name/email from auth record');
select pg_temp.expect_error($$insert into public.beta_users (user_id, provider) values ('00000000-0000-0000-0000-00000000000c', 'x')$$, 'alice creating a row for bob');
-- RLS doesn't raise on a forbidden update: it matches zero rows. Check nothing changed.
update public.beta_users set status = 'approved' where user_id = auth.uid();
select pg_temp.check((select status = 'pending' from public.beta_users), 'alice approving herself has no effect');
select pg_temp.expect_error($$update public.beta_users set email = 'x@y.z' where user_id = auth.uid()$$, 'alice editing her email');
select pg_temp.expect_error($$delete from public.beta_users where user_id = auth.uid()$$, 'alice deleting her row');
commit;

-- Bob requests access; he must not see Alice.
begin;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
insert into public.beta_users (user_id, provider) values ('00000000-0000-0000-0000-00000000000c', 'whatever');
select pg_temp.check((select count(*) = 1 from public.beta_users), 'bob sees only his own row');
select pg_temp.check((select display_name = 'bobcodes' from public.beta_users), 'bob display name from user_name');
select pg_temp.check(not public.is_owner(), 'bob is not owner');
commit;

-- Look-alike emails are not the owner.
begin;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select pg_temp.check(not public.is_owner(), 'owner@example.com.evil is not owner');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select pg_temp.check(not public.is_owner(), 'unconfirmed OWNER@example.com is not owner');
commit;

-- Owner: auto-approved, sees everyone, can change status (and only status).
begin;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select pg_temp.check(public.is_owner(), 'owner recognised (case-insensitive email, confirmed)');
insert into public.beta_users (user_id, provider) values ('00000000-0000-0000-0000-00000000000a', 'x');
select pg_temp.check((select status = 'approved' from public.beta_users where user_id = auth.uid()), 'owner row auto-approved');
select pg_temp.check((select count(*) = 3 from public.beta_users), 'owner sees all rows');
update public.beta_users set status = 'approved' where user_id = '00000000-0000-0000-0000-00000000000b';
update public.beta_users set status = 'denied' where user_id = '00000000-0000-0000-0000-00000000000c';
select pg_temp.check((select decided_by = auth.uid() and decided_at is not null from public.beta_users where user_id = '00000000-0000-0000-0000-00000000000b'), 'decision stamped with owner and time');
select pg_temp.expect_error($$update public.beta_users set email = 'x@y.z' where user_id = '00000000-0000-0000-0000-00000000000b'$$, 'owner editing a tester email via API');
commit;

-- Alice now sees herself approved; Bob sees denied.
begin;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select status = 'approved' from public.beta_users), 'alice sees approved');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select pg_temp.check((select status = 'denied' from public.beta_users), 'bob sees denied');
select pg_temp.expect_error($$insert into public.beta_users (user_id, provider) values ('00000000-0000-0000-0000-00000000000c', 'x')$$, 'bob re-requesting after denial (duplicate row)');
commit;

-- Anonymous visitors get nothing.
begin;
set local role anon;
select pg_temp.expect_error($$select * from public.beta_users$$, 'anon reading the table');
select pg_temp.expect_error($$select public.is_owner()$$, 'anon calling is_owner');
commit;

\echo ALL POLICY TESTS PASSED
