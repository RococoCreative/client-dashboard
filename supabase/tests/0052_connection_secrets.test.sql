-- 0052_connection_secrets.test.sql
-- Proves connection secrets stay off the browser (0052): a pending connection is readable by the
-- service role only, never by a signed-in admin or anon; stored tokens and account ids must be
-- sealed on both connection_tokens and connection_pending; the connection row a company admin
-- reads never carries the provider's account id; the audit log never records it; a stored sync
-- error that quotes its own connection's account id is replaced, and no other error is; and a
-- pending connection goes when the person who started it is deleted.
--
-- Runs inside one transaction the harness opens and rolls back; never begin or commit here.

-- Setup, as system.
select tests.create_person('kingdom_admin', tests.company('kingdom'), 'admin');
select tests.create_person('kingdom_starter', tests.company('kingdom'), 'admin');

with c as (
  insert into public.company_connections (company_id, provider, status)
  values (tests.company('kingdom'), 'quickbooks', 'connected')
  returning id
)
insert into tests.fixture (name, id) select 'k_qbo', id from c;

-- The service role reads the fixtures here only; the grant rolls back with the transaction.
grant usage on schema tests to service_role;
grant select on tests.fixture to service_role;
grant execute on all functions in schema tests to service_role;

-- case: pending_is_service_only
select tests.act_as(tests.id('kingdom_admin'));
select tests.assert_raises('select 1 from public.connection_pending', '%permission denied%');
reset role;
select set_config('request.jwt.claims', '', true);

set local role anon;
select tests.assert_raises('select 1 from public.connection_pending', '%permission denied%');
reset role;

set local role service_role;
insert into public.connection_pending (id, company_id, provider, started_by, account_name, access_token, refresh_token, account_id, expires_at)
values (gen_random_uuid(), tests.company('kingdom'), 'quickbooks', tests.id('kingdom_admin'), 'Kingdom Books',
        'v1:a', 'v1:r', 'v1:i', now() + interval '10 minutes');
select tests.assert(
  (select count(*) from public.connection_pending
    where company_id = tests.company('kingdom') and started_by = tests.id('kingdom_admin')
      and access_token = 'v1:a' and refresh_token = 'v1:r' and account_id = 'v1:i') = 1,
  'pending_is_service_only: the service role could not read back the pending connection it stored'
);
reset role;

-- case: tokens_must_be_sealed
select tests.assert_raises(
  format($q$insert into public.connection_tokens (connection_id, access_token) values (%L, 'plain')$q$, tests.id('k_qbo')),
  '%connection_tokens_sealed%'
);
select tests.assert_raises(
  format($q$insert into public.connection_tokens (connection_id, access_token, refresh_token) values (%L, 'v1:x', 'plain')$q$, tests.id('k_qbo')),
  '%connection_tokens_sealed%'
);
select tests.assert_raises(
  format($q$insert into public.connection_tokens (connection_id, access_token, account_id) values (%L, 'v1:x', 'plain')$q$, tests.id('k_qbo')),
  '%connection_tokens_sealed%'
);
insert into public.connection_tokens (connection_id, access_token, refresh_token, account_id)
values (tests.id('k_qbo'), 'v1:x', 'v1:x', 'v1:x');
select tests.assert(
  (select count(*) from public.connection_tokens where connection_id = tests.id('k_qbo') and account_id = 'v1:x') = 1,
  'tokens_must_be_sealed: sealed tokens and a sealed account id were not stored'
);

-- case: pending_must_be_sealed
select tests.assert_raises(
  format($q$insert into public.connection_pending (id, company_id, provider, started_by, access_token, expires_at)
            values (gen_random_uuid(), %L, 'quickbooks', %L, 'plain', now() + interval '10 minutes')$q$,
         tests.company('kingdom'), tests.id('kingdom_admin')),
  '%connection_pending_sealed%'
);
select tests.assert_raises(
  format($q$insert into public.connection_pending (id, company_id, provider, started_by, access_token, refresh_token, expires_at)
            values (gen_random_uuid(), %L, 'quickbooks', %L, 'v1:x', 'plain', now() + interval '10 minutes')$q$,
         tests.company('kingdom'), tests.id('kingdom_admin')),
  '%connection_pending_sealed%'
);
select tests.assert_raises(
  format($q$insert into public.connection_pending (id, company_id, provider, started_by, access_token, account_id, expires_at)
            values (gen_random_uuid(), %L, 'quickbooks', %L, 'v1:x', 'plain', now() + interval '10 minutes')$q$,
         tests.company('kingdom'), tests.id('kingdom_admin')),
  '%connection_pending_sealed%'
);

-- case: no_account_id_on_the_connection_row
select tests.assert_raises(
  format($q$update public.company_connections set external_account_id = 'realm-1' where id = %L$q$, tests.id('k_qbo')),
  '%company_connections_no_account_id%'
);

-- case: audit_never_records_the_account_id
with c as (
  insert into public.company_connections (company_id, provider, status)
  values (tests.company('kingdom'), 'gohighlevel', 'connected')
  returning id
)
insert into tests.fixture (name, id) select 'k_ghl', id from c;
update public.company_connections set status = 'error' where id = tests.id('k_ghl');
select tests.assert(
  (select count(*) from public.audit_events
    where table_name = 'company_connections' and row_id = tests.id('k_ghl')::text) = 2,
  'audit_never_records_the_account_id: the insert and the status change were not both audited'
);
select tests.assert(
  not exists (select 1 from public.audit_events
               where table_name = 'company_connections' and changed ? 'external_account_id'),
  'audit_never_records_the_account_id: an audit event names the account id'
);
select tests.assert(
  (select changed ? 'status' from public.audit_events
    where table_name = 'company_connections' and row_id = tests.id('k_ghl')::text and action = 'update'),
  'audit_never_records_the_account_id: the status change is not in the update event'
);

