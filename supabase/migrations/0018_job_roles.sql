-- 0018_job_roles.sql
-- Job roles, the goals a role brings with it, and a person's own financial figures. Paste after
-- 0017; idempotent.
--
-- Three things a company shapes for itself, as rows (rule 12):
--
--   1. job_roles: the jobs people do at this company (Site Supervisor, Project Manager,
--      Salesperson), each with the dashboard modules that role gets. profiles.job_role_id points
--      at one. A role belongs to a company, so a person only ever carries one of their own
--      company's, and moving them clears it.
--   2. job_role_goals: the goals a role brings into every month's Goal Setting Review, set once
--      by an admin ("employee type A gets goals A"). The GSR offers to file them for the month as
--      goals of kind 'role'; the template is never edited from the review.
--   3. employee_financials: a person's own figures for the year (closed sales, revenue managed),
--      target and current, with where the number came from. Manual today; QuickBooks and
--      GoHighLevel later write the same rows with their own source. Only the person and their
--      admins read them; the company's own snapshots stay admin-only.

-- 1. job_roles -------------------------------------------------------------------------------

create table if not exists public.job_roles (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  name               text not null,
  description        text,
  dashboard_modules  text[] not null default '{}',
  sort_order         integer not null default 0,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint job_roles_name_key unique (company_id, name)
);
create index if not exists job_roles_company_id_idx on public.job_roles (company_id);
grant select, insert, update, delete on public.job_roles to authenticated;

drop trigger if exists job_roles_set_updated_at on public.job_roles;
create trigger job_roles_set_updated_at
  before update on public.job_roles
  for each row execute function public.set_updated_at();

alter table public.job_roles enable row level security;
drop policy if exists "Members read job roles" on public.job_roles;
create policy "Members read job roles"
  on public.job_roles for select to authenticated
  using (private.is_company_member(company_id));
drop policy if exists "Admins create job roles" on public.job_roles;
create policy "Admins create job roles"
  on public.job_roles for insert to authenticated
  with check (private.can_manage_company(company_id));
drop policy if exists "Admins update job roles" on public.job_roles;
create policy "Admins update job roles"
  on public.job_roles for update to authenticated
  using (private.can_manage_company(company_id)) with check (private.can_manage_company(company_id));
drop policy if exists "Admins delete job roles" on public.job_roles;
create policy "Admins delete job roles"
  on public.job_roles for delete to authenticated
  using (private.can_manage_company(company_id));

alter table public.profiles add column if not exists job_role_id uuid references public.job_roles (id) on delete set null;

-- A person's job role is their own company's, and it does not travel: moving somebody to
-- another company clears it before move_employee_company runs. BEFORE, so the row is right
-- before anything else looks at it.
create or replace function public.guard_job_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role_company uuid;
begin
  if tg_op = 'UPDATE' and new.company_id is distinct from old.company_id then
    new.job_role_id := null;
  end if;
  if new.job_role_id is not null then
    select company_id into v_role_company from public.job_roles where id = new.job_role_id;
    if v_role_company is null or v_role_company is distinct from new.company_id then
      raise exception 'That job role belongs to another company.';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_job_role() from public, anon, authenticated;

drop trigger if exists profiles_guard_job_role on public.profiles;
create trigger profiles_guard_job_role
  before insert or update on public.profiles
  for each row execute function public.guard_job_role();

-- The job role is an employment detail: admins set it, a person cannot give themselves one.
create or replace function public.guard_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.email := old.email;
  if auth.uid() is null or private.is_rococo_admin() then
    return new;
  end if;

  if new.user_id is distinct from old.user_id then
    raise exception 'An account link is set when the person signs in and cannot be changed here.';
  end if;

  if new.company_id is distinct from old.company_id
     or new.is_rococo_admin is distinct from old.is_rococo_admin then
    raise exception 'Only Rococo admins can change company assignment or Rococo access.';
  end if;

  if private.is_company_admin() and old.company_id = private.auth_company_id() then
    if old.user_id = auth.uid()
       and (new.role is distinct from old.role or new.is_active is distinct from old.is_active) then
      raise exception 'You cannot change your own role or deactivate your own account.';
    end if;
    return new;
  end if;

  if old.user_id is distinct from auth.uid() then
    raise exception 'You can only edit your own profile.';
  end if;
  if new.role is distinct from old.role or new.is_active is distinct from old.is_active then
    raise exception 'Only admins can change roles or deactivate accounts.';
  end if;
  if new.hire_date is distinct from old.hire_date
     or new.department is distinct from old.department
     or new.reports_to is distinct from old.reports_to
     or new.job_role_id is distinct from old.job_role_id then
    raise exception 'Only admins can change employment details.';
  end if;
  return new;
end;
$$;

-- 2. job_role_goals --------------------------------------------------------------------------

