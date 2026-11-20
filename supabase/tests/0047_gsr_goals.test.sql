-- 0047_gsr_goals.test.sql
-- Proves what hangs off a GSR that stands on its own: its goals point at it through review_id,
-- a goal has one home (a cycle or a GSR, never both, never neither), a goal on a GSR is that
-- GSR's person's and stays inside its company, one focus goal a GSR, the person and their leaders
-- work its goals as they work a month's, a done GSR freezes its goals, notes and new task links
-- with the cycle branch's exemptions until it is reopened, deleting a GSR takes its goals, and a
-- company on periods is held to exactly the goal rules it had.
--
-- Setup moves rba on demand as the SQL editor; klasik stays on periods.
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
-- rba: q_e1 reports to q_mgr; q_peer leads nobody and is led by nobody but the admins.
-- klasik: k_e1, with k_admin.
select tests.create_person('q_admin', tests.company('rba'), 'admin');
select tests.create_person('q_mgr', tests.company('rba'), 'manager');
select tests.create_person('q_e1', tests.company('rba'));
select tests.create_person('q_peer', tests.company('rba'));
select tests.create_person('k_admin', tests.company('klasik'), 'admin');
select tests.create_person('k_e1', tests.company('klasik'));
update public.profiles set view_all_divisions = true
 where id in (tests.id('q_admin'), tests.id('k_admin'));
update public.profiles set reports_to = tests.id('q_mgr') where id = tests.id('q_e1');

select set_config('hub.gsr_on_demand_for', 'rba', true);
update public.companies set gsr_mode = 'on_demand' where id = tests.company('rba');
select set_config('hub.gsr_on_demand_for', '', true);

-- GSRs: q_e1's current one (today) and an earlier one, dated as a conversion dates it; q_peer's.
insert into public.reviews (company_id, employee_id) values
  (tests.company('rba'), tests.id('q_e1')),
  (tests.company('rba'), tests.id('q_peer'));
insert into tests.fixture (name, id)
select case employee_id when tests.id('q_e1') then 'gsr_e1' else 'gsr_peer' end, id
  from public.reviews where employee_id in (tests.id('q_e1'), tests.id('q_peer')) and cycle_id is null;
select set_config('hub.gsr_conversion', '1', true);
insert into public.reviews (company_id, employee_id, status, started_on)
values (tests.company('rba'), tests.id('q_e1'), 'in_progress', '2026-10-01');
select set_config('hub.gsr_conversion', '', true);
insert into tests.fixture (name, id)
select 'gsr_e1_old', id from public.reviews
 where employee_id = tests.id('q_e1') and cycle_id is null and started_on = '2026-10-01';

-- A month in each company, each with a review for its person: rba's to prove a review in a cycle
-- is no GSR for review_id, klasik's for the periods rules.
select set_config('hub.gsr_conversion', '1', true);
insert into public.review_cycles (company_id, name, cadence, period_start, period_end) values
  (tests.company('rba'), 'Sample rba month 47g', 'monthly', '2031-05-01', '2031-05-31'),
  (tests.company('klasik'), 'Sample klasik month 47g', 'monthly', '2031-05-01', '2031-05-31');
select set_config('hub.gsr_conversion', '', true);
insert into tests.fixture (name, id)
select case name when 'Sample rba month 47g' then 'c_r_month' else 'c_k_month' end, id
  from public.review_cycles where name like 'Sample % month 47g';
insert into public.reviews (cycle_id, company_id, employee_id) values
  (tests.id('c_r_month'), tests.company('rba'), tests.id('q_e1')),
  (tests.id('c_k_month'), tests.company('klasik'), tests.id('k_e1'));
insert into tests.fixture (name, id)
select case cycle_id when tests.id('c_r_month') then 'r_r_month' else 'r_k_month' end, id
  from public.reviews where cycle_id in (tests.id('c_r_month'), tests.id('c_k_month'));

-- ---------------------------------------------------------------------------------------
-- One home, one person, one company
-- ---------------------------------------------------------------------------------------

-- case: goal_needs_one_home
select tests.act_as(tests.id('q_admin'));
select tests.assert_raises(
  format($q$insert into public.goals (company_id, employee_id, scope, kind, title)
            values (%L, %L, 'cycle', 'role', 'Sample homeless')$q$,
         tests.company('rba'), tests.id('q_e1')),
  '%goals_home_check%'
);
select tests.assert_raises(
  format($q$insert into public.goals (company_id, employee_id, cycle_id, review_id, scope, kind, title)
            values (%L, %L, %L, %L, 'cycle', 'role', 'Sample two homes')$q$,
         tests.company('rba'), tests.id('q_e1'), tests.id('c_r_month'), tests.id('gsr_e1')),
  '%goals_home_check%'
);
select tests.assert_raises(
  format($q$insert into public.goals (company_id, employee_id, review_id, scope, kind, title, year)
            values (%L, %L, %L, 'year', 'professional', 'Sample yearly on a GSR', 2031)$q$,
         tests.company('rba'), tests.id('q_e1'), tests.id('gsr_e1')),
  '%goals_home_check%'
);
reset role; select set_config('request.jwt.claims', '', true);

