-- 0039_gsr_guards_and_task_goal_links.test.sql
-- Proves 0039: a carried goal keeps its creator only for the same person, the "set for you" lock
-- binds the goal's own person and not their manager, whose goal it is never changes, a complete
-- monthly GSR freezes its goals and notes scored or not, a re-sign drops a retired criterion's
-- rating but keeps line items, a single-figure pillar holds one line item, reviews stay out of
-- closed cycles and inside their cycle's company, and a task links only to a monthly goal of its
-- assignee in a month that is still open, with every system clear passing. Tasks are read through
-- the assignee and written through the led set, so a manager runs a report's task and its steps,
-- a division view alone writes nothing, and an employee reads only their own.
--
-- Runs inside one transaction the harness opens and rolls back; never begin or commit here.

-- Test-local helper, gone with the rollback: how many rows a statement touched as whoever is
-- acting, so a write that RLS quietly skips reads as 0.
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
select tests.create_person('t_full', tests.company('rba'), 'admin');
select tests.create_person('t_north_admin', tests.company('rba'), 'admin');
select tests.create_person('t_mgr', tests.company('rba'), 'manager');
select tests.create_person('t_view_mgr', tests.company('rba'), 'manager');
select tests.create_person('t_e1', tests.company('rba'));
select tests.create_person('t_e2', tests.company('rba'));
select tests.create_person('t_north_emp', tests.company('rba'));
select tests.create_person('t_south_emp', tests.company('rba'));
select tests.create_person('t_mover', tests.company('rba'));
select tests.create_person('k_emp', tests.company('klasik'));
select tests.create_person('rococo', null, 'employee', true);

insert into public.company_divisions (company_id, name) values
  (tests.company('rba'), 'Sample North 39'), (tests.company('rba'), 'Sample South 39');
insert into tests.fixture (name, id)
select case name when 'Sample North 39' then 'div_north' else 'div_south' end, id
  from public.company_divisions where name in ('Sample North 39', 'Sample South 39');

update public.profiles set view_all_divisions = true where id = tests.id('t_full');
update public.profiles
   set division_ids = array[tests.id('div_north')], view_division_ids = array[tests.id('div_north')],
       view_all_divisions = false
 where id = tests.id('t_north_admin');
update public.profiles set view_division_ids = array[tests.id('div_north')] where id = tests.id('t_view_mgr');
update public.profiles set division_ids = array[tests.id('div_south')], reports_to = tests.id('t_mgr') where id = tests.id('t_e1');
update public.profiles set division_ids = array[tests.id('div_south')] where id = tests.id('t_e2');
update public.profiles set division_ids = array[tests.id('div_north')] where id = tests.id('t_north_emp');
update public.profiles set division_ids = array[tests.id('div_south')] where id = tests.id('t_south_emp');

-- Months far from any real one: open (links), next (carry), frozen (complete without a score),
-- closed (reopen and insert), and a quarter for ratings.
insert into public.review_cycles (company_id, name, cadence, period_start, period_end) values
  (tests.company('rba'), 'Sample open 39',    'monthly',   '2031-03-01', '2031-03-31'),
  (tests.company('rba'), 'Sample next 39',    'monthly',   '2031-04-01', '2031-04-30'),
  (tests.company('rba'), 'Sample frozen 39',  'monthly',   '2031-02-01', '2031-02-28'),
  (tests.company('rba'), 'Sample closed 39',  'monthly',   '2031-01-01', '2031-01-31'),
  (tests.company('rba'), 'Sample quarter 39', 'quarterly', '2031-01-01', '2031-03-31');
insert into tests.fixture (name, id)
select case name when 'Sample open 39' then 'c_open' when 'Sample next 39' then 'c_next'
                 when 'Sample frozen 39' then 'c_frozen' when 'Sample closed 39' then 'c_closed'
                 else 'c_quarter' end, id
  from public.review_cycles where name like 'Sample % 39';

