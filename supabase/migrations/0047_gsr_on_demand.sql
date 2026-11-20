-- 0047_gsr_on_demand.sql
-- GSRs on demand: a Goal Setting Review that stands on its own, with no cycle, started when it is
-- due and closed by leadership, as docs/superpowers/specs/2026-11-20-gsr-on-demand-design.md sets
-- out. A company takes this format by one setting, companies.gsr_mode, and RBA takes it first.
-- Klasik and Kingdom stay on periods (GSR months in cycles), and the owner's condition is that a
-- company on periods is held to exactly the rules it had before 0046.
--
-- So this migration does two things. It walls the new format off, and it takes back from every
-- company the parts of 0046 that a company on periods would otherwise be held to or allowed.
--
--   1. The setting. companies.gsr_mode is 'periods' (the default, what every company does today)
--      or 'on_demand'. private.gsr_on_demand(company) reads it for policies and guards. The audit
--      watches it.
--   2. Nobody turns it on by accident. No signed-in account changes it, Rococo admins included:
--      guard_company_fields refuses. In the SQL editor the change must name its company in the
--      same transaction (set hub.gsr_on_demand_for to the slug), so a statement that reaches the
--      wrong company, or every company, changes nothing. It goes back to periods only while the
--      company holds no GSR without a cycle. A new company is born on periods: a signed-in
--      writer cannot create one on demand, and the SQL editor does so only by naming it.
--   3. What 0046 put on every company, taken back. No member opens a cycle (the policy goes). A
--      person's rhythm no longer decides whose GSR a cycle holds (the trigger goes, with
--      private.person_gsr_cadence, which only it used). A month takes
--      any dates an admin gives it, and weekly, two-week and quarterly GSR periods are gone with
--      their rules: the cadences are monthly, quarterly, annual and custom again, monthly is a GSR
--      and the rest are reviews, and a cycle's kind always follows its cadence.
--   4. Narrowed to companies on demand. A manager locks and reopens only a GSR with no cycle, so in
--      a company on periods only admins lock a month, as before 0046. A manager sets a person's
--      rhythm only in a company on demand. Rhythm gains None and Daily.
--   5. A GSR with no cycle. reviews.cycle_id becomes optional, and a review without one is a GSR
--      on its own, in its person's company, with two dates (started_on, done_on) a review in a
--      cycle never carries. No signed-in writer moves a review into or out of a cycle. Nobody
--      marks their own GSR done or reopens it, whatever their role.
--   6. Its dates and limits. The database stamps both dates in the company's time zone, starts
--      one only in a company on demand, one a person a day and two open at most.
--   7. Who starts one: the person, anyone who leads them, an admin who manages them.
--   8. public.gsr_last_started, the day each person's last GSR began, read through the wall.
--   9. Its goals. goals.review_id points a GSR goal at its GSR. A GSR goal has one home, a cycle
--      or a GSR; a goal on a GSR is that GSR's person's, in their company, one focus goal a GSR,
--      and goes when the GSR is deleted. The person cannot move a goal someone else set for them
--      to another GSR. Who reads and writes goals does not change.
--  10. Frozen when done. A done GSR's goals and notes cannot change until it is reopened, with
--      the exemptions a locked month has.
--  11. A task links to a goal of an open GSR, and to no goal of a done one.
--  12. Moving a company over. When a company's gsr_mode moves from periods to on demand, its past
--      GSR months become GSRs on their own in the same write: each review keeps its status,
--      score and completion and takes its month's dates, its person's goals in that month follow
--      it, a goal with no review gets a not-started GSR, and the months and their left-out rows
--      go. Scored review cycles are not touched. A private copy of every row removed or
--      re-pointed is kept (private.gsr_conversion_backup), so a move made in error can be put
--      back by hand. The guards stand aside for it only while the flag hub.gsr_conversion is
--      '1', which only the conversion sets and clears. supabase/tests/fingerprint.sql, run before
--      and after, proves no other company's rows moved.
--
-- Kept for everyone from 0046, because the live schema is built on it and it changes nothing a
-- person can see or do: review_cycles.kind, the duplicate-cycle key that includes it, and
-- profiles.gsr_cadence with the audit of its changes.
--
-- Rebuilt functions are copied from their latest bodies (guard_company_fields from 0042;
-- guard_review_cycle_period, guard_review_employee_fields and guard_profile_fields from 0046;
-- inherit_company_from_cycle from 0003; guard_review_cycle from 0039; inherit_goal_company from
-- 0028; guard_goal_owner from 0039; guard_goal_frozen, guard_goal_note_frozen and guard_task from
-- 0046; guard_signed_off_review from 0029) and changed only on the lines named here. The messages
-- people already see stay word for word.
--
-- Paste after 0046. Re-pasting 0046 after this brings back everything section 3 removes and
-- section 4 narrows, and re-pasting 0028, 0029 or 0039 takes back what sections 9 to 12 add to
-- goals, tasks and signed-off reviews; pasting this again puts it right. Idempotent: pasting it
-- again converts nothing, since only a change of gsr_mode does.

-- ---------------------------------------------------------------------------------------
-- 1. The setting
-- ---------------------------------------------------------------------------------------
-- Adding a column with a default writes no row through the triggers.
alter table public.companies add column if not exists gsr_mode text not null default 'periods';

alter table public.companies drop constraint if exists companies_gsr_mode_check;
alter table public.companies add constraint companies_gsr_mode_check
  check (gsr_mode in ('periods', 'on_demand'));

