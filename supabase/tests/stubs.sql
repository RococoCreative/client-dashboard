-- stubs.sql
-- Stand-ins for the parts of a Supabase project the migrations lean on but do not create:
-- the API roles, the default privileges Supabase grants on public, and the auth, storage,
-- extensions, vault, cron and net schemas. The SQL harness (run.sh) loads this into a
-- throwaway cluster before applying supabase/migrations/, so the migrations run unchanged.
--
-- postgres is a true superuser here (it is not on Supabase), so migrations run with full
-- rights. Tests must always switch to authenticated or anon before asserting anything about
-- access.

-- ---------------------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------------------
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role supabase_auth_admin nologin noinherit;
create role authenticator login noinherit;
grant anon, authenticated, service_role to authenticator;

-- ---------------------------------------------------------------------------------------
-- Supabase's default privileges on public (the migrations revoke from these roles)
-- ---------------------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on functions to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------
-- auth
-- ---------------------------------------------------------------------------------------
create schema auth;
grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;

-- The migrations read id, email and raw_user_meta_data only.
create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  raw_app_meta_data  jsonb default '{}'::jsonb,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

-- nullif(..., '') matters: after a test resets claims to '', a bare ''::jsonb would error.
create function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

create function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

grant execute on all functions in schema auth to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------
-- storage
-- ---------------------------------------------------------------------------------------
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;

create table storage.buckets (
  id                 text primary key,
  name               text not null,
  owner              uuid,
  public             boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

create table storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets (id),
  name       text,
  owner      uuid,
  metadata   jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table storage.objects enable row level security;

grant all on storage.buckets, storage.objects to anon, authenticated, service_role;

-- Every path segment but the last, as Supabase's own helper returns them.
create function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
$$;

-- ---------------------------------------------------------------------------------------
-- extensions (empty)
-- ---------------------------------------------------------------------------------------
create schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------
-- vault (no grants to API roles)
-- ---------------------------------------------------------------------------------------
create schema vault;

create table vault.secrets (
  id          uuid primary key default gen_random_uuid(),
  name        text unique,
  description text default '',
  secret      text not null,
  created_at  timestamptz default now()
);

create function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
returns uuid
language sql
as $$
  insert into vault.secrets (secret, name, description)
  values (new_secret, new_name, new_description)
  returning id
$$;

create view vault.decrypted_secrets as
  select id, name, description, secret, secret as decrypted_secret, created_at
    from vault.secrets;

-- ---------------------------------------------------------------------------------------
-- cron (stands in for pg_cron; no grants to API roles)
-- ---------------------------------------------------------------------------------------
create schema cron;

create table cron.job (
  jobid    bigserial primary key,
  schedule text not null,
  command  text not null,
  nodename text default 'localhost',
  nodeport integer default 5432,
  database text default current_database(),
  username text default current_user,
  active   boolean default true,
  jobname  text unique
);

create function cron.schedule(job_name text, schedule text, command text)
returns bigint
language sql
as $$
  insert into cron.job (jobname, schedule, command)
  values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid
$$;

create function cron.unschedule(job_name text)
returns boolean
language plpgsql
as $$
begin
  delete from cron.job where jobname = job_name;
  return found;
end;
$$;

create function cron.unschedule(job_id bigint)
returns boolean
language plpgsql
as $$
begin
  delete from cron.job where jobid = job_id;
  return found;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- net (stands in for pg_net; records calls, never touches the network; no grants to API roles)
-- ---------------------------------------------------------------------------------------
create schema net;

create table net.requests (
  id                   bigserial primary key,
  url                  text,
  body                 jsonb,
  headers              jsonb,
  timeout_milliseconds integer,
  created_at           timestamptz default now()
);

create function net.http_post(
  url                  text,
  body                 jsonb default '{}'::jsonb,
  params               jsonb default '{}'::jsonb,
  headers              jsonb default '{"Content-Type": "application/json"}'::jsonb,
  timeout_milliseconds integer default 5000
)
returns bigint
language sql
as $$
  insert into net.requests (url, body, headers, timeout_milliseconds)
  values (url, body, headers, timeout_milliseconds)
  returning id
$$;
