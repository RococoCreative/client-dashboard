-- 0039_gsr_guards_and_task_goal_links.sql
-- The GSR workflow holds end to end, and a task can be linked to a monthly goal. 0038 decided who
-- sees and leads whom; this migration closes the GSR gaps the design review found and moves tasks
-- onto the same rules, as docs/superpowers/specs/2026-11-18-team-division-access-design.md sets
-- out (its final section, "Revisions after the design review", wins wherever the two disagree).
--
-- What changes:
--   1. Goals. A carried goal keeps the creator of the goal it came from, but only when that goal
--      is the same person's. The "set for you" lock binds the goal's own person only, so a
--      manager or admin editing a report's goal is not refused as if they were the employee.
--      Whose goal it is never changes once filed (Rococo aside), so a task linked to it stays
--      with the right person.
--   2. A monthly GSR marked complete freezes its goals and notes whether or not it was scored.
--      Months already marked complete freeze the moment this is pasted.
--   3. Sign-off drops the review's frozen ratings for criteria that are no longer frozen (a
--      retired criterion), inside the freeze window; line items are never touched. A pillar
--      scored from one figure (the deliverables module, Monthly GSRs) holds one line item per
--      review, so a retried sign-off cannot add a second.
--   4. Reviews: none is started in a closed cycle, none leaves complete while its cycle is
--      closed, and a review's person belongs to its cycle's company.
--   5. tasks.goal_id links a task to a monthly goal of its assignee. Linking checks the month's
--      freeze; unlinking always passes; a linked task changes hands only in the write that
--      unlinks it; a deleted goal or person, a company move and the rule triggers clear it.
--   6. Tasks are read through their assignee (whoever sees the person) and written through the
--      led set: a leader edits and completes the tasks of the people they lead, and a division
--      view alone never lets anyone write. A plain assignee may change only completion and the
--      goal link on a task someone else assigned.
--
-- Rebuilt functions are copied from their latest bodies (guard_goal_owner from 0035,
-- guard_goal_frozen and guard_goal_note_frozen from 0034, freeze_review_ratings and
-- guard_signed_off_scores from 0029, guard_task, guard_task_step and clear_task_assignee_on_move
-- from 0036) with only the lines this migration names added. recur_task (0037) is unchanged: it
-- lists the columns it copies, and goal_id is not one of them, so a new copy is never linked.
--
-- Paste after 0038, then deploy the app the same day. Idempotent.

-- ---------------------------------------------------------------------------------------
-- 1. Goals: who filed it, the lock, and whose it is
-- ---------------------------------------------------------------------------------------
-- The 0035 body with three changes:
--   * a carried goal (carried_from_goal_id) takes created_by from the goal it was carried from,
--     read here and never from the client, when that goal is the same person's; otherwise the
--     signed-in person, as for any goal;
--   * the lock binds only the goal's own person: someone else editing it (a leader, an admin)
--     is judged by the policies, not by this rule;
--   * employee_id is kept as filed on every signed-in update but Rococo's.
create or replace function public.guard_goal_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_creator uuid;
begin
  if tg_op = 'INSERT' then
    if (select auth.uid()) is not null then
      new.created_by := private.auth_profile_id();
      if new.carried_from_goal_id is not null then
        select g.created_by into v_source_creator
          from public.goals g
         where g.id = new.carried_from_goal_id
           and g.employee_id = new.employee_id;
        if found then
          new.created_by := v_source_creator;
        end if;
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' and (select auth.uid()) is not null then
    if not private.is_rococo_admin() then
      new.employee_id := old.employee_id;
    end if;
    if new.created_by is distinct from old.created_by
       and not (new.created_by is null
                and old.created_by is not null
                and not exists (select 1 from public.profiles p where p.id = old.created_by)) then
      new.created_by := old.created_by;
    end if;
  end if;

  if (select auth.uid()) is null
     or private.auth_profile_id() is distinct from old.employee_id
     or private.can_manage_company(old.company_id)
     or old.created_by is null
     or old.created_by = old.employee_id then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'This goal was set for you, so only an admin can remove it.'
      using errcode = 'check_violation';
  end if;
  if row(new.title, new.description, new.kind, new.is_focus, new.cycle_id, new.scope, new.year)
     is distinct from
     row(old.title, old.description, old.kind, old.is_focus, old.cycle_id, old.scope, old.year) then
    raise exception 'This goal was set for you, so only an admin can change what it is. You can still move its completion, tick its steps and add notes.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_goal_owner() from public, anon, authenticated;

