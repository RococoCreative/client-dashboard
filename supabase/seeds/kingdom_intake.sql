-- kingdom_intake.sql
-- Kingdom's roster, job roles and capability levels, as data (rule 12: a company's shape is its
-- rows). This data script is the one place Kingdom is named; it finds the company by its slug.
--
-- Run order: paste 0040 and 0041, confirm the API serves the new tables, merge and deploy the app
-- (it cannot load a company without 0040's tables, so the migrations go first), then run this once
-- in the Supabase SQL editor, off hours. It refuses to run, and changes nothing, unless both
-- migrations are in. Safe to run again: a second run finds everything already in place and changes
-- nothing. If the check rows at the end do not appear, run it again.
--
-- What it does, all in one transaction:
--   1. Capability levels: the seven Kingdom values below, written as Kingdom's overrides.
--   2. Job roles: adds any of the eight Kingdom titles that are missing, after the existing list.
--      Existing job roles are left as they are.
--   3. People: the ten listed below, matched by address without regard to case.
--      * Someone missing is added the way the People screen adds a person: on the roster, with
--        no account until they first sign in, in no division, reporting to nobody yet, with the
--        job role named by their title.
--      * Someone already on Kingdom's roster gets the listed role and title, and the job role
--        named by their title only if they have none. Their account link, manager, active flag
--        and name are never touched.
--      * If a listed address belongs to anyone outside Kingdom (another company, nobody's
--        roster, or a Rococo admin), the script stops and nothing is changed.
--      * Nobody who is not listed is changed. Other active Kingdom people are only reported.
--
-- Read this before running it:
--   * The listed role wins over whatever the person holds today, in both directions. Anyone in
--     the list who is marked owner or admin today and listed lower is lowered to the listed role.
--     As of 2026-11-18 the README lists Maddie Cothran and Marvin Waters as Kingdom's owners, so
--     if their live addresses are the listed ones, this run makes Marvin an admin and Maddie an
--     employee. Confirm both owners' addresses before running it: if an owner's real address is a
--     different one, signing in with it makes a new employee and leaves the owner row unclaimed.
--     Eli Cothran and Davis Nix become the owners.
--   * Pay and the company row (company settings) are set to owner. An owner who is not in the
--     list keeps their role and appears in the check rows, to be handled by hand. If there is no
--     such owner, then until Eli or Davis signs in, only Rococo reaches Kingdom's pay and company
--     row.
--   * Reporting lines are not set here; they are still to come from Kingdom.
--
-- Ends with the check rows, as one result:
--   person      one row per listed person: role before this run, role now, whether they have
--               signed in, whether they see every division, and what this run did;
--   not listed  every other active Kingdom person, so a leftover test row is seen;
--   capability  the seven capability rows, level before this run and level now.
-- Expect 10 person rows and 7 capability rows. On a second run every row reads "unchanged" and
-- "role before" equals "role now" on every line.

begin;

do $$
begin
  if not exists (select 1 from public.companies where slug = 'kingdom') then
    raise exception 'No company with slug kingdom. Nothing was changed.';
  end if;
  -- 0040 adds the table and 0041 moves the policies onto it; rows written before 0041 would hide
  -- pay on screen while the old policies still serve it, so both must be in.
  if to_regclass('public.company_capabilities') is null
     or not exists (select 1 from pg_policies
                     where schemaname = 'public' and tablename = 'sync_sources'
                       and policyname = 'Syncers read sync sources') then
    raise exception 'Apply 0040_capabilities.sql and 0041_capability_policies.sql first. Nothing was changed.';
  end if;
end $$;

-- The list, and what the rows looked like before this run. Session tables, kept after commit so
-- the check at the end can read them; dropped first so a second run in the same session starts
-- clean.
drop table if exists pg_temp.kingdom_intake_people;
drop table if exists pg_temp.kingdom_intake_before;
drop table if exists pg_temp.kingdom_intake_caps_before;

create temp table kingdom_intake_people (
  ord       integer not null,
  full_name text not null,
  title     text not null,
  email     text not null,
  role      text not null
);

insert into kingdom_intake_people (ord, full_name, title, email, role) values
  (1,  'Eli Cothran',          'Owner',                          'eli@kingdomcustomconstruction.com',       'owner'),
  (2,  'Davis Nix',            'Owner',                          'davis@kingdomcustomconstruction.com',     'owner'),
  (3,  'Marvin Waters',        'Operations Manager',             'marvin@kingdomcustomconstruction.com',    'admin'),
  (4,  'Christian Augspurger', 'Project Manager',                'christian@kingdomcustomconstruction.com', 'manager'),
  (5,  'Neo Baldovino',        'Project Manager',                'neo@kingdomcustomconstruction.com',       'manager'),
  (6,  'Ashley Oglesby',       'Executive Assistant',            'ashley@kingdomcustomconstruction.com',    'employee'),
  (7,  'Maddie Cothran',       'Design Lead',                    'maddie@kingdomcustomconstruction.com',    'employee'),
  (8,  'Katie Livingstone',    'Project Designer',               'katie@kingdomcustomconstruction.com',     'employee'),
  (9,  'Bailey Tate',          'Selections Coordinator',         'bailey@kingdomcustomconstruction.com',    'employee'),
  (10, 'Stephen Park',         'Estimating & Sales Coordinator', 'stephen@kingdomcustomconstruction.com',   'employee');

-- Stop before anything changes if a listed address is on file outside Kingdom.
do $$
declare
  v_kingdom uuid := (select id from public.companies where slug = 'kingdom');
  v_found text;
begin
  select string_agg(
           l.email || ' (' ||
           case when p.is_rococo_admin then 'a Rococo admin'
                when p.company_id is null then 'on no company''s roster'
                else 'on another company''s roster' end || ')',
           ', ' order by l.ord)
    into v_found
    from kingdom_intake_people l
    join public.profiles p on lower(p.email) = lower(l.email)
   where p.company_id is distinct from v_kingdom or p.is_rococo_admin;
  if v_found is not null then
    raise exception 'Listed addresses on file outside Kingdom: %. Nothing was changed.', v_found;
  end if;
end $$;

create temp table kingdom_intake_before as
select l.ord, p.id, p.role, p.title, p.job_role_id
  from kingdom_intake_people l
  join public.profiles p on lower(p.email) = lower(l.email);

create temp table kingdom_intake_caps_before as
select cc.capability, cc.min_role
  from public.company_capabilities cc
  join public.companies c on c.id = cc.company_id
 where c.slug = 'kingdom';

-- 1. Capability levels ------------------------------------------------------------------------
insert into public.company_capabilities (company_id, capability, min_role)
select c.id, v.capability, v.min_role
  from public.companies c
 cross join (values
   ('pay',              'owner'),
   ('company_settings', 'owner'),
   ('audit_log',        'admin'),
   ('milestones_edit',  'manager'),
   ('wins_post',        'employee'),
   ('sync_run',         'manager'),
   ('production_view',  'manager')
 ) as v (capability, min_role)
 where c.slug = 'kingdom'
on conflict (company_id, capability) do update
  set min_role = excluded.min_role
  where public.company_capabilities.min_role is distinct from excluded.min_role;

-- 2. Job roles: add the missing ones after the existing list, keep every existing row ----------
insert into public.job_roles (company_id, name, sort_order)
select c.id, r.name,
       coalesce((select max(j.sort_order) from public.job_roles j where j.company_id = c.id), 0) + r.ord
  from public.companies c
 cross join (values
   ('Owner', 1),
   ('Operations Manager', 2),
   ('Project Manager', 3),
   ('Executive Assistant', 4),
   ('Design Lead', 5),
   ('Project Designer', 6),
   ('Selections Coordinator', 7),
   ('Estimating & Sales Coordinator', 8)
 ) as r (name, ord)
 where c.slug = 'kingdom'
   and not exists (select 1 from public.job_roles j where j.company_id = c.id and j.name = r.name)
on conflict (company_id, name) do nothing;

-- 3. People -----------------------------------------------------------------------------------
-- Already on Kingdom's roster: role and title as listed, a job role only where there is none.
-- Rows that already match are skipped, so a second run writes nothing.
update public.profiles p
   set role        = l.role,
       title       = l.title,
       job_role_id = coalesce(p.job_role_id, j.id)
  from kingdom_intake_people l
  join public.companies c on c.slug = 'kingdom'
  left join public.job_roles j on j.company_id = c.id and j.name = l.title
 where lower(p.email) = lower(l.email)
   and p.company_id = c.id
   and (p.role is distinct from l.role
        or p.title is distinct from l.title
        or (p.job_role_id is null and j.id is not null));

-- Missing: on the roster with the columns the People screen sets, no account, plus the job role.
insert into public.profiles (company_id, email, full_name, title, role, division_ids, reports_to, job_role_id)
select c.id, lower(l.email), l.full_name, l.title, l.role, '{}', null, j.id
  from kingdom_intake_people l
  join public.companies c on c.slug = 'kingdom'
  left join public.job_roles j on j.company_id = c.id and j.name = l.title
 where not exists (select 1 from public.profiles p where lower(p.email) = lower(l.email))
 order by l.ord;

commit;

-- Check: 10 person rows, any not-listed rows to handle by hand, then 7 capability rows.
select x.section, x.item, x.name, x.role_before, x.role_now, x.signed_in, x.sees_every_division, x.this_run
  from (
    select 1 as section_order, l.ord as row_order,
           'person' as section, p.email as item, p.full_name as name,
           b.role as role_before, p.role as role_now,
           (p.user_id is not null) as signed_in,
           p.view_all_divisions as sees_every_division,
           case when b.id is null then 'added'
                when b.role is distinct from p.role
                  or b.title is distinct from p.title
                  or b.job_role_id is distinct from p.job_role_id then 'updated'
                else 'unchanged' end as this_run
      from kingdom_intake_people l
      join public.profiles p on lower(p.email) = lower(l.email)
      left join kingdom_intake_before b on b.id = p.id
    union all
    select 2, row_number() over (order by p.email),
           'not listed', p.email, p.full_name,
           p.role, p.role,
           (p.user_id is not null),
           p.view_all_divisions,
           'not touched: handle by hand'
      from public.profiles p
      join public.companies c on c.id = p.company_id and c.slug = 'kingdom'
     where p.is_active
       and not exists (select 1 from kingdom_intake_people l where lower(l.email) = lower(p.email))
    union all
    select 3, k.sort_order,
           'capability', k.key, null,
           b.min_role, cc.min_role,
           null, null,
           case when b.min_role is null then 'added'
                when b.min_role is distinct from cc.min_role then 'updated'
                else 'unchanged' end
      from public.capabilities k
      join public.companies c on c.slug = 'kingdom'
      join public.company_capabilities cc on cc.company_id = c.id and cc.capability = k.key
      left join kingdom_intake_caps_before b on b.capability = k.key
  ) x
 order by x.section_order, x.row_order;
