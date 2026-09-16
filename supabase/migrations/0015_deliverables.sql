-- 0015_deliverables.sql
-- Deliverables: the second half of what a person is measured on, alongside their personal KPIs.
-- Paste after 0014; idempotent.
--
-- A personal KPI is a number: "$2M in newly closed sales", with a target and where it stands.
-- Those are unchanged and stay in employee_kpis.
--
-- A deliverable is a heading with support tasks under it, grouped by a category the company
-- defines ("Sales & Mktg.", "Production"). The person is rated on the heading by how well they
-- do the tasks beneath it, so the rating lives on the task and the heading's figure is derived:
--
--   Miss 0, Partial 1, Hit 2, Exceeded 3
--   target = 2 points for every task on the deliverable
--   actual = the sum of the task ratings
--
-- Hitting every task therefore lands exactly on target, and exceeding one puts the person over.
-- That is the arithmetic the client's own workbook uses, where a heading with four tasks reads a
-- target of 8 and one with two tasks reads 4. Nothing here is weighted yet: each category reports
-- its own achieved against target.
--
-- A note on the name: "deliverables" is also the name of a gsr_pillars scoring type, where a
-- review line item carries a target and an actual. These are different things. That one is scored
-- inside a single review; this one is the person's standing brief for the year.

-- ---------------------------------------------------------------------------------------
-- 1. The categories a company groups its deliverables under
-- ---------------------------------------------------------------------------------------
create table if not exists public.deliverable_categories (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  name        text not null,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint deliverable_categories_name_key unique (company_id, name)
);