-- case: goal_on_a_gsr_is_its_persons
select tests.act_as(tests.id('q_admin'));
select tests.assert_raises(
  format($q$insert into public.goals (company_id, employee_id, review_id, scope, kind, title)
            values (%L, %L, %L, 'cycle', 'role', 'Sample someone else''s')$q$,
         tests.company('rba'), tests.id('q_peer'), tests.id('gsr_e1')),
  'A goal on a GSR belongs to that GSR''s person.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  not exists (select 1 from public.goals where title = 'Sample someone else''s'),
  'gsr_persons: a goal landed on another person''s GSR'
);

-- case: a_goal_follows_its_gsr_across_the_wall
-- Another company's admin reaches an rba GSR neither through one of their own people nor
-- through the GSR's person.
select tests.act_as(tests.id('k_admin'));
select tests.assert_raises(
  format($q$insert into public.goals (company_id, employee_id, review_id, scope, kind, title)
            values (%L, %L, %L, 'cycle', 'role', 'Sample across the wall')$q$,
         tests.company('klasik'), tests.id('k_e1'), tests.id('gsr_e1')),
  'A goal on a GSR belongs to that GSR''s person.'
);
select tests.assert_raises(
  format($q$insert into public.goals (company_id, employee_id, review_id, scope, kind, title)
            values (%L, %L, %L, 'cycle', 'role', 'Sample across the wall')$q$,
         tests.company('klasik'), tests.id('q_e1'), tests.id('gsr_e1')),
  '%row-level security%'
);
reset role; select set_config('request.jwt.claims', '', true);
-- A review in a cycle is no GSR for review_id, whoever writes: an admin, the person, the SQL
-- editor.
select tests.act_as(tests.id('q_admin'));
select tests.assert_raises(
  format($q$insert into public.goals (company_id, employee_id, review_id, scope, kind, title)
            values (%L, %L, %L, 'cycle', 'role', 'Sample on a month review')$q$,
         tests.company('rba'), tests.id('q_e1'), tests.id('r_r_month')),
  'A goal on a GSR belongs to that GSR''s person.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('q_e1'));
select tests.assert_raises(
  format($q$insert into public.goals (company_id, employee_id, review_id, scope, kind, title)
            values (%L, %L, %L, 'cycle', 'role', 'Sample on a month review')$q$,
         tests.company('rba'), tests.id('q_e1'), tests.id('r_r_month')),
  'A goal on a GSR belongs to that GSR''s person.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert_raises(
  format($q$insert into public.goals (company_id, employee_id, review_id, scope, kind, title)
            values (%L, %L, %L, 'cycle', 'role', 'Sample on a month review')$q$,
         tests.company('rba'), tests.id('q_e1'), tests.id('r_r_month')),
  'A goal on a GSR belongs to that GSR''s person.'
);
select tests.assert(
  not exists (select 1 from public.goals where title in ('Sample across the wall', 'Sample on a month review')),
  'across_the_wall: a goal landed on another company''s GSR or on a review in a cycle'
);

-- case: periods_company_has_no_goal_on_a_gsr
-- klasik holds no GSR with no cycle, so nothing a klasik goal names through review_id is one.
select tests.assert(
  not exists (select 1 from public.reviews where company_id = tests.company('klasik') and cycle_id is null),
  'periods_no_gsr: klasik holds a GSR with no cycle'
);
select tests.act_as(tests.id('k_admin'));
select tests.assert_raises(
  format($q$insert into public.goals (company_id, employee_id, review_id, scope, kind, title)
            values (%L, %L, %L, 'cycle', 'role', 'Sample klasik on a review')$q$,
         tests.company('klasik'), tests.id('k_e1'), tests.id('r_k_month')),
  'A goal on a GSR belongs to that GSR''s person.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  not exists (select 1 from public.goals where company_id = tests.company('klasik') and review_id is not null),
  'periods_no_gsr: a klasik goal carries a review_id'
);

-- ---------------------------------------------------------------------------------------
-- Working its goals
-- ---------------------------------------------------------------------------------------

-- case: person_and_leader_work_goals
select tests.act_as(tests.id('q_e1'));
select tests.assert(
  tests.rows_of(format($q$insert into public.goals (company_id, employee_id, review_id, scope, kind, title)
                          values (%L, %L, %L, 'cycle', 'professional', 'Sample own 47g')$q$,
                       tests.company('rba'), tests.id('q_e1'), tests.id('gsr_e1'))) = 1,
  'work_goals: the person could not add a goal to their own GSR'
);
reset role; select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id) select 'g_own', id from public.goals where title = 'Sample own 47g';
select tests.act_as(tests.id('q_e1'));
select tests.assert(
  tests.rows_of(format($q$update public.goals set title = 'Sample own 47g edited', progress = 40 where id = %L$q$,
                       tests.id('g_own'))) = 1,
  'work_goals: the person could not edit their own goal on their GSR'
);
insert into public.goal_notes (goal_id, body) values (tests.id('g_own'), 'Sample own note 47g');
reset role; select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id) select 'n_own', id from public.goal_notes where body = 'Sample own note 47g';

