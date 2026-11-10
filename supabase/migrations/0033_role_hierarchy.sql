-- 0033_role_hierarchy.sql
-- Adds two role values, Owner and Manager, with ranked grants, and makes reports_to sound.
--
-- What changes:
--   * profiles.role and invitations.role accept owner, admin, manager and employee.
--   * owner and admin both keep today's admin meaning everywhere (private.is_company_admin()
--     widens to both, so can_manage_company, the profiles policies and the guards follow).
--     manager is employee-level until the capability matrix arrives.
--   * Grants are ranked (employee 1, manager 2, admin 3, owner 4): only an owner or Rococo makes
--     someone an owner, nobody grants a role above their own, and nobody changes the role or
--     access of someone ranked above them. The same rule guards roster inserts and invitations.
--   * The rule holds for people who have not signed in yet, which is how an owner usually
--     starts: nobody removes someone ranked above them, and an invitation for a roster row
--     counts as a grant of that person's rank, because signing in with it claims the row. Since
--     0028 the claim goes by address, so an invitation is for the row it names or, naming
--     nobody, for the unclaimed row at its address. An invitation only names someone on its own
--     company's roster who has not signed in yet (0028's guard_invitation_target), and every
--     change to an invitation is checked, not only a change of role.
--   * reports_to can no longer point at the person themselves, at another company, or round in
--     a loop, and a move to another company clears the reporting lines that would cross it. A
--     line is judged when it changes, so one saved before this never blocks a first sign-in.
--
-- No existing row is rewritten: owners are set by hand once this is applied. Every rebuilt body
-- is copied from its latest version (is_company_admin from 0013, guard_profile_fields from 0029)
-- with only the lines named below added. Main's 0028 (guard_invitation_target, the address
-- rule, claim by address) and 0029 (move_employee_company, clear_manager_on_move) stay as they
-- are; the guards here add the rank rules on top and refuse nothing those two let the app do.
--
-- Numbered 0033 to follow main's 0028 and 0029, which are applied live, and this branch's 0030
-- to 0032. Paste after 0031, and so after main's 0028 and 0029, whose guard_profile_fields body
-- section 5 extends. It does not depend on 0032, so it may go before or after it; the
-- README's release checklist pastes it first. Idempotent.

-- 1. Pre-check ------------------------------------------------------------------------------
-- Reports only, fixes nothing. The reports_to guard below judges a line only when it changes,
-- so a line listed here keeps working, a first sign-in included, until someone changes it. Each
-- one is still worth clearing by hand; the README's release checklist lists them as rows.
do $$
declare
  r record;
begin
  for r in
    select p.id as person, m.id as manager
      from public.profiles p
      join public.profiles m on m.id = p.reports_to
     where m.company_id is distinct from p.company_id
  loop
    raise notice 'Cross-company reports_to: % reports to %', r.person, r.manager;
  end loop;

  for r in
    with recursive chain (start_id, id, depth) as (
      select p.id, p.reports_to, 1
        from public.profiles p
       where p.reports_to is not null
      union
      select c.start_id, p.reports_to, c.depth + 1
        from public.profiles p
        join chain c on p.id = c.id
       where p.reports_to is not null and c.depth < 50
    )
    select distinct start_id from chain where id = start_id
  loop
    raise notice 'Reporting loop through %', r.start_id;
  end loop;
end $$;

-- 2. Role values ----------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('owner', 'admin', 'manager', 'employee'));

alter table public.invitations drop constraint if exists invitations_role_check;
alter table public.invitations
  add constraint invitations_role_check check (role in ('owner', 'admin', 'manager', 'employee'));

-- 3. An owner is an admin -------------------------------------------------------------------
-- The 0013 body (people found by their account, so roster-first admins keep admin), with only
-- the role test widened.
create or replace function private.is_company_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role in ('owner', 'admin') from public.profiles where user_id = auth.uid() and is_active),
    false
  )
