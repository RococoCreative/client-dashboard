-- 0026_projects_milestones.sql
-- Projects the company tracks by hand, each with an ordered list of milestones and letters.
-- Paste after 0025; idempotent.
--
-- Why: a company with the production module follows its projects through dated milestones and
-- the letters it sends along the way. Admins enter projects by hand until the company names its
-- master list, so source is 'manual' only. There is no status column until the company's status
-- set is agreed: a milestone is complete when it has a completed-on date, and nothing else. Nothing
-- is deleted; projects and milestones are archived.
--
--   1. public.stamp_actor() and public.pin_company_id() are shared BEFORE trigger functions that
--      later migrations reuse: one records who created and last changed a row, the other keeps a
--      row in the company it was created in.
--   2. public.projects: members read, admins write, nobody deletes.
--   3. public.project_milestones: a milestone takes its company from its project by trigger, and
--      its responsible person must belong to that company. Same read and write rules.
--   4. Moving a person to another company clears them as a milestone's responsible person.
--
-- Projects and milestones are content, not configuration, so they carry no audit trigger.

-- ---------------------------------------------------------------------------------------
-- 1. Shared trigger functions
-- ---------------------------------------------------------------------------------------
-- Security definer so the signed-in person resolves through private.auth_profile_id(). A write
-- with nobody signed in (the SQL editor, a migration) keeps whatever the row already carries.

create or replace function public.stamp_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(private.auth_profile_id(), new.created_by);
    new.updated_by := new.created_by;
  else
    new.created_by := old.created_by;
    new.updated_by := coalesce(private.auth_profile_id(), old.updated_by);
  end if;
  return new;
end;
$$;
revoke execute on function public.stamp_actor() from public, anon, authenticated;

create or replace function public.pin_company_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.company_id := old.company_id;
  return new;
end;
$$;
revoke execute on function public.pin_company_id() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 2. Projects
-- ---------------------------------------------------------------------------------------

create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  name        text not null,
  reference   text,
  notes       text,
  source      text not null default 'manual',
  source_key  text,
  archived_at timestamptz,
  created_by  uuid references public.profiles (id) on delete set null,
  updated_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint projects_name_check check (btrim(name) <> ''),
  constraint projects_source_check check (source in ('manual'))
);

create index if not exists projects_company_id_idx on public.projects (company_id);
create index if not exists projects_created_by_idx on public.projects (created_by);
create index if not exists projects_updated_by_idx on public.projects (updated_by);
create unique index if not exists projects_source_key_key
  on public.projects (company_id, source, source_key) where source_key is not null;

drop trigger if exists projects_pin_company on public.projects;
create trigger projects_pin_company
  before update on public.projects
  for each row execute function public.pin_company_id();

drop trigger if exists projects_stamp_actor on public.projects;
create trigger projects_stamp_actor
  before insert or update on public.projects
  for each row execute function public.stamp_actor();

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

alter table public.projects enable row level security;

revoke all on public.projects from anon, authenticated;
grant select, insert, update on public.projects to authenticated;

drop policy if exists "Members read projects" on public.projects;
create policy "Members read projects"
  on public.projects for select to authenticated
  using (private.is_company_member(company_id));

drop policy if exists "Admins create projects" on public.projects;
create policy "Admins create projects"
  on public.projects for insert to authenticated
  with check (private.can_manage_company(company_id));

drop policy if exists "Admins update projects" on public.projects;
create policy "Admins update projects"
  on public.projects for update to authenticated
  using (private.can_manage_company(company_id))
  with check (private.can_manage_company(company_id));

-- ---------------------------------------------------------------------------------------
-- 3. Milestones and letters
-- ---------------------------------------------------------------------------------------

create table if not exists public.project_milestones (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies (id) on delete cascade,
  project_id             uuid not null references public.projects (id) on delete restrict,
  title                  text not null,
  description            text,
  kind                   text not null default 'milestone',
  sort_order             integer not null default 0,
  target_date            date,
  responsible_profile_id uuid references public.profiles (id) on delete set null,
  completed_on           date,
  archived_at            timestamptz,
  created_by             uuid references public.profiles (id) on delete set null,
  updated_by             uuid references public.profiles (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint project_milestones_kind_check check (kind in ('milestone', 'letter')),
  constraint project_milestones_title_check check (btrim(title) <> '')
);

create index if not exists project_milestones_project_idx on public.project_milestones (project_id, sort_order);
create index if not exists project_milestones_company_id_idx on public.project_milestones (company_id);
create index if not exists project_milestones_responsible_idx on public.project_milestones (responsible_profile_id);
create index if not exists project_milestones_created_by_idx on public.project_milestones (created_by);
create index if not exists project_milestones_updated_by_idx on public.project_milestones (updated_by);

-- A milestone's company is always its project's, whatever the client sends, and the person
-- responsible for it must belong to that company.
create or replace function public.inherit_from_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select company_id into new.company_id from public.projects where id = new.project_id;
  if new.company_id is null then
    raise exception 'That project does not exist.';
  end if;
  if new.responsible_profile_id is not null
     and (select company_id from public.profiles where id = new.responsible_profile_id)
         is distinct from new.company_id then
    raise exception 'That person belongs to another company.';
  end if;
  return new;
end;
$$;
revoke execute on function public.inherit_from_project() from public, anon, authenticated;

-- BEFORE triggers fire in name order; none of these depends on another's result.
drop trigger if exists project_milestones_inherit on public.project_milestones;
create trigger project_milestones_inherit
  before insert or update on public.project_milestones
  for each row execute function public.inherit_from_project();

drop trigger if exists project_milestones_stamp_actor on public.project_milestones;
create trigger project_milestones_stamp_actor
  before insert or update on public.project_milestones
  for each row execute function public.stamp_actor();

drop trigger if exists project_milestones_set_updated_at on public.project_milestones;
create trigger project_milestones_set_updated_at
  before update on public.project_milestones
  for each row execute function public.set_updated_at();

alter table public.project_milestones enable row level security;

revoke all on public.project_milestones from anon, authenticated;
grant select, insert, update on public.project_milestones to authenticated;

drop policy if exists "Members read milestones" on public.project_milestones;
create policy "Members read milestones"
  on public.project_milestones for select to authenticated
  using (private.is_company_member(company_id));

drop policy if exists "Admins create milestones" on public.project_milestones;
create policy "Admins create milestones"
  on public.project_milestones for insert to authenticated
  with check (private.can_manage_company(company_id));

drop policy if exists "Admins update milestones" on public.project_milestones;
create policy "Admins update milestones"
  on public.project_milestones for update to authenticated
  using (private.can_manage_company(company_id))
  with check (private.can_manage_company(company_id));

-- ---------------------------------------------------------------------------------------
-- 4. A person who moves company stops being responsible for the old company's milestones
-- ---------------------------------------------------------------------------------------
-- move_employee_company (0014, latest body 0029) is left alone; this trigger covers every
-- path that changes a person's company, that function included.

create or replace function public.clear_milestone_owner_on_move()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.project_milestones
     set responsible_profile_id = null
   where responsible_profile_id = new.id
     and company_id is distinct from new.company_id;
  return null;
end;
$$;
revoke execute on function public.clear_milestone_owner_on_move() from public, anon, authenticated;

drop trigger if exists profiles_move_clears_milestone_owner on public.profiles;
create trigger profiles_move_clears_milestone_owner
  after update of company_id on public.profiles
  for each row
  when (old.company_id is distinct from new.company_id)
  execute function public.clear_milestone_owner_on_move();
