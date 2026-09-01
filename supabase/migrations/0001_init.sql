-- 0001_init.sql
-- Company Hub tenancy: companies, sign-in domains, profiles, invitations, the RLS helper
-- functions every later policy uses, and the auth triggers. Paste this whole file into the
-- Supabase SQL editor and run it. It is idempotent and safe to re-run.
--
-- Access model: one Supabase project, every company in the same tables, walled off by
-- company_id at the row level (never in the UI). A user belongs to exactly one company and
-- carries a role: 'admin' (owners and managers: the whole hub for their company) or
-- 'employee' (their own GSR data plus the SOP and resource libraries). Rococo admins
-- (is_rococo_admin) see and manage every company from the in-app Rococo section.
--
-- How a new user lands in a company (handle_new_user, below): a pending invitation for the
-- address wins; otherwise the email domain is matched against company_domains; otherwise
-- the profile has no company and the app shows a holding screen until a Rococo admin
-- assigns one. Who may create an account at all is decided by the signup gate in
-- 0002_signup_gate.sql; this file assumes only vetted addresses ever reach auth.users.

-- The helper functions reference tables created further down this same file; skip body
-- validation at definition time or the first run fails on the forward reference.
set check_function_bodies = off;

-- RLS helpers -------------------------------------------------------------------------
-- security definer so policies can read profiles without recursing into profiles RLS.
-- A deactivated profile (is_active = false) resolves to no company and no privileges, so
-- flipping that flag is the kill switch for a departed employee (their auth user can stay).

create or replace function public.auth_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_rococo_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_rococo_admin from public.profiles where id = auth.uid() and is_active),
    false
  )
$$;

create or replace function public.is_company_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role = 'admin' from public.profiles where id = auth.uid() and is_active),
    false
  )
$$;

