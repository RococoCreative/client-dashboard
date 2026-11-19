-- 0044_milestone_templates.test.sql
-- Proves a company's standard milestones (0044): a company with no template rows gets projects
-- with no milestones, as today; a new project starts with a copy of the company's live template
-- rows in order, whoever creates it (an admin, or the system with nobody signed in); projects that
-- already exist and copies already made are left alone; members read the list and only admins
-- write it; a row stays in its company; and every change is audited.
--
-- Runs inside one transaction the harness opens and rolls back; never begin or commit here.

-- Setup, as system.
select tests.create_person('kingdom_admin', tests.company('kingdom'), 'admin');
select tests.create_person('kingdom_manager', tests.company('kingdom'), 'manager');
select tests.create_person('kingdom_employee', tests.company('kingdom'));
select tests.create_person('klasik_admin', tests.company('klasik'), 'admin');

-- case: no_template_no_milestones
select tests.act_as(tests.id('kingdom_admin'));
insert into public.projects (company_id, name) values (tests.company('kingdom'), 'Sample job 1');
reset role;
select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id) select 'before_project', id from public.projects where name = 'Sample job 1';
select tests.assert(
  (select count(*) from public.project_milestones where project_id = tests.id('before_project')) = 0,
  'no_template_no_milestones: a project at a company with no template has milestones'
);

-- case: template_is_copied
select tests.act_as(tests.id('kingdom_admin'));
insert into public.milestone_templates (company_id, title, kind, sort_order) values
  (tests.company('kingdom'), 'Second step', 'letter', 2),
  (tests.company('kingdom'), 'First step', 'milestone', 1),
  (tests.company('kingdom'), 'Old step', 'milestone', 3),
  (tests.company('kingdom'), 'Third step', 'milestone', 4);
update public.milestone_templates set archived_at = now()
 where company_id = tests.company('kingdom') and title = 'Old step';
insert into public.projects (company_id, name) values (tests.company('kingdom'), 'Sample job 2');
reset role;
select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id) select 'admin_project', id from public.projects where name = 'Sample job 2';
select tests.assert(
  (select array_agg(title || ':' || kind || ':' || status order by sort_order, title)
     from public.project_milestones where project_id = tests.id('admin_project'))
  = array['First step:milestone:not_started', 'Second step:letter:not_started', 'Third step:milestone:not_started'],
  'template_is_copied: an admin''s new project did not get the three live rows in order'
);
select tests.assert(
  (select bool_and(company_id = tests.company('kingdom') and archived_at is null and completed_on is null)
     from public.project_milestones where project_id = tests.id('admin_project')),
  'template_is_copied: a copied milestone is in the wrong company or not open'
);
select tests.assert(
  (select count(distinct sort_order) = 3 from public.project_milestones where project_id = tests.id('admin_project')),
  'template_is_copied: the copied milestones do not keep distinct positions'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- A project that arrives with nobody signed in (a sync) gets the same copy.
with p as (
  insert into public.projects (company_id, name) values (tests.company('kingdom'), 'Sample job 3')
  returning id
)
insert into tests.fixture (name, id) select 'system_project', id from p;
select tests.assert(
  (select array_agg(title order by sort_order, title)
     from public.project_milestones where project_id = tests.id('system_project'))
  = array['First step', 'Second step', 'Third step'],
  'template_is_copied: a project created by the system did not get the copy'
);

-- A manager may not create a project, so no copy happens for them; Klasik has no template.
select tests.act_as(tests.id('kingdom_manager'));
select tests.assert_raises(
  format($q$insert into public.projects (company_id, name) values (%L, 'Sample job 4')$q$, tests.company('kingdom')),
  '%row-level security%'
);
select tests.act_as(tests.id('klasik_admin'));
insert into public.projects (company_id, name) values (tests.company('klasik'), 'Sample job 5');
reset role;
select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id) select 'klasik_project', id from public.projects where name = 'Sample job 5';
select tests.assert(
  (select count(*) from public.project_milestones where project_id = tests.id('klasik_project')) = 0,
  'template_is_copied: one company''s template reached another company''s project'
);

-- case: existing_projects_untouched
select tests.assert(
  (select count(*) from public.project_milestones where project_id = tests.id('before_project')) = 0,
  'existing_projects_untouched: a project created before the template gained milestones'
);

