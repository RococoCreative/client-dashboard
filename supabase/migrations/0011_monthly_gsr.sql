-- 0011_monthly_gsr.sql
-- The monthly review is a Goal Setting Review. In the meeting the manager sets the month's
-- goals with the person: each goal carries action steps and a 0..100 progress, where 100 is
-- complete; the next month reads them back as hit or miss and can carry a missed goal
-- forward. Yearly goals per person sit alongside, and a review names the month's focus
-- topics. Paste after 0010; idempotent.
--
-- goals.scope says which period a goal belongs to: 'cycle' (a review cycle: the monthly
-- goals) or 'year' (a yearly goal: scope + year, no cycle). A cycle goal whose cycle was
-- deleted keeps scope 'cycle' with a null cycle_id and reads as ongoing.

alter table public.goals add column if not exists progress integer not null default 0;
alter table public.goals add column if not exists scope text not null default 'cycle';
alter table public.goals add column if not exists year integer;
alter table public.goals add column if not exists carried_from_goal_id uuid references public.goals (id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'goals_progress_check') then
    alter table public.goals add constraint goals_progress_check check (progress between 0 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'goals_scope_check') then
    alter table public.goals add constraint goals_scope_check check (scope in ('cycle', 'year'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'goals_year_check') then
    alter table public.goals add constraint goals_year_check check (scope <> 'year' or year is not null);
  end if;
end $$;

create index if not exists goals_employee_year_idx on public.goals (employee_id, year) where scope = 'year';

-- reviews: the month's focus topics, named in the meeting.
alter table public.reviews add column if not exists focus_topics text[] not null default '{}';

-- Cadences are monthly, quarterly, annual, and custom. Twice a year is gone; no cycle used it.
alter table public.review_cycles drop constraint if exists review_cycles_cadence_check;
alter table public.review_cycles add constraint review_cycles_cadence_check
  check (cadence in ('monthly', 'quarterly', 'annual', 'custom'));

-- A closed cycle is a snapshot: its goals cannot change or disappear until it is reopened.
-- Guards both the cycle a goal is in and, on update, the cycle it would move to.
create or replace function public.guard_goal_frozen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from uuid := old.cycle_id;
  v_to   uuid := case when tg_op = 'DELETE' then null else new.cycle_id end;
begin
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
revoke execute on function public.guard_goal_frozen() from public, anon, authenticated;

drop trigger if exists goals_guard_frozen on public.goals;
create trigger goals_guard_frozen
  before update or delete on public.goals
  for each row execute function public.guard_goal_frozen();