-- Goals filed by the full-scope admin, so each is "set for" its person.
select tests.act_as(tests.id('t_full'));
insert into public.goals (company_id, employee_id, cycle_id, scope, kind, title) values
  (tests.company('rba'), tests.id('t_e1'), tests.id('c_open'),   'cycle', 'role', 'Sample e1 open'),
  (tests.company('rba'), tests.id('t_e1'), tests.id('c_open'),   'cycle', 'professional', 'Sample e1 open two'),
  (tests.company('rba'), tests.id('t_e2'), tests.id('c_open'),   'cycle', 'role', 'Sample e2 open'),
  (tests.company('rba'), tests.id('t_e1'), tests.id('c_frozen'), 'cycle', 'role', 'Sample e1 frozen'),
  (tests.company('rba'), tests.id('t_e1'), tests.id('c_closed'), 'cycle', 'role', 'Sample e1 closed'),
  (tests.company('rba'), tests.id('t_mover'), tests.id('c_open'), 'cycle', 'role', 'Sample mover open');
insert into public.goals (company_id, employee_id, scope, kind, title, year)
values (tests.company('rba'), tests.id('t_e1'), 'year', 'professional', 'Sample e1 year', 2031);
reset role; select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id)
select case title when 'Sample e1 open' then 'g_e1' when 'Sample e1 open two' then 'g_e1_two'
                  when 'Sample e2 open' then 'g_e2' when 'Sample e1 frozen' then 'g_e1_frozen'
                  when 'Sample e1 closed' then 'g_e1_closed' when 'Sample mover open' then 'g_mover'
                  else 'g_e1_year' end, id
  from public.goals where title like 'Sample % open%' or title in ('Sample e1 frozen', 'Sample e1 closed', 'Sample e1 year');

-- ---------------------------------------------------------------------------------------
-- GSR
-- ---------------------------------------------------------------------------------------

-- case: carry_keeps_creator_only_for_the_same_person
select tests.act_as(tests.id('t_e1'));
insert into public.goals (company_id, employee_id, cycle_id, scope, kind, title, carried_from_goal_id, created_by)
values (tests.company('rba'), tests.id('t_e1'), tests.id('c_next'), 'cycle', 'role', 'Sample carried own', tests.id('g_e1'), tests.id('t_e1'));
insert into public.goals (company_id, employee_id, cycle_id, scope, kind, title, carried_from_goal_id)
values (tests.company('rba'), tests.id('t_e1'), tests.id('c_next'), 'cycle', 'role', 'Sample carried other', tests.id('g_e2'));
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select created_by = tests.id('t_full') from public.goals where title = 'Sample carried own'),
  'carry: a goal carried from the person''s own goal did not keep its creator'
);
select tests.assert(
  (select created_by = tests.id('t_e1') from public.goals where title = 'Sample carried other'),
  'carry: a goal carried from someone else''s goal took that goal''s creator'
);

-- case: manager_edits_a_reports_admin_set_goal
select tests.act_as(tests.id('t_mgr'));
update public.goals set title = 'Sample e1 open renamed' where id = tests.id('g_e1');
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select title = 'Sample e1 open renamed' from public.goals where id = tests.id('g_e1')),
  'manager_goal: a manager could not rename a report''s goal an admin set'
);

-- case: employee_still_locked_on_admin_set_goal
select tests.act_as(tests.id('t_e1'));
select tests.assert_raises(
  format('update public.goals set title = %L where id = %L', 'Mine now', tests.id('g_e1')),
  'This goal was set for you, so only an admin can change what it is.%'
);
select tests.assert_raises(
  format('delete from public.goals where id = %L', tests.id('g_e1')),
  'This goal was set for you, so only an admin can remove it.'
);
update public.goals set progress = 30 where id = tests.id('g_e1');
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select progress = 30 from public.goals where id = tests.id('g_e1')),
  'employee_locked: the person could not move the completion of a goal set for them'
);

-- case: employee_id_is_pinned
select tests.act_as(tests.id('t_full'));
update public.goals set employee_id = tests.id('t_e2') where id = tests.id('g_e1_two');
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select employee_id = tests.id('t_e1') from public.goals where id = tests.id('g_e1_two')),
  'employee_id_pinned: an admin moved a goal to another person'
);
select tests.act_as(tests.id('rococo'));
update public.goals set employee_id = tests.id('t_e2') where id = tests.id('g_e1_two');
update public.goals set employee_id = tests.id('t_e1') where id = tests.id('g_e1_two');
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select employee_id = tests.id('t_e1') from public.goals where id = tests.id('g_e1_two')),
  'employee_id_pinned: Rococo could not move a goal and back'
);

