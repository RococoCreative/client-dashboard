-- 0050_connector_requests.test.sql
-- Proves tool requests (0050): a company's admin asks for a tool and withdraws it; who asked is
-- stamped by the database as the signed-in person, whatever the insert sent; a second ask for the
-- same tool through the service's upsert shape leaves one row; members read their own company's
-- requests and no other company's; employees and managers write nothing; a Rococo admin reads
-- every company's requests and may ask on a company's behalf; a row never moves company; the key
-- is checked for shape; every ask is audited; and deleting a person who asked keeps the request
-- with nobody named.
--
-- Runs inside one transaction the harness opens and rolls back; never begin or commit here.

-- How many rows a statement touched as whoever is acting, so a delete that RLS quietly skips
-- reads as 0.
create function tests.rows_of(p_sql text)
returns integer
language plpgsql
as $$
declare
  v_rows integer;
begin
  execute p_sql;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;
grant execute on function tests.rows_of(text) to authenticated;

-- Setup, as system.
select tests.create_person('kingdom_admin', tests.company('kingdom'), 'admin');
select tests.create_person('kingdom_admin2', tests.company('kingdom'), 'admin');
select tests.create_person('kingdom_leaver', tests.company('kingdom'), 'admin');
select tests.create_person('kingdom_manager', tests.company('kingdom'), 'manager');
select tests.create_person('kingdom_employee', tests.company('kingdom'));
select tests.create_person('klasik_admin', tests.company('klasik'), 'admin');
select tests.create_person('rococo', null, 'employee', true);

-- case: admin_asks_and_withdraws
select tests.act_as(tests.id('kingdom_admin'));
insert into public.connector_requests (company_id, connector_key) values (tests.company('kingdom'), 'xero');
select tests.assert(
  (select count(*) from public.connector_requests
    where company_id = tests.company('kingdom') and connector_key = 'xero') = 1,
  'admin_asks_and_withdraws: the admin does not read the request they made'
);
select tests.assert(
  tests.rows_of(format($q$delete from public.connector_requests where company_id = %L and connector_key = 'xero'$q$,
    tests.company('kingdom'))) = 1,
  'admin_asks_and_withdraws: the admin could not withdraw the request'
);
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select count(*) from public.connector_requests where company_id = tests.company('kingdom')) = 0,
  'admin_asks_and_withdraws: a withdrawn request is still there'
);

-- case: requested_by_is_stamped
select tests.act_as(tests.id('kingdom_admin'));
insert into public.connector_requests (company_id, connector_key, requested_by)
values (tests.company('kingdom'), 'jobtread', tests.id('kingdom_employee'));
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select requested_by = tests.id('kingdom_admin') from public.connector_requests
    where company_id = tests.company('kingdom') and connector_key = 'jobtread'),
  'requested_by_is_stamped: the request names someone other than the admin who made it'
);
-- With nobody signed in (the SQL editor), the row keeps what the insert sent.
insert into public.connector_requests (company_id, connector_key, requested_by)
values (tests.company('klasik'), 'jobtread', tests.id('klasik_admin'));
select tests.assert(
  (select requested_by = tests.id('klasik_admin') from public.connector_requests
    where company_id = tests.company('klasik') and connector_key = 'jobtread'),
  'requested_by_is_stamped: a system insert lost the requester it was given'
);

