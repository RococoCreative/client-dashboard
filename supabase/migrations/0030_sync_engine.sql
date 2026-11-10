-- 0030_sync_engine.sql
-- The sync engine's tables: the sources a company reads from its own accounts, every run of a
-- sync, and the records each run brought in. Paste after 0027; idempotent.
--
-- Why: a company connects its own spreadsheet or books and maps the columns it wants. A sync
-- reads them on a schedule, or when someone presses Sync now, and keeps what it read as records.
-- Imported values are read-only everywhere in the hub: they are the source's figures, so the
-- only way to change one is to change it at the source and sync again. Only the connections Edge
-- Function, running as the service role, writes runs and records; the browser reads them.
--
--   1. company_connections accepts google_sheets.
--   2. private.can_sync_source(cid) is the only predicate behind Sync now.
--   3. public.sync_sources: one source of records, its column map, its schedule and the results
--      of its latest run. Admins create and edit; the browser never writes the results.
--   4. public.sync_runs: one row per sync, with its counts and what went wrong.
--   5. The source's pointer to the run whose records are current.
--   6. public.sync_records: the rows a run read, keyed by the source's record key.
--   7. Indexes, including the lock that allows one running sync per connection.
--   8. Runs and records take their company (and a run its connection) from their source.
--   9. The guard on sources: its connection is its own company's and provider's, its time zone
--      is a real named zone, results are written by the sync, and someone who may only sync
--      may only ask.
--  10. Triggers on sources: the guard, who changed it, when, and an audit of its configuration.
--  11. Row level security, grants and policies.

-- ---------------------------------------------------------------------------------------
-- 1. Connections accept Google Sheets
-- ---------------------------------------------------------------------------------------

alter table public.company_connections drop constraint if exists company_connections_provider_check;
alter table public.company_connections add constraint company_connections_provider_check
  check (provider in ('gohighlevel', 'quickbooks', 'google_sheets'));

-- ---------------------------------------------------------------------------------------
-- 2. Who may press Sync now
-- ---------------------------------------------------------------------------------------
-- The only predicate behind Sync now, kept apart from the view policy so the capability matrix
-- can change who syncs without changing who views. Today it is the admins.

