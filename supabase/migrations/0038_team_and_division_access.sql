-- 0038_team_and_division_access.sql
-- Who can see whom: managers see the people below them in the reporting chain, and admins and
-- managers see the divisions an owner gives them. Until now a person's records were the person's
-- and their company admins', and divisions were labels on screens; from here the database decides
-- who reads and writes each person's records, as the design in
-- docs/superpowers/specs/2026-11-18-team-division-access-design.md sets out (its final section,
-- "Revisions after the design review", wins wherever the two disagree).
--
-- What changes:
--   1. profiles gains division_ids (where a person works, any set of the company's divisions),
--      view_all_divisions and view_division_ids (what an admin or manager may see). division_id
--      stays one more release as a mirror of division_ids. Existing admins start with every
--      division, so nothing changes for them until an owner narrows it. The backfill runs only
--      when the columns are created, so pasting this again never widens access an owner narrowed.
--   2. Helpers in private answer three questions for the signed-in person: whom they see
--      (viewable_person_ids), whom they manage like an admin (manageable_person_ids) and whom they
--      lead like a manager (led_person_ids), built on their reporting chain (chain_ids, team_ids)
--      and on has_full_scope (an owner, Rococo, or an admin who sees every division). Each one
--      returns nothing, never an error, for Rococo, an inactive person or someone with no company.
--   3. profiles: a person is read by themselves, Rococo, and whoever sees them. The read rule is
--      written over the row's own columns (sees_profile), so a new row's RETURNING is judged on
--      what it says. Admins edit the people they manage.
--   4. The profile guards place people: an admin who does not see every division places people
--      only in divisions they see, points reports_to only at people they see, and changes a
--      person's manager only when they already see that person's whole chain. Only an owner or
--      Rococo sets view access, and a role change by anyone else clears it. A person edits only
--      their own name, title and phone; any column added later is an admin's by default.
--   5. profile_directory: the names and titles every member of a company may read, kept by a
--      trigger, for screens that name someone without being about them.
--   6. Every table that holds a person's records reads and writes through those sets. Pay
--      (compensation_items, employee_financials) is read through the managed set only, so a
--      manager never reads a report's pay. A manager writes a report's monthly goals and goal
--      notes and may open a report's monthly GSR; ratings, sign-off and locking stay with admins.
--      goal_private and the notes of a yearly or BHAG goal stay the owner's alone.
--   7. invitations follow the person: an admin reads and writes an invitation only for someone
--      they manage.
--   8. company_divisions: only a full-scope admin adds, renames or removes one; a division
--      someone still works in cannot be removed; removing one strips it from everyone's view.
--   9. review_cycles: any admin starts one; only a full-scope admin changes, closes or removes
--      one, because a cycle carries every person's reviews and goals with it.
--  10. The three new columns join the audited ones on profiles.
--
-- Tasks and task steps are not touched here: 0039 moves them onto the led set along with the GSR
-- and task link work.
--
-- Rebuilt functions are copied from their latest bodies (guard_profile_fields, guard_profile_insert
-- and guard_profile_division from 0035) with only the lines this migration names added.
--
-- Paste after 0037 and before 0039, then deploy the app the same day: the new client reads the
-- new columns and the directory, so it must not go out before this. Idempotent.

-- ---------------------------------------------------------------------------------------
-- 1. Columns, and the one-shot backfill
-- ---------------------------------------------------------------------------------------
-- Tested before add column: the backfill belongs to the paste that creates each column and to no
-- later one. It is not an edit anybody made, so the guards, the audit log, the directory sync and
-- updated_at stay out of it, as with 0035's created_by backfill.
-- backfill:start
do $$
declare
  v_new_division_ids boolean := not exists (
    select 1 from pg_attribute
     where attrelid = 'public.profiles'::regclass and attname = 'division_ids' and not attisdropped
  );
  v_new_view_all boolean := not exists (
    select 1 from pg_attribute
     where attrelid = 'public.profiles'::regclass and attname = 'view_all_divisions' and not attisdropped
  );
begin
  alter table public.profiles add column if not exists division_ids uuid[] not null default '{}';
  alter table public.profiles add column if not exists view_all_divisions boolean not null default false;
  alter table public.profiles add column if not exists view_division_ids uuid[] not null default '{}';

  if v_new_division_ids or v_new_view_all then
    alter table public.profiles disable trigger user;
    if v_new_division_ids then
      update public.profiles
         set division_ids = array[division_id]
       where division_id is not null and division_ids = '{}';
    end if;
    if v_new_view_all then
      update public.profiles set view_all_divisions = true where role = 'admin';
    end if;
    alter table public.profiles enable trigger user;
  end if;
end $$;
-- backfill:end

create index if not exists profiles_division_ids_idx on public.profiles using gin (division_ids);
create index if not exists profiles_reports_to_idx on public.profiles (reports_to);

-- ---------------------------------------------------------------------------------------
-- 2. The helpers
-- ---------------------------------------------------------------------------------------
-- Security definer and owned like the other private helpers, so reading profiles from a policy on
-- profiles never recurses. 0028 revokes EXECUTE on every new function by default, and policies
-- call these as the signed-in person, so each one is granted to authenticated.

-- Everyone below a person in the reporting chain, at any depth up to 50, inside the person's own
-- company (a line that crossed companies before 0033 reaches nobody). Active and inactive alike:
-- an inactive person's history stays with their manager.
create or replace function private.chain_ids(p_root uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with recursive chain (id, depth) as (
    select p.id, 1
      from public.profiles p
      join public.profiles r on r.id = p_root
     where p.reports_to = p_root
       and p.company_id = r.company_id
    union all
    select p.id, c.depth + 1
      from chain c
      join public.profiles p on p.reports_to = c.id
     where c.depth < 50
       and p.company_id = (select r.company_id from public.profiles r where r.id = p_root)
  )
  select distinct id from chain where id <> p_root
$$;
revoke all on function private.chain_ids(uuid) from public, anon;
grant execute on function private.chain_ids(uuid) to authenticated, service_role;

-- The signed-in person's chain, if they lead at all: managers, admins and owners do, and an
-- employee whom someone reports to does not. Nobody leads someone ranked at or above them, except
-- an owner.
create or replace function private.team_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
    from public.profiles me
    cross join lateral private.chain_ids(me.id) as c (id)
    join public.profiles p on p.id = c.id
   where me.user_id = (select auth.uid())
     and me.is_active
     and not me.is_rococo_admin
     and me.company_id is not null
     and me.role in ('manager', 'admin', 'owner')
     and (me.role = 'owner' or private.role_rank(p.role) < private.role_rank(me.role))
$$;
revoke all on function private.team_ids() from public, anon;
grant execute on function private.team_ids() to authenticated, service_role;

-- A full-scope admin reads and writes every row of their company: an owner, a Rococo admin, or an
-- admin who sees every division.
create or replace function private.has_full_scope()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_rococo_admin()
      or coalesce(
           (select p.company_id is not null
                   and (p.role = 'owner' or (p.role = 'admin' and p.view_all_divisions))
              from public.profiles p
             where p.user_id = (select auth.uid()) and p.is_active and not p.is_rococo_admin),
           false
         )
$$;
revoke all on function private.has_full_scope() from public, anon;
grant execute on function private.has_full_scope() to authenticated, service_role;

-- Whether the signed-in person sees a profile, judged from the profile's own columns so a row
-- being inserted or changed is judged on what it will say. The one statement of the rule for one
-- row; viewable_person_ids below is the same rule over the whole company, and the 0038 tests hold
-- the two to the same answer.
--   * themselves, always; an owner, everyone in the company;
--   * an admin: everyone with no division, and everyone when they see every division;
--   * an admin or manager: people ranked below them who are in their chain or in a division they
--     see. A manager's division view shows employees only.
create or replace function private.sees_profile(
  p_id           uuid,
  p_company      uuid,
  p_role         text,
  p_division_ids uuid[],
  p_reports_to   uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me record;
begin
  select p.id, p.company_id, p.role, p.view_all_divisions, p.view_division_ids
    into v_me
    from public.profiles p
   where p.user_id = (select auth.uid()) and p.is_active and not p.is_rococo_admin;
  if not found or v_me.company_id is null or p_company is distinct from v_me.company_id then
    return false;
  end if;
  if p_id = v_me.id or v_me.role = 'owner' then
    return true;
  end if;
  if v_me.role = 'admin'
     and (v_me.view_all_divisions or coalesce(cardinality(p_division_ids), 0) = 0) then
    return true;
  end if;
  if v_me.role not in ('admin', 'manager')
     or private.role_rank(p_role) >= private.role_rank(v_me.role) then
    return false;
  end if;
  return v_me.view_all_divisions
      or coalesce(p_division_ids && v_me.view_division_ids, false)
      or (p_reports_to is not null
          and (p_reports_to = v_me.id
               or exists (select 1 from private.chain_ids(v_me.id) c (id) where c.id = p_reports_to)));
end;
$$;
revoke all on function private.sees_profile(uuid, uuid, text, uuid[], uuid) from public, anon;
grant execute on function private.sees_profile(uuid, uuid, text, uuid[], uuid) to authenticated, service_role;

-- The profile ids of the signed-in person's company they may read: sees_profile over every row.
create or replace function private.viewable_person_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select p.id, p.company_id, p.role, p.view_all_divisions, p.view_division_ids
      from public.profiles p
     where p.user_id = (select auth.uid())
       and p.is_active
       and not p.is_rococo_admin
       and p.company_id is not null
  ),
  chain as (
    select c.id from me cross join lateral private.chain_ids(me.id) as c (id)
  )
  select p.id
    from public.profiles p
    join me on p.company_id = me.company_id
   where p.id = me.id
      or me.role = 'owner'
      or (me.role = 'admin' and (me.view_all_divisions or cardinality(p.division_ids) = 0))
      or (me.role in ('admin', 'manager')
          and private.role_rank(p.role) < private.role_rank(me.role)
          and (me.view_all_divisions
               or p.division_ids && me.view_division_ids
               or p.reports_to = me.id
               or p.reports_to in (select chain.id from chain)))
$$;
revoke all on function private.viewable_person_ids() from public, anon;
grant execute on function private.viewable_person_ids() to authenticated, service_role;

-- Admin-level powers: an owner and an admin who sees every division manage the whole company, any
-- other admin manages everyone they see, and managers and employees manage nobody.
create or replace function private.manageable_person_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select p.company_id, p.role, p.view_all_divisions
      from public.profiles p
     where p.user_id = (select auth.uid())
       and p.is_active
       and not p.is_rococo_admin
       and p.company_id is not null
  )
  select p.id
    from public.profiles p
    join me on p.company_id = me.company_id
   where me.role = 'owner' or (me.role = 'admin' and me.view_all_divisions)
  union
  select v.id
    from private.viewable_person_ids() as v (id)
   where exists (select 1 from me where me.role = 'admin')
$$;
revoke all on function private.manageable_person_ids() from public, anon;
grant execute on function private.manageable_person_ids() to authenticated, service_role;

-- Manager-level powers (monthly goals and their notes, opening a monthly GSR, and tasks in 0039):
-- everyone the signed-in person manages, and their team.
create or replace function private.led_person_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id from private.manageable_person_ids() as m (id)
  union
  select t.id from private.team_ids() as t (id)
$$;
revoke all on function private.led_person_ids() from public, anon;
grant execute on function private.led_person_ids() to authenticated, service_role;

-- ---------------------------------------------------------------------------------------
-- 3. The profile guards
-- ---------------------------------------------------------------------------------------
-- BEFORE triggers on profiles fire in name order: profiles_clear_manager_on_move,
-- profiles_guard_address, profiles_guard_division, profiles_guard_fields (update) or
-- profiles_guard_insert (insert), profiles_guard_job_role, profiles_guard_reports_to,
-- profiles_set_updated_at. The division mirror therefore runs before either placement check, so an
-- older client writing division_id is judged on the division_ids it turns into.

-- The 0035 body, with the mirror and the array checks added. If division_ids changed it wins and
-- division_id follows (the single division, or null); otherwise a change to division_id from an
-- older client becomes division_ids, unless the person works in more than one division, which an
-- older client cannot show. Every id is one of the person's company's divisions, once, with no
-- empty entries. A move to another company clears every division column and the view access with
-- them. While the division cleanup runs (hub.division_cleanup, section 8) the ids that remain are
-- left unjudged.
create or replace function public.guard_profile_division()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cleanup boolean := coalesce(current_setting('hub.division_cleanup', true), '') = '1';
begin
  new.division_ids := coalesce(new.division_ids, '{}');
  new.view_division_ids := coalesce(new.view_division_ids, '{}');

  if tg_op = 'UPDATE' and new.company_id is distinct from old.company_id then
    new.division_id := null;
    new.division_ids := '{}';
    new.can_view_divisions := false;
    new.view_all_divisions := false;
    new.view_division_ids := '{}';
    return new;
  end if;

  if tg_op = 'INSERT' then
    if cardinality(new.division_ids) = 0 and new.division_id is not null then
      new.division_ids := array[new.division_id];
    end if;
  elsif new.division_ids is distinct from old.division_ids then
    null;
  elsif new.division_id is distinct from old.division_id then
    if cardinality(old.division_ids) > 1 then
      raise exception 'This person works in more than one division. Reload the page to change their divisions.'
        using errcode = 'check_violation';
    end if;
    new.division_ids := case when new.division_id is null then '{}'::uuid[] else array[new.division_id] end;
  end if;
  new.division_id := case when cardinality(new.division_ids) = 1 then new.division_ids[1] end;

  if v_cleanup then
    return new;
  end if;
  if tg_op = 'INSERT'
     or new.division_ids is distinct from old.division_ids
     or new.view_division_ids is distinct from old.view_division_ids then
    if array_position(new.division_ids, null) is not null
       or array_position(new.view_division_ids, null) is not null then
      raise exception 'A list of divisions cannot have an empty entry.'
        using errcode = 'check_violation';
    end if;
    if (select count(distinct d) from unnest(new.division_ids) d) <> cardinality(new.division_ids)
       or (select count(distinct d) from unnest(new.view_division_ids) d) <> cardinality(new.view_division_ids) then
      raise exception 'A division can only be listed once.'
        using errcode = 'check_violation';
    end if;
    if exists (
      select 1
        from unnest(new.division_ids || new.view_division_ids) as d (id)
       where not exists (
         select 1 from public.company_divisions cd
          where cd.id = d.id and cd.company_id = new.company_id
       )
    ) then
      raise exception 'That division belongs to another company.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_profile_division() from public, anon, authenticated;

drop trigger if exists profiles_guard_division on public.profiles;
create trigger profiles_guard_division
  before insert or update on public.profiles
  for each row execute function public.guard_profile_division();

-- The 0035 body with these additions:
--   * the division cleanup (section 8) passes like the foreign key clears: under
--     hub.division_cleanup, losing ids that no longer exist from division_ids or view_division_ids
--     is the system's write;
--   * in the company-admin branch: an admin who does not see every division edits only people they
--     manage, places people only in divisions they see (judged on what is added and what is
--     removed), never puts someone at their own rank or above into a division (they would drop out
--     of view), and changes someone's manager only when they already see that person's whole
--     chain; reports_to points only at someone the admin sees; only an owner changes view access;
--     and a role change by anyone but an owner clears it;
--   * the person's own branch is a list of what they may change (name, title, phone), compared
--     over the whole row as guard_review_employee_fields does, so a column added later is an
--     admin's by default. The familiar messages stay for the familiar cases.
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
      if old.user_id is distinct from (select auth.uid())
         and cardinality(new.division_ids) > 0
         and private.role_rank(new.role) >= private.auth_role_rank()
         and (new.division_ids is distinct from old.division_ids or new.role is distinct from old.role) then
        raise exception 'Only an owner or an admin who sees every division can put someone at your rank or above in a division.';
      end if;
    end if;

    if new.reports_to is distinct from old.reports_to then
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

-- The 0035 body with these additions: view access on a new row is an owner's or Rococo's to give;
-- reports_to points only at someone the adder sees; and an admin who does not see every division
-- places the new person only in divisions they see, and never puts someone at their own rank or
-- above into a division.
create or replace function public.guard_profile_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_view_ids uuid[];
begin
  if (select auth.uid()) is null or private.is_rococo_admin() then
    return new;
  end if;
  if new.role = 'owner' and not private.is_company_owner() then
    raise exception 'Only an owner or Rococo can make someone an owner.';
  end if;
  if private.role_rank(new.role) > private.auth_role_rank() then
    raise exception 'You cannot grant a role above your own.';
  end if;
  if new.can_view_divisions and not private.is_company_owner() then
    raise exception 'Only an owner or Rococo can choose who sees the divisions.';
  end if;
  if (new.view_all_divisions or cardinality(new.view_division_ids) > 0)
     and not private.is_company_owner() then
    raise exception 'Only an owner or Rococo can choose which divisions someone can see.';
  end if;
  if new.reports_to is not null
     and not exists (select 1 from private.viewable_person_ids() as v (id) where v.id = new.reports_to) then
    raise exception 'You can only choose a manager you can see.';
  end if;
  if not private.has_full_scope() then
    select p.view_division_ids into v_view_ids
      from public.profiles p
     where p.user_id = (select auth.uid()) and p.is_active;
    if exists (
      select 1 from unnest(new.division_ids) as d (id)
       where not (d.id = any (coalesce(v_view_ids, '{}')))
    ) then
      raise exception 'You can only place people in divisions you can see.';
    end if;
    if cardinality(new.division_ids) > 0 and private.role_rank(new.role) >= private.auth_role_rank() then
      raise exception 'Only an owner or an admin who sees every division can put someone at your rank or above in a division.';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_profile_insert() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 4. profiles policies
-- ---------------------------------------------------------------------------------------
-- Read: yourself (by account, so a deactivated person still reads their own row), Rococo, and
-- whoever sees the row by its own columns. Update: yourself (the guard keeps it to name, title and
-- phone), Rococo, or a company admin over the people they manage; the new row stays in the
-- admin's company, and where it lands is the guards' to judge. Insert and delete keep their 0013
-- shape (a roster row with no account, by a company admin), with delete narrowed to the people the
-- admin manages.

drop policy if exists "Users read own, teammates, Rococo reads all profiles" on public.profiles;
drop policy if exists "People read the profiles they can see" on public.profiles;
create policy "People read the profiles they can see"
  on public.profiles for select to authenticated
  using (
    private.is_rococo_admin()
    or user_id = (select auth.uid())
    or private.sees_profile(id, company_id, role, division_ids, reports_to)
  );

drop policy if exists "Users update own, admins update company profiles" on public.profiles;
drop policy if exists "People update their own profile, admins the people they manage" on public.profiles;
create policy "People update their own profile, admins the people they manage"
  on public.profiles for update to authenticated
  using (
    private.is_rococo_admin()
    or user_id = (select auth.uid())
    or (private.is_company_admin()
        and company_id is not null
        and company_id = private.auth_company_id()
        and id in (select private.manageable_person_ids()))
  )
  with check (
    private.is_rococo_admin()
    or user_id = (select auth.uid())
    or (private.is_company_admin()
        and company_id is not null
        and company_id = private.auth_company_id())
  );

drop policy if exists "Admins add staff" on public.profiles;
create policy "Admins add staff"
  on public.profiles for insert to authenticated
  with check (
    private.is_rococo_admin()
    or (private.is_company_admin()
        and company_id is not null
        and company_id = private.auth_company_id()
        and user_id is null
        and is_rococo_admin = false)
  );

drop policy if exists "Admins remove staff who never signed in" on public.profiles;
create policy "Admins remove staff who never signed in"
  on public.profiles for delete to authenticated
  using (
    user_id is null
    and (private.is_rococo_admin()
         or (private.is_company_admin()
             and company_id = private.auth_company_id()
             and id in (select private.manageable_person_ids())))
  );

-- ---------------------------------------------------------------------------------------
-- 5. profile_directory
-- ---------------------------------------------------------------------------------------
-- The names behind "assigned by", "signed off by" and "owner" on screens that are not about the
-- person. Every member of a company reads its directory. No address, phone, role, dates or
-- divisions: those stay on profiles, behind the access rules above. Only the trigger writes it.
-- Rococo staff have no company and are not listed.

create table if not exists public.profile_directory (
  id          uuid primary key references public.profiles (id) on delete cascade,
  company_id  uuid not null references public.companies (id) on delete cascade,
  full_name   text,
  title       text,
  is_active   boolean not null default true
);

create index if not exists profile_directory_company_id_idx on public.profile_directory (company_id);

alter table public.profile_directory enable row level security;
revoke all on public.profile_directory from anon, authenticated;
grant select on public.profile_directory to authenticated;

drop policy if exists "Members read their company directory" on public.profile_directory;
create policy "Members read their company directory"
  on public.profile_directory for select to authenticated
  using (private.is_company_member(company_id));

create or replace function public.sync_profile_directory()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.company_id is null then
    delete from public.profile_directory where id = new.id;
  else
    insert into public.profile_directory (id, company_id, full_name, title, is_active)
    values (new.id, new.company_id, new.full_name, new.title, new.is_active)
    on conflict (id) do update
      set company_id = excluded.company_id,
          full_name  = excluded.full_name,
          title      = excluded.title,
          is_active  = excluded.is_active;
  end if;
  return null;
end;
$$;
revoke execute on function public.sync_profile_directory() from public, anon, authenticated;

drop trigger if exists profiles_sync_directory on public.profiles;
create trigger profiles_sync_directory
  after insert or update of full_name, title, is_active, company_id on public.profiles
  for each row execute function public.sync_profile_directory();

insert into public.profile_directory (id, company_id, full_name, title, is_active)
select p.id, p.company_id, p.full_name, p.title, p.is_active
  from public.profiles p
 where p.company_id is not null
on conflict (id) do update
  set company_id = excluded.company_id,
      full_name  = excluded.full_name,
      title      = excluded.title,
      is_active  = excluded.is_active;
delete from public.profile_directory d
 where not exists (
   select 1 from public.profiles p where p.id = d.id and p.company_id is not null
 );

-- ---------------------------------------------------------------------------------------
-- 6. The tables that hold a person's records
-- ---------------------------------------------------------------------------------------
-- Read: the person, Rococo, and anyone in the row's company who sees the person (a full-scope
-- admin reads every row of the company, a moved person's history included). Write: Rococo, and an
-- admin of the row's company over the people they manage. Every old policy is dropped by its exact
-- name, since permissive policies add up and one left behind keeps the old reach. The harness
-- pastes 0035 to 0037 again after this, and pasting this again drops what they bring back.

-- 6a. Records read by whoever sees the person and written by admins: KPIs, deliverables and their
-- tasks, ratings, scorecard results.
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('employee_kpis',
         'Own KPIs and admins read', 'Admins create KPIs', 'Admins update KPIs', 'Admins delete KPIs'),
      ('employee_deliverables',
         'Own deliverables and admins read', 'Admins create deliverables', 'Admins update deliverables', 'Admins delete deliverables'),
      ('deliverable_tasks',
         'Own tasks and admins read', 'Admins create tasks', 'Admins update tasks', 'Admins delete tasks'),
      ('impact_scores',
         'Own impact scores and admins read', 'Admins set impact scores', 'Admins update impact scores', 'Admins delete impact scores'),
      ('metric_entries',
         'Admins and the person read metric entries', 'Admins enter metric results', 'Admins change metric results', 'Admins remove metric results')
    ) as v (tbl, old_select, old_insert, old_update, old_delete)
  loop
    execute format('drop policy if exists %I on public.%I', t.old_select, t.tbl);
    execute format('drop policy if exists %I on public.%I', t.old_insert, t.tbl);
    execute format('drop policy if exists %I on public.%I', t.old_update, t.tbl);
    execute format('drop policy if exists %I on public.%I', t.old_delete, t.tbl);

    execute format('drop policy if exists "The person and those who see them read" on public.%I', t.tbl);
    execute format($p$
      create policy "The person and those who see them read"
        on public.%I for select to authenticated
        using (
          private.is_rococo_admin()
          or employee_id = private.auth_profile_id()
          or (company_id = private.auth_company_id()
              and (private.has_full_scope()
                   or employee_id in (select private.viewable_person_ids())))
        )$p$, t.tbl);

    execute format('drop policy if exists "Admins add for the people they manage" on public.%I', t.tbl);
    execute format($p$
      create policy "Admins add for the people they manage"
        on public.%I for insert to authenticated
        with check (
          private.is_rococo_admin()
          or (company_id = private.auth_company_id()
              and (private.has_full_scope()
                   or employee_id in (select private.manageable_person_ids())))
        )$p$, t.tbl);

    execute format('drop policy if exists "Admins change for the people they manage" on public.%I', t.tbl);
    execute format($p$
      create policy "Admins change for the people they manage"
        on public.%I for update to authenticated
        using (
          private.is_rococo_admin()
          or (company_id = private.auth_company_id()
              and (private.has_full_scope()
                   or employee_id in (select private.manageable_person_ids())))
        )
        with check (
          private.is_rococo_admin()
          or (company_id = private.auth_company_id()
              and (private.has_full_scope()
                   or employee_id in (select private.manageable_person_ids())))
        )$p$, t.tbl);

    execute format('drop policy if exists "Admins remove for the people they manage" on public.%I', t.tbl);
    execute format($p$
      create policy "Admins remove for the people they manage"
        on public.%I for delete to authenticated
        using (
          private.is_rococo_admin()
          or (company_id = private.auth_company_id()
              and (private.has_full_scope()
                   or employee_id in (select private.manageable_person_ids())))
        )$p$, t.tbl);
  end loop;
