-- 0027_wins.sql
-- Wins the company records by hand. Paste after 0026; idempotent.
--
-- Why: a company with the wins module keeps a list of its wins (a title, the date it was won, a
-- line about it, optionally the project it came from) that admins enter and members read. Every
-- write from the browser is manual: the guard forces source_type to 'manual' and clears
-- source_ref whenever someone is signed in, so a later import (written with nobody signed in)
-- can always be told apart from what a person typed. Nothing is deleted; wins are archived.
--
--   1. public.wins: members read, admins write, nobody deletes.
--   2. public.guard_win(): browser writes are manual, the company is pinned, and a win's project
--      must belong to the win's company.
--
-- Wins are content, not configuration, so they carry no audit trigger.

-- ---------------------------------------------------------------------------------------
-- 1. Wins
-- ---------------------------------------------------------------------------------------

create table if not exists public.wins (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  title       text not null,
  description text,
  won_on      date not null,
  project_id  uuid references public.projects (id) on delete set null,
  source_type text not null default 'manual',
  source_ref  jsonb,
  archived_at timestamptz,
  created_by  uuid references public.profiles (id) on delete set null,
  updated_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint wins_title_check check (btrim(title) <> ''),
  constraint wins_source_type_check check (source_type in ('manual'))
);

create index if not exists wins_company_won_idx on public.wins (company_id, won_on desc);
create index if not exists wins_project_id_idx on public.wins (project_id);
create index if not exists wins_created_by_idx on public.wins (created_by);
create index if not exists wins_updated_by_idx on public.wins (updated_by);

-- ---------------------------------------------------------------------------------------
-- 2. The guard
-- ---------------------------------------------------------------------------------------
-- Security definer so the project's company reads past row level security.

create or replace function public.guard_win()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.source_type := 'manual';
    new.source_ref := null;
  end if;
  if tg_op = 'UPDATE' then
    new.company_id := old.company_id;
  end if;
  if new.project_id is not null
     and (select company_id from public.projects where id = new.project_id)
         is distinct from new.company_id then
    raise exception 'That project belongs to another company.';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_win() from public, anon, authenticated;

-- BEFORE triggers fire in name order; none of these depends on another's result.
drop trigger if exists wins_guard on public.wins;
create trigger wins_guard
  before insert or update on public.wins
  for each row execute function public.guard_win();

drop trigger if exists wins_stamp_actor on public.wins;
create trigger wins_stamp_actor
  before insert or update on public.wins
  for each row execute function public.stamp_actor();

drop trigger if exists wins_set_updated_at on public.wins;
create trigger wins_set_updated_at
  before update on public.wins
  for each row execute function public.set_updated_at();

alter table public.wins enable row level security;

revoke all on public.wins from anon, authenticated;
grant select, insert, update on public.wins to authenticated;

drop policy if exists "Members read wins" on public.wins;
create policy "Members read wins"
  on public.wins for select to authenticated
  using (private.is_company_member(company_id));

drop policy if exists "Admins create wins" on public.wins;
create policy "Admins create wins"
  on public.wins for insert to authenticated
  with check (private.can_manage_company(company_id));

drop policy if exists "Admins update wins" on public.wins;
create policy "Admins update wins"
  on public.wins for update to authenticated
  using (private.can_manage_company(company_id))
  with check (private.can_manage_company(company_id));
