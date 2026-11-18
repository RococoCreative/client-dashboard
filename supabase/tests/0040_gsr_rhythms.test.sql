-- 0040_gsr_rhythms.test.sql
-- Proves 0040: a cycle's kind is backfilled once and otherwise follows its cadence, a GSR period
-- is canonical for each rhythm (weekly, every two weeks, monthly, quarterly) and a quarterly GSR
-- and a quarterly review share dates, a member opens a period of their own company and their own
-- review in it only at their rhythm (a second open is nothing), a manager sets only the rhythm of
-- the people they lead and an admin sets anyone's they manage, nobody sets their own, and a
-- manager locks and reopens a led person's GSR (score written, goals frozen, ratings frozen as at
-- an admin's sign-off) but never a scored review, never someone they do not lead and never
-- feedback. A task links only to a GSR goal.
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
                  || '/migrations/0040_gsr_rhythms.sql';
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
  (tests.company('rba'), 'Sample custom 40',  'custom',    '2031-05-05', '2031-06-20'),
  (tests.company('rba'), 'Sample week A 40',  'weekly',    '2031-06-02', '2031-06-08');
insert into tests.fixture (name, id)
select case name when 'Sample month 40' then 'c_month' when 'Sample review 40' then 'c_review'
                 when 'Sample year 40' then 'c_year' when 'Sample custom 40' then 'c_custom'
                 else 'c_week_a' end, id
  from public.review_cycles where name like 'Sample % 40';
select tests.assert(
  (select string_agg(cadence || '=' || kind, ',' order by name) from public.review_cycles where name like 'Sample % 40')
    = 'custom=review,monthly=gsr,quarterly=review,weekly=gsr,annual=review',
  'kind_default: a cycle without a kind did not take it from its cadence'
);

-- case: kind_and_cadence_go_together
select tests.assert_raises(
  format($q$insert into public.review_cycles (company_id, name, kind, cadence, period_start, period_end)
            values (%L, 'Sample bad 40', 'gsr', 'annual', '2032-01-01', '2032-12-31')$q$, tests.company('rba')),
  'A GSR runs weekly, every two weeks, monthly or quarterly.'
);
select tests.assert_raises(
  format($q$insert into public.review_cycles (company_id, name, kind, cadence, period_start, period_end)
            values (%L, 'Sample bad 40', 'review', 'monthly', '2032-01-01', '2032-01-31')$q$, tests.company('rba')),
  'A scored review runs quarterly, yearly or on dates you choose.'
);
select tests.assert_raises(
  format($q$insert into public.review_cycles (company_id, name, kind, cadence, period_start, period_end)
            values (%L, 'Sample bad 40', 'review', 'weekly', '2031-06-02', '2031-06-08')$q$, tests.company('rba')),
  'A scored review runs quarterly, yearly or on dates you choose.'
);

-- ---------------------------------------------------------------------------------------
-- Canonical periods
-- ---------------------------------------------------------------------------------------