select tests.act_as(tests.id('q_mgr'));
select tests.assert(
  tests.rows_of(format($q$insert into public.goals (company_id, employee_id, review_id, scope, kind, title)
                          values (%L, %L, %L, 'cycle', 'role', 'Sample set 47g')$q$,
                       tests.company('rba'), tests.id('q_e1'), tests.id('gsr_e1'))) = 1,
  'work_goals: a leader could not add a goal to a led person''s GSR'
);
reset role; select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id) select 'g_set', id from public.goals where title = 'Sample set 47g';
select tests.assert(
  (select company_id = tests.company('rba') and review_id = tests.id('gsr_e1') and cycle_id is null
          and created_by = tests.id('q_mgr')
     from public.goals where id = tests.id('g_set')),
  'work_goals: the leader''s goal did not land on the GSR in rba, set by the leader'
);

select tests.act_as(tests.id('q_peer'));
select tests.assert_raises(
  format($q$insert into public.goals (company_id, employee_id, review_id, scope, kind, title)
            values (%L, %L, %L, 'cycle', 'role', 'Sample peer 47g')$q$,
         tests.company('rba'), tests.id('q_e1'), tests.id('gsr_e1')),
  '%row-level security%'
);
select tests.assert(
  tests.rows_of(format($q$update public.goals set title = 'Sample peer took it' where id = %L$q$,
                       tests.id('g_own'))) = 0,
  'work_goals: a peer edited someone else''s GSR goal'
);
reset role; select set_config('request.jwt.claims', '', true);

-- case: one_focus_per_gsr
select tests.act_as(tests.id('q_admin'));
insert into public.goals (company_id, employee_id, review_id, scope, kind, title, is_focus)
values (tests.company('rba'), tests.id('q_e1'), tests.id('gsr_e1_old'), 'cycle', 'role', 'Sample focus 47g', true);
select tests.assert_raises(
  format($q$insert into public.goals (company_id, employee_id, review_id, scope, kind, title, is_focus)
            values (%L, %L, %L, 'cycle', 'role', 'Sample second focus 47g', true)$q$,
         tests.company('rba'), tests.id('q_e1'), tests.id('gsr_e1_old')),
  '%goals_one_focus_per_gsr%'
);
reset role; select set_config('request.jwt.claims', '', true);

-- case: the_person_cannot_move_a_goal_someone_else_set
select tests.act_as(tests.id('q_e1'));
select tests.assert_raises(
  format($q$update public.goals set review_id = %L where id = %L$q$, tests.id('gsr_e1_old'), tests.id('g_set')),
  'This goal was set for you, so only an admin can change what it is.%'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select review_id = tests.id('gsr_e1') from public.goals where id = tests.id('g_set')),
  'cannot_move: the person moved a goal someone else set for them'
);

-- ---------------------------------------------------------------------------------------
-- Frozen when done
-- ---------------------------------------------------------------------------------------

-- case: done_freezes_goals_and_notes
-- Before it is done: a goal on the earlier GSR, carried into this one, and a task linked to a
-- goal on this one (case task_links_to_an_open_gsr_goal).
select tests.act_as(tests.id('q_e1'));
insert into public.goals (company_id, employee_id, review_id, scope, kind, title)
values (tests.company('rba'), tests.id('q_e1'), tests.id('gsr_e1_old'), 'cycle', 'personal', 'Sample source 47g');
reset role; select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id) select 'g_src', id from public.goals where title = 'Sample source 47g';
select tests.act_as(tests.id('q_e1'));
insert into public.goals (company_id, employee_id, review_id, scope, kind, title, carried_from_goal_id)
values (tests.company('rba'), tests.id('q_e1'), tests.id('gsr_e1'), 'cycle', 'personal', 'Sample carried 47g',
        tests.id('g_src'));