-- case: later_edits_do_not_reach_back
select tests.act_as(tests.id('kingdom_admin'));
update public.milestone_templates set title = 'Renamed step'
 where company_id = tests.company('kingdom') and title = 'First step';
select tests.assert(
  (select count(*) from public.project_milestones
    where project_id = tests.id('admin_project') and title = 'First step') = 1
  and (select count(*) from public.project_milestones
        where project_id = tests.id('admin_project') and title = 'Renamed step') = 0,
  'later_edits_do_not_reach_back: renaming a template row changed a copied milestone'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- case: admins_write_members_read
select tests.act_as(tests.id('kingdom_admin'));
insert into public.milestone_templates (company_id, title) values (tests.company('kingdom'), 'Admin step');
reset role;
select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id) select 'admin_step', id from public.milestone_templates where title = 'Admin step';
select tests.act_as(tests.id('kingdom_admin'));
update public.milestone_templates set title = 'Admin step, renamed', kind = 'letter', sort_order = 9
 where id = tests.id('admin_step');
update public.milestone_templates set archived_at = now() where id = tests.id('admin_step');
select tests.assert(
  (select title = 'Admin step, renamed' and kind = 'letter' and sort_order = 9 and archived_at is not null
     from public.milestone_templates where id = tests.id('admin_step')),
  'admins_write_members_read: an admin''s insert, update and archive did not land'
);

select tests.act_as(tests.id('kingdom_employee'));
select tests.assert(
  (select count(*) from public.milestone_templates where company_id = tests.company('kingdom')) = 5,
  'admins_write_members_read: an employee does not read the company''s template'
);
select tests.assert_raises(
  format($q$insert into public.milestone_templates (company_id, title) values (%L, 'Employee step')$q$, tests.company('kingdom')),
  '%row-level security%'
);
update public.milestone_templates set title = 'Employee rename' where id = tests.id('admin_step');

select tests.act_as(tests.id('kingdom_manager'));
select tests.assert(
  (select count(*) from public.milestone_templates where company_id = tests.company('kingdom')) = 5,
  'admins_write_members_read: a manager does not read the company''s template'
);
select tests.assert_raises(
  format($q$insert into public.milestone_templates (company_id, title) values (%L, 'Manager step')$q$, tests.company('kingdom')),
  '%row-level security%'
);
update public.milestone_templates set title = 'Manager rename' where id = tests.id('admin_step');

select tests.act_as(tests.id('klasik_admin'));
select tests.assert(
  (select count(*) from public.milestone_templates where company_id = tests.company('kingdom')) = 0,
  'admins_write_members_read: another company reads Kingdom''s template'
);
update public.milestone_templates set title = 'Klasik rename' where id = tests.id('admin_step');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select title = 'Admin step, renamed' from public.milestone_templates where id = tests.id('admin_step')),
  'admins_write_members_read: an employee, manager or another company changed a row'
);

-- Titles and kinds follow the same checks as project_milestones.
select tests.assert_raises(
  format($q$insert into public.milestone_templates (company_id, title) values (%L, '  ')$q$, tests.company('kingdom')),
  '%milestone_templates_title_check%'
);
select tests.assert_raises(
  format($q$insert into public.milestone_templates (company_id, title, kind) values (%L, 'Bad', 'memo')$q$, tests.company('kingdom')),
  '%milestone_templates_kind_check%'
);

-- case: company_is_pinned
select tests.act_as(tests.id('kingdom_admin'));
update public.milestone_templates set company_id = tests.company('klasik') where id = tests.id('admin_step');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select company_id = tests.company('kingdom') from public.milestone_templates where id = tests.id('admin_step')),
  'company_is_pinned: a template row moved to another company'
);

-- case: changes_are_audited
select tests.assert(
  (select count(*) from public.audit_events
    where table_name = 'milestone_templates' and row_id = tests.id('admin_step')::text
      and action = 'insert' and company_id = tests.company('kingdom')) = 1,
  'changes_are_audited: adding a template row was not audited'
);
select tests.assert(
  (select count(*) from public.audit_events
    where table_name = 'milestone_templates' and row_id = tests.id('admin_step')::text
      and action = 'update' and changed ? 'archived_at') = 1,
  'changes_are_audited: archiving a template row was not audited'
);
