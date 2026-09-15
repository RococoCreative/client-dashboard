-- 0013_staff_before_invite.sql
-- A person on the roster is not the same thing as an account. Until now they were: profiles.id
-- was a foreign key to auth.users, so nobody existed in the hub until they had signed in. That
-- made it impossible to set up a new hire (title, department, hire date, who they report to,
-- compensation, KPIs) before handing them a sign-in link, which is the order every company
-- actually does it in.
--
-- So the profile is now the person and the account is an attribute of them:
--   profiles.id       a plain uuid, the person's identity in this hub, stable forever
--   profiles.user_id  nullable, the auth.users row once they have signed in
--
-- Existing rows keep the ids they already have (user_id is backfilled from id), so nothing that
-- references a profile moves and no history changes. What does change is how the policies find
-- "me": every comparison that meant "this row is mine" now resolves through
-- private.auth_profile_id() instead of comparing a person to auth.uid() directly.
--
-- Inviting is unchanged in spirit: an invitation is still a row plus a link, and it is still the
-- gate that lets an address through signup. It now points at the profile it belongs to, so
-- signing in claims the record an admin already filled in rather than creating a second one.
--
-- Paste after 0012; idempotent.

-- ---------------------------------------------------------------------------------------
-- 1. profiles: identity separated from account
-- ---------------------------------------------------------------------------------------

alter table public.profiles add column if not exists user_id uuid;

-- The id always borrowed its value from auth.users, so the column never needed a default.
-- A person added to the roster has no account to borrow from, so it needs one now.
alter table public.profiles alter column id set default gen_random_uuid();

-- Everyone who exists today got their profile id from auth.users, so they are already claimed.
update public.profiles set user_id = id where user_id is null;

do $$
begin
  -- The id is the person now, not the account. Dropping this is what allows a row with no user.
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.profiles'::regclass and contype = 'f' and conname = 'profiles_id_fkey'
  ) then
    alter table public.profiles drop constraint profiles_id_fkey;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.profiles'::regclass and conname = 'profiles_user_id_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_user_id_fkey
      foreign key (user_id) references auth.users (id) on delete set null;
  end if;
end $$;

-- One account is one person, and one email is one person. The second index is what stops an
-- admin adding staff for an address that already exists somewhere in the hub.
create unique index if not exists profiles_user_id_key on public.profiles (user_id) where user_id is not null;
create unique index if not exists profiles_email_key on public.profiles (lower(email));
create index if not exists profiles_unclaimed_idx on public.profiles (company_id) where user_id is null;

-- ---------------------------------------------------------------------------------------
-- 2. The helpers: find me by my account, not by my id
-- ---------------------------------------------------------------------------------------
-- A deactivated profile still resolves to nothing, so is_active remains the kill switch for a
-- departed employee. A profile with no account resolves to nothing either, because nobody is
-- signed in as it.

create or replace function private.auth_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.profiles where user_id = auth.uid() and is_active
$$;
-- The other private helpers are granted exactly this way. Policies call this one as the
-- signed-in user, so authenticated must hold EXECUTE or every review, goal, KPI and
-- compensation read fails with a permission error.
revoke all on function private.auth_profile_id() from public, anon;
grant execute on function private.auth_profile_id() to authenticated, service_role;

create or replace function private.auth_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id from public.profiles where user_id = auth.uid() and is_active
$$;

create or replace function private.is_rococo_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_rococo_admin from public.profiles where user_id = auth.uid() and is_active),
    false
  )
$$;

create or replace function private.is_company_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role = 'admin' from public.profiles where user_id = auth.uid() and is_active),
    false
  )
$$;

-- ---------------------------------------------------------------------------------------
-- 3. Policies that meant "this row is mine"
-- ---------------------------------------------------------------------------------------
-- Same predicates as 0010 and 0012, with the person comparison moved onto the new helper.
-- On profiles the comparison is against user_id directly, since that is the account column.

drop policy if exists "Users read own, teammates, Rococo reads all profiles" on public.profiles;
create policy "Users read own, teammates, Rococo reads all profiles"
  on public.profiles for select to authenticated
  using (
    private.is_rococo_admin()
    or user_id = (select auth.uid())
    or (company_id is not null and company_id = private.auth_company_id())
  );

drop policy if exists "Users update own, admins update company profiles" on public.profiles;
create policy "Users update own, admins update company profiles"
  on public.profiles for update to authenticated
  using (
    private.is_rococo_admin()
    or user_id = (select auth.uid())
    or (private.is_company_admin() and company_id is not null and company_id = private.auth_company_id())
  )
  with check (
    private.is_rococo_admin()
    or user_id = (select auth.uid())
    or (private.is_company_admin() and company_id is not null and company_id = private.auth_company_id())
  );

-- New: an admin puts someone on the roster before they have an account. user_id must be null,
-- because claiming an account is handle_new_user's job and nobody else's.
drop policy if exists "Admins add staff" on public.profiles;
create policy "Admins add staff"
  on public.profiles for insert to authenticated
  with check (
    private.is_rococo_admin()
    or (private.can_manage_company(company_id) and user_id is null and is_rococo_admin = false)
  );

-- New: undo a mistake. Only for a person who never signed in, so no history is ever cascaded
-- away. Anyone who has an account is deactivated instead, which is what is_active is for.
drop policy if exists "Admins remove staff who never signed in" on public.profiles;
create policy "Admins remove staff who never signed in"
  on public.profiles for delete to authenticated
  using (user_id is null and private.can_manage_company(company_id));

