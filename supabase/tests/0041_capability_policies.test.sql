-- 0041_capability_policies.test.sql
-- Proves that six behaviours follow a company's capability levels (0041): pay, the company row,
-- the change log, milestones, wins and Sync now. Kingdom carries overrides that move each one up
-- or down; Klasik carries none and behaves exactly as before. Personal financial figures do not
-- move with pay, a person still reads their own pay, project writes stay with admins, a syncer may
-- only ask for a sync, and no capability opens a path into another company.
--
-- Runs inside one transaction the harness opens and rolls back; never begin or commit here.

-- Setup, as system.
select tests.create_person('kingdom_owner', tests.company('kingdom'), 'owner');
select tests.create_person('kingdom_admin', tests.company('kingdom'), 'admin');
select tests.create_person('kingdom_manager', tests.company('kingdom'), 'manager');
select tests.create_person('kingdom_employee', tests.company('kingdom'));
select tests.create_person('klasik_admin', tests.company('klasik'), 'admin');
select tests.create_person('klasik_manager', tests.company('klasik'), 'manager');
select tests.create_person('klasik_employee', tests.company('klasik'));
select tests.create_person('rococo_admin', null, 'employee', true);

with p as (
  insert into public.projects (company_id, name, reference)
  values (tests.company('kingdom'), 'Sample job 4101', '4101')
  returning id
)
insert into tests.fixture (name, id) select 'project_kingdom', id from p;
with p as (
  insert into public.projects (company_id, name, reference)
  values (tests.company('klasik'), 'Sample job 4102', '4102')
  returning id
)
insert into tests.fixture (name, id) select 'project_klasik', id from p;

with m as (
  insert into public.project_milestones (project_id, title, sort_order)
  values (tests.id('project_kingdom'), 'Sample milestone K', 1)
  returning id
)
insert into tests.fixture (name, id) select 'milestone_kingdom', id from m;
with m as (
  insert into public.project_milestones (project_id, title, sort_order)
  values (tests.id('project_klasik'), 'Sample milestone L', 1)
  returning id
)
insert into tests.fixture (name, id) select 'milestone_klasik', id from m;

with c as (
  insert into public.compensation_items (company_id, employee_id, name, annual_amount)
  values (tests.company('kingdom'), tests.id('kingdom_employee'), 'Sample base', 50000)
  returning id
)
insert into tests.fixture (name, id) select 'pay_kingdom', id from c;
with c as (
  insert into public.compensation_items (company_id, employee_id, name, annual_amount)
  values (tests.company('klasik'), tests.id('klasik_employee'), 'Sample base', 50000)
  returning id
)
insert into tests.fixture (name, id) select 'pay_klasik', id from c;

insert into public.employee_financials (company_id, employee_id, year, metric, target)
values (tests.company('kingdom'), tests.id('kingdom_employee'), 2026, 'Sample revenue', 100);

with c as (
  insert into public.company_connections (company_id, provider, status)
  values (tests.company('kingdom'), 'google_sheets', 'connected')
  returning id
)
insert into tests.fixture (name, id) select 'k_sheets', id from c;
with c as (
  insert into public.company_connections (company_id, provider, status)
  values (tests.company('klasik'), 'google_sheets', 'connected')
  returning id
)
insert into tests.fixture (name, id) select 'l_sheets', id from c;

with s as (
  insert into public.sync_sources (company_id, connection_id, provider, name, target_module, config, field_map, record_key)
  values (
    tests.company('kingdom'), tests.id('k_sheets'), 'google_sheets', 'Sample sales tab K', 'sales_reporting',
    '{"spreadsheet_id":"sample-sheet","sheet_gid":0,"range":null,"header_row":1}',
    '[{"header":"Job","key":"job","label":"Job","type":"text","unit":null,"required":true}]',
    '{job}'
  )
  returning id
)
insert into tests.fixture (name, id) select 'k_source', id from s;
with s as (
  insert into public.sync_sources (company_id, connection_id, provider, name, target_module, config, field_map, record_key)
  values (
    tests.company('klasik'), tests.id('l_sheets'), 'google_sheets', 'Sample sales tab L', 'sales_reporting',
    '{"spreadsheet_id":"sample-sheet","sheet_gid":0,"range":null,"header_row":1}',
    '[{"header":"Job","key":"job","label":"Job","type":"text","unit":null,"required":true}]',
    '{job}'
  )
  returning id
)
insert into tests.fixture (name, id) select 'l_source', id from s;

