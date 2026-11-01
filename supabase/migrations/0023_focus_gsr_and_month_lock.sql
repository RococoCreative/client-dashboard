-- 0023_focus_gsr_and_month_lock.sql
-- The focus topic's GSR is the month's #1 GSR, and an admin's sign-off locks a month's GSR in.
-- Paste after 0022; idempotent.
--
--   1. goals.is_focus marks the month's focus GSR: the person's #1 GSR, inspired by the focus
--      topic and set as a role or professional goal, never a personal one. The separate 'focus'
--      kind goes; every goal of that kind becomes a professional goal marked as the focus GSR,
--      and a person carries at most one focus GSR a month.
--   2. reviews.gsr_score is a month's score, locked in when an admin marks the person's GSR for
--      the month complete. The app works it out (lib/gsr/goals.ts: the completion of the month's
--      goals, up to 100 for each mandatory GSR) and writes it with the status, the way the
--      deliverables line item is written; only an admin can write it, and reopening lets it go.
--      Until then the person and the manager both move the completion; the manager has the last
--      word because only an admin can mark the month complete. A scored review reads only locked
--      months (0022).
--   3. A locked month is frozen for that person: its goals and their notes, like a closed month,
--      until the review is reopened.
--   4. The why stays writable. 0012 let a change to outcome_note alone through a closed month,
--      because it is written the month after; 0014 lost that when it rewrote guard_goal_frozen.
--      Restored, for a closed month and a locked one alike.

-- ---------------------------------------------------------------------------------------
-- 1. The focus GSR
-- ---------------------------------------------------------------------------------------

alter table public.goals add column if not exists is_focus boolean not null default false;

-- Existing focus goals become professional goals marked as the focus GSR, and where a person has
-- more than one in a month, the first one filed keeps the mark. Not an edit anybody made, so the
-- guards, the company stamp and updated_at are left out of it.
alter table public.goals disable trigger user;
update public.goals
   set kind = 'professional', is_focus = (scope = 'cycle')
 where kind = 'focus';
update public.goals g
   set is_focus = false
 where g.is_focus
   and exists (
     select 1 from public.goals o
      where o.is_focus
        and o.employee_id = g.employee_id
        and o.cycle_id = g.cycle_id
        and (o.created_at, o.id) < (g.created_at, g.id)
   );
alter table public.goals enable trigger user;

alter table public.goals drop constraint if exists goals_kind_check;
alter table public.goals add constraint goals_kind_check check (kind in ('professional', 'personal', 'role'));

alter table public.goals drop constraint if exists goals_focus_check;
alter table public.goals add constraint goals_focus_check
  check (not is_focus or (scope = 'cycle' and kind in ('role', 'professional')));

create unique index if not exists goals_one_focus_per_month
  on public.goals (employee_id, cycle_id) where is_focus;

-- ---------------------------------------------------------------------------------------
-- 2. A month's score, locked in at sign-off
-- ---------------------------------------------------------------------------------------

alter table public.reviews add column if not exists gsr_score integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reviews_gsr_score_check') then
    alter table public.reviews add constraint reviews_gsr_score_check
      check (gsr_score is null or gsr_score between 0 and 100);
  end if;
end $$;

-- Only a completed review carries a locked score; reopening lets it go.
create or replace function public.release_gsr_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'complete' then
    new.gsr_score := null;
  end if;
  return new;
end;
$$;
revoke execute on function public.release_gsr_score() from public, anon, authenticated;

drop trigger if exists reviews_release_gsr_score on public.reviews;
create trigger reviews_release_gsr_score
  before insert or update on public.reviews
  for each row execute function public.release_gsr_score();

-- The score joins the columns only an admin may change, beside the status it is locked in with.
create or replace function public.guard_review_employee_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if private.can_manage_company(old.company_id) then
    return new;
  end if;
  if row(new.cycle_id, new.company_id, new.employee_id, new.status, new.previous_status,
         new.manager_feedback, new.peer_feedback, new.client_feedback, new.reviewer_id,
         new.completed_at, new.gsr_score)
     is distinct from
     row(old.cycle_id, old.company_id, old.employee_id, old.status, old.previous_status,
         old.manager_feedback, old.peer_feedback, old.client_feedback, old.reviewer_id,
         old.completed_at, old.gsr_score) then
    raise exception 'Only admins can edit review scores, status, and feedback.';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 3 and 4. A locked month is frozen, and the why stays writable
-- ---------------------------------------------------------------------------------------
-- A goal is frozen when its cycle is closed, or when the person's GSR for that cycle is complete
-- with its score locked in. Both the cycle a goal is in and, on an update, the one it would move
-- to are checked. A change to the why alone passes either way.
create or replace function public.guard_goal_frozen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from  uuid := case when tg_op = 'INSERT' then null else old.cycle_id end;
  v_to    uuid := case when tg_op = 'DELETE' then null else new.cycle_id end;
  v_whose uuid := case when tg_op = 'DELETE' then old.employee_id else new.employee_id end;
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
  if exists (
    select 1 from public.reviews r
    where r.cycle_id in (v_from, v_to)
      and r.employee_id = v_whose
      and r.status = 'complete'
      and r.gsr_score is not null
  ) then
    raise exception 'This month''s GSR is locked in. Reopen the review to change its goals.'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_goal_frozen() from public, anon, authenticated;

-- Notes freeze with their goal's month, closed or locked, as 0021 froze them with a closed one.
create or replace function public.guard_goal_note_frozen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from uuid := case when tg_op = 'INSERT' then null else old.goal_id end;
  v_to   uuid := case when tg_op = 'DELETE' then null else new.goal_id end;
begin
  if exists (
    select 1
      from public.goals g
      join public.review_cycles c on c.id = g.cycle_id
     where g.id in (v_from, v_to)
       and c.status = 'closed'
  ) then
    raise exception 'This review cycle is closed. Reopen it to change its notes.'
      using errcode = 'check_violation';
  end if;
  if exists (
    select 1
      from public.goals g
      join public.reviews r on r.cycle_id = g.cycle_id and r.employee_id = g.employee_id
     where g.id in (v_from, v_to)
       and r.status = 'complete'
       and r.gsr_score is not null
  ) then
    raise exception 'This month''s GSR is locked in. Reopen the review to change its notes.'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_goal_note_frozen() from public, anon, authenticated;