drop trigger if exists goals_guard_owner on public.goals;
create trigger goals_guard_owner
  before insert or update or delete on public.goals
  for each row execute function public.guard_goal_owner();

-- ---------------------------------------------------------------------------------------
-- 2. A complete monthly GSR is frozen, scored or not
-- ---------------------------------------------------------------------------------------
-- The 0034 bodies with one change: a review marked complete freezes its month when the month is
-- monthly, whether or not a score was locked in with it (a company with no Monthly GSRs pillar
-- never writes one). Any other cadence freezes on a locked score only, as before. The why on its
-- own, the closed cycle, the omitted person and the pass-throughs for deletes are unchanged.
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
    select 1
      from public.reviews r
      join public.review_cycles c on c.id = r.cycle_id
    where r.cycle_id in (v_from, v_to)
      and r.employee_id = v_whose
      and r.status = 'complete'
      and (r.gsr_score is not null or c.cadence = 'monthly')
  ) then
    raise exception 'This month''s GSR is locked in. Reopen the review to change its goals.'
      using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.cycle_omissions o
    where o.cycle_id in (v_from, v_to)
      and o.employee_id = v_whose
      and exists (select 1 from public.profiles p where p.id = o.employee_id)
      and exists (select 1 from public.companies co where co.id = o.company_id)
  ) then
    raise exception 'This person is not part of this month''s GSRs. Add them back to change its goals.'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_goal_frozen() from public, anon, authenticated;

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
      join public.review_cycles c on c.id = r.cycle_id
     where g.id in (v_from, v_to)
       and r.status = 'complete'
       and (r.gsr_score is not null or c.cadence = 'monthly')
  ) then
    raise exception 'This month''s GSR is locked in. Reopen the review to change its notes.'
      using errcode = 'check_violation';
  end if;
  if exists (
    select 1
      from public.goals g
      join public.cycle_omissions o on o.cycle_id = g.cycle_id and o.employee_id = g.employee_id
      join public.profiles p on p.id = o.employee_id
      join public.companies co on co.id = o.company_id
     where g.id in (v_from, v_to)
  ) then
    raise exception 'This person is not part of this month''s GSRs. Add them back to change its notes.'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_goal_note_frozen() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 3. Sign-off freezes exactly the ratings it means to
-- ---------------------------------------------------------------------------------------
-- The 0029 body plus one delete, inside the same freeze window and before the copy: this review's
-- rating rows (criterion set) for any criterion this sign-off does not freeze go, so a criterion
-- retired between a reopen and a re-sign stops counting. Line items (no criterion) are the
-- sign-off's own figures and are never touched here.
create or replace function public.freeze_review_ratings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'complete' and old.status is distinct from 'complete' then
    perform set_config('hub.freezing_review', new.id::text, true);
    delete from public.review_scores s
     where s.review_id = new.id
       and s.criterion_id is not null
       and not exists (
         select 1
           from public.impact_scores i
           join public.gsr_criteria c on c.id = i.criterion_id and c.is_active
           join public.gsr_pillars p  on p.id = i.pillar_id and p.is_active and p.scoring_type = 'rating'
          where i.employee_id = new.employee_id
            and i.company_id = new.company_id
            and i.criterion_id = s.criterion_id
       );
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

-- The 0029 body plus the freeze's delete: a rating row (criterion set) of the review being frozen
-- may go while the freeze runs. Nothing else on a completed review changes.
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
    if old.criterion_id is not null
       and old.review_id::text = current_setting('hub.freezing_review', true) then
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