-- Whether a company is on demand, read past RLS for policies and guards. False for a company
-- that is not there.
create or replace function private.gsr_on_demand(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.gsr_mode = 'on_demand' from public.companies c where c.id = p_company), false)
$$;
revoke all on function private.gsr_on_demand(uuid) from public, anon;
grant execute on function private.gsr_on_demand(uuid) to authenticated, service_role;

-- 0042's watched columns for companies, with gsr_mode added.
drop trigger if exists companies_audit on public.companies;
create trigger companies_audit
  after insert or update or delete on public.companies
  for each row execute function private.audit_change('modules', 'slug', 'theme_key', 'name', 'time_zone', 'wins_home_days', 'manual_financials', 'gsr_mode');

-- ---------------------------------------------------------------------------------------
-- 2. Nobody turns it on by accident
-- ---------------------------------------------------------------------------------------
-- The 0042 body with one check added outside the Rococo test: any signed-in writer changing
-- gsr_mode is refused, Rococo admins included.
create or replace function public.guard_company_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not private.is_rococo_admin() then
    if new.slug is distinct from old.slug
       or new.theme_key is distinct from old.theme_key
       or new.modules is distinct from old.modules
       or new.wins_home_days is distinct from old.wins_home_days
       or new.manual_financials is distinct from old.manual_financials then
      raise exception 'Only Rococo admins can change a company slug, theme, modules or display settings.';
    end if;
  end if;
  if auth.uid() is not null and new.gsr_mode is distinct from old.gsr_mode then
    raise exception 'The GSR format is changed by Rococo in the database.';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_company_fields() from public, anon, authenticated;

-- The change made by hand. BEFORE triggers on companies fire in name order, so
-- companies_guard_fields (0001) has already refused any signed-in writer by the time this runs;
-- what reaches here is the SQL editor. Moving to on demand needs the company named in the same
-- transaction:
--   select set_config('hub.gsr_on_demand_for', 'rba', true);
--   update public.companies set gsr_mode = 'on_demand' where slug = 'rba';
-- Every row an update reaches is judged, so a statement that reaches a company not named fails
-- whole. Going back to periods is refused once the company holds a GSR with no cycle, which has
-- no period to go back to.
--
-- A new company is born on periods. Only update is guarded by companies_guard_fields, so on
-- insert this refuses a signed-in writer (0001 lets a Rococo admin create a company) asking for
-- anything else, with the update rule's message, and holds the SQL editor to the same naming
-- rule as a move.
create or replace function public.guard_company_gsr_mode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.gsr_mode is not distinct from 'periods' then
      return new;
    end if;
    if (select auth.uid()) is not null then
      raise exception 'The GSR format is changed by Rococo in the database.';
    end if;
  elsif new.gsr_mode is not distinct from old.gsr_mode then
    return new;
  end if;
  -- An update is judged by the company it is (old.slug), so a statement that also changes the
  -- slug cannot name its way in; an insert has only the new row's slug.
  if new.gsr_mode = 'on_demand'
     and current_setting('hub.gsr_on_demand_for', true) is distinct from
         (case when tg_op = 'INSERT' then new.slug else old.slug end) then
    raise exception 'Name the company this change is for: set hub.gsr_on_demand_for to its slug in the same transaction.'
      using errcode = 'check_violation';
  end if;
  if new.gsr_mode = 'periods'
     and exists (select 1 from public.reviews r where r.company_id = new.id and r.cycle_id is null) then
    raise exception 'This company has GSRs on demand, so it cannot go back to periods from here.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_company_gsr_mode() from public, anon, authenticated;

drop trigger if exists companies_guard_gsr_mode on public.companies;
create trigger companies_guard_gsr_mode
  before insert or update of gsr_mode on public.companies
  for each row execute function public.guard_company_gsr_mode();

-- ---------------------------------------------------------------------------------------
-- 3. What 0046 put on every company, taken back
-- ---------------------------------------------------------------------------------------
-- No member opens a cycle. Admins create every cycle by hand, as before 0046 (0010, 0038).
drop policy if exists "Members open a GSR period" on public.review_cycles;

-- A person's rhythm no longer decides whose GSR a cycle holds. person_gsr_cadence served only
-- that trigger.
drop trigger if exists reviews_guard_rhythm on public.reviews;
drop function if exists public.guard_review_rhythm();
drop function if exists private.person_gsr_cadence(uuid);

-- The 0046 trigger function reduced to one job: on every insert and update, a cycle's kind is
-- set from its cadence, monthly a GSR and anything else a review. The period rules, the kind
-- lock, the cadence messages and the naming of a member's period are gone with what they served.
create or replace function public.guard_review_cycle_period()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.kind := case when new.cadence = 'monthly' then 'gsr' else 'review' end;
  return new;
end;
$$;
revoke execute on function public.guard_review_cycle_period() from public, anon, authenticated;

drop trigger if exists review_cycles_guard_period on public.review_cycles;
create trigger review_cycles_guard_period
  before insert or update on public.review_cycles
  for each row execute function public.guard_review_cycle_period();

-- The period helpers served only the rules above.
drop function if exists private.gsr_period_ok(text, date, date);
drop function if exists private.gsr_period_name(text, date, date);

-- The cadences back to monthly, quarterly, annual and custom. Should a live cycle run at a
-- cadence that is going, the paste stops here and names it rather than leaving a bare
-- constraint error.
do $$
declare
  v_bad text;