-- case: canonical_periods_are_judged_for_each_rhythm
select tests.assert(
  private.gsr_period_ok('weekly', '2031-06-02', '2031-06-08')
  and private.gsr_period_ok('biweekly', '2031-06-09', '2031-06-22')
  and private.gsr_period_ok('biweekly', '2024-01-01', '2024-01-14')
  and private.gsr_period_ok('biweekly', '2023-12-18', '2023-12-31')
  and private.gsr_period_ok('monthly', '2032-02-01', '2032-02-29')
  and private.gsr_period_ok('monthly', '2031-02-01', '2031-02-28')
  and private.gsr_period_ok('quarterly', '2031-10-01', '2031-12-31'),
  'canonical: a canonical period was refused'
);
select tests.assert(
  not private.gsr_period_ok('weekly', '2031-06-03', '2031-06-09')
  and not private.gsr_period_ok('weekly', '2031-06-02', '2031-06-09')
  and not private.gsr_period_ok('biweekly', '2031-06-02', '2031-06-15')
  and not private.gsr_period_ok('biweekly', '2023-12-25', '2024-01-07')
  and not private.gsr_period_ok('monthly', '2031-06-02', '2031-07-01')
  and not private.gsr_period_ok('monthly', '2031-02-01', '2031-03-01')
  and not private.gsr_period_ok('quarterly', '2031-02-01', '2031-04-30')
  and not private.gsr_period_ok('quarterly', '2031-01-01', '2031-04-30')
  and not private.gsr_period_ok('annual', '2031-01-01', '2031-12-31')
  and not private.gsr_period_ok(null, '2031-01-01', '2031-12-31'),
  'canonical: a period that is not canonical was accepted'
);
-- case: periods_match_the_app
-- The periods, refusals and names src/lib/gsr/cycles.test.ts asserts for isCanonicalPeriod and
-- defaultCycleName ("agrees with the database on the periods around a year end..."), so the
-- database and the app cannot drift apart.
select tests.assert(
  (select bool_and(private.gsr_period_ok(c, s::date, e::date)
                   and private.gsr_period_name(c, s::date, e::date) = n)
     from (values
       ('weekly', '2026-12-28', '2027-01-03', 'Dec 28, 2026 to Jan 3, 2027'),
       ('biweekly', '2026-12-14', '2026-12-27', 'Dec 14 to Dec 27, 2026'),
       ('biweekly', '2026-12-28', '2027-01-10', 'Dec 28, 2026 to Jan 10, 2027'),
       ('biweekly', '2027-01-11', '2027-01-24', 'Jan 11 to Jan 24, 2027'),
       ('biweekly', '2023-12-18', '2023-12-31', 'Dec 18 to Dec 31, 2023'),
       ('biweekly', '2024-01-01', '2024-01-14', 'Jan 1 to Jan 14, 2024'),
       ('monthly', '2028-02-01', '2028-02-29', 'February 2028'),
       ('quarterly', '2026-10-01', '2026-12-31', 'Q4 2026')
     ) as v (c, s, e, n)),
  'periods_match_the_app: a period the app computes was refused or named differently'
);
select tests.assert(
  (select bool_and(not private.gsr_period_ok(c, s::date, e::date))
     from (values
       ('weekly', '2026-12-29', '2027-01-04'),
       ('weekly', '2026-12-28', '2027-01-04'),
       ('biweekly', '2027-01-04', '2027-01-17'),
       ('biweekly', '2023-12-25', '2024-01-07'),
       ('biweekly', '2026-12-28', '2027-01-03'),
       ('monthly', '2028-02-01', '2028-02-28'),
       ('quarterly', '2026-10-01', '2026-12-30'),
       ('quarterly', '2026-11-01', '2027-01-31')
     ) as v (c, s, e)),
  'periods_match_the_app: a period the app refuses was accepted'
);

select tests.assert_raises(
  format($q$insert into public.review_cycles (company_id, name, cadence, period_start, period_end)
            values (%L, 'Sample bad 40', 'weekly', '2031-06-03', '2031-06-09')$q$, tests.company('rba')),
  'A weekly GSR runs from a Monday to the Sunday after it.'
);
select tests.assert_raises(
  format($q$insert into public.review_cycles (company_id, name, cadence, period_start, period_end)
            values (%L, 'Sample bad 40', 'weekly', '2031-06-02', '2031-06-09')$q$, tests.company('rba')),
  'A weekly GSR runs from a Monday to the Sunday after it.'
);
select tests.assert_raises(
  format($q$insert into public.review_cycles (company_id, name, cadence, period_start, period_end)
            values (%L, 'Sample bad 40', 'biweekly', '2031-06-02', '2031-06-15')$q$, tests.company('rba')),
  'A GSR every two weeks runs from a Monday to the second Sunday after it, on the shared two-week calendar%'
);
select tests.assert_raises(
  format($q$insert into public.review_cycles (company_id, name, cadence, period_start, period_end)
            values (%L, 'Sample bad 40', 'monthly', '2031-06-15', '2031-07-14')$q$, tests.company('rba')),
  'A monthly GSR runs from the first to the last day of one month.'
);
select tests.assert_raises(
  format($q$insert into public.review_cycles (company_id, name, kind, cadence, period_start, period_end)
            values (%L, 'Sample bad 40', 'gsr', 'quarterly', '2031-02-01', '2031-04-30')$q$, tests.company('rba')),
  'A quarterly GSR runs for one calendar quarter, from its first day to its last.'
);
insert into public.review_cycles (company_id, name, cadence, period_start, period_end)
values (tests.company('rba'), 'Sample two weeks 40', 'biweekly', '2031-06-09', '2031-06-22');
insert into tests.fixture (name, id)
select 'c_two_weeks', id from public.review_cycles where name = 'Sample two weeks 40';

