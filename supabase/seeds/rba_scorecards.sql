-- rba_scorecards.sql
-- RBA's divisions, job roles and scorecard metrics, as data (rule 12: a company's shape is its
-- rows). Run once in the Supabase SQL editor after 0035 is applied; safe to run again, since
-- everything it adds is skipped when it is already there and nothing existing is changed.
--
-- This data script is the one place a company is found by its slug. The roles and metrics come
-- from Ryan's scorecard workbook. Production Manager already exists (RBA North only) and is left
-- as it is; Director of Construction and Manager of Administration and Internal Operations have
-- no metrics yet, because the workbook points to a strategy session for both. Division names are
-- RBA South (RBA) and RBA North (RBAN), to confirm with Austin.
--
-- Ends with one check row: the divisions, the roles and the metrics RBA now carries.

begin;

do $$
begin
  if not exists (select 1 from public.companies where slug = 'rba') then
    raise exception 'No company with slug rba. Nothing was changed.';
  end if;
  if to_regclass('public.role_metrics') is null or to_regclass('public.company_divisions') is null then
    raise exception 'Apply 0035_scorecards_divisions_focus_calendar.sql first. Nothing was changed.';
  end if;
end $$;

-- 1. Divisions -----------------------------------------------------------------------------
insert into public.company_divisions (company_id, name, sort_order)
select c.id, d.name, d.sort_order
  from public.companies c
 cross join (values ('RBA South', 1), ('RBA North', 2)) as d (name, sort_order)
 where c.slug = 'rba'
on conflict (company_id, name) do nothing;

-- 2. Job roles: add the missing ones after the existing list, keep every existing row ----------
insert into public.job_roles (company_id, name, sort_order)
select c.id, r.name,
       coalesce((select max(j.sort_order) from public.job_roles j where j.company_id = c.id), 0) + r.ord
  from public.companies c
 cross join (values
   ('Project Manager', 1),
   ('Site Superintendent', 2),
   ('Construction Coordinator', 3),
   ('Construction Technician', 4),
   ('Controller', 5),
   ('Director of Construction', 6),
   ('Manager of Administration and Internal Operations', 7),
   ('Business Development and Procurement', 8)
 ) as r (name, ord)
 where c.slug = 'rba'
   and not exists (select 1 from public.job_roles j where j.company_id = c.id and j.name = r.name)
on conflict (company_id, name) do nothing;

-- 3. Metrics -------------------------------------------------------------------------------
-- kind: percent (0 to 100), rating (1 to scale_max, here 1 to 5) or number. A null target is
-- shown and never judged. Optimization rate is an ordinary percent metric with the role's target.
insert into public.role_metrics (company_id, job_role_id, name, kind, target, scale_max, per_project, sort_order)
select j.company_id, j.id, m.name, m.kind, m.target, 5, m.per_project, m.sort_order
  from public.companies c
  join public.job_roles j on j.company_id = c.id
  join (values
    ('Project Manager', 'Optimization rate', 'percent', 80::numeric, false, 1),
    ('Project Manager', 'Job cost: gross profit', 'percent', null, true, 2),
    ('Project Manager', 'Job cost: net profit', 'percent', null, true, 3),
    ('Project Manager', 'Client journey satisfaction', 'rating', null, false, 4),
    ('Project Manager', 'Architect and designer journey satisfaction', 'rating', null, false, 5),
    ('Project Manager', 'Monthly meeting held and documented', 'rating', null, false, 6),
    ('Project Manager', 'Compliance to SOPs', 'rating', null, false, 7),
    ('Project Manager', 'Punch list process followed', 'rating', null, false, 8),

    ('Site Superintendent', 'Optimization rate', 'percent', 90, false, 1),
    ('Site Superintendent', 'Daily logs', 'rating', null, false, 2),
    ('Site Superintendent', 'Safety compliance', 'rating', null, false, 3),
    ('Site Superintendent', 'Productivity on site, on schedule', 'rating', null, false, 4),
    ('Site Superintendent', 'Trade management, quality of work', 'rating', null, false, 5),

    ('Construction Coordinator', 'Optimization rate', 'percent', 70, false, 1),
    ('Construction Coordinator', 'Schedules updated', 'rating', null, false, 2),
    ('Construction Coordinator', 'Safety compliance', 'rating', null, false, 3),
    ('Construction Coordinator', 'Monthly meeting booked, planned, documented', 'rating', null, false, 4),
    ('Construction Coordinator', 'Job cost: gross profit', 'percent', null, true, 5),
    ('Construction Coordinator', 'Job cost: net profit', 'percent', null, true, 6),

    ('Construction Technician', 'Optimization rate', 'percent', 90, false, 1),
    ('Construction Technician', 'Daily logs', 'rating', null, false, 2),
    ('Construction Technician', 'Safety compliance', 'rating', null, false, 3),
    ('Construction Technician', 'Timesheets', 'rating', null, false, 4),

    ('Controller', 'Optimization rate', 'percent', null, false, 1),
    ('Controller', 'P&L analysis', 'rating', null, false, 2),
    ('Controller', 'Production and financial forecasting', 'rating', null, false, 3),
    ('Controller', 'Pipeline analysis', 'rating', null, false, 4),
    ('Controller', 'Production analysis', 'rating', null, false, 5),

    ('Business Development and Procurement', 'Booked appointments', 'number', null, false, 1),
    ('Business Development and Procurement', 'Events hosted', 'number', null, false, 2),
    ('Business Development and Procurement', 'Cabinet deals sold to preferred vendors', 'number', null, false, 3),
    ('Business Development and Procurement', 'New self-generated leads', 'number', null, false, 4),
    ('Business Development and Procurement', 'CRM kept up to date', 'rating', null, false, 5)
  ) as m (role_name, name, kind, target, per_project, sort_order)
    on m.role_name = j.name
 where c.slug = 'rba'
on conflict (job_role_id, name) do nothing;

commit;

-- Check: expect 2 divisions, the 8 named roles present, 33 metrics across 6 roles.
select c.slug,
       (select count(*) from public.company_divisions d where d.company_id = c.id
          and d.name in ('RBA South', 'RBA North')) as divisions,
       (select count(*) from public.job_roles j where j.company_id = c.id
          and j.name in ('Project Manager', 'Site Superintendent', 'Construction Coordinator',
                         'Construction Technician', 'Controller', 'Director of Construction',
                         'Manager of Administration and Internal Operations',
                         'Business Development and Procurement')) as named_roles,
       (select count(*) from public.job_roles j where j.company_id = c.id) as all_roles,
       (select count(*) from public.role_metrics m where m.company_id = c.id) as metrics,
       (select count(distinct m.job_role_id) from public.role_metrics m where m.company_id = c.id) as roles_with_metrics,
       (select string_agg(j.name || ' ' || n, ', ' order by j.sort_order)
          from (select m.job_role_id, count(*) as n from public.role_metrics m where m.company_id = c.id group by m.job_role_id) x
          join public.job_roles j on j.id = x.job_role_id) as per_role
  from public.companies c
 where c.slug = 'rba';
