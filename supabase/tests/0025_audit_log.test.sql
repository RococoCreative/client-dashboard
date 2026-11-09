-- 0025_audit_log.test.sql
-- Proves the audit log (0025): a watched change writes one event naming who made it, an
-- unwatched change writes none, inserts and deletes carry their values, the actor kind is
-- user, rococo or system as it should be, a company admin reads nothing, a Rococo admin reads
-- everything, nobody writes the table from the browser, and deleting a company still works.
--
-- Every event in one transaction shares a created_at (now() is the transaction start), so the
-- cases count events before and after rather than looking for the newest. Counts are read as
-- system, because a company admin cannot read the table at all.
--
-- Runs inside one transaction the harness opens and rolls back; never begin or commit here.

-- Setup, as system.
select tests.create_person('kingdom_admin', tests.company('kingdom'), 'admin');
select tests.create_person('kingdom_employee', tests.company('kingdom'));
select tests.create_person('rococo_admin', null, 'employee', true);

-- case: role_change_writes_one_event
select set_config('audit.before', (
  select count(*) from public.audit_events
   where table_name = 'profiles' and row_id = tests.id('kingdom_employee')::text
)::text, true);
select tests.act_as(tests.id('kingdom_admin'));
do $$
declare
  v_rows integer;
begin
  update public.profiles set role = 'admin' where id = tests.id('kingdom_employee');
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'role_change_writes_one_event: % row(s) updated by a Kingdom admin', v_rows;
  end if;
end;
$$;
reset role;
select set_config('request.jwt.claims', '', true);
do $$
declare
  v_after integer;
  v_matching integer;
begin
  select count(*) into v_after from public.audit_events
   where table_name = 'profiles' and row_id = tests.id('kingdom_employee')::text;
  if v_after - current_setting('audit.before')::integer <> 1 then
    raise exception 'role_change_writes_one_event: % new event(s), expected 1',
      v_after - current_setting('audit.before')::integer;
  end if;
  select count(*) into v_matching from public.audit_events
   where table_name = 'profiles'
     and row_id = tests.id('kingdom_employee')::text
     and action = 'update'
     and changed = '{"role": {"old": "employee", "new": "admin"}}'::jsonb
     and actor_kind = 'user'
     and actor_profile_id = tests.id('kingdom_admin')
     and actor_user_id = tests.user_of(tests.id('kingdom_admin'))
     and company_id = tests.company('kingdom');
  if v_matching <> 1 then
    raise exception 'role_change_writes_one_event: % event(s) match the role change', v_matching;
  end if;
end;
$$;

-- case: unwatched_change_writes_none
select set_config('audit.before', (select count(*) from public.audit_events)::text, true);
select tests.act_as(tests.id('kingdom_admin'));
do $$
declare
  v_rows integer;
begin
  update public.profiles set phone = '555-0100' where id = tests.id('kingdom_employee');
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'unwatched_change_writes_none: % row(s) updated by a Kingdom admin', v_rows;
  end if;
end;
$$;
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select count(*) from public.audit_events) = current_setting('audit.before')::bigint,
  'unwatched_change_writes_none: a phone change wrote an event'
);

-- case: insert_event_carries_new_values
select set_config('audit.before', (
  select count(*) from public.audit_events where table_name = 'invitations'
)::text, true);
select tests.act_as(tests.id('kingdom_admin'));
insert into public.invitations (company_id, email, role)
values (tests.company('kingdom'), 'audit.test@kingdomcustomconstruction.com', 'employee');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select count(*) from public.audit_events where table_name = 'invitations')
    - current_setting('audit.before')::bigint = 1,
  'insert_event_carries_new_values: expected exactly one new invitations event'
);
select tests.assert(
  (select count(*) from public.audit_events
    where table_name = 'invitations'
      and action = 'insert'
      and changed->'email'->>'new' = 'audit.test@kingdomcustomconstruction.com'
      and changed->'email'->'old' = 'null'::jsonb
      and changed->'role'->>'new' = 'employee'
      and company_id = tests.company('kingdom')) = 1,
  'insert_event_carries_new_values: the insert event does not carry the new email and role'
);

-- case: rococo_actor_kind
select tests.act_as(tests.id('rococo_admin'));
update public.companies set modules = '{wins}' where slug = 'kingdom';
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select count(*) from public.audit_events
    where table_name = 'companies'
      and action = 'update'
      and changed ? 'modules'
      and changed->'modules'->'new' = '["wins"]'::jsonb
      and actor_kind = 'rococo'
      and actor_profile_id = tests.id('rococo_admin')
      and row_id = tests.company('kingdom')::text
      and company_id = tests.company('kingdom')) = 1,
  'rococo_actor_kind: no rococo event for the Kingdom modules change'
);

