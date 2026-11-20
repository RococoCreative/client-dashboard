-- 0049_delete_people.sql
-- An owner or admin can now delete a person who has signed in, not only deactivate them. Deleting
-- takes everything on their profile with it (every table that belongs to a person points at
-- profiles.id with on delete cascade), blanks their name where they only created, assigned,
-- completed or reviewed something (on delete set null), removes their sign-in, and keeps their
-- address out until an owner or admin invites it again.
--
--   1. Who may delete. A new delete policy on profiles: an owner or admin of the company, for the
--      people they manage (private.manageable_person_ids, the same rule the 0038 policy for people
--      who never signed in uses), and any Rococo admin. The 0038 policy for people who never
--      signed in stays exactly as it is.
--   2. What is refused. guard_profile_delete (0033) is rebuilt with a branch for a person who has
--      signed in. For a signed-in writer it refuses deleting yourself, deleting a Rococo admin's
--      profile unless you are one, deleting someone ranked above you, and deleting the company's
--      only active owner. The SQL editor, with nobody signed in, is not checked. A person who never
--      signed in is judged exactly as 0033 judged them.
--   3. The block list. private.blocked_signups holds the addresses of people deleted after they
--      signed in. Nobody signed in reads or writes it; only the functions below do.
--   4. The sign-in goes. After a person who had signed in is deleted, their address goes on the
--      block list and their auth.users row is deleted, so their account and sessions go with it.
--      profiles.user_id is on delete set null (0013) and the profile row is already gone, so the
--      account delete reaches nothing back in profiles and cannot loop.
--   5. The gate. restrict_signups (0002) refuses a blocked address unless it has a pending
--      invitation. Every other branch and message is as 0002 wrote it.
--   6. Coming back. handle_new_user (0028) lifts the block once the address signs in through a
--      pending invitation. Nothing else in it changes.
--   7. Letting the cascade through. Some guards refused the cascade, and some stamps put back a
--      column the foreign key was clearing, which failed the delete on that key. Each now lets that
--      one write through, the way guard_profile_fields and guard_goal_owner already did:
--      guard_goal_frozen (a person's goals in a closed or locked month, and who set a goal there),
--      guard_goal_note_frozen (a person's notes there, and who wrote one), stamp_goal_note (a
--      note's author), stamp_actor (who created or last edited a project, milestone, win, sync
--      source, link or focus topic), guard_review_employee_fields (who reviewed a review, from the
--      SQL editor) and stamp_metric_entry (who entered a figure).
--   8. Letting the account delete through. Deleting the auth.users row (4) clears the columns that
--      point at the account: invitations.invited_by and review_cycles.created_by. Three guards
--      judged that clearing as an edit by whoever deleted the person, and could refuse it, which
--      failed the whole delete with a message about something else: guard_invitation_role (an
--      owner invitation sent by someone who is now an admin), guard_invitation_scope (a limited
--      admin) and guard_review_cycle_period (a GSR month in a company on demand). Each lets that
--      one write through, and only when the account is gone and nothing else on the row changed.
--
-- Idempotent: safe to paste again.

-- ---------------------------------------------------------------------------------------
-- 1. Who may delete
-- ---------------------------------------------------------------------------------------
drop policy if exists "Admins delete people who have signed in" on public.profiles;
create policy "Admins delete people who have signed in"
  on public.profiles for delete to authenticated
  using (
    user_id is not null
    and (private.is_rococo_admin()
         or (private.is_company_admin()
             and company_id = private.auth_company_id()
             and id in (select private.manageable_person_ids())))
  );

-- ---------------------------------------------------------------------------------------
-- 2. What is refused
-- ---------------------------------------------------------------------------------------
-- The 0033 body, with the branch for a person who has signed in added ahead of it. That branch
-- holds Rococo admins to every rule but the two that are about rank and Rococo itself, so nobody
-- deletes themselves and no company is left without an active owner.
create or replace function public.guard_profile_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return old;
  end if;
  if old.user_id is not null then
    if old.id = private.auth_profile_id() or old.user_id = auth.uid() then
      raise exception 'You cannot delete yourself.'
        using errcode = 'check_violation';
    end if;
    if old.is_rococo_admin and not private.is_rococo_admin() then
      raise exception 'A Rococo admin is removed by Rococo.'
        using errcode = 'check_violation';
    end if;
    if not private.is_rococo_admin()
       and private.role_rank(old.role) > private.auth_role_rank() then
      raise exception 'You cannot delete someone ranked above you.'
        using errcode = 'check_violation';
    end if;
    if old.role = 'owner'
       and old.is_active
       and old.company_id is not null
       and not exists (
         select 1 from public.profiles p
          where p.company_id = old.company_id
            and p.id <> old.id
            and p.role = 'owner'
            and p.is_active
       ) then
      raise exception 'This is the company''s only owner. Make someone else an owner first.'
        using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if private.is_rococo_admin() then
    return old;
  end if;
  if private.role_rank(old.role) > private.auth_role_rank() then
    raise exception 'You cannot remove someone ranked above you.';
  end if;
  return old;
end;
$$;
revoke execute on function public.guard_profile_delete() from public, anon, authenticated;

drop trigger if exists profiles_guard_delete on public.profiles;
create trigger profiles_guard_delete
  before delete on public.profiles
  for each row execute function public.guard_profile_delete();

-- ---------------------------------------------------------------------------------------
-- 3. The block list
-- ---------------------------------------------------------------------------------------
-- One row an address, lowercased. company_id is the company the person was deleted from (none for
-- Rococo staff), blocked_by the profile of whoever deleted them (none from the SQL editor). No
-- policies: with row level security on and every privilege revoked, only the security definer
-- functions in this file reach it.
create table if not exists private.blocked_signups (
  email       text primary key,
  company_id  uuid references public.companies (id) on delete cascade,
  blocked_at  timestamptz not null default now(),
  blocked_by  uuid
);
alter table private.blocked_signups enable row level security;
revoke all on table private.blocked_signups from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 4. The sign-in goes
-- ---------------------------------------------------------------------------------------
-- Runs after the delete, once the cascades are done. Both the profile's address and the account's
-- (they match unless the account's address was changed by hand) go on the list. Deleting the
-- auth.users row takes the person's sessions and identities with it on Supabase.
create or replace function private.remove_deleted_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_email text;
begin
  if old.user_id is null then
    return old;
  end if;
  select lower(trim(u.email)) into v_account_email from auth.users u where u.id = old.user_id;

  insert into private.blocked_signups (email, company_id, blocked_by)
  select distinct e.email, old.company_id, private.auth_profile_id()
    from (values (lower(trim(old.email))), (v_account_email)) as e (email)
   where e.email is not null and e.email <> ''
  on conflict (email) do update
    set company_id = excluded.company_id,
        blocked_at = now(),
        blocked_by = excluded.blocked_by;

  delete from auth.users where id = old.user_id;
  return old;
end;
$$;
revoke execute on function private.remove_deleted_account() from public, anon, authenticated;

drop trigger if exists profiles_remove_account on public.profiles;
create trigger profiles_remove_account
  after delete on public.profiles
  for each row execute function private.remove_deleted_account();

-- ---------------------------------------------------------------------------------------
-- 5. The gate
-- ---------------------------------------------------------------------------------------
-- The 0002 body with the block check added first. A pending invitation made after the block opens
-- the gate for a blocked address, as any pending invitation does for a personal address; signing
-- in through it lifts the block (6). One made before the block (an admin could invite a signed-in
-- person's address by itself) does not, so the block holds until someone invites them again.
create or replace function public.restrict_signups(event jsonb)
returns jsonb
language plpgsql
security definer
-- Pin an empty search_path so no shadowed object can alter how this gate resolves names;
-- every reference below is schema-qualified.
set search_path = ''
as $$
declare
  v_email  text := lower(trim(coalesce(event -> 'user' ->> 'email', '')));
  v_domain text := split_part(lower(trim(coalesce(event -> 'user' ->> 'email', ''))), '@', 2);
begin
  if exists (
       select 1 from private.blocked_signups b
        where b.email = v_email
          and not exists (
            select 1 from public.invitations i
             where i.email = v_email and i.accepted_at is null and i.created_at > b.blocked_at
          )
     )
  then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'This address was removed from the hub. Ask an owner or admin to invite you again.'
    ));
  end if;

  if v_domain = 'rocococreative.io'
     or exists (select 1 from public.company_domains d where d.domain = v_domain)
     or exists (select 1 from public.invitations i where i.email = v_email and i.accepted_at is null)
  then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'This email is not set up for Company Hub yet. Ask your company admin for an invitation.'
  ));