reset role; select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id) select 'g_carried', id from public.goals where title = 'Sample carried 47g';

-- case: task_links_to_an_open_gsr_goal
select tests.act_as(tests.id('q_e1'));
select tests.assert(
  tests.rows_of(format($q$insert into public.tasks (company_id, title, assignee_id, goal_id)
                          values (%L, 'Sample task 47g', %L, %L)$q$,
                       tests.company('rba'), tests.id('q_e1'), tests.id('g_own'))) = 1,
  'task_link: a task could not link to a goal of an open GSR'
);
reset role; select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id) select 't_linked', id from public.tasks where title = 'Sample task 47g';

-- A leader marks it done.
select tests.act_as(tests.id('q_mgr'));
select tests.assert(
  tests.rows_of(format($q$update public.reviews
                             set status = 'complete', completed_at = now(), gsr_score = 75, reviewer_id = %L
                           where id = %L$q$, tests.id('q_mgr'), tests.id('gsr_e1'))) = 1,
  'done: a leader could not mark the GSR done'
);
reset role; select set_config('request.jwt.claims', '', true);

-- Goals: no insert, update or delete, nor a move in or out.
select tests.act_as(tests.id('q_mgr'));
select tests.assert_raises(
  format($q$insert into public.goals (company_id, employee_id, review_id, scope, kind, title)
            values (%L, %L, %L, 'cycle', 'role', 'Sample too late 47g')$q$,
         tests.company('rba'), tests.id('q_e1'), tests.id('gsr_e1')),
  'This GSR is done. Reopen it to change its goals.'
);
select tests.assert_raises(
  format($q$update public.goals set title = 'Sample too late' where id = %L$q$, tests.id('g_own')),
  'This GSR is done. Reopen it to change its goals.'
);
select tests.assert_raises(
  format($q$update public.goals set progress = 100 where id = %L$q$, tests.id('g_set')),
  'This GSR is done. Reopen it to change its goals.'
);
select tests.assert_raises(
  format($q$update public.goals set outcome_note = 'Sample why', progress = 100 where id = %L$q$, tests.id('g_set')),
  'This GSR is done. Reopen it to change its goals.'
);
select tests.assert_raises(
  format($q$delete from public.goals where id = %L$q$, tests.id('g_own')),
  'This GSR is done. Reopen it to change its goals.'
);
select tests.assert_raises(
  format($q$update public.goals set review_id = %L where id = %L$q$, tests.id('gsr_e1_old'), tests.id('g_own')),
  'This GSR is done. Reopen it to change its goals.'
);
select tests.assert_raises(
  format($q$update public.goals set review_id = %L where id = %L$q$, tests.id('gsr_e1'), tests.id('g_src')),
  'This GSR is done. Reopen it to change its goals.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('q_admin'));
select tests.assert_raises(
  format($q$delete from public.goals where id = %L$q$, tests.id('g_set')),
  'This GSR is done. Reopen it to change its goals.'
);
reset role; select set_config('request.jwt.claims', '', true);

-- Notes: no insert, update or delete, the author's own included.
select tests.act_as(tests.id('q_mgr'));
select tests.assert_raises(
  format($q$insert into public.goal_notes (goal_id, body) values (%L, 'Sample late note')$q$, tests.id('g_own')),
  'This GSR is done. Reopen it to change its notes.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('q_e1'));
select tests.assert_raises(
  format($q$insert into public.goal_notes (goal_id, body) values (%L, 'Sample late note')$q$, tests.id('g_own')),
  'This GSR is done. Reopen it to change its notes.'
);
select tests.assert_raises(
  format($q$update public.goal_notes set body = 'Sample changed' where id = %L$q$, tests.id('n_own')),
  'This GSR is done. Reopen it to change its notes.'
);
select tests.assert_raises(
  format($q$delete from public.goal_notes where id = %L$q$, tests.id('n_own')),
  'This GSR is done. Reopen it to change its notes.'
);
reset role; select set_config('request.jwt.claims', '', true);

-- The cycle branch's exemptions hold: the why is still written, and a carried-from goal that is
-- gone is cleared.
select tests.act_as(tests.id('q_mgr'));
select tests.assert(
  tests.rows_of(format($q$update public.goals set outcome_note = 'Sample why 47g' where id = %L$q$,
                       tests.id('g_set'))) = 1,
  'done_exempt: the why could not be written on a done GSR'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('q_e1'));
delete from public.goals where id = tests.id('g_src');
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  not exists (select 1 from public.goals where id = tests.id('g_src'))
  and (select carried_from_goal_id is null from public.goals where id = tests.id('g_carried')),
  'done_exempt: the goal it was carried from could not be deleted, or the link was not cleared'
);
select tests.assert(
  (select outcome_note = 'Sample why 47g' and progress = 0 from public.goals where id = tests.id('g_set'))
  and (select title = 'Sample own 47g edited' and progress = 40 from public.goals where id = tests.id('g_own'))
  and (select body = 'Sample own note 47g' from public.goal_notes where id = tests.id('n_own'))
  and (select count(*) = 3 from public.goals where review_id = tests.id('gsr_e1')),
  'done_freezes: something on the done GSR changed'
);

-- case: task_links_to_an_open_gsr_goal (continued)
-- Done, its goals take no new task; the link already made stays, and unlinking passes.
select tests.act_as(tests.id('q_e1'));
select tests.assert_raises(
  format($q$insert into public.tasks (company_id, title, assignee_id, goal_id)
            values (%L, 'Sample late task 47g', %L, %L)$q$,
         tests.company('rba'), tests.id('q_e1'), tests.id('g_own')),
  'That GSR is done, so its goals take no new tasks.'
);
select tests.assert(
  tests.rows_of(format($q$update public.tasks set title = 'Sample task 47g renamed' where id = %L$q$,
                       tests.id('t_linked'))) = 1,
  'task_link: a linked task could not be edited once its GSR was done'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select goal_id = tests.id('g_own') from public.tasks where id = tests.id('t_linked')),
  'task_link: the link made while the GSR was open did not stay'
);