drop policy if exists "Employees read own reviews, admins read company" on public.reviews;
create policy "Employees read own reviews, admins read company"
  on public.reviews for select to authenticated
  using (employee_id = private.auth_profile_id() or private.can_manage_company(company_id));

drop policy if exists "Employees reflect, admins update reviews" on public.reviews;
create policy "Employees reflect, admins update reviews"
  on public.reviews for update to authenticated
  using (employee_id = private.auth_profile_id() or private.can_manage_company(company_id))
  with check (employee_id = private.auth_profile_id() or private.can_manage_company(company_id));

drop policy if exists "Employees read own scores, admins read company" on public.review_scores;
create policy "Employees read own scores, admins read company"
  on public.review_scores for select to authenticated
  using (
    private.can_manage_company(company_id)
    or exists (
      select 1 from public.reviews r
      where r.id = review_scores.review_id and r.employee_id = private.auth_profile_id()
    )
  );

drop policy if exists "Employees read own goals, admins read company" on public.goals;
create policy "Employees read own goals, admins read company"
  on public.goals for select to authenticated
  using (employee_id = private.auth_profile_id() or private.can_manage_company(company_id));

drop policy if exists "Employees and admins create goals" on public.goals;
create policy "Employees and admins create goals"
  on public.goals for insert to authenticated
  with check (
    private.can_manage_company(company_id)
    or (employee_id = private.auth_profile_id() and company_id = private.auth_company_id())
  );

drop policy if exists "Employees and admins update goals" on public.goals;
create policy "Employees and admins update goals"
  on public.goals for update to authenticated
  using (employee_id = private.auth_profile_id() or private.can_manage_company(company_id))
  with check (employee_id = private.auth_profile_id() or private.can_manage_company(company_id));

drop policy if exists "Employees and admins delete goals" on public.goals;
create policy "Employees and admins delete goals"
  on public.goals for delete to authenticated
  using (employee_id = private.auth_profile_id() or private.can_manage_company(company_id));

drop policy if exists "Own KPIs and admins read" on public.employee_kpis;
create policy "Own KPIs and admins read"
  on public.employee_kpis for select to authenticated
  using (employee_id = private.auth_profile_id() or private.can_manage_company(company_id));

drop policy if exists "Own compensation and admins read" on public.compensation_items;
create policy "Own compensation and admins read"
  on public.compensation_items for select to authenticated
  using (employee_id = private.auth_profile_id() or private.can_manage_company(company_id));

-- ---------------------------------------------------------------------------------------
-- 4. The profile guard, in the new terms
-- ---------------------------------------------------------------------------------------
-- "Myself" is now the row whose user_id is my account. The new clause is the important one:
-- user_id is the identity link, so nobody signed in may set or move it. Only handle_new_user
-- does, and that runs with no auth.uid() during the signup transaction.

create or replace function public.guard_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.email := old.email;
  if auth.uid() is null or private.is_rococo_admin() then
    return new;
  end if;

  if new.user_id is distinct from old.user_id then
    raise exception 'An account link is set when the person signs in and cannot be changed here.';
  end if;

  if new.company_id is distinct from old.company_id
     or new.is_rococo_admin is distinct from old.is_rococo_admin then
    raise exception 'Only Rococo admins can change company assignment or Rococo access.';
  end if;

  if private.is_company_admin() and old.company_id = private.auth_company_id() then
    if old.user_id = auth.uid()
       and (new.role is distinct from old.role or new.is_active is distinct from old.is_active) then
      raise exception 'You cannot change your own role or deactivate your own account.';
    end if;
    return new;
  end if;

  if old.user_id is distinct from auth.uid() then
    raise exception 'You can only edit your own profile.';
  end if;
  if new.role is distinct from old.role or new.is_active is distinct from old.is_active then
    raise exception 'Only admins can change roles or deactivate accounts.';
  end if;
  if new.hire_date is distinct from old.hire_date
     or new.department is distinct from old.department
     or new.reports_to is distinct from old.reports_to then
    raise exception 'Only admins can change employment details.';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 5. invitations point at the person they are for
-- ---------------------------------------------------------------------------------------

alter table public.invitations
  add column if not exists profile_id uuid references public.profiles (id) on delete cascade;

create index if not exists invitations_profile_id_idx on public.invitations (profile_id);

-- Back-link any invitation whose address already has a profile, so history reads correctly.
update public.invitations i
   set profile_id = p.id
  from public.profiles p
 where i.profile_id is null and lower(p.email) = lower(i.email);

-- ---------------------------------------------------------------------------------------
-- 6. Signing in claims the record an admin already filled in
-- ---------------------------------------------------------------------------------------
-- Order matters. A pending invitation wins, because it names the company deliberately. Failing
-- that, an unclaimed profile with the same address is this person, which covers someone added
-- to the roster who then signs in through their company domain with no invitation. Only when
-- neither exists is a fresh profile created, which is the original behaviour.
--
-- Claiming never overwrites what an admin filled in. The invitation's company, role and title
-- are applied only where the profile has not already been given one.

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

  if v_profile is not null then
    update public.profiles
       set user_id    = new.id,
           company_id = coalesce(company_id, v_inv.company_id),
           role       = case when v_inv.role is not null and role = 'employee' then v_inv.role else role end,
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
-- 7. The signup gate, unchanged in rule, restated for the record
-- ---------------------------------------------------------------------------------------
-- Being on the roster does NOT open the gate. A person an admin has set up but not invited
-- gets in only if their address is on a company domain, exactly as before. The deliberate act
-- of inviting is what admits a personal address, which is the whole point of holding the invite
-- back until the company is ready.
