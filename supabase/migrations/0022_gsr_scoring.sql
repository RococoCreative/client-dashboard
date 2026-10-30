-- 0022_gsr_scoring.sql
-- A review keeps the pillars it was signed off with, and a pillar can be scored from the monthly
-- GSRs. Paste after 0021; idempotent.
--
--   1. reviews.pillar_snapshot: the active pillars and their weights at the moment a review is
--      marked complete. A completed review was scored with whatever pillars the company had on
--      the day it was read, so adding a pillar or changing a weight quietly re-scored every
--      signed-off review, and a new pillar counted as zero on all of them. The ratings and line
--      items were frozen at sign-off (0017); now the weights that combine them are too. Written
--      by a trigger on the status flip and cleared on reopen, the same rhythm as the ratings;
--      whatever a client sends for the column is ignored. Every review already complete is
--      backfilled with today's pillars, so no score of record moves when a company re-weights.
--   2. A fourth scoring type, 'gsr_goals': a pillar scored from the Goal Setting Reviews inside
--      the review's period. The app works out each month's figure from the agreed completion of
--      the month's goals (lib/gsr/goals.ts) and writes the period's target and actual as one line
--      item on Mark complete, the way 'deliverables_module' does, so a slider moved after
--      sign-off moves nothing on the review. gsr_pillars.required_goals is how many goals a month
--      must carry for that pillar, read only by this type, the way rating_scale_max is read only
--      by rating pillars. A company without such a pillar is untouched.
--   3. Where a company scores its GSRs, a monthly goal's agreed completion is the manager's to
--      set: it is a number the score is built from, agreed in the review, and nobody moves their
--      own score, which is the rule impact scores already keep. The person still prepares their
--      month in full (goals, steps, notes); only the completion, and the status it drives, is
--      refused to anyone but an admin. A company without a Monthly GSRs pillar is untouched.
--
-- Apply this before a company adds a Monthly GSRs pillar or changes a weight, so the backfill
-- records the weights its completed reviews were actually signed off with.

-- ---------------------------------------------------------------------------------------
-- 1. The pillars a review was signed off with
-- ---------------------------------------------------------------------------------------

alter table public.reviews add column if not exists pillar_snapshot jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reviews_pillar_snapshot_check') then
    alter table public.reviews add constraint reviews_pillar_snapshot_check
      check (pillar_snapshot is null or jsonb_typeof(pillar_snapshot) = 'array');
  end if;
end $$;

-- required_goals (section 2) is part of the snapshot, so the column has to exist first.
alter table public.gsr_pillars add column if not exists required_goals integer not null default 2;

-- The company's active pillars, in their configured order, as the review scores them.
create or replace function private.pillar_snapshot(cid uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'weight', p.weight,
        'scoring_type', p.scoring_type,
        'rating_scale_max', p.rating_scale_max,
        'required_goals', p.required_goals
      )
      order by p.sort_order, p.created_at
    ),
    '[]'::jsonb
  )
  from public.gsr_pillars p
  where p.company_id = cid and p.is_active
$$;
revoke all on function private.pillar_snapshot(uuid) from public, anon, authenticated;

-- Backfill before the trigger exists, so it is not undone by the trigger keeping the old value.
-- Clearing nothing else: updated_at and the employee guard are left out of a change nobody made.
drop trigger if exists reviews_snapshot_pillars on public.reviews;
alter table public.reviews disable trigger user;
update public.reviews r
   set pillar_snapshot = private.pillar_snapshot(r.company_id)
 where r.status = 'complete' and r.pillar_snapshot is null;
alter table public.reviews enable trigger user;

-- Written on the transition to complete, cleared on reopen, and otherwise kept as it was, so a
-- later edit to a completed review (an employee's reflection) never re-reads today's pillars.
create or replace function public.snapshot_review_pillars()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was text := case when tg_op = 'UPDATE' then old.status else null end;
  v_kept jsonb := case when tg_op = 'UPDATE' then old.pillar_snapshot else null end;
begin
  if new.status = 'complete' and v_was is distinct from 'complete' then
    new.pillar_snapshot := private.pillar_snapshot(new.company_id);
  elsif new.status <> 'complete' then
    new.pillar_snapshot := null;
  else
    new.pillar_snapshot := v_kept;
  end if;
  return new;
end;
$$;
revoke execute on function public.snapshot_review_pillars() from public, anon, authenticated;

create trigger reviews_snapshot_pillars
  before insert or update on public.reviews
  for each row execute function public.snapshot_review_pillars();

-- ---------------------------------------------------------------------------------------
-- 2. Monthly GSRs as a scoring type
-- ---------------------------------------------------------------------------------------

alter table public.gsr_pillars drop constraint if exists gsr_pillars_scoring_type_check;
alter table public.gsr_pillars add constraint gsr_pillars_scoring_type_check
  check (scoring_type in ('rating', 'deliverables', 'deliverables_module', 'gsr_goals'));

alter table public.gsr_pillars drop constraint if exists gsr_pillars_required_goals_check;
alter table public.gsr_pillars add constraint gsr_pillars_required_goals_check
  check (required_goals between 1 and 10);

-- ---------------------------------------------------------------------------------------
-- 3. Agreed completion is set in the review, where GSRs are scored
-- ---------------------------------------------------------------------------------------

create or replace function public.guard_goal_agreed_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_progress integer := case when tg_op = 'UPDATE' then old.progress else 0 end;
  v_status   text    := case when tg_op = 'UPDATE' then old.status else 'not_started' end;
  -- The person's company, which goals_inherit_company stamps after this runs; the row's own
  -- company_id is still whatever the caller sent.
  v_company  uuid    := (select pr.company_id from public.profiles pr where pr.id = new.employee_id);
begin
  if new.scope = 'cycle'
     and (new.progress is distinct from v_progress or new.status is distinct from v_status)
     and not private.can_manage_company(v_company)
     and exists (
       select 1 from public.gsr_pillars p
        where p.company_id = v_company and p.scoring_type = 'gsr_goals' and p.is_active
     )
  then
    raise exception 'A monthly goal''s completion is agreed with your manager in the review.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_goal_agreed_completion() from public, anon, authenticated;

drop trigger if exists goals_guard_agreed_completion on public.goals;
create trigger goals_guard_agreed_completion
  before insert or update on public.goals
  for each row execute function public.guard_goal_agreed_completion();