-- One figure per single-figure pillar. A pillar scored from the deliverables module or from the
-- locked months (scoring_type 'deliverables_module' or 'gsr_goals') carries one line item per
-- review, written at sign-off; a retried sign-off must find it, not add another. A typed
-- deliverables pillar ('deliverables') holds as many line items as the reviewer adds, so a plain
-- unique index on (review_id, pillar_id) would refuse its second line; the rule is a trigger that
-- knows the pillar's type instead. Two sign-offs of one review at once queue on the review's
-- advisory lock, so they cannot both pass the check. Rows already duplicated are left for the next
-- sign-off to tidy, which it does (ReviewPage keeps the first and removes the rest).
create or replace function public.guard_single_line_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.criterion_id is not null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.review_id = old.review_id
     and new.pillar_id = old.pillar_id
     and old.criterion_id is null then
    return new;
  end if;
  if not exists (
    select 1 from public.gsr_pillars p
     where p.id = new.pillar_id
       and p.scoring_type in ('deliverables_module', 'gsr_goals')
  ) then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('review_scores_line:' || new.review_id::text, 0));
  if exists (
    select 1 from public.review_scores s
     where s.review_id = new.review_id
       and s.pillar_id = new.pillar_id
       and s.criterion_id is null
       and s.id <> new.id
  ) then
    raise exception 'This review already has its figure for that pillar. Reload the page and try again.'
      using errcode = 'unique_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_single_line_item() from public, anon, authenticated;

drop trigger if exists review_scores_single_line_item on public.review_scores;
create trigger review_scores_single_line_item
  before insert or update of review_id, pillar_id, criterion_id on public.review_scores
  for each row execute function public.guard_single_line_item();

-- Reported, never deleted: any review that already holds more than one line item for a
-- single-figure pillar. Re-signing the review tidies it.
do $$
declare
  v_dupes text;
begin
  select string_agg(format('review %s, pillar %s (%s rows)', d.review_id, d.pillar_id, d.n), '; ')
    into v_dupes
    from (
      select s.review_id, s.pillar_id, count(*) as n
        from public.review_scores s
        join public.gsr_pillars p on p.id = s.pillar_id
       where s.criterion_id is null
         and p.scoring_type in ('deliverables_module', 'gsr_goals')
       group by s.review_id, s.pillar_id
      having count(*) > 1
    ) d;
  if v_dupes is not null then
    raise notice 'These reviews hold more than one figure for one pillar; reopen and re-sign them to tidy: %', v_dupes;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------
-- 4. Reviews: the cycle's company and the cycle's status
-- ---------------------------------------------------------------------------------------
-- For every writer, Rococo and the SQL editor included:
--   * a review's person belongs to its cycle's company, checked when the review is created and
--     when its person or cycle changes (a person who moved company keeps their old reviews,
--     which stay editable where they are);
--   * no review is started in a closed cycle (opening one that is already there still reads);
--   * no review moves into or out of a closed cycle, whatever else the same write changes, so a
--     closed month never loses or gains a review;
--   * a signed-off review is not reopened while its cycle is closed: once reopened it could not
--     be signed off again until the whole cycle is. Judged against the cycle it was signed off in,
--     so moving it to an open cycle in the same write does not get round it.
-- A cycle that does not exist is left to inherit_company_from_cycle's own message.
create or replace function public.guard_review_cycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cycle_company uuid;
  v_cycle_status  text;
  v_old_status    text;
begin
  if tg_op = 'UPDATE' then
    select c.status into v_old_status from public.review_cycles c where c.id = old.cycle_id;
    if v_old_status = 'closed' then
      if new.cycle_id is distinct from old.cycle_id then
        raise exception 'This review cycle is closed. Reopen the cycle first.'
          using errcode = 'check_violation';
      end if;
      if old.status = 'complete' and new.status is distinct from 'complete' then
        raise exception 'This review cycle is closed. Reopen the cycle first.'
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  select c.company_id, c.status into v_cycle_company, v_cycle_status
    from public.review_cycles c
   where c.id = new.cycle_id;
  if not found then
    return new;
  end if;

  if (tg_op = 'INSERT'
      or new.employee_id is distinct from old.employee_id
      or new.cycle_id is distinct from old.cycle_id)
     and (select p.company_id from public.profiles p where p.id = new.employee_id)
         is distinct from v_cycle_company then
    raise exception 'That person belongs to another company.'
      using errcode = 'check_violation';
  end if;

  if v_cycle_status = 'closed' then
    -- Opening a GSR is an insert that ignores a duplicate, then a read. When the review is
    -- already there the insert changes nothing, so a closed month still opens for reading; the
    -- unique key refuses a plain insert of the same pair on its own.
    if tg_op = 'INSERT'
       and exists (select 1 from public.reviews r
                    where r.cycle_id = new.cycle_id and r.employee_id = new.employee_id) then
      return new;
    end if;
    -- Leaving complete was judged above, against the cycle the review was signed off in.
    if tg_op = 'INSERT' or new.cycle_id is distinct from old.cycle_id then
      raise exception 'This review cycle is closed. Reopen the cycle first.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_review_cycle() from public, anon, authenticated;