-- case: second_ask_is_one_row
select tests.act_as(tests.id('kingdom_admin2'));
insert into public.connector_requests (company_id, connector_key) values (tests.company('kingdom'), 'jobtread')
on conflict (company_id, connector_key) do nothing;
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select count(*) from public.connector_requests
    where company_id = tests.company('kingdom') and connector_key = 'jobtread') = 1,
  'second_ask_is_one_row: a second ask for the same tool made a second row'
);
select tests.assert(
  (select requested_by = tests.id('kingdom_admin') from public.connector_requests
    where company_id = tests.company('kingdom') and connector_key = 'jobtread'),
  'second_ask_is_one_row: a second ask changed who asked first'
);
-- A plain second insert is refused by the unique key.
select tests.act_as(tests.id('kingdom_admin2'));
select tests.assert_raises(
  format($q$insert into public.connector_requests (company_id, connector_key) values (%L, 'jobtread')$q$, tests.company('kingdom')),
  '%connector_requests_company_id_connector_key_key%'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- case: members_read_own_company
select tests.act_as(tests.id('kingdom_employee'));
select tests.assert(
  (select count(*) from public.connector_requests where company_id = tests.company('kingdom')) = 1,
  'members_read_own_company: an employee does not read their company''s requests'
);
select tests.assert(
  (select count(*) from public.connector_requests where company_id <> tests.company('kingdom')) = 0,
  'members_read_own_company: an employee reads another company''s requests'
);
select tests.act_as(tests.id('kingdom_manager'));
select tests.assert(
  (select count(*) from public.connector_requests where company_id = tests.company('kingdom')) = 1,
  'members_read_own_company: a manager does not read their company''s requests'
);
select tests.act_as(tests.id('klasik_admin'));
select tests.assert(
  (select count(*) from public.connector_requests where company_id = tests.company('kingdom')) = 0,
  'members_read_own_company: another company''s admin reads Kingdom''s requests'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- case: employee_and_manager_cannot_write
select tests.act_as(tests.id('kingdom_employee'));
select tests.assert_raises(
  format($q$insert into public.connector_requests (company_id, connector_key) values (%L, 'buildertrend')$q$, tests.company('kingdom')),
  '%row-level security%'
);
select tests.assert(
  tests.rows_of(format($q$delete from public.connector_requests where company_id = %L$q$, tests.company('kingdom'))) = 0,
  'employee_and_manager_cannot_write: an employee withdrew a request'
);
select tests.act_as(tests.id('kingdom_manager'));
select tests.assert_raises(
  format($q$insert into public.connector_requests (company_id, connector_key) values (%L, 'buildertrend')$q$, tests.company('kingdom')),
  '%row-level security%'
);
select tests.assert(
  tests.rows_of(format($q$delete from public.connector_requests where company_id = %L$q$, tests.company('kingdom'))) = 0,
  'employee_and_manager_cannot_write: a manager withdrew a request'
);
-- Another company's admin can neither ask for Kingdom nor withdraw Kingdom's request.
select tests.act_as(tests.id('klasik_admin'));
select tests.assert_raises(
  format($q$insert into public.connector_requests (company_id, connector_key) values (%L, 'buildertrend')$q$, tests.company('kingdom')),
  '%row-level security%'
);
select tests.assert(
  tests.rows_of(format($q$delete from public.connector_requests where company_id = %L$q$, tests.company('kingdom'))) = 0,
  'employee_and_manager_cannot_write: another company''s admin withdrew Kingdom''s request'
);
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select count(*) from public.connector_requests where company_id = tests.company('kingdom')) = 1,
  'employee_and_manager_cannot_write: Kingdom''s requests changed'
);

-- case: rococo_reads_all_and_may_ask
select tests.act_as(tests.id('rococo'));
select tests.assert(
  (select count(*) from public.connector_requests
    where company_id in (tests.company('kingdom'), tests.company('klasik'))) = 2,
  'rococo_reads_all_and_may_ask: a Rococo admin does not read every company''s requests'
);
insert into public.connector_requests (company_id, connector_key) values (tests.company('kingdom'), 'monday');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select requested_by = tests.id('rococo') from public.connector_requests
    where company_id = tests.company('kingdom') and connector_key = 'monday'),
  'rococo_reads_all_and_may_ask: a Rococo admin''s ask does not name them'
);

-- case: company_is_pinned
select tests.act_as(tests.id('kingdom_admin'));
select tests.assert_raises(
  format($q$update public.connector_requests set company_id = %L where company_id = %L and connector_key = 'jobtread'$q$,
    tests.company('klasik'), tests.company('kingdom')),
  '%permission denied%'
);
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select count(*) from public.connector_requests
    where company_id = tests.company('kingdom') and connector_key = 'jobtread') = 1,
  'company_is_pinned: a request moved to another company'
);

-- case: bad_key_refused
select tests.act_as(tests.id('kingdom_admin'));
select tests.assert_raises(
  format($q$insert into public.connector_requests (company_id, connector_key) values (%L, 'Asana!')$q$, tests.company('kingdom')),
  '%connector_requests_key_check%'
);
select tests.assert_raises(
  format($q$insert into public.connector_requests (company_id, connector_key) values (%L, '')$q$, tests.company('kingdom')),
  '%connector_requests_key_check%'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- case: audited
select tests.assert(
  (select count(*) from public.audit_events
    where table_name = 'connector_requests' and action = 'insert'
      and company_id = tests.company('kingdom')
      and changed -> 'connector_key' ->> 'new' = 'jobtread'
      and actor_profile_id = tests.id('kingdom_admin')) = 1,
  'audited: asking for a tool was not audited'
);
select tests.assert(
  (select count(*) from public.audit_events
    where table_name = 'connector_requests' and action = 'delete'
      and company_id = tests.company('kingdom')
      and changed -> 'connector_key' ->> 'old' = 'xero') = 1,
  'audited: withdrawing a request was not audited'
);

-- case: deleting_a_requester_keeps_the_request
select tests.act_as(tests.id('kingdom_leaver'));
insert into public.connector_requests (company_id, connector_key) values (tests.company('kingdom'), 'buildertrend');
reset role;
select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id)
select 'leaver_request', id from public.connector_requests
 where company_id = tests.company('kingdom') and connector_key = 'buildertrend';
select tests.assert(
  (select requested_by = tests.id('kingdom_leaver') from public.connector_requests where id = tests.id('leaver_request')),
  'deleting_a_requester_keeps_the_request: the request does not name who asked'
);
delete from public.profiles where id = tests.id('kingdom_leaver');
select tests.assert(
  (select requested_by is null from public.connector_requests where id = tests.id('leaver_request')),
  'deleting_a_requester_keeps_the_request: the request was lost or still names a deleted person'
);
