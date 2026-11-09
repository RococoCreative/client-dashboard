-- 0028_sync_engine.test.sql
-- Proves the sync engine's tables (0028): connections accept Google Sheets, Sync now has its own
-- predicate, only admins create and read sources, a source's connection must be its own company's
-- and provider's, a schedule is all or nothing in a real time zone, the browser never writes sync
-- results, a source's company is pinned, nobody deletes a source from the browser, runs and records
-- take their company from their source, one run at a time per connection, runs and records are
-- read-only to the browser, configuration changes are audited, and someone allowed only to sync
-- can request a sync and nothing more.
--
-- Runs inside one transaction the harness opens and rolls back; never begin or commit here.

-- Setup, as system.
select tests.create_person('k_admin', tests.company('kingdom'), 'admin');
select tests.create_person('k_emp', tests.company('kingdom'));
select tests.create_person('l_admin', tests.company('klasik'), 'admin');
select tests.create_person('rococo', null, 'employee', true);

with c as (
  insert into public.company_connections (company_id, provider, status)
  values (tests.company('kingdom'), 'google_sheets', 'connected')
  returning id
)
insert into tests.fixture (name, id) select 'k_sheets', id from c;

with c as (
  insert into public.company_connections (company_id, provider, status)
  values (tests.company('kingdom'), 'quickbooks', 'not_connected')
  returning id
)
insert into tests.fixture (name, id) select 'k_qbo', id from c;

with c as (
  insert into public.company_connections (company_id, provider, status)
  values (tests.company('klasik'), 'google_sheets', 'connected')
  returning id
)
insert into tests.fixture (name, id) select 'l_sheets', id from c;

-- case: provider_check_accepts_google_sheets
do $$
begin
  perform tests.assert(
    (select count(*) from public.company_connections
      where id in (tests.id('k_sheets'), tests.id('k_qbo'), tests.id('l_sheets'))) = 3,
    'provider_check_accepts_google_sheets: the setup connections were not stored'
  );
  perform tests.assert_raises(
    format(
      $q$insert into public.company_connections (company_id, provider) values (%L, 'dropbox')$q$,
      tests.company('rba')
    ),
    '%company_connections_provider_check%'
  );
  perform tests.assert(
    (select count(*) from pg_constraint where conname = 'company_connections_provider_check') = 1,
    'provider_check_accepts_google_sheets: there is not exactly one provider check'
  );
  perform tests.assert(
    (select pg_get_constraintdef(oid) like '%google_sheets%'
       from pg_constraint where conname = 'company_connections_provider_check'),
    'provider_check_accepts_google_sheets: the provider check does not mention google_sheets'
  );
end $$;

-- case: can_sync_source_matches_can_manage
select tests.act_as(tests.id('k_admin'));
do $$
begin
  perform tests.assert(private.can_sync_source(tests.company('kingdom')),
    'can_sync_source_matches_can_manage: a Kingdom admin cannot sync Kingdom');
  perform tests.assert(not private.can_sync_source(tests.company('klasik')),
    'can_sync_source_matches_can_manage: a Kingdom admin can sync Klasik');
end $$;
select tests.act_as(tests.id('k_emp'));
do $$
begin
  perform tests.assert(not private.can_sync_source(tests.company('kingdom')),
    'can_sync_source_matches_can_manage: a Kingdom employee can sync Kingdom');
end $$;
select tests.act_as(tests.id('l_admin'));
do $$
begin
  perform tests.assert(not private.can_sync_source(tests.company('kingdom')),
    'can_sync_source_matches_can_manage: a Klasik admin can sync Kingdom');
