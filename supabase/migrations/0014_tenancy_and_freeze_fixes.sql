-- 0014_tenancy_and_freeze_fixes.sql
-- Five holes a full audit of 0011 and 0013 turned up. Each one is a case where the rule the
-- rest of the schema follows was stated in one place and not the other. Paste after 0013;
-- idempotent.
--
--   1. A goal could be moved to another company on update. The insert policy pinned
--      company_id; the update policy did not, and goals was the one person-scoped table with
--      no inheritance trigger to fall back on.
--   2. A goal could be created into a closed cycle. The freeze trigger covered update and
--      delete, so the row went in and then could never be edited or removed again.
--   3. An invitation was matched to a person by email alone, with no company check, so one
--      company's invitation could apply to another company's roster row.
--   4. An invitation's role was re-applied over the roster at first sign-in, so demoting
--      someone after inviting them was silently undone when they signed in.
--   5. Moving a person between companies moved only the person, leaving their KPIs and
--      compensation behind, readable by the company they had left.

-- ---------------------------------------------------------------------------------------
-- 1. A goal belongs to its person's company, and the database decides that, not the caller
-- ---------------------------------------------------------------------------------------
-- employee_kpis and compensation_items already inherit company_id from the employee by
-- trigger. goals carried its company_id from the page instead, which is fine until an update
-- is allowed to change it. Inherit it the same way, so the column stops being an input at
-- all, and pin it in the policy too: the trigger is the guarantee, the policy is the answer
-- the caller gets.
drop trigger if exists goals_inherit_company on public.goals;
create trigger goals_inherit_company
  before insert or update on public.goals
  for each row execute function public.inherit_company_from_employee();

drop policy if exists "Employees and admins update goals" on public.goals;
create policy "Employees and admins update goals"
  on public.goals for update to authenticated
  using (employee_id = private.auth_profile_id() or private.can_manage_company(company_id))
  with check (
    private.can_manage_company(company_id)
    or (employee_id = private.auth_profile_id() and company_id = private.auth_company_id())
  );

-- ---------------------------------------------------------------------------------------
-- 2. A closed cycle is closed to new goals as well
-- ---------------------------------------------------------------------------------------
-- Same rule as before, now including insert. OLD is not assigned on an insert, so the
-- "cycle it came from" is only read when there is one.
create or replace function public.guard_goal_frozen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from uuid := case when tg_op = 'INSERT' then null else old.cycle_id end;
  v_to   uuid := case when tg_op = 'DELETE' then null else new.cycle_id end;
begin
  if exists (
    select 1 from public.review_cycles c
    where c.id in (v_from, v_to) and c.status = 'closed'
  ) then
    raise exception 'This review cycle is closed. Reopen it to change its goals.'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_goal_frozen() from public, anon, authenticated;

drop trigger if exists goals_guard_frozen on public.goals;
create trigger goals_guard_frozen
  before insert or update or delete on public.goals
  for each row execute function public.guard_goal_frozen();

-- ---------------------------------------------------------------------------------------
-- 3 and 4. Claiming a profile at first sign-in
-- ---------------------------------------------------------------------------------------
-- Two rules the previous version got wrong.
--
-- An invitation now has to agree with the roster row it is claiming. Matching on email alone
-- meant Kingdom could invite an address that already sat on Klasik's roster and have the
-- invitation applied there, role and all. An invitation is only honoured for a profile in the
-- same company, or for a profile that has no company yet.
--
-- And the roster wins on role. The invitation's role is the opening offer, used when there is
-- no roster row to read; once a person exists on the roster, what an admin last set there is
-- the truth. Otherwise demoting someone between the invite and their first sign-in is undone
-- by the sign-in, which is exactly backwards.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email    text := lower(new.email);
  v_domain   text := split_part(lower(new.email), '@', 2);
  v_inv      public.invitations%rowtype;
  v_profile  uuid;
  v_company  uuid;
begin
  select * into v_inv
    from public.invitations
   where email = v_email and accepted_at is null
   order by created_at desc
   limit 1;

  if found then
    v_profile := v_inv.profile_id;
  end if;

  if v_profile is null then
    select id into v_profile
      from public.profiles
     where lower(email) = v_email and user_id is null
     limit 1;
  end if;

  -- An invitation from a different company than the roster row is not this person's
  -- invitation. Drop it and claim the profile on its own terms.
  if v_profile is not null and v_inv.id is not null then
    if not exists (
      select 1 from public.profiles p
       where p.id = v_profile
         and (p.company_id is null or p.company_id = v_inv.company_id)
    ) then
      v_inv := null;
    end if;
  end if;

  if v_profile is not null then
    -- The roster row already says who this person is. Only fill in what is still blank.
    update public.profiles
       set user_id    = new.id,
           company_id = coalesce(company_id, v_inv.company_id),
           title      = coalesce(title, v_inv.title),
           full_name  = coalesce(full_name, nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''))
     where id = v_profile;
  else
    v_profile := new.id;
    insert into public.profiles (id, user_id, email, full_name, is_rococo_admin)
    values (
      new.id,
      new.id,
      v_email,
      nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
      v_domain = 'rocococreative.io'
    )
    on conflict (id) do nothing;

    if v_inv.id is not null then
      update public.profiles
         set company_id = v_inv.company_id,
             role       = v_inv.role,
             title      = coalesce(v_inv.title, title)
       where id = v_profile;
    else
      select company_id into v_company from public.company_domains where domain = v_domain;
      if v_company is not null then
        update public.profiles set company_id = v_company where id = v_profile;
      end if;
    end if;
  end if;

  if v_inv.id is not null then
    update public.invitations set accepted_at = now(), profile_id = coalesce(profile_id, v_profile)
     where id = v_inv.id;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 5. Moving a person to another company takes their person-scoped work with them
-- ---------------------------------------------------------------------------------------
-- A Rococo admin can move someone between companies from the portfolio's People tab, which
-- writes profiles.company_id and nothing else. Their KPIs and compensation lines then sat
-- stamped with the company they left: invisible to the company they joined, still readable by
-- the admins of the one they left.
--
-- What moves is what belongs to the person alone. Reviews stay, because a review belongs to
-- the cycle it was written in, and that cycle belongs to the old company; so do goals tied to
-- one of those cycles. A yearly goal has no cycle, so it travels with the person.
create or replace function public.move_employee_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.company_id is distinct from old.company_id and new.company_id is not null then
    update public.employee_kpis      set company_id = new.company_id where employee_id = new.id;
    update public.compensation_items set company_id = new.company_id where employee_id = new.id;
    update public.goals              set company_id = new.company_id where employee_id = new.id and cycle_id is null;
  end if;
  return new;
end;
$$;
revoke execute on function public.move_employee_company() from public, anon, authenticated;

drop trigger if exists profiles_move_company on public.profiles;
create trigger profiles_move_company
  after update of company_id on public.profiles
  for each row execute function public.move_employee_company();
