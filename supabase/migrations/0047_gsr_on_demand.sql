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
--
-- Kept for everyone from 0046, because the live schema is built on it and it changes nothing a
-- person can see or do: review_cycles.kind, the duplicate-cycle key that includes it, and
-- profiles.gsr_cadence with the audit of its changes.
--
-- Rebuilt functions are copied from their latest bodies (guard_company_fields from 0042;
-- guard_review_cycle_period, guard_review_employee_fields and guard_profile_fields from 0046) and
-- changed only on the lines named here. The messages people already see stay word for word.
--
-- Paste after 0046. Re-pasting 0046 after this brings back everything section 3 removes and
-- section 4 narrows; pasting this again puts it right. Idempotent.

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
  if new.gsr_mode = 'on_demand'
     and current_setting('hub.gsr_on_demand_for', true) is distinct from new.slug then
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
-- it read a GSR cycle. Everything else, and every message, is as it was.
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