-- case: complete_without_score_freezes_goals_and_notes
select tests.act_as(tests.id('t_full'));
insert into public.goal_notes (goal_id, body) values (tests.id('g_e1_frozen'), 'Sample note before');
insert into public.reviews (cycle_id, company_id, employee_id)
values (tests.id('c_frozen'), tests.company('rba'), tests.id('t_e1'));
update public.reviews set status = 'complete', completed_at = now()
 where cycle_id = tests.id('c_frozen') and employee_id = tests.id('t_e1');
select tests.assert(
  (select gsr_score is null from public.reviews where cycle_id = tests.id('c_frozen') and employee_id = tests.id('t_e1')),
  'complete_freezes: the month was scored, so this case proves nothing'
);
select tests.assert_raises(
  format('update public.goals set title = %L where id = %L', 'Too late', tests.id('g_e1_frozen')),
  'This month''s GSR is locked in. Reopen the review to change its goals.'
);
select tests.assert_raises(
  format('update public.goals set progress = 90 where id = %L', tests.id('g_e1_frozen')),
  'This month''s GSR is locked in. Reopen the review to change its goals.'
);
select tests.assert_raises(
  format('insert into public.goal_notes (goal_id, body) values (%L, %L)', tests.id('g_e1_frozen'), 'Too late'),
  'This month''s GSR is locked in. Reopen the review to change its notes.'
);
select tests.assert_raises(
  format('update public.goal_notes set body = %L where goal_id = %L', 'Changed', tests.id('g_e1_frozen')),
  'This month''s GSR is locked in. Reopen the review to change its notes.'
);

-- case: outcome_note_still_writable
update public.goals set outcome_note = 'Sample why' where id = tests.id('g_e1_frozen');
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select outcome_note = 'Sample why' from public.goals where id = tests.id('g_e1_frozen')),
  'outcome_note: the why could not be written on a complete month'
);

-- case: resign_drops_a_retired_criterion_but_keeps_line_items
insert into public.gsr_pillars (company_id, name, weight, scoring_type) values
  (tests.company('rba'), 'Sample ratings 39', 0, 'rating'),
  (tests.company('rba'), 'Sample typed 39', 0, 'deliverables'),
  (tests.company('rba'), 'Sample module 39', 0, 'deliverables_module');
insert into tests.fixture (name, id)
select case name when 'Sample ratings 39' then 'p_rating' when 'Sample typed 39' then 'p_typed' else 'p_module' end, id
  from public.gsr_pillars where name like 'Sample % 39';
insert into public.gsr_criteria (pillar_id, company_id, name) values
  (tests.id('p_rating'), tests.company('rba'), 'Sample kept 39'),
  (tests.id('p_rating'), tests.company('rba'), 'Sample retired 39');
insert into tests.fixture (name, id)
select case name when 'Sample kept 39' then 'k_kept' else 'k_retired' end, id
  from public.gsr_criteria where name in ('Sample kept 39', 'Sample retired 39');
insert into public.impact_scores (company_id, employee_id, pillar_id, criterion_id, rating) values
  (tests.company('rba'), tests.id('t_e1'), tests.id('p_rating'), tests.id('k_kept'), 3),
  (tests.company('rba'), tests.id('t_e1'), tests.id('p_rating'), tests.id('k_retired'), 4);
select tests.act_as(tests.id('t_full'));
insert into public.reviews (cycle_id, company_id, employee_id)
values (tests.id('c_quarter'), tests.company('rba'), tests.id('t_e1'));
reset role; select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id)
select 'r_quarter', id from public.reviews where cycle_id = tests.id('c_quarter') and employee_id = tests.id('t_e1');
select tests.act_as(tests.id('t_full'));
insert into public.review_scores (review_id, company_id, pillar_id, label, target, actual) values
  (tests.id('r_quarter'), tests.company('rba'), tests.id('p_typed'), 'Sample line one', 10, 8),
  (tests.id('r_quarter'), tests.company('rba'), tests.id('p_typed'), 'Sample line two', 5, 5),
  (tests.id('r_quarter'), tests.company('rba'), tests.id('p_module'), 'Sample module', 20, 18);
