-- 0025_audit_log.sql
-- An audit log of privileged changes. Paste after 0024; idempotent.
--
-- Who changed which role, which access, which company setting, domain, connection, pillar weight
-- or job-role module, and when, kept from now on. Nothing before this migration is recorded.
--
--   1. public.audit_events holds one row per watched change. Only Rococo admins can read it until
--      the capability matrix decides who else may, and nobody writes it from the browser: there is
--      no insert, update or delete grant or policy. The trigger function below is the only writer.
--   2. private.audit_change() is one AFTER trigger function every watched table shares. The
--      columns it watches arrive as trigger arguments, so each table names its own. An insert or
--      delete always writes an event with every watched value; an update writes one only when a
--      watched column actually changed, and names only the columns that did.
--   3. Seven tables are watched: companies, profiles, invitations, company_domains,
--      company_connections, gsr_pillars and job_roles. Content tables (reviews, goals, SOPs and
--      the rest) are not audited here.

-- ---------------------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------------------
-- No foreign keys, on purpose. Deleting a company cascades to its domains and connections and
-- sets its people's company to null, and each of those writes an audit row naming the company
-- being deleted, so a foreign key to companies would make every company delete fail. History
-- outlives the company, and the person, it names. row_id is text because company_domains is
-- keyed by its domain, not by a uuid.

create table if not exists public.audit_events (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid,
  table_name        text not null,
  row_id            text not null,
  action            text not null,
  changed           jsonb not null default '{}'::jsonb,
  actor_user_id     uuid,
  actor_profile_id  uuid,
  actor_kind        text not null,
  created_at        timestamptz not null default now(),
  constraint audit_events_action_check check (action in ('insert', 'update', 'delete')),
  constraint audit_events_actor_kind_check check (actor_kind in ('user', 'rococo', 'system'))
);

create index if not exists audit_events_company_created_idx on public.audit_events (company_id, created_at desc);
create index if not exists audit_events_created_idx on public.audit_events (created_at desc);
create index if not exists audit_events_row_idx on public.audit_events (table_name, row_id);

-- ---------------------------------------------------------------------------------------
-- 2. The trigger function
-- ---------------------------------------------------------------------------------------
-- Security definer so it can write a table nobody else may, and so the actor helpers resolve
-- whoever is signed in. A write with no signed-in user (the SQL editor, a migration, a job) is
-- recorded as system.

create or replace function private.audit_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r          jsonb := to_jsonb(coalesce(new, old));
  o          jsonb;
  n          jsonb;
  v_row      text;
  v_company  uuid;
  v_changed  jsonb := '{}'::jsonb;
  v_col      text;
begin
  v_row := coalesce(r->>'id', r->>'domain');
  v_company := case when tg_table_name = 'companies' then (r->>'id')::uuid else (r->>'company_id')::uuid end;

  if tg_op = 'INSERT' then
    foreach v_col in array tg_argv loop
      v_changed := v_changed || jsonb_build_object(v_col, jsonb_build_object('old', null, 'new', r->v_col));
    end loop;
  elsif tg_op = 'DELETE' then
    foreach v_col in array tg_argv loop
      v_changed := v_changed || jsonb_build_object(v_col, jsonb_build_object('old', r->v_col, 'new', null));
    end loop;
  else
    o := to_jsonb(old);
    n := to_jsonb(new);
    foreach v_col in array tg_argv loop
      if o->v_col is distinct from n->v_col then
        v_changed := v_changed || jsonb_build_object(v_col, jsonb_build_object('old', o->v_col, 'new', n->v_col));
      end if;
    end loop;
    if v_changed = '{}'::jsonb then
      return null;
    end if;
  end if;

  insert into public.audit_events (company_id, table_name, row_id, action, changed, actor_user_id, actor_profile_id, actor_kind)
  values (
    v_company,
    tg_table_name,
    v_row,
    lower(tg_op),
    v_changed,
    auth.uid(),
    private.auth_profile_id(),
    case
      when auth.uid() is null then 'system'
      when private.is_rococo_admin() then 'rococo'
      else 'user'
    end
  );
  return null;
end;
$$;

revoke execute on function private.audit_change() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 3. The watched tables and the columns each one watches
-- ---------------------------------------------------------------------------------------

drop trigger if exists companies_audit on public.companies;
create trigger companies_audit
  after insert or update or delete on public.companies
  for each row execute function private.audit_change('modules', 'slug', 'theme_key', 'name');

drop trigger if exists profiles_audit on public.profiles;
create trigger profiles_audit
  after insert or update or delete on public.profiles
  for each row execute function private.audit_change('role', 'is_active', 'is_rococo_admin', 'company_id', 'reports_to', 'job_role_id');

drop trigger if exists invitations_audit on public.invitations;
create trigger invitations_audit
  after insert or update or delete on public.invitations
  for each row execute function private.audit_change('role', 'email');

drop trigger if exists company_domains_audit on public.company_domains;
create trigger company_domains_audit
  after insert or update or delete on public.company_domains
  for each row execute function private.audit_change('domain', 'company_id');

drop trigger if exists company_connections_audit on public.company_connections;
create trigger company_connections_audit
  after insert or update or delete on public.company_connections
  for each row execute function private.audit_change('status', 'provider', 'external_account_id');

drop trigger if exists gsr_pillars_audit on public.gsr_pillars;
create trigger gsr_pillars_audit
  after insert or update or delete on public.gsr_pillars
  for each row execute function private.audit_change('weight', 'scoring_type', 'required_goals');

drop trigger if exists job_roles_audit on public.job_roles;
create trigger job_roles_audit
  after insert or update or delete on public.job_roles
  for each row execute function private.audit_change('dashboard_modules');

-- ---------------------------------------------------------------------------------------
-- 4. Who reads it: Rococo admins only. Nobody writes it from the browser.
-- ---------------------------------------------------------------------------------------

alter table public.audit_events enable row level security;

revoke all on public.audit_events from anon, authenticated;
grant select on public.audit_events to authenticated;

drop policy if exists "Rococo admins read audit events" on public.audit_events;
create policy "Rococo admins read audit events"
  on public.audit_events for select to authenticated
  using (private.is_rococo_admin());
