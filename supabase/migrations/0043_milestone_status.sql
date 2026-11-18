-- 0043_milestone_status.sql
-- A milestone carries one of three statuses, kept in step with its completed-on date. Paste after
-- 0042; idempotent.
--
-- Why: a milestone that has started but is not finished read the same as one nobody has touched.
-- The status set is now agreed, so 0026's "there is no status column ... a milestone is complete
-- when it has a completed-on date, and nothing else" is superseded: a milestone is not started,
-- in progress or complete, and complete still always means it has a completed-on date. The
-- statuses are shared by every company; nothing here is one company's value.
--
--   1. project_milestones.status: 'not_started' unless set, one of the three. Every row that
--      already has a completed-on date is marked complete, once.
--   2. public.sync_milestone_status(): a BEFORE trigger that keeps the two in step on every
--      insert and update. Completing sets the date to today in the company's own time zone (the
--      0037 reading of today); reopening clears it; setting a date completes; clearing the date
--      puts the milestone back to not started. When one write changes both, the date wins.
--
-- The insert and update policies (latest body 0041, milestones_edit) are unchanged; a status is
-- written by whoever may already write the row.

-- ---------------------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------------------

alter table public.project_milestones add column if not exists status text not null default 'not_started';

do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'project_milestones_status_check') then
    alter table public.project_milestones add constraint project_milestones_status_check
      check (status in ('not_started', 'in_progress', 'complete'));
  end if;
end $$;

-- The one-time backfill. It touches only rows that are out of step, so a second paste changes
-- nothing (and, with the trigger below in place, a row it did touch would already agree).
update public.project_milestones
   set status = 'complete'
 where completed_on is not null
   and status <> 'complete';

-- ---------------------------------------------------------------------------------------
-- 2. The status and the date stay in step
-- ---------------------------------------------------------------------------------------
-- Security definer to read the company's time zone whoever writes. The company comes from
-- new.company_id, which project_milestones_inherit has already set from the project.

create or replace function public.sync_milestone_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date_changed   boolean;
  v_status_changed boolean;
  v_today          date;
begin
  if tg_op = 'INSERT' then
    v_date_changed := new.completed_on is not null;
    v_status_changed := new.status is distinct from 'not_started';
  else
    v_date_changed := new.completed_on is distinct from old.completed_on;
    v_status_changed := new.status is distinct from old.status;
  end if;

  if v_date_changed then
    -- The date wins: a date means complete, and clearing it reopens the milestone, to the open
    -- status the same write asked for when it named one, or to not started.
    if new.completed_on is not null then
      new.status := 'complete';
    elsif not v_status_changed or new.status = 'complete' then
      new.status := 'not_started';
    end if;
  elsif new.status = 'complete' and new.completed_on is null then
    select (now() at time zone c.time_zone)::date into v_today
      from public.companies c
     where c.id = new.company_id;
    new.completed_on := v_today;
  elsif new.status <> 'complete' and new.completed_on is not null then
    new.completed_on := null;
  end if;

  return new;
end;
$$;
revoke execute on function public.sync_milestone_status() from public, anon, authenticated;

-- BEFORE triggers fire in name order. "project_milestones_sync_status" sorts after
-- "project_milestones_inherit" (0026), so company_id is already the project's when this reads the
-- company's time zone. It also sorts after stamp_actor and set_updated_at, which do not read
-- either column.
drop trigger if exists project_milestones_sync_status on public.project_milestones;
create trigger project_milestones_sync_status
  before insert or update on public.project_milestones
  for each row execute function public.sync_milestone_status();