end $$;

-- 6b. Pay: read and written through the managed set only, so a manager never reads a report's
-- pay or financial figures.
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('compensation_items',
         'Own compensation and admins read', 'Admins add compensation', 'Admins update compensation', 'Admins delete compensation'),
      ('employee_financials',
         'Own financials and admins read', 'Admins create financials', 'Admins update financials', 'Admins delete financials')
    ) as v (tbl, old_select, old_insert, old_update, old_delete)
  loop
    execute format('drop policy if exists %I on public.%I', t.old_select, t.tbl);
    execute format('drop policy if exists %I on public.%I', t.old_insert, t.tbl);
    execute format('drop policy if exists %I on public.%I', t.old_update, t.tbl);
    execute format('drop policy if exists %I on public.%I', t.old_delete, t.tbl);

    execute format('drop policy if exists "The person and their admins read pay" on public.%I', t.tbl);
    execute format($p$
      create policy "The person and their admins read pay"
        on public.%I for select to authenticated
        using (
          private.is_rococo_admin()
          or employee_id = private.auth_profile_id()
          or (company_id = private.auth_company_id()
              and (private.has_full_scope()
                   or employee_id in (select private.manageable_person_ids())))
        )$p$, t.tbl);

    execute format('drop policy if exists "Admins add for the people they manage" on public.%I', t.tbl);
    execute format($p$
      create policy "Admins add for the people they manage"
        on public.%I for insert to authenticated
        with check (
          private.is_rococo_admin()
          or (company_id = private.auth_company_id()
              and (private.has_full_scope()
                   or employee_id in (select private.manageable_person_ids())))
        )$p$, t.tbl);

    execute format('drop policy if exists "Admins change for the people they manage" on public.%I', t.tbl);
    execute format($p$
      create policy "Admins change for the people they manage"
        on public.%I for update to authenticated
        using (
          private.is_rococo_admin()
          or (company_id = private.auth_company_id()
              and (private.has_full_scope()
                   or employee_id in (select private.manageable_person_ids())))
        )
        with check (
          private.is_rococo_admin()
          or (company_id = private.auth_company_id()
              and (private.has_full_scope()
                   or employee_id in (select private.manageable_person_ids())))
        )$p$, t.tbl);

    execute format('drop policy if exists "Admins remove for the people they manage" on public.%I', t.tbl);
    execute format($p$
      create policy "Admins remove for the people they manage"
        on public.%I for delete to authenticated
        using (
          private.is_rococo_admin()
          or (company_id = private.auth_company_id()
              and (private.has_full_scope()
                   or employee_id in (select private.manageable_person_ids())))
        )$p$, t.tbl);
  end loop;
