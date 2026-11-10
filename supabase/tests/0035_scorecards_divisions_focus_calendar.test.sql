-- 0035_scorecards_divisions_focus_calendar.test.sql
-- Proves the core rules of 0035: a result takes its company from its metric and is checked
-- against the metric's kind; the employee writes the opening discussion on their own open review
-- and nothing else new, and sign-off freezes it; a goal someone else filed is locked for the
-- employee (no retitle, no delete) while its completion stays theirs, and created_by is the
-- database's to stamp; only an owner or Rococo sets can_view_divisions, and a division is the
-- person's own company's; an assignment takes its company from the project.
--
-- Runs inside one transaction the harness opens and rolls back; never begin or commit here.

-- Setup, as system.
select tests.create_person('r_owner', tests.company('rba'), 'owner');
select tests.create_person('r_admin', tests.company('rba'), 'admin');
select tests.create_person('r_emp', tests.company('rba'));
select tests.create_person('k_admin', tests.company('klasik'), 'admin');
select tests.create_person('rococo', null, 'employee', true);

insert into public.job_roles (company_id, name) values (tests.company('rba'), 'Test Project Manager');
insert into public.role_metrics (company_id, job_role_id, name, kind, target)
select tests.company('klasik'), j.id, 'Optimization rate', 'percent', 80
  from public.job_roles j where j.company_id = tests.company('rba') and j.name = 'Test Project Manager';
insert into public.company_divisions (company_id, name) values
  (tests.company('rba'), 'Test South'), (tests.company('klasik'), 'Test Klasik');
insert into tests.fixture (name, id) select 'div_klasik', id from public.company_divisions where name = 'Test Klasik';
insert into public.projects (company_id, name) values (tests.company('rba'), 'Test Lakeside');
insert into public.review_cycles (company_id, name, cadence, period_start, period_end)
values (tests.company('rba'), 'Test November', 'monthly', '2026-11-01', '2026-11-30');
insert into public.reviews (cycle_id, company_id, employee_id, status)
select c.id, c.company_id, tests.id('r_emp'), 'in_progress' from public.review_cycles c where c.name = 'Test November';

-- case: metric_inherits_company_and_checks_values
select tests.assert(
  (select company_id from public.role_metrics where name = 'Optimization rate' and job_role_id = (select id from public.job_roles where name = 'Test Project Manager')) = tests.company('rba'),
  'metric_inherits_company_and_checks_values: the metric did not take its role''s company'
);
select tests.act_as(tests.id('r_admin'));
insert into public.metric_entries (company_id, employee_id, metric_id, period_month, value)
select tests.company('klasik'), tests.id('r_emp'), m.id, '2026-11-01', 85
  from public.role_metrics m join public.job_roles j on j.id = m.job_role_id where j.name = 'Test Project Manager';