with r as (
  insert into public.sync_runs (source_id, trigger_kind, status, finished_at)
  values (tests.id('k_source'), 'manual', 'succeeded', now())
  returning id
)
insert into tests.fixture (name, id) select 'k_run', id from r;
insert into public.sync_records (source_id, run_id, record_key, data)
values (tests.id('k_source'), tests.id('k_run'), '["Sample job 4101"]', '{"job": "Sample job 4101"}');

-- Change-log rows in Klasik and with no company, so a Kingdom reader has something to be kept from.
insert into public.audit_events (company_id, table_name, row_id, action, actor_kind)
values (tests.company('klasik'), 'companies', 'sample-klasik', 'update', 'system'),
       (null, 'profiles', 'sample-no-company', 'update', 'system'),
       (tests.company('kingdom'), 'companies', 'sample-kingdom', 'update', 'system');

-- Kingdom's overrides. Klasik gets none.
insert into public.company_capabilities (company_id, capability, min_role) values
  (tests.company('kingdom'), 'pay',              'owner'),
  (tests.company('kingdom'), 'company_settings', 'owner'),
  (tests.company('kingdom'), 'audit_log',        'admin'),
  (tests.company('kingdom'), 'milestones_edit',  'manager'),
  (tests.company('kingdom'), 'wins_post',        'employee'),
  (tests.company('kingdom'), 'sync_run',         'manager'),
  (tests.company('kingdom'), 'production_view',  'manager');

-- case: pay_follows_capability
select tests.act_as(tests.id('kingdom_admin'));
select tests.assert(
  (select count(*) from public.compensation_items where company_id = tests.company('kingdom')) = 0,
  'pay_follows_capability: a Kingdom admin reads pay that Kingdom keeps to owners'
);
select tests.assert_raises(
  format($q$insert into public.compensation_items (company_id, employee_id, name) values (%L, %L, 'Bonus')$q$,
         tests.company('kingdom'), tests.id('kingdom_employee')),
  '%row-level security%'
);
do $$
declare
  v_rows integer;
begin
  update public.compensation_items set annual_amount = 1 where id = tests.id('pay_kingdom');
  get diagnostics v_rows = row_count;
  perform tests.assert(v_rows = 0, 'pay_follows_capability: a Kingdom admin changed pay');
  delete from public.compensation_items where id = tests.id('pay_kingdom');
  get diagnostics v_rows = row_count;
  perform tests.assert(v_rows = 0, 'pay_follows_capability: a Kingdom admin removed pay');
end $$;

select tests.act_as(tests.id('kingdom_employee'));
select tests.assert(
  (select count(*) from public.compensation_items) = 1,
  'pay_follows_capability: a Kingdom employee lost their own pay'
);

select tests.act_as(tests.id('kingdom_owner'));
select tests.assert(
  (select count(*) from public.compensation_items where company_id = tests.company('kingdom')) = 1,
  'pay_follows_capability: a Kingdom owner cannot read Kingdom pay'
);
insert into public.compensation_items (company_id, employee_id, name, annual_amount)
values (tests.company('kingdom'), tests.id('kingdom_employee'), 'Sample stipend', 1200);
do $$
declare
  v_rows integer;
begin
  update public.compensation_items set annual_amount = 1300
   where employee_id = tests.id('kingdom_employee') and name = 'Sample stipend';
  get diagnostics v_rows = row_count;
  perform tests.assert(v_rows = 1, 'pay_follows_capability: a Kingdom owner could not change pay');
  delete from public.compensation_items
   where employee_id = tests.id('kingdom_employee') and name = 'Sample stipend';
  get diagnostics v_rows = row_count;
  perform tests.assert(v_rows = 1, 'pay_follows_capability: a Kingdom owner could not remove pay');