-- case: reopen_thaws
select tests.act_as(tests.id('q_mgr'));
select tests.assert(
  tests.rows_of(format($q$update public.reviews set status = 'in_progress', completed_at = null where id = %L$q$,
                       tests.id('gsr_e1'))) = 1,
  'reopen: a leader could not reopen the GSR'
);
select tests.assert(
  tests.rows_of(format($q$insert into public.goals (company_id, employee_id, review_id, scope, kind, title)
                          values (%L, %L, %L, 'cycle', 'role', 'Sample after reopen 47g')$q$,
                       tests.company('rba'), tests.id('q_e1'), tests.id('gsr_e1'))) = 1,
  'reopen: a goal could not be added once reopened'
);
select tests.assert(
  tests.rows_of(format($q$update public.goals set progress = 100 where id = %L$q$, tests.id('g_set'))) = 1,
  'reopen: a goal could not be edited once reopened'
);
insert into public.goal_notes (goal_id, body) values (tests.id('g_own'), 'Sample leader note 47g');
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('q_e1'));
select tests.assert(
  tests.rows_of(format($q$update public.goal_notes set body = 'Sample own note 47g changed' where id = %L$q$,
                       tests.id('n_own'))) = 1,
  'reopen: a note could not be edited once reopened'
);
select tests.assert(
  tests.rows_of(format($q$insert into public.tasks (company_id, title, assignee_id, goal_id)
                          values (%L, 'Sample task after reopen 47g', %L, %L)$q$,
                       tests.company('rba'), tests.id('q_e1'), tests.id('g_own'))) = 1,
  'reopen: a task could not link once reopened'
);
select tests.assert(
  tests.rows_of(format($q$delete from public.goals where id = %L$q$, tests.id('g_carried'))) = 1,
  'reopen: a goal could not be deleted once reopened'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  exists (select 1 from public.goals where title = 'Sample after reopen 47g')
  and (select progress = 100 from public.goals where id = tests.id('g_set'))
  and exists (select 1 from public.goal_notes where body = 'Sample leader note 47g')
  and not exists (select 1 from public.goals where id = tests.id('g_carried')),
  'reopen: the writes after reopening did not land'
);

-- case: private_stays_private
select tests.act_as(tests.id('q_e1'));
select tests.assert_raises(
  format($q$insert into public.goal_private (goal_id, action_steps) values (%L, '[]')$q$, tests.id('g_own')),
  'A monthly goal keeps its action steps on the goal, where the review reads them.'
);
reset role; select set_config('request.jwt.claims', '', true);

