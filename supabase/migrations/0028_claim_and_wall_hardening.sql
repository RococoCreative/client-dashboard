-- 0028_claim_and_wall_hardening.sql
-- Five holes the November QA pass found in the company wall. Each is a place where a row one
-- company writes could reach another company's people, or a person's account. Paste after 0023;
-- idempotent. Numbered 0028 because two open branches already claim 0024 to 0027; none of those
-- touch what this one changes, so the order they are pasted in does not matter.
--
--   1. An invitation's profile_id was trusted. Any company admin could insert an invitation
--      pointing at any profile (another company's admin, or a Rococo admin) with an address
--      they control, sign in, and be handed that profile: its role, its company, its private
--      goals, and the real person locked out. handle_new_user now honours profile_id only for an
--      unclaimed person on the same company's roster with the same email, never claims a
--      profile that already has an account, and invitations refuse a profile_id like that when
--      they are written.
--   2. One company could capture another company's future staff by email: roster the address
--      first, or send a newer invitation, and the new hire's first sign-in landed in the wrong
--      hub. An address on a company's email domain can now only be rostered or invited by that
--      company, and an @rocococreative.io address by Rococo. Rococo admins act across companies
--      on purpose and are not held to it. At sign-in, an invitation from the company that owns
--      the address's domain comes first.
--   3. A monthly goal followed its person to a new company on the next edit. The goals trigger
--      restamped company_id from the person on every update, while moving a person deliberately
--      leaves their months behind (0021). A goal in a month now belongs to that month's company,
--      for good; a goal outside a month still follows its person.
--   4. public.rls_auto_enable, an event-trigger function added outside the migrations, was
--      callable by anon and authenticated, and so is every new public function by default. The
--      grant goes, and so does the default.
--   5. Any member could list and read the files of a draft SOP through storage, though the
--      database hides the SOP and its attachments from them. A file under sops/ is now readable
--      by a member only while its attachment row is, which is only on a published SOP.

-- ---------------------------------------------------------------------------------------
-- 1 and 2. Claiming a profile at first sign-in
-- ---------------------------------------------------------------------------------------
-- Same shape as 0014, with three changes: the invitation from the company that owns the
-- address's domain is read first; an invitation's profile_id is checked before it is honoured;
-- and the claim only ever lands on a profile with no account.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email          text := lower(new.email);
  v_domain         text := split_part(lower(new.email), '@', 2);
  v_domain_company uuid;
  v_inv            public.invitations%rowtype;
  v_profile        uuid;
  v_company        uuid;
begin
  select company_id into v_domain_company
    from public.company_domains
   where lower(domain) = v_domain
   limit 1;

  -- The newest pending invitation, the domain owner's first.
  select * into v_inv
    from public.invitations
   where email = v_email and accepted_at is null
   order by (company_id is not distinct from v_domain_company) desc, created_at desc
   limit 1;

  -- An invitation only claims the roster row it names when that row is this person: no account
  -- yet, the same address, and the inviting company's roster (or no company yet).
  if v_inv.id is not null and v_inv.profile_id is not null then
    select p.id into v_profile
      from public.profiles p
     where p.id = v_inv.profile_id
       and p.user_id is null
       and lower(p.email) = v_email
       and (p.company_id is null or p.company_id = v_inv.company_id);
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
    -- The roster row already says who this person is. Only fill in what is still blank, and
    -- only on a row nobody has claimed.
    update public.profiles
       set user_id    = new.id,
           company_id = coalesce(company_id, v_inv.company_id),
           title      = coalesce(title, v_inv.title),
           full_name  = coalesce(full_name, nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''))
     where id = v_profile
       and user_id is null;
    if not found then
      raise exception 'This person already has an account.';
    end if;
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
    elsif v_domain_company is not null then
      update public.profiles set company_id = v_domain_company where id = v_profile;
    end if;
  end if;

  if v_inv.id is not null then
    -- Recorded against the profile that was actually claimed, whatever the row said.
    update public.invitations set accepted_at = now(), profile_id = v_profile
     where id = v_inv.id;
  end if;

  return new;
end;
$$;

-- Whose address is this? The company that owns its email domain, Rococo for its own, or nobody.
-- Shared by the two write guards below.
create or replace function private.address_owner(p_email text, out is_rococo boolean, out company_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select split_part(lower(p_email), '@', 2) = 'rocococreative.io',
         (select d.company_id from public.company_domains d
           where lower(d.domain) = split_part(lower(p_email), '@', 2)
           limit 1)
$$;
revoke execute on function private.address_owner(text) from public, anon, authenticated;

-- A roster row for an address on another company's domain, or on Rococo's, is refused for
-- anyone but a Rococo admin. Writes the app makes on a person's behalf (handle_new_user, the
-- SQL editor) carry no signed-in user and are not checked. Only a change of address or company
-- is looked at, so a person on another company's domain who was placed by Rococo can still
-- have the rest of their row edited.
create or replace function public.guard_profile_address()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner record;
begin
  -- A row with no company is on nobody's roster: that is how handle_new_user files a new person
  -- before placing them, and Rococo staff stay that way.
  if (select auth.uid()) is null or new.company_id is null or new.email is null or private.is_rococo_admin() then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and lower(new.email) is not distinct from lower(old.email)
     and new.company_id is not distinct from old.company_id then
    return new;
  end if;
  select * into v_owner from private.address_owner(new.email);
  if v_owner.is_rococo then
    raise exception 'An @rocococreative.io address belongs to Rococo staff, so it cannot be added to a company roster.'
      using errcode = 'check_violation';
  end if;
  if v_owner.company_id is not null and v_owner.company_id is distinct from new.company_id then
    raise exception 'That address is on another company''s email domain, so only that company can add it.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_profile_address() from public, anon, authenticated;

