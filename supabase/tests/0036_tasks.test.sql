-- 0036_tasks.test.sql
-- Proves tasks (0036): an employee sees only what is assigned to them, creates only for
-- themselves, and may only complete and tick what an admin assigned; ticking the last step
-- completes a task and unticking reopens it; a repeating task opens one next copy on the next
-- upcoming slot, keeping its assigner, and the completed copy is locked; deleting the open copy
-- ends the series; the database alone writes next_task_id and notified_assignee_id; a task, its
-- person and its campaign stay in one company; and another company sees nothing.
--
-- Runs inside one transaction the harness opens and rolls back; never begin or commit here.

-- Setup, as system.
select tests.create_person('rba_admin', tests.company('rba'), 'admin');
select tests.create_person('rba_employee', tests.company('rba'));
select tests.create_person('rba_other', tests.company('rba'));
select tests.create_person('kingdom_admin', tests.company('kingdom'), 'admin');
select tests.create_person('rococo_admin', null, 'employee', true);

with c as (
  insert into public.marketing_campaigns (company_id, name)
  values (tests.company('rba'), 'Sample campaign 3601')
  returning id
)
insert into tests.fixture (name, id) select 'campaign_rba', id from c;

with c as (
  insert into public.marketing_campaigns (company_id, name)
  values (tests.company('kingdom'), 'Sample campaign 3602')
  returning id
)
insert into tests.fixture (name, id) select 'campaign_kingdom', id from c;

-- case: admin_creates_and_system_columns_pinned
select tests.act_as(tests.id('rba_admin'));
insert into public.tasks (company_id, title, assignee_id, campaign_id, notified_assignee_id, next_task_id, created_by)
values (tests.company('rba'), 'Sample task 3601', tests.id('rba_employee'), tests.id('campaign_rba'),
        tests.id('rba_employee'), gen_random_uuid(), tests.id('rba_other'));
insert into public.tasks (company_id, title, assignee_id)
values (tests.company('rba'), 'Sample task 3602', tests.id('rba_other'));
reset role;
select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id) select 'task_assigned', id from public.tasks where title = 'Sample task 3601';
insert into tests.fixture (name, id) select 'task_other', id from public.tasks where title = 'Sample task 3602';
insert into public.task_steps (task_id, title, sort_order)
values (tests.id('task_assigned'), 'Step one', 1), (tests.id('task_assigned'), 'Step two', 2);
select tests.assert(
  (select created_by = tests.id('rba_admin') and notified_assignee_id is null and next_task_id is null
     from public.tasks where id = tests.id('task_assigned')),
  'admin_creates_and_system_columns_pinned: created_by, notified_assignee_id or next_task_id took the client value'
);
select tests.assert(
  (select bool_and(company_id = tests.company('rba')) from public.task_steps where task_id = tests.id('task_assigned')),
  'admin_creates_and_system_columns_pinned: a step did not take its company from its task'
);

-- case: employee_reads_only_assigned
select tests.act_as(tests.id('rba_employee'));
select tests.assert(
  (select count(*) = 1 and bool_and(assignee_id = tests.id('rba_employee')) from public.tasks),
  'employee_reads_only_assigned: the employee saw a task not assigned to them'
);
select tests.assert(
  (select count(*) = 2 from public.task_steps),
  'employee_reads_only_assigned: the employee did not see exactly their task''s steps'
);

-- case: employee_cannot_assign_others_or_attach_campaign
select tests.assert_raises(
  format('insert into public.tasks (company_id, title, assignee_id) values (%L, %L, %L)',
         tests.company('rba'), 'Sample task 3603', tests.id('rba_other')),
  'new row violates row-level security policy%'
);
select tests.assert_raises(
  format('insert into public.tasks (company_id, title, assignee_id, campaign_id) values (%L, %L, %L, %L)',
         tests.company('rba'), 'Sample task 3604', tests.id('rba_employee'), tests.id('campaign_rba')),
  'new row violates row-level security policy%'
);

