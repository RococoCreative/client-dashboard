-- 0026_projects_milestones.test.sql
-- Proves projects and their milestones and letters (0026): a milestone takes its company from
-- its project, a responsible person must belong to that company, members read and only admins
-- write, nobody deletes, a project's company is pinned, every write is stamped with who made it,
-- moving a person to another company clears them as a milestone's owner, and anon reads nothing.
--
-- Runs inside one transaction the harness opens and rolls back; never begin or commit here.

-- Setup, as system.
select tests.create_person('kingdom_admin', tests.company('kingdom'), 'admin');
select tests.create_person('kingdom_admin_two', tests.company('kingdom'), 'admin');
select tests.create_person('kingdom_employee', tests.company('kingdom'));
select tests.create_person('klasik_admin', tests.company('klasik'), 'admin');
select tests.create_person('klasik_employee', tests.company('klasik'));
select tests.create_person('rococo_admin', null, 'employee', true);

with p as (
  insert into public.projects (company_id, name, reference)
  values (tests.company('kingdom'), 'Sample job 901', '901')
  returning id
)
insert into tests.fixture (name, id) select 'project_kingdom', id from p;

with p as (
  insert into public.projects (company_id, name, reference)
  values (tests.company('klasik'), 'Sample job 902', '902')
  returning id
)
insert into tests.fixture (name, id) select 'project_klasik', id from p;

-- case: milestone_inherits_company
select tests.act_as(tests.id('kingdom_admin'));
insert into public.project_milestones (company_id, project_id, title, kind, sort_order)
values (tests.company('klasik'), tests.id('project_kingdom'), 'Contract signed', 'milestone', 1);
-- tests.fixture is written as system only.
reset role;
select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id)
select 'milestone_kingdom', id from public.project_milestones where title = 'Contract signed';
select tests.act_as(tests.id('kingdom_admin'));
select tests.assert(
  (select company_id from public.project_milestones where id = tests.id('milestone_kingdom'))
    = tests.company('kingdom'),
  'milestone_inherits_company: the milestone was not stored with Kingdom''s company'
);

-- case: responsible_other_company_rejected
select tests.assert_raises(
  format(
    $q$insert into public.project_milestones (project_id, title, responsible_profile_id)
       values (%L, 'Permit approved', %L)$q$,
    tests.id('project_kingdom'), tests.id('klasik_employee')
  ),
  '%That person belongs to another company.%'
);

-- case: missing_project_rejected
select tests.assert_raises(
  format(
    $q$insert into public.project_milestones (project_id, title) values (%L, 'Orphan')$q$,
    gen_random_uuid()
  ),
  '%That project does not exist.%'
);

-- case: cross_company_project_refused
select tests.assert_raises(
  format(
    $q$insert into public.project_milestones (project_id, title) values (%L, 'Reach across')$q$,
    tests.id('project_klasik')
  ),
  '%row-level security%'
);

-- case: member_reads
select tests.act_as(tests.id('kingdom_employee'));
select tests.assert(
  (select count(*) from public.projects) = 1,
  'member_reads: a Kingdom employee does not read exactly one project'
);
select tests.assert(
  (select count(*) from public.project_milestones where project_id = tests.id('project_kingdom')) = 1,
  'member_reads: a Kingdom employee does not read the Kingdom project''s milestone'
);

-- case: member_write_refused
select tests.assert_raises(
  format(
    $q$insert into public.projects (company_id, name) values (%L, 'Member project')$q$,
    tests.company('kingdom')
  ),
  '%row-level security%'
);
do $$
declare
  v_rows integer;
begin
  update public.projects set name = 'Renamed by a member' where id = tests.id('project_kingdom');
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'member_write_refused: % project row(s) updated by a Kingdom employee', v_rows;
  end if;
  update public.project_milestones set title = 'Renamed by a member' where id = tests.id('milestone_kingdom');
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'member_write_refused: % milestone row(s) updated by a Kingdom employee', v_rows;
  end if;
end;
$$;

