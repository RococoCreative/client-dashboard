-- 0052_connection_secrets.test.sql
-- Proves connection secrets stay off the browser (0052): a pending connection is readable by the
-- service role only, never by a signed-in admin or anon; stored tokens and account ids must be
-- sealed on both connection_tokens and connection_pending; the connection row a company admin
-- reads never carries the provider's account id; the audit log never records it; and a pending
-- connection goes when the person who started it is deleted.
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
