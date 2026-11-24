-- 0051_rococo_admins.sql
-- Rococo admin becomes an explicit list the database enforces. Paste after 0050; idempotent.
--
-- Why: until now any address on Rococo's domain was a cross-company admin the moment it signed up,
-- and any Rococo admin could tick the flag on any profile. Rococo access now comes from one short
-- list of addresses, and only from that list, with a confirmed email behind it.
--
--   1. public.rococo_admins: one row per address, lowercased and on Rococo's domain. Only Rococo
--      admins read, add or remove entries.
--   2. Seed: every active profile flagged as a Rococo admin today goes on the list, so nobody loses
--      access. It runs before the sync below exists, so a first paste touches no profile.
--   3. Who added an entry, and when, is stamped by the database; the address is lowercased and
--      trimmed before the domain check reads it.
--   4. The sync: adding an address flags and turns on the profile at that address; removing it
--      clears the flag and turns the profile off (the owner's decision), so a removed person keeps
--      no access anywhere. Adding it back turns the profile on again.
--   5. The last entry stays. Removals are serialized, and a removal that would leave the list
--      empty is refused.
--   6. Every add and removal is audited.
--   7. profiles.is_rococo_admin stays the column the app reads, but only the sync writes it, for
--      everyone, the SQL editor included. A new profile reads it from the list, which is how
--      sign-up now follows the list rather than the domain; handle_new_user is left as 0049 wrote it.
--   8. Any flagged profile not on the list (an inactive one the seed skipped) is cleared.
--   9. private.is_rococo_admin() is true only for an active profile whose account's address is on
--      the list and confirmed.
--  10. The sign-up gate admits a Rococo address only when it is on the list. Company domains,
--      invitations and the block list are as 0049 left them.

-- ---------------------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------------------

create table if not exists public.rococo_admins (
  id        uuid primary key default gen_random_uuid(),
  email     text not null unique,
  added_by  uuid references public.profiles (id) on delete set null,
  added_at  timestamptz not null default now(),
  constraint rococo_admins_email_check check (email ~ '^[^@\s]+@rocococreative\.io$')
);

create index if not exists rococo_admins_added_by_idx on public.rococo_admins (added_by);

alter table public.rococo_admins enable row level security;

revoke all on public.rococo_admins from public, anon, authenticated;
grant select, insert, delete on public.rococo_admins to authenticated;

drop policy if exists "Rococo admins read the Rococo admin list" on public.rococo_admins;
create policy "Rococo admins read the Rococo admin list"
  on public.rococo_admins for select to authenticated
  using (private.is_rococo_admin());

drop policy if exists "Rococo admins add Rococo admins" on public.rococo_admins;
create policy "Rococo admins add Rococo admins"
  on public.rococo_admins for insert to authenticated
  with check (private.is_rococo_admin());

drop policy if exists "Rococo admins remove Rococo admins" on public.rococo_admins;
create policy "Rococo admins remove Rococo admins"
  on public.rococo_admins for delete to authenticated
  using (private.is_rococo_admin());

-- ---------------------------------------------------------------------------------------
-- 2. Seed
-- ---------------------------------------------------------------------------------------
-- Read from the profiles that hold the flag today, never from a written-in address. An inactive
-- flagged profile is not carried over, so it is not turned back on. A flagged profile off Rococo's
-- domain fails the check and stops the paste, loudly, rather than lock anyone out.

insert into public.rococo_admins (email)
select lower(email) from public.profiles where is_rococo_admin and is_active
on conflict (email) do nothing;

-- ---------------------------------------------------------------------------------------
-- 3. Who added it, and the address's shape
-- ---------------------------------------------------------------------------------------

create or replace function public.rococo_admins_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.email    := lower(trim(new.email));
  new.added_by := private.auth_profile_id();
  new.added_at := now();
  return new;
end;
$$;
revoke execute on function public.rococo_admins_stamp() from public, anon, authenticated;

drop trigger if exists rococo_admins_stamp on public.rococo_admins;
create trigger rococo_admins_stamp
  before insert on public.rococo_admins
  for each row execute function public.rococo_admins_stamp();

-- ---------------------------------------------------------------------------------------
-- 4. The sync
-- ---------------------------------------------------------------------------------------
-- hub.rococo_sync is the one way past the flag guard (7). It is set for this one update and
-- cleared straight after, and only within the transaction.

create or replace function public.rococo_admins_sync_add()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('hub.rococo_sync', '1', true);
  update public.profiles
     set is_rococo_admin = true,
         is_active       = true
   where lower(email) = new.email;
  perform set_config('hub.rococo_sync', '', true);
  return null;
end;
$$;
revoke execute on function public.rococo_admins_sync_add() from public, anon, authenticated;

create or replace function public.rococo_admins_sync_remove()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('hub.rococo_sync', '1', true);
  update public.profiles
     set is_rococo_admin = false,
         is_active       = false
   where lower(email) = old.email;
  perform set_config('hub.rococo_sync', '', true);
  return null;
end;
$$;
revoke execute on function public.rococo_admins_sync_remove() from public, anon, authenticated;

drop trigger if exists rococo_admins_sync_add on public.rococo_admins;
create trigger rococo_admins_sync_add
  after insert on public.rococo_admins
  for each row execute function public.rococo_admins_sync_add();

drop trigger if exists rococo_admins_sync_remove on public.rococo_admins;
create trigger rococo_admins_sync_remove
  after delete on public.rococo_admins
  for each row execute function public.rococo_admins_sync_remove();

-- ---------------------------------------------------------------------------------------
-- 5. The last entry stays
-- ---------------------------------------------------------------------------------------
-- The lock serializes two admins removing each other: the second waits for the first to commit,
-- and its after-check then reads a fresh snapshot that sees the first removal. Both run as the
-- definer, so the check sees the whole list whoever is signed in, and it speaks only when this
-- statement removed something: a delete RLS turns into nothing stays nothing.

create or replace function public.rococo_admins_hold()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('public.rococo_admins'));
  return null;