end $$;
select tests.act_as(tests.id('rococo'));
do $$
begin
  perform tests.assert(private.can_sync_source(tests.company('kingdom')),
    'can_sync_source_matches_can_manage: a Rococo admin cannot sync Kingdom');
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- case: admin_creates_source
select tests.act_as(tests.id('k_admin'));
insert into public.sync_sources (company_id, connection_id, provider, name, target_module, config, field_map, record_key)
values (
  tests.company('kingdom'), tests.id('k_sheets'), 'google_sheets', 'Sample sales tab', 'sales_reporting',
  '{"spreadsheet_id":"sample-sheet","sheet_gid":0,"range":null,"header_row":1}',
  '[{"header":"Job","key":"job","label":"Job","type":"text","unit":null,"required":true}]',
  '{job}'
);
-- tests.fixture is written as system only.
reset role;
select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id)
select 'k_source', id from public.sync_sources where name = 'Sample sales tab';
do $$
begin
  perform tests.assert(
    (select created_by = tests.id('k_admin') and enabled = false and company_id = tests.company('kingdom')
       from public.sync_sources where id = tests.id('k_source')),
    'admin_creates_source: the source is not stamped, disabled and in Kingdom'
  );
end $$;

-- case: employee_cannot_create_source
select tests.act_as(tests.id('k_emp'));
do $$
begin
  perform tests.assert_raises(
    format(
      $q$insert into public.sync_sources (company_id, connection_id, provider, name, target_module, config, field_map, record_key)
         values (%L, %L, 'google_sheets', 'Sample sales tab', 'sales_reporting',
                 '{"spreadsheet_id":"sample-sheet","sheet_gid":0,"range":null,"header_row":1}',
                 '[{"header":"Job","key":"job","label":"Job","type":"text","unit":null,"required":true}]',
                 '{job}')$q$,
      tests.company('kingdom'), tests.id('k_sheets')
    ),
    '%row-level security%'
  );
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- case: other_company_admin_sees_nothing
select tests.act_as(tests.id('l_admin'));
do $$
begin
  perform tests.assert(
    (select count(*) from public.sync_sources where company_id = tests.company('kingdom')) = 0,
    'other_company_admin_sees_nothing: a Klasik admin reads a Kingdom source'
  );
  perform tests.assert_raises(
    format(
      $q$insert into public.sync_sources (company_id, connection_id, provider, name, target_module, config, field_map, record_key)
         values (%L, %L, 'google_sheets', 'Sample sales tab', 'sales_reporting',
                 '{"spreadsheet_id":"sample-sheet","sheet_gid":0,"range":null,"header_row":1}',
                 '[{"header":"Job","key":"job","label":"Job","type":"text","unit":null,"required":true}]',
                 '{job}')$q$,
      tests.company('kingdom'), tests.id('k_sheets')
    ),
    '%row-level security%'
  );
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- case: connection_must_match_company_and_provider
select tests.act_as(tests.id('k_admin'));
do $$
begin
  perform tests.assert_raises(
    format(
      $q$insert into public.sync_sources (company_id, connection_id, provider, name, target_module)
         values (%L, %L, 'google_sheets', 'Sample sales tab', 'sales_reporting')$q$,
      tests.company('kingdom'), tests.id('l_sheets')
    ),
    'That connection belongs to another company or provider.'
  );
  perform tests.assert_raises(
    format(
      $q$insert into public.sync_sources (company_id, connection_id, provider, name, target_module)
         values (%L, %L, 'quickbooks', 'Sample sales tab', 'sales_reporting')$q$,
      tests.company('kingdom'), tests.id('k_sheets')
    ),
    'That connection belongs to another company or provider.'
  );
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- case: invalid_timezone_rejected
select tests.act_as(tests.id('k_admin'));
do $$
begin
  perform tests.assert_raises(
    format(
      $q$insert into public.sync_sources (company_id, connection_id, provider, name, target_module,
                                         sync_weekday, sync_time, sync_timezone)
         values (%L, %L, 'google_sheets', 'Sample schedule tab', 'sales_reporting', 1, '07:00', 'Mars/Olympus')$q$,
      tests.company('kingdom'), tests.id('k_sheets')
    ),
    'That time zone is not recognized.'
  );
  insert into public.sync_sources (company_id, connection_id, provider, name, target_module,
                                   sync_weekday, sync_time, sync_timezone)
  values (tests.company('kingdom'), tests.id('k_sheets'), 'google_sheets', 'Sample schedule tab',
          'sales_reporting', 1, '07:00', 'America/Chicago');
  perform tests.assert(
    (select count(*) from public.sync_sources where name = 'Sample schedule tab') = 1,
    'invalid_timezone_rejected: a source in America/Chicago was not stored'
  );
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- case: schedule_all_or_nothing
select tests.act_as(tests.id('k_admin'));
do $$
begin
  perform tests.assert_raises(
    format(
      $q$insert into public.sync_sources (company_id, connection_id, provider, name, target_module, sync_weekday)
         values (%L, %L, 'google_sheets', 'Sample half schedule', 'sales_reporting', 1)$q$,
      tests.company('kingdom'), tests.id('k_sheets')
    ),
    '%sync_sources_schedule_check%'
  );
  perform tests.assert_raises(
    format(
      $q$insert into public.sync_sources (company_id, connection_id, provider, name, target_module, stale_after_hours)
         values (%L, %L, 'google_sheets', 'Sample stale tab', 'sales_reporting', 0)$q$,
      tests.company('kingdom'), tests.id('k_sheets')
    ),
    '%sync_sources_stale_check%'
  );
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- case: browser_cannot_write_results
-- A finished run to point at, written as system the way the sync writes one.
with r as (
  insert into public.sync_runs (source_id, trigger_kind, status, finished_at)
  values (tests.id('k_source'), 'manual', 'succeeded', now())
  returning id
)
insert into tests.fixture (name, id) select 'run_one', id from r;
select tests.act_as(tests.id('k_admin'));
do $$
declare
  v_rows integer;