drop trigger if exists reviews_guard_cycle on public.reviews;
create trigger reviews_guard_cycle
  before insert or update on public.reviews
  for each row execute function public.guard_review_cycle();

-- ---------------------------------------------------------------------------------------
-- 5. A task can be linked to a monthly goal
-- ---------------------------------------------------------------------------------------
alter table public.tasks add column if not exists goal_id uuid references public.goals (id) on delete set null;
create index if not exists tasks_goal_id_idx on public.tasks (goal_id);

-- ---------------------------------------------------------------------------------------
-- 6. Task and step policies
-- ---------------------------------------------------------------------------------------
-- Read through the assignee: the person, Rococo, a full-scope admin, and whoever sees the person;
-- an unassigned task is any admin's of the company. Write through the led set: the person (for
-- their own, with no campaign when they add it), Rococo, a full-scope admin, whoever leads the
-- assignee, and any admin for an unassigned task. A leader who is not an admin adds no campaign;
-- on an update the guard keeps the campaign for anyone but an admin. Delete: Rococo, a full-scope
-- admin, an admin over the people they manage (and unassigned tasks), a leader over a task they
-- made for someone they lead, and anyone over a task they made for themselves.
drop policy if exists "Admins and assignees read tasks" on public.tasks;
drop policy if exists "Admins and self create tasks" on public.tasks;
drop policy if exists "Admins and assignees update tasks" on public.tasks;
drop policy if exists "Admins and self delete tasks" on public.tasks;

drop policy if exists "The assignee and those who see them read tasks" on public.tasks;
create policy "The assignee and those who see them read tasks"
  on public.tasks for select to authenticated
  using (
    private.is_rococo_admin()
    or assignee_id = private.auth_profile_id()
    or (company_id = private.auth_company_id()
        and (private.has_full_scope()
             or assignee_id in (select private.viewable_person_ids())
             or (assignee_id is null and private.is_company_admin())))
  );

drop policy if exists "People add their own tasks, leaders for the people they lead" on public.tasks;
create policy "People add their own tasks, leaders for the people they lead"
  on public.tasks for insert to authenticated
  with check (
    private.is_rococo_admin()
    or (company_id = private.auth_company_id()
        and ((assignee_id = private.auth_profile_id() and campaign_id is null)
             or private.has_full_scope()
             or (assignee_id in (select private.led_person_ids())
                 and (campaign_id is null or private.is_company_admin()))
             or (assignee_id is null and private.is_company_admin())))
  );

drop policy if exists "The assignee and their leaders change tasks" on public.tasks;
create policy "The assignee and their leaders change tasks"
  on public.tasks for update to authenticated
  using (
    private.is_rococo_admin()
    or assignee_id = private.auth_profile_id()
    or (company_id = private.auth_company_id()
        and (private.has_full_scope()
             or assignee_id in (select private.led_person_ids())
             or (assignee_id is null and private.is_company_admin())))
  )
  with check (
    private.is_rococo_admin()
    or assignee_id = private.auth_profile_id()
    or (company_id = private.auth_company_id()
        and (private.has_full_scope()
             or assignee_id in (select private.led_person_ids())
             or (assignee_id is null and private.is_company_admin())))
  );

drop policy if exists "Admins, the assigner and the person remove tasks" on public.tasks;
create policy "Admins, the assigner and the person remove tasks"
  on public.tasks for delete to authenticated
  using (
    private.is_rococo_admin()
    or (created_by = private.auth_profile_id() and assignee_id = private.auth_profile_id())
    or (company_id = private.auth_company_id()
        and (private.has_full_scope()
             or assignee_id in (select private.manageable_person_ids())
             or (assignee_id is null and private.is_company_admin())
             or (created_by = private.auth_profile_id()
                 and assignee_id in (select private.led_person_ids()))))
  );