-- case: pending_goes_with_its_starter
insert into public.connection_pending (id, company_id, provider, started_by, access_token, expires_at)
values (gen_random_uuid(), tests.company('kingdom'), 'gohighlevel', tests.id('kingdom_starter'), 'v1:s', now() + interval '10 minutes');
select tests.assert(
  (select count(*) from public.connection_pending where started_by = tests.id('kingdom_starter')) = 1,
  'pending_goes_with_its_starter: the pending connection was not stored'
);
delete from public.profiles where id = tests.id('kingdom_starter');
select tests.assert(
  (select count(*) from public.connection_pending where started_by = tests.id('kingdom_starter')) = 0,
  'pending_goes_with_its_starter: the pending connection outlived the person who started it'
);

-- case: sync_errors_lose_the_account_id
-- The harness applies 0052 before any test, so this case puts the world back as it was before it
-- (the check off, ids on two connections, errors that quote them) and pastes 0052 again here.
alter table public.company_connections drop constraint company_connections_no_account_id;
update public.company_connections set external_account_id = 'sample-realm-1' where id = tests.id('k_qbo');
with c as (
  insert into public.company_connections (company_id, provider, status, external_account_id)
  values (tests.company('klasik'), 'quickbooks', 'error', 'sample-realm-2')
  returning id
)
insert into tests.fixture (name, id) select 'l_qbo', id from c;

with s as (
  insert into public.sync_sources (company_id, connection_id, provider, name, target_module, last_status, last_error)
  values (tests.company('kingdom'), tests.id('k_qbo'), 'quickbooks', 'Books', 'financial_reporting', 'failed',
          'error sending request for url (https://quickbooks.api.example/v3/company/sample-realm-1/query)')
  returning id
)
insert into tests.fixture (name, id) select 'k_src_leaky', id from s;
with s as (
  insert into public.sync_sources (company_id, connection_id, provider, name, target_module, last_status, last_error)
  values (tests.company('kingdom'), tests.id('k_qbo'), 'quickbooks', 'Books two', 'financial_reporting', 'failed',
          'The report had no rows.')
  returning id
)
insert into tests.fixture (name, id) select 'k_src_plain', id from s;
-- Klasik's error quotes Kingdom's id, not its own: only a connection's own id is matched.
with s as (
  insert into public.sync_sources (company_id, connection_id, provider, name, target_module, last_status, last_error)
  values (tests.company('klasik'), tests.id('l_qbo'), 'quickbooks', 'Books', 'financial_reporting', 'failed',
          'Mentions sample-realm-1 only.')
  returning id
)
insert into tests.fixture (name, id) select 'l_src', id from s;

with r as (
  insert into public.sync_runs (source_id, connection_id, trigger_kind, status, error_detail)
  values (tests.id('k_src_leaky'), tests.id('k_qbo'), 'manual', 'failed',
          '{"message": "error sending request for url (https://quickbooks.api.example/v3/company/sample-realm-1/query)"}')
  returning id
)
insert into tests.fixture (name, id) select 'k_run_leaky', id from r;
with r as (
  insert into public.sync_runs (source_id, connection_id, trigger_kind, status, error_detail)
  values (tests.id('k_src_plain'), tests.id('k_qbo'), 'manual', 'failed', '[{"message": "Row 3 has no date."}]')
  returning id
)
insert into tests.fixture (name, id) select 'k_run_plain', id from r;

\ir ../migrations/0052_connection_secrets.sql

select tests.assert(
  (select last_error from public.sync_sources where id = tests.id('k_src_leaky')) = 'The last sync could not reach the outside tool.',
  'sync_errors_lose_the_account_id: a source error quoting the account id was kept'
);
select tests.assert(
  (select error_detail from public.sync_runs where id = tests.id('k_run_leaky'))
    = '{"message": "The last sync could not reach the outside tool."}'::jsonb,
  'sync_errors_lose_the_account_id: a run error quoting the account id was kept'
);
select tests.assert(
  (select last_error from public.sync_sources where id = tests.id('k_src_plain')) = 'The report had no rows.',
  'sync_errors_lose_the_account_id: an unrelated source error was replaced'
);
select tests.assert(
  (select error_detail from public.sync_runs where id = tests.id('k_run_plain')) = '[{"message": "Row 3 has no date."}]'::jsonb,
  'sync_errors_lose_the_account_id: an unrelated run error was replaced'
);
select tests.assert(
  (select last_error from public.sync_sources where id = tests.id('l_src')) = 'Mentions sample-realm-1 only.',
  'sync_errors_lose_the_account_id: an error was matched against another connection''s id'
);
select tests.assert(
  (select count(*) from public.company_connections
    where id in (tests.id('k_qbo'), tests.id('l_qbo')) and external_account_id is null) = 2,
  'sync_errors_lose_the_account_id: an account id survived the paste'
);
select tests.assert(
  (select count(*) from pg_constraint where conname = 'company_connections_no_account_id') = 1,
  'sync_errors_lose_the_account_id: the paste did not put the check back'
);