-- case: employee_cannot_edit_admin_task
select tests.assert_raises(
  format('update public.tasks set title = %L where id = %L', 'Renamed', tests.id('task_assigned')),
  'Only the person who assigned this task can change it.'
);
select tests.assert_raises(
  format('update public.tasks set due_date = %L where id = %L', '2026-12-01', tests.id('task_assigned')),
  'Only the person who assigned this task can change it.'
);
select tests.assert_raises(
  format('update public.tasks set campaign_id = null where id = %L', tests.id('task_assigned')),
  'Only the person who assigned this task can change it.'
);

-- case: employee_cannot_change_admin_steps
select tests.assert_raises(
  format('update public.task_steps set title = %L where task_id = %L and sort_order = 1', 'Renamed', tests.id('task_assigned')),
  'Only the person who assigned this task can change its steps.'
);
select tests.assert_raises(
  format('insert into public.task_steps (task_id, title) values (%L, %L)', tests.id('task_assigned'), 'Step three'),
  'Only the person who assigned this task can change its steps.'
);
select tests.assert_raises(
  format('delete from public.task_steps where task_id = %L', tests.id('task_assigned')),
  'Only the person who assigned this task can change its steps.'
);

-- case: employee_cannot_delete_admin_task
delete from public.tasks where id = tests.id('task_assigned');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  exists (select 1 from public.tasks where id = tests.id('task_assigned')),
  'employee_cannot_delete_admin_task: the employee deleted a task an admin assigned'
);

-- case: ticking_every_step_completes
select tests.act_as(tests.id('rba_employee'));
update public.task_steps set done_at = now() where task_id = tests.id('task_assigned') and sort_order = 1;
select tests.assert(
  (select completed_at is null from public.tasks where id = tests.id('task_assigned')),
  'ticking_every_step_completes: one of two steps completed the task'
);
update public.task_steps set done_at = now() where task_id = tests.id('task_assigned') and sort_order = 2;
select tests.assert(
  (select completed_at is not null and completed_by = tests.id('rba_employee')
     from public.tasks where id = tests.id('task_assigned')),
  'ticking_every_step_completes: the last step did not complete the task as the employee'
);

-- case: unticking_reopens
update public.task_steps set done_at = null where task_id = tests.id('task_assigned') and sort_order = 2;
select tests.assert(
  (select completed_at is null and completed_by is null from public.tasks where id = tests.id('task_assigned')),
  'unticking_reopens: unticking a step left the task complete'
);

-- case: employee_completes_by_hand
update public.tasks set completed_at = now() where id = tests.id('task_assigned');
select tests.assert(
  (select completed_at is not null and completed_by = tests.id('rba_employee')
     from public.tasks where id = tests.id('task_assigned')),
  'employee_completes_by_hand: completing by hand did not record the employee'
);
select tests.assert(
  (select count(*) = 1 from public.task_steps where task_id = tests.id('task_assigned') and done_at is null),
  'employee_completes_by_hand: completing by hand changed the steps'
);
update public.tasks set completed_at = null where id = tests.id('task_assigned');
select tests.assert(
  (select completed_at is null and completed_by is null from public.tasks where id = tests.id('task_assigned')),
  'employee_completes_by_hand: reopening by hand kept completed_by'
);

-- case: notified_assignee_pinned_for_clients
update public.tasks set notified_assignee_id = tests.id('rba_employee') where id = tests.id('task_assigned');
select tests.act_as(tests.id('rba_admin'));
update public.tasks set notified_assignee_id = tests.id('rba_employee'), next_task_id = tests.id('task_other')
 where id = tests.id('task_assigned');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select notified_assignee_id is null and next_task_id is null from public.tasks where id = tests.id('task_assigned')),
  'notified_assignee_pinned_for_clients: a client wrote notified_assignee_id or next_task_id'
);
-- With nobody signed in (the notify function's service client), the claim lands.
update public.tasks set notified_assignee_id = assignee_id where id = tests.id('task_assigned');
select tests.assert(
  (select notified_assignee_id = tests.id('rba_employee') from public.tasks where id = tests.id('task_assigned')),
  'notified_assignee_pinned_for_clients: the system could not claim the send'
);

-- case: employee_own_task
select tests.act_as(tests.id('rba_employee'));
insert into public.tasks (company_id, title, assignee_id)
values (tests.company('rba'), 'Sample task 3605', tests.id('rba_employee'));
reset role;
select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id) select 'task_own', id from public.tasks where title = 'Sample task 3605';
select tests.act_as(tests.id('rba_employee'));
update public.tasks set title = 'Sample task 3605 renamed', priority = 'high', due_date = '2026-12-01', recurrence = 'weekly'
 where id = tests.id('task_own');
