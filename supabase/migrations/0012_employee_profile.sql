-- 0012_employee_profile.sql
-- The employee profile the review opens with, the way Klasik's dashboard sheet does: position
-- and hire date, who they report to, a compensation table with an annual total, and personal
-- KPIs for the year (target, current, hit). Compensation and KPIs sit in their own tables so
-- only the person and their company's admins can read them; teammates never can. Also: the
-- month's focus topic becomes a goal (kind 'focus', seeded from the cycle theme) with its
-- own action steps, and a goal gains an outcome note ("why it landed this way") written the
-- month after, which a closed cycle still accepts. Paste after 0011; idempotent.

-- profiles: employment details. Admins set them; a person may edit their own phone.
alter table public.profiles add column if not exists hire_date date;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists department text;
alter table public.profiles add column if not exists reports_to uuid references public.profiles (id) on delete set null;

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

  if new.company_id is distinct from old.company_id
     or new.is_rococo_admin is distinct from old.is_rococo_admin then
    raise exception 'Only Rococo admins can change company assignment or Rococo access.';
  end if;

  if private.is_company_admin() and old.company_id = private.auth_company_id() then
    if new.id = auth.uid()
       and (new.role is distinct from old.role or new.is_active is distinct from old.is_active) then
      raise exception 'You cannot change your own role or deactivate your own account.';
    end if;
    return new;
  end if;

  if new.id <> auth.uid() then
    raise exception 'You can only edit your own profile.';
  end if;
  if new.role is distinct from old.role or new.is_active is distinct from old.is_active then
    raise exception 'Only admins can change roles or deactivate accounts.';
  end if;
  if new.hire_date is distinct from old.hire_date
     or new.department is distinct from old.department
     or new.reports_to is distinct from old.reports_to then
    raise exception 'Only admins can change employment details.';
  end if;
  return new;
end;
$$;

-- Rows about one person always carry that person's company, whatever the caller sent.
create or replace function public.inherit_company_from_employee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select company_id into new.company_id from public.profiles where id = new.employee_id;
  if new.company_id is null then
    raise exception 'This person is not placed with a company yet.';
  end if;
  return new;
end;
$$;
revoke execute on function public.inherit_company_from_employee() from public, anon, authenticated;

-- employee_kpis: the personal numbers for the year (the sheet's PERSONAL KPIs block).
create table if not exists public.employee_kpis (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  employee_id      uuid not null references public.profiles (id) on delete cascade,
  year             integer not null,
  name             text not null,
  target_display   text,
  current_display  text,
  target_numeric   numeric(14,2),
  current_numeric  numeric(14,2),
  is_hit           boolean not null default false,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists employee_kpis_employee_year_idx on public.employee_kpis (employee_id, year);
create index if not exists employee_kpis_company_id_idx on public.employee_kpis (company_id);

-- compensation_items: base, stipends, match, performance pay; annual amounts, monthly derived.
create table if not exists public.compensation_items (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  employee_id    uuid not null references public.profiles (id) on delete cascade,
  name           text not null,
  annual_amount  numeric(12,2) not null default 0,
  note           text,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists compensation_items_employee_idx on public.compensation_items (employee_id);
create index if not exists compensation_items_company_id_idx on public.compensation_items (company_id);

alter table public.employee_kpis enable row level security;
alter table public.compensation_items enable row level security;
revoke all on public.employee_kpis from anon;
revoke all on public.compensation_items from anon;

drop policy if exists "Own KPIs and admins read" on public.employee_kpis;
create policy "Own KPIs and admins read"
  on public.employee_kpis for select to authenticated
  using (employee_id = (select auth.uid()) or private.can_manage_company(company_id));
drop policy if exists "Admins create KPIs" on public.employee_kpis;
create policy "Admins create KPIs"
  on public.employee_kpis for insert to authenticated
  with check (private.can_manage_company(company_id));
drop policy if exists "Admins update KPIs" on public.employee_kpis;
create policy "Admins update KPIs"
  on public.employee_kpis for update to authenticated
  using (private.can_manage_company(company_id)) with check (private.can_manage_company(company_id));
drop policy if exists "Admins delete KPIs" on public.employee_kpis;
create policy "Admins delete KPIs"
  on public.employee_kpis for delete to authenticated
  using (private.can_manage_company(company_id));

drop policy if exists "Own compensation and admins read" on public.compensation_items;
create policy "Own compensation and admins read"
  on public.compensation_items for select to authenticated
  using (employee_id = (select auth.uid()) or private.can_manage_company(company_id));
drop policy if exists "Admins add compensation" on public.compensation_items;
create policy "Admins add compensation"
  on public.compensation_items for insert to authenticated
  with check (private.can_manage_company(company_id));
drop policy if exists "Admins update compensation" on public.compensation_items;
create policy "Admins update compensation"
  on public.compensation_items for update to authenticated
  using (private.can_manage_company(company_id)) with check (private.can_manage_company(company_id));
drop policy if exists "Admins delete compensation" on public.compensation_items;
create policy "Admins delete compensation"
  on public.compensation_items for delete to authenticated
  using (private.can_manage_company(company_id));

drop trigger if exists employee_kpis_inherit_company on public.employee_kpis;
create trigger employee_kpis_inherit_company
  before insert or update on public.employee_kpis
  for each row execute function public.inherit_company_from_employee();
drop trigger if exists compensation_items_inherit_company on public.compensation_items;
create trigger compensation_items_inherit_company
  before insert or update on public.compensation_items
  for each row execute function public.inherit_company_from_employee();
drop trigger if exists employee_kpis_set_updated_at on public.employee_kpis;
create trigger employee_kpis_set_updated_at
  before update on public.employee_kpis for each row execute function public.set_updated_at();
drop trigger if exists compensation_items_set_updated_at on public.compensation_items;
create trigger compensation_items_set_updated_at
  before update on public.compensation_items for each row execute function public.set_updated_at();

-- goals: the focus topic is a goal, and a goal carries the note on how it landed.
alter table public.goals drop constraint if exists goals_kind_check;
alter table public.goals add constraint goals_kind_check check (kind in ('professional', 'personal', 'role', 'focus'));
alter table public.goals add column if not exists outcome_note text;

-- The outcome note is written the month after, when the cycle may already be closed: a
-- change to that column alone passes the freeze. Everything else stays locked.
create or replace function public.guard_goal_frozen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from  uuid := old.cycle_id;
  v_to    uuid := case when tg_op = 'DELETE' then null else new.cycle_id end;
  v_probe public.goals%rowtype;
begin
  if tg_op = 'UPDATE' then
    v_probe := new;
    v_probe.outcome_note := old.outcome_note;
    v_probe.updated_at := old.updated_at;
    if v_probe is not distinct from old then
      return new;
    end if;
  end if;
  if exists (
    select 1 from public.review_cycles c
    where c.id in (v_from, v_to) and c.status = 'closed'
  ) then
    raise exception 'This review cycle is closed. Reopen it to change its goals.'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- reviews: focus topics are goals now; the chip column from 0011 goes.
alter table public.reviews drop column if exists focus_topics;
