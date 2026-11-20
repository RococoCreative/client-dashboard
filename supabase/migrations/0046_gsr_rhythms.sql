-- 0046_gsr_rhythms.sql
-- A Goal Setting Review runs at each person's own rhythm: every week, every two weeks, every
-- month or every quarter. Until now "monthly" meant two things, the rhythm and what made a cycle
-- a GSR, so a weekly GSR could not exist and a quarterly cycle always read as a scored review. This
-- migration separates the two, as docs/superpowers/specs/2026-11-18-gsr-rhythms-design.md sets
-- out (its Model, Opening a period, Locking and "Everywhere monthly meant GSR" sections).
--
-- What changes:
--   1. review_cycles.kind is 'gsr' or 'review' and decides what a cycle is; cadence is only the
--      rhythm. The backfill runs once, when the column is created: every monthly cycle is a GSR,
--      everything else a review. A row written without a kind takes it from its cadence the same
--      way (weekly, every two weeks and monthly are GSRs; quarterly, annual and custom are
--      reviews), so the app as deployed today keeps creating the cycles it always has.
--   2. cadence gains weekly and biweekly. A GSR runs weekly, biweekly, monthly or quarterly; a
--      review runs quarterly, annual or custom. One cycle per company, kind, cadence and period,
--      so a quarterly GSR and a quarterly review can share dates.
--   3. GSR periods are canonical, so a period has exactly one row per company: weekly is Monday to
--      Sunday, biweekly the two-week blocks of Mondays counted from Monday 2024-01-01, monthly the
--      calendar month, quarterly the calendar quarter. A trigger refuses any other dates, judged
--      when a cycle is created or its dates, cadence or kind change, so a cycle already live keeps
--      working. A cycle's kind is set when it is made.
--   4. A GSR period opens itself: any member may add the open GSR cycle for a canonical period of
--      their own company, which the trigger names, as an insert that ignores a duplicate. Admins
--      still create every cycle by hand as before. Changing, closing and removing cycles stays
--      with full-scope admins (0038).
--   5. profiles.gsr_cadence is the person's rhythm, monthly unless set. Admins set it for the
--      people they manage (their usual path); managers set it, and only it, for the people they
--      lead. Nobody sets their own. It joins the audited columns.
--   6. A person's review in a GSR cycle is opened only when the cycle runs at the person's rhythm,
--      whoever opens it (the person, a leader or an admin). A review that is already there opens
--      for reading whatever the person's rhythm has become.
--   7. Everywhere "monthly" meant "GSR" now reads kind = 'gsr': the employee and leader review
--      insert policies (0020, 0038), the freeze in guard_goal_frozen and guard_goal_note_frozen
--      (0039), and the task link, which takes only a GSR goal.
--   8. Leaders lock and reopen the GSRs of the people they lead: on a GSR review they change
--      status, completed_at, gsr_score and reviewer_id and nothing else. Scored reviews, ratings,
--      feedback and everything else stay with admins. Every 0039 rule (closed cycles, the freeze,
--      the omitted person, signed-off reviews) still applies.
--
-- Rebuilt functions are copied from their latest bodies (guard_profile_fields from 0038,
-- guard_review_employee_fields from 0035, guard_goal_frozen, guard_goal_note_frozen and guard_task
-- from 0039) with only the lines this migration names added. The two review insert policies keep
-- their names. The error messages people already see stay word for word.
--
-- Paste after 0045. It was written as 0040 and renumbered when 0040 to 0045 went live first;
-- none of those touches a table column, function, trigger or policy this migration rebuilds, so
-- the latest bodies named above are still the latest. The app that reads kind and gsr_cadence
-- deploys after it; the app live today keeps working against it, since every person stays monthly
-- until someone changes a rhythm. Idempotent.

-- ---------------------------------------------------------------------------------------
-- 1. review_cycles.kind, and the one-shot backfill
-- ---------------------------------------------------------------------------------------
-- Tested before add column: the backfill belongs to the paste that creates the column and to no
-- later one. It is not an edit anybody made, so updated_at and the triggers stay out of it.
-- backfill:start
do $$
declare
  v_new_kind boolean := not exists (
    select 1 from pg_attribute
     where attrelid = 'public.review_cycles'::regclass and attname = 'kind' and not attisdropped
  );