end $$;

select tests.act_as(tests.id('klasik_admin'));
select tests.assert(
  (select count(*) from public.compensation_items where company_id = tests.company('klasik')) = 1,
  'pay_follows_capability: a Klasik admin lost Klasik pay'
);
insert into public.compensation_items (company_id, employee_id, name, annual_amount)
values (tests.company('klasik'), tests.id('klasik_employee'), 'Sample stipend', 1200);
do $$
declare
  v_rows integer;
begin
  update public.compensation_items set annual_amount = 1300 where id = tests.id('pay_klasik');
  get diagnostics v_rows = row_count;
  perform tests.assert(v_rows = 1, 'pay_follows_capability: a Klasik admin could not change pay');
  delete from public.compensation_items
   where employee_id = tests.id('klasik_employee') and name = 'Sample stipend';
  get diagnostics v_rows = row_count;
  perform tests.assert(v_rows = 1, 'pay_follows_capability: a Klasik admin could not remove pay');
end $$;
select tests.assert(
  (select count(*) from public.compensation_items where company_id = tests.company('kingdom')) = 0,
  'pay_follows_capability: a Klasik admin reads Kingdom pay'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- case: employee_financials_unchanged
select tests.act_as(tests.id('kingdom_admin'));
select tests.assert(
  (select count(*) from public.employee_financials where company_id = tests.company('kingdom')) = 1,
  'employee_financials_unchanged: a Kingdom admin lost personal financial figures'
);
insert into public.employee_financials (company_id, employee_id, year, metric, target)
values (tests.company('kingdom'), tests.id('kingdom_employee'), 2026, 'Sample margin', 10);
do $$
declare
  v_rows integer;
begin
  update public.employee_financials set current = 5 where employee_id = tests.id('kingdom_employee');
  get diagnostics v_rows = row_count;
  perform tests.assert(v_rows = 2, 'employee_financials_unchanged: a Kingdom admin could not change financial figures');
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- case: company_row_follows_capability
select tests.act_as(tests.id('kingdom_admin'));
do $$
declare
  v_rows integer;
begin
  update public.companies set name = 'X' where id = tests.company('kingdom');
  get diagnostics v_rows = row_count;
  perform tests.assert(v_rows = 0, 'company_row_follows_capability: a Kingdom admin changed the company row');
end $$;
select tests.act_as(tests.id('kingdom_owner'));
do $$
declare
  v_rows integer;
begin
  update public.companies set name = 'Kingdom renamed' where id = tests.company('kingdom');
  get diagnostics v_rows = row_count;
  perform tests.assert(v_rows = 1, 'company_row_follows_capability: a Kingdom owner could not change the company row');
end $$;
select tests.act_as(tests.id('klasik_admin'));
do $$
declare
  v_rows integer;
begin
  update public.companies set name = 'Klasik renamed' where id = tests.company('klasik');
  get diagnostics v_rows = row_count;
  perform tests.assert(v_rows = 1, 'company_row_follows_capability: a Klasik admin could not change the company row');
  update public.companies set name = 'X' where id = tests.company('kingdom');
  get diagnostics v_rows = row_count;
  perform tests.assert(v_rows = 0, 'company_row_follows_capability: a Klasik admin changed Kingdom');
end $$;
select tests.act_as(tests.id('rococo_admin'));
do $$
declare
  v_rows integer;
begin
  update public.companies set name = 'Kingdom by Rococo' where id = tests.company('kingdom');
  get diagnostics v_rows = row_count;
  perform tests.assert(v_rows = 1, 'company_row_follows_capability: a Rococo admin could not change the company row');
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- case: audit_follows_capability
select tests.act_as(tests.id('kingdom_admin'));
select tests.assert(
  (select count(*) from public.audit_events where company_id = tests.company('kingdom')) > 0,
  'audit_follows_capability: a Kingdom admin cannot read the Kingdom change log'
);
select tests.assert(
  (select count(*) from public.audit_events where company_id = tests.company('klasik')) = 0,
  'audit_follows_capability: a Kingdom admin reads the Klasik change log'
);
select tests.assert(
  (select count(*) from public.audit_events where company_id is null) = 0,
  'audit_follows_capability: a Kingdom admin reads change log rows with no company'
);
select tests.act_as(tests.id('kingdom_manager'));
select tests.assert(
  (select count(*) from public.audit_events) = 0,
  'audit_follows_capability: a Kingdom manager reads the change log'
);
select tests.act_as(tests.id('klasik_admin'));
select tests.assert(
  (select count(*) from public.audit_events) = 0,
  'audit_follows_capability: a Klasik admin reads the change log by default'
);
select tests.act_as(tests.id('rococo_admin'));
select tests.assert(
  (select count(*) from public.audit_events where company_id = tests.company('kingdom')) > 0
  and (select count(*) from public.audit_events where company_id = tests.company('klasik')) > 0
  and (select count(*) from public.audit_events where company_id is null) > 0,
  'audit_follows_capability: a Rococo admin does not read the whole change log'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- case: milestones_follow_capability
select tests.act_as(tests.id('kingdom_manager'));
insert into public.project_milestones (project_id, title, sort_order)
values (tests.id('project_kingdom'), 'Sample milestone by a manager', 2);
do $$
declare
  v_rows integer;
begin
  update public.project_milestones set completed_on = date '2026-11-01' where id = tests.id('milestone_kingdom');
  get diagnostics v_rows = row_count;
  perform tests.assert(v_rows = 1, 'milestones_follow_capability: a Kingdom manager could not complete a milestone');
  update public.projects set name = 'Renamed by a manager' where id = tests.id('project_kingdom');
  get diagnostics v_rows = row_count;
  perform tests.assert(v_rows = 0, 'milestones_follow_capability: a Kingdom manager changed a project');
end $$;
select tests.assert_raises(
  format($q$insert into public.projects (company_id, name) values (%L, 'Manager project')$q$, tests.company('kingdom')),
  '%row-level security%'
);

select tests.act_as(tests.id('kingdom_employee'));
select tests.assert_raises(
  format($q$insert into public.project_milestones (project_id, title) values (%L, 'Employee milestone')$q$,
         tests.id('project_kingdom')),
  '%row-level security%'
);
do $$
declare
  v_rows integer;
begin
  update public.project_milestones set completed_on = null where id = tests.id('milestone_kingdom');
  get diagnostics v_rows = row_count;
  perform tests.assert(v_rows = 0, 'milestones_follow_capability: a Kingdom employee changed a milestone');
end $$;

select tests.act_as(tests.id('klasik_employee'));
select tests.assert_raises(
  format($q$insert into public.project_milestones (project_id, title) values (%L, 'Employee milestone')$q$,
         tests.id('project_klasik')),
  '%row-level security%'
);
select tests.act_as(tests.id('klasik_manager'));
select tests.assert_raises(
  format($q$insert into public.project_milestones (project_id, title) values (%L, 'Manager milestone')$q$,
         tests.id('project_klasik')),
  '%row-level security%'
);
do $$
declare
  v_rows integer;
begin
  update public.project_milestones set completed_on = date '2026-11-01' where id = tests.id('milestone_klasik');
  get diagnostics v_rows = row_count;
  perform tests.assert(v_rows = 0, 'milestones_follow_capability: a Klasik manager changed a milestone');
end $$;
select tests.act_as(tests.id('klasik_admin'));
insert into public.project_milestones (project_id, title, sort_order)
values (tests.id('project_klasik'), 'Sample milestone by an admin', 2);
do $$
declare
  v_rows integer;
begin
  update public.project_milestones set completed_on = date '2026-11-01' where id = tests.id('milestone_klasik');
  get diagnostics v_rows = row_count;
  perform tests.assert(v_rows = 1, 'milestones_follow_capability: a Klasik admin could not complete a milestone');
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select company_id = tests.company('kingdom') and created_by = tests.id('kingdom_manager')
     from public.project_milestones where title = 'Sample milestone by a manager'),
  'milestones_follow_capability: the manager''s milestone is not Kingdom''s or not stamped'
);