begin
  perform tests.assert_raises(
    format(
      $q$insert into public.sync_sources (company_id, connection_id, provider, name, target_module, last_success_at)
         values (%L, %L, 'google_sheets', 'Sample results tab', 'sales_reporting', now())$q$,
      tests.company('kingdom'), tests.id('k_sheets')
    ),
    'Sync results are written by the sync, not edited here.'
  );
  perform tests.assert_raises(
    format($q$update public.sync_sources set last_status = 'succeeded' where id = %L$q$, tests.id('k_source')),
    'Sync results are written by the sync, not edited here.'
  );
  perform tests.assert_raises(
    format($q$update public.sync_sources set current_run_id = %L where id = %L$q$,
           tests.id('run_one'), tests.id('k_source')),
    'Sync results are written by the sync, not edited here.'
  );
  update public.sync_sources set sync_requested_at = now() where id = tests.id('k_source');
  get diagnostics v_rows = row_count;
  perform tests.assert(v_rows = 1, 'browser_cannot_write_results: an admin could not request a sync');
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- case: company_id_pinned
select tests.act_as(tests.id('k_admin'));
update public.sync_sources set company_id = tests.company('klasik') where id = tests.id('k_source');
do $$
begin
  perform tests.assert(
    (select company_id from public.sync_sources where id = tests.id('k_source')) = tests.company('kingdom'),
    'company_id_pinned: a source moved to another company'
  );
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- case: no_delete_from_browser
select tests.act_as(tests.id('k_admin'));
do $$
begin
  perform tests.assert_raises(
    format($q$delete from public.sync_sources where id = %L$q$, tests.id('k_source')),
    '%permission denied%'
  );
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- case: inherit_sets_company_and_connection
insert into public.sync_sources (company_id, connection_id, provider, name, target_module)
values (tests.company('kingdom'), tests.id('k_sheets'), 'google_sheets', 'Sample second tab', 'sales_reporting');
insert into tests.fixture (name, id)
select 'k_source_two', id from public.sync_sources where name = 'Sample second tab';
with r as (
  insert into public.sync_runs (company_id, source_id, connection_id, trigger_kind, status, finished_at)
  values (tests.company('klasik'), tests.id('k_source'), tests.id('l_sheets'), 'schedule', 'succeeded', now())
  returning id
)
insert into tests.fixture (name, id) select 'run_two', id from r;
with r as (
  insert into public.sync_runs (source_id, trigger_kind, status, finished_at)
  values (tests.id('k_source_two'), 'manual', 'succeeded', now())
  returning id
)
insert into tests.fixture (name, id) select 'run_other_source', id from r;
with x as (
  insert into public.sync_records (company_id, source_id, run_id, record_key, data)
  values (tests.company('klasik'), tests.id('k_source'), tests.id('run_two'), '["Sample job 101"]',
          '{"job": "Sample job 101"}')
  returning id
)
insert into tests.fixture (name, id) select 'record_one', id from x;
do $$
begin
  perform tests.assert(
    (select company_id = tests.company('kingdom') and connection_id = tests.id('k_sheets')
       from public.sync_runs where id = tests.id('run_two')),
    'inherit_sets_company_and_connection: a run kept the company or connection it was sent'
  );
  perform tests.assert(
    (select company_id from public.sync_records where id = tests.id('record_one')) = tests.company('kingdom'),
    'inherit_sets_company_and_connection: a record kept the company it was sent'
  );
  perform tests.assert_raises(
    format(
      $q$insert into public.sync_records (source_id, run_id, record_key, data)
         values (%L, %L, '["Sample job 102"]', '{}')$q$,
      tests.id('k_source'), tests.id('run_other_source')
    ),
    'That run belongs to another source.'
  );
  perform tests.assert_raises(
    format(
      $q$insert into public.sync_runs (source_id, trigger_kind) values (%L, 'manual')$q$,
      gen_random_uuid()
    ),
    'That source does not exist.'
  );
