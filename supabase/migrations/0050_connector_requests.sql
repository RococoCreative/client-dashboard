-- 0050_connector_requests.sql
-- Which outside tools a company has asked for. Paste after 0049; idempotent.
--
-- Why: the Connections catalog lists tools that are not built yet, and a company's admin can say
-- "we use this one" so Rococo knows what to build next. A request is a company's own row (rule 12);
-- a company with none is exactly where every company starts. The key is checked for its shape
-- only, never against the catalog, so a new card in the app never needs a migration.
--
--   1. public.connector_requests: one row per company per tool. Members of the company and Rococo
--      read; admins of the company (and a Rococo admin acting for it) ask and withdraw. There is
--      no update grant, so a row never changes, and never moves company.
--   2. public.stamp_connector_request(): who asked is the signed-in person, whatever the insert
--      sent. With nobody signed in (the SQL editor) the row keeps what it was given.
--   3. Every ask and withdrawal is audited.
--
-- Deleting a person who asked (0049) keeps the request and clears who asked.

-- ---------------------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------------------

create table if not exists public.connector_requests (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  connector_key text not null,
  requested_by  uuid references public.profiles (id) on delete set null,
  requested_at  timestamptz not null default now(),
  constraint connector_requests_key_check check (connector_key ~ '^[a-z][a-z0-9_]{1,40}$'),
  constraint connector_requests_company_id_connector_key_key unique (company_id, connector_key)
);

create index if not exists connector_requests_requested_by_idx on public.connector_requests (requested_by);

alter table public.connector_requests enable row level security;

revoke all on public.connector_requests from anon, authenticated;
grant select, insert, delete on public.connector_requests to authenticated;

drop policy if exists "Members read tool requests" on public.connector_requests;
create policy "Members read tool requests"
  on public.connector_requests for select to authenticated
  using (private.is_rococo_admin() or private.is_company_member(company_id));

drop policy if exists "Admins ask for tools" on public.connector_requests;
create policy "Admins ask for tools"
  on public.connector_requests for insert to authenticated
  with check (private.can_manage_company(company_id));

drop policy if exists "Admins withdraw tool requests" on public.connector_requests;
create policy "Admins withdraw tool requests"
  on public.connector_requests for delete to authenticated
  using (private.can_manage_company(company_id));

-- ---------------------------------------------------------------------------------------
-- 2. Who asked
-- ---------------------------------------------------------------------------------------
-- A signed-in account that resolves to no active profile names nobody; it is never left to the
-- insert to say who asked.

create or replace function public.stamp_connector_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.requested_by := private.auth_profile_id();
  end if;
  return new;
end;
$$;
revoke execute on function public.stamp_connector_request() from public, anon, authenticated;

drop trigger if exists connector_requests_stamp on public.connector_requests;
create trigger connector_requests_stamp
  before insert on public.connector_requests
  for each row execute function public.stamp_connector_request();

-- ---------------------------------------------------------------------------------------
-- 3. Audit
-- ---------------------------------------------------------------------------------------

drop trigger if exists connector_requests_audit on public.connector_requests;
create trigger connector_requests_audit
  after insert or update or delete on public.connector_requests
  for each row execute function private.audit_change('connector_key');
