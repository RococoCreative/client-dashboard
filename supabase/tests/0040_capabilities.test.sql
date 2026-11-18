-- 0040_capabilities.test.sql
-- Proves the capability catalog and company overrides (0040): with no override rows every
-- capability resolves to who holds that power today, an override narrows or widens it for one
-- company only, the rococo level is never met by a company role, a Rococo admin passes every
-- capability, another company, a deactivated person and an unknown key are all refused without
-- an error, members read the catalog and only their own company's overrides, only Rococo writes
-- overrides and nobody writes the catalog from the browser, a level outside the five is refused,
-- and every override change is audited.
--
-- Runs inside one transaction the harness opens and rolls back; never begin or commit here.

-- Setup, as system.
select tests.create_person('kingdom_owner', tests.company('kingdom'), 'owner');
select tests.create_person('kingdom_admin', tests.company('kingdom'), 'admin');
select tests.create_person('kingdom_manager', tests.company('kingdom'), 'manager');
select tests.create_person('kingdom_employee', tests.company('kingdom'));
select tests.create_person('klasik_admin', tests.company('klasik'), 'admin');
select tests.create_person('rococo_admin', null, 'employee', true);
select tests.create_person('kingdom_former_owner', tests.company('kingdom'), 'owner');
update public.profiles set is_active = false where id = tests.id('kingdom_former_owner');

-- case: defaults_match_today
select tests.assert(
  (select count(*) from public.company_capabilities) = 0,
  'defaults_match_today: override rows exist before any were written'
);
select tests.act_as(tests.id('kingdom_admin'));
select tests.assert(private.can(tests.company('kingdom'), 'pay'), 'defaults: an admin lost pay');
select tests.assert(private.can(tests.company('kingdom'), 'company_settings'), 'defaults: an admin lost company settings');
select tests.assert(not private.can(tests.company('kingdom'), 'audit_log'), 'defaults: an admin reads the change log');
select tests.assert(private.can(tests.company('kingdom'), 'milestones_edit') and private.can(tests.company('kingdom'), 'wins_post')
                    and private.can(tests.company('kingdom'), 'sync_run'), 'defaults: an admin lost an admin power');
select tests.assert(private.can(tests.company('kingdom'), 'production_view'), 'defaults: an admin lost production view');

select tests.act_as(tests.id('kingdom_manager'));
select tests.assert(
  not (private.can(tests.company('kingdom'), 'pay') or private.can(tests.company('kingdom'), 'company_settings')
       or private.can(tests.company('kingdom'), 'audit_log') or private.can(tests.company('kingdom'), 'milestones_edit')
       or private.can(tests.company('kingdom'), 'wins_post') or private.can(tests.company('kingdom'), 'sync_run')),
  'defaults: a manager holds an admin power'
);
select tests.assert(private.can(tests.company('kingdom'), 'production_view'), 'defaults: a manager lost production view');

select tests.act_as(tests.id('kingdom_employee'));
select tests.assert(
  not (private.can(tests.company('kingdom'), 'pay') or private.can(tests.company('kingdom'), 'company_settings')
       or private.can(tests.company('kingdom'), 'audit_log') or private.can(tests.company('kingdom'), 'milestones_edit')
       or private.can(tests.company('kingdom'), 'wins_post') or private.can(tests.company('kingdom'), 'sync_run')),
  'defaults: an employee holds an admin power'
);
select tests.assert(private.can(tests.company('kingdom'), 'production_view'), 'defaults: an employee lost production view');
reset role;
select set_config('request.jwt.claims', '', true);

-- case: override_narrows
insert into public.company_capabilities (company_id, capability, min_role)
values (tests.company('kingdom'), 'pay', 'owner');
select tests.act_as(tests.id('kingdom_admin'));
select tests.assert(not private.can(tests.company('kingdom'), 'pay'), 'override_narrows: a Kingdom admin kept pay');
select tests.act_as(tests.id('kingdom_owner'));
select tests.assert(private.can(tests.company('kingdom'), 'pay'), 'override_narrows: a Kingdom owner lost pay');
select tests.act_as(tests.id('klasik_admin'));
select tests.assert(private.can(tests.company('klasik'), 'pay'), 'override_narrows: a Kingdom override reached Klasik');
reset role;
select set_config('request.jwt.claims', '', true);

-- case: override_widens
insert into public.company_capabilities (company_id, capability, min_role)
values (tests.company('kingdom'), 'wins_post', 'employee'),
       (tests.company('kingdom'), 'milestones_edit', 'manager');
select tests.act_as(tests.id('kingdom_employee'));
select tests.assert(private.can(tests.company('kingdom'), 'wins_post'), 'override_widens: an employee cannot post wins');
select tests.assert(not private.can(tests.company('kingdom'), 'milestones_edit'), 'override_widens: an employee edits milestones');
select tests.act_as(tests.id('kingdom_manager'));
select tests.assert(
  private.can(tests.company('kingdom'), 'wins_post') and private.can(tests.company('kingdom'), 'milestones_edit'),
  'override_widens: a manager lost a widened power'
);