end $$;

-- case: one_running_run_per_connection
with r as (
  insert into public.sync_runs (source_id, trigger_kind) values (tests.id('k_source'), 'manual')
  returning id
)
insert into tests.fixture (name, id) select 'run_running', id from r;
do $$
begin
  perform tests.assert_raises(
    format($q$insert into public.sync_runs (source_id, trigger_kind) values (%L, 'schedule')$q$,
           tests.id('k_source_two')),
    '%sync_runs_one_running_per_connection%'
  );
  update public.sync_runs set status = 'succeeded', finished_at = now() where id = tests.id('run_running');
  insert into public.sync_runs (source_id, trigger_kind, status, finished_at)
  values (tests.id('k_source_two'), 'schedule', 'running', null);
  perform tests.assert(
    (select count(*) from public.sync_runs where source_id = tests.id('k_source_two') and status = 'running') = 1,
    'one_running_run_per_connection: a run could not start after the first finished'
  );
end $$;

-- case: runs_and_records_are_read_only
select tests.act_as(tests.id('k_admin'));
do $$
begin
  perform tests.assert(
    (select count(*) from public.sync_runs where id = tests.id('run_two')) = 1,
    'runs_and_records_are_read_only: a Kingdom admin cannot read the run'
  );
  perform tests.assert(
    (select count(*) from public.sync_records where id = tests.id('record_one')) = 1,
    'runs_and_records_are_read_only: a Kingdom admin cannot read the record'
  );
  perform tests.assert_raises(
    format($q$insert into public.sync_runs (source_id, trigger_kind, status) values (%L, 'manual', 'succeeded')$q$,
           tests.id('k_source')),
    '%permission denied%'
  );
  perform tests.assert_raises(
    format($q$update public.sync_records set data = '{}' where id = %L$q$, tests.id('record_one')),
    '%permission denied%'
  );
  perform tests.assert_raises(
    format($q$delete from public.sync_records where id = %L$q$, tests.id('record_one')),
    '%permission denied%'
  );
end $$;
select tests.act_as(tests.id('k_emp'));
do $$
begin
  perform tests.assert((select count(*) from public.sync_sources) = 0,
    'runs_and_records_are_read_only: a Kingdom employee reads sources');
  perform tests.assert((select count(*) from public.sync_runs) = 0,
    'runs_and_records_are_read_only: a Kingdom employee reads runs');
  perform tests.assert((select count(*) from public.sync_records) = 0,
    'runs_and_records_are_read_only: a Kingdom employee reads records');
