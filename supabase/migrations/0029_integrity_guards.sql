-- 0029_integrity_guards.sql
-- Seven places where the database let a record of truth drift or point across the company wall,
-- found by the November QA pass. Paste after 0028; idempotent.
--
--   1. Deleting a cycle deletes the goals filed into it, the way it already deleted its reviews.
--      The goals used to stay behind with no cycle, on no screen and no longer frozen, and then
--      travelled to another company with their person, admins' notes and all. A goal in the
--      months now always names its month, and moving a person takes only their yearly and BHAG
--      goals.
--   2. Moving a person to another company, or to No company, leaves nothing pointing back. The old
--      company's pending invitation for them moves with them while they still need it to sign in,
--      and is withdrawn otherwise (always, for No company); their manager link goes if the manager
--      stays behind; and nobody left behind still reports to them.
--   3. A pillar or criterion that is part of a signed-off review cannot be deleted. Deleting one
--      took its frozen rows with it while the review's pillar snapshot kept its weight, so every
--      signed-off review it was part of quietly lost points. Retiring it (untick Active) is the
--      way to take it out of use.
--   4. A company runs one cycle per cadence and period. Two "November" months split a person's
--      GSR across twins.
--   5. A Rococo admin's profile is Rococo's to change. A company admin could deactivate or demote
--      one whose profile carried their company. And a deactivated person can no longer change
--      their own profile; they can still read it, so the inactive screen renders.
--   6. connection_states: the connections Edge Function records each sign-in's nonce here, so a
--      provider's return trip can be redeemed once and only once.
--   7. A signed-off review is read-only in the database too, until it is reopened. The review
--      page already locks it; the API did not.

-- ---------------------------------------------------------------------------------------
-- 1. A month's goals go with the month
-- ---------------------------------------------------------------------------------------
-- 0003 set goals.cycle_id to null when its cycle was deleted, on the idea that a goal outlives
-- its month. In practice the orphan showed on no screen, lost its freeze, and was the one monthly
-- goal that followed its person to another company. Cascade, as reviews_cycle_id_fkey does.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'goals_cycle_id_fkey'
       and conrelid = 'public.goals'::regclass
       and confdeltype = 'c'
  ) then
    alter table public.goals drop constraint if exists goals_cycle_id_fkey;
    alter table public.goals add constraint goals_cycle_id_fkey
      foreign key (cycle_id) references public.review_cycles (id) on delete cascade;
  end if;
end $$;

-- A goal in the months names its month, so nothing can make one cycle-less again by hand. Added
-- NOT VALID, so it holds for every write from here on without failing the paste on a goal an
-- earlier cycle delete already orphaned (such a goal can be deleted, not edited), and validated
-- straight away when there is none, as there was none live when this was written.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'goals_cycle_scope_check') then
    alter table public.goals add constraint goals_cycle_scope_check
      check (scope <> 'cycle' or cycle_id is not null) not valid;
  end if;
  if not exists (select 1 from public.goals where scope = 'cycle' and cycle_id is null) then
    alter table public.goals validate constraint goals_cycle_scope_check;
  end if;
end $$;

-- Same as 0023, with two writes let through that nobody makes by hand. When the cycle itself is
-- being deleted its goals go with it, closed or locked: the cycle row is already gone by the time
-- the cascade reaches them, and its reviews may or may not be. And when a goal a later month
-- carried forward is deleted, that later goal's carried_from_goal_id is set to null by the
-- foreign key, which is not an edit to a frozen month.
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
  if tg_op = 'DELETE'
     and old.cycle_id is not null
     and not exists (select 1 from public.review_cycles c where c.id = old.cycle_id) then
    return old;
  end if;
  if tg_op = 'UPDATE' then
    v_probe := new;
    v_probe.outcome_note := old.outcome_note;
    v_probe.updated_at := old.updated_at;
    if new.carried_from_goal_id is null
       and old.carried_from_goal_id is not null
       and not exists (select 1 from public.goals g where g.id = old.carried_from_goal_id) then
      v_probe.carried_from_goal_id := old.carried_from_goal_id;
    end if;
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

