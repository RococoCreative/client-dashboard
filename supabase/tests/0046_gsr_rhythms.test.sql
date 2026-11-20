-- 0046_gsr_rhythms.test.sql
-- Proves what 0046 still holds once 0047 has taken back what it put on every company: a cycle's
-- kind is backfilled once and otherwise follows its cadence, everyone starts monthly, nobody sets
-- their own rhythm and an admin sets anyone's they manage (audited), a person and their leader
-- open the person's review in a GSR month (a second open is nothing) but never in a scored
-- review, a manager in a company on periods never locks a review, a complete GSR freezes its
-- goals without a score, and a task links only to a GSR goal.
--
-- 0047 took back the weekly, two-week and quarterly GSR periods, the whole-period rule, a member
-- opening a period, the rhythm deciding whose GSR a cycle holds, a manager locking a GSR that
-- sits in a cycle and a manager setting a rhythm in a company on periods; their cases moved to
-- 0047_gsr_wall.test.sql (and, for a manager's lock, to the GSR with no cycle).
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

-- Setup, as system. w_e1 reports to w_mgr; nobody leads w_e2 but the admin.
select tests.create_person('w_full', tests.company('rba'), 'admin');
select tests.create_person('w_mgr', tests.company('rba'), 'manager');
select tests.create_person('w_e1', tests.company('rba'));
select tests.create_person('w_e2', tests.company('rba'));
select tests.create_person('w_k_emp', tests.company('klasik'));
update public.profiles set view_all_divisions = true where id = tests.id('w_full');
update public.profiles set reports_to = tests.id('w_mgr') where id = tests.id('w_e1');

-- ---------------------------------------------------------------------------------------
-- Kind
-- ---------------------------------------------------------------------------------------

-- case: the_kind_backfill_runs_once
-- The migration's own backfill block, read from the harness's copy, run against a stand-in table
-- holding a live-shaped set of cycles: monthly becomes a GSR, everything else a review. Run again
-- it changes nothing, and run against review_cycles itself (the column exists) it does nothing.
create table tests.cycles_copy (id serial primary key, cadence text not null);
insert into tests.cycles_copy (cadence) values ('monthly'), ('quarterly'), ('annual'), ('custom');
do $$
declare
  v_file  text := regexp_replace(current_setting('data_directory'), '/data$', '')
                  || '/migrations/0046_gsr_rhythms.sql';
  v_block text;
begin
  v_block := substring(pg_read_file(v_file) from '-- backfill:start\s*(do \$\$.*end \$\$);\s*-- backfill:end');
  if v_block is null then
    raise exception 'backfill_once: the backfill block was not found in %', v_file;
  end if;
  execute replace(v_block, 'public.review_cycles', 'tests.cycles_copy');
  update tests.cycles_copy set kind = 'gsr' where cadence = 'quarterly';
  execute replace(v_block, 'public.review_cycles', 'tests.cycles_copy');
  execute v_block;
end;
$$;
select tests.assert(
  (select string_agg(cadence || '=' || kind, ',' order by id) from tests.cycles_copy)
    = 'monthly=gsr,quarterly=gsr,annual=review,custom=review',
  'backfill_once: monthly did not become a GSR, the rest reviews, or a second paste rewrote a kind'
);

-- case: kind_follows_cadence_when_left_out
insert into public.review_cycles (company_id, name, cadence, period_start, period_end) values
  (tests.company('rba'), 'Sample month 40',   'monthly',   '2031-06-01', '2031-06-30'),
  (tests.company('rba'), 'Sample review 40',  'quarterly', '2031-04-01', '2031-06-30'),
  (tests.company('rba'), 'Sample year 40',    'annual',    '2031-01-01', '2031-12-31'),
  (tests.company('rba'), 'Sample custom 40',  'custom',    '2031-05-05', '2031-06-20');
insert into tests.fixture (name, id)
select case name when 'Sample month 40' then 'c_month' when 'Sample review 40' then 'c_review'
                 when 'Sample year 40' then 'c_year' else 'c_custom' end, id
  from public.review_cycles where name like 'Sample % 40';
select tests.assert(
  (select string_agg(cadence || '=' || kind, ',' order by name) from public.review_cycles where name like 'Sample % 40')
    = 'custom=review,monthly=gsr,quarterly=review,annual=review',
  'kind_default: a cycle without a kind did not take it from its cadence'
);

-- ---------------------------------------------------------------------------------------
-- Rhythm
-- ---------------------------------------------------------------------------------------

-- case: everyone_starts_monthly
select tests.assert(
  (select bool_and(gsr_cadence = 'monthly') from public.profiles
    where id in (tests.id('w_full'), tests.id('w_mgr'), tests.id('w_e1'), tests.id('w_e2'))),
  'rhythm_default: a person did not start monthly'
);

-- case: nobody_sets_their_own_rhythm
-- w_e1 is still monthly here (the manager no longer set them weekly first), so the change asked
-- for is to weekly.
select tests.act_as(tests.id('w_e1'));
select tests.assert_raises(
  format($q$update public.profiles set gsr_cadence = 'weekly' where id = %L$q$, tests.id('w_e1')),
  'Only admins can change employment details.'
);
reset role; select set_config('request.jwt.claims', '', true);

-- case: an_admin_sets_the_rhythm_of_the_people_they_manage
-- w_e1's weekly rhythm was a manager's to set until 0047 kept that to companies on demand
-- (0047_gsr_wall.test.sql); here the admin sets it.
select tests.act_as(tests.id('w_full'));
select tests.assert(
  tests.rows_of(format($q$update public.profiles set gsr_cadence = 'quarterly' where id = %L$q$, tests.id('w_e2'))) = 1,
  'admin_rhythm: an admin could not set a person''s rhythm'
);
select tests.assert(
  tests.rows_of(format($q$update public.profiles set gsr_cadence = 'weekly' where id = %L$q$, tests.id('w_e1'))) = 1,
  'admin_rhythm: an admin could not set a led person''s rhythm'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select gsr_cadence = 'weekly' and title is distinct from 'Sample title' and reports_to = tests.id('w_mgr')
     from public.profiles where id = tests.id('w_e1'))
  and (select gsr_cadence = 'quarterly' from public.profiles where id = tests.id('w_e2'))
  and (select gsr_cadence = 'monthly' from public.profiles where id = tests.id('w_mgr')),
  'rhythm: the rhythms did not land as set'
);
select tests.assert(
  exists (select 1 from public.audit_events
           where table_name = 'profiles' and row_id = tests.id('w_e1')::text
             and changed ? 'gsr_cadence'
             and changed->'gsr_cadence'->>'new' = 'weekly'),
  'rhythm_audit: a rhythm change was not audited'
);