select tests.assert(
  (select company_id from public.metric_entries where employee_id = tests.id('r_emp')) = tests.company('rba'),
  'metric_inherits_company_and_checks_values: the result did not take its metric''s company'
);
select tests.assert_raises(
  format($q$update public.metric_entries set value = 120 where employee_id = %L$q$, tests.id('r_emp')),
  'A percent is between 0 and 100.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('r_emp'));
select tests.assert_raises(
  format($q$insert into public.metric_entries (company_id, employee_id, metric_id, period_month, value)
            select %L, %L, id, '2026-10-01', 90 from public.role_metrics where name = 'Optimization rate'$q$,
         tests.company('rba'), tests.id('r_emp')),
  '%row-level security%'
);
select tests.assert(
  (select count(*) from public.metric_entries) = 1,
  'metric_inherits_company_and_checks_values: the employee cannot read their own result'
);
reset role; select set_config('request.jwt.claims', '', true);

-- case: opening_discussion_is_the_employees_until_sign_off
select tests.act_as(tests.id('r_emp'));
update public.reviews set support_discussion = 'A second laptop' where employee_id = tests.id('r_emp');
select tests.assert(
  (select support_discussion from public.reviews where employee_id = tests.id('r_emp')) = 'A second laptop',
  'opening_discussion_is_the_employees_until_sign_off: the employee could not write it'
);
select tests.assert_raises(
  format($q$update public.reviews set created_at = '2020-01-01' where employee_id = %L$q$, tests.id('r_emp')),
  'Only admins can edit review scores, status, and feedback.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('r_admin'));
update public.reviews set status = 'complete', completed_at = now() where employee_id = tests.id('r_emp');
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('r_emp'));
select tests.assert_raises(
  format($q$update public.reviews set support_discussion = 'Later' where employee_id = %L$q$, tests.id('r_emp')),
  'This review is signed off.%'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('r_admin'));
update public.reviews set status = 'in_progress', completed_at = null where employee_id = tests.id('r_emp');
reset role; select set_config('request.jwt.claims', '', true);

-- case: a_goal_set_for_you_is_locked
select tests.act_as(tests.id('r_admin'));
insert into public.goals (company_id, employee_id, cycle_id, scope, kind, title, created_by)
select c.company_id, tests.id('r_emp'), c.id, 'cycle', 'role', 'Set by admin', tests.id('r_emp')
  from public.review_cycles c where c.name = 'Test November';
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select created_by from public.goals where title = 'Set by admin') = tests.id('r_admin'),
  'a_goal_set_for_you_is_locked: created_by was not stamped with the admin'
);
select tests.act_as(tests.id('r_emp'));
insert into public.goals (company_id, employee_id, cycle_id, scope, kind, title)
select c.company_id, tests.id('r_emp'), c.id, 'cycle', 'personal', 'My own'
  from public.review_cycles c where c.name = 'Test November';
update public.goals set title = 'My own, renamed' where title = 'My own';
update public.goals set progress = 50, created_by = tests.id('r_emp') where title = 'Set by admin';
select tests.assert_raises(
  $q$update public.goals set title = 'Easier' where title = 'Set by admin'$q$,
  'This goal was set for you, so only an admin can change what it is.%'
);
select tests.assert_raises(
  $q$delete from public.goals where title = 'Set by admin'$q$,
  'This goal was set for you, so only an admin can remove it.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select progress = 50 and created_by = tests.id('r_admin') from public.goals where title = 'Set by admin'),
  'a_goal_set_for_you_is_locked: progress did not move, or the employee claimed the goal'
);
select tests.assert(
  exists (select 1 from public.goals where title = 'My own, renamed'),
  'a_goal_set_for_you_is_locked: the employee could not rename their own goal'
);

-- case: only_an_owner_or_rococo_sets_can_view_divisions
select tests.act_as(tests.id('r_admin'));
select tests.assert_raises(
  format($q$update public.profiles set can_view_divisions = true where id = %L$q$, tests.id('r_emp')),
  'Only an owner or Rococo can choose who sees the divisions.'
);
update public.profiles set division_id = (select id from public.company_divisions where name = 'Test South') where id = tests.id('r_emp');
select tests.assert_raises(
  format($q$update public.profiles set division_id = %L where id = %L$q$, tests.id('div_klasik'), tests.id('r_emp')),
  'That division belongs to another company.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('r_emp'));
select tests.assert_raises(
  format($q$update public.profiles set can_view_divisions = true where id = %L$q$, tests.id('r_emp')),
  'Only an owner or Rococo can choose who sees the divisions.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('r_owner'));
update public.profiles set can_view_divisions = true where id = tests.id('r_emp');
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select can_view_divisions and division_id is not null from public.profiles where id = tests.id('r_emp')),
  'only_an_owner_or_rococo_sets_can_view_divisions: the owner could not set it, or the division did not stick'
);

-- case: assignment_takes_the_projects_company
select tests.act_as(tests.id('r_admin'));
insert into public.project_assignments (company_id, project_id, employee_id)
select tests.company('klasik'), p.id, tests.id('r_emp') from public.projects p where p.name = 'Test Lakeside';
select tests.assert_raises(
  format($q$insert into public.project_assignments (company_id, project_id, employee_id)
            select %L, p.id, %L from public.projects p where p.name = 'Test Lakeside'$q$,
         tests.company('rba'), tests.id('k_admin')),
  'That person is not on this company''s team.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select company_id from public.project_assignments where employee_id = tests.id('r_emp')) = tests.company('rba'),
  'assignment_takes_the_projects_company: the assignment did not take the project''s company'
);