-- May the caller read rows that belong to company cid?
create or replace function public.is_company_member(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_rococo_admin() or coalesce(cid = public.auth_company_id(), false)
$$;

-- May the caller manage (write) rows that belong to company cid? Every admin-only write
-- policy in the hub is this one predicate, so the rule lives in exactly one place.
create or replace function public.can_manage_company(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_rococo_admin()
      or (public.is_company_admin() and coalesce(cid = public.auth_company_id(), false))
$$;

revoke all on function public.auth_company_id() from public, anon;
revoke all on function public.is_rococo_admin() from public, anon;
revoke all on function public.is_company_admin() from public, anon;
revoke all on function public.is_company_member(uuid) from public, anon;
revoke all on function public.can_manage_company(uuid) from public, anon;
grant execute on function public.auth_company_id() to authenticated;
grant execute on function public.is_rococo_admin() to authenticated;
grant execute on function public.is_company_admin() to authenticated;
grant execute on function public.is_company_member(uuid) to authenticated;
grant execute on function public.can_manage_company(uuid) to authenticated;

-- Trigger functions ---------------------------------------------------------------------

-- Stamp updated_at on every update so optimistic UI and exports can trust it.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- companies ----------------------------------------------------------------------------
-- One row per client (Klasik, RBA, Kingdom). theme_key selects the brand theme the app
-- applies the moment that company's user signs in (the presets live in src/lib/theme.ts).

create table if not exists public.companies (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  theme_key   text not null default 'rococo',
  logo_url    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint companies_slug_check check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint companies_theme_key_check check (theme_key in ('rococo', 'klasik', 'kingdom', 'rba'))
);

-- company_domains ----------------------------------------------------------------------
-- Email domains that map a sign-in address to a company. Used twice: the login screen
-- looks a domain up (anonymously, via lookup_company_for_email) to pick the company and
-- its theme before any email is sent, and handle_new_user uses it to place a first-time
-- user with no invitation. Personal-email users are placed by invitation instead.

create table if not exists public.company_domains (
  domain      text primary key,
  company_id  uuid not null references public.companies (id) on delete cascade,
  created_at  timestamptz not null default now(),
  constraint company_domains_domain_check check (domain = lower(domain) and domain like '%.%')
);

create index if not exists company_domains_company_id_idx on public.company_domains (company_id);

-- profiles -----------------------------------------------------------------------------

create table if not exists public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  email            text not null,
  full_name        text,
  title            text,
  company_id       uuid references public.companies (id) on delete set null,
  role             text not null default 'employee',
  is_rococo_admin  boolean not null default false,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint profiles_role_check check (role in ('admin', 'employee'))
);

create index if not exists profiles_company_id_idx on public.profiles (company_id);

-- invitations --------------------------------------------------------------------------
-- A company admin invites an address; when that address signs in for the first time the
-- profile inherits the invitation's company, role, and title, and the row is stamped
-- accepted. Pending invitations also open the signup gate for personal-email addresses.

create table if not exists public.invitations (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  email        text not null,
  role         text not null default 'employee',
  title        text,
  invited_by   uuid references auth.users (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  constraint invitations_role_check check (role in ('admin', 'employee')),
  constraint invitations_email_lower_check check (email = lower(email) and email like '%@%.%'),
  constraint invitations_company_email_key unique (company_id, email)
);

create index if not exists invitations_email_idx on public.invitations (email);

-- Seed a profile row for each new auth user and place it in a company: a pending
-- invitation wins, then the email domain. Rococo Creative staff are Rococo admins by
-- domain (the hub is Rococo's tool for its clients); tighten to a named list here if the
-- agency ever needs to.
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
  v_company  uuid;
begin
  insert into public.profiles (id, email, full_name, is_rococo_admin)
  values (
    new.id,
    v_email,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    v_domain = 'rocococreative.io'
  )
  on conflict (id) do nothing;

  select * into v_inv
    from public.invitations
   where email = v_email and accepted_at is null
   order by created_at desc
   limit 1;

  if found then
    update public.profiles
       set company_id = v_inv.company_id,
           role       = v_inv.role,
           title      = coalesce(v_inv.title, title)
     where id = new.id;
    update public.invitations set accepted_at = now() where id = v_inv.id;
  else
    select company_id into v_company from public.company_domains where domain = v_domain;
    if v_company is not null then
      update public.profiles set company_id = v_company where id = new.id;
    end if;
  end if;

  return new;
end;
$$;

-- Field-level guard on profile updates. RLS decides WHICH rows a caller may update; this
-- decides which COLUMNS. Rococo admins may change anything. Company admins may set role,
-- title, name, and active flag for people in their own company, but never move someone
-- to another company or grant Rococo access, and never change their own role or
-- deactivate themselves (the lockout is too easy to do by accident). Members may edit only
-- their own name and title. Email is owned by auth and never changes here.
create or replace function public.guard_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.email := old.email;
  if auth.uid() is null or public.is_rococo_admin() then
    return new;
  end if;

  if new.company_id is distinct from old.company_id
     or new.is_rococo_admin is distinct from old.is_rococo_admin then
    raise exception 'Only Rococo admins can change company assignment or Rococo access.';
  end if;

  if public.is_company_admin() and old.company_id = public.auth_company_id() then
    if new.id = auth.uid()
       and (new.role is distinct from old.role or new.is_active is distinct from old.is_active) then
      raise exception 'You cannot change your own role or deactivate your own account.';
    end if;
    return new;
  end if;

  if new.id <> auth.uid() then
    raise exception 'You can only edit your own profile.';
  end if;
  if new.role is distinct from old.role or new.is_active is distinct from old.is_active then
    raise exception 'Only admins can change roles or deactivate accounts.';
  end if;
  return new;
end;
$$;

-- Company admins may rename their company and set its logo; slug and theme are Rococo's.
create or replace function public.guard_company_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_rococo_admin() then
    if new.slug is distinct from old.slug or new.theme_key is distinct from old.theme_key then
      raise exception 'Only Rococo admins can change a company slug or theme.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists profiles_guard_fields on public.profiles;
create trigger profiles_guard_fields
  before update on public.profiles
  for each row execute function public.guard_profile_fields();

drop trigger if exists companies_guard_fields on public.companies;
create trigger companies_guard_fields
  before update on public.companies
  for each row execute function public.guard_company_fields();

drop trigger if exists companies_set_updated_at on public.companies;
create trigger companies_set_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Backfill profiles for users that signed up before this migration ran.
insert into public.profiles (id, email)
select u.id, lower(u.email) from auth.users u
on conflict (id) do nothing;

-- Anonymous lookups for the login screen --------------------------------------------
-- The login form calls these with the anon key before anyone is signed in. They expose
-- only what the sign-in screen needs (company names, slugs, themes, logos) and never a
-- row from any other table. Everything else is revoked from anon below.

create or replace function public.lookup_company_for_email(p_email text)
returns table (id uuid, name text, slug text, theme_key text, logo_url text)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.name, c.slug, c.theme_key, c.logo_url
    from public.company_domains d
    join public.companies c on c.id = d.company_id
   where d.domain = split_part(lower(trim(p_email)), '@', 2)
   limit 1
$$;

create or replace function public.list_companies_public()
returns table (id uuid, name text, slug text, theme_key text, logo_url text)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.name, c.slug, c.theme_key, c.logo_url
    from public.companies c
   order by c.name
$$;

grant execute on function public.lookup_company_for_email(text) to anon, authenticated;
grant execute on function public.list_companies_public() to anon, authenticated;

-- Trigger-only functions are not API surface. PostgREST exposes every public function at
-- /rest/v1/rpc/*, so revoke EXECUTE from the API roles; triggers keep firing regardless.
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.guard_profile_fields() from public, anon, authenticated;
revoke all on function public.guard_company_fields() from public, anon, authenticated;

-- Anon reaches the two lookup functions above and nothing else. Supabase grants anon
-- table privileges by default; take them back here and for every table created later.
revoke all on all tables in schema public from anon;
alter default privileges for role postgres in schema public revoke all on tables from anon;

-- Row level security ----------------------------------------------------------------------

alter table public.companies       enable row level security;
alter table public.company_domains enable row level security;
alter table public.profiles        enable row level security;
alter table public.invitations     enable row level security;

-- companies: members read their own company (the app needs its name, theme, and logo);
-- Rococo creates and deletes companies; company admins may update (the guard trigger
-- limits them to name and logo).
drop policy if exists "Members read own company, Rococo reads all" on public.companies;
create policy "Members read own company, Rococo reads all"
  on public.companies for select
  to authenticated
  using (public.is_company_member(id));

drop policy if exists "Rococo admins create companies" on public.companies;
create policy "Rococo admins create companies"
  on public.companies for insert
  to authenticated
  with check (public.is_rococo_admin());

drop policy if exists "Company admins and Rococo update companies" on public.companies;
create policy "Company admins and Rococo update companies"
  on public.companies for update
  to authenticated
  using (public.can_manage_company(id))
  with check (public.can_manage_company(id));

drop policy if exists "Rococo admins delete companies" on public.companies;
create policy "Rococo admins delete companies"
  on public.companies for delete
  to authenticated
  using (public.is_rococo_admin());

-- company_domains: domains decide who can sign up, so only Rococo edits them.
drop policy if exists "Members read own company domains" on public.company_domains;
create policy "Members read own company domains"
  on public.company_domains for select
  to authenticated
  using (public.is_company_member(company_id));

drop policy if exists "Rococo admins manage company domains" on public.company_domains;
create policy "Rococo admins manage company domains"
  on public.company_domains for all
  to authenticated
  using (public.is_rococo_admin())
  with check (public.is_rococo_admin());

-- profiles: your own row, your company's people, Rococo everyone. Updates: own row, or any
-- row in your company for company admins; the guard trigger pins the sensitive columns.
-- No insert (the auth trigger seeds rows) and no delete (deactivate instead).
drop policy if exists "Users read own, teammates, Rococo reads all profiles" on public.profiles;
create policy "Users read own, teammates, Rococo reads all profiles"
  on public.profiles for select
  to authenticated
  using (
    public.is_rococo_admin()
    or id = auth.uid()
    or (company_id is not null and company_id = public.auth_company_id())
  );

drop policy if exists "Users update own, admins update company profiles" on public.profiles;
create policy "Users update own, admins update company profiles"
  on public.profiles for update
  to authenticated
  using (
    public.is_rococo_admin()
    or id = auth.uid()
    or (public.is_company_admin() and company_id is not null and company_id = public.auth_company_id())
  )
  with check (
    public.is_rococo_admin()
    or id = auth.uid()
    or (public.is_company_admin() and company_id is not null and company_id = public.auth_company_id())
  );

-- invitations: company admins (and Rococo) manage their company's invitations.
drop policy if exists "Company admins manage invitations" on public.invitations;
create policy "Company admins manage invitations"
  on public.invitations for all
  to authenticated
  using (public.can_manage_company(company_id))
  with check (public.can_manage_company(company_id));