create or replace function private.can_sync_source(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select private.can_manage_company(cid) $$;
revoke all on function private.can_sync_source(uuid) from public, anon;
grant execute on function private.can_sync_source(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------
-- 3. Sources
-- ---------------------------------------------------------------------------------------

create table if not exists public.sync_sources (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  connection_id      uuid not null references public.company_connections (id) on delete cascade,
  provider           text not null,
  name               text not null,
  target_module      text not null,
  config             jsonb not null default '{}'::jsonb,
  field_map          jsonb not null default '[]'::jsonb,
  record_key         text[] not null default '{}',
  sync_weekday       smallint,
  sync_time          time,
  sync_timezone      text,
  stale_after_hours  integer,
  enabled            boolean not null default false,
  current_run_id     uuid,
  last_attempt_at    timestamptz,
  last_success_at    timestamptz,
  last_status        text,
  last_error         text,
  sync_requested_at  timestamptz,
  created_by         uuid references public.profiles (id) on delete set null,
  updated_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint sync_sources_provider_check check (provider in ('google_sheets', 'quickbooks')),
  constraint sync_sources_target_module_check
    check (target_module in ('sales_reporting', 'financial_reporting', 'controls', 'pm_capacity')),
  constraint sync_sources_name_check check (btrim(name) <> ''),
  constraint sync_sources_config_check check (jsonb_typeof(config) = 'object'),
  constraint sync_sources_field_map_check check (jsonb_typeof(field_map) = 'array'),
  constraint sync_sources_weekday_check check (sync_weekday between 0 and 6),
  constraint sync_sources_schedule_check
    check ((sync_weekday is null) = (sync_time is null) and (sync_time is null) = (sync_timezone is null)),
  constraint sync_sources_stale_check check (stale_after_hours is null or stale_after_hours > 0),
  constraint sync_sources_last_status_check
    check (last_status is null or last_status in ('running', 'succeeded', 'failed', 'abandoned'))
);

-- ---------------------------------------------------------------------------------------
-- 4. Runs
-- ---------------------------------------------------------------------------------------

create table if not exists public.sync_runs (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  source_id      uuid not null references public.sync_sources (id) on delete cascade,
  connection_id  uuid not null references public.company_connections (id) on delete cascade,
  trigger_kind   text not null,
  requested_by   uuid references public.profiles (id) on delete set null,
  status         text not null default 'running',
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  rows_read      integer not null default 0,
  rows_applied   integer not null default 0,
  rows_blank     integer not null default 0,
  error_detail   jsonb,
  constraint sync_runs_trigger_kind_check check (trigger_kind in ('schedule', 'manual')),
  constraint sync_runs_status_check check (status in ('running', 'succeeded', 'failed', 'abandoned'))
);

-- ---------------------------------------------------------------------------------------
-- 5. The source's current run
-- ---------------------------------------------------------------------------------------
-- Added after sync_runs exists. Deleting the run clears the pointer rather than the source.

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sync_sources_current_run_id_fkey') then
    alter table public.sync_sources
      add constraint sync_sources_current_run_id_fkey
      foreign key (current_run_id) references public.sync_runs (id) on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------
-- 6. Records
-- ---------------------------------------------------------------------------------------
-- data holds the mapped fields only; source_ref says where in the source the row came from.

create table if not exists public.sync_records (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  source_id   uuid not null references public.sync_sources (id) on delete cascade,
  run_id      uuid not null references public.sync_runs (id) on delete cascade,
  record_key  text not null,
  data        jsonb not null,
  source_ref  jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  constraint sync_records_run_key_key unique (run_id, record_key)
);

-- ---------------------------------------------------------------------------------------
-- 7. Indexes
-- ---------------------------------------------------------------------------------------

create index if not exists sync_sources_company_id_idx on public.sync_sources (company_id);
create index if not exists sync_sources_connection_id_idx on public.sync_sources (connection_id);
create index if not exists sync_sources_current_run_id_idx on public.sync_sources (current_run_id);
create index if not exists sync_sources_created_by_idx on public.sync_sources (created_by);
create index if not exists sync_sources_updated_by_idx on public.sync_sources (updated_by);

create index if not exists sync_runs_company_id_idx on public.sync_runs (company_id);
create index if not exists sync_runs_source_started_idx on public.sync_runs (source_id, started_at desc);
create index if not exists sync_runs_connection_id_idx on public.sync_runs (connection_id);
create index if not exists sync_runs_requested_by_idx on public.sync_runs (requested_by);

-- The lock: one running sync per connection, so a token refresh never runs twice at once.
create unique index if not exists sync_runs_one_running_per_connection
  on public.sync_runs (connection_id) where status = 'running';

-- sync_records.run_id is covered by the unique (run_id, record_key) index.
create index if not exists sync_records_source_run_idx on public.sync_records (source_id, run_id);
create index if not exists sync_records_company_id_idx on public.sync_records (company_id);

-- ---------------------------------------------------------------------------------------
-- 8. Runs and records inherit from their source
-- ---------------------------------------------------------------------------------------
-- Whatever the writer sends, a run's company and connection are its source's, and a record's
-- company is its source's and its run belongs to that same source.

create or replace function public.inherit_from_sync_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  src record;
begin
  select s.company_id, s.connection_id into src from public.sync_sources s where s.id = new.source_id;
  if not found then
    raise exception 'That source does not exist.';
  end if;
  new.company_id := src.company_id;
  if tg_table_name = 'sync_runs' then
    new.connection_id := src.connection_id;
  elsif not exists (select 1 from public.sync_runs r where r.id = new.run_id and r.source_id = new.source_id) then
    raise exception 'That run belongs to another source.';
  end if;
  return new;
end;
$$;
revoke execute on function public.inherit_from_sync_source() from public, anon, authenticated;

drop trigger if exists sync_runs_inherit on public.sync_runs;
create trigger sync_runs_inherit
  before insert on public.sync_runs
  for each row execute function public.inherit_from_sync_source();

drop trigger if exists sync_records_inherit on public.sync_records;
create trigger sync_records_inherit
  before insert on public.sync_records
  for each row execute function public.inherit_from_sync_source();

-- ---------------------------------------------------------------------------------------
-- 9. The guard on sources
-- ---------------------------------------------------------------------------------------
-- A source stays in the company it was created in, and its connection must be that company's,
-- for the same provider. A browser write (anyone signed in) never sets the results of a sync;
-- the service role, with nobody signed in, writes them. Someone who may sync but not manage the
-- company may only set sync_requested_at. The excluded keys cover what set_updated_at and
-- stamp_actor change, so this is correct whichever order the BEFORE triggers fire in.

create or replace function public.guard_sync_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  conn record;
begin
  if tg_op = 'UPDATE' then
    new.company_id := old.company_id;
  end if;
  select c.company_id, c.provider into conn from public.company_connections c where c.id = new.connection_id;
  if not found or conn.company_id is distinct from new.company_id or conn.provider is distinct from new.provider then
    raise exception 'That connection belongs to another company or provider.';
  end if;
  -- A named zone only: PostgreSQL also reads POSIX-style zones such as 'UTC+5', which the
  -- scheduler (Intl.DateTimeFormat) cannot, so the name must be in pg_timezone_names too.
  if new.sync_timezone is not null then
    begin
      perform now() at time zone new.sync_timezone;
    exception when others then
      raise exception 'That time zone is not recognized.';
    end;
    if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.sync_timezone) then
      raise exception 'That time zone is not recognized.';
    end if;
  end if;
  if auth.uid() is not null then
    if tg_op = 'INSERT' then
      if new.current_run_id is not null or new.last_attempt_at is not null or new.last_success_at is not null
         or new.last_status is not null or new.last_error is not null then
        raise exception 'Sync results are written by the sync, not edited here.';
      end if;
    else
      if new.current_run_id is distinct from old.current_run_id or new.last_attempt_at is distinct from old.last_attempt_at
         or new.last_success_at is distinct from old.last_success_at or new.last_status is distinct from old.last_status
         or new.last_error is distinct from old.last_error then
        raise exception 'Sync results are written by the sync, not edited here.';
      end if;
      if not private.can_manage_company(old.company_id)
         and (to_jsonb(new) - '{sync_requested_at,updated_at,updated_by}'::text[])
             is distinct from (to_jsonb(old) - '{sync_requested_at,updated_at,updated_by}'::text[]) then
        raise exception 'You can request a sync but not change the source.';
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_sync_source() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 10. Triggers on sources
-- ---------------------------------------------------------------------------------------
-- The audit watches configuration only; sync_requested_at and the results are not watched.

drop trigger if exists sync_sources_guard on public.sync_sources;
create trigger sync_sources_guard
  before insert or update on public.sync_sources
  for each row execute function public.guard_sync_source();

drop trigger if exists sync_sources_stamp_actor on public.sync_sources;
create trigger sync_sources_stamp_actor
  before insert or update on public.sync_sources
  for each row execute function public.stamp_actor();

drop trigger if exists sync_sources_set_updated_at on public.sync_sources;
create trigger sync_sources_set_updated_at
  before update on public.sync_sources
  for each row execute function public.set_updated_at();

drop trigger if exists sync_sources_audit on public.sync_sources;
create trigger sync_sources_audit
  after insert or update or delete on public.sync_sources
  for each row execute function private.audit_change(
    'provider', 'connection_id', 'name', 'target_module', 'config', 'field_map', 'record_key',
    'sync_weekday', 'sync_time', 'sync_timezone', 'stale_after_hours', 'enabled'
  );

-- ---------------------------------------------------------------------------------------
-- 11. Row level security, grants and policies
-- ---------------------------------------------------------------------------------------
-- A source is disabled, never deleted from the browser: no delete grant or policy. Runs and
-- records have no insert, update or delete grant or policy for the browser; the connections
-- function's service role is their only writer.

alter table public.sync_sources enable row level security;
alter table public.sync_runs enable row level security;
alter table public.sync_records enable row level security;

revoke all on public.sync_sources, public.sync_runs, public.sync_records from anon, authenticated;
grant select, insert, update on public.sync_sources to authenticated;
grant select on public.sync_runs, public.sync_records to authenticated;
grant select, insert, update, delete on public.sync_sources, public.sync_runs, public.sync_records to service_role;

drop policy if exists "Admins read sync sources" on public.sync_sources;
create policy "Admins read sync sources"
  on public.sync_sources for select to authenticated
  using (private.can_manage_company(company_id));

drop policy if exists "Admins create sync sources" on public.sync_sources;
create policy "Admins create sync sources"
  on public.sync_sources for insert to authenticated
  with check (private.can_manage_company(company_id));

drop policy if exists "Admins and syncers update sync sources" on public.sync_sources;
create policy "Admins and syncers update sync sources"
  on public.sync_sources for update to authenticated
  using (private.can_manage_company(company_id) or private.can_sync_source(company_id))
  with check (private.can_manage_company(company_id) or private.can_sync_source(company_id));

drop policy if exists "Admins read sync runs" on public.sync_runs;
create policy "Admins read sync runs"
  on public.sync_runs for select to authenticated
  using (private.can_manage_company(company_id));

drop policy if exists "Admins read sync records" on public.sync_records;
create policy "Admins read sync records"
  on public.sync_records for select to authenticated
  using (private.can_manage_company(company_id));