begin
  alter table public.review_cycles add column if not exists kind text;
  if v_new_kind then
    alter table public.review_cycles disable trigger user;
    update public.review_cycles
       set kind = case when cadence = 'monthly' then 'gsr' else 'review' end;
    alter table public.review_cycles enable trigger user;
  end if;
end $$;
-- backfill:end

alter table public.review_cycles alter column kind set not null;

alter table public.review_cycles drop constraint if exists review_cycles_cadence_check;
alter table public.review_cycles add constraint review_cycles_cadence_check
  check (cadence in ('weekly', 'biweekly', 'monthly', 'quarterly', 'annual', 'custom'));

alter table public.review_cycles drop constraint if exists review_cycles_kind_check;
alter table public.review_cycles add constraint review_cycles_kind_check
  check (kind in ('gsr', 'review'));

-- Every live row passes after the backfill (monthly became a GSR; quarterly, annual and custom
-- are reviews). Should anything not, the paste stops here and names it rather than leaving a
-- bare constraint error.
do $$
declare
  v_bad text;
begin
  select string_agg(format('%s (%s, %s)', c.name, c.kind, c.cadence), '; ' order by c.period_start)
    into v_bad
    from public.review_cycles c
   where not ((c.kind = 'gsr' and c.cadence in ('weekly', 'biweekly', 'monthly', 'quarterly'))
              or (c.kind = 'review' and c.cadence in ('quarterly', 'annual', 'custom')));
  if v_bad is not null then
    raise exception 'These cycles have a cadence their kind does not run at: %', v_bad;
  end if;
end $$;

alter table public.review_cycles drop constraint if exists review_cycles_kind_cadence_check;
alter table public.review_cycles add constraint review_cycles_kind_cadence_check
  check ((kind = 'gsr' and cadence in ('weekly', 'biweekly', 'monthly', 'quarterly'))
         or (kind = 'review' and cadence in ('quarterly', 'annual', 'custom')));

-- One cycle per company, kind, cadence and period. 0029's key had no kind, so a quarterly GSR and
-- a quarterly review could not share a quarter. Pasting 0029 again brings its key back; this
-- drops it again. The new key is looser, so no live row can break it. A member's open is an
-- insert that ignores a duplicate on exactly these columns.
drop index if exists public.review_cycles_period_key;
create unique index if not exists review_cycles_kind_period_key
  on public.review_cycles (company_id, kind, cadence, period_start, period_end);

-- ---------------------------------------------------------------------------------------
-- 2. Canonical GSR periods
-- ---------------------------------------------------------------------------------------
-- Whether the dates are a canonical period of a GSR cadence. Pure date arithmetic, cast to
-- timestamp without time zone, so the answer never depends on the session's time zone.
create or replace function private.gsr_period_ok(p_cadence text, p_start date, p_end date)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(case p_cadence
    when 'weekly' then
      extract(isodow from p_start) = 1 and p_end = p_start + 6
    when 'biweekly' then
      extract(isodow from p_start) = 1
      and (p_start - date '2024-01-01') % 14 = 0
      and p_end = p_start + 13
    when 'monthly' then
      p_start = date_trunc('month', p_start::timestamp)::date
      and p_end = (date_trunc('month', p_start::timestamp) + interval '1 month' - interval '1 day')::date
    when 'quarterly' then
      p_start = date_trunc('quarter', p_start::timestamp)::date
      and p_end = (date_trunc('quarter', p_start::timestamp) + interval '3 months' - interval '1 day')::date
    else false
  end, false)
$$;
revoke all on function private.gsr_period_ok(text, date, date) from public, anon;
grant execute on function private.gsr_period_ok(text, date, date) to authenticated, service_role;