create table if not exists public.job_role_goals (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  job_role_id   uuid not null references public.job_roles (id) on delete cascade,
  title         text not null,
  description   text,
  kind          text not null default 'role',
  sort_order    integer not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint job_role_goals_kind_check check (kind in ('professional', 'personal', 'role'))
);
create index if not exists job_role_goals_role_id_idx on public.job_role_goals (job_role_id);
create index if not exists job_role_goals_company_id_idx on public.job_role_goals (company_id);
grant select, insert, update, delete on public.job_role_goals to authenticated;

create or replace function public.inherit_from_job_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select company_id into new.company_id from public.job_roles where id = new.job_role_id;
  if new.company_id is null then
    raise exception 'That job role does not exist.';
  end if;
  return new;
end;
$$;
revoke execute on function public.inherit_from_job_role() from public, anon, authenticated;

drop trigger if exists job_role_goals_inherit on public.job_role_goals;
create trigger job_role_goals_inherit
  before insert or update on public.job_role_goals
  for each row execute function public.inherit_from_job_role();
drop trigger if exists job_role_goals_set_updated_at on public.job_role_goals;
create trigger job_role_goals_set_updated_at
  before update on public.job_role_goals
  for each row execute function public.set_updated_at();

alter table public.job_role_goals enable row level security;
drop policy if exists "Members read role goals" on public.job_role_goals;
create policy "Members read role goals"
  on public.job_role_goals for select to authenticated
  using (private.is_company_member(company_id));
drop policy if exists "Admins create role goals" on public.job_role_goals;
create policy "Admins create role goals"
  on public.job_role_goals for insert to authenticated
  with check (private.can_manage_company(company_id));
drop policy if exists "Admins update role goals" on public.job_role_goals;
create policy "Admins update role goals"
  on public.job_role_goals for update to authenticated
  using (private.can_manage_company(company_id)) with check (private.can_manage_company(company_id));
drop policy if exists "Admins delete role goals" on public.job_role_goals;
create policy "Admins delete role goals"
  on public.job_role_goals for delete to authenticated
  using (private.can_manage_company(company_id));

-- 3. employee_financials ---------------------------------------------------------------------

create table if not exists public.employee_financials (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  employee_id   uuid not null references public.profiles (id) on delete cascade,
  year          integer not null,
  metric        text not null,
  target        numeric(14,2),
  current       numeric(14,2),
  source        text not null default 'manual',
  note          text,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint employee_financials_source_check check (source in ('manual', 'quickbooks', 'ghl')),
  constraint employee_financials_metric_key unique (employee_id, year, metric)
);
create index if not exists employee_financials_employee_id_idx on public.employee_financials (employee_id);
create index if not exists employee_financials_company_id_idx on public.employee_financials (company_id);
grant select, insert, update, delete on public.employee_financials to authenticated;

drop trigger if exists employee_financials_inherit_company on public.employee_financials;
create trigger employee_financials_inherit_company
  before insert or update on public.employee_financials
  for each row execute function public.inherit_company_from_employee();
drop trigger if exists employee_financials_set_updated_at on public.employee_financials;
create trigger employee_financials_set_updated_at
  before update on public.employee_financials
  for each row execute function public.set_updated_at();

alter table public.employee_financials enable row level security;
drop policy if exists "Own financials and admins read" on public.employee_financials;
create policy "Own financials and admins read"
  on public.employee_financials for select to authenticated
  using (employee_id = private.auth_profile_id() or private.can_manage_company(company_id));
drop policy if exists "Admins create financials" on public.employee_financials;
create policy "Admins create financials"
  on public.employee_financials for insert to authenticated
  with check (private.can_manage_company(company_id));
drop policy if exists "Admins update financials" on public.employee_financials;
create policy "Admins update financials"
  on public.employee_financials for update to authenticated
  using (private.can_manage_company(company_id)) with check (private.can_manage_company(company_id));
drop policy if exists "Admins delete financials" on public.employee_financials;
create policy "Admins delete financials"
  on public.employee_financials for delete to authenticated
  using (private.can_manage_company(company_id));

-- Figures travel with the person the way KPIs do.
create or replace function public.move_employee_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.company_id is distinct from old.company_id and new.company_id is not null then
    update public.employee_kpis        set company_id = new.company_id where employee_id = new.id;
    update public.employee_financials  set company_id = new.company_id where employee_id = new.id;
    update public.compensation_items   set company_id = new.company_id where employee_id = new.id;
    update public.goals                set company_id = new.company_id where employee_id = new.id and cycle_id is null;
    update public.employee_deliverables
       set company_id = new.company_id, category_id = null
     where employee_id = new.id;
    update public.deliverable_tasks    set company_id = new.company_id where employee_id = new.id;
    delete from public.impact_scores where employee_id = new.id;
  end if;
  return new;
end;
$$;
revoke execute on function public.move_employee_company() from public, anon, authenticated;