-- case: other_company_reads_nothing
select tests.act_as(tests.id('klasik_admin'));
select tests.assert(
  (select count(*) from public.projects where id = tests.id('project_kingdom')) = 0,
  'other_company_reads_nothing: a Klasik admin reads the Kingdom project'
);
select tests.assert(
  (select count(*) from public.project_milestones where id = tests.id('milestone_kingdom')) = 0,
  'other_company_reads_nothing: a Klasik admin reads the Kingdom milestone'
);

-- case: no_delete
select tests.act_as(tests.id('kingdom_admin'));
select tests.assert_raises(
  format($q$delete from public.projects where id = %L$q$, tests.id('project_kingdom')),
  '%permission denied%'
);
select tests.assert_raises(
  format($q$delete from public.project_milestones where id = %L$q$, tests.id('milestone_kingdom')),
  '%permission denied%'
);

-- case: company_pinned
update public.projects set company_id = tests.company('klasik') where id = tests.id('project_kingdom');
select tests.assert(
  (select company_id from public.projects where id = tests.id('project_kingdom')) = tests.company('kingdom'),
  'company_pinned: a project moved to another company'
);

-- case: actor_stamped
insert into public.projects (company_id, name, created_by)
values (tests.company('kingdom'), 'Sample job 903', tests.id('kingdom_employee'));
reset role;
select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id)
select 'project_stamped', id from public.projects where name = 'Sample job 903';
select tests.assert(
  (select created_by = tests.id('kingdom_admin') and updated_by = tests.id('kingdom_admin')
     from public.projects where id = tests.id('project_stamped')),
  'actor_stamped: the insert was not stamped with the Kingdom admin'
);
select tests.act_as(tests.id('kingdom_admin_two'));
update public.projects set notes = 'Edited' where id = tests.id('project_stamped');
select tests.assert(
  (select created_by = tests.id('kingdom_admin') and updated_by = tests.id('kingdom_admin_two')
     from public.projects where id = tests.id('project_stamped')),
  'actor_stamped: the update did not keep created_by and stamp updated_by'
);

-- case: rococo_writes_any_company
select tests.act_as(tests.id('rococo_admin'));
insert into public.projects (company_id, name) values (tests.company('klasik'), 'Sample job 904');
select tests.assert(
  (select count(*) from public.projects where name = 'Sample job 904' and company_id = tests.company('klasik')) = 1,
  'rococo_writes_any_company: a Rococo admin could not add a Klasik project'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- case: move_clears_owner
update public.project_milestones
   set responsible_profile_id = tests.id('kingdom_employee')
 where id = tests.id('milestone_kingdom');
select tests.assert(
  (select responsible_profile_id from public.project_milestones where id = tests.id('milestone_kingdom'))
    = tests.id('kingdom_employee'),
  'move_clears_owner: setup did not assign the Kingdom employee'
);
update public.profiles set company_id = tests.company('klasik') where id = tests.id('kingdom_employee');
select tests.assert(
  (select responsible_profile_id from public.project_milestones where id = tests.id('milestone_kingdom')) is null,
  'move_clears_owner: the moved person is still responsible for a Kingdom milestone'
);

-- case: checks_hold
select tests.assert_raises(
  format($q$insert into public.projects (company_id, name) values (%L, '   ')$q$, tests.company('kingdom')),
  '%check constraint%'
);
select tests.assert_raises(
  format($q$insert into public.project_milestones (project_id, title) values (%L, ' ')$q$, tests.id('project_kingdom')),
  '%check constraint%'
);
select tests.assert_raises(
  format($q$insert into public.project_milestones (project_id, title, kind) values (%L, 'Task', 'task')$q$, tests.id('project_kingdom')),
  '%project_milestones_kind_check%'
);

-- case: source_key_unique
insert into public.projects (company_id, name, source_key) values (tests.company('kingdom'), 'Keyed one', 'x');
select tests.assert_raises(
  format($q$insert into public.projects (company_id, name, source_key) values (%L, 'Keyed two', 'x')$q$, tests.company('kingdom')),
  '%projects_source_key_key%'
);
insert into public.projects (company_id, name) values (tests.company('kingdom'), 'Unkeyed one');
insert into public.projects (company_id, name) values (tests.company('kingdom'), 'Unkeyed two');

-- case: anon_no_access
set role anon;
select tests.assert_raises('select 1 from public.projects', '%permission denied%');
reset role;
select set_config('request.jwt.claims', '', true);