-- case: rococo_level_is_never_met
select tests.act_as(tests.id('kingdom_owner'));
select tests.assert(not private.can(tests.company('kingdom'), 'audit_log'), 'rococo_level_is_never_met: an owner reads the change log');

-- case: rococo_passes_everything
select tests.act_as(tests.id('rococo_admin'));
select tests.assert(
  (select bool_and(private.can(tests.company('kingdom'), c.key)) and count(*) = 7 from public.capabilities c),
  'rococo_passes_everything: a Rococo admin was refused a capability'
);

-- case: other_company_is_false
select tests.act_as(tests.id('klasik_admin'));
select tests.assert(not private.can(tests.company('kingdom'), 'production_view'), 'other_company_is_false: a Klasik admin views Kingdom production');

-- case: deactivated_is_false
select tests.act_as(tests.id('kingdom_former_owner'));
select tests.assert(not private.can(tests.company('kingdom'), 'production_view'), 'deactivated_is_false: a deactivated owner views production');

-- case: unknown_capability_is_false
select tests.act_as(tests.id('kingdom_owner'));
select tests.assert(not private.can(tests.company('kingdom'), 'no_such_thing'), 'unknown_capability_is_false: an unknown key passed');
reset role;
select set_config('request.jwt.claims', '', true);

-- case: members_read_only_their_rows
insert into public.company_capabilities (company_id, capability, min_role)
values (tests.company('klasik'), 'sync_run', 'owner');
select tests.act_as(tests.id('kingdom_employee'));
select tests.assert((select count(*) from public.capabilities) = 7, 'members_read_only_their_rows: the catalog is not seven rows');
select tests.assert(
  (select count(*) from public.company_capabilities where company_id = tests.company('kingdom')) = 3,
  'members_read_only_their_rows: a Kingdom employee does not see the Kingdom overrides'
);
select tests.assert(
  (select count(*) from public.company_capabilities where company_id = tests.company('klasik')) = 0,
  'members_read_only_their_rows: a Kingdom employee reads Klasik overrides'
);

-- case: only_rococo_writes
select tests.act_as(tests.id('kingdom_owner'));
select tests.assert_raises(
  format(
    $q$insert into public.company_capabilities (company_id, capability, min_role) values (%L, 'sync_run', 'employee')$q$,
    tests.company('kingdom')
  ),
  '%row-level security%'
);
do $$
declare
  v_rows integer;
begin
  update public.company_capabilities set min_role = 'admin' where company_id = tests.company('kingdom');
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'only_rococo_writes: % override row(s) updated by a Kingdom owner', v_rows;
  end if;
  delete from public.company_capabilities where company_id = tests.company('kingdom');
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'only_rococo_writes: % override row(s) deleted by a Kingdom owner', v_rows;
  end if;
end;
$$;
select tests.assert_raises(
  $q$update public.capabilities set default_min_role = 'employee' where key = 'pay'$q$,
  '%permission denied%'
);
select tests.act_as(tests.id('rococo_admin'));
insert into public.company_capabilities (company_id, capability, min_role)
values (tests.company('kingdom'), 'sync_run', 'owner');
select tests.assert(
  (select min_role = 'owner' from public.company_capabilities
    where company_id = tests.company('kingdom') and capability = 'sync_run'),
  'only_rococo_writes: a Rococo insert did not land'
);
select tests.assert_raises(
  $q$insert into public.capabilities (key, default_min_role, sort_order) values ('new_power', 'admin', 8)$q$,
  '%permission denied%'
);
select tests.assert_raises(
  $q$update public.capabilities set default_min_role = 'employee' where key = 'pay'$q$,
  '%permission denied%'
);
select tests.assert_raises(
  $q$delete from public.capabilities where key = 'pay'$q$,
  '%permission denied%'
);

-- case: bad_level_refused
select tests.assert_raises(
  format(
    $q$insert into public.company_capabilities (company_id, capability, min_role) values (%L, 'company_settings', 'boss')$q$,
    tests.company('kingdom')
  ),
  '%company_capabilities_min_role_check%'
);

-- case: override_change_is_audited
update public.company_capabilities set min_role = 'admin'
 where company_id = tests.company('kingdom') and capability = 'sync_run';
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select count(*) from public.audit_events
    where table_name = 'company_capabilities' and company_id = tests.company('kingdom')
      and actor_kind = 'rococo' and action = 'insert') >= 1,
  'override_change_is_audited: the Rococo insert was not audited'
);
select tests.assert(
  (select count(*) from public.audit_events
    where table_name = 'company_capabilities' and company_id = tests.company('kingdom')
      and action = 'update' and changed->'min_role'->>'new' = 'admin') = 1,
  'override_change_is_audited: the Rococo update was not audited'
);