-- case: a_quarterly_gsr_and_a_quarterly_review_share_dates
insert into public.review_cycles (company_id, name, kind, cadence, period_start, period_end)
values (tests.company('rba'), 'Sample quarter GSR 40', 'gsr', 'quarterly', '2031-04-01', '2031-06-30');
insert into tests.fixture (name, id)
select 'c_quarter_gsr', id from public.review_cycles where name = 'Sample quarter GSR 40';
select tests.assert(
  (select count(*) = 2 and count(distinct kind) = 2 from public.review_cycles
    where company_id = tests.company('rba') and cadence = 'quarterly'
      and period_start = '2031-04-01' and period_end = '2031-06-30'),
  'shared_dates: a quarterly GSR and a quarterly review could not share a quarter'
);
select tests.assert_raises(
  format($q$insert into public.review_cycles (company_id, name, kind, cadence, period_start, period_end)
            values (%L, 'Sample twin 40', 'gsr', 'quarterly', '2031-04-01', '2031-06-30')$q$, tests.company('rba')),
  '%review_cycles_kind_period_key%'
);

-- case: a_live_cycle_is_judged_only_when_its_dates_change
-- A GSR cycle written before 0040 with dates that are not a whole period keeps working: it closes
-- and renames, and only a change to its dates is judged.
alter table public.review_cycles disable trigger review_cycles_guard_period;
insert into public.review_cycles (company_id, name, kind, cadence, period_start, period_end)
values (tests.company('rba'), 'Sample legacy 40', 'gsr', 'monthly', '2030-05-03', '2030-06-02');
alter table public.review_cycles enable trigger review_cycles_guard_period;
select tests.act_as(tests.id('w_full'));
update public.review_cycles set status = 'closed', name = 'Sample legacy closed 40' where name = 'Sample legacy 40';
select tests.assert_raises(
  $q$update public.review_cycles set period_end = '2030-06-03' where name = 'Sample legacy closed 40'$q$,
  'A monthly GSR runs from the first to the last day of one month.'
);
select tests.assert_raises(
  format($q$update public.review_cycles set kind = 'review', cadence = 'quarterly' where id = %L$q$, tests.id('c_quarter_gsr')),
  'A cycle''s kind is set when it is made. Start a new cycle instead.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select status = 'closed' from public.review_cycles where name = 'Sample legacy closed 40'),
  'legacy: a live cycle with odd dates could not be closed'
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

-- case: a_manager_sets_only_the_rhythm_of_the_people_they_lead
select tests.act_as(tests.id('w_mgr'));
select tests.assert(
  tests.rows_of(format($q$update public.profiles set gsr_cadence = 'weekly' where id = %L$q$, tests.id('w_e1'))) = 1,
  'manager_rhythm: a manager could not set a led person''s rhythm'
);
select tests.assert(
  tests.rows_of(format($q$update public.profiles set gsr_cadence = 'weekly' where id = %L$q$, tests.id('w_e2'))) = 0,
  'manager_rhythm: a manager set the rhythm of someone they do not lead'
);
select tests.assert_raises(
  format($q$update public.profiles set gsr_cadence = 'weekly' where id = %L$q$, tests.id('w_mgr')),
  'Only admins can change employment details.'
);
select tests.assert_raises(
  format($q$update public.profiles set title = 'Sample title' where id = %L$q$, tests.id('w_e1')),
  'A manager can change only the GSR rhythm of the people they lead.'
);
select tests.assert_raises(
  format($q$update public.profiles set gsr_cadence = 'biweekly', phone = '555-0140' where id = %L$q$, tests.id('w_e1')),
  'A manager can change only the GSR rhythm of the people they lead.'
);
select tests.assert_raises(
  format($q$update public.profiles set reports_to = null where id = %L$q$, tests.id('w_e1')),
  'A manager can change only the GSR rhythm of the people they lead.'
);
reset role; select set_config('request.jwt.claims', '', true);

-- case: nobody_sets_their_own_rhythm
select tests.act_as(tests.id('w_e1'));
select tests.assert_raises(
  format($q$update public.profiles set gsr_cadence = 'monthly' where id = %L$q$, tests.id('w_e1')),
  'Only admins can change employment details.'
);
reset role; select set_config('request.jwt.claims', '', true);

-- case: an_admin_sets_the_rhythm_of_the_people_they_manage
select tests.act_as(tests.id('w_full'));
select tests.assert(
  tests.rows_of(format($q$update public.profiles set gsr_cadence = 'quarterly' where id = %L$q$, tests.id('w_e2'))) = 1,
  'admin_rhythm: an admin could not set a person''s rhythm'
);
select tests.assert_raises(
  format($q$update public.profiles set gsr_cadence = 'daily' where id = %L$q$, tests.id('w_e2')),
  '%profiles_gsr_cadence_check%'
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
-- Opening a period
-- ---------------------------------------------------------------------------------------

-- case: an_employee_opens_their_own_week
-- w_e1 runs weekly. Opening is an insert that ignores a duplicate, then a read, twice over.
select tests.act_as(tests.id('w_e1'));
insert into public.review_cycles (company_id, name, cadence, period_start, period_end)
values (tests.company('rba'), 'Whatever I like', 'weekly', '2031-06-09', '2031-06-15')
on conflict (company_id, kind, cadence, period_start, period_end) do nothing;
insert into public.review_cycles (company_id, name, cadence, period_start, period_end)
values (tests.company('rba'), 'Whatever I like', 'weekly', '2031-06-09', '2031-06-15')
on conflict (company_id, kind, cadence, period_start, period_end) do nothing;
insert into public.reviews (cycle_id, company_id, employee_id)
select c.id, c.company_id, tests.id('w_e1') from public.review_cycles c
 where c.company_id = tests.company('rba') and c.kind = 'gsr' and c.cadence = 'weekly'
   and c.period_start = '2031-06-09'
on conflict (cycle_id, employee_id) do nothing;
insert into public.reviews (cycle_id, company_id, employee_id)
select c.id, c.company_id, tests.id('w_e1') from public.review_cycles c
 where c.company_id = tests.company('rba') and c.kind = 'gsr' and c.cadence = 'weekly'
   and c.period_start = '2031-06-09'
on conflict (cycle_id, employee_id) do nothing;
reset role; select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id)
select 'c_week_b', id from public.review_cycles
 where company_id = tests.company('rba') and kind = 'gsr' and cadence = 'weekly' and period_start = '2031-06-09';
select tests.assert(
  (select count(*) = 1 from public.review_cycles
    where company_id = tests.company('rba') and cadence = 'weekly' and period_start = '2031-06-09')
  and (select name = 'Jun 9 to Jun 15, 2031' and status = 'open' and kind = 'gsr'
              and created_by = tests.user_of(tests.id('w_e1'))
         from public.review_cycles where id = tests.id('c_week_b'))
  and (select count(*) = 1 from public.reviews
        where cycle_id = tests.id('c_week_b') and employee_id = tests.id('w_e1') and status = 'not_started'),
  'employee_opens: the week, its name or the review did not land once'
);
insert into tests.fixture (name, id)
select 'r_week_b', id from public.reviews where cycle_id = tests.id('c_week_b') and employee_id = tests.id('w_e1');

-- case: an_employee_opens_only_at_their_rhythm_and_only_an_open_gsr
select tests.act_as(tests.id('w_e1'));
select tests.assert_raises(
  format($q$insert into public.reviews (cycle_id, company_id, employee_id) values (%L, %L, %L)$q$,
         tests.id('c_month'), tests.company('rba'), tests.id('w_e1')),
  'This person''s GSRs run every week, so this monthly GSR is not theirs. Change their GSR rhythm first.'
);
select tests.assert_raises(
  format($q$insert into public.reviews (cycle_id, company_id, employee_id) values (%L, %L, %L)$q$,
         tests.id('c_review'), tests.company('rba'), tests.id('w_e1')),
  '%row-level security%'
);
select tests.assert_raises(
  format($q$insert into public.review_cycles (company_id, name, cadence, period_start, period_end)
            values (%L, 'Mine', 'quarterly', '2031-07-01', '2031-09-30')$q$, tests.company('rba')),
  '%row-level security%'
);
select tests.assert_raises(
  format($q$insert into public.review_cycles (company_id, name, cadence, period_start, period_end, theme)
            values (%L, 'Mine', 'weekly', '2031-06-16', '2031-06-22', 'My focus')$q$, tests.company('rba')),
  '%row-level security%'
);
select tests.assert_raises(
  format($q$insert into public.review_cycles (company_id, name, cadence, period_start, period_end, status)
            values (%L, 'Mine', 'weekly', '2031-06-16', '2031-06-22', 'closed')$q$, tests.company('rba')),
  '%row-level security%'
);
select tests.assert_raises(
  format($q$insert into public.review_cycles (company_id, name, cadence, period_start, period_end)
            values (%L, 'Mine', 'weekly', '2031-06-17', '2031-06-23')$q$, tests.company('rba')),
  'A weekly GSR runs from a Monday to the Sunday after it.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('w_k_emp'));
select tests.assert_raises(
  format($q$insert into public.review_cycles (company_id, name, cadence, period_start, period_end)
            values (%L, 'Theirs', 'weekly', '2031-06-16', '2031-06-22')$q$, tests.company('rba')),
  '%row-level security%'
);
reset role; select set_config('request.jwt.claims', '', true);

-- case: a_leader_opens_a_led_persons_week_and_an_admin_keeps_to_the_rhythm_too
select tests.act_as(tests.id('w_mgr'));
insert into public.reviews (cycle_id, company_id, employee_id)
values (tests.id('c_week_a'), tests.company('rba'), tests.id('w_e1'))
on conflict (cycle_id, employee_id) do nothing;
select tests.assert_raises(
  format($q$insert into public.reviews (cycle_id, company_id, employee_id) values (%L, %L, %L)$q$,
         tests.id('c_month'), tests.company('rba'), tests.id('w_e1')),
  'This person''s GSRs run every week, so this monthly GSR is not theirs.%'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('w_full'));
select tests.assert_raises(
  format($q$insert into public.reviews (cycle_id, company_id, employee_id) values (%L, %L, %L)$q$,
         tests.id('c_month'), tests.company('rba'), tests.id('w_e1')),
  'This person''s GSRs run every week, so this monthly GSR is not theirs.%'
);
insert into public.reviews (cycle_id, company_id, employee_id)
values (tests.id('c_month'), tests.company('rba'), tests.id('w_mgr'));
insert into public.reviews (cycle_id, company_id, employee_id)
values (tests.id('c_quarter_gsr'), tests.company('rba'), tests.id('w_e2'));
insert into public.reviews (cycle_id, company_id, employee_id)
values (tests.id('c_review'), tests.company('rba'), tests.id('w_e1'));
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  exists (select 1 from public.reviews where cycle_id = tests.id('c_week_a') and employee_id = tests.id('w_e1'))
  and exists (select 1 from public.reviews where cycle_id = tests.id('c_quarter_gsr') and employee_id = tests.id('w_e2'))
  and exists (select 1 from public.reviews where cycle_id = tests.id('c_review') and employee_id = tests.id('w_e1')),
  'opening: a review at the right rhythm, or a scored review, did not open'
);

-- ---------------------------------------------------------------------------------------
-- Locking
-- ---------------------------------------------------------------------------------------

-- case: a_manager_locks_and_reopens_a_led_persons_week
insert into public.gsr_pillars (company_id, name, weight, scoring_type)
values (tests.company('rba'), 'Sample ratings 40', 0, 'rating');
insert into tests.fixture (name, id)
select 'p_rating', id from public.gsr_pillars where name = 'Sample ratings 40';
insert into public.gsr_criteria (pillar_id, company_id, name)
values (tests.id('p_rating'), tests.company('rba'), 'Sample criterion 40');
insert into tests.fixture (name, id)
select 'k_crit', id from public.gsr_criteria where name = 'Sample criterion 40';
insert into public.impact_scores (company_id, employee_id, pillar_id, criterion_id, rating)
values (tests.company('rba'), tests.id('w_e1'), tests.id('p_rating'), tests.id('k_crit'), 3);

select tests.act_as(tests.id('w_e1'));
insert into public.goals (company_id, employee_id, cycle_id, scope, kind, title)
values (tests.company('rba'), tests.id('w_e1'), tests.id('c_week_b'), 'cycle', 'role', 'Sample weekly goal 40');
select tests.assert_raises(
  format($q$update public.reviews set status = 'complete', completed_at = now() where id = %L$q$, tests.id('r_week_b')),
  'Only admins can edit review scores, status, and feedback.'
);
reset role; select set_config('request.jwt.claims', '', true);

select tests.act_as(tests.id('w_mgr'));
select tests.assert(
  tests.rows_of(format($q$update public.reviews
                            set status = 'complete', completed_at = now(), gsr_score = 80, reviewer_id = %L
                          where id = %L$q$, tests.id('w_mgr'), tests.id('r_week_b'))) = 1,
  'manager_lock: a manager could not lock a led person''s week'
);
select tests.assert_raises(
  format($q$update public.goals set progress = 50 where title = 'Sample weekly goal 40'$q$),
  'This month''s GSR is locked in. Reopen the review to change its goals.'
);
select tests.assert_raises(
  format($q$update public.reviews set manager_feedback = 'Mine to say' where id = %L$q$, tests.id('r_week_b')),
  'A manager can lock and reopen a GSR, and nothing else on it.'
);
select tests.assert_raises(
  format($q$update public.reviews set employee_reflection = 'In their words' where id = %L$q$, tests.id('r_week_b')),
  'A manager can lock and reopen a GSR, and nothing else on it.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select status = 'complete' and gsr_score = 80 and reviewer_id = tests.id('w_mgr') and manager_feedback is null
     from public.reviews where id = tests.id('r_week_b'))
  and exists (select 1 from public.review_scores
               where review_id = tests.id('r_week_b') and criterion_id = tests.id('k_crit') and rating = 3)
  and coalesce(current_setting('hub.freezing_review', true), '') = '',
  'manager_lock: the score, the reviewer or the frozen rating did not land'
);