-- The name a GSR period opened by a member carries: "November 2026", "Q4 2026", and for a week
-- or two weeks the dates, "Nov 16 to Nov 22, 2026" (both years when it crosses one, "Dec 28, 2026
-- to Jan 3, 2027"). Monthly and quarterly match the New Cycle form's defaults.
create or replace function private.gsr_period_name(p_cadence text, p_start date, p_end date)
returns text
language sql
stable
set search_path = ''
as $$
  select case p_cadence
    when 'monthly' then to_char(p_start::timestamp, 'FMMonth YYYY')
    when 'quarterly' then to_char(p_start::timestamp, '"Q"Q YYYY')
    else case
      when extract(year from p_start) = extract(year from p_end)
        then to_char(p_start::timestamp, 'Mon FMDD') || ' to ' || to_char(p_end::timestamp, 'Mon FMDD, YYYY')
      else to_char(p_start::timestamp, 'Mon FMDD, YYYY') || ' to ' || to_char(p_end::timestamp, 'Mon FMDD, YYYY')
    end
  end
$$;
revoke all on function private.gsr_period_name(text, date, date) from public, anon;
grant execute on function private.gsr_period_name(text, date, date) to authenticated, service_role;

-- On review_cycles, for every writer:
--   * a row with no kind takes it from its cadence;
--   * a signed-in caller never changes a cycle's kind once it is made (its reviews and goals were
--     written under it);
--   * a GSR runs only at a GSR cadence and a review only at a review cadence, said plainly before
--     the check constraint would say it in its own words;
--   * a GSR cycle's dates are a canonical period of its cadence, judged when the cycle is made or
--     its kind, cadence or dates change;
--   * a cycle added by someone who is not an admin of its company (a member opening a period) is
--     named by the database and filed under its maker, so a period opened by anyone reads the same.
create or replace function public.guard_review_cycle_period()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind is null then
    new.kind := case when new.cadence in ('weekly', 'biweekly', 'monthly') then 'gsr' else 'review' end;
  end if;

  if tg_op = 'UPDATE'
     and new.kind is distinct from old.kind
     and (select auth.uid()) is not null then
    raise exception 'A cycle''s kind is set when it is made. Start a new cycle instead.'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT'
     or new.kind is distinct from old.kind
     or new.cadence is distinct from old.cadence
     or new.period_start is distinct from old.period_start
     or new.period_end is distinct from old.period_end then
    if new.kind = 'gsr' and new.cadence not in ('weekly', 'biweekly', 'monthly', 'quarterly') then
      raise exception 'A GSR runs weekly, every two weeks, monthly or quarterly.'
        using errcode = 'check_violation';
    end if;
    if new.kind = 'review' and new.cadence not in ('quarterly', 'annual', 'custom') then
      raise exception 'A scored review runs quarterly, yearly or on dates you choose.'
        using errcode = 'check_violation';
    end if;
    if new.kind = 'gsr' and not private.gsr_period_ok(new.cadence, new.period_start, new.period_end) then
      raise exception '%', case new.cadence
        when 'weekly' then 'A weekly GSR runs from a Monday to the Sunday after it.'
        when 'biweekly' then 'A GSR every two weeks runs from a Monday to the second Sunday after it, on the shared two-week calendar that started Monday, January 1, 2024.'
        when 'monthly' then 'A monthly GSR runs from the first to the last day of one month.'
        else 'A quarterly GSR runs for one calendar quarter, from its first day to its last.'
      end
        using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'INSERT'
     and (select auth.uid()) is not null
     and not private.can_manage_company(new.company_id) then
    new.name := private.gsr_period_name(new.cadence, new.period_start, new.period_end);
    new.created_by := (select auth.uid());
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_review_cycle_period() from public, anon, authenticated;

drop trigger if exists review_cycles_guard_period on public.review_cycles;
create trigger review_cycles_guard_period
  before insert or update on public.review_cycles
  for each row execute function public.guard_review_cycle_period();

-- Reported, never changed: GSR cycles already live whose dates are not a canonical period. They
-- keep working; only a change to their dates, cadence or kind is judged.
do $$
declare
  v_odd text;