-- ---------------------------------------------------------------------------------------
-- 2. Moving a person leaves nothing pointing back
-- ---------------------------------------------------------------------------------------
-- Same as 0021, with three changes. Monthly goals are picked by scope rather than by a null
-- cycle, so a goal in the months never moves (and 0028 keeps it with its month's company).
-- Anyone who is not in the new company stops reporting to the person. And on every change of
-- company, No company included, the pending invitations that point back are settled. While the
-- person has no account and the address is theirs, the old company's invitation moves to the new
-- company, because the sign-in gate (0002) only admits a personal address with a pending
-- invitation; otherwise it is withdrawn. Left where it was, it stayed pending for good on the old
-- company's portfolio card, where nobody could see or cancel it once the person was off its
-- roster, and at their first sign-in it put them back in the company they had been taken out of.
-- invitations_company_email_key allows one invitation per company and address, so the move
-- only happens when the new company has none of its own for them. No company has nowhere to
-- move an invitation to, so setting someone there withdraws it; whichever company places them
-- later invites them from its People page.
create or replace function public.move_employee_company()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.company_id is not distinct from old.company_id then
    return new;
  end if;

  update public.profiles
     set reports_to = null
   where reports_to = new.id
     and company_id is distinct from new.company_id;

  -- The invitations to settle: any pending one in another company that names this person, and
  -- the old company's for their address that names nobody. Naming them also covers an invitation
  -- Rococo made for someone while they had no company. At most one moves (the newest), since a
  -- company holds one invitation per address; the rest are withdrawn. This runs for every writer,
  -- the SQL editor and handle_new_user included. When handle_new_user places someone at first
  -- sign-in it claims the row in the same write, so nothing moves, and the invitation it is about
  -- to accept is already in the new company, so only the others go.
  if new.company_id is not null then
    update public.invitations i
       set company_id = new.company_id,
           profile_id = new.id
     where i.id = (
             select c.id from public.invitations c
              where c.accepted_at is null
                and c.company_id is distinct from new.company_id
                and c.email = lower(new.email)
                and (c.profile_id = new.id
                     or (c.profile_id is null and c.company_id = old.company_id))
              order by c.created_at desc, c.id
              limit 1
           )
       and new.user_id is null
       and not exists (
         select 1 from public.invitations j
          where j.company_id = new.company_id and j.email = lower(new.email)
       );
  end if;
  delete from public.invitations i
   where i.accepted_at is null
     and i.company_id is distinct from new.company_id
     and (i.profile_id = new.id
          or (i.profile_id is null and i.company_id = old.company_id and i.email = lower(new.email)));

  if new.company_id is not null then
    update public.employee_kpis        set company_id = new.company_id where employee_id = new.id;
    update public.employee_financials  set company_id = new.company_id where employee_id = new.id;
    update public.compensation_items   set company_id = new.company_id where employee_id = new.id;
    update public.goals                set company_id = new.company_id where employee_id = new.id and scope <> 'cycle';
    update public.goal_notes n
       set company_id = new.company_id
      from public.goals g
     where g.id = n.goal_id and g.employee_id = new.id and g.scope <> 'cycle';
    update public.goal_private         set company_id = new.company_id where employee_id = new.id;
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

-- The person's own manager link goes when the manager is not in the company they move to. A
-- BEFORE trigger, so the row the move returns is already right; a manager in the new company,
-- set in the same write, is kept.
create or replace function public.clear_manager_on_move()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.company_id is distinct from old.company_id
     and new.reports_to is not null
     and not exists (
       select 1 from public.profiles m
        where m.id = new.reports_to and m.company_id = new.company_id
     ) then
    new.reports_to := null;
  end if;
  return new;
end;
$$;
revoke execute on function public.clear_manager_on_move() from public, anon, authenticated;

drop trigger if exists profiles_clear_manager_on_move on public.profiles;
create trigger profiles_clear_manager_on_move
  before update of company_id on public.profiles
  for each row execute function public.clear_manager_on_move();

-- ---------------------------------------------------------------------------------------
-- 3. A pillar or criterion on a signed-off review stays
-- ---------------------------------------------------------------------------------------
-- A completed review is scored from its frozen rows with the pillars in its snapshot (0017,
-- 0022). Deleting a pillar cascaded its rows away but left it in the snapshot, so it counted as
-- zero; deleting a criterion took its ratings out of the average. So neither goes while a
-- signed-off review holds it. Deleting the whole company is the exception: by the time the
-- cascade reaches these rows the company row is already gone.
create or replace function public.guard_pillar_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.companies c where c.id = old.company_id) then
    return old;
  end if;
  if exists (
       select 1 from public.reviews r
        where r.company_id = old.company_id
          and r.status = 'complete'
          and r.pillar_snapshot @> jsonb_build_array(jsonb_build_object('id', old.id))
     )
     or exists (
       select 1 from public.review_scores s
         join public.reviews r on r.id = s.review_id
        where s.pillar_id = old.id
          and r.status = 'complete'
     ) then
    raise exception 'This pillar is part of a signed-off review, so it cannot be deleted. Untick Active to retire it instead.'
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;
revoke execute on function public.guard_pillar_delete() from public, anon, authenticated;