-- A step is read with its task and written by whoever may change its task (never through a
-- division view alone). The task row already exists, so the id sets judge it.
drop policy if exists "Task viewers read steps" on public.task_steps;
drop policy if exists "Task viewers create steps" on public.task_steps;
drop policy if exists "Task viewers update steps" on public.task_steps;
drop policy if exists "Task viewers delete steps" on public.task_steps;

drop policy if exists "Steps are read with their task" on public.task_steps;
create policy "Steps are read with their task"
  on public.task_steps for select to authenticated
  using (exists (
    select 1 from public.tasks t
     where t.id = task_steps.task_id
       and (private.is_rococo_admin()
            or t.assignee_id = private.auth_profile_id()
            or (t.company_id = private.auth_company_id()
                and (private.has_full_scope()
                     or t.assignee_id in (select private.viewable_person_ids())
                     or (t.assignee_id is null and private.is_company_admin()))))
  ));

do $$
declare
  v_cmd text;
  v_name text;
  v_write constant text := $w$exists (
    select 1 from public.tasks t
     where t.id = task_steps.task_id
       and (private.is_rococo_admin()
            or t.assignee_id = private.auth_profile_id()
            or (t.company_id = private.auth_company_id()
                and (private.has_full_scope()
                     or t.assignee_id in (select private.led_person_ids())
                     or (t.assignee_id is null and private.is_company_admin()))))
  )$w$;