-- ---------------------------------------------------------------------------------------
-- 2. One person's deliverable headings for a year
-- ---------------------------------------------------------------------------------------
create table if not exists public.employee_deliverables (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  employee_id  uuid not null references public.profiles (id) on delete cascade,
  -- Null when the category it sat in has been deleted: the heading keeps its tasks and its
  -- score, and an admin files it again.
  category_id  uuid references public.deliverable_categories (id) on delete set null,
  year         integer not null,
  name         text not null,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------
-- 3. The support tasks, which is where the rating actually lives
-- ---------------------------------------------------------------------------------------
-- employee_id is carried here as well as on the parent so the policies can stay flat. A policy
-- that reached into employee_deliverables would run that table's own RLS inside the check, which
-- is the recursion this schema avoids everywhere else by keeping the predicate on the row.
create table if not exists public.deliverable_tasks (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  employee_id     uuid not null references public.profiles (id) on delete cascade,
  deliverable_id  uuid not null references public.employee_deliverables (id) on delete cascade,
  name            text not null,
  note            text,
  -- Null until it is rated. 0 Miss, 1 Partial, 2 Hit, 3 Exceeded.
  rating          smallint,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint deliverable_tasks_rating_check check (rating is null or rating between 0 and 3)
);

create index if not exists deliverable_categories_company_idx on public.deliverable_categories (company_id);
create index if not exists employee_deliverables_employee_year_idx on public.employee_deliverables (employee_id, year);
create index if not exists employee_deliverables_company_idx on public.employee_deliverables (company_id);
create index if not exists deliverable_tasks_deliverable_idx on public.deliverable_tasks (deliverable_id);
create index if not exists deliverable_tasks_employee_idx on public.deliverable_tasks (employee_id);

-- ---------------------------------------------------------------------------------------
-- 4. The company a row belongs to is derived, never sent
-- ---------------------------------------------------------------------------------------
-- A heading belongs to its person's company, the same way KPIs and compensation do.
drop trigger if exists employee_deliverables_inherit_company on public.employee_deliverables;
create trigger employee_deliverables_inherit_company
  before insert or update on public.employee_deliverables
  for each row execute function public.inherit_company_from_employee();

-- A task belongs to its heading, and takes the person from it too, so the two can never drift.
create or replace function public.inherit_from_deliverable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select company_id, employee_id
    into new.company_id, new.employee_id
    from public.employee_deliverables
   where id = new.deliverable_id;
  if new.company_id is null then
    raise exception 'That deliverable does not exist.';
  end if;
  return new;
end;
$$;
revoke execute on function public.inherit_from_deliverable() from public, anon, authenticated;

drop trigger if exists deliverable_tasks_inherit on public.deliverable_tasks;
create trigger deliverable_tasks_inherit
  before insert or update on public.deliverable_tasks
  for each row execute function public.inherit_from_deliverable();

drop trigger if exists deliverable_categories_updated_at on public.deliverable_categories;
create trigger deliverable_categories_updated_at before update on public.deliverable_categories
  for each row execute function public.set_updated_at();
drop trigger if exists employee_deliverables_updated_at on public.employee_deliverables;
create trigger employee_deliverables_updated_at before update on public.employee_deliverables
  for each row execute function public.set_updated_at();
drop trigger if exists deliverable_tasks_updated_at on public.deliverable_tasks;
create trigger deliverable_tasks_updated_at before update on public.deliverable_tasks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------
-- 5. RLS, the same shape as employee_kpis: the person reads their own, admins manage
-- ---------------------------------------------------------------------------------------
alter table public.deliverable_categories enable row level security;
alter table public.employee_deliverables enable row level security;
alter table public.deliverable_tasks enable row level security;

revoke all on public.deliverable_categories from anon;
revoke all on public.employee_deliverables from anon;
revoke all on public.deliverable_tasks from anon;

drop policy if exists "Members read categories" on public.deliverable_categories;
create policy "Members read categories"
  on public.deliverable_categories for select to authenticated
  using (private.is_company_member(company_id));
drop policy if exists "Admins create categories" on public.deliverable_categories;
create policy "Admins create categories"
  on public.deliverable_categories for insert to authenticated
  with check (private.can_manage_company(company_id));
drop policy if exists "Admins update categories" on public.deliverable_categories;
create policy "Admins update categories"
  on public.deliverable_categories for update to authenticated
  using (private.can_manage_company(company_id)) with check (private.can_manage_company(company_id));
drop policy if exists "Admins delete categories" on public.deliverable_categories;
create policy "Admins delete categories"
  on public.deliverable_categories for delete to authenticated
  using (private.can_manage_company(company_id));

drop policy if exists "Own deliverables and admins read" on public.employee_deliverables;
create policy "Own deliverables and admins read"
  on public.employee_deliverables for select to authenticated
  using (employee_id = private.auth_profile_id() or private.can_manage_company(company_id));
drop policy if exists "Admins create deliverables" on public.employee_deliverables;
create policy "Admins create deliverables"
  on public.employee_deliverables for insert to authenticated
  with check (private.can_manage_company(company_id));
drop policy if exists "Admins update deliverables" on public.employee_deliverables;
create policy "Admins update deliverables"
  on public.employee_deliverables for update to authenticated
  using (private.can_manage_company(company_id)) with check (private.can_manage_company(company_id));
drop policy if exists "Admins delete deliverables" on public.employee_deliverables;
create policy "Admins delete deliverables"
  on public.employee_deliverables for delete to authenticated
  using (private.can_manage_company(company_id));

drop policy if exists "Own tasks and admins read" on public.deliverable_tasks;
create policy "Own tasks and admins read"
  on public.deliverable_tasks for select to authenticated
  using (employee_id = private.auth_profile_id() or private.can_manage_company(company_id));
drop policy if exists "Admins create tasks" on public.deliverable_tasks;
create policy "Admins create tasks"
  on public.deliverable_tasks for insert to authenticated
  with check (private.can_manage_company(company_id));
drop policy if exists "Admins update tasks" on public.deliverable_tasks;
create policy "Admins update tasks"
  on public.deliverable_tasks for update to authenticated
  using (private.can_manage_company(company_id)) with check (private.can_manage_company(company_id));
drop policy if exists "Admins delete tasks" on public.deliverable_tasks;
create policy "Admins delete tasks"
  on public.deliverable_tasks for delete to authenticated
  using (private.can_manage_company(company_id));