-- case: system_actor_kind
update public.gsr_pillars set weight = weight + 1
 where id = (select id from public.gsr_pillars where company_id = tests.company('kingdom') order by sort_order limit 1);
select tests.assert(
  (select count(*) from public.audit_events
    where table_name = 'gsr_pillars'
      and action = 'update'
      and changed ? 'weight'
      and actor_kind = 'system'
      and actor_user_id is null
      and actor_profile_id is null
      and company_id = tests.company('kingdom')) = 1,
  'system_actor_kind: no system event for the pillar weight change'
);

-- case: domain_row_id_is_domain
select tests.act_as(tests.id('rococo_admin'));
insert into public.company_domains (domain, company_id) values ('audit-test.example', tests.company('kingdom'));
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select count(*) from public.audit_events
    where table_name = 'company_domains'
      and action = 'insert'
      and row_id = 'audit-test.example'
      and company_id = tests.company('kingdom')
      and actor_kind = 'rococo') = 1,
  'domain_row_id_is_domain: no domain event keyed by the domain'
);

-- case: company_admin_reads_zero_rows
select tests.assert(
  (select count(*) from public.audit_events) > 0,
  'company_admin_reads_zero_rows: no events to hide'
);
select tests.act_as(tests.id('kingdom_admin'));
select tests.assert(
  (select count(*) from public.audit_events) = 0,
  'company_admin_reads_zero_rows: a Kingdom admin can read audit events'
);

-- case: rococo_reads_events
select tests.act_as(tests.id('rococo_admin'));
select tests.assert(
  (select count(*) from public.audit_events) > 0,
  'rococo_reads_events: a Rococo admin reads no audit events'
);

-- case: authenticated_cannot_write
select tests.assert_raises(
  $q$insert into public.audit_events (table_name, row_id, action, actor_kind) values ('x', 'x', 'insert', 'user')$q$,
  '%permission denied%'
);
select tests.assert_raises(
  $q$update public.audit_events set action = 'delete'$q$,
  '%permission denied%'
);
select tests.assert_raises(
  $q$delete from public.audit_events$q$,
  '%permission denied%'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- case: company_delete_still_works
do $$
declare
  v_company uuid;
  v_rows integer;
begin
  insert into public.companies (slug, name) values ('audit-delete-test', 'Audit delete test')
  returning id into v_company;
  insert into public.company_domains (domain, company_id) values ('audit-delete.example', v_company);
  insert into public.company_connections (company_id, provider) values (v_company, 'gohighlevel');

  delete from public.companies where id = v_company;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'company_delete_still_works: % company row(s) deleted', v_rows;
  end if;

  if not exists (select 1 from public.audit_events
                  where company_id = v_company and table_name = 'companies' and action = 'delete') then
    raise exception 'company_delete_still_works: no delete event for the company';
  end if;
  if not exists (select 1 from public.audit_events
                  where company_id = v_company and table_name = 'company_domains' and action = 'delete') then
    raise exception 'company_delete_still_works: no delete event for the cascaded domain';
  end if;
  if not exists (select 1 from public.audit_events
                  where company_id = v_company and table_name = 'company_connections' and action = 'delete') then
    raise exception 'company_delete_still_works: no delete event for the cascaded connection';
  end if;
end;
$$;

-- case: one_trigger_each
do $$
declare
  v_expected constant text[][] := array[
    array['companies', 'companies_audit'],
    array['profiles', 'profiles_audit'],
    array['invitations', 'invitations_audit'],
    array['company_domains', 'company_domains_audit'],
    array['company_connections', 'company_connections_audit'],
    array['gsr_pillars', 'gsr_pillars_audit'],
    array['job_roles', 'job_roles_audit']
  ];
  v_count integer;
begin
  for i in 1 .. array_length(v_expected, 1) loop
    select count(*) into v_count from pg_trigger
     where tgrelid = ('public.' || v_expected[i][1])::regclass
       and tgname = v_expected[i][2]
       and not tgisinternal;
    if v_count <> 1 then
      raise exception 'one_trigger_each: % has % % trigger(s)', v_expected[i][1], v_count, v_expected[i][2];
    end if;
  end loop;
end;
$$;