-- case: wins_follow_capability
select tests.act_as(tests.id('kingdom_employee'));
insert into public.wins (company_id, title, won_on, project_id)
values (tests.company('kingdom'), 'Sample win by an employee', '2026-11-01', tests.id('project_kingdom'));
select tests.assert_raises(
  format($q$insert into public.wins (company_id, title, won_on, project_id) values (%L, 'Wrong project', '2026-11-01', %L)$q$,
         tests.company('kingdom'), tests.id('project_klasik')),
  '%That project belongs to another company.%'
);
reset role;
select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id)
select 'win_kingdom', id from public.wins where title = 'Sample win by an employee';
select tests.assert(
  (select created_by = tests.id('kingdom_employee') and updated_by = tests.id('kingdom_employee')
          and company_id = tests.company('kingdom')
     from public.wins where id = tests.id('win_kingdom')),
  'wins_follow_capability: the employee''s win is not stamped with their profile'
);
select tests.act_as(tests.id('kingdom_employee'));
do $$
declare
  v_rows integer;
begin
  update public.wins set title = 'Changed by an employee' where id = tests.id('win_kingdom');
  get diagnostics v_rows = row_count;
  perform tests.assert(v_rows = 0, 'wins_follow_capability: a Kingdom employee changed a win');
end $$;
select tests.act_as(tests.id('kingdom_admin'));
do $$
declare
  v_rows integer;