-- case: deleting_a_gsr_takes_its_goals
-- Done again first, so the delete is seen passing the freeze.
select tests.act_as(tests.id('q_mgr'));
update public.reviews set status = 'complete', completed_at = now(), reviewer_id = tests.id('q_mgr')
 where id = tests.id('gsr_e1');
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select status = 'complete' from public.reviews where id = tests.id('gsr_e1')),
  'delete_gsr: the GSR was not done before the delete'
);
select tests.act_as(tests.id('q_admin'));
select tests.assert(
  tests.rows_of(format($q$delete from public.reviews where id = %L$q$, tests.id('gsr_e1'))) = 1,
  'delete_gsr: an admin could not delete the GSR'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  not exists (select 1 from public.goals where review_id = tests.id('gsr_e1'))
  and not exists (select 1 from public.goals where id in (tests.id('g_own'), tests.id('g_set')))
  and not exists (select 1 from public.goal_notes where goal_id = tests.id('g_own'))
  and (select goal_id is null from public.tasks where id = tests.id('t_linked')),
  'delete_gsr: the GSR''s goals or their notes stayed, or a task kept its link'
);
select tests.assert(
  exists (select 1 from public.goals where title = 'Sample focus 47g' and review_id = tests.id('gsr_e1_old')),
  'delete_gsr: another GSR''s goal went with it'
);

-- case: reopening_one_gsr_leaves_another_frozen
-- q_e1 has two GSRs done: the earlier one and a third, dated as a conversion dates it. Reopening
-- the third leaves the earlier one's goals frozen.
select set_config('hub.gsr_conversion', '1', true);
insert into public.reviews (company_id, employee_id, status, started_on)
values (tests.company('rba'), tests.id('q_e1'), 'in_progress', '2026-10-15');
select set_config('hub.gsr_conversion', '', true);
insert into tests.fixture (name, id)
select 'gsr_e1_third', id from public.reviews
 where employee_id = tests.id('q_e1') and cycle_id is null and started_on = '2026-10-15';
insert into tests.fixture (name, id)
select 'g_focus', id from public.goals where title = 'Sample focus 47g';
select tests.act_as(tests.id('q_mgr'));
select tests.assert(
  tests.rows_of(format($q$update public.reviews
                             set status = 'complete', completed_at = now(), gsr_score = 60, reviewer_id = %L
                           where id in (%L, %L)$q$,
                       tests.id('q_mgr'), tests.id('gsr_e1_old'), tests.id('gsr_e1_third'))) = 2,
  'second_frozen: a leader could not mark both GSRs done'
);
select tests.assert(
  tests.rows_of(format($q$update public.reviews set status = 'in_progress', completed_at = null where id = %L$q$,
                       tests.id('gsr_e1_third'))) = 1,
  'second_frozen: a leader could not reopen the third GSR'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('q_admin'));
select tests.assert_raises(
  format($q$update public.goals set title = 'Sample thawed by another' where id = %L$q$, tests.id('g_focus')),
  'This GSR is done. Reopen it to change its goals.'
);
reset role; select set_config('request.jwt.claims', '', true);

-- case: a_goal_cannot_leave_a_done_gsr
-- Not by clearing review_id, nor by moving to a cycle instead.
select tests.act_as(tests.id('q_admin'));
select tests.assert_raises(
  format($q$update public.goals set review_id = null where id = %L$q$, tests.id('g_focus')),
  'This GSR is done. Reopen it to change its goals.'
);
select tests.assert_raises(
  format($q$update public.goals set review_id = null, cycle_id = %L where id = %L$q$,
         tests.id('c_r_month'), tests.id('g_focus')),
  'This GSR is done. Reopen it to change its goals.'
);
reset role; select set_config('request.jwt.claims', '', true);
-- Nor by changing its person in the same write, onto another person's open GSR: only a Rococo
-- admin can change a goal's person, and even they are refused.
select tests.create_person('q_rococo', null, 'employee', true);
select tests.act_as(tests.id('q_rococo'));
select tests.assert_raises(
  format($q$update public.goals set employee_id = %L, review_id = %L where id = %L$q$,
         tests.id('q_peer'), tests.id('gsr_peer'), tests.id('g_focus')),
  'This GSR is done. Reopen it to change its goals.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select review_id = tests.id('gsr_e1_old') and cycle_id is null and title = 'Sample focus 47g'
          and employee_id = tests.id('q_e1')
     from public.goals where id = tests.id('g_focus')),
  'leave_done: a goal left a done GSR, or changed'
);