begin
  select string_agg(format('%s (%s, %s to %s)', c.name, c.cadence, c.period_start, c.period_end), '; '
                    order by c.period_start)
    into v_bad
    from public.review_cycles c
   where c.cadence not in ('monthly', 'quarterly', 'annual', 'custom');
  if v_bad is not null then
    raise exception 'These cycles run at a cadence 0047 takes back: %', v_bad;
  end if;
end $$;

alter table public.review_cycles drop constraint if exists review_cycles_cadence_check;
alter table public.review_cycles add constraint review_cycles_cadence_check
  check (cadence in ('monthly', 'quarterly', 'annual', 'custom'));

-- A month is a GSR and the other three are reviews. Every live row passes (0046's backfill made
-- every monthly cycle a GSR and the rest reviews); should anything not, the paste stops here and
-- names it.
do $$
declare
  v_bad text;
begin
  select string_agg(format('%s (%s, %s)', c.name, c.kind, c.cadence), '; ' order by c.period_start)
    into v_bad
    from public.review_cycles c
   where not ((c.kind = 'gsr' and c.cadence = 'monthly')
              or (c.kind = 'review' and c.cadence in ('quarterly', 'annual', 'custom')));
  if v_bad is not null then
    raise exception 'These cycles have a kind their cadence no longer gives: %', v_bad;
  end if;
end $$;

alter table public.review_cycles drop constraint if exists review_cycles_kind_cadence_check;
alter table public.review_cycles add constraint review_cycles_kind_cadence_check
  check ((kind = 'gsr' and cadence = 'monthly')
         or (kind = 'review' and cadence in ('quarterly', 'annual', 'custom')));

-- ---------------------------------------------------------------------------------------
-- 4. Narrowed to companies on demand
-- ---------------------------------------------------------------------------------------
-- A leader locks and reopens a GSR with no cycle, and only that. A review in a cycle, GSR month
-- or scored review, is not reached by this policy, so in a company on periods only admins lock a
-- month. Only a company on demand can hold a review with no cycle.
drop policy if exists "Leaders lock and reopen a GSR for the people they lead" on public.reviews;
create policy "Leaders lock and reopen a GSR for the people they lead"
  on public.reviews for update to authenticated
  using (
    company_id = private.auth_company_id()
    and employee_id in (select private.led_person_ids())
    and cycle_id is null
  )
  with check (
    company_id = private.auth_company_id()
    and employee_id in (select private.led_person_ids())
    and cycle_id is null
  );

-- The 0046 body with the leader branch narrowed the same way: it reads old.cycle_id is null where
-- it read a GSR cycle. Section 5 adds one check, first and before the admin pass: on a GSR with no
-- cycle, nobody changes what marks their own GSR done or reopens it (status, completion time,
-- score, who marked it done), whatever their role. Their own is the GSR's person before the write
-- or after it, so nobody makes someone else's GSR theirs and closes it in one write (section 6
-- refuses the change of person on its own). v_me is read before that check rather than
-- after the admin pass. While a company moves over (hub.gsr_conversion is '1', section 12) it
-- stands aside, so the conversion can take a review out of its month. Everything else, and every
-- message, is as it was.
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
  if coalesce(current_setting('hub.gsr_conversion', true), '') = '1' then
    return new;
  end if;
  v_me := private.auth_profile_id();
  if old.cycle_id is null
     and v_me in (old.employee_id, new.employee_id)
     and (new.status, new.completed_at, new.gsr_score, new.reviewer_id)
         is distinct from (old.status, old.completed_at, old.gsr_score, old.reviewer_id) then
    raise exception 'Your own GSR is marked done and reopened by someone who leads you.'
      using errcode = 'check_violation';
  end if;
  if private.can_manage_company(old.company_id) then
    return new;
  end if;
  v_probe := new;
  v_probe.updated_at := old.updated_at;
  v_probe.pillar_snapshot := old.pillar_snapshot;

  if v_me is not null
     and v_me is distinct from old.employee_id
     and exists (select 1 from private.led_person_ids() as l (id) where l.id = old.employee_id)
     and old.cycle_id is null then
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

-- A leader sets a led person's rhythm only in a company on demand. Rhythm means nothing on
-- periods and no screen shows it there.
drop policy if exists "Leaders set the GSR rhythm of the people they lead" on public.profiles;
create policy "Leaders set the GSR rhythm of the people they lead"
  on public.profiles for update to authenticated
  using (
    company_id is not null
    and company_id = private.auth_company_id()
    and private.gsr_on_demand(company_id)
    and id in (select private.led_person_ids())
  )
  with check (
    company_id is not null
    and company_id = private.auth_company_id()
    and private.gsr_on_demand(company_id)
  );

-- The 0046 body with the leader branch narrowed to a company on demand. Everything else, and
-- every message, is as it was.
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
  -- 0047: and only in a company on demand.
  if old.user_id is distinct from (select auth.uid())
     and private.gsr_on_demand(old.company_id)
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

-- Rhythm gains None (for people who never have a GSR) and Daily, beside 0046's four. The list
-- only grows, so no live row can break it; the check below says so plainly should one ever.
do $$
declare
  v_bad text;
begin
  select string_agg(format('%s (%s)', p.full_name, p.gsr_cadence), '; ' order by p.full_name)
    into v_bad
    from public.profiles p
   where p.gsr_cadence not in ('none', 'daily', 'weekly', 'biweekly', 'monthly', 'quarterly');
  if v_bad is not null then
    raise exception 'These people have a GSR rhythm 0047 does not know: %', v_bad;
  end if;
end $$;