update public.reviews set status = 'complete', completed_at = now() where id = tests.id('r_quarter');
select tests.assert(
  (select count(*) = 2 from public.review_scores where review_id = tests.id('r_quarter') and criterion_id is not null),
  'resign: the first sign-off did not freeze both ratings'
);
update public.reviews set status = 'in_progress', completed_at = null where id = tests.id('r_quarter');
reset role; select set_config('request.jwt.claims', '', true);
update public.gsr_criteria set is_active = false where id = tests.id('k_retired');
select tests.act_as(tests.id('t_full'));
update public.reviews set status = 'complete', completed_at = now() where id = tests.id('r_quarter');
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select count(*) = 1 and bool_and(criterion_id = tests.id('k_kept'))
     from public.review_scores where review_id = tests.id('r_quarter') and criterion_id is not null),
  'resign: the retired criterion''s rating is still on the re-signed review'
);
select tests.assert(
  (select count(*) = 3 from public.review_scores where review_id = tests.id('r_quarter') and criterion_id is null),
  'resign: a line item went with the re-sign'
);
select tests.assert(
  coalesce(current_setting('hub.freezing_review', true), '') = '',
  'resign: the freeze flag outlived the sign-off'
);

-- case: single_figure_pillar_holds_one_line_item
select tests.act_as(tests.id('t_full'));
update public.reviews set status = 'in_progress', completed_at = null where id = tests.id('r_quarter');
select tests.assert_raises(
  format('insert into public.review_scores (review_id, company_id, pillar_id, label, target, actual) values (%L, %L, %L, %L, 20, 19)',
         tests.id('r_quarter'), tests.company('rba'), tests.id('p_module'), 'Sample module again'),
  'This review already has its figure for that pillar.%'
);
insert into public.review_scores (review_id, company_id, pillar_id, label, target, actual)
values (tests.id('r_quarter'), tests.company('rba'), tests.id('p_typed'), 'Sample line three', 1, 1);
update public.review_scores set actual = 20 where review_id = tests.id('r_quarter') and pillar_id = tests.id('p_module');
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select count(*) = 3 from public.review_scores where review_id = tests.id('r_quarter') and pillar_id = tests.id('p_typed'))
  and (select actual = 20 from public.review_scores where review_id = tests.id('r_quarter') and pillar_id = tests.id('p_module')),
  'single_line: a typed pillar could not take a third line, or the module figure could not be updated'
);

-- case: reopen_refused_in_a_closed_cycle
select tests.act_as(tests.id('t_full'));
insert into public.reviews (cycle_id, company_id, employee_id)
values (tests.id('c_closed'), tests.company('rba'), tests.id('t_e1'));
update public.reviews set status = 'complete', completed_at = now()
 where cycle_id = tests.id('c_closed') and employee_id = tests.id('t_e1');
update public.review_cycles set status = 'closed' where id = tests.id('c_closed');
select tests.assert_raises(
  format('update public.reviews set status = %L, completed_at = null where cycle_id = %L and employee_id = %L',
         'in_progress', tests.id('c_closed'), tests.id('t_e1')),
  'This review cycle is closed. Reopen the cycle first.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('rococo'));
select tests.assert_raises(
  format('update public.reviews set status = %L, completed_at = null where cycle_id = %L and employee_id = %L',
         'in_progress', tests.id('c_closed'), tests.id('t_e1')),
  'This review cycle is closed. Reopen the cycle first.'
);

-- case: insert_refused_in_a_closed_cycle
select tests.assert_raises(
  format('insert into public.reviews (cycle_id, company_id, employee_id) values (%L, %L, %L)',
         tests.id('c_closed'), tests.company('rba'), tests.id('t_e2')),
  'This review cycle is closed. Reopen the cycle first.'
);
-- Opening a review that is already there (insert ignoring the duplicate) still works.
insert into public.reviews (cycle_id, company_id, employee_id)
values (tests.id('c_closed'), tests.company('rba'), tests.id('t_e1'))
on conflict (cycle_id, employee_id) do nothing;
select tests.assert(
  (select count(*) = 1 and bool_and(status = 'complete') from public.reviews
    where cycle_id = tests.id('c_closed') and employee_id = tests.id('t_e1')),
  'insert_closed: opening an existing review in a closed cycle changed or duplicated it'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('t_full'));
update public.review_cycles set status = 'open' where id = tests.id('c_closed');
update public.reviews set status = 'in_progress', completed_at = null
 where cycle_id = tests.id('c_closed') and employee_id = tests.id('t_e1');
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select status = 'in_progress' from public.reviews where cycle_id = tests.id('c_closed') and employee_id = tests.id('t_e1')),
  'reopen: a review could not be reopened once its cycle was'
);