insert into public.task_steps (task_id, title, sort_order) values (tests.id('task_own'), 'Own step', 1);
update public.task_steps set title = 'Own step renamed' where task_id = tests.id('task_own');
select tests.assert_raises(
  format('update public.tasks set assignee_id = %L where id = %L', tests.id('rba_other'), tests.id('task_own')),
  'Only the person who assigned this task can change it.'
);
select tests.assert_raises(
  format('update public.tasks set campaign_id = %L where id = %L', tests.id('campaign_rba'), tests.id('task_own')),
  'Only the person who assigned this task can change it.'
);
select tests.assert(
  (select created_by = tests.id('rba_employee') and title = 'Sample task 3605 renamed' and priority = 'high'
     from public.tasks where id = tests.id('task_own')),
  'employee_own_task: the employee could not edit a task they created for themselves'
);
delete from public.tasks where id = tests.id('task_own');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  not exists (select 1 from public.tasks where id = tests.id('task_own'))
  and not exists (select 1 from public.task_steps where task_id = tests.id('task_own')),
  'employee_own_task: the employee could not delete their own task and its steps'
);

-- case: weekly_recurrence_opens_next_copy
select tests.act_as(tests.id('rba_admin'));
insert into public.tasks (company_id, title, assignee_id, due_date, recurrence, priority, campaign_id)
values (tests.company('rba'), 'Sample task 3606', tests.id('rba_employee'), '2026-10-01', 'weekly', 'high',
        tests.id('campaign_rba'));
reset role;
select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id) select 'task_weekly', id from public.tasks where title = 'Sample task 3606';
insert into public.task_steps (task_id, title, sort_order)
values (tests.id('task_weekly'), 'Weekly one', 1), (tests.id('task_weekly'), 'Weekly two', 2);
select tests.act_as(tests.id('rba_employee'));
update public.task_steps set done_at = now() where task_id = tests.id('task_weekly');
reset role;
select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id)
select 'task_weekly_next', id from public.tasks where title = 'Sample task 3606' and completed_at is null;
select tests.assert(
  (select count(*) = 1 from public.tasks where title = 'Sample task 3606' and completed_at is null),
  'weekly_recurrence_opens_next_copy: not exactly one open copy'
);
select tests.assert(
  (select due_date = date '2026-10-01' + 7 * ((current_date - date '2026-10-01') / 7 + 1)
          and due_date > current_date and due_date <= current_date + 7
          and created_by = tests.id('rba_admin') and assignee_id = tests.id('rba_employee')
          and notified_assignee_id = assignee_id and priority = 'high' and recurrence = 'weekly'
          and campaign_id = tests.id('campaign_rba') and completed_by is null and next_task_id is null
     from public.tasks where id = tests.id('task_weekly_next')),
  'weekly_recurrence_opens_next_copy: the copy is wrong'
);
select tests.assert(
  (select count(*) = 2 and bool_and(done_at is null) and string_agg(title, ',' order by sort_order) = 'Weekly one,Weekly two'
     from public.task_steps where task_id = tests.id('task_weekly_next')),
  'weekly_recurrence_opens_next_copy: the copy''s steps are wrong'
);
select tests.assert(
  (select next_task_id = tests.id('task_weekly_next') and completed_by = tests.id('rba_employee')
     from public.tasks where id = tests.id('task_weekly')),
  'weekly_recurrence_opens_next_copy: the completed copy does not point at the next one'
);