end $$;

-- 6c. cycle_omissions: who sits out a cycle. Read like the person's records, added and removed by
-- admins; there is no update (0034).
drop policy if exists "Admins and the person read cycle omissions" on public.cycle_omissions;
drop policy if exists "Admins leave people out of cycles" on public.cycle_omissions;
drop policy if exists "Admins add people back to cycles" on public.cycle_omissions;

drop policy if exists "The person and those who see them read" on public.cycle_omissions;
create policy "The person and those who see them read"
  on public.cycle_omissions for select to authenticated
  using (
    private.is_rococo_admin()
    or employee_id = private.auth_profile_id()
    or (company_id = private.auth_company_id()
        and (private.has_full_scope()
             or employee_id in (select private.viewable_person_ids())))
  );

drop policy if exists "Admins add for the people they manage" on public.cycle_omissions;
create policy "Admins add for the people they manage"
  on public.cycle_omissions for insert to authenticated
  with check (
    private.is_rococo_admin()
    or (company_id = private.auth_company_id()
        and (private.has_full_scope()
             or employee_id in (select private.manageable_person_ids())))
  );

drop policy if exists "Admins remove for the people they manage" on public.cycle_omissions;
create policy "Admins remove for the people they manage"
  on public.cycle_omissions for delete to authenticated
  using (
    private.is_rococo_admin()
    or (company_id = private.auth_company_id()
        and (private.has_full_scope()
             or employee_id in (select private.manageable_person_ids())))
  );