-- case: a_review_never_leaves_a_closed_cycle
-- Moving a signed-off review to an open month in the same write that reopens it, or moving an
-- unsigned one out, would leave the closed month short a review.
select tests.act_as(tests.id('t_full'));
insert into public.reviews (cycle_id, company_id, employee_id)
values (tests.id('c_closed'), tests.company('rba'), tests.id('t_e2'));
update public.reviews set status = 'complete', completed_at = now()
 where cycle_id = tests.id('c_closed') and employee_id = tests.id('t_e1');
update public.review_cycles set status = 'closed' where id = tests.id('c_closed');
select tests.assert_raises(
  format('update public.reviews set cycle_id = %L, status = %L, completed_at = null where cycle_id = %L and employee_id = %L',
         tests.id('c_next'), 'in_progress', tests.id('c_closed'), tests.id('t_e1')),
  'This review cycle is closed. Reopen the cycle first.'
);
select tests.assert_raises(
  format('update public.reviews set cycle_id = %L where cycle_id = %L and employee_id = %L',
         tests.id('c_next'), tests.id('c_closed'), tests.id('t_e2')),
  'This review cycle is closed. Reopen the cycle first.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert_raises(
  format('update public.reviews set cycle_id = %L, status = %L, completed_at = null where cycle_id = %L and employee_id = %L',
         tests.id('c_next'), 'in_progress', tests.id('c_closed'), tests.id('t_e1')),
  'This review cycle is closed. Reopen the cycle first.'
);
select tests.assert(
  (select count(*) = 2 from public.reviews
    where cycle_id = tests.id('c_closed') and employee_id in (tests.id('t_e1'), tests.id('t_e2')))
  and (select status = 'complete' from public.reviews where cycle_id = tests.id('c_closed') and employee_id = tests.id('t_e1')),
  'closed_move: a review left a closed cycle or reopened on the way out'
);
select tests.act_as(tests.id('t_full'));
update public.review_cycles set status = 'open' where id = tests.id('c_closed');
update public.reviews set status = 'in_progress', completed_at = null
 where cycle_id = tests.id('c_closed') and employee_id = tests.id('t_e1');
reset role; select set_config('request.jwt.claims', '', true);
delete from public.reviews where cycle_id = tests.id('c_closed') and employee_id = tests.id('t_e2');

-- case: cross_company_review_refused
select tests.act_as(tests.id('rococo'));
select tests.assert_raises(
  format('insert into public.reviews (cycle_id, company_id, employee_id) values (%L, %L, %L)',
         tests.id('c_open'), tests.company('rba'), tests.id('k_emp')),
  'That person belongs to another company.'
);
select tests.assert_raises(
  format('update public.reviews set employee_id = %L where id = %L', tests.id('k_emp'), tests.id('r_quarter')),
  'That person belongs to another company.'
);
reset role; select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------------------
-- Tasks and goal links
-- ---------------------------------------------------------------------------------------

-- case: employee_links_own_task_to_own_goal
select tests.act_as(tests.id('t_e1'));
insert into public.tasks (company_id, title, assignee_id)
values (tests.company('rba'), 'Sample own 39', tests.id('t_e1'));
reset role; select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id) select 'task_own', id from public.tasks where title = 'Sample own 39';
select tests.act_as(tests.id('t_e1'));
update public.tasks set goal_id = tests.id('g_e1') where id = tests.id('task_own');
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select goal_id = tests.id('g_e1') from public.tasks where id = tests.id('task_own')),
  'own_link: the person could not link their own task to their own goal'
);

-- case: manager_creates_links_edits_and_completes_a_reports_task
select tests.act_as(tests.id('t_mgr'));
insert into public.tasks (company_id, title, assignee_id)
values (tests.company('rba'), 'Sample by manager 39', tests.id('t_e1'));
reset role; select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id) select 'task_mgr', id from public.tasks where title = 'Sample by manager 39';
select tests.act_as(tests.id('t_mgr'));
update public.tasks set goal_id = tests.id('g_e1'), title = 'Sample by manager 39 renamed', priority = 'high'
 where id = tests.id('task_mgr');