end;
$$;

-- Only the auth admin role may run the hook; nobody else can reach it.
grant execute on function public.restrict_signups(jsonb) to supabase_auth_admin;
revoke execute on function public.restrict_signups(jsonb) from authenticated, anon, public;

-- ---------------------------------------------------------------------------------------
-- 6. Coming back
-- ---------------------------------------------------------------------------------------
-- The 0028 body with one change: settling an invitation also lifts any block on the address.
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
  v_row_company    uuid;
begin
  select company_id into v_domain_company
    from public.company_domains
   where lower(domain) = v_domain
   limit 1;

  -- The person at this address, if they are on file and have no account yet.
  select p.id, p.company_id into v_profile, v_row_company
    from public.profiles p
   where lower(p.email) = v_email
     and p.user_id is null
   limit 1;

  -- The invitation this sign-in settles. A row on a company's roster takes only that company's.
  select i.* into v_inv
    from public.invitations i
   where i.email = v_email
     and i.accepted_at is null
     and (v_row_company is null or i.company_id = v_row_company)
   order by coalesce(i.profile_id = v_profile, false) desc,
            (i.company_id is not distinct from v_domain_company) desc,
            i.created_at desc,
            i.id
   limit 1;

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
    -- 0049: back in through an invitation, so the address is no longer blocked.
    delete from private.blocked_signups where email = v_email;
  end if;

  -- The rest are withdrawn: nothing can accept them now that the person has an account.
  delete from public.invitations
   where accepted_at is null
     and (email = v_email or profile_id = v_profile);

  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 7. Letting the cascade through