-- case: internal_flag_does_not_outlive_the_write
select tests.assert(
  coalesce(current_setting('hub.task_internal', true), '') = '',
  'internal_flag_does_not_outlive_the_write: the flag is still set'
);
select tests.act_as(tests.id('rba_employee'));
select tests.assert_raises(
  format('update public.tasks set title = %L where id = %L', 'Renamed', tests.id('task_weekly_next')),
  'Only the person who assigned this task can change it.'
);

-- case: completed_copy_is_locked
select tests.assert_raises(
  format('update public.tasks set completed_at = null where id = %L', tests.id('task_weekly')),
  'The next one is already open.'
);
select tests.assert_raises(
  format('update public.task_steps set done_at = null where task_id = %L', tests.id('task_weekly')),
  'The next one is already open.'
);
select tests.act_as(tests.id('rba_admin'));
select tests.assert_raises(
  format('update public.tasks set completed_at = null where id = %L', tests.id('task_weekly')),
  'The next one is already open.'
);
select tests.assert_raises(
  format('insert into public.task_steps (task_id, title) values (%L, %L)', tests.id('task_weekly'), 'Late step'),
  'The next one is already open.'
);

-- case: deleting_open_copy_ends_series
delete from public.tasks where id = tests.id('task_weekly_next');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select next_task_id is null and recurrence is null and created_by = tests.id('rba_admin')
     from public.tasks where id = tests.id('task_weekly')),
  'deleting_open_copy_ends_series: the completed copy still repeats or still points at the deleted one'
);
select tests.act_as(tests.id('rba_admin'));
update public.tasks set completed_at = null where id = tests.id('task_weekly');
update public.tasks set completed_at = now() where id = tests.id('task_weekly');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select count(*) = 1 from public.tasks where title = 'Sample task 3606'),
  'deleting_open_copy_ends_series: reopening and completing the old copy started the series again'
);

-- case: every_interval_lands_on_next_slot
select tests.act_as(tests.id('rba_admin'));
insert into public.tasks (company_id, title, assignee_id, due_date, recurrence)
select tests.company('rba'), 'Sample interval ' || r, tests.id('rba_employee'), date '2025-01-31', r
  from unnest(array['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly']) r;
insert into public.tasks (company_id, title, due_date, recurrence)
values (tests.company('rba'), 'Sample interval future', current_date + 3, 'monthly');
update public.tasks set completed_at = now() where title like 'Sample interval %';
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select bool_and(t.due_date = (
            select min(s.d) from (
              select (date '2025-01-31' + n * case t.recurrence when 'daily' then interval '1 day'
                                                              when 'weekly' then interval '7 days'
                                                              when 'biweekly' then interval '14 days'
                                                              when 'monthly' then interval '1 month'
                                                              when 'quarterly' then interval '3 months'
                                                              else interval '1 year' end)::date as d
                from generate_series(1, 1000) n
            ) s where s.d > current_date))
          and count(*) = 6
     from public.tasks t
    where t.title like 'Sample interval %' and t.title <> 'Sample interval future' and t.completed_at is null),
  'every_interval_lands_on_next_slot: a copy is not on the first slot after today'
);
select tests.assert(
  (select due_date = ((current_date + 3) + interval '1 month')::date
     from public.tasks where title = 'Sample interval future' and completed_at is null),
  'every_interval_lands_on_next_slot: a task completed early did not step one interval'
);

-- case: another_company_sees_nothing
select tests.act_as(tests.id('kingdom_admin'));
select tests.assert(
  (select count(*) = 0 from public.tasks where company_id = tests.company('rba'))
  and (select count(*) = 0 from public.task_steps where company_id = tests.company('rba')),
  'another_company_sees_nothing: a Kingdom admin read RBA tasks or steps'
);
update public.tasks set title = 'Taken' where id = tests.id('task_other');
select tests.assert_raises(
  format('insert into public.tasks (company_id, title) values (%L, %L)', tests.company('rba'), 'Sample task 3607'),
  'new row violates row-level security policy%'
);
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select title = 'Sample task 3602' from public.tasks where id = tests.id('task_other')),
  'another_company_sees_nothing: a Kingdom admin changed an RBA task'
);

