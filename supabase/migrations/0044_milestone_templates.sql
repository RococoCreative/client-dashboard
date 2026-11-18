-- 0044_milestone_templates.sql
-- A company's standard milestones, copied onto every project it creates from now on. Paste after
-- 0043; idempotent.
--
-- Why: a company with the production module walks most projects through the same checkpoints and
-- letters, and typed them onto every project by hand. The list is a company's own rows (rule 12);
-- a company with none gets projects with no milestones, exactly as today. Nothing here is one
-- company's value.
--
--   1. public.milestone_templates: one row per standard milestone or letter, in order. Members
--      read their own company's rows, admins write them, nobody deletes (a row is archived). A
--      row stays in the company it was created in. Every change is audited.
--   2. public.apply_milestone_template(): an AFTER INSERT trigger on projects that copies the
--      company's live rows, in order, onto the new project. It is a copy: editing the list later
--      never reaches back into a project, and projects that already exist keep what they have.
--
-- The projects policies (0026) are unchanged; projects stay admin-only to create.

-- ---------------------------------------------------------------------------------------
-- 1. The list
-- ---------------------------------------------------------------------------------------
-- The title and kind checks match project_milestones (0026), so every row copies cleanly.

create table if not exists public.milestone_templates (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  title       text not null,
  kind        text not null default 'milestone',
  sort_order  integer not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint milestone_templates_kind_check check (kind in ('milestone', 'letter')),
  constraint milestone_templates_title_check check (btrim(title) <> '')
);

create index if not exists milestone_templates_company_idx on public.milestone_templates (company_id, sort_order);

drop trigger if exists milestone_templates_pin_company on public.milestone_templates;
create trigger milestone_templates_pin_company
  before update on public.milestone_templates
  for each row execute function public.pin_company_id();

drop trigger if exists milestone_templates_set_updated_at on public.milestone_templates;
create trigger milestone_templates_set_updated_at
  before update on public.milestone_templates
  for each row execute function public.set_updated_at();

drop trigger if exists milestone_templates_audit on public.milestone_templates;
create trigger milestone_templates_audit
  after insert or update or delete on public.milestone_templates
  for each row execute function private.audit_change('title', 'kind', 'sort_order', 'archived_at');

alter table public.milestone_templates enable row level security;

revoke all on public.milestone_templates from anon, authenticated;
grant select, insert, update on public.milestone_templates to authenticated;

drop policy if exists "Members read milestone templates" on public.milestone_templates;
create policy "Members read milestone templates"
  on public.milestone_templates for select to authenticated
  using (private.is_company_member(company_id));

drop policy if exists "Admins create milestone templates" on public.milestone_templates;
create policy "Admins create milestone templates"
  on public.milestone_templates for insert to authenticated
  with check (private.can_manage_company(company_id));

drop policy if exists "Admins update milestone templates" on public.milestone_templates;
create policy "Admins update milestone templates"
  on public.milestone_templates for update to authenticated
  using (private.can_manage_company(company_id))
  with check (private.can_manage_company(company_id));

-- ---------------------------------------------------------------------------------------
-- 2. A new project starts with the list
-- ---------------------------------------------------------------------------------------
-- Security definer so the copy happens whoever creates the project: the person creating it needs
-- no right to read the list or write milestones, and a project that arrives with nobody signed in
-- (a sync) gets the same copy. Only the project's own company's live rows are read. A company with
-- no rows copies nothing, so the project insert never fails for want of a list. The milestone
-- triggers run on each copied row as on any other insert: company from the project, the actor
-- stamped when someone is signed in, status not started.

create or replace function public.apply_milestone_template()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.project_milestones (project_id, company_id, title, kind, sort_order, created_by)
  select new.id, new.company_id, t.title, t.kind, row_number() over (order by t.sort_order, t.created_at, t.id), new.created_by
    from public.milestone_templates t
   where t.company_id = new.company_id
     and t.archived_at is null
   order by t.sort_order, t.created_at, t.id;
  return null;
end;
$$;
revoke execute on function public.apply_milestone_template() from public, anon, authenticated;

drop trigger if exists projects_apply_milestone_template on public.projects;
create trigger projects_apply_milestone_template
  after insert on public.projects
  for each row execute function public.apply_milestone_template();