begin
  foreach v_cmd in array array['insert', 'update', 'delete'] loop
    v_name := case v_cmd
      when 'insert' then 'Steps are added by whoever may change the task'
      when 'update' then 'Steps are changed by whoever may change the task'
      else 'Steps are removed by whoever may change the task'
    end;
    execute format('drop policy if exists %I on public.task_steps', v_name);
    execute format(
      'create policy %I on public.task_steps for %s to authenticated %s',
      v_name, v_cmd,
      case v_cmd
        when 'insert' then format('with check (%s)', v_write)
        when 'update' then format('using (%s) with check (%s)', v_write, v_write)
        else format('using (%s)', v_write)
      end
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------
-- 7. The task guard
-- ---------------------------------------------------------------------------------------
-- The 0036 body with these additions:
--   * a leader branch: a caller who is not an admin but leads both the old and the new assignee
--     (or takes the task over themselves) edits like an admin, except the campaign, which stays
--     an admin's; a person who made a task for themselves may hand it to someone they lead;
--   * goal_id joins what a plain assignee may change, beside completed_at, so a person links
--     their own tasks to their own goals;
--   * the goal link. When goal_id is set and either it or the assignee changes, the goal must
--     exist, be a monthly goal (scope 'cycle') of the task's company, and be the assignee's.
--     Linking (goal_id becoming a new goal) is refused in a closed, complete or omitted month;
--     unlinking always passes. A linked task changes hands only in the write that unlinks it.
--     When the old goal or the old assignee no longer exists (a delete clearing its foreign
--     keys) the link clears with it, and the rule triggers (hub.task_internal) pass untouched.
create or replace function public.guard_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_internal  boolean := coalesce(current_setting('hub.task_internal', true), '') = '1';
  v_checks    boolean := not v_internal and auth.uid() is not null;
  v_me        uuid := private.auth_profile_id();
  v_leads_old boolean;
  v_leads_new boolean;
  v_goal      record;
begin
  if not v_internal then
    if tg_op = 'INSERT' then
      new.created_by := coalesce(v_me, new.created_by);
    else
      new.company_id := old.company_id;
      new.created_by := case
        when exists (select 1 from public.profiles where id = old.created_by) then old.created_by
      end;
    end if;

    -- Who completed it follows completed_at: the person who set it, and nobody once it clears.
    if new.completed_at is null then
      new.completed_by := null;
    elsif tg_op = 'INSERT' or old.completed_at is null then
      new.completed_by := coalesce(v_me, new.completed_by);
    elsif v_checks then
      new.completed_by := case
        when exists (select 1 from public.profiles where id = old.completed_by) then old.completed_by
      end;
    end if;
  end if;

  if tg_op = 'UPDATE' and old.next_task_id is not null
     and old.completed_at is not null and new.completed_at is null then
    raise exception 'The next one is already open.';
  end if;

  if new.assignee_id is not null
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
     and (select company_id from public.profiles where id = new.assignee_id)
         is distinct from new.company_id then
    raise exception 'That person belongs to another company.';
  end if;

  if new.campaign_id is not null
     and (tg_op = 'INSERT' or new.campaign_id is distinct from old.campaign_id)
     and (select company_id from public.marketing_campaigns where id = new.campaign_id)
         is distinct from new.company_id then
    raise exception 'That campaign belongs to another company.';
  end if;

  if v_checks then
    if tg_op = 'INSERT' then
      new.next_task_id := null;
      new.notified_assignee_id := null;
    else
      new.next_task_id := old.next_task_id;
      new.notified_assignee_id := case
        when exists (select 1 from public.profiles where id = old.notified_assignee_id)
          then old.notified_assignee_id
      end;

      if not private.can_manage_company(old.company_id) then
        v_leads_old := old.assignee_id is not null
          and exists (select 1 from private.led_person_ids() l (id) where l.id = old.assignee_id);
        v_leads_new := new.assignee_id is not null
          and (new.assignee_id = v_me
               or exists (select 1 from private.led_person_ids() l (id) where l.id = new.assignee_id));
        if v_leads_old and v_leads_new then
          if new.campaign_id is distinct from old.campaign_id then
            raise exception 'Only an admin can change a task''s campaign.';
          end if;
        elsif old.created_by = v_me and old.assignee_id = v_me then
          if new.campaign_id is distinct from old.campaign_id
             or (new.assignee_id is distinct from old.assignee_id
                 and not (new.assignee_id is not null
                          and exists (select 1 from private.led_person_ids() l (id)
                                       where l.id = new.assignee_id))) then
            raise exception 'Only the person who assigned this task can change it.';
          end if;
        elsif (new.id, new.title, new.description, new.assignee_id, new.due_date, new.priority,
               new.recurrence, new.campaign_id, new.created_at)
              is distinct from
              (old.id, old.title, old.description, old.assignee_id, old.due_date, old.priority,
               old.recurrence, old.campaign_id, old.created_at) then
          raise exception 'Only the person who assigned this task can change it.';
        end if;
      end if;
    end if;
  end if;

  -- The goal link.
  if not v_internal then
    if tg_op = 'UPDATE' and old.goal_id is not null
       and new.goal_id is not distinct from old.goal_id
       and (not exists (select 1 from public.goals g where g.id = old.goal_id)
            or (old.assignee_id is not null
                and not exists (select 1 from public.profiles p where p.id = old.assignee_id))) then
      new.goal_id := null;
    end if;

    if new.goal_id is not null
       and (tg_op = 'INSERT'
            or new.goal_id is distinct from old.goal_id
            or new.assignee_id is distinct from old.assignee_id) then
      select g.company_id, g.employee_id, g.scope, g.cycle_id into v_goal
        from public.goals g
       where g.id = new.goal_id;
      if not found then
        raise exception 'That goal is not here any more.'
          using errcode = 'check_violation';
      end if;
      if v_goal.company_id is distinct from new.company_id then
        raise exception 'That goal belongs to another company.'
          using errcode = 'check_violation';
      end if;
      if v_goal.scope <> 'cycle' or v_goal.cycle_id is null then
        raise exception 'Only a monthly GSR goal can have tasks.'
          using errcode = 'check_violation';
      end if;
      if v_goal.employee_id is distinct from new.assignee_id then
        raise exception 'A task on a goal belongs to that goal''s person. Unlink it before assigning it to someone else.'
          using errcode = 'check_violation';
      end if;
      if (tg_op = 'INSERT' or new.goal_id is distinct from old.goal_id)
         and (exists (select 1 from public.review_cycles c
                       where c.id = v_goal.cycle_id and c.status = 'closed')
              or exists (select 1 from public.reviews r
                          where r.cycle_id = v_goal.cycle_id
                            and r.employee_id = v_goal.employee_id
                            and r.status = 'complete')
              or exists (select 1 from public.cycle_omissions o
                          where o.cycle_id = v_goal.cycle_id
                            and o.employee_id = v_goal.employee_id)) then
        raise exception 'That month is closed, so its goals take no new tasks.'
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  -- The next copy of this series is gone: the series ends here.
  if tg_op = 'UPDATE' and old.next_task_id is not null
     and not exists (select 1 from public.tasks where id = old.next_task_id) then
    new.next_task_id := null;
    new.recurrence := null;
  end if;

  return new;
end;
$$;
revoke execute on function public.guard_task() from public, anon, authenticated;

drop trigger if exists tasks_guard on public.tasks;
create trigger tasks_guard
  before insert or update on public.tasks
  for each row execute function public.guard_task();

-- The 0036 body with a leader branch: whoever leads a task's assignee changes its steps as an
-- admin would. Anyone else who did not make the task for themselves only ticks and unticks.
create or replace function public.guard_task_step()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_internal boolean := coalesce(current_setting('hub.task_internal', true), '') = '1';
  v_task     public.tasks%rowtype;
  v_me       uuid;
begin
  if tg_op = 'INSERT' then
    select company_id into new.company_id from public.tasks where id = new.task_id;
    if new.company_id is null then
      raise exception 'That task does not exist.';
    end if;
  elsif tg_op = 'UPDATE' then
    new.task_id := old.task_id;
    new.company_id := old.company_id;
  end if;

  if not v_internal and auth.uid() is not null then
    select * into v_task from public.tasks
     where id = case when tg_op = 'DELETE' then old.task_id else new.task_id end;

    if v_task.id is not null
       and (tg_op <> 'DELETE' or exists (select 1 from public.companies where id = v_task.company_id)) then
      if v_task.next_task_id is not null then
        raise exception 'The next one is already open.';
      end if;

      v_me := private.auth_profile_id();
      if not private.can_manage_company(v_task.company_id)
         and not (v_task.created_by = v_me and v_task.assignee_id = v_me)
         and not (v_task.assignee_id is not null
                  and exists (select 1 from private.led_person_ids() l (id) where l.id = v_task.assignee_id)) then
        if tg_op <> 'UPDATE'
           or (new.id, new.title, new.sort_order) is distinct from (old.id, old.title, old.sort_order) then
          raise exception 'Only the person who assigned this task can change its steps.';
        end if;
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_task_step() from public, anon, authenticated;

drop trigger if exists task_steps_guard on public.task_steps;
create trigger task_steps_guard
  before insert or update or delete on public.task_steps
  for each row execute function public.guard_task_step();

-- The 0036 body, clearing the goal link with the assignee: the goal is the person's, and the
-- person has gone to another company.
create or replace function public.clear_task_assignee_on_move()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev text := current_setting('hub.task_internal', true);
begin
  perform set_config('hub.task_internal', '1', true);
  update public.tasks
     set assignee_id = null,
         goal_id = null
   where assignee_id = new.id
     and company_id is distinct from new.company_id;
  perform set_config('hub.task_internal', coalesce(v_prev, ''), true);
  return null;
end;
$$;
revoke execute on function public.clear_task_assignee_on_move() from public, anon, authenticated;

drop trigger if exists profiles_move_clears_task_assignee on public.profiles;
create trigger profiles_move_clears_task_assignee
  after update of company_id on public.profiles
  for each row
  when (old.company_id is distinct from new.company_id)
  execute function public.clear_task_assignee_on_move();

-- ---------------------------------------------------------------------------------------
-- 8. Nothing left behind
-- ---------------------------------------------------------------------------------------
-- Pasting 0036 again brings back its four company-wide policies on each table; this paste drops
-- them by name above. Any policy on tasks or task_steps that still calls can_manage_company or
-- is_company_member is a leftover, and the paste stops here.
do $$
declare
  v_left text;
begin
  select string_agg(format('%s on %s', policyname, tablename), '; ' order by tablename, policyname)
    into v_left
    from pg_policies
   where schemaname = 'public'
     and tablename in ('tasks', 'task_steps')
     and (coalesce(qual, '') ~ '(can_manage_company|is_company_member)\('
          or coalesce(with_check, '') ~ '(can_manage_company|is_company_member)\(');
  if v_left is not null then
    raise exception 'These policies still reach a whole company: %', v_left;
  end if;
end $$;
