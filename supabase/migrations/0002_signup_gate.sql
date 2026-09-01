-- 0002_signup_gate.sql
-- Who may create an account: the server-side gate. Paste after 0001; idempotent.
--
-- Why this exists: the login screen sends magic links with shouldCreateUser: true, so a
-- first-time user with a company email never waits on a manual invite. That means ANYONE
-- could hit the Supabase auth API with the public anon key and mint an account unless the
-- server refuses. An app-side check is not security (it only powers a friendly message
-- before any email is sent). The real rule lives here, as a "Before User Created" auth
-- hook: Supabase calls this function just before it creates any new user; return '{}' to
-- allow or an error object to reject.
--
-- Allowed: an address whose domain belongs to a company (company_domains), an address
-- with a pending invitation (personal emails get in this way), and Rococo Creative staff.
-- Everyone else is rejected with a clean 403 and never reaches auth.users. The hook fires
-- only on user CREATION, so existing accounts keep signing in untouched.
--
-- How to apply: run this file, then wire it up in the dashboard. The order is load-bearing:
--   1. Authentication -> Hooks -> "Before User Created": enable, select public.restrict_signups.
--   2. Authentication -> Sign In / Providers -> Email: turn ON "Allow new users to sign up".
-- Enable and confirm the hook (step 1) BEFORE sign-ups go on (step 2). While sign-ups are
-- ON and the hook is OFF, account creation is open to the internet. If you ever disable the
-- hook, turn sign-ups off first. Quick check after flipping sign-ups on: try a throwaway
-- @gmail.com address and confirm it is rejected.

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


-- Fallback (only if the "Before User Created" hook is unavailable on this project) -------
-- Enforce the same rule with a plain trigger on auth.users. Same effect; the client gets a
-- generic error rather than the hook's clean 403, but the app-side pre-check means a
-- legitimate user never sees either. Uncomment this block and DO NOT enable the hook above
-- if you use it.
--
-- create or replace function public.restrict_signups_trigger()
-- returns trigger
-- language plpgsql
-- security definer set search_path = ''
-- as $$
-- declare
--   v_email  text := lower(new.email);
--   v_domain text := split_part(lower(new.email), '@', 2);
-- begin
--   if v_domain = 'rocococreative.io'
--      or exists (select 1 from public.company_domains d where d.domain = v_domain)
--      or exists (select 1 from public.invitations i where i.email = v_email and i.accepted_at is null)
--   then
--     return new;
--   end if;
--   raise exception 'This email is not set up for Company Hub yet. Ask your company admin for an invitation.';
-- end;
-- $$;
--
-- drop trigger if exists restrict_signups_insert on auth.users;
-- create trigger restrict_signups_insert
--   before insert on auth.users
--   for each row execute function public.restrict_signups_trigger();