-- 6d. reviews. 0020's "Employees open their own monthly GSR" stays as it is. A leader may open a
-- led person's monthly GSR in the same narrow shape, with nothing written in the person's voice
-- (no reflection, no opening discussion); everything after that is the person's or an admin's.
drop policy if exists "Employees read own reviews, admins read company" on public.reviews;
drop policy if exists "Admins create reviews" on public.reviews;
drop policy if exists "Employees reflect, admins update reviews" on public.reviews;
drop policy if exists "Admins delete reviews" on public.reviews;

drop policy if exists "The person and those who see them read" on public.reviews;
create policy "The person and those who see them read"
  on public.reviews for select to authenticated
  using (
    private.is_rococo_admin()
    or employee_id = private.auth_profile_id()
    or (company_id = private.auth_company_id()
        and (private.has_full_scope()
             or employee_id in (select private.viewable_person_ids())))
  );

drop policy if exists "Admins add for the people they manage" on public.reviews;
create policy "Admins add for the people they manage"
  on public.reviews for insert to authenticated
  with check (
    private.is_rococo_admin()
    or (company_id = private.auth_company_id()
        and (private.has_full_scope()
             or employee_id in (select private.manageable_person_ids())))
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
         and c.cadence = 'monthly'
         and c.status = 'open'
    )
  );