end;
$$;
revoke execute on function public.rococo_admins_hold() from public, anon, authenticated;

create or replace function public.rococo_admins_keep_one()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from gone)
     and not exists (select 1 from public.rococo_admins) then
    raise exception 'The last Rococo admin cannot be removed.'
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;
revoke execute on function public.rococo_admins_keep_one() from public, anon, authenticated;

drop trigger if exists rococo_admins_hold on public.rococo_admins;
create trigger rococo_admins_hold
  before delete on public.rococo_admins
  for each statement execute function public.rococo_admins_hold();

drop trigger if exists rococo_admins_keep_one on public.rococo_admins;
create trigger rococo_admins_keep_one
  after delete on public.rococo_admins
  referencing old table as gone
  for each statement execute function public.rococo_admins_keep_one();

-- ---------------------------------------------------------------------------------------
-- 6. Audit
-- ---------------------------------------------------------------------------------------

drop trigger if exists rococo_admins_audit on public.rococo_admins;
create trigger rococo_admins_audit
  after insert or delete on public.rococo_admins
  for each row execute function private.audit_change('email');

-- ---------------------------------------------------------------------------------------
-- 7. Only the list writes the flag
-- ---------------------------------------------------------------------------------------
-- No early return for the SQL editor or for Rococo: the list is the one place this changes.
-- Security definer so a company admin adding someone to their roster still has the list read.

create or replace function public.guard_rococo_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.is_rococo_admin := exists (
      select 1 from public.rococo_admins r where r.email = lower(new.email)
    );
    return new;
  end if;

  if new.is_rococo_admin is distinct from old.is_rococo_admin
     and coalesce(current_setting('hub.rococo_sync', true), '') <> '1' then
    raise exception 'Rococo admins are added and removed on the Permissions page.';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_rococo_flag() from public, anon, authenticated;

drop trigger if exists profiles_guard_rococo_flag on public.profiles;
create trigger profiles_guard_rococo_flag
  before insert or update of is_rococo_admin on public.profiles
  for each row execute function public.guard_rococo_flag();

-- ---------------------------------------------------------------------------------------
-- 8. Bring the column in step
-- ---------------------------------------------------------------------------------------

select set_config('hub.rococo_sync', '1', true);
update public.profiles p
   set is_rococo_admin = false
 where p.is_rococo_admin
   and not exists (select 1 from public.rococo_admins r where r.email = lower(p.email));
select set_config('hub.rococo_sync', '', true);

-- ---------------------------------------------------------------------------------------
-- 9. The helper
-- ---------------------------------------------------------------------------------------
-- The account's own address is what must be on the list, and confirmed: the profile's address is
-- a copy, and an unconfirmed account has not proved it owns the address.

create or replace function private.is_rococo_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles p
      join auth.users u on u.id = p.user_id
      join public.rococo_admins r on r.email = lower(u.email)
     where p.user_id = (select auth.uid())
       and p.is_active
       and u.email_confirmed_at is not null
  )
$$;

revoke all on function private.is_rococo_admin() from public, anon;
grant execute on function private.is_rococo_admin() to authenticated;

-- ---------------------------------------------------------------------------------------
-- 10. The gate
-- ---------------------------------------------------------------------------------------
-- The 0049 body with one change: a Rococo address is admitted only when it is on the list, and an
-- invitation does not stand in for the list.

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

  if v_domain = 'rocococreative.io' then
    if exists (select 1 from public.rococo_admins r where r.email = v_email) then
      return '{}'::jsonb;
    end if;
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'This Rococo address is not on the Rococo admin list. Ask a Rococo admin to add you.'
    ));
  end if;

  if exists (select 1 from public.company_domains d where d.domain = v_domain)
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