begin
  update public.wins set title = 'Changed by an admin' where id = tests.id('win_kingdom');
  get diagnostics v_rows = row_count;
  perform tests.assert(v_rows = 1, 'wins_follow_capability: a Kingdom admin could not change a win');
end $$;
select tests.act_as(tests.id('klasik_employee'));
select tests.assert_raises(
  format($q$insert into public.wins (company_id, title, won_on) values (%L, 'Klasik employee win', '2026-11-01')$q$,
         tests.company('klasik')),
  '%row-level security%'
);
select tests.act_as(tests.id('klasik_admin'));
insert into public.wins (company_id, title, won_on) values (tests.company('klasik'), 'Sample Klasik win', '2026-11-01');
reset role;
select set_config('request.jwt.claims', '', true);

-- case: sync_follows_capability
select tests.act_as(tests.id('kingdom_manager'));
select tests.assert(
  (select count(*) from public.sync_sources where company_id = tests.company('kingdom')) = 1,
  'sync_follows_capability: a Kingdom manager cannot see the source they may sync'
);
select tests.assert(
  (select count(*) from public.sync_sources where company_id = tests.company('klasik')) = 0,
  'sync_follows_capability: a Kingdom manager reads a Klasik source'
);
do $$
declare
  v_rows integer;
begin
  update public.sync_sources set sync_requested_at = now() where id = tests.id('k_source');
  get diagnostics v_rows = row_count;
  perform tests.assert(v_rows = 1, 'sync_follows_capability: a Kingdom manager could not request a sync');
  perform tests.assert_raises(
    format($q$update public.sync_sources set name = 'X' where id = %L$q$, tests.id('k_source')),
    'You can request a sync but not change the source.'
  );
  perform tests.assert_raises(
    format($q$update public.sync_sources set last_status = 'failed' where id = %L$q$, tests.id('k_source')),
    'Sync results are written by the sync, not edited here.'
  );
end $$;
select tests.assert(
  (select count(*) from public.sync_records) = 0 and (select count(*) from public.sync_runs) = 0,
  'sync_follows_capability: a Kingdom manager reads runs or records'
);
select tests.assert_raises(
  format(
    $q$insert into public.sync_sources (company_id, connection_id, provider, name, target_module)
       values (%L, %L, 'google_sheets', 'Manager source', 'sales_reporting')$q$,
    tests.company('kingdom'), tests.id('k_sheets')
  ),
  '%row-level security%'
);
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select name = 'Sample sales tab K' and sync_requested_at is not null
     from public.sync_sources where id = tests.id('k_source')),
  'sync_follows_capability: the manager''s request did not land, or the name changed'
);