drop policy if exists "The person reflects, admins change for the people they manage" on public.reviews;
create policy "The person reflects, admins change for the people they manage"
  on public.reviews for update to authenticated
  using (
    private.is_rococo_admin()
    or employee_id = private.auth_profile_id()
    or (company_id = private.auth_company_id()
        and (private.has_full_scope()
             or employee_id in (select private.manageable_person_ids())))
  )
  with check (
    private.is_rococo_admin()
    or employee_id = private.auth_profile_id()
    or (company_id = private.auth_company_id()
        and (private.has_full_scope()
             or employee_id in (select private.manageable_person_ids())))
  );

drop policy if exists "Admins remove for the people they manage" on public.reviews;
create policy "Admins remove for the people they manage"
  on public.reviews for delete to authenticated
  using (
    private.is_rococo_admin()
    or (company_id = private.auth_company_id()
        and (private.has_full_scope()
             or employee_id in (select private.manageable_person_ids())))
  );

-- 6e. A review's line items, ratings and project notes reach the person through their review.
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('review_scores',
         'Employees read own scores, admins read company', 'Admins create scores', 'Admins update scores', 'Admins delete scores'),
      ('review_project_notes',
         'Admins and the person read review project notes', 'Admins add review project notes', 'Admins change review project notes', 'Admins remove review project notes')
    ) as v (tbl, old_select, old_insert, old_update, old_delete)
  loop
    execute format('drop policy if exists %I on public.%I', t.old_select, t.tbl);
    execute format('drop policy if exists %I on public.%I', t.old_insert, t.tbl);
    execute format('drop policy if exists %I on public.%I', t.old_update, t.tbl);
    execute format('drop policy if exists %I on public.%I', t.old_delete, t.tbl);

    execute format('drop policy if exists "The person and those who see them read" on public.%I', t.tbl);
    execute format($p$
      create policy "The person and those who see them read"
        on public.%1$I for select to authenticated
        using (
          private.is_rococo_admin()
          or (company_id = private.auth_company_id() and private.has_full_scope())
          or exists (
            select 1 from public.reviews r
             where r.id = %1$I.review_id
               and (r.employee_id = private.auth_profile_id()
                    or (r.company_id = private.auth_company_id()
                        and r.employee_id in (select private.viewable_person_ids())))
          )
        )$p$, t.tbl);

    execute format('drop policy if exists "Admins add for the people they manage" on public.%I', t.tbl);
    execute format($p$
      create policy "Admins add for the people they manage"
        on public.%1$I for insert to authenticated
        with check (
          private.is_rococo_admin()
          or (company_id = private.auth_company_id()
              and (private.has_full_scope()
                   or exists (
                     select 1 from public.reviews r
                      where r.id = %1$I.review_id
                        and r.employee_id in (select private.manageable_person_ids())
                   )))
        )$p$, t.tbl);

    execute format('drop policy if exists "Admins change for the people they manage" on public.%I', t.tbl);
    execute format($p$
      create policy "Admins change for the people they manage"
        on public.%1$I for update to authenticated
        using (
          private.is_rococo_admin()
          or (company_id = private.auth_company_id()
              and (private.has_full_scope()
                   or exists (
                     select 1 from public.reviews r
                      where r.id = %1$I.review_id
                        and r.employee_id in (select private.manageable_person_ids())
                   )))
        )
        with check (
          private.is_rococo_admin()
          or (company_id = private.auth_company_id()
              and (private.has_full_scope()
                   or exists (
                     select 1 from public.reviews r
                      where r.id = %1$I.review_id
                        and r.employee_id in (select private.manageable_person_ids())
                   )))
        )$p$, t.tbl);

    execute format('drop policy if exists "Admins remove for the people they manage" on public.%I', t.tbl);
    execute format($p$
      create policy "Admins remove for the people they manage"
        on public.%1$I for delete to authenticated
        using (
          private.is_rococo_admin()
          or (company_id = private.auth_company_id()
              and (private.has_full_scope()
                   or exists (
                     select 1 from public.reviews r
                      where r.id = %1$I.review_id
                        and r.employee_id in (select private.manageable_person_ids())
                   )))
        )$p$, t.tbl);
  end loop;