drop trigger if exists profiles_guard_address on public.profiles;
create trigger profiles_guard_address
  before insert or update of email, company_id on public.profiles
  for each row execute function public.guard_profile_address();

-- An invitation names the person it is for, or nobody. If it names someone, it is an unclaimed
-- person on the inviting company's roster with the same address. And it follows the same
-- address rule as the roster.
create or replace function public.guard_invitation_target()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner record;
begin
  -- An accepted invitation is spent: the sign-in gate and handle_new_user only read pending
  -- ones, and accepting is handle_new_user's own write.
  if (select auth.uid()) is null or new.accepted_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.email is not distinct from old.email
     and new.company_id is not distinct from old.company_id
     and new.profile_id is not distinct from old.profile_id then
    return new;
  end if;
  if new.profile_id is not null and not exists (
    select 1 from public.profiles p
     where p.id = new.profile_id
       and p.user_id is null
       and lower(p.email) = lower(new.email)
       and (p.company_id = new.company_id or (p.company_id is null and private.is_rococo_admin()))
  ) then
    raise exception 'An invitation can only be for someone on this company''s roster who has not signed in yet, at the same address.'
      using errcode = 'check_violation';
  end if;
  if not private.is_rococo_admin() then
    select * into v_owner from private.address_owner(new.email);
    if v_owner.is_rococo then
      raise exception 'An @rocococreative.io address belongs to Rococo staff, so it cannot be invited to a company.'
        using errcode = 'check_violation';
    end if;
    if v_owner.company_id is not null and v_owner.company_id is distinct from new.company_id then
      raise exception 'That address is on another company''s email domain, so only that company can invite it.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_invitation_target() from public, anon, authenticated;

drop trigger if exists invitations_guard_target on public.invitations;
create trigger invitations_guard_target
  before insert or update on public.invitations
  for each row execute function public.guard_invitation_target();

-- ---------------------------------------------------------------------------------------
-- 3. A goal in a month belongs to the month's company
-- ---------------------------------------------------------------------------------------
-- Outside a month (a yearly goal, a BHAG) a goal follows its person, as before: moving someone
-- takes those with them. Inside a month it takes the month's company, and it can only be put in
-- a month of the company its person is in at the time. After a move, the old month stays the old
-- company's: its admins can still write the why, and the person, now elsewhere, cannot move it.
create or replace function public.inherit_goal_company()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person_company uuid;
  v_cycle_company  uuid;
begin
  select company_id into v_person_company from public.profiles where id = new.employee_id;
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

drop trigger if exists goals_inherit_company on public.goals;
create trigger goals_inherit_company
  before insert or update on public.goals
  for each row execute function public.inherit_goal_company();

-- ---------------------------------------------------------------------------------------
-- 4. No public function is callable by default
-- ---------------------------------------------------------------------------------------
-- rls_auto_enable backs the ensure_rls event trigger, which turns RLS on for every new table in
-- public. The trigger stays; nobody needs to call the function. The default grants go with it, so
-- a function added later is callable by nobody until its migration grants it, the way 0009 grants
-- the private helpers and the two login lookups are granted. Two defaults: Postgres gives every
-- new function to PUBLIC (which anon and authenticated inherit), and this project adds an explicit
-- per-schema grant to both roles in public. A per-schema revoke cannot take back the PUBLIC one,
-- so it is revoked for every function postgres creates; trigger functions need no grant to fire.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;

alter default privileges for role postgres
  revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 5. A draft SOP's files are as hidden as the draft
-- ---------------------------------------------------------------------------------------
-- Admins read every file in their company. A member reads a resource file, and an SOP file only
-- while its sop_attachments row is visible to them, which that table's own policy limits to
-- published SOPs. The subquery runs under the member's row level security, so it is the same
-- rule in both places rather than a copy of it.
drop policy if exists "Members read own company files" on storage.objects;
create policy "Members read own company files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'hub-files'
    and (
      private.can_manage_company(private.path_company_id(name))
      or (
        private.is_company_member(private.path_company_id(name))
        and (
          split_part(name, '/', 2) <> 'sops'
          or exists (select 1 from public.sop_attachments a where a.file_path = name)
        )
      )
    )
  );