select tests.act_as(tests.id('w_mgr'));
select tests.assert(
  tests.rows_of(format($q$update public.reviews set status = 'in_progress', completed_at = null where id = %L$q$,
                       tests.id('r_week_b'))) = 1,
  'manager_reopen: a manager could not reopen a led person''s week'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select status = 'in_progress' and gsr_score is null from public.reviews where id = tests.id('r_week_b')),
  'manager_reopen: reopening did not release the score'
);
select tests.act_as(tests.id('w_e1'));
update public.goals set progress = 50 where title = 'Sample weekly goal 40';
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select progress = 50 from public.goals where title = 'Sample weekly goal 40'),
  'manager_reopen: the week''s goals stayed frozen after it reopened'
);

-- case: a_manager_never_locks_a_scored_review_or_someone_they_do_not_lead
select tests.act_as(tests.id('w_mgr'));
select tests.assert(
  tests.rows_of(format($q$update public.reviews set status = 'complete', completed_at = now()
                          where cycle_id = %L and employee_id = %L$q$, tests.id('c_review'), tests.id('w_e1'))) = 0,
  'manager_scored: a manager locked a scored review'
);
select tests.assert(
  tests.rows_of(format($q$update public.reviews set status = 'complete', completed_at = now(), gsr_score = 70
                          where cycle_id = %L and employee_id = %L$q$, tests.id('c_quarter_gsr'), tests.id('w_e2'))) = 0,
  'manager_not_led: a manager locked the GSR of someone they do not lead'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select status <> 'complete' from public.reviews where cycle_id = tests.id('c_review') and employee_id = tests.id('w_e1'))
  and (select status <> 'complete' from public.reviews where cycle_id = tests.id('c_quarter_gsr') and employee_id = tests.id('w_e2')),
  'manager_limits: a review the manager may not lock is complete'
);