end $$;

-- 6f. goals. The person writes their own as before; an admin writes for the people they manage;
-- a leader writes the monthly goals (scope 'cycle') of the people they lead. A yearly or BHAG
-- goal is the person's and their admins' only.
drop policy if exists "Employees read own goals, admins read company" on public.goals;
drop policy if exists "Employees and admins create goals" on public.goals;
drop policy if exists "Employees and admins update goals" on public.goals;
drop policy if exists "Employees and admins delete goals" on public.goals;

drop policy if exists "The person and those who see them read" on public.goals;
create policy "The person and those who see them read"
  on public.goals for select to authenticated
  using (
    private.is_rococo_admin()
    or employee_id = private.auth_profile_id()
    or (company_id = private.auth_company_id()
        and (private.has_full_scope()
             or employee_id in (select private.viewable_person_ids())))
  );

drop policy if exists "The person, their admins and their leaders add goals" on public.goals;
create policy "The person, their admins and their leaders add goals"
  on public.goals for insert to authenticated
  with check (
    private.is_rococo_admin()
    or (employee_id = private.auth_profile_id() and company_id = private.auth_company_id())
    or (company_id = private.auth_company_id()
        and (private.has_full_scope()
             or employee_id in (select private.manageable_person_ids())
             or (scope = 'cycle' and employee_id in (select private.led_person_ids()))))
  );