insert into public.task_steps (task_id, title, sort_order) values
  (tests.id('task_mgr'), 'Sample step one', 1), (tests.id('task_mgr'), 'Sample step two', 2);
update public.task_steps set title = 'Sample step one renamed' where task_id = tests.id('task_mgr') and sort_order = 1;
update public.task_steps set done_at = now() where task_id = tests.id('task_mgr');
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select goal_id = tests.id('g_e1') and title = 'Sample by manager 39 renamed' and priority = 'high'
          and created_by = tests.id('t_mgr') and completed_at is not null and completed_by = tests.id('t_mgr')
     from public.tasks where id = tests.id('task_mgr')),
  'manager_task: the manager could not link, edit or complete a report''s task'
);
select tests.assert(
  (select count(*) = 2 and bool_and(done_at is not null) and bool_or(title = 'Sample step one renamed')
     from public.task_steps where task_id = tests.id('task_mgr')),
  'manager_task: the manager could not add, rename or tick a report''s steps'
);

-- case: manager_edits_an_admins_task_for_a_report_but_not_its_campaign
with c as (
  insert into public.marketing_campaigns (company_id, name)
  values (tests.company('rba'), 'Sample campaign 39')
  returning id
)
insert into tests.fixture (name, id) select 'campaign', id from c;
select tests.act_as(tests.id('t_full'));
insert into public.tasks (company_id, title, assignee_id, campaign_id)
values (tests.company('rba'), 'Sample by admin 39', tests.id('t_e1'), tests.id('campaign'));
reset role; select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id) select 'task_admin', id from public.tasks where title = 'Sample by admin 39';
insert into public.task_steps (task_id, title) values (tests.id('task_admin'), 'Sample admin step');
select tests.act_as(tests.id('t_mgr'));
update public.tasks set title = 'Sample by admin 39 renamed', due_date = '2031-03-15' where id = tests.id('task_admin');
update public.task_steps set title = 'Sample admin step renamed' where task_id = tests.id('task_admin');
select tests.assert_raises(
  format('update public.tasks set campaign_id = null where id = %L', tests.id('task_admin')),
  'Only an admin can change a task''s campaign.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select title = 'Sample by admin 39 renamed' and campaign_id = tests.id('campaign') from public.tasks where id = tests.id('task_admin'))
  and (select title = 'Sample admin step renamed' from public.task_steps where task_id = tests.id('task_admin')),
  'manager_admin_task: the manager could not edit a report''s task or step an admin made'
);

-- case: plain_assignee_changes_only_completion_and_link
select tests.act_as(tests.id('t_e1'));
update public.tasks set goal_id = tests.id('g_e1') where id = tests.id('task_admin');
select tests.assert_raises(
  format('update public.tasks set title = %L where id = %L', 'Mine now', tests.id('task_admin')),
  'Only the person who assigned this task can change it.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select goal_id = tests.id('g_e1') from public.tasks where id = tests.id('task_admin')),
  'plain_assignee: the person could not link a task someone else assigned them'
);

-- case: link_refused_for_another_persons_goal
select tests.act_as(tests.id('t_full'));
select tests.assert_raises(
  format('update public.tasks set goal_id = %L where id = %L', tests.id('g_e2'), tests.id('task_own')),
  'A task on a goal belongs to that goal''s person.%'
);
select tests.assert_raises(
  format('insert into public.tasks (company_id, title, assignee_id, goal_id) values (%L, %L, %L, %L)',
         tests.company('rba'), 'Sample wrong goal 39', tests.id('t_e2'), tests.id('g_e1')),
  'A task on a goal belongs to that goal''s person.%'
);

-- case: link_refused_for_a_yearly_goal
select tests.assert_raises(
  format('update public.tasks set goal_id = %L where id = %L', tests.id('g_e1_year'), tests.id('task_own')),
  'Only a monthly GSR goal can have tasks.'
);
reset role; select set_config('request.jwt.claims', '', true);