select tests.act_as(tests.id('kingdom_employee'));
select tests.assert(
  (select count(*) from public.sync_sources) = 0,
  'sync_follows_capability: a Kingdom employee reads sync sources'
);
select tests.act_as(tests.id('klasik_manager'));
select tests.assert(
  (select count(*) from public.sync_sources) = 0,
  'sync_follows_capability: a Klasik manager reads sync sources by default'
);
do $$
declare
  v_rows integer;
begin
  update public.sync_sources set sync_requested_at = now() where id = tests.id('l_source');
  get diagnostics v_rows = row_count;
  perform tests.assert(v_rows = 0, 'sync_follows_capability: a Klasik manager requested a sync by default');
end $$;
select tests.act_as(tests.id('klasik_admin'));
do $$
declare
  v_rows integer;
begin
  update public.sync_sources set name = 'Sample sales tab L renamed' where id = tests.id('l_source');
  get diagnostics v_rows = row_count;
  perform tests.assert(v_rows = 1, 'sync_follows_capability: a Klasik admin lost source edits');
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- case: cross_company_stays_closed
select tests.act_as(tests.id('kingdom_owner'));
select tests.assert_raises(
  format($q$insert into public.compensation_items (company_id, employee_id, name) values (%L, %L, 'Bonus')$q$,
         tests.company('klasik'), tests.id('klasik_employee')),
  '%row-level security%'
);
select tests.assert_raises(
  format($q$insert into public.project_milestones (project_id, title) values (%L, 'Reach across')$q$,
         tests.id('project_klasik')),
  '%row-level security%'
);
select tests.assert_raises(
  format($q$insert into public.wins (company_id, title, won_on) values (%L, 'Reach across', '2026-11-01')$q$,
         tests.company('klasik')),
  '%row-level security%'
);
do $$
declare
  v_rows integer;
begin
  update public.compensation_items set annual_amount = 1 where id = tests.id('pay_klasik');
  get diagnostics v_rows = row_count;
  perform tests.assert(v_rows = 0, 'cross_company_stays_closed: a Kingdom owner changed Klasik pay');
  delete from public.compensation_items where id = tests.id('pay_klasik');
  get diagnostics v_rows = row_count;
  perform tests.assert(v_rows = 0, 'cross_company_stays_closed: a Kingdom owner removed Klasik pay');
  update public.companies set name = 'X' where id = tests.company('klasik');
  get diagnostics v_rows = row_count;
  perform tests.assert(v_rows = 0, 'cross_company_stays_closed: a Kingdom owner changed the Klasik company row');
  update public.project_milestones set completed_on = null where id = tests.id('milestone_klasik');
  get diagnostics v_rows = row_count;
  perform tests.assert(v_rows = 0, 'cross_company_stays_closed: a Kingdom owner changed a Klasik milestone');
  update public.sync_sources set sync_requested_at = now() where id = tests.id('l_source');
  get diagnostics v_rows = row_count;
  perform tests.assert(v_rows = 0, 'cross_company_stays_closed: a Kingdom owner requested a Klasik sync');
end $$;
select tests.assert(
  (select count(*) from public.compensation_items where company_id = tests.company('klasik')) = 0
  and (select count(*) from public.audit_events where company_id = tests.company('klasik')) = 0
  and (select count(*) from public.sync_sources where company_id = tests.company('klasik')) = 0,
  'cross_company_stays_closed: a Kingdom owner reads Klasik pay, change log or sources'
);
-- An owner meets audit_log = admin in Kingdom, and still reads only Kingdom's rows.
select tests.assert(
  (select count(*) from public.audit_events where company_id = tests.company('kingdom')) > 0
  and (select count(*) from public.audit_events where company_id is distinct from tests.company('kingdom')) = 0,
  'cross_company_stays_closed: a Kingdom owner reads change log rows outside Kingdom'
);
reset role;
select set_config('request.jwt.claims', '', true);
