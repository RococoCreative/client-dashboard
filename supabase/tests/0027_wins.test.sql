-- 0027_wins.test.sql
-- Proves manual wins (0027): a browser write is always manual and can never set where a win came
-- from, a system write keeps it, members read and only admins write, another company sees and
-- writes nothing, a win's project must be its own company's, its company is pinned, nobody
-- deletes, every write is stamped with who made it, and a title is required.
--
-- Runs inside one transaction the harness opens and rolls back; never begin or commit here.

-- Setup, as system.
select tests.create_person('kingdom_admin', tests.company('kingdom'), 'admin');
select tests.create_person('kingdom_employee', tests.company('kingdom'));
select tests.create_person('klasik_admin', tests.company('klasik'), 'admin');
select tests.create_person('rococo_admin', null, 'employee', true);

with p as (
  insert into public.projects (company_id, name, reference)
  values (tests.company('kingdom'), 'Sample job 911', '911')
  returning id
)
insert into tests.fixture (name, id) select 'project_kingdom', id from p;

with p as (
  insert into public.projects (company_id, name, reference)
  values (tests.company('klasik'), 'Sample job 912', '912')
  returning id
)
insert into tests.fixture (name, id) select 'project_klasik', id from p;

-- case: browser_write_forced_manual
select tests.act_as(tests.id('kingdom_admin'));
insert into public.wins (company_id, title, won_on, project_id, source_type, source_ref)
values (tests.company('kingdom'), 'Sample win 901', '2026-09-01', tests.id('project_kingdom'),
        'manual', '{"from": "elsewhere"}');
-- tests.fixture is written as system only.
reset role;
select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id)
select 'win_kingdom', id from public.wins where title = 'Sample win 901';
select tests.assert(
  (select source_type = 'manual' and source_ref is null
     from public.wins where id = tests.id('win_kingdom')),
  'browser_write_forced_manual: a browser insert kept the provenance it sent'
);

-- case: browser_update_cannot_set_provenance
select tests.act_as(tests.id('kingdom_admin'));
update public.wins set source_ref = '{"from": "elsewhere"}' where id = tests.id('win_kingdom');
select tests.assert(
  (select source_ref is null from public.wins where id = tests.id('win_kingdom')),
  'browser_update_cannot_set_provenance: a browser update set source_ref'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- case: system_write_keeps_ref
insert into public.wins (company_id, title, won_on, source_ref)
values (tests.company('kingdom'), 'Sample win 902', '2026-08-01', '{"from": "test"}');
select tests.assert(
  (select source_ref = '{"from": "test"}'::jsonb from public.wins where title = 'Sample win 902'),
  'system_write_keeps_ref: a system insert lost its source_ref'
);

-- case: member_reads
select tests.act_as(tests.id('kingdom_employee'));
select tests.assert(
  (select count(*) from public.wins where company_id = tests.company('kingdom')) >= 1,
  'member_reads: a Kingdom employee reads no Kingdom wins'
);

-- case: member_write_refused
select tests.assert_raises(
  format(
    $q$insert into public.wins (company_id, title, won_on) values (%L, 'Member win', '2026-09-02')$q$,
    tests.company('kingdom')
  ),
  '%row-level security%'
);
do $$
declare
  v_rows integer;
begin
  update public.wins set title = 'Renamed by a member' where id = tests.id('win_kingdom');
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'member_write_refused: % win row(s) updated by a Kingdom employee', v_rows;
  end if;
end;
$$;

-- case: other_company_refused
select tests.act_as(tests.id('klasik_admin'));
select tests.assert(
  (select count(*) from public.wins where company_id = tests.company('kingdom')) = 0,
  'other_company_refused: a Klasik admin reads Kingdom wins'
);
select tests.assert_raises(
  format(
    $q$insert into public.wins (company_id, title, won_on) values (%L, 'Reach across', '2026-09-03')$q$,
    tests.company('kingdom')
  ),
  '%row-level security%'
);

-- case: project_other_company_rejected
select tests.act_as(tests.id('kingdom_admin'));
select tests.assert_raises(
  format(
    $q$insert into public.wins (company_id, title, won_on, project_id)
       values (%L, 'Wrong project', '2026-09-04', %L)$q$,
    tests.company('kingdom'), tests.id('project_klasik')
  ),
  '%That project belongs to another company.%'
);

-- case: company_pinned
update public.wins set company_id = tests.company('klasik') where id = tests.id('win_kingdom');
select tests.assert(
  (select company_id from public.wins where id = tests.id('win_kingdom')) = tests.company('kingdom'),
  'company_pinned: a win moved to another company'
);

-- case: no_delete
select tests.assert_raises(
  format($q$delete from public.wins where id = %L$q$, tests.id('win_kingdom')),
  '%permission denied%'
);

-- case: actor_stamped
select tests.assert(
  (select created_by = tests.id('kingdom_admin') from public.wins where id = tests.id('win_kingdom')),
  'actor_stamped: the insert was not stamped with the Kingdom admin'
);

-- case: title_required
select tests.assert_raises(
  format(
    $q$insert into public.wins (company_id, title, won_on) values (%L, '   ', '2026-09-05')$q$,
    tests.company('kingdom')
  ),
  '%wins_title_check%'
);
reset role;
select set_config('request.jwt.claims', '', true);