-- ---------------------------------------------------------------------------------------
-- Opening a review
-- ---------------------------------------------------------------------------------------

-- case: an_employee_opens_their_own_month
-- Re-homed on a month from an_employee_opens_their_own_week and
-- an_employee_opens_only_at_their_rhythm_and_only_an_open_gsr. w_e1 runs weekly, which no longer
-- decides anything. Opening is an insert that ignores a duplicate, then a read, twice over; a
-- scored review is never theirs to open.
select tests.act_as(tests.id('w_e1'));
insert into public.reviews (cycle_id, company_id, employee_id)
values (tests.id('c_month'), tests.company('rba'), tests.id('w_e1'))
on conflict (cycle_id, employee_id) do nothing;
insert into public.reviews (cycle_id, company_id, employee_id)
values (tests.id('c_month'), tests.company('rba'), tests.id('w_e1'))
on conflict (cycle_id, employee_id) do nothing;
select tests.assert_raises(
  format($q$insert into public.reviews (cycle_id, company_id, employee_id) values (%L, %L, %L)$q$,
         tests.id('c_review'), tests.company('rba'), tests.id('w_e1')),
  '%row-level security%'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select count(*) = 1 from public.reviews
    where cycle_id = tests.id('c_month') and employee_id = tests.id('w_e1') and status = 'not_started'),
  'employee_opens: the review did not land once'
);
insert into tests.fixture (name, id)
select 'r_month_e1', id from public.reviews where cycle_id = tests.id('c_month') and employee_id = tests.id('w_e1');

-- case: a_leader_opens_a_led_persons_month
-- Re-homed on a month from a_leader_opens_a_led_persons_week_and_an_admin_keeps_to_the_rhythm_too.
insert into public.review_cycles (company_id, name, cadence, period_start, period_end)
values (tests.company('rba'), 'Sample month B 40', 'monthly', '2031-07-01', '2031-07-31');
insert into tests.fixture (name, id)
select 'c_month_b', id from public.review_cycles where name = 'Sample month B 40';
select tests.act_as(tests.id('w_mgr'));
insert into public.reviews (cycle_id, company_id, employee_id)
values (tests.id('c_month_b'), tests.company('rba'), tests.id('w_e1'))
on conflict (cycle_id, employee_id) do nothing;
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('w_full'));
insert into public.reviews (cycle_id, company_id, employee_id)
values (tests.id('c_month'), tests.company('rba'), tests.id('w_mgr'));
insert into public.reviews (cycle_id, company_id, employee_id)
values (tests.id('c_month'), tests.company('rba'), tests.id('w_e2'));
insert into public.reviews (cycle_id, company_id, employee_id)
values (tests.id('c_review'), tests.company('rba'), tests.id('w_e1'));
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  exists (select 1 from public.reviews where cycle_id = tests.id('c_month_b') and employee_id = tests.id('w_e1'))
  and exists (select 1 from public.reviews where cycle_id = tests.id('c_month') and employee_id = tests.id('w_e2'))
  and exists (select 1 from public.reviews where cycle_id = tests.id('c_review') and employee_id = tests.id('w_e1')),
  'opening: a GSR or a scored review did not open'
);

