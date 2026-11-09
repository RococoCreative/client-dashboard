-- helpers.sql
-- The tests schema: fixtures and act-as-a-user helpers every *.test.sql file uses. The SQL
-- harness (run.sh) loads it after all migrations, so tests can create people the way a real
-- first sign-in does and then act as them under row level security.
--
-- Returning to system is done at top level in a test file, never by a helper:
--   reset role; select set_config('request.jwt.claims', '', true);

create schema if not exists tests;
grant usage on schema tests to authenticated, anon;

-- Test people by name, so a case can find a person it set up earlier in the same file.
create table if not exists tests.fixture (
  name text primary key,
  id   uuid not null
);
grant select on tests.fixture to authenticated, anon;

-- 0006 seeds kingdom, klasik and rba with their domains, so tests always look companies up by
-- slug and never create the three. Security definer for the same reason as tests.user_of:
-- tests call it while acting as a user whom RLS hides the other companies from.
create or replace function tests.company(p_slug text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.companies where slug = p_slug;
  if v_id is null then
    raise exception 'No company with slug %', p_slug;
  end if;
  return v_id;
end;
$$;

-- Creates a person through auth.users, so handle_new_user runs exactly as on a real first
-- sign-in, then sets their company and role as system. Call it only as system.
create or replace function tests.create_person(
  p_name    text,
  p_company uuid,
  p_role    text default 'employee',
  p_rococo  boolean default false
)
returns uuid
language plpgsql
as $$
declare
  v_domain  text;
  v_email   text;
  v_user    uuid;
  v_profile uuid;
begin
  if p_rococo then
    v_domain := 'rocococreative.io';
  else
    select domain into v_domain
      from public.company_domains
     where company_id = p_company
     order by domain
     limit 1;
    v_domain := coalesce(v_domain, 'example.test');
  end if;

  -- Six random hex characters keep two people with the same name apart within one file.
  v_email := lower(regexp_replace(p_name, '[^A-Za-z0-9]+', '.', 'g'))
             || '.' || substr(md5(random()::text), 1, 6) || '@' || v_domain;

  insert into auth.users (email, raw_user_meta_data)
  values (v_email, jsonb_build_object('full_name', p_name))
  returning id into v_user;

  update public.profiles
     set company_id      = p_company,
         role            = p_role,
         is_rococo_admin = p_rococo,
         full_name       = p_name
   where user_id = v_user
  returning id into v_profile;

  insert into tests.fixture (name, id) values (p_name, v_profile)
  on conflict (name) do update set id = excluded.id;

  return v_profile;
end;
$$;

create or replace function tests.id(p_name text)
returns uuid
language plpgsql
stable
as $$
declare
  v_id uuid;
begin
  select id into v_id from tests.fixture where name = p_name;
  if v_id is null then
    raise exception 'No fixture named %', p_name;
  end if;
  return v_id;
end;
$$;

-- act_as must read a profile's account id even when the caller is already acting as someone
-- RLS hides it from, and act_as itself cannot be security definer (Postgres refuses a role
-- change inside one).
create or replace function tests.user_of(p_profile uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select user_id from public.profiles where id = p_profile
$$;
grant execute on function tests.user_of(uuid) to authenticated, anon;

-- Acts as that person's account for the rest of the transaction, the way PostgREST sets up a
-- signed-in request.
create or replace function tests.act_as(p_profile uuid)
returns void
language plpgsql
as $$
declare
  v_user uuid := tests.user_of(p_profile);
begin
  if v_user is null then
    raise exception 'That profile has no account';
  end if;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- A null counts as failure.
create or replace function tests.assert(p_ok boolean, p_message text)
returns void
language plpgsql
as $$
begin
  if p_ok is not true then
    raise exception 'Assertion failed: %', p_message;
  end if;
end;
$$;

-- Runs the statement as whoever is acting and expects it to fail with a matching message.
-- The "nothing raised" raise sits outside the exception block, or the handler would swallow it.
create or replace function tests.assert_raises(p_sql text, p_like text)
returns void
language plpgsql
as $$
declare
  v_error text;
begin
  begin
    execute p_sql;
  exception when others then
    v_error := sqlerrm;
  end;
  if v_error is null then
    raise exception 'Expected an error like % from: %', p_like, p_sql;
  end if;
  if v_error not like p_like then
    raise exception 'Expected an error like % but got: %', p_like, v_error;
  end if;
end;
$$;

grant execute on all functions in schema tests to authenticated, anon;