drop policy if exists "The person, their admins and their leaders change goals" on public.goals;
create policy "The person, their admins and their leaders change goals"
  on public.goals for update to authenticated
  using (
    private.is_rococo_admin()
    or employee_id = private.auth_profile_id()
    or (company_id = private.auth_company_id()
        and (private.has_full_scope()
             or employee_id in (select private.manageable_person_ids())
             or (scope = 'cycle' and employee_id in (select private.led_person_ids()))))
  )
  with check (
    private.is_rococo_admin()
    or (employee_id = private.auth_profile_id() and company_id = private.auth_company_id())
    or (company_id = private.auth_company_id()
        and (private.has_full_scope()
             or employee_id in (select private.manageable_person_ids())
             or (scope = 'cycle' and employee_id in (select private.led_person_ids()))))
  );

drop policy if exists "The person, their admins and their leaders remove goals" on public.goals;
create policy "The person, their admins and their leaders remove goals"
  on public.goals for delete to authenticated
  using (
    private.is_rococo_admin()
    or employee_id = private.auth_profile_id()
    or (company_id = private.auth_company_id()
        and (private.has_full_scope()
             or employee_id in (select private.manageable_person_ids())
             or (scope = 'cycle' and employee_id in (select private.led_person_ids()))))
  );

-- 6g. goal_notes. The owner always reads their notes. A monthly goal's notes are also read by
-- whoever sees the person (Rococo included) and written by whoever leads them. A yearly or BHAG
-- goal's notes stay the owner's alone, Rococo and owners of the company included (0021). Editing
-- and removing a note stay with its author (0021's policies, unchanged).
drop policy if exists "Owners read goal notes, admins read GSR notes" on public.goal_notes;
drop policy if exists "Owners and admins add goal notes" on public.goal_notes;

drop policy if exists "The owner reads, those who see them read monthly notes" on public.goal_notes;
create policy "The owner reads, those who see them read monthly notes"
  on public.goal_notes for select to authenticated
  using (
    employee_id = private.auth_profile_id()
    or (exists (select 1 from public.goals g where g.id = goal_notes.goal_id and g.scope = 'cycle')
        and (private.is_rococo_admin()
             or (company_id = private.auth_company_id()
                 and (private.has_full_scope()
                      or employee_id in (select private.viewable_person_ids())))))
  );

drop policy if exists "The owner and their leaders add notes" on public.goal_notes;
create policy "The owner and their leaders add notes"
  on public.goal_notes for insert to authenticated
  with check (
    author_id = private.auth_profile_id()
    and ((employee_id = private.auth_profile_id() and company_id = private.auth_company_id())
         or (exists (select 1 from public.goals g where g.id = goal_notes.goal_id and g.scope = 'cycle')
             and (private.is_rococo_admin()
                  or (company_id = private.auth_company_id()
                      and (private.has_full_scope()
                           or employee_id in (select private.led_person_ids()))))))
  );

-- goal_private is unchanged: owner only (0021).

-- ---------------------------------------------------------------------------------------
-- 7. invitations
-- ---------------------------------------------------------------------------------------
-- An invitation claims a roster row when its person signs in (0028), so it follows that person:
-- an admin reads and writes one only for someone they manage. An invitation that names nobody is
-- for the unclaimed row at its address on the company's roster, or for someone new.

create or replace function private.invitation_in_scope(p_company uuid, p_profile uuid, p_email text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_target uuid;
begin
  if private.has_full_scope() then
    return true;
  end if;
  -- Someone outside the company is guard_invitation_target's to refuse, with its own message.
  select p.id into v_target
    from public.profiles p
   where p.company_id = p_company
     and (p.id = p_profile
          or (p_profile is null and p.user_id is null and lower(p.email) = lower(p_email)))
   limit 1;
  if v_target is null then
    return true;
  end if;
  return exists (select 1 from private.manageable_person_ids() as m (id) where m.id = v_target);
end;
$$;
revoke all on function private.invitation_in_scope(uuid, uuid, text) from public, anon;
grant execute on function private.invitation_in_scope(uuid, uuid, text) to authenticated, service_role;

drop policy if exists "Company admins manage invitations" on public.invitations;
drop policy if exists "Admins manage invitations for the people they manage" on public.invitations;
create policy "Admins manage invitations for the people they manage"
  on public.invitations for all to authenticated
  using (
    private.can_manage_company(company_id)
    and private.invitation_in_scope(company_id, profile_id, email)
  )
  with check (
    private.can_manage_company(company_id)
    and private.invitation_in_scope(company_id, profile_id, email)
  );

-- The same rule as a refusal with its own message, ahead of the policy's silent check. Named to
-- fire between guard_invitation_role and guard_invitation_target.
create or replace function public.guard_invitation_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or private.is_rococo_admin() then
    return new;
  end if;
  if not private.invitation_in_scope(new.company_id, new.profile_id, new.email) then
    raise exception 'You can only invite people in the divisions you can see.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_invitation_scope() from public, anon, authenticated;

drop trigger if exists invitations_guard_scope on public.invitations;
create trigger invitations_guard_scope
  before insert or update on public.invitations
  for each row execute function public.guard_invitation_scope();

-- ---------------------------------------------------------------------------------------
-- 8. company_divisions
-- ---------------------------------------------------------------------------------------
-- A division decides who sees whom, so only a full-scope admin adds, renames or removes one. A
-- division someone still works in cannot be removed. Removing one takes it out of everyone's view
-- access: the cleanup runs as the system with hub.division_cleanup set, which the profile guards
-- let through for exactly that write. Deleting a whole company is the exception to the refusal:
-- by the time its divisions go, the company row is already gone.

drop policy if exists "Admins add divisions" on public.company_divisions;
drop policy if exists "Admins change divisions" on public.company_divisions;
drop policy if exists "Admins remove divisions" on public.company_divisions;

drop policy if exists "Full-scope admins add divisions" on public.company_divisions;
create policy "Full-scope admins add divisions"
  on public.company_divisions for insert to authenticated
  with check (
    private.is_rococo_admin()
    or (private.has_full_scope() and company_id = private.auth_company_id())
  );

drop policy if exists "Full-scope admins change divisions" on public.company_divisions;
create policy "Full-scope admins change divisions"
  on public.company_divisions for update to authenticated
  using (
    private.is_rococo_admin()
    or (private.has_full_scope() and company_id = private.auth_company_id())
  )
  with check (
    private.is_rococo_admin()
    or (private.has_full_scope() and company_id = private.auth_company_id())
  );

drop policy if exists "Full-scope admins remove divisions" on public.company_divisions;
create policy "Full-scope admins remove divisions"
  on public.company_divisions for delete to authenticated
  using (
    private.is_rococo_admin()
    or (private.has_full_scope() and company_id = private.auth_company_id())
  );

create or replace function public.guard_division_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not exists (select 1 from public.companies c where c.id = old.company_id) then
    return old;
  end if;
  select count(*) into v_count from public.profiles p where old.id = any (p.division_ids);
  if v_count > 0 then
    raise exception 'Move the % % out of % first.',
      v_count, case when v_count = 1 then 'person' else 'people' end, old.name
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;
revoke execute on function public.guard_division_delete() from public, anon, authenticated;

drop trigger if exists company_divisions_guard_delete on public.company_divisions;
create trigger company_divisions_guard_delete
  before delete on public.company_divisions
  for each row execute function public.guard_division_delete();

create or replace function public.clear_division_view_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev text := current_setting('hub.division_cleanup', true);
begin
  perform set_config('hub.division_cleanup', '1', true);
  update public.profiles
     set view_division_ids = array_remove(view_division_ids, old.id),
         division_ids = array_remove(division_ids, old.id)
   where old.id = any (view_division_ids) or old.id = any (division_ids);
  perform set_config('hub.division_cleanup', coalesce(v_prev, ''), true);
  return null;
end;
$$;
revoke execute on function public.clear_division_view_access() from public, anon, authenticated;

drop trigger if exists company_divisions_clear_view_access on public.company_divisions;
create trigger company_divisions_clear_view_access
  after delete on public.company_divisions
  for each row execute function public.clear_division_view_access();

-- ---------------------------------------------------------------------------------------
-- 9. review_cycles
-- ---------------------------------------------------------------------------------------
-- Any admin starts a cycle (0010's insert policy stays). Changing, closing, reopening or removing
-- one reaches every person's reviews and goals in it, so only a full-scope admin does that.

drop policy if exists "Admins update cycles" on public.review_cycles;
drop policy if exists "Admins delete cycles" on public.review_cycles;

drop policy if exists "Full-scope admins change cycles" on public.review_cycles;
create policy "Full-scope admins change cycles"
  on public.review_cycles for update to authenticated
  using (
    private.is_rococo_admin()
    or (private.has_full_scope() and company_id = private.auth_company_id())
  )
  with check (
    private.is_rococo_admin()
    or (private.has_full_scope() and company_id = private.auth_company_id())
  );

drop policy if exists "Full-scope admins remove cycles" on public.review_cycles;
create policy "Full-scope admins remove cycles"
  on public.review_cycles for delete to authenticated
  using (
    private.is_rococo_admin()
    or (private.has_full_scope() and company_id = private.auth_company_id())
  );

-- ---------------------------------------------------------------------------------------
-- 10. Audit
-- ---------------------------------------------------------------------------------------
-- Where a person works and what they may see are access, like can_view_divisions.
drop trigger if exists profiles_audit on public.profiles;
create trigger profiles_audit
  after insert or update or delete on public.profiles
  for each row execute function private.audit_change('role', 'is_active', 'is_rococo_admin', 'company_id', 'reports_to', 'job_role_id', 'can_view_divisions', 'division_ids', 'view_all_divisions', 'view_division_ids');

-- ---------------------------------------------------------------------------------------
-- 11. Nothing left behind
-- ---------------------------------------------------------------------------------------
-- Permissive policies add up, so one old company-wide policy left on a person's table keeps the
-- old reach. None of the policies written above calls can_manage_company or is_company_member, so
-- any policy on these tables that does is a leftover, and the paste stops here.
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
end $$;