drop trigger if exists gsr_pillars_guard_delete on public.gsr_pillars;
create trigger gsr_pillars_guard_delete
  before delete on public.gsr_pillars
  for each row execute function public.guard_pillar_delete();

create or replace function public.guard_criterion_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.companies c where c.id = old.company_id) then
    return old;
  end if;
  if exists (
    select 1 from public.review_scores s
      join public.reviews r on r.id = s.review_id
     where s.criterion_id = old.id
       and r.status = 'complete'
  ) then
    raise exception 'This criterion is part of a signed-off review, so it cannot be deleted. Untick Active to retire it instead.'
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;
revoke execute on function public.guard_criterion_delete() from public, anon, authenticated;

drop trigger if exists gsr_criteria_guard_delete on public.gsr_criteria;
create trigger gsr_criteria_guard_delete
  before delete on public.gsr_criteria
  for each row execute function public.guard_criterion_delete();

-- ---------------------------------------------------------------------------------------
-- 4. One cycle per cadence and period
-- ---------------------------------------------------------------------------------------
-- A second cycle with the same cadence and dates splits everyone's review across twins: My GSR
-- opens one, the manager works the other, and "last month" reads whichever comes first. Live
-- had no duplicates when this was written; if a paste fails here, two cycles share a cadence
-- and period and one of them has to go first. The pages refuse an overlapping period with a
-- plainer message before it gets this far.
create unique index if not exists review_cycles_period_key
  on public.review_cycles (company_id, cadence, period_start, period_end);

-- ---------------------------------------------------------------------------------------
-- 5. Rococo's rows, and a deactivated person's own row
-- ---------------------------------------------------------------------------------------
-- Same as 0018, with two refusals added after the line that lets Rococo and the system through.
-- A Rococo admin whose profile carries a company sits on that company's roster, and the company
-- branch never looked at is_rococo_admin: its admin could deactivate them, which ends their
-- access to every company. And a deactivated person still matched the update policy's "own row"
-- branch, so a live session could rename them on every roster.
-- One write is let through ahead of both: a foreign key clearing job_role_id or reports_to
-- because the role or the person it named is being deleted. That runs as whoever made the
-- delete, which their own policy already allowed, so without this a company admin could not
-- delete a job role a Rococo admin holds, or remove someone a Rococo admin reports to. The row
-- it named is gone only during that delete, so clearing a link by hand is still checked.
create or replace function public.guard_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_probe   public.profiles%rowtype;
  v_cleared boolean := false;
