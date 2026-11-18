-- 0040_capabilities.sql
-- The capability catalog, per-company overrides and private.can(). Paste after 0039; idempotent.
--
-- Why: who may do a handful of sensitive things (see pay, change company settings, read the
-- change log, edit milestones, post wins, run a sync, view production) is fixed in code today.
-- Each company needs to set that for itself, so the lowest role that holds each power becomes a
-- row every company carries, with today's behavior as the default.
--
--   1. public.capabilities is the catalog: one row per power and the lowest role that holds it
--      by default. Seeded here; nobody writes it from the browser.
--   2. public.company_capabilities holds a company's overrides. No row means the default. Members
--      read their own company's rows; only Rococo writes them. Every change is audited.
--   3. private.can(cid, cap) answers whether the signed-in person holds a capability in a
--      company. A Rococo admin holds every one. The level 'rococo' is never met by a company
--      role. An unknown key, another company, an inactive person or no profile is false.
--
-- This migration changes no existing policy; 0041 moves policies onto private.can().

-- ---------------------------------------------------------------------------------------
-- 1. The catalog
-- ---------------------------------------------------------------------------------------

create table if not exists public.capabilities (
  key              text primary key,
  default_min_role text not null,
  sort_order       integer not null,
  constraint capabilities_default_min_role_check
    check (default_min_role in ('employee', 'manager', 'admin', 'owner', 'rococo'))
);

insert into public.capabilities (key, default_min_role, sort_order) values
  ('pay',              'admin',    1),
  ('company_settings', 'admin',    2),
  ('audit_log',        'rococo',   3),
  ('milestones_edit',  'admin',    4),
  ('wins_post',        'admin',    5),
  ('sync_run',         'admin',    6),
  ('production_view',  'employee', 7)
on conflict (key) do nothing;

alter table public.capabilities enable row level security;

revoke all on public.capabilities from anon, authenticated;
grant select on public.capabilities to authenticated;

drop policy if exists "Signed-in people read capabilities" on public.capabilities;
create policy "Signed-in people read capabilities"
  on public.capabilities for select to authenticated
  using (true);

-- ---------------------------------------------------------------------------------------
-- 2. A company's overrides
-- ---------------------------------------------------------------------------------------
-- Keyed by id because the shared audit trigger (0025) reads the row id from an id column; the
-- unique constraint keeps one override per company per capability.

create table if not exists public.company_capabilities (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  capability  text not null references public.capabilities (key),
  min_role    text not null,
  constraint company_capabilities_company_capability_key unique (company_id, capability),
  constraint company_capabilities_min_role_check
    check (min_role in ('employee', 'manager', 'admin', 'owner', 'rococo'))
);

create index if not exists company_capabilities_capability_idx on public.company_capabilities (capability);

alter table public.company_capabilities enable row level security;

revoke all on public.company_capabilities from anon, authenticated;
grant select, insert, update, delete on public.company_capabilities to authenticated;

drop policy if exists "Members read company capabilities" on public.company_capabilities;
create policy "Members read company capabilities"
  on public.company_capabilities for select to authenticated
  using (private.is_rococo_admin() or private.is_company_member(company_id));

drop policy if exists "Rococo creates company capabilities" on public.company_capabilities;
create policy "Rococo creates company capabilities"
  on public.company_capabilities for insert to authenticated
  with check (private.is_rococo_admin());

drop policy if exists "Rococo updates company capabilities" on public.company_capabilities;
create policy "Rococo updates company capabilities"
  on public.company_capabilities for update to authenticated
  using (private.is_rococo_admin())
  with check (private.is_rococo_admin());

drop policy if exists "Rococo deletes company capabilities" on public.company_capabilities;
create policy "Rococo deletes company capabilities"
  on public.company_capabilities for delete to authenticated
  using (private.is_rococo_admin());

drop trigger if exists company_capabilities_audit on public.company_capabilities;
create trigger company_capabilities_audit
  after insert or update or delete on public.company_capabilities
  for each row execute function private.audit_change('min_role');

-- ---------------------------------------------------------------------------------------
-- 3. private.can()
-- ---------------------------------------------------------------------------------------
-- The signed-in person is found the way private.has_full_scope() finds them. The level is the
-- company's override if it has one, else the catalog default; with neither (an unknown key) the
-- join finds no row and the answer is false.

create or replace function private.can(cid uuid, cap text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_rococo_admin()
      or coalesce(
           (select lvl.level <> 'rococo'
                   and private.role_rank(p.role) >= private.role_rank(lvl.level)
              from public.profiles p
              cross join lateral (
                select coalesce(o.min_role, c.default_min_role) as level
                  from public.capabilities c
                  left join public.company_capabilities o
                    on o.capability = c.key and o.company_id = cid
                 where c.key = cap
              ) lvl
             where p.user_id = (select auth.uid())
               and p.is_active
               and not p.is_rococo_admin
               and p.company_id = cid),
           false
         )
$$;
revoke all on function private.can(uuid, text) from public, anon;
grant execute on function private.can(uuid, text) to authenticated, service_role;