-- case: frozen_month_refuses_a_link_but_allows_unlink
-- Linked while the month was open (system, before the review), then the month completed above.
update public.tasks set goal_id = null where id = tests.id('task_own');
select set_config('hub.task_internal', '1', true);
update public.tasks set goal_id = tests.id('g_e1_frozen') where id = tests.id('task_own');
select set_config('hub.task_internal', '', true);
select tests.act_as(tests.id('t_e1'));
insert into public.tasks (company_id, title, assignee_id)
values (tests.company('rba'), 'Sample second own 39', tests.id('t_e1'));
select tests.assert_raises(
  format('update public.tasks set goal_id = %L where title = %L', tests.id('g_e1_frozen'), 'Sample second own 39'),
  'That month is closed, so its goals take no new tasks.'
);
update public.tasks set goal_id = null where id = tests.id('task_own');
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select goal_id is null from public.tasks where id = tests.id('task_own')),
  'frozen_link: unlinking from a complete month was refused'
);
select tests.act_as(tests.id('t_full'));
update public.review_cycles set status = 'closed' where id = tests.id('c_closed');
select tests.assert_raises(
  format('update public.tasks set goal_id = %L where id = %L', tests.id('g_e1_closed'), tests.id('task_own')),
  'That month is closed, so its goals take no new tasks.'
);
update public.review_cycles set status = 'open' where id = tests.id('c_closed');
reset role; select set_config('request.jwt.claims', '', true);

-- case: assignee_change_refused_while_linked_allowed_with_unlink
select tests.act_as(tests.id('t_full'));
select tests.assert_raises(
  format('update public.tasks set assignee_id = %L where id = %L', tests.id('t_e2'), tests.id('task_mgr')),
  'A task on a goal belongs to that goal''s person. Unlink it before assigning it to someone else.'
);
update public.tasks set assignee_id = tests.id('t_e2'), goal_id = null where id = tests.id('task_mgr');
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select assignee_id = tests.id('t_e2') and goal_id is null from public.tasks where id = tests.id('task_mgr')),
  'assignee_change: unlinking and reassigning in one write was refused'
);

-- case: deleting_the_goal_clears_the_link
select tests.act_as(tests.id('t_full'));
delete from public.goals where id = tests.id('g_e1');
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select goal_id is null from public.tasks where id = tests.id('task_admin'))
  and exists (select 1 from public.tasks where id = tests.id('task_admin')),
  'goal_delete: the task kept a link to a deleted goal, or went with it'
);

-- case: deleting_a_never_signed_in_person_with_linked_tasks
insert into public.profiles (id, email, full_name, company_id, role)
values (gen_random_uuid(), 'sample.roster39@example.com', 'Sample Roster 39', tests.company('rba'), 'employee');
insert into tests.fixture (name, id) select 'roster', id from public.profiles where email = 'sample.roster39@example.com';
insert into public.goals (company_id, employee_id, cycle_id, scope, kind, title)
values (tests.company('rba'), tests.id('roster'), tests.id('c_open'), 'cycle', 'role', 'Sample roster goal 39');
select tests.act_as(tests.id('t_full'));
insert into public.tasks (company_id, title, assignee_id, goal_id)
select tests.company('rba'), 'Sample roster task 39', tests.id('roster'), g.id
  from public.goals g where g.title = 'Sample roster goal 39';
delete from public.profiles where id = tests.id('roster');
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  not exists (select 1 from public.profiles where id = tests.id('roster'))
  and (select assignee_id is null and goal_id is null from public.tasks where title = 'Sample roster task 39'),
  'roster_delete: deleting a person with a linked task failed or left the task linked'
);

-- case: company_move_clears_the_link
select tests.act_as(tests.id('t_full'));
insert into public.tasks (company_id, title, assignee_id, goal_id)
values (tests.company('rba'), 'Sample mover task 39', tests.id('t_mover'), tests.id('g_mover'));
reset role; select set_config('request.jwt.claims', '', true);
update public.profiles set company_id = tests.company('klasik') where id = tests.id('t_mover');
select tests.assert(
  (select assignee_id is null and goal_id is null and company_id = tests.company('rba')
     from public.tasks where title = 'Sample mover task 39'),
  'company_move: a moved person''s task kept its assignee or its link'
);

-- case: recurrence_copy_is_not_linked
select tests.act_as(tests.id('t_e1'));
insert into public.tasks (company_id, title, assignee_id, due_date, recurrence, goal_id)
values (tests.company('rba'), 'Sample weekly 39', tests.id('t_e1'), current_date, 'weekly', tests.id('g_e1_two'));
update public.tasks set completed_at = now() where title = 'Sample weekly 39';
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select count(*) = 2 from public.tasks where title = 'Sample weekly 39')
  and (select goal_id = tests.id('g_e1_two') from public.tasks where title = 'Sample weekly 39' and completed_at is not null)
  and (select goal_id is null from public.tasks where title = 'Sample weekly 39' and completed_at is null),
  'recurrence: the next copy carried the goal link, or the completed one lost it'
);

