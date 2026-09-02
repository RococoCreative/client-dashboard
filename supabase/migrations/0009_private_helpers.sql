-- 0009_private_helpers.sql
-- Move the RLS helper functions out of the API-exposed public schema. Paste after 0008;
-- idempotent and safe to re-run.
--
-- Why: PostgREST publishes every function in `public` at /rest/v1/rpc/*, and Supabase's
-- security advisor flags SECURITY DEFINER functions that signed-in users can call that way.
-- The helpers only ever report on the caller (their own company, their own role), so
-- nothing leaked, but they have no business being an API. They move to a `private` schema
-- that PostgREST does not expose. Table and storage policies follow automatically: they
-- reference functions by identity, not by name. The two login lookups
-- (lookup_company_for_email, list_companies_public) stay in public on purpose: the sign-in
-- screen calls them anonymously and they return only company names, slugs, themes, logos.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- Move each helper only if it still lives in public (re-runs skip this).
do $$
declare
  v_name text;
  v_args text;
begin
  for v_name, v_args in
    select * from (values
      ('auth_company_id', ''),
      ('is_rococo_admin', ''),
      ('is_company_admin', ''),
      ('is_company_member', 'uuid'),
      ('can_manage_company', 'uuid'),
      ('path_company_id', 'text')
    ) as t(name, args)
  loop
    if exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = v_name
    ) then
      execute format('alter function public.%I(%s) set schema private', v_name, v_args);
    end if;
  end loop;
end $$;

-- The two composite helpers name the others in their bodies; re-point them.
create or replace function private.is_company_member(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.is_rococo_admin() or coalesce(cid = private.auth_company_id(), false)
$$;

create or replace function private.can_manage_company(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.is_rococo_admin()
      or (private.is_company_admin() and coalesce(cid = private.auth_company_id(), false))
$$;

-- Trigger functions whose bodies name the helpers (bodies are parsed at run time).
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

  if new.company_id is distinct from old.company_id
     or new.is_rococo_admin is distinct from old.is_rococo_admin then
    raise exception 'Only Rococo admins can change company assignment or Rococo access.';
  end if;

  if private.is_company_admin() and old.company_id = private.auth_company_id() then
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

create or replace function public.guard_company_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not private.is_rococo_admin() then
    if new.slug is distinct from old.slug or new.theme_key is distinct from old.theme_key then
      raise exception 'Only Rococo admins can change a company slug or theme.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.guard_review_employee_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if private.can_manage_company(old.company_id) then
    return new;
  end if;
  if row(new.cycle_id, new.company_id, new.employee_id, new.status, new.previous_status,
         new.manager_feedback, new.peer_feedback, new.client_feedback, new.reviewer_id,
         new.completed_at)
     is distinct from
     row(old.cycle_id, old.company_id, old.employee_id, old.status, old.previous_status,
         old.manager_feedback, old.peer_feedback, old.client_feedback, old.reviewer_id,
         old.completed_at) then
    raise exception 'Only admins can edit review scores, status, and feedback.';
  end if;
  return new;
end;
$$;

-- Policies run with the caller's privileges, so authenticated keeps EXECUTE on the helpers;
-- anon and public get nothing. Nothing in the private schema is reachable over the API.
revoke all on function private.auth_company_id() from public, anon;
revoke all on function private.is_rococo_admin() from public, anon;
revoke all on function private.is_company_admin() from public, anon;
revoke all on function private.is_company_member(uuid) from public, anon;
revoke all on function private.can_manage_company(uuid) from public, anon;
revoke all on function private.path_company_id(text) from public, anon;
grant execute on function private.auth_company_id() to authenticated;
grant execute on function private.is_rococo_admin() to authenticated;
grant execute on function private.is_company_admin() to authenticated;
grant execute on function private.is_company_member(uuid) to authenticated;
grant execute on function private.can_manage_company(uuid) to authenticated;
grant execute on function private.path_company_id(text) to authenticated;