$$;
revoke all on function private.is_company_admin() from public, anon;
grant execute on function private.is_company_admin() to authenticated;

-- 4. Rank helpers ---------------------------------------------------------------------------
-- An unknown role ranks 0, so it never outranks anyone.
create or replace function private.role_rank(r text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case r when 'employee' then 1 when 'manager' then 2 when 'admin' then 3 when 'owner' then 4 else 0 end
$$;
revoke all on function private.role_rank(text) from public, anon;
grant execute on function private.role_rank(text) to authenticated;

create or replace function private.is_company_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role = 'owner' from public.profiles where user_id = auth.uid() and is_active), false)
$$;
revoke all on function private.is_company_owner() from public, anon;
grant execute on function private.is_company_owner() to authenticated;

create or replace function private.auth_role_rank()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select private.role_rank(role) from public.profiles where user_id = auth.uid() and is_active), 0)
$$;
revoke all on function private.auth_role_rank() from public, anon;
grant execute on function private.auth_role_rank() to authenticated;

-- 5. Ranked role changes --------------------------------------------------------------------
-- The 0029 body (main's latest: the foreign key clear pass-through, the refusal of a Rococo
-- admin's row, and the refusal of a deactivated person's own row, all ahead of the company-admin
-- branch), with only the ranked grant checks added inside the company-admin branch, after the
-- refusal to change your own role. Built on 0029 rather than 0018 so pasting this after 0029
-- keeps every one of its protections.
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

-- 6. Ranked roster inserts and removals -----------------------------------------------------
-- The bypass keeps handle_new_user (no auth.uid() inside the auth trigger) and Rococo working.
create or replace function public.guard_profile_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or private.is_rococo_admin() then
    return new;
  end if;
  if new.role = 'owner' and not private.is_company_owner() then
    raise exception 'Only an owner or Rococo can make someone an owner.';
  end if;
  if private.role_rank(new.role) > private.auth_role_rank() then
    raise exception 'You cannot grant a role above your own.';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_insert on public.profiles;
create trigger profiles_guard_insert
  before insert on public.profiles
  for each row execute function public.guard_profile_insert();

-- An admin may remove anyone who has never signed in (0013), and that cascades their reviews,
-- goals, KPIs and compensation, so removal is ranked as well.
create or replace function public.guard_profile_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or private.is_rococo_admin() then
    return old;
  end if;
  if private.role_rank(old.role) > private.auth_role_rank() then
    raise exception 'You cannot remove someone ranked above you.';
  end if;
  return old;
end;
$$;

drop trigger if exists profiles_guard_delete on public.profiles;
create trigger profiles_guard_delete
  before delete on public.profiles
  for each row execute function public.guard_profile_delete();

-- 7. Ranked invitations ---------------------------------------------------------------------
-- Signing in with a pending invitation for a roster row claims that row, role and all
-- (handle_new_user, 0028), so inviting one grants that person's rank. Since 0028 the row is found
-- by its address, never by profile_id: an invitation is for the unclaimed row it names or, naming
-- nobody, for the unclaimed row at its address, on its own company's roster or parked in No
-- company. Nobody invites someone ranked above them, either way. Every insert and update is
-- checked, so moving an invitation to another address is judged like sending a new one.
-- Who an invitation may name at all (an unclaimed person on this company's roster at the same
-- address, or a parked one for Rococo), the address rule and the accepted_at rule are 0028's
-- guard_invitation_target, which fires after this one; they are not repeated here, so a refusal
-- reads the same whichever guard is the reason.
create or replace function public.guard_invitation_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or private.is_rococo_admin() then
    return new;
  end if;
  if new.role = 'owner' and not private.is_company_owner() then
    raise exception 'Only an owner or Rococo can make someone an owner.';
  end if;
  if private.role_rank(new.role) > private.auth_role_rank() then
    raise exception 'You cannot grant a role above your own.';
  end if;
  if new.accepted_at is null
     and exists (
       select 1 from public.profiles p
        where p.user_id is null
          and (p.company_id = new.company_id or p.company_id is null)
          and (p.id = new.profile_id
               or (new.profile_id is null and lower(p.email) = lower(new.email)))
          and private.role_rank(p.role) > private.auth_role_rank()
     ) then
    raise exception 'You cannot invite someone ranked above you.';
  end if;
  if tg_op = 'UPDATE' and private.role_rank(old.role) > private.auth_role_rank() then
    raise exception 'You cannot change an invitation for someone ranked above you.';
  end if;
  return new;