-- case: a_managers_lock_keeps_the_0039_rules
-- Leaving a person out of a week stops its sign-off for a manager as for an admin.
insert into public.cycle_omissions (cycle_id, employee_id, company_id)
values (tests.id('c_week_a'), tests.id('w_e1'), tests.company('rba'));
select tests.act_as(tests.id('w_mgr'));
select tests.assert_raises(
  format($q$update public.reviews set status = 'complete', completed_at = now()
             where cycle_id = %L and employee_id = %L$q$, tests.id('c_week_a'), tests.id('w_e1')),
  'This person is not part of this cycle. Add them back on the cycle page first.'
);
reset role; select set_config('request.jwt.claims', '', true);

-- case: a_review_already_there_opens_whatever_the_rhythm_becomes
select tests.act_as(tests.id('w_full'));
update public.profiles set gsr_cadence = 'biweekly' where id = tests.id('w_e1');
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('w_e1'));
insert into public.reviews (cycle_id, company_id, employee_id)
values (tests.id('c_week_b'), tests.company('rba'), tests.id('w_e1'))
on conflict (cycle_id, employee_id) do nothing;
insert into public.reviews (cycle_id, company_id, employee_id)
values (tests.id('c_two_weeks'), tests.company('rba'), tests.id('w_e1'))
on conflict (cycle_id, employee_id) do nothing;
select tests.assert_raises(
  format($q$insert into public.reviews (cycle_id, company_id, employee_id) values (%L, %L, %L)$q$,
         tests.id('c_month'), tests.company('rba'), tests.id('w_e1')),
  'This person''s GSRs run every two weeks, so this monthly GSR is not theirs.%'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  exists (select 1 from public.reviews where cycle_id = tests.id('c_two_weeks') and employee_id = tests.id('w_e1')),
  'rhythm_change: the person could not open a period at their new rhythm'
);