-- case: one_company_per_task
select tests.act_as(tests.id('rba_admin'));
select tests.assert_raises(
  format('insert into public.tasks (company_id, title, assignee_id) values (%L, %L, %L)',
         tests.company('rba'), 'Sample task 3608', tests.id('kingdom_admin')),
  'That person belongs to another company.'
);
select tests.assert_raises(
  format('update public.tasks set campaign_id = %L where id = %L', tests.id('campaign_kingdom'), tests.id('task_other')),
  'That campaign belongs to another company.'
);
update public.tasks set company_id = tests.company('kingdom') where id = tests.id('task_other');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select company_id = tests.company('rba') from public.tasks where id = tests.id('task_other')),
  'one_company_per_task: a task moved company'
);

-- case: rococo_admin_is_the_creator
select tests.act_as(tests.id('rococo_admin'));
insert into public.tasks (company_id, title, assignee_id)
values (tests.company('rba'), 'Sample task 3609', tests.id('rba_employee'));
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select created_by = tests.id('rococo_admin') from public.tasks where title = 'Sample task 3609'),
  'rococo_admin_is_the_creator: created_by is not the Rococo admin''s profile'
);

-- case: admin_deletes_task_with_steps
select tests.act_as(tests.id('rba_admin'));
delete from public.tasks where id = tests.id('task_assigned');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  not exists (select 1 from public.task_steps where task_id = tests.id('task_assigned')),
  'admin_deletes_task_with_steps: the steps outlived their task'
);

-- case: move_clears_assignee
update public.profiles set company_id = tests.company('kingdom') where id = tests.id('rba_other');
select tests.assert(
  (select assignee_id is null and company_id = tests.company('rba') from public.tasks where id = tests.id('task_other')),
  'move_clears_assignee: a moved person is still the assignee of the old company''s task'
);

-- case: deleted_person_clears_references
select tests.act_as(tests.id('rba_admin'));
insert into public.tasks (company_id, title, assignee_id)
values (tests.company('rba'), 'Sample task 3610', tests.id('rba_employee'));
reset role;
select set_config('request.jwt.claims', '', true);
update public.tasks set notified_assignee_id = assignee_id where title = 'Sample task 3610';
select tests.act_as(tests.id('rba_employee'));
update public.tasks set completed_at = now() where title = 'Sample task 3610';
reset role;
-- Removed by an admin: the guards are live while the foreign keys clear the person.
select set_config('request.jwt.claims',
  jsonb_build_object('sub', tests.user_of(tests.id('rba_admin')), 'role', 'authenticated')::text, true);
delete from public.profiles where id = tests.id('rba_employee');
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select assignee_id is null and completed_by is null and notified_assignee_id is null and completed_at is not null
     from public.tasks where title = 'Sample task 3610'),
  'deleted_person_clears_references: a deleted person is still on the task'
);

-- case: deleting_a_company_takes_its_series
do $$
declare
  v_company uuid;
  v_task    uuid;
begin
  insert into public.companies (slug, name) values ('tasks-delete-test', 'Tasks delete test')
  returning id into v_company;
  insert into public.tasks (company_id, title, due_date, recurrence)
  values (v_company, 'Sample task 3611', '2026-10-01', 'weekly')
  returning id into v_task;
  insert into public.task_steps (task_id, title) values (v_task, 'Doomed step');
  update public.tasks set completed_at = now() where id = v_task;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', tests.user_of(tests.id('rococo_admin')), 'role', 'authenticated')::text, true);
  delete from public.companies where id = v_company;
  perform set_config('request.jwt.claims', '', true);
  if exists (select 1 from public.tasks where company_id = v_company) then
    raise exception 'Assertion failed: deleting_a_company_takes_its_series: tasks outlived their company';
  end if;
end;
$$;