-- ---------------------------------------------------------------------------------------
-- Locking
-- ---------------------------------------------------------------------------------------

-- case: a_manager_never_locks_a_scored_review_or_someone_they_do_not_lead
-- Re-homed: the GSR of someone the manager does not lead is now a month (it was a quarterly GSR).
select tests.act_as(tests.id('w_mgr'));
select tests.assert(
  tests.rows_of(format($q$update public.reviews set status = 'complete', completed_at = now()
                          where cycle_id = %L and employee_id = %L$q$, tests.id('c_review'), tests.id('w_e1'))) = 0,
  'manager_scored: a manager locked a scored review'
);
select tests.assert(
  tests.rows_of(format($q$update public.reviews set status = 'complete', completed_at = now(), gsr_score = 70
                          where cycle_id = %L and employee_id = %L$q$, tests.id('c_month'), tests.id('w_e2'))) = 0,
  'manager_not_led: a manager locked the GSR of someone they do not lead'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select status <> 'complete' from public.reviews where cycle_id = tests.id('c_review') and employee_id = tests.id('w_e1'))
  and (select status <> 'complete' from public.reviews where cycle_id = tests.id('c_month') and employee_id = tests.id('w_e2')),
  'manager_limits: a review the manager may not lock is complete'
);

-- case: a_complete_monthly_gsr_freezes_its_goals_without_a_score
-- Re-homed on a month from a_complete_weekly_gsr_freezes_its_goals_without_a_score.
select tests.act_as(tests.id('w_e1'));
insert into public.goals (company_id, employee_id, cycle_id, scope, kind, title)
values (tests.company('rba'), tests.id('w_e1'), tests.id('c_month'), 'cycle', 'role', 'Sample monthly goal 40');
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('w_full'));
update public.reviews set status = 'complete', completed_at = now() where id = tests.id('r_month_e1');
select tests.assert(
  (select gsr_score is null from public.reviews where id = tests.id('r_month_e1')),
  'monthly_freeze: the month was scored, so this case proves nothing'
);
select tests.assert_raises(
  $q$update public.goals set progress = 60 where title = 'Sample monthly goal 40'$q$,
  'This month''s GSR is locked in. Reopen the review to change its goals.'
);
update public.reviews set status = 'in_progress', completed_at = null where id = tests.id('r_month_e1');
reset role; select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------------------

-- case: a_task_links_only_to_a_gsr_goal
-- Re-homed: the GSR goal it links to is a month's (it was a week's).
insert into public.goals (company_id, employee_id, cycle_id, scope, kind, title)
values (tests.company('rba'), tests.id('w_e1'), tests.id('c_review'), 'cycle', 'role', 'Sample review goal 40');
select tests.act_as(tests.id('w_full'));
select tests.assert_raises(
  format($q$insert into public.tasks (company_id, title, assignee_id, goal_id)
            select %L, 'Sample task 40', %L, g.id from public.goals g where g.title = 'Sample review goal 40'$q$,
         tests.company('rba'), tests.id('w_e1')),
  'Only a monthly GSR goal can have tasks.'
);
insert into public.tasks (company_id, title, assignee_id, goal_id)
select tests.company('rba'), 'Sample monthly task 40', tests.id('w_e1'), g.id
  from public.goals g where g.title = 'Sample monthly goal 40';
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  exists (select 1 from public.tasks t join public.goals g on g.id = t.goal_id
           where t.title = 'Sample monthly task 40' and g.title = 'Sample monthly goal 40'),
  'task_link: a task could not link to a monthly GSR goal'
);

-- case: no_policy_reads_monthly_as_gsr
select tests.assert(
  not exists (select 1 from pg_policies
               where schemaname = 'public'
                 and (coalesce(qual, '') ~ 'cadence = ''monthly'''
                      or coalesce(with_check, '') ~ 'cadence = ''monthly''')),
  'leftover: a policy still reads monthly as a GSR'
);