-- ---------------------------------------------------------------------------------------
-- Deleting a person deletes their rows (on delete cascade) and clears their name from other
-- people's rows (on delete set null). Each of these refused or undid one of those writes. Every
-- one keeps its rules for everything else; the only write let through is the one that can only
-- come from the person, or the person named, no longer existing.

-- The 0047 body with two additions. A goal whose person is gone goes, whatever its month (a
-- closed month, a locked one); and on an update, created_by cleared because whoever set the goal
-- is gone is not a change, as a carried-from goal that is gone already was not.
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
  v_was      uuid := case when tg_op = 'INSERT' then null else old.employee_id end;
  v_gsr_from uuid := case when tg_op = 'INSERT' then null else old.review_id end;
  v_gsr_to   uuid := case when tg_op = 'DELETE' then null else new.review_id end;
  v_probe    public.goals%rowtype;
  v_done     boolean;
  v_outside  boolean;
begin
  if (coalesce(current_setting('hub.gsr_conversion', true), '') = '1' and (select auth.uid()) is null) then
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
  -- 0049: the person is being deleted, so their goals go with them.
  if tg_op = 'DELETE'
     and not exists (select 1 from public.profiles p where p.id = old.employee_id) then
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
    -- 0049: whoever set the goal is being deleted.
    if new.created_by is null
       and old.created_by is not null
       and not exists (select 1 from public.profiles p where p.id = old.created_by) then
      v_probe.created_by := old.created_by;
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
  select bool_or(true), bool_or(not private.is_company_member(r.company_id))
    into v_done, v_outside
    from public.reviews r
   where r.id in (v_gsr_from, v_gsr_to)
     and r.cycle_id is null
     and r.employee_id in (v_whose, v_was)
     and r.status = 'complete';
  if v_done then
    if (select auth.uid()) is not null and v_outside then
      raise exception 'new row violates row-level security policy for table "goals"'
        using errcode = 'insufficient_privilege';
    end if;
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

-- The 0047 body with two additions. A note whose person or goal is gone goes; and on an update,
-- author_id cleared because its author is gone is not a change.
create or replace function public.guard_goal_note_frozen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from    uuid := case when tg_op = 'INSERT' then null else old.goal_id end;
  v_to      uuid := case when tg_op = 'DELETE' then null else new.goal_id end;
  v_done    boolean;
  v_outside boolean;
  v_probe   public.goal_notes%rowtype;