-- case: a_complete_weekly_gsr_freezes_its_goals_without_a_score
select tests.act_as(tests.id('w_full'));
update public.reviews set status = 'complete', completed_at = now() where id = tests.id('r_week_b');
select tests.assert(
  (select gsr_score is null from public.reviews where id = tests.id('r_week_b')),
  'weekly_freeze: the week was scored, so this case proves nothing'
);
select tests.assert_raises(
  $q$update public.goals set progress = 60 where title = 'Sample weekly goal 40'$q$,
  'This month''s GSR is locked in. Reopen the review to change its goals.'
);
update public.reviews set status = 'in_progress', completed_at = null where id = tests.id('r_week_b');
reset role; select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------------------

-- case: a_task_links_only_to_a_gsr_goal
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
select tests.company('rba'), 'Sample weekly task 40', tests.id('w_e1'), g.id
  from public.goals g where g.title = 'Sample weekly goal 40';
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  exists (select 1 from public.tasks t join public.goals g on g.id = t.goal_id
           where t.title = 'Sample weekly task 40' and g.title = 'Sample weekly goal 40'),
  'task_link: a task could not link to a weekly GSR goal'
);

-- case: no_policy_reads_monthly_as_gsr
select tests.assert(
  not exists (select 1 from pg_policies
               where schemaname = 'public'
                 and (coalesce(qual, '') ~ 'cadence = ''monthly'''
                      or coalesce(with_check, '') ~ 'cadence = ''monthly''')),
  'leftover: a policy still reads monthly as a GSR'
);