alter table public.profiles drop constraint if exists profiles_gsr_cadence_check;
alter table public.profiles add constraint profiles_gsr_cadence_check
  check (gsr_cadence in ('none', 'daily', 'weekly', 'biweekly', 'monthly', 'quarterly'));

-- ---------------------------------------------------------------------------------------
-- 5. A GSR with no cycle
-- ---------------------------------------------------------------------------------------
-- A review with no cycle is a GSR on its own. A review with a cycle is what it always was, and
-- carries no dates. 0003 made cycle_id required; dropping that is a no-op the second time.
alter table public.reviews alter column cycle_id drop not null;
alter table public.reviews add column if not exists started_on date;
alter table public.reviews add column if not exists done_on date;

-- Every live review has a cycle and no dates, so every live row passes.
alter table public.reviews drop constraint if exists reviews_home_check;
alter table public.reviews add constraint reviews_home_check
  check ((cycle_id is not null and started_on is null and done_on is null)
         or (cycle_id is null and started_on is not null));

-- One GSR a person a day. Not partial, so a start can name it in on conflict (employee_id,
-- started_on) do nothing; a review in a cycle has no started_on and never collides.
create unique index if not exists reviews_person_day_key on public.reviews (employee_id, started_on);

-- The 0003 body with a GSR's company added: with no cycle, a new GSR takes its person's company,
-- and a review the SQL editor takes out of its cycle (section 12's conversion) keeps the company
-- it had, so a person who has since moved company does not carry it across the wall. A person who is
-- not there is named only to the SQL editor and a Rococo admin; anyone else is left to row level
-- security, which refuses a GSR with no company. While a company moves over (hub.gsr_conversion is
-- '1', section 12) a GSR the conversion creates keeps the company it is given, the converting
-- company, for the same reason. With a cycle, unchanged.
create or replace function public.inherit_company_from_cycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.cycle_id is null then
    if tg_op = 'UPDATE' then
      new.company_id := old.company_id;
      return new;
    end if;
    if new.company_id is not null
       and coalesce(current_setting('hub.gsr_conversion', true), '') = '1' then
      return new;
    end if;
    select company_id into new.company_id from public.profiles where id = new.employee_id;
    if new.company_id is null
       and ((select auth.uid()) is null or private.is_rococo_admin()) then
      raise exception 'Unknown person.';
    end if;
    return new;
  end if;
  select company_id into new.company_id from public.review_cycles where id = new.cycle_id;
  if new.company_id is null then
    raise exception 'Unknown review cycle.';
  end if;
  return new;
end;
$$;
revoke all on function public.inherit_company_from_cycle() from public, anon, authenticated;

-- The 0039 body with three checks put first. A review that has no cycle and had none has nothing
-- here to judge, so it passes at once. While a company moves over (hub.gsr_conversion is '1',
-- section 12) a review leaving its cycle for none passes too, a closed month's included. A
-- signed-in writer never moves a review between having a cycle and having none, either way.
-- Everything after is the 0039 body, line for line, with its messages.
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
  if new.cycle_id is null and (tg_op = 'INSERT' or old.cycle_id is null) then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.cycle_id is null
     and coalesce(current_setting('hub.gsr_conversion', true), '') = '1' then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and (new.cycle_id is null) <> (old.cycle_id is null)
     and (select auth.uid()) is not null then
    raise exception 'A review in a cycle stays in a cycle, and a GSR on its own stays on its own.'
      using errcode = 'check_violation';
  end if;

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

-- guard_review_omitted (0034) needs no change: it looks for an omission with the review's cycle,
-- and a GSR with no cycle matches none.

-- ---------------------------------------------------------------------------------------
-- 6. A GSR's dates and limits
-- ---------------------------------------------------------------------------------------
-- For a review with no cycle, every writer:
--   * starts one only in a company on demand;
--   * never starts their own already done (section 4 holds them to the same on an update);
--   * gets started_on as the company's date, whatever was sent, and it never changes after;
--   * gets done_on as the company's date when it is marked done, cleared when it is reopened,
--     and otherwise kept, the way gsr_score is released;
--   * has one a day: a start on a day the person already has one passes on to the unique key,
--     so a start that ignores a duplicate lands on that one;
--   * has two open at most when one is started. Reopening is never limited, so a leader can put
--     right one closed by mistake;
--   * stays with its person and its company: no signed-in writer changes either, Rococo admins
--     included, and any writer who changes the company, the SQL editor included, lands it in a
--     company on demand. (A move of the person to another company leaves their GSRs where they
--     were started.)
--   * refuses a writer with no say over the person outright, in row level security's own words,
--     and tells them nothing else: the mode, the limit and an unknown person
--     (inherit_company_from_cycle, section 5) are answered only to a writer with a say over the
--     person.
-- While a company moves over (hub.gsr_conversion is '1', section 12) the dates are kept as given
-- and the mode and the limit are not judged.
--
-- BEFORE triggers on reviews fire in name order: reviews_guard_cycle,
-- reviews_guard_employee_fields, reviews_guard_omitted, reviews_guard_signed_off,
-- reviews_inherit_company, reviews_release_gsr_score, reviews_set_updated_at,
-- reviews_snapshot_pillars, then this one. So the company is already set, and a signed-off GSR
-- has already been judged on what the writer sent before done_on is stamped or cleared.
create or replace function public.stamp_standalone_gsr()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date;
begin
  if new.cycle_id is not null
     or coalesce(current_setting('hub.gsr_conversion', true), '') = '1' then
    return new;
  end if;

  select (now() at time zone c.time_zone)::date into v_today
    from public.companies c
   where c.id = new.company_id;

  if tg_op = 'INSERT' then
    new.started_on := v_today;
    new.done_on := case when new.status = 'complete' then v_today end;
    -- What follows is answered only to the SQL editor, a Rococo admin, the person and anyone who
    -- leads or manages them (led_person_ids holds the people an admin manages). Anyone else is
    -- refused here, with the words row level security would use, and told nothing else: so a
    -- stranger never learns whether the person is there or how many GSRs they have open, and a GSR
    -- with no cycle never lands outside a company on demand however the insert policies change.
    if (select auth.uid()) is not null
       and not private.is_rococo_admin()
       and private.auth_profile_id() is distinct from new.employee_id
       and not exists (select 1 from private.led_person_ids() as l (id) where l.id = new.employee_id) then
      raise exception 'new row violates row-level security policy for table "reviews"'
        using errcode = 'insufficient_privilege';
    end if;
    if not private.gsr_on_demand(new.company_id) then
      raise exception 'GSRs on demand are not turned on for this company.'
        using errcode = 'check_violation';
    end if;
    if new.status = 'complete' and private.auth_profile_id() = new.employee_id then
      raise exception 'Your own GSR is marked done and reopened by someone who leads you.'
        using errcode = 'check_violation';
    end if;
    if not exists (
         select 1 from public.reviews r
          where r.employee_id = new.employee_id and r.started_on = v_today
       )
       and (select count(*) from public.reviews r
             where r.employee_id = new.employee_id
               and r.company_id = new.company_id
               and r.cycle_id is null
               and r.status <> 'complete') >= 2 then
      raise exception 'This person already has two GSRs open. Mark the earlier one done first.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if (select auth.uid()) is not null then
    if new.employee_id is distinct from old.employee_id then
      raise exception 'A GSR stays with the person it was started for.'
        using errcode = 'check_violation';
    end if;
    if new.company_id is distinct from old.company_id then
      raise exception 'A GSR stays in the company it was started in.'
        using errcode = 'check_violation';
    end if;
  end if;
  if new.company_id is distinct from old.company_id
     and not private.gsr_on_demand(new.company_id) then
    raise exception 'GSRs on demand are not turned on for this company.'
      using errcode = 'check_violation';
  end if;
  new.started_on := old.started_on;
  if new.status = 'complete' and old.status is distinct from 'complete' then
    new.done_on := v_today;
  elsif new.status <> 'complete' then
    new.done_on := null;
  else
    new.done_on := old.done_on;
  end if;
  return new;
end;
$$;
revoke execute on function public.stamp_standalone_gsr() from public, anon, authenticated;

drop trigger if exists reviews_stamp_gsr on public.reviews;
create trigger reviews_stamp_gsr
  before insert or update on public.reviews
  for each row execute function public.stamp_standalone_gsr();

-- ---------------------------------------------------------------------------------------
-- 7. Who starts one, and who closes it
-- ---------------------------------------------------------------------------------------
-- The person starts their own, and anyone who leads them starts one for them, blank, in the
-- shapes the two monthly open policies (0046) require, with no cycle in place of an open GSR
-- month. An admin who manages the person starts one through "Admins add for the people they
-- manage" (0038), and a Rococo admin through the same policy. Section 6 refuses all of them in a
-- company on periods.
--
-- Marking done and reopening: a leader through "Leaders lock and reopen a GSR for the people
-- they lead" (section 4), an admin through 0038's update policy, never the person themself
-- (section 4's guard). Deleting is an admin's, as for every review (0038).
drop policy if exists "People start their own GSR" on public.reviews;
create policy "People start their own GSR"
  on public.reviews for insert to authenticated
  with check (
    cycle_id is null
    and employee_id = private.auth_profile_id()
    and company_id = private.auth_company_id()
    and status = 'not_started'
    and previous_status is null
    and manager_feedback is null
    and peer_feedback is null
    and client_feedback is null
    and reviewer_id is null
    and completed_at is null
  );

drop policy if exists "Leaders start a GSR for the people they lead" on public.reviews;
create policy "Leaders start a GSR for the people they lead"
  on public.reviews for insert to authenticated
  with check (
    cycle_id is null
    and company_id = private.auth_company_id()
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
  );

-- ---------------------------------------------------------------------------------------
-- 8. When each person's last GSR was started
-- ---------------------------------------------------------------------------------------
-- For the due flag on a list of people. security_invoker, so it reads through the reviews wall
-- as whoever asks: a person sees their own row, a leader and an admin the rows of the people
-- they see, and nobody another company's.
create or replace view public.gsr_last_started
with (security_invoker = true)
as
  select r.company_id, r.employee_id, max(r.started_on) as last_started_on
    from public.reviews r
   where r.cycle_id is null
   group by r.company_id, r.employee_id;

revoke all on public.gsr_last_started from public, anon, authenticated;
grant select on public.gsr_last_started to authenticated;

-- ---------------------------------------------------------------------------------------
-- 9. Its goals
-- ---------------------------------------------------------------------------------------
-- A GSR goal (scope 'cycle', the value every goal and note policy is keyed on for all three
-- companies) lives in a cycle (a company on periods) or on a GSR with no cycle (a company on
-- demand), never both and never neither. Any other goal lives on neither. Deleting a GSR takes
-- its goals, and their notes with them, as deleting a cycle does (0029).
alter table public.goals add column if not exists review_id uuid references public.reviews (id) on delete cascade;
create index if not exists goals_review_id_idx on public.goals (review_id);

-- 0029's check said a GSR goal names its cycle; this one says it names one home. Every live row
-- passes: every live goal has no review_id, and 0029 validated every GSR goal has its cycle.
-- Re-pasting 0029 after this adds its check back (it adds it only when missing), which refuses
-- every goal on a GSR; pasting this again takes it away.
alter table public.goals drop constraint if exists goals_cycle_scope_check;
alter table public.goals drop constraint if exists goals_home_check;
alter table public.goals add constraint goals_home_check
  check ((scope = 'cycle' and (cycle_id is null) <> (review_id is null))
         or (scope <> 'cycle' and review_id is null));

-- One focus goal a GSR, as 0023 holds one a month. 0023's index leaves goals with no cycle alone.
create unique index if not exists goals_one_focus_per_gsr on public.goals (review_id) where is_focus;

-- The 0028 body with one branch put first: a goal on a GSR takes its GSR's company. When it is
-- put on the GSR (or its person changes) the GSR must be one with no cycle, for the goal's own
-- person, in the company that person is in. Anything else, a review in a cycle, another person's
-- GSR, a GSR in another company or none at all, gets the one message, so it tells nobody what
-- sits on the other side of the wall. A company on periods holds no GSR with no cycle, so none of
-- its goals can carry a review_id. While a company moves over (hub.gsr_conversion is '1', section
-- 12) the GSR need not be in the company its person is in now: a person moved to another company
-- since their month keeps that month's goals on its GSR, in the company it was in. After that,
-- word for word.
create or replace function public.inherit_goal_company()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person_company uuid;
  v_cycle_company  uuid;
  v_gsr_company    uuid;
begin
  select company_id into v_person_company from public.profiles where id = new.employee_id;
  if new.review_id is not null then
    if tg_op = 'INSERT'
       or new.review_id is distinct from old.review_id
       or new.employee_id is distinct from old.employee_id then
      select r.company_id into v_gsr_company
        from public.reviews r
       where r.id = new.review_id
         and r.cycle_id is null
         and r.employee_id = new.employee_id
         and (r.company_id = v_person_company
              or coalesce(current_setting('hub.gsr_conversion', true), '') = '1');
      if not found then
        raise exception 'A goal on a GSR belongs to that GSR''s person.'
          using errcode = 'check_violation';
      end if;
    else
      select r.company_id into v_gsr_company from public.reviews r where r.id = new.review_id;
    end if;
    new.company_id := v_gsr_company;
    return new;
  end if;

  if new.cycle_id is null then
    if v_person_company is null then
      raise exception 'This person is not placed with a company yet.';
    end if;
    new.company_id := v_person_company;
    return new;
  end if;

  select company_id into v_cycle_company from public.review_cycles where id = new.cycle_id;
  -- Checked when the goal is put in a month, not on every edit after: OLD is only read on an
  -- update.
  if tg_op = 'INSERT' then
    if v_person_company is distinct from v_cycle_company then
      raise exception 'That month belongs to another company.'
        using errcode = 'check_violation';
    end if;
  elsif new.cycle_id is distinct from old.cycle_id or new.employee_id is distinct from old.employee_id then
    if v_person_company is distinct from v_cycle_company then
      raise exception 'That month belongs to another company.'
        using errcode = 'check_violation';
    end if;
  end if;
  new.company_id := v_cycle_company;
  return new;
end;
$$;
revoke execute on function public.inherit_goal_company() from public, anon, authenticated;

-- Who reads and writes goals and notes does not change. The four goal policies (0038) and the
-- note policies are keyed on the person, the company and scope = 'cycle', never on the cycle, so
-- a goal on a GSR is the person's, their leaders' and their admins' exactly as a month's goal is.
-- goal_private (0021) still refuses any goal with scope 'cycle'.

-- The 0039 body with one change: review_id joins the fields a person cannot change on a goal
-- someone else set for them, beside cycle_id. Everything else, and every message, is as it was.
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
  if row(new.title, new.description, new.kind, new.is_focus, new.cycle_id, new.scope, new.year, new.review_id)
     is distinct from
     row(old.title, old.description, old.kind, old.is_focus, old.cycle_id, old.scope, old.year, old.review_id) then
    raise exception 'This goal was set for you, so only an admin can change what it is. You can still move its completion, tick its steps and add notes.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_goal_owner() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 10. Frozen when done
-- ---------------------------------------------------------------------------------------
-- The 0046 bodies with a branch for a GSR with no cycle, read from the goal's review_id (before
-- and after the write) where the cycle branch reads its cycle: a done GSR's goals and notes
-- cannot change until it is reopened. A goal on a GSR has no cycle, so the cycle branch never
-- reaches it, and a goal in a cycle has no review_id, so this branch never reaches a month. The
-- update exemptions sit before both branches and so hold for both: the why (outcome_note),
-- updated_at, and a carried-from goal that is gone. So does the delete pass-through: when the
-- GSR itself is being deleted its goals go with it. The done-GSR branch matches only a GSR of the
-- goal's own person, as the cycle branch's lock does, so a write that names someone else's GSR by
-- id (another company's included) is answered by inherit_goal_company's person refusal, never by
-- whether that GSR is done.
--
-- While a company moves over (hub.gsr_conversion is '1', section 12) both guards stand aside, so
-- the SQL editor can move a locked month's goals and notes onto its GSR. Otherwise every line of the
-- cycle branch, and every message, is as it was.
create or replace function public.guard_goal_frozen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from     uuid := case when tg_op = 'INSERT' then null else old.cycle_id end;
  v_to       uuid := case when tg_op = 'DELETE' then null else new.cycle_id end;
  v_whose    uuid := case when tg_op = 'DELETE' then old.employee_id else new.employee_id end;
  v_gsr_from uuid := case when tg_op = 'INSERT' then null else old.review_id end;
  v_gsr_to   uuid := case when tg_op = 'DELETE' then null else new.review_id end;
  v_probe    public.goals%rowtype;
begin
  if coalesce(current_setting('hub.gsr_conversion', true), '') = '1' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  if tg_op = 'DELETE'
     and old.cycle_id is not null
     and not exists (select 1 from public.review_cycles c where c.id = old.cycle_id) then
    return old;
  end if;
  if tg_op = 'DELETE'
     and old.review_id is not null
     and not exists (select 1 from public.reviews r where r.id = old.review_id) then
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
  if exists (
    select 1 from public.reviews r
    where r.id in (v_gsr_from, v_gsr_to)
      and r.cycle_id is null
      and r.employee_id = v_whose
      and r.status = 'complete'
  ) then
    raise exception 'This GSR is done. Reopen it to change its goals.'
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
  if coalesce(current_setting('hub.gsr_conversion', true), '') = '1' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
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
  if exists (
    select 1
      from public.goals g
      join public.reviews r on r.id = g.review_id
     where g.id in (v_from, v_to)
       and r.cycle_id is null
       and r.status = 'complete'
  ) then
    raise exception 'This GSR is done. Reopen it to change its notes.'
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
-- 11. A task links to a goal of an open GSR
-- ---------------------------------------------------------------------------------------
-- The 0046 body with two changes in the goal link. A goal carries tasks when it is a GSR goal in
-- a GSR cycle, as before, or a GSR goal on a GSR with no cycle. And a new link to a goal whose GSR
-- is done is refused, as a new link into a closed month is. A link already made is left alone,
-- unlinking always passes, and the goal's person is the task's assignee, as before. Everything
-- else, and every message, is as it was.
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
      select g.company_id, g.employee_id, g.scope, g.cycle_id, c.kind, g.review_id into v_goal
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
      if v_goal.scope <> 'cycle'
         or ((v_goal.cycle_id is null or v_goal.kind is distinct from 'gsr') and v_goal.review_id is null) then
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
      if (tg_op = 'INSERT' or new.goal_id is distinct from old.goal_id)
         and exists (select 1 from public.reviews r
                      where r.id = v_goal.review_id
                        and r.cycle_id is null
                        and r.status = 'complete') then
        raise exception 'That GSR is done, so its goals take no new tasks.'
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
-- 12. Moving a company over
-- ---------------------------------------------------------------------------------------
-- When a company's gsr_mode moves from 'periods' to 'on_demand' (section 2's hand-run change),
-- its past GSR months are converted in the same write:
--   * every review in one of its GSR months becomes a GSR on its own: started_on is the month's
--     first day, and status, score, completion time, feedback and pillar snapshot stay as they
--     are. A complete one is done on the day it was marked complete or on the month's last day,
--     whichever came first (the last day when it carries no completion time), so a month locked
--     after it ended stays in its month and a GSR marked done inside a running month counts on
--     that day. One not complete is an open GSR,
--     whatever the state of its month;
--   * that person's goals in that month move onto it, their notes with them;
--   * a goal in a month whose person has no review there gets a not-started GSR of its own, dated
--     the month's first day, in the company the month was in;
--   * the company's GSR months are deleted, and their left-out rows with them. Scored review
--     cycles, their reviews and their line items are not touched.
-- Before any of it, a private copy of every row removed or re-pointed is kept, whole, so a move
-- made in error can be put back by hand: each month ('cycle'), each left-out row ('omission'),
-- each converted review as it was ('review_cycle', which names its month) and each moved goal as
-- it was ('goal_cycle'). A GSR the conversion created is one a goal now points at with no
-- 'review_cycle' row of its own.
--
-- The guards that would refuse this stand aside only while the transaction-local flag
-- hub.gsr_conversion is '1' (the pattern of hub.task_internal and hub.division_cleanup): the
-- review guards (guard_review_cycle, guard_review_employee_fields, guard_signed_off_review,
-- stamp_standalone_gsr), the goal and note freeze guards, and the company a GSR and its goals
-- take (inherit_company_from_cycle, inherit_goal_company). Only
-- private.convert_gsrs_to_on_demand sets it, and it puts it back to '' before it returns, on
-- every path, so a later statement in the same transaction is judged as usual. No signed-in
-- account can run the conversion, its trigger, or read the copy.

create table if not exists private.gsr_conversion_backup (
  id           bigint generated always as identity primary key,
  company_id   uuid not null,
  converted_at timestamptz not null default now(),
  what         text not null,
  payload      jsonb not null
);
alter table private.gsr_conversion_backup drop constraint if exists gsr_conversion_backup_what_check;
alter table private.gsr_conversion_backup add constraint gsr_conversion_backup_what_check
  check (what in ('cycle', 'omission', 'review_cycle', 'goal_cycle'));
alter table private.gsr_conversion_backup enable row level security;
revoke all on table private.gsr_conversion_backup from public, anon, authenticated;

-- The 0029 body with one line added first: while a company moves over it stands aside, so a
-- signed-off GSR month can be taken out of its month with its sign-off as it was. Re-pasting 0029
-- after this takes the line back; pasting this again puts it right.
create or replace function public.guard_signed_off_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_probe public.reviews%rowtype;
begin
  if coalesce(current_setting('hub.gsr_conversion', true), '') = '1' then return new; end if;
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

-- The conversion. It runs only for a company already on demand, so it can never reach a company
-- on periods, and running it again finds no month and changes nothing. It works with no signed-in
-- user: the SQL editor's change of gsr_mode is what calls it.
create or replace function private.convert_gsrs_to_on_demand(p_company uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tz     text;
  v_row    record;
  v_review uuid;
begin
  select c.time_zone into v_tz
    from public.companies c
   where c.id = p_company and c.gsr_mode = 'on_demand';
  if not found then
    raise exception 'GSRs on demand are not turned on for this company.'
      using errcode = 'check_violation';
  end if;

  -- Deleting a month deletes whatever still points at it. Only a monthly goal can move onto a
  -- GSR, so any other goal in a month stops the move before anything changes.
  if exists (
    select 1
      from public.goals g
      join public.review_cycles c on c.id = g.cycle_id
     where c.company_id = p_company and c.kind = 'gsr' and g.scope <> 'cycle'
  ) then
    raise exception 'A goal in one of this company''s GSR months is not a monthly goal, so it cannot move onto a GSR. Settle it by hand first.'
      using errcode = 'check_violation';
  end if;

  perform set_config('hub.gsr_conversion', '1', true);
  begin
    -- The private copy, whole rows as they are now.
    insert into private.gsr_conversion_backup (company_id, what, payload)
    select p_company, 'cycle', to_jsonb(c)
      from public.review_cycles c
     where c.company_id = p_company and c.kind = 'gsr'
     order by c.period_start, c.id;
    insert into private.gsr_conversion_backup (company_id, what, payload)
    select p_company, 'omission', to_jsonb(o)
      from public.cycle_omissions o
      join public.review_cycles c on c.id = o.cycle_id
     where c.company_id = p_company and c.kind = 'gsr'
     order by c.period_start, o.employee_id;
    insert into private.gsr_conversion_backup (company_id, what, payload)
    select p_company, 'review_cycle', to_jsonb(r)
      from public.reviews r
      join public.review_cycles c on c.id = r.cycle_id
     where c.company_id = p_company and c.kind = 'gsr'
     order by c.period_start, r.id;
    insert into private.gsr_conversion_backup (company_id, what, payload)
    select p_company, 'goal_cycle', to_jsonb(g)
      from public.goals g
      join public.review_cycles c on c.id = g.cycle_id
     where c.company_id = p_company and c.kind = 'gsr'
     order by c.period_start, g.id;

    -- Each month's reviews, and with each its person's goals in that month.
    for v_row in
      select r.id, r.employee_id, r.cycle_id, c.period_start, c.period_end
        from public.reviews r
        join public.review_cycles c on c.id = r.cycle_id
       where c.company_id = p_company and c.kind = 'gsr'
       order by c.period_start, r.id
    loop
      update public.reviews r
         set cycle_id   = null,
             started_on = v_row.period_start,
             done_on    = case when r.status = 'complete'
                               then least(v_row.period_end,
                                          coalesce((r.completed_at at time zone v_tz)::date, v_row.period_end))
                          end
       where r.id = v_row.id;
      update public.goals g
         set review_id = v_row.id,
             cycle_id  = null
       where g.cycle_id = v_row.cycle_id
         and g.employee_id = v_row.employee_id;
    end loop;

    -- Goals left in a month belong to someone with no review there: a not-started GSR each.
    for v_row in
      select distinct g.cycle_id, g.employee_id, c.company_id, c.period_start
        from public.goals g
        join public.review_cycles c on c.id = g.cycle_id
       where c.company_id = p_company and c.kind = 'gsr'
       order by c.period_start, g.employee_id
    loop
      insert into public.reviews (company_id, employee_id, status, started_on)
      values (v_row.company_id, v_row.employee_id, 'not_started', v_row.period_start)
      returning id into v_review;
      update public.goals g
         set review_id = v_review,
             cycle_id  = null
       where g.cycle_id = v_row.cycle_id
         and g.employee_id = v_row.employee_id;
    end loop;

    -- Nothing but left-out rows may go with the months.
    if exists (
         select 1 from public.reviews r join public.review_cycles c on c.id = r.cycle_id
          where c.company_id = p_company and c.kind = 'gsr'
       )
       or exists (
         select 1 from public.goals g join public.review_cycles c on c.id = g.cycle_id
          where c.company_id = p_company and c.kind = 'gsr'
       ) then
      raise exception 'A review or goal is still in one of this company''s GSR months, so the move stops here.';
    end if;

    delete from public.review_cycles c
     where c.company_id = p_company and c.kind = 'gsr';
  exception when others then
    perform set_config('hub.gsr_conversion', '', true);
    raise;
  end;
  perform set_config('hub.gsr_conversion', '', true);
end;
$$;
revoke all on function private.convert_gsrs_to_on_demand(uuid) from public, anon, authenticated;

-- The trigger: after the change of gsr_mode from periods to on demand, convert that company. What
-- reaches here has passed section 2, so it is the SQL editor naming the company.
create or replace function private.convert_gsrs_on_gsr_mode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.convert_gsrs_to_on_demand(new.id);
  return null;
end;
$$;
revoke all on function private.convert_gsrs_on_gsr_mode() from public, anon, authenticated;

drop trigger if exists companies_convert_gsrs on public.companies;
create trigger companies_convert_gsrs
  after update of gsr_mode on public.companies
  for each row
  when (old.gsr_mode = 'periods' and new.gsr_mode = 'on_demand')
  execute function private.convert_gsrs_on_gsr_mode();