begin
  if (coalesce(current_setting('hub.gsr_conversion', true), '') = '1' and (select auth.uid()) is null) then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  -- 0049: the note goes with its person, or its goal.
  if tg_op = 'DELETE'
     and (not exists (select 1 from public.profiles p where p.id = old.employee_id)
          or not exists (select 1 from public.goals g where g.id = old.goal_id)) then
    return old;
  end if;
  -- 0049: its author is being deleted.
  if tg_op = 'UPDATE'
     and new.author_id is null
     and old.author_id is not null
     and not exists (select 1 from public.profiles p where p.id = old.author_id) then
    v_probe := new;
    v_probe.author_id := old.author_id;
    v_probe.updated_at := old.updated_at;
    if v_probe is not distinct from old then
      return new;
    end if;
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
  select bool_or(true), bool_or(not private.is_company_member(r.company_id))
    into v_done, v_outside
    from public.goals g
    join public.reviews r on r.id = g.review_id
   where g.id in (v_from, v_to)
     and r.cycle_id is null
     and r.status = 'complete';
  if v_done then
    if (select auth.uid()) is not null and v_outside then
      raise exception 'new row violates row-level security policy for table "goal_notes"'
        using errcode = 'insufficient_privilege';
    end if;
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

-- The 0021 body with one change: an edit keeps the note's author unless the author is gone, when
-- the foreign key's clearing stands. Before this, the author was put back and the delete failed
-- on the foreign key.
create or replace function public.stamp_goal_note()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.goal_id    := old.goal_id;
    new.author_id  := case
      when new.author_id is null
           and not exists (select 1 from public.profiles p where p.id = old.author_id) then null
      else old.author_id
    end;
    new.created_at := old.created_at;
  else
    new.author_id  := private.auth_profile_id();
    new.created_at := now();
    new.updated_at := now();
  end if;
  select g.company_id, g.employee_id
    into new.company_id, new.employee_id
    from public.goals g
   where g.id = new.goal_id;
  if new.company_id is null then
    raise exception 'That goal does not exist.';
  end if;
  return new;
end;
$$;
revoke execute on function public.stamp_goal_note() from public, anon, authenticated;

-- The 0026 body with one change: someone who is gone is never put back, and the foreign key
-- clearing them is not an edit, so it names nobody as the last to update the row. Before this,
-- created_by was put back and the delete failed on the foreign key.
create or replace function public.stamp_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator_gone boolean;
  v_updater_gone boolean;
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(private.auth_profile_id(), new.created_by);
    new.updated_by := new.created_by;
  else
    v_creator_gone := old.created_by is not null
      and not exists (select 1 from public.profiles p where p.id = old.created_by);
    v_updater_gone := old.updated_by is not null
      and not exists (select 1 from public.profiles p where p.id = old.updated_by);
    new.created_by := case when v_creator_gone then null else old.created_by end;
    if (v_creator_gone or v_updater_gone)
       and (to_jsonb(new) - '{created_by,updated_by,updated_at}'::text[])
           = (to_jsonb(old) - '{created_by,updated_by,updated_at}'::text[]) then
      new.updated_by := case when v_updater_gone then null else old.updated_by end;
    else
      new.updated_by := coalesce(private.auth_profile_id(), case when v_updater_gone then null else old.updated_by end);
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.stamp_actor() from public, anon, authenticated;

-- The 0047 body with one addition first after the conversion pass: reviewer_id cleared because
-- whoever reviewed the review, or marked the GSR done, is gone is not an edit. Before this, the SQL
-- editor could not delete a manager who had reviewed anyone. Everything else, and every message, is
-- as it was.
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
  if (coalesce(current_setting('hub.gsr_conversion', true), '') = '1' and (select auth.uid()) is null) then
    return new;
  end if;
  -- 0049: whoever reviewed it or marked it done is being deleted.
  if new.reviewer_id is null
     and old.reviewer_id is not null
     and not exists (select 1 from public.profiles p where p.id = old.reviewer_id) then
    v_probe := new;
    v_probe.reviewer_id := old.reviewer_id;
    v_probe.updated_at := old.updated_at;
    if v_probe is not distinct from old then
      return new;
    end if;
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

-- The 0035 body with one change: entered_by cleared because whoever entered the figure is gone
-- stays cleared. Before this, the SQL editor put the deleted person back and failed on the foreign
-- key, and a signed-in admin's delete recorded the admin as having entered it.
create or replace function public.stamp_metric_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company     uuid;
  v_kind        text;
  v_scale_max   integer;
  v_per_project boolean;