end $$;
select tests.act_as(tests.id('l_admin'));
do $$
begin
  perform tests.assert(
    (select count(*) from public.sync_sources where company_id = tests.company('kingdom')) = 0,
    'runs_and_records_are_read_only: a Klasik admin reads Kingdom sources');
  perform tests.assert(
    (select count(*) from public.sync_runs where company_id = tests.company('kingdom')) = 0,
    'runs_and_records_are_read_only: a Klasik admin reads Kingdom runs');
  perform tests.assert(
    (select count(*) from public.sync_records where company_id = tests.company('kingdom')) = 0,
    'runs_and_records_are_read_only: a Klasik admin reads Kingdom records');
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- case: system_writes_results
update public.sync_sources
   set last_status = 'failed', last_error = 'Sample error', last_attempt_at = now()
 where id = tests.id('k_source');
do $$
begin
  perform tests.assert(
    (select last_status = 'failed' and last_error = 'Sample error' and last_attempt_at is not null
       from public.sync_sources where id = tests.id('k_source')),
    'system_writes_results: the sync could not write its results'
  );
end $$;

-- case: pointer_cleared_when_run_deleted
update public.sync_sources set current_run_id = tests.id('run_one') where id = tests.id('k_source');
delete from public.sync_runs where id = tests.id('run_one');
do $$
begin
  perform tests.assert(
    (select current_run_id is null from public.sync_sources where id = tests.id('k_source')),
    'pointer_cleared_when_run_deleted: the source still points at a deleted run'
  );
end $$;

-- case: audit_on_config_change
create temp table audit_baseline as
select count(*) as n from public.audit_events
 where table_name = 'sync_sources' and row_id = tests.id('k_source')::text;
select tests.act_as(tests.id('k_admin'));
update public.sync_sources set name = 'Sample sales tab renamed' where id = tests.id('k_source');
reset role;
select set_config('request.jwt.claims', '', true);
do $$
begin
  perform tests.assert(
    (select count(*) from public.audit_events
      where table_name = 'sync_sources' and row_id = tests.id('k_source')::text)
      = (select n + 1 from audit_baseline),
    'audit_on_config_change: renaming a source did not write exactly one audit row'
  );
  perform tests.assert(
    (select count(*) from public.audit_events
      where table_name = 'sync_sources' and row_id = tests.id('k_source')::text
        and action = 'update' and changed ? 'name') = 1,
    'audit_on_config_change: the audit row does not name the change'
  );
end $$;
select tests.act_as(tests.id('k_admin'));
update public.sync_sources set sync_requested_at = now() where id = tests.id('k_source');
reset role;
select set_config('request.jwt.claims', '', true);
do $$
begin
  perform tests.assert(
    (select count(*) from public.audit_events
      where table_name = 'sync_sources' and row_id = tests.id('k_source')::text)
      = (select n + 1 from audit_baseline),
    'audit_on_config_change: requesting a sync wrote an audit row'
  );
end $$;

-- case: syncer_only_may_request
-- Last in the file: it redefines the predicate and adds a read policy, inside the rolled-back
-- transaction, to stand in for a later capability split where members may sync.
create or replace function private.can_sync_source(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select private.is_company_member(cid) $$;
create policy "tests syncers read" on public.sync_sources
  for select to authenticated using (private.can_sync_source(company_id));
select tests.act_as(tests.id('k_emp'));
do $$
declare
  v_rows integer;
begin
  update public.sync_sources set sync_requested_at = now() where id = tests.id('k_source');
  get diagnostics v_rows = row_count;
  perform tests.assert(v_rows = 1, 'syncer_only_may_request: a syncer could not request a sync');
  perform tests.assert_raises(
    format($q$update public.sync_sources set name = 'Changed' where id = %L$q$, tests.id('k_source')),
    'You can request a sync but not change the source.'
  );
  -- The second source: system_writes_results already left the first one failed.
  perform tests.assert_raises(
    format($q$update public.sync_sources set last_status = 'failed' where id = %L$q$, tests.id('k_source_two')),
    'Sync results are written by the sync, not edited here.'
  );
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