-- case: the_conversion_flag_is_the_editors_alone
-- A signed-in admin who has hub.gsr_conversion set in their own transaction gets no guard
-- standing aside: a review still stays in its cycle, a done GSR's goals and notes stay frozen, a
-- signed-off GSR stays signed off, and its date stays the company's.
select tests.act_as(tests.id('q_admin'));
select set_config('hub.gsr_conversion', '1', true);
select tests.assert_raises(
  format($q$update public.reviews set cycle_id = null, started_on = '2031-05-01' where id = %L$q$,
         tests.id('r_r_month')),
  'A review in a cycle stays in a cycle, and a GSR on its own stays on its own.'
);
select tests.assert_raises(
  format($q$update public.goals set title = 'Sample flagged 47g' where id = %L$q$, tests.id('g_focus')),
  'This GSR is done. Reopen it to change its goals.'
);
select tests.assert_raises(
  format($q$insert into public.goal_notes (goal_id, body) values (%L, 'Sample flagged note 47g')$q$,
         tests.id('g_focus')),
  'This GSR is done. Reopen it to change its notes.'
);
select tests.assert_raises(
  format($q$update public.reviews set gsr_score = 99 where id = %L$q$, tests.id('gsr_e1_old')),
  'This review is signed off. Reopen it to change it.'
);
update public.reviews set started_on = '2020-01-01' where id = tests.id('gsr_peer');
select set_config('hub.gsr_conversion', '', true);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select cycle_id = tests.id('c_r_month') and started_on is null from public.reviews where id = tests.id('r_r_month'))
  and (select title = 'Sample focus 47g' from public.goals where id = tests.id('g_focus'))
  and not exists (select 1 from public.goal_notes where body = 'Sample flagged note 47g')
  and (select gsr_score = 60 from public.reviews where id = tests.id('gsr_e1_old'))
  and (select started_on = (now() at time zone c.time_zone)::date
         from public.reviews r join public.companies c on c.id = r.company_id where r.id = tests.id('gsr_peer')),
  'flag: a signed-in writer with the flag set got a guard to stand aside'
);

-- case: another_companys_done_gsr_by_id
-- Naming another company's done GSR for one of your own people is the person refusal: it never
-- says whether that GSR is done.
select tests.act_as(tests.id('k_admin'));
select tests.assert_raises(
  format($q$insert into public.goals (company_id, employee_id, review_id, scope, kind, title)
            values (%L, %L, %L, 'cycle', 'role', 'Sample across onto a done GSR')$q$,
         tests.company('klasik'), tests.id('k_e1'), tests.id('gsr_e1_old')),
  'A goal on a GSR belongs to that GSR''s person.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  not exists (select 1 from public.goals where title = 'Sample across onto a done GSR'),
  'done_by_id: a goal landed on another company''s done GSR'
);

-- case: outsiders_learn_nothing_of_a_done_gsr
-- Another company's admin, naming the done GSR's own person, is refused in row level security's
-- words and never told the GSR is done: a goal onto it, a note on its goal, a task on its goal.
-- Updating its goal reaches no row at all (the update policy hides it), so nothing is said.
select tests.act_as(tests.id('k_admin'));
select tests.assert_raises(
  format($q$insert into public.goals (company_id, employee_id, review_id, scope, kind, title)
            values (%L, %L, %L, 'cycle', 'role', 'Sample outsider onto done 47g')$q$,
         tests.company('rba'), tests.id('q_e1'), tests.id('gsr_e1_old')),
  'new row violates row-level security policy for table "goals"'
);
select tests.assert(
  tests.rows_of(format($q$update public.goals set title = 'Sample outsider edit' where id = %L$q$,
                       tests.id('g_focus'))) = 0,
  'outsider_done: another company''s admin reached a goal on a done GSR'
);
select tests.assert_raises(
  format($q$insert into public.goal_notes (goal_id, body) values (%L, 'Sample outsider note 47g')$q$,
         tests.id('g_focus')),
  'new row violates row-level security policy for table "goal_notes"'
);
select tests.assert_raises(
  format($q$insert into public.tasks (company_id, title, assignee_id, goal_id)
            values (%L, 'Sample outsider task 47g', %L, %L)$q$,
         tests.company('rba'), tests.id('q_e1'), tests.id('g_focus')),
  'new row violates row-level security policy for table "tasks"'
);
reset role; select set_config('request.jwt.claims', '', true);
-- An admin of the GSR's company is told why, as before.
select tests.act_as(tests.id('q_admin'));
select tests.assert_raises(
  format($q$insert into public.goals (company_id, employee_id, review_id, scope, kind, title)
            values (%L, %L, %L, 'cycle', 'role', 'Sample admin onto done 47g')$q$,
         tests.company('rba'), tests.id('q_e1'), tests.id('gsr_e1_old')),
  'This GSR is done. Reopen it to change its goals.'
);
select tests.assert_raises(
  format($q$update public.goals set title = 'Sample admin edit' where id = %L$q$, tests.id('g_focus')),
  'This GSR is done. Reopen it to change its goals.'
);
select tests.assert_raises(
  format($q$insert into public.goal_notes (goal_id, body) values (%L, 'Sample admin note 47g')$q$,
         tests.id('g_focus')),
  'This GSR is done. Reopen it to change its notes.'
);
select tests.assert_raises(
  format($q$insert into public.tasks (company_id, title, assignee_id, goal_id)
            values (%L, 'Sample admin task 47g', %L, %L)$q$,
         tests.company('rba'), tests.id('q_e1'), tests.id('g_focus')),
  'That GSR is done, so its goals take no new tasks.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  not exists (select 1 from public.goals where title like 'Sample % onto done 47g')
  and not exists (select 1 from public.goal_notes where body in ('Sample outsider note 47g', 'Sample admin note 47g'))
  and not exists (select 1 from public.tasks where title in ('Sample outsider task 47g', 'Sample admin task 47g'))
  and (select title = 'Sample focus 47g' from public.goals where id = tests.id('g_focus')),
  'outsider_done: a refused write landed'
);