begin
  new.email := old.email;
  if (select auth.uid()) is null or private.is_rococo_admin() then
    return new;
  end if;

  v_probe := new;
  v_probe.updated_at := old.updated_at;
  if new.reports_to is null
     and old.reports_to is not null
     and not exists (select 1 from public.profiles m where m.id = old.reports_to) then
    v_probe.reports_to := old.reports_to;
    v_cleared := true;
  end if;
  if new.job_role_id is null
     and old.job_role_id is not null
     and not exists (select 1 from public.job_roles j where j.id = old.job_role_id) then
    v_probe.job_role_id := old.job_role_id;
    v_cleared := true;
  end if;
  if v_cleared and v_probe is not distinct from old then
    return new;
  end if;

  if old.is_rococo_admin then
    raise exception 'A Rococo admin''s profile can only be changed by Rococo.';
  end if;

  if old.user_id = (select auth.uid()) and not old.is_active then
    raise exception 'This account is inactive, so its profile cannot be changed.';
  end if;

  if new.user_id is distinct from old.user_id then
    raise exception 'An account link is set when the person signs in and cannot be changed here.';
  end if;

  if new.company_id is distinct from old.company_id
     or new.is_rococo_admin is distinct from old.is_rococo_admin then
    raise exception 'Only Rococo admins can change company assignment or Rococo access.';
  end if;

  if private.is_company_admin() and old.company_id = private.auth_company_id() then
    if old.user_id = (select auth.uid())
       and (new.role is distinct from old.role or new.is_active is distinct from old.is_active) then
      raise exception 'You cannot change your own role or deactivate your own account.';
    end if;
    return new;
  end if;

  if old.user_id is distinct from (select auth.uid()) then
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
revoke execute on function public.guard_profile_fields() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 6. connection_states
-- ---------------------------------------------------------------------------------------
-- The state a company admin carries to a provider and back is signed, but until now nothing
-- remembered it, so it could be redeemed again for as long as it lived. /start records its nonce
-- here and /callback deletes it, refusing a nonce that is not here. Row level security on and no
-- policies, as connection_tokens: only the function's service role reads or writes it.
create table if not exists public.connection_states (
  nonce uuid primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.connection_states enable row level security;
revoke all on public.connection_states from anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 7. A signed-off review is read-only until it is reopened
-- ---------------------------------------------------------------------------------------
-- Sign-off writes the period's line items while the review is still open, then flips the status,
-- and the freeze (0017) copies the person's ratings in during that flip. Reopen flips it back.
-- Those are the only ways a completed review's rows change. Everything else is refused, so an
-- admin's API write cannot move a score of record without a new sign-off.

-- Same as 0017, except that it marks the copy it makes, for the guard below, and clears the mark
-- as soon as the copy is done. The mark is a setting local to the transaction, which nothing
-- outside the database can set.
create or replace function public.freeze_review_ratings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'complete' and old.status is distinct from 'complete' then
    perform set_config('hub.freezing_review', new.id::text, true);
    insert into public.review_scores (review_id, company_id, pillar_id, criterion_id, rating)
    select new.id, new.company_id, i.pillar_id, i.criterion_id, i.rating
      from public.impact_scores i
      join public.gsr_criteria c on c.id = i.criterion_id and c.is_active
      join public.gsr_pillars p  on p.id = i.pillar_id and p.is_active and p.scoring_type = 'rating'
     where i.employee_id = new.employee_id
       and i.company_id = new.company_id
    on conflict (review_id, criterion_id) where criterion_id is not null
    do update set rating = excluded.rating;
    perform set_config('hub.freezing_review', '', true);
  end if;
  return new;
end;
$$;
revoke execute on function public.freeze_review_ratings() from public, anon, authenticated;

-- A row on a completed review is not added, changed or removed, except by the freeze above.
-- On an update both the review a row is on and the one it would move to are checked. A row going
-- because its review or its company is being deleted goes with them: the parent is already gone
-- when the cascade arrives. Deleting a pillar or criterion never gets this far for a completed
-- review (section 3).
create or replace function public.guard_signed_off_scores()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from uuid := case when tg_op = 'INSERT' then null else old.review_id end;
  v_to   uuid := case when tg_op = 'DELETE' then null else new.review_id end;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.reviews r where r.id = old.review_id)
       or not exists (select 1 from public.companies c where c.id = old.company_id) then
      return old;
    end if;
  elsif new.criterion_id is not null
        and v_to::text = current_setting('hub.freezing_review', true)
        and (tg_op = 'INSERT' or v_from = v_to) then
    return new;
  end if;
  if exists (
    select 1 from public.reviews r
     where r.id in (v_from, v_to)
       and r.status = 'complete'
  ) then
    raise exception 'This review is signed off. Reopen it to change it.'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_signed_off_scores() from public, anon, authenticated;

drop trigger if exists review_scores_guard_signed_off on public.review_scores;
create trigger review_scores_guard_signed_off
  before insert or update or delete on public.review_scores
  for each row execute function public.guard_signed_off_scores();

-- A completed review keeps what it was signed off with: status, score, sign-off date and
-- reviewer, the judgment on last period and the feedback. Leaving 'complete' (Reopen) and
-- arriving at it (Mark complete) pass. The person's reflection stays theirs to write after
-- sign-off (0022), and the pillar snapshot is already kept by its own trigger. A reviewer whose
-- profile is deleted is set to null by the foreign key, which is not an edit.
create or replace function public.guard_signed_off_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_probe public.reviews%rowtype;
begin
  if old.status <> 'complete' or new.status <> 'complete' then
    return new;
  end if;
  v_probe := new;
  v_probe.employee_reflection := old.employee_reflection;
  v_probe.updated_at := old.updated_at;
  v_probe.pillar_snapshot := old.pillar_snapshot;
  if new.reviewer_id is null
     and old.reviewer_id is not null
     and not exists (select 1 from public.profiles p where p.id = old.reviewer_id) then
    v_probe.reviewer_id := old.reviewer_id;
  end if;
  if v_probe is distinct from old then
    raise exception 'This review is signed off. Reopen it to change it.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_signed_off_review() from public, anon, authenticated;

drop trigger if exists reviews_guard_signed_off on public.reviews;
create trigger reviews_guard_signed_off
  before update on public.reviews
  for each row execute function public.guard_signed_off_review();