end;
$$;

drop trigger if exists invitations_guard_role on public.invitations;
create trigger invitations_guard_role
  before insert or update on public.invitations
  for each row execute function public.guard_invitation_role();

-- 8. Sound reporting lines ------------------------------------------------------------------
-- No auth bypass: nobody, Rococo included, can save a reporting line that is broken. A move to
-- another company drops the mover's own line when their manager stays behind. 0029's
-- clear_manager_on_move does the same and fires first (same timing, earlier name), so this finds
-- the line already cleared; it stays here so the guard never refuses a move whatever the order. A line is judged
-- only when it or the person's company changes: signing in claims a roster row with an update
-- that names company_id (handle_new_user, 0014), and a line the pre-check lists must never stop
-- that person from signing in.
create or replace function public.guard_reports_to()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_manager_company uuid;
  v_loop boolean;
begin
  if tg_op = 'UPDATE' and new.reports_to is not distinct from old.reports_to
     and new.company_id is not distinct from old.company_id then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.company_id is distinct from old.company_id and new.reports_to is not null
     and not exists (select 1 from public.profiles m where m.id = new.reports_to and m.company_id = new.company_id) then
    new.reports_to := null;
  end if;
  if new.reports_to is null then
    return new;
  end if;
  if new.reports_to = new.id then
    raise exception 'A person cannot report to themselves.';
  end if;
  select m.company_id into v_manager_company from public.profiles m where m.id = new.reports_to;
  if v_manager_company is distinct from new.company_id then
    raise exception 'That person is in another company.';
  end if;
  with recursive chain (id, depth) as (
    select new.reports_to, 1
    union
    select p.reports_to, c.depth + 1
      from public.profiles p join chain c on p.id = c.id
     where p.reports_to is not null and c.depth < 50
  )
  select exists (select 1 from chain where id = new.id) into v_loop;
  if v_loop then
    raise exception 'That would make a reporting loop.';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_reports_to on public.profiles;
create trigger profiles_guard_reports_to
  before insert or update of reports_to, company_id on public.profiles
  for each row execute function public.guard_reports_to();

-- 9. A move clears the lines that would cross companies --------------------------------------
-- The people who reported to the mover and stay behind lose that line. move_employee_company
-- (latest body 0029, main) clears the same lines in the same write, and this trigger fires just
-- before it (same timing, earlier name), so whichever runs second finds nothing left to clear.
-- Kept apart from move_employee_company, which is left alone.
create or replace function public.clear_reports_to_on_move()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set reports_to = null
   where reports_to = new.id and company_id is distinct from new.company_id;
  return null;
end;
$$;

drop trigger if exists profiles_move_clears_reports_to on public.profiles;
create trigger profiles_move_clears_reports_to
  after update of company_id on public.profiles
  for each row
  when (old.company_id is distinct from new.company_id)
  execute function public.clear_reports_to_on_move();

-- 10. Trigger functions are not an API ------------------------------------------------------
revoke execute on function public.guard_profile_insert(), public.guard_profile_delete(),
  public.guard_invitation_role(), public.guard_reports_to(), public.clear_reports_to_on_move()
  from public, anon, authenticated;
revoke execute on function public.guard_profile_fields() from public, anon, authenticated;