begin
  select string_agg(format('%s (%s, %s to %s)', c.name, c.cadence, c.period_start, c.period_end), '; '
                    order by c.period_start)
    into v_odd
    from public.review_cycles c
   where c.kind = 'gsr'
     and not private.gsr_period_ok(c.cadence, c.period_start, c.period_end);
  if v_odd is not null then
    raise notice 'These GSR cycles are not a whole period of their cadence; they keep working as they are: %', v_odd;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------
-- 3. A GSR period opens itself
-- ---------------------------------------------------------------------------------------
-- Beside 0010's "Admins create cycles": any member adds the open GSR cycle for a period of their
-- own company, with no theme (a focus is an admin's to set). The trigger above names it and keeps
-- its dates canonical; the unique key turns a second open of the same period into nothing.
drop policy if exists "Members open a GSR period" on public.review_cycles;
create policy "Members open a GSR period"
  on public.review_cycles for insert to authenticated
  with check (
    company_id is not null
    and company_id = private.auth_company_id()
    and kind = 'gsr'
    and status = 'open'
    and theme is null
    and theme_description is null
  );

-- ---------------------------------------------------------------------------------------
-- 4. profiles.gsr_cadence
-- ---------------------------------------------------------------------------------------
-- Adding a column with a default writes no row through the triggers.
alter table public.profiles add column if not exists gsr_cadence text not null default 'monthly';

alter table public.profiles drop constraint if exists profiles_gsr_cadence_check;
alter table public.profiles add constraint profiles_gsr_cadence_check
  check (gsr_cadence in ('weekly', 'biweekly', 'monthly', 'quarterly'));

-- Whose rhythm is what, read past RLS for the review guard below.
create or replace function private.person_gsr_cadence(p_person uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.gsr_cadence from public.profiles p where p.id = p_person
$$;
revoke all on function private.person_gsr_cadence(uuid) from public, anon;
grant execute on function private.person_gsr_cadence(uuid) to authenticated, service_role;

-- A leader changes a led person's row through this policy, and the guard keeps it to the rhythm.
-- The admin path (0038) is unchanged and already carries the column. A person's own row reaches
-- the 0038 self branch, whose list (name, title, phone) leaves the rhythm out.
drop policy if exists "Leaders set the GSR rhythm of the people they lead" on public.profiles;
create policy "Leaders set the GSR rhythm of the people they lead"
  on public.profiles for update to authenticated
  using (
    company_id is not null
    and company_id = private.auth_company_id()
    and id in (select private.led_person_ids())
  )
  with check (
    company_id is not null
    and company_id = private.auth_company_id()
  );

-- ---------------------------------------------------------------------------------------
-- 5. Reviews: who opens a GSR, and at what rhythm
-- ---------------------------------------------------------------------------------------
-- 0020's policy and 0038's leader policy, by their own names, with the monthly test replaced by
-- the kind. Everything else in each is as it was.
drop policy if exists "Employees open their own monthly GSR" on public.reviews;
create policy "Employees open their own monthly GSR"
  on public.reviews for insert to authenticated
  with check (
    employee_id = private.auth_profile_id()
    and company_id = private.auth_company_id()
    and status = 'not_started'
    and previous_status is null
    and manager_feedback is null
    and peer_feedback is null
    and client_feedback is null
    and reviewer_id is null
    and completed_at is null
    and exists (
      select 1 from public.review_cycles c
      where c.id = cycle_id
        and c.company_id = private.auth_company_id()
        and c.kind = 'gsr'
        and c.status = 'open'
    )
  );

drop policy if exists "Leaders open a monthly GSR for the people they lead" on public.reviews;
create policy "Leaders open a monthly GSR for the people they lead"
  on public.reviews for insert to authenticated
  with check (
    company_id = private.auth_company_id()
    and employee_id in (select private.led_person_ids())
    and status = 'not_started'
    and previous_status is null
    and manager_feedback is null
    and peer_feedback is null
    and client_feedback is null
    and employee_reflection is null
    and support_discussion is null
    and reviewer_id is null
    and completed_at is null
    and gsr_score is null
    and exists (
      select 1 from public.review_cycles c
       where c.id = cycle_id
         and c.company_id = private.auth_company_id()
         and c.kind = 'gsr'
         and c.status = 'open'
    )
  );

-- A GSR review belongs to the people whose rhythm is its cycle's cadence. Checked for every
-- signed-in writer (the person, a leader, an admin, Rococo) when a review is created or moves to
-- another cycle or person, in a trigger rather than the insert policies so that it can let one
-- case through: opening a GSR is an insert that ignores a duplicate, then a read, and a review
-- already there opens whatever its person's rhythm has since become. The SQL editor is not judged.
create or replace function public.guard_review_rhythm()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cycle  record;
  v_rhythm text;
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.cycle_id is not distinct from old.cycle_id
     and new.employee_id is not distinct from old.employee_id then
    return new;
  end if;
  select c.kind, c.cadence into v_cycle from public.review_cycles c where c.id = new.cycle_id;
  if not found or v_cycle.kind <> 'gsr' then
    return new;
  end if;
  if tg_op = 'INSERT'
     and exists (select 1 from public.reviews r
                  where r.cycle_id = new.cycle_id and r.employee_id = new.employee_id) then
    return new;
  end if;
  v_rhythm := private.person_gsr_cadence(new.employee_id);
  if v_rhythm is distinct from v_cycle.cadence then
    raise exception 'This person''s GSRs run %, so this % GSR is not theirs. Change their GSR rhythm first.',
      case v_rhythm
        when 'weekly' then 'every week'
        when 'biweekly' then 'every two weeks'
        when 'monthly' then 'every month'
        when 'quarterly' then 'every quarter'
        else 'at no set rhythm'
      end,
      case v_cycle.cadence
        when 'weekly' then 'weekly'
        when 'biweekly' then 'two-week'
        when 'monthly' then 'monthly'
        else 'quarterly'
      end
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_review_rhythm() from public, anon, authenticated;

drop trigger if exists reviews_guard_rhythm on public.reviews;
create trigger reviews_guard_rhythm
  before insert or update on public.reviews
  for each row execute function public.guard_review_rhythm();

-- ---------------------------------------------------------------------------------------
-- 6. Leaders lock and reopen a GSR
-- ---------------------------------------------------------------------------------------
-- Beside 0038's update policy: whoever leads a person updates that person's reviews in GSR cycles,
-- and the guard below keeps it to locking and reopening. A scored review (kind 'review') is not
-- reached by this policy at all.
drop policy if exists "Leaders lock and reopen a GSR for the people they lead" on public.reviews;
create policy "Leaders lock and reopen a GSR for the people they lead"
  on public.reviews for update to authenticated
  using (
    company_id = private.auth_company_id()
    and employee_id in (select private.led_person_ids())
    and exists (select 1 from public.review_cycles c where c.id = cycle_id and c.kind = 'gsr')
  )
  with check (
    company_id = private.auth_company_id()
    and employee_id in (select private.led_person_ids())
    and exists (select 1 from public.review_cycles c where c.id = cycle_id and c.kind = 'gsr')
  );

-- The 0035 body with a leader branch. A company admin passes as before. A leader of the review's
-- person, on a GSR review, may change status, completed_at, gsr_score and reviewer_id: lock and
-- reopen, nothing in the person's voice and nothing an admin judges. The person themselves may
-- change their reflection and the opening discussion, as before. updated_at moves with any write
-- and the pillar snapshot is the snapshot trigger's to keep. Anything else is an admin's,
-- including any column a later migration adds. The person's message is 0023's.
--
-- BEFORE triggers on reviews fire in name order: reviews_guard_cycle, reviews_guard_employee_fields
-- (this one), reviews_guard_omitted, reviews_guard_rhythm, reviews_guard_signed_off,
-- reviews_inherit_company, reviews_release_gsr_score, reviews_set_updated_at,
-- reviews_snapshot_pillars. So a closed cycle, an omitted person and a signed-off review are judged
-- for a leader's lock exactly as for an admin's, and a reopen still releases the score. Locking
-- fires reviews_freeze_ratings after the write, a security definer function, as for an admin.
create or replace function public.guard_review_employee_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_probe public.reviews%rowtype;
  v_me    uuid;
begin
  if private.can_manage_company(old.company_id) then
    return new;
  end if;
  v_probe := new;
  v_probe.updated_at := old.updated_at;
  v_probe.pillar_snapshot := old.pillar_snapshot;
  v_me := private.auth_profile_id();

  if v_me is not null
     and v_me is distinct from old.employee_id
     and exists (select 1 from private.led_person_ids() as l (id) where l.id = old.employee_id)
     and exists (select 1 from public.review_cycles c where c.id = old.cycle_id and c.kind = 'gsr') then
    v_probe.status := old.status;
    v_probe.completed_at := old.completed_at;
    v_probe.gsr_score := old.gsr_score;
    v_probe.reviewer_id := old.reviewer_id;
    if v_probe is distinct from old then
      raise exception 'A manager can lock and reopen a GSR, and nothing else on it.';
    end if;
    return new;
  end if;

  if v_me is null or v_me = old.employee_id then
    v_probe.employee_reflection := old.employee_reflection;
    v_probe.support_discussion := old.support_discussion;
  end if;
  if v_probe is distinct from old then
    raise exception 'Only admins can edit review scores, status, and feedback.';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_review_employee_fields() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 7. A complete GSR is frozen, whatever its rhythm
-- ---------------------------------------------------------------------------------------
-- The 0039 bodies with one change each: the freeze reads kind = 'gsr' where it read cadence =
-- 'monthly'. Any other cycle freezes on a locked score only, as before. The messages stay word
-- for word, so the screens that recognise them keep doing so.
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
      and (r.gsr_score is not null or c.kind = 'gsr')
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
       and (r.gsr_score is not null or c.kind = 'gsr')
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
-- 8. A task links only to a GSR goal
-- ---------------------------------------------------------------------------------------
-- The 0039 body with one change: the goal a task links to must sit in a GSR cycle (kind 'gsr'),
-- where it had only to be a cycle goal, so the link freeze (a complete review in the goal's cycle)
-- is the GSR freeze of section 7. A link already made is left alone; the rule is judged when the
-- goal or the assignee changes, as before. The message stays word for word.
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
      select g.company_id, g.employee_id, g.scope, g.cycle_id, c.kind into v_goal
        from public.goals g
        left join public.review_cycles c on c.id = g.cycle_id
       where g.id = new.goal_id;
      if not found then
        raise exception 'That goal is not here any more.'
          using errcode = 'check_violation';
      end if;
      if v_goal.company_id is distinct from new.company_id then
        raise exception 'That goal belongs to another company.'
          using errcode = 'check_violation';
      end if;
      if v_goal.scope <> 'cycle' or v_goal.cycle_id is null or v_goal.kind is distinct from 'gsr' then
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

-- ---------------------------------------------------------------------------------------
-- 9. The profile guard
-- ---------------------------------------------------------------------------------------
-- The 0038 body with one branch added before the person's own: a caller who leads this person
-- (private.led_person_ids) and is not an admin of their company changes only gsr_cadence, compared
-- over the whole row, so any other column, and any column added later, stays an admin's. An admin
-- reaches the company-admin branch first and sets the rhythm there like any employment detail. The
-- person's own branch still lists only name, title and phone, so nobody sets their own rhythm
-- there.
create or replace function public.guard_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_probe     public.profiles%rowtype;
  v_cleared   boolean := false;
  v_cleanup   boolean := coalesce(current_setting('hub.division_cleanup', true), '') = '1';
  v_full      boolean;
  v_view_ids  uuid[];
  v_changed   uuid[];
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
  if new.division_id is null
     and old.division_id is not null
     and not exists (select 1 from public.company_divisions d where d.id = old.division_id) then
    v_probe.division_id := old.division_id;
    v_cleared := true;
  end if;
  if v_cleanup then
    if new.division_ids is distinct from old.division_ids
       and new.division_ids <@ old.division_ids
       and not exists (
         select 1 from public.company_divisions d
          where d.id = any (old.division_ids) and not (d.id = any (new.division_ids))
       ) then
      v_probe.division_ids := old.division_ids;
      v_probe.division_id := old.division_id;
      v_cleared := true;
    end if;
    if new.view_division_ids is distinct from old.view_division_ids
       and new.view_division_ids <@ old.view_division_ids
       and not exists (
         select 1 from public.company_divisions d
          where d.id = any (old.view_division_ids) and not (d.id = any (new.view_division_ids))
       ) then
      v_probe.view_division_ids := old.view_division_ids;
      v_cleared := true;
    end if;
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
    v_full := private.has_full_scope();
    if not v_full
       and not exists (select 1 from private.manageable_person_ids() as m (id) where m.id = old.id) then
      raise exception 'You can only edit people in the divisions you can see.';
    end if;
    if old.user_id = (select auth.uid())
       and (new.role is distinct from old.role or new.is_active is distinct from old.is_active) then
      raise exception 'You cannot change your own role or deactivate your own account.';
    end if;
    if new.role is distinct from old.role then
      if new.role = 'owner' and not private.is_company_owner() then
        raise exception 'Only an owner or Rococo can make someone an owner.';
      end if;
      if private.role_rank(new.role) > private.auth_role_rank() then
        raise exception 'You cannot grant a role above your own.';
      end if;
    end if;
    if (new.role is distinct from old.role or new.is_active is distinct from old.is_active)
       and private.role_rank(old.role) > private.auth_role_rank() then
      raise exception 'You cannot change the role or access of someone ranked above you.';
    end if;
    if new.can_view_divisions is distinct from old.can_view_divisions
       and not private.is_company_owner() then
      raise exception 'Only an owner or Rococo can choose who sees the divisions.';
    end if;
    if (new.view_all_divisions is distinct from old.view_all_divisions
        or new.view_division_ids is distinct from old.view_division_ids)
       and not private.is_company_owner() then
      raise exception 'Only an owner or Rococo can choose which divisions someone can see.';
    end if;
    if new.role is distinct from old.role and not private.is_company_owner() then
      new.view_all_divisions := false;
      new.view_division_ids := '{}';
    end if;

    if not v_full then
      select p.view_division_ids into v_view_ids
        from public.profiles p
       where p.user_id = (select auth.uid()) and p.is_active;
      v_changed := array(
        (select a from unnest(new.division_ids) a except select b from unnest(old.division_ids) b)
        union
        (select b from unnest(old.division_ids) b except select a from unnest(new.division_ids) a)
      );
      if exists (select 1 from unnest(v_changed) as d (id) where not (d.id = any (coalesce(v_view_ids, '{}')))) then
        raise exception 'You can only place people in divisions you can see.';
      end if;
      if new.role is distinct from old.role
         and old.user_id is distinct from (select auth.uid())
         and private.role_rank(new.role) >= private.auth_role_rank() then
        raise exception 'Only an owner or an admin who sees every division can raise someone to your rank or above.';
      end if;
      if old.user_id is distinct from (select auth.uid())
         and cardinality(new.division_ids) > 0
         and private.role_rank(new.role) >= private.auth_role_rank()
         and (new.division_ids is distinct from old.division_ids or new.role is distinct from old.role) then
        raise exception 'Only an owner or an admin who sees every division can put someone at your rank or above in a division.';
      end if;
      if new.role is distinct from old.role
         and private.role_rank(new.role) > private.role_rank(old.role)
         and private.role_rank(new.role) >= private.role_rank('manager')
         and exists (
           select c.id from private.chain_ids(old.id) as c (id)
           except
           select v.id from private.viewable_person_ids() as v (id)
         ) then
        raise exception 'Some of the people who report to this person are outside the divisions you can see, so only an owner or an admin who sees every division can make them a manager or above.';
      end if;
    end if;

    if new.reports_to is distinct from old.reports_to then
      if not v_full
         and greatest(private.role_rank(old.role), private.role_rank(new.role)) >= private.auth_role_rank() then
        raise exception 'Only an owner or an admin who sees every division can change who someone at your rank or above reports to.';
      end if;
      if new.reports_to is not null
         and not exists (select 1 from private.viewable_person_ids() as v (id) where v.id = new.reports_to) then
        raise exception 'You can only choose a manager you can see.';
      end if;
      if not v_full and exists (
        select c.id from private.chain_ids(old.id) as c (id)
        except
        select v.id from private.viewable_person_ids() as v (id)
      ) then
        raise exception 'Some of the people who report to this person are outside the divisions you can see, so only an owner or an admin who sees every division can change who they report to.';
      end if;
    end if;
    return new;
  end if;

  -- 0046: a leader who is not an admin of this person changes only their GSR rhythm.
  if old.user_id is distinct from (select auth.uid())
     and exists (select 1 from private.led_person_ids() as l (id) where l.id = old.id) then
    v_probe.gsr_cadence := old.gsr_cadence;
    if v_probe is distinct from old then
      raise exception 'A manager can change only the GSR rhythm of the people they lead.';
    end if;
    return new;
  end if;

  if old.user_id is distinct from (select auth.uid()) then
    raise exception 'You can only edit your own profile.';
  end if;
  if new.role is distinct from old.role or new.is_active is distinct from old.is_active then
    raise exception 'Only admins can change roles or deactivate accounts.';
  end if;
  if new.can_view_divisions is distinct from old.can_view_divisions then
    raise exception 'Only an owner or Rococo can choose who sees the divisions.';
  end if;
  if new.view_all_divisions is distinct from old.view_all_divisions
     or new.view_division_ids is distinct from old.view_division_ids then
    raise exception 'Only an owner or Rococo can choose which divisions someone can see.';
  end if;
  v_probe.full_name := old.full_name;
  v_probe.title := old.title;
  v_probe.phone := old.phone;
  if v_probe is distinct from old then
    raise exception 'Only admins can change employment details.';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_profile_fields() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 10. Audit
-- ---------------------------------------------------------------------------------------
-- A person's rhythm decides which GSRs are theirs, so who changed it and when is kept.
drop trigger if exists profiles_audit on public.profiles;
create trigger profiles_audit
  after insert or update or delete on public.profiles
  for each row execute function private.audit_change('role', 'is_active', 'is_rococo_admin', 'company_id', 'reports_to', 'job_role_id', 'can_view_divisions', 'division_ids', 'view_all_divisions', 'view_division_ids', 'gsr_cadence');

-- ---------------------------------------------------------------------------------------
-- 11. Nothing left behind
-- ---------------------------------------------------------------------------------------
-- 0038's rule still holds: no policy on a table holding a person's records reaches a whole
-- company through can_manage_company or is_company_member. And no policy on reviews tests for a
-- monthly cadence any more; a later paste of 0038 brings its monthly leader policy back, and this
-- paste puts it right again above, so anything still testing for it is a leftover.
do $$
declare
  v_left text;
begin
  select string_agg(format('%s on %s', policyname, tablename), '; ' order by tablename, policyname)
    into v_left
    from pg_policies
   where schemaname = 'public'
     and tablename in (
       'profiles', 'reviews', 'review_scores', 'review_project_notes', 'goals', 'goal_notes',
       'goal_private', 'employee_kpis', 'employee_deliverables', 'deliverable_tasks',
       'impact_scores', 'metric_entries', 'cycle_omissions', 'compensation_items',
       'employee_financials'
     )
     and (coalesce(qual, '') ~ '(can_manage_company|is_company_member)\('
          or coalesce(with_check, '') ~ '(can_manage_company|is_company_member)\(');
  if v_left is not null then
    raise exception 'These policies still reach a whole company: %', v_left;
  end if;

  select string_agg(format('%s on %s', policyname, tablename), '; ' order by tablename, policyname)
    into v_left
    from pg_policies
   where schemaname = 'public'
     and (coalesce(qual, '') ~ 'cadence = ''monthly'''
          or coalesce(with_check, '') ~ 'cadence = ''monthly''');
  if v_left is not null then
    raise exception 'These policies still take monthly to mean a GSR: %', v_left;
  end if;
end $$;