-- case: outsiders_learn_nothing_of_an_open_gsr
-- The same writes onto an open GSR pass the guards and are refused by row level security alone.
select tests.act_as(tests.id('q_admin'));
insert into public.goals (company_id, employee_id, review_id, scope, kind, title)
values (tests.company('rba'), tests.id('q_e1'), tests.id('gsr_e1_third'), 'cycle', 'role', 'Sample open goal 47g');
reset role; select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id) select 'g_open', id from public.goals where title = 'Sample open goal 47g';
select tests.act_as(tests.id('k_admin'));
select tests.assert_raises(
  format($q$insert into public.goals (company_id, employee_id, review_id, scope, kind, title)
            values (%L, %L, %L, 'cycle', 'role', 'Sample outsider onto open 47g')$q$,
         tests.company('rba'), tests.id('q_e1'), tests.id('gsr_e1_third')),
  'new row violates row-level security policy for table "goals"'
);
select tests.assert_raises(
  format($q$insert into public.goal_notes (goal_id, body) values (%L, 'Sample outsider open note 47g')$q$,
         tests.id('g_open')),
  'new row violates row-level security policy for table "goal_notes"'
);
select tests.assert_raises(
  format($q$insert into public.tasks (company_id, title, assignee_id, goal_id)
            values (%L, 'Sample outsider open task 47g', %L, %L)$q$,
         tests.company('rba'), tests.id('q_e1'), tests.id('g_open')),
  'new row violates row-level security policy for table "tasks"'
);
reset role; select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------------------
-- A company on periods, as before
-- ---------------------------------------------------------------------------------------

-- case: cycle_goals_unchanged
select tests.act_as(tests.id('k_admin'));
insert into public.goals (company_id, employee_id, cycle_id, scope, kind, title) values
  (tests.company('klasik'), tests.id('k_e1'), tests.id('c_k_month'), 'cycle', 'role', 'Sample klasik month goal 47g');
insert into public.goals (company_id, employee_id, scope, kind, title, year) values
  (tests.company('klasik'), tests.id('k_e1'), 'year', 'professional', 'Sample klasik year goal 47g', 2031);
reset role; select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id)
select case title when 'Sample klasik month goal 47g' then 'g_k_month' else 'g_k_year' end, id
  from public.goals where title like 'Sample klasik % goal 47g';
select tests.act_as(tests.id('k_admin'));
update public.reviews set status = 'complete', completed_at = now(), gsr_score = 70, reviewer_id = tests.id('k_admin')
 where id = tests.id('r_k_month');
select tests.assert_raises(
  format($q$update public.goals set title = 'Sample too late' where id = %L$q$, tests.id('g_k_month')),
  'This month''s GSR is locked in. Reopen the review to change its goals.'
);
select tests.assert_raises(
  format($q$insert into public.goal_notes (goal_id, body) values (%L, 'Sample late note')$q$, tests.id('g_k_month')),
  'This month''s GSR is locked in. Reopen the review to change its notes.'
);
select tests.assert_raises(
  format($q$insert into public.tasks (company_id, title, assignee_id, goal_id)
            values (%L, 'Sample klasik year task 47g', %L, %L)$q$,
         tests.company('klasik'), tests.id('k_e1'), tests.id('g_k_year')),
  'Only a monthly GSR goal can have tasks.'
);
select tests.assert_raises(
  format($q$insert into public.tasks (company_id, title, assignee_id, goal_id)
            values (%L, 'Sample klasik month task 47g', %L, %L)$q$,
         tests.company('klasik'), tests.id('k_e1'), tests.id('g_k_month')),
  'That month is closed, so its goals take no new tasks.'
);
update public.goals set outcome_note = 'Sample klasik why' where id = tests.id('g_k_month');
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select outcome_note = 'Sample klasik why' and review_id is null and company_id = tests.company('klasik')
     from public.goals where id = tests.id('g_k_month')),
  'cycle_unchanged: the why could not be written on a locked month, or the goal is not the month''s'
);