-- case: division_view_alone_writes_nothing
select tests.act_as(tests.id('t_full'));
insert into public.tasks (company_id, title, assignee_id)
values (tests.company('rba'), 'Sample north task 39', tests.id('t_north_emp')),
       (tests.company('rba'), 'Sample south task 39', tests.id('t_south_emp'));
reset role; select set_config('request.jwt.claims', '', true);
insert into public.task_steps (task_id, title)
select id, 'Sample north step' from public.tasks where title = 'Sample north task 39';
select tests.act_as(tests.id('t_view_mgr'));
select tests.assert(
  exists (select 1 from public.tasks where title = 'Sample north task 39')
  and exists (select 1 from public.task_steps where title = 'Sample north step'),
  'view_only: a manager with a North view cannot read a North employee''s task'
);
select tests.assert_raises(
  format('insert into public.task_steps (task_id, title) select id, %L from public.tasks where title = %L',
         'Sample sneaked step', 'Sample north task 39'),
  'Only the person who assigned this task can change its steps.'
);
select tests.assert(
  tests.rows_of($q$update public.task_steps set title = 'Changed' where title = 'Sample north step'$q$) = 0
  and tests.rows_of($q$update public.task_steps set done_at = now() where title = 'Sample north step'$q$) = 0
  and tests.rows_of($q$update public.tasks set title = 'Changed' where title = 'Sample north task 39'$q$) = 0
  and tests.rows_of($q$delete from public.task_steps where title = 'Sample north step'$q$) = 0,
  'view_only: a manager with only a division view changed a task or its steps'
);
select tests.assert_raises(
  format('insert into public.tasks (company_id, title, assignee_id) values (%L, %L, %L)',
         tests.company('rba'), 'Sample view task 39', tests.id('t_north_emp')),
  'new row violates row-level security policy%'
);
reset role; select set_config('request.jwt.claims', '', true);

-- case: north_admin_cannot_see_south_tasks
select tests.act_as(tests.id('t_north_admin'));
select tests.assert(
  exists (select 1 from public.tasks where title = 'Sample north task 39')
  and not exists (select 1 from public.tasks where title = 'Sample south task 39')
  and not exists (select 1 from public.tasks where assignee_id = tests.id('t_e1')),
  'north_admin: a North admin missed a North task or read a South one'
);
select tests.assert(
  tests.rows_of($q$update public.tasks set title = 'Changed' where title = 'Sample south task 39'$q$) = 0,
  'north_admin: a North admin changed a South task'
);
reset role; select set_config('request.jwt.claims', '', true);

-- case: employee_cannot_read_a_teammates_task
select tests.act_as(tests.id('t_e2'));
select tests.assert(
  not exists (select 1 from public.tasks where assignee_id = tests.id('t_e1'))
  and not exists (select 1 from public.task_steps where task_id = tests.id('task_admin'))
  and exists (select 1 from public.tasks where id = tests.id('task_mgr')),
  'teammate: an employee read a teammate''s task, or missed their own'
);
reset role; select set_config('request.jwt.claims', '', true);

-- case: delete_rules
-- The manager made task_mgr for someone they lead, then it went to t_e2, whom they do not lead.
select tests.act_as(tests.id('t_mgr'));
select tests.assert(
  tests.rows_of(format('delete from public.tasks where id = %L', tests.id('task_mgr'))) = 0
  and tests.rows_of(format('delete from public.tasks where id = %L', tests.id('task_admin'))) = 0,
  'delete: a manager removed a task outside their lead, or one an admin made'
);
insert into public.tasks (company_id, title, assignee_id)
values (tests.company('rba'), 'Sample manager delete 39', tests.id('t_e1'));
select tests.assert(
  tests.rows_of($q$delete from public.tasks where title = 'Sample manager delete 39'$q$) = 1,
  'delete: a manager could not remove a task they made for a report'
);
reset role; select set_config('request.jwt.claims', '', true);