begin
  select m.company_id, m.kind, m.scale_max, m.per_project
    into v_company, v_kind, v_scale_max, v_per_project
    from public.role_metrics m
   where m.id = new.metric_id;
  if v_company is null then
    raise exception 'That metric does not exist.';
  end if;
  new.company_id := v_company;

  if tg_op = 'INSERT'
     or new.employee_id is distinct from old.employee_id
     or new.metric_id is distinct from old.metric_id then
    if not exists (
      select 1 from public.profiles p where p.id = new.employee_id and p.company_id = v_company
    ) then
      raise exception 'That person is not on this company''s team.'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.project_id is not null
     and not exists (
       select 1 from public.projects pr where pr.id = new.project_id and pr.company_id = v_company
     ) then
    raise exception 'That project belongs to another company.'
      using errcode = 'check_violation';
  end if;

  if v_per_project and new.project_id is null then
    -- The one write let through: the foreign key clearing a project that is being deleted.
    if not (tg_op = 'UPDATE'
            and old.project_id is not null
            and not exists (select 1 from public.projects pr where pr.id = old.project_id)) then
      raise exception 'This metric is entered per project. Choose the project.'
        using errcode = 'check_violation';
    end if;
  elsif not v_per_project and new.project_id is not null then
    raise exception 'This metric is entered once for the month, not per project.'
      using errcode = 'check_violation';
  end if;

  if not private.metric_value_fits(v_kind, v_scale_max, new.value) then
    raise exception '%',
      case v_kind
        when 'percent' then 'A percent is between 0 and 100.'
        when 'rating' then format('A rating is between 1 and %s.', v_scale_max)
        else 'Enter a number.'
      end
      using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    new.entered_by := coalesce(private.auth_profile_id(), new.entered_by);
    new.created_at := now();
  elsif new.entered_by is null
        and old.entered_by is not null
        and not exists (select 1 from public.profiles p where p.id = old.entered_by) then
    -- 0049: whoever entered it is being deleted, so the foreign key's clearing stands.
    new.created_at := old.created_at;
  else
    new.entered_by := coalesce(private.auth_profile_id(), old.entered_by);
    new.created_at := old.created_at;
  end if;
  new.note := nullif(btrim(new.note), '');
  return new;
end;
$$;
revoke execute on function public.stamp_metric_entry() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 8. Letting the account delete through
-- ---------------------------------------------------------------------------------------
-- Each pass is the same shape: an update that clears the column pointing at an account, where that
-- account no longer exists and nothing else on the row changed (updated_at aside), is the foreign
-- key clearing a deleted person, never a writer's edit. A signed-in writer cannot meet it on
-- purpose: the account still exists for any address they could name, so clearing the column by
-- hand is judged as before.

-- The 0033 body with that pass first.
create or replace function public.guard_invitation_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 0049: the account that sent it is being deleted.
  if tg_op = 'UPDATE'
     and new.invited_by is null
     and old.invited_by is not null
     and not exists (select 1 from auth.users u where u.id = old.invited_by)
     and (to_jsonb(new) - '{invited_by,updated_at}'::text[])
         = (to_jsonb(old) - '{invited_by,updated_at}'::text[]) then
    return new;
  end if;
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
revoke execute on function public.guard_invitation_role() from public, anon, authenticated;

-- The 0038 body with that pass first.
create or replace function public.guard_invitation_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 0049: the account that sent it is being deleted.
  if tg_op = 'UPDATE'
     and new.invited_by is null
     and old.invited_by is not null
     and not exists (select 1 from auth.users u where u.id = old.invited_by)
     and (to_jsonb(new) - '{invited_by,updated_at}'::text[])
         = (to_jsonb(old) - '{invited_by,updated_at}'::text[]) then
    return new;
  end if;
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

-- The 0047 body with that pass after the kind line, so the kind is still set from the cadence
-- (it cannot move here: the cadence is part of what must be unchanged).
create or replace function public.guard_review_cycle_period()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.kind := case when new.cadence = 'monthly' then 'gsr' else 'review' end;
  -- 0049: the account that created it is being deleted.
  if tg_op = 'UPDATE'
     and new.created_by is null
     and old.created_by is not null
     and not exists (select 1 from auth.users u where u.id = old.created_by)
     and (to_jsonb(new) - '{created_by,updated_at}'::text[])
         = (to_jsonb(old) - '{created_by,updated_at}'::text[]) then
    return new;
  end if;
  if new.kind = 'gsr'
     and private.gsr_on_demand(new.company_id)
     and not (coalesce(current_setting('hub.gsr_conversion', true), '') = '1' and (select auth.uid()) is null) then
    raise exception 'This company has GSRs on demand, so it opens no GSR months.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_review_cycle_period() from public, anon, authenticated;
