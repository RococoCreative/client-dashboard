-- 0047_gsr_standalone.test.sql
-- Proves a GSR that stands on its own, with no cycle, in a company on demand: only such a company
-- holds one, the person, anyone who leads them and an admin who manages them start it, the
-- database stamps its dates in the company's time zone, a person has one a day and two open at
-- most, a leader marks it done and reopens it and changes nothing else on it, nobody closes their
-- own whatever their role (nor takes someone else's to close it), it stays with its person and
-- its company, a writer refused by row level security learns nothing first, it is read through
-- the same wall as every review, and a review in a
-- cycle in a company on periods is exactly what it was.
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
-- rba: s_e1 and s_e4 report to s_mgr; nobody leads s_e2, s_e5 or s_e6 but the admins. s_mgr2 is a
-- manager who reports to s_lead (an admin who sees no division beyond their own reach), and s_e3
-- reports to s_mgr2. s_e7 and s_e8 carry the open-GSR limit.
-- klasik: k_e1 reports to k_mgr.
select tests.create_person('s_owner', tests.company('rba'), 'owner');
select tests.create_person('s_admin', tests.company('rba'), 'admin');
select tests.create_person('s_lead', tests.company('rba'), 'admin');
select tests.create_person('s_mgr', tests.company('rba'), 'manager');
select tests.create_person('s_mgr2', tests.company('rba'), 'manager');
select tests.create_person('s_e1', tests.company('rba'));
select tests.create_person('s_e2', tests.company('rba'));
select tests.create_person('s_e3', tests.company('rba'));
select tests.create_person('s_e4', tests.company('rba'));
select tests.create_person('s_e5', tests.company('rba'));
select tests.create_person('s_e6', tests.company('rba'));
select tests.create_person('s_e7', tests.company('rba'));
select tests.create_person('s_e8', tests.company('rba'));
select tests.create_person('k_admin', tests.company('klasik'), 'admin');
select tests.create_person('k_mgr', tests.company('klasik'), 'manager');
select tests.create_person('k_e1', tests.company('klasik'));
select tests.create_person('s_rococo', null, 'employee', true);
update public.profiles set view_all_divisions = true
 where id in (tests.id('s_owner'), tests.id('s_admin'), tests.id('k_admin'));
update public.profiles set reports_to = tests.id('s_mgr') where id in (tests.id('s_e1'), tests.id('s_e4'));
update public.profiles set reports_to = tests.id('s_lead') where id = tests.id('s_mgr2');
update public.profiles set reports_to = tests.id('s_mgr2') where id = tests.id('s_e3');
update public.profiles set reports_to = tests.id('k_mgr') where id = tests.id('k_e1');

-- A zone a whole day ahead of most of the world, so a date taken from anywhere else shows.
update public.companies set time_zone = 'Pacific/Kiritimati' where id = tests.company('rba');

select set_config('hub.gsr_on_demand_for', 'rba', true);
update public.companies set gsr_mode = 'on_demand' where id = tests.company('rba');
select set_config('hub.gsr_on_demand_for', '', true);

-- ---------------------------------------------------------------------------------------
-- Only a company on demand
-- ---------------------------------------------------------------------------------------

-- case: periods_company_refuses_a_gsr
select tests.act_as(tests.id('k_admin'));
select tests.assert_raises(
  format($q$insert into public.reviews (company_id, employee_id) values (%L, %L)$q$,
         tests.company('klasik'), tests.id('k_e1')),
  'GSRs on demand are not turned on for this company.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('k_mgr'));
select tests.assert_raises(
  format($q$insert into public.reviews (company_id, employee_id) values (%L, %L)$q$,
         tests.company('klasik'), tests.id('k_e1')),
  'GSRs on demand are not turned on for this company.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('k_e1'));
select tests.assert_raises(
  format($q$insert into public.reviews (company_id, employee_id) values (%L, %L)$q$,
         tests.company('klasik'), tests.id('k_e1')),
  'GSRs on demand are not turned on for this company.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  not exists (select 1 from public.reviews where company_id = tests.company('klasik') and cycle_id is null),
  'periods_refuses: a company on periods holds a GSR with no cycle'
);

-- ---------------------------------------------------------------------------------------
-- Starting one
-- ---------------------------------------------------------------------------------------

-- case: person_starts_their_own
select tests.act_as(tests.id('s_e1'));
select tests.assert(
  tests.rows_of(format($q$insert into public.reviews (company_id, employee_id) values (%L, %L)$q$,
                       tests.company('rba'), tests.id('s_e1'))) = 1,
  'person_starts: the person could not start their own GSR'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select count(*) = 1 and bool_and(company_id = tests.company('rba')) and bool_and(status = 'not_started')
     from public.reviews where employee_id = tests.id('s_e1') and cycle_id is null),
  'person_starts: the GSR did not land once, with no cycle, in rba'
);
insert into tests.fixture (name, id)
select 'g_e1', id from public.reviews where employee_id = tests.id('s_e1') and cycle_id is null;

-- case: leader_starts_for_a_report
select tests.act_as(tests.id('s_mgr'));
select tests.assert(
  tests.rows_of(format($q$insert into public.reviews (company_id, employee_id) values (%L, %L)$q$,
                       tests.company('rba'), tests.id('s_e4'))) = 1,
  'leader_starts: a manager could not start a GSR for someone they lead'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select count(*) = 1 and bool_and(company_id = tests.company('rba'))
     from public.reviews where employee_id = tests.id('s_e4') and cycle_id is null),
  'leader_starts: the GSR did not land once, with no cycle, in rba'
);
insert into tests.fixture (name, id)
select 'g_e4', id from public.reviews where employee_id = tests.id('s_e4') and cycle_id is null;

-- case: admin_starts_for_someone_they_manage
-- The company is sent wrong on purpose: it comes from the person.
select tests.act_as(tests.id('s_admin'));
select tests.assert(
  tests.rows_of(format($q$insert into public.reviews (employee_id) values (%L)$q$, tests.id('s_e2'))) = 1,
  'admin_starts: an admin could not start a GSR for someone they manage'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select count(*) = 1 and bool_and(company_id = tests.company('rba'))
     from public.reviews where employee_id = tests.id('s_e2') and cycle_id is null),
  'admin_starts: the GSR did not land once, with no cycle, in rba'
);
insert into tests.fixture (name, id)
select 'g_e2', id from public.reviews where employee_id = tests.id('s_e2') and cycle_id is null;

-- case: stranger_cannot_start
select tests.act_as(tests.id('s_e2'));
select tests.assert_raises(
  format($q$insert into public.reviews (company_id, employee_id) values (%L, %L)$q$,
         tests.company('rba'), tests.id('s_e5')),
  '%row-level security%'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('k_admin'));
select tests.assert_raises(
  format($q$insert into public.reviews (company_id, employee_id) values (%L, %L)$q$,
         tests.company('klasik'), tests.id('s_e5')),
  '%row-level security%'
);
reset role; select set_config('request.jwt.claims', '', true);
-- A person who is not there: a stranger learns nothing the row level security refusal would not
-- tell them.
select tests.act_as(tests.id('s_e2'));
select tests.assert_raises(
  format($q$insert into public.reviews (company_id, employee_id) values (%L, %L)$q$,
         tests.company('rba'), gen_random_uuid()),
  '%row-level security%'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  not exists (select 1 from public.reviews where employee_id = tests.id('s_e5')),
  'stranger: a refused start landed'
);
-- The refusal does not lean on the insert policies: with a policy that would admit anything, a
-- stranger is still refused, in the same words. The policy is gone again before the next case.
create policy "Sample admit any review 47s" on public.reviews for insert to authenticated with check (true);
select tests.act_as(tests.id('s_e2'));
select tests.assert_raises(
  format($q$insert into public.reviews (company_id, employee_id) values (%L, %L)$q$,
         tests.company('rba'), tests.id('s_e5')),
  'new row violates row-level security policy for table "reviews"'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('k_admin'));
select tests.assert_raises(
  format($q$insert into public.reviews (company_id, employee_id) values (%L, %L)$q$,
         tests.company('klasik'), tests.id('s_e5')),
  'new row violates row-level security policy for table "reviews"'
);
reset role; select set_config('request.jwt.claims', '', true);
drop policy "Sample admit any review 47s" on public.reviews;
select tests.assert(
  not exists (select 1 from public.reviews where employee_id = tests.id('s_e5')),
  'stranger: a start landed once a policy admitted it'
);

-- case: rococo_starts_for_an_rba_person
select tests.act_as(tests.id('s_rococo'));
select tests.assert(
  tests.rows_of(format($q$insert into public.reviews (company_id, employee_id) values (%L, %L)$q$,
                       tests.company('rba'), tests.id('s_e5'))) = 1,
  'rococo_starts: a Rococo admin could not start a GSR'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select count(*) = 1 and bool_and(company_id = tests.company('rba'))
          and bool_and(started_on = (now() at time zone 'Pacific/Kiritimati')::date)
     from public.reviews where employee_id = tests.id('s_e5') and cycle_id is null),
  'rococo_starts: the GSR did not land once, dated, in rba'
);

-- case: dates_are_the_companys
select tests.assert(
  (select started_on = (now() at time zone 'Pacific/Kiritimati')::date and done_on is null
     from public.reviews where id = tests.id('g_e1')),
  'dates: started_on is not the company''s date'
);
select tests.act_as(tests.id('s_admin'));
insert into public.reviews (company_id, employee_id, started_on, done_on)
values (tests.company('rba'), tests.id('s_e6'), '2020-01-01', '2020-01-02');
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select started_on = (now() at time zone 'Pacific/Kiritimati')::date and done_on is null
     from public.reviews where employee_id = tests.id('s_e6') and cycle_id is null),
  'dates: dates sent by the client were kept'
);

-- case: one_per_person_per_day
select tests.act_as(tests.id('s_e1'));
select tests.assert(
  tests.rows_of(format($q$insert into public.reviews (company_id, employee_id) values (%L, %L)
                          on conflict (employee_id, started_on) do nothing$q$,
                       tests.company('rba'), tests.id('s_e1'))) = 0,
  'one_a_day: a second start on the same day inserted a row'
);
select tests.assert_raises(
  format($q$insert into public.reviews (company_id, employee_id) values (%L, %L)$q$,
         tests.company('rba'), tests.id('s_e1')),
  '%reviews_person_day_key%'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select count(*) = 1 from public.reviews where employee_id = tests.id('s_e1') and cycle_id is null),
  'one_a_day: the person has more than one GSR'
);

-- case: two_open_at_most
-- Earlier GSRs are dated as a conversion dates them.
select set_config('hub.gsr_conversion', '1', true);
insert into public.reviews (company_id, employee_id, status, started_on) values
  (tests.company('rba'), tests.id('s_e7'), 'in_progress', '2026-09-01'),
  (tests.company('rba'), tests.id('s_e7'), 'not_started', '2026-10-01'),
  (tests.company('rba'), tests.id('s_e8'), 'in_progress', '2026-10-01');
insert into public.reviews (company_id, employee_id, status, started_on, done_on, completed_at) values
  (tests.company('rba'), tests.id('s_e8'), 'complete', '2026-08-01', '2026-08-28', '2026-08-28 12:00+00');
select set_config('hub.gsr_conversion', '', true);
select tests.assert(
  (select count(*) = 4 from public.reviews
    where employee_id in (tests.id('s_e7'), tests.id('s_e8')) and cycle_id is null and started_on < '2026-11-01'),
  'two_open: the earlier GSRs did not keep their dates'
);
select tests.act_as(tests.id('s_e7'));
select tests.assert_raises(
  format($q$insert into public.reviews (company_id, employee_id) values (%L, %L)$q$,
         tests.company('rba'), tests.id('s_e7')),
  'This person already has two GSRs open. Mark the earlier one done first.'
);
reset role; select set_config('request.jwt.claims', '', true);
-- Someone with no say over s_e7 is not told they are at the limit: a peer and another company's
-- admin get the row level security refusal.
select tests.act_as(tests.id('s_e2'));
select tests.assert_raises(
  format($q$insert into public.reviews (company_id, employee_id) values (%L, %L)$q$,
         tests.company('rba'), tests.id('s_e7')),
  '%row-level security%'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('k_admin'));
select tests.assert_raises(
  format($q$insert into public.reviews (company_id, employee_id) values (%L, %L)$q$,
         tests.company('klasik'), tests.id('s_e7')),
  '%row-level security%'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('s_admin'));
select tests.assert_raises(
  format($q$insert into public.reviews (company_id, employee_id) values (%L, %L)
            on conflict (employee_id, started_on) do nothing$q$,
         tests.company('rba'), tests.id('s_e7')),
  'This person already has two GSRs open. Mark the earlier one done first.'
);
-- s_e8: one open from before and one started today, so a start lands on today's.
select tests.assert(
  tests.rows_of(format($q$insert into public.reviews (company_id, employee_id) values (%L, %L)$q$,
                       tests.company('rba'), tests.id('s_e8'))) = 1,
  'two_open: a second open GSR could not start'
);
select tests.assert(
  tests.rows_of(format($q$insert into public.reviews (company_id, employee_id) values (%L, %L)
                          on conflict (employee_id, started_on) do nothing$q$,
                       tests.company('rba'), tests.id('s_e8'))) = 0,
  'two_open: a start on the day of an open GSR inserted a row'
);
-- Reopening is never limited.
select tests.assert(
  tests.rows_of(format($q$update public.reviews set status = 'in_progress', completed_at = null
                          where employee_id = %L and started_on = '2026-08-01'$q$, tests.id('s_e8'))) = 1,
  'two_open: a done GSR could not be reopened while two were open'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select count(*) = 3 from public.reviews
    where employee_id = tests.id('s_e8') and cycle_id is null and status <> 'complete')
  and (select done_on is null from public.reviews where employee_id = tests.id('s_e8') and started_on = '2026-08-01'),
  'two_open: the reopened GSR is not open, or kept its done date'
);

-- ---------------------------------------------------------------------------------------
-- Marking done and reopening
-- ---------------------------------------------------------------------------------------

-- case: leader_marks_done_and_reopens
-- A rating to freeze, so the freeze is seen working on a GSR with no cycle.
insert into public.gsr_pillars (company_id, name, weight, scoring_type)
values (tests.company('rba'), 'Sample ratings 47', 0, 'rating');
insert into tests.fixture (name, id)
select 'p_rating', id from public.gsr_pillars where name = 'Sample ratings 47';
insert into public.gsr_criteria (pillar_id, company_id, name)
values (tests.id('p_rating'), tests.company('rba'), 'Sample criterion 47');
insert into tests.fixture (name, id)
select 'k_rating', id from public.gsr_criteria where name = 'Sample criterion 47';
insert into public.impact_scores (company_id, employee_id, pillar_id, criterion_id, rating)
values (tests.company('rba'), tests.id('s_e1'), tests.id('p_rating'), tests.id('k_rating'), 4);

select tests.act_as(tests.id('s_mgr'));
select tests.assert(
  tests.rows_of(format($q$update public.reviews
                             set status = 'complete', completed_at = now(), gsr_score = 80, reviewer_id = %L
                           where id = %L$q$, tests.id('s_mgr'), tests.id('g_e1'))) = 1,
  'leader_done: a manager could not mark a led person''s GSR done'
);
-- Done, the GSR takes nothing from a leader but a reopen.
select tests.assert_raises(
  format($q$update public.reviews set manager_feedback = 'Sample 47' where id = %L$q$, tests.id('g_e1')),
  'A manager can lock and reopen a GSR, and nothing else on it.'
);
select tests.assert_raises(
  format($q$update public.reviews set gsr_score = 90 where id = %L$q$, tests.id('g_e1')),
  'This review is signed off. Reopen it to change it.'
);
select tests.assert_raises(
  format($q$update public.reviews set reviewer_id = null where id = %L$q$, tests.id('g_e1')),
  'This review is signed off. Reopen it to change it.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select status = 'complete' and gsr_score = 80 and reviewer_id = tests.id('s_mgr') and completed_at is not null
          and done_on = (now() at time zone 'Pacific/Kiritimati')::date
          and started_on = (now() at time zone 'Pacific/Kiritimati')::date
          and pillar_snapshot is not null
     from public.reviews where id = tests.id('g_e1')),
  'leader_done: the GSR was not marked done on the company''s date with its score'
);
select tests.assert(
  exists (select 1 from public.review_scores
           where review_id = tests.id('g_e1') and criterion_id = tests.id('k_rating') and rating = 4),
  'leader_done: the person''s ratings were not frozen into the GSR'
);
select tests.act_as(tests.id('s_mgr'));
select tests.assert(
  tests.rows_of(format($q$update public.reviews set status = 'in_progress', completed_at = null
                          where id = %L$q$, tests.id('g_e1'))) = 1,
  'leader_reopen: a manager could not reopen a led person''s GSR'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select status = 'in_progress' and done_on is null and gsr_score is null and pillar_snapshot is null
          and started_on = (now() at time zone 'Pacific/Kiritimati')::date
     from public.reviews where id = tests.id('g_e1')),
  'leader_reopen: reopening did not clear done_on and the score, or moved started_on'
);
-- An admin does the same, through the same guards.
select tests.act_as(tests.id('s_admin'));
update public.reviews set status = 'complete', completed_at = now(), gsr_score = 65, reviewer_id = tests.id('s_admin')
 where id = tests.id('g_e4');
select tests.assert(
  (select status = 'complete' and gsr_score = 65 and done_on = (now() at time zone 'Pacific/Kiritimati')::date
     from public.reviews where id = tests.id('g_e4')),
  'admin_done: an admin could not mark a GSR done'
);
update public.reviews set status = 'in_progress', completed_at = null where id = tests.id('g_e4');
select tests.assert(
  (select status = 'in_progress' and done_on is null and gsr_score is null
     from public.reviews where id = tests.id('g_e4')),
  'admin_reopen: an admin could not reopen a GSR, or it kept its date or score'
);
reset role; select set_config('request.jwt.claims', '', true);

-- case: leader_changes_nothing_else
select tests.act_as(tests.id('s_mgr'));
select tests.assert_raises(
  format($q$update public.reviews set manager_feedback = 'Sample 47' where id = %L$q$, tests.id('g_e1')),
  'A manager can lock and reopen a GSR, and nothing else on it.'
);
select tests.assert_raises(
  format($q$update public.reviews set employee_reflection = 'Sample 47' where id = %L$q$, tests.id('g_e1')),
  'A manager can lock and reopen a GSR, and nothing else on it.'
);
select tests.assert_raises(
  format($q$update public.reviews set started_on = '2020-01-01' where id = %L$q$, tests.id('g_e1')),
  'A manager can lock and reopen a GSR, and nothing else on it.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select manager_feedback is null and employee_reflection is null
          and started_on = (now() at time zone 'Pacific/Kiritimati')::date
     from public.reviews where id = tests.id('g_e1')),
  'leader_nothing_else: a refused write landed'
);

-- case: leader_never_closes_outside_their_lead
-- Someone they do not lead (s_e2), a scored review in rba, and a month in klasik.
insert into public.review_cycles (company_id, name, cadence, period_start, period_end)
values (tests.company('rba'), 'Sample quarter 47', 'quarterly', '2031-04-01', '2031-06-30'),
       (tests.company('klasik'), 'Sample month 47', 'monthly', '2031-06-01', '2031-06-30');
insert into tests.fixture (name, id)
select case name when 'Sample quarter 47' then 'c_quarter' else 'c_k_month' end, id
  from public.review_cycles where name in ('Sample quarter 47', 'Sample month 47');
insert into public.reviews (cycle_id, company_id, employee_id)
values (tests.id('c_quarter'), tests.company('rba'), tests.id('s_e1')),
       (tests.id('c_k_month'), tests.company('klasik'), tests.id('k_e1'));
select tests.act_as(tests.id('s_mgr'));
select tests.assert(
  tests.rows_of(format($q$update public.reviews set status = 'complete', completed_at = now(), gsr_score = 70
                          where id = %L$q$, tests.id('g_e2'))) = 0,
  'outside_lead: a manager closed the GSR of someone they do not lead'
);
select tests.assert(
  tests.rows_of(format($q$update public.reviews set status = 'complete', completed_at = now()
                          where cycle_id = %L and employee_id = %L$q$, tests.id('c_quarter'), tests.id('s_e1'))) = 0,
  'outside_lead: a manager closed a scored review'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('k_mgr'));
select tests.assert(
  tests.rows_of(format($q$update public.reviews set status = 'complete', completed_at = now(), gsr_score = 70
                          where cycle_id = %L and employee_id = %L$q$, tests.id('c_k_month'), tests.id('k_e1'))) = 0,
  'outside_lead: a manager in a company on periods locked a month'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select status <> 'complete' from public.reviews where id = tests.id('g_e2'))
  and (select status <> 'complete' from public.reviews where cycle_id = tests.id('c_quarter'))
  and (select status <> 'complete' from public.reviews where cycle_id = tests.id('c_k_month')),
  'outside_lead: a review the manager may not close is complete'
);

-- case: nobody_closes_their_own
-- Each of an employee, a manager, an admin and an owner, on their own GSR, neither marks it done
-- nor reopens it. Someone who leads them does both.
select tests.act_as(tests.id('s_mgr'));
insert into public.reviews (company_id, employee_id) values (tests.company('rba'), tests.id('s_mgr'));
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('s_admin'));
insert into public.reviews (company_id, employee_id) values (tests.company('rba'), tests.id('s_admin'));
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('s_owner'));
insert into public.reviews (company_id, employee_id) values (tests.company('rba'), tests.id('s_owner'));
reset role; select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id)
select 'g_' || substr(p.full_name, 3), r.id
  from public.reviews r join public.profiles p on p.id = r.employee_id
 where r.cycle_id is null and p.full_name in ('s_mgr', 's_admin', 's_owner');

select tests.act_as(tests.id('s_e1'));
select tests.assert_raises(
  format($q$update public.reviews set status = 'complete', completed_at = now(), gsr_score = 100 where id = %L$q$,
         tests.id('g_e1')),
  'Your own GSR is marked done and reopened by someone who leads you.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('s_mgr'));
select tests.assert_raises(
  format($q$update public.reviews set status = 'complete', completed_at = now() where id = %L$q$, tests.id('g_mgr')),
  'Your own GSR is marked done and reopened by someone who leads you.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('s_admin'));
select tests.assert_raises(
  format($q$update public.reviews set status = 'complete', completed_at = now() where id = %L$q$, tests.id('g_admin')),
  'Your own GSR is marked done and reopened by someone who leads you.'
);
-- Nor starts it done.
select tests.assert_raises(
  format($q$insert into public.reviews (company_id, employee_id, status, completed_at, started_on)
            values (%L, %L, 'complete', now(), '2026-01-01')$q$, tests.company('rba'), tests.id('s_admin')),
  'Your own GSR is marked done and reopened by someone who leads you.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('s_owner'));
select tests.assert_raises(
  format($q$update public.reviews set status = 'complete', completed_at = now() where id = %L$q$, tests.id('g_owner')),
  'Your own GSR is marked done and reopened by someone who leads you.'
);
select tests.assert_raises(
  format($q$update public.reviews set reviewer_id = %L where id = %L$q$, tests.id('s_owner'), tests.id('g_owner')),
  'Your own GSR is marked done and reopened by someone who leads you.'
);
-- The owner closes the others; the admin closes the owner's.
update public.reviews set status = 'complete', completed_at = now(), gsr_score = 50
 where id in (tests.id('g_e1'), tests.id('g_mgr'), tests.id('g_admin'));
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('s_admin'));
update public.reviews set status = 'complete', completed_at = now(), gsr_score = 50 where id = tests.id('g_owner');
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select count(*) = 4 and bool_and(status = 'complete') from public.reviews
    where id in (tests.id('g_e1'), tests.id('g_mgr'), tests.id('g_admin'), tests.id('g_owner'))),
  'own: a leader could not close a GSR'
);

select tests.act_as(tests.id('s_e1'));
select tests.assert_raises(
  format($q$update public.reviews set status = 'in_progress', completed_at = null where id = %L$q$, tests.id('g_e1')),
  'Your own GSR is marked done and reopened by someone who leads you.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('s_mgr'));
select tests.assert_raises(
  format($q$update public.reviews set status = 'in_progress', completed_at = null where id = %L$q$, tests.id('g_mgr')),
  'Your own GSR is marked done and reopened by someone who leads you.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('s_admin'));
select tests.assert_raises(
  format($q$update public.reviews set status = 'in_progress', completed_at = null where id = %L$q$, tests.id('g_admin')),
  'Your own GSR is marked done and reopened by someone who leads you.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('s_owner'));
select tests.assert_raises(
  format($q$update public.reviews set status = 'in_progress', completed_at = null where id = %L$q$, tests.id('g_owner')),
  'Your own GSR is marked done and reopened by someone who leads you.'
);
-- Put s_e1's back, for the cases after.
update public.reviews set status = 'in_progress', completed_at = null where id = tests.id('g_e1');
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select count(*) = 3 and bool_and(status = 'complete') from public.reviews
    where id in (tests.id('g_mgr'), tests.id('g_admin'), tests.id('g_owner')))
  and (select status = 'in_progress' from public.reviews where id = tests.id('g_e1')),
  'own: a GSR was reopened by its own person'
);

-- Nor through an upsert on their own GSR.
select tests.act_as(tests.id('s_e1'));
select tests.assert_raises(
  format($q$insert into public.reviews (company_id, employee_id) values (%L, %L)
            on conflict (employee_id, started_on) do update set status = 'complete', completed_at = now()$q$,
         tests.company('rba'), tests.id('s_e1')),
  'Your own GSR is marked done and reopened by someone who leads you.'
);
reset role; select set_config('request.jwt.claims', '', true);

-- Nor by taking someone else's GSR as their own and closing it in the same write. The GSR is from
-- an earlier day, so no GSR of the writer's started today stands in the way.
select set_config('hub.gsr_conversion', '1', true);
insert into public.reviews (company_id, employee_id, status, started_on)
values (tests.company('rba'), tests.id('s_e5'), 'in_progress', '2026-09-01');
select set_config('hub.gsr_conversion', '', true);
insert into tests.fixture (name, id)
select 'g_e5_old', id from public.reviews where employee_id = tests.id('s_e5') and started_on = '2026-09-01';
select tests.act_as(tests.id('s_admin'));
select tests.assert_raises(
  format($q$update public.reviews set employee_id = %L, status = 'complete', completed_at = now(), gsr_score = 100
            where id = %L$q$, tests.id('s_admin'), tests.id('g_e5_old')),
  'Your own GSR is marked done and reopened by someone who leads you.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('s_owner'));
select tests.assert_raises(
  format($q$update public.reviews set employee_id = %L, status = 'complete', completed_at = now(), gsr_score = 100
            where id = %L$q$, tests.id('s_owner'), tests.id('g_e5_old')),
  'Your own GSR is marked done and reopened by someone who leads you.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('s_rococo'));
select tests.assert_raises(
  format($q$update public.reviews set employee_id = %L, status = 'complete', completed_at = now(), gsr_score = 100
            where id = %L$q$, tests.id('s_rococo'), tests.id('g_e5_old')),
  'Your own GSR is marked done and reopened by someone who leads you.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select employee_id = tests.id('s_e5') and status = 'in_progress' from public.reviews where id = tests.id('g_e5_old'))
  and (select status = 'in_progress' from public.reviews where id = tests.id('g_e1')),
  'own: a GSR was taken over and closed, or closed by an upsert'
);

-- case: a_gsr_stays_with_its_person_and_company
-- No signed-in writer changes whose GSR it is or which company holds it, an admin or a Rococo
-- admin included.
select tests.act_as(tests.id('s_admin'));
select tests.assert_raises(
  format($q$update public.reviews set employee_id = %L where id = %L$q$, tests.id('s_e2'), tests.id('g_e5_old')),
  'A GSR stays with the person it was started for.'
);
select tests.assert_raises(
  format($q$update public.reviews set company_id = %L where id = %L$q$, tests.company('klasik'), tests.id('g_e5_old')),
  'A GSR stays in the company it was started in.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('s_rococo'));
select tests.assert_raises(
  format($q$update public.reviews set employee_id = %L where id = %L$q$, tests.id('s_e2'), tests.id('g_e5_old')),
  'A GSR stays with the person it was started for.'
);
select tests.assert_raises(
  format($q$update public.reviews set company_id = %L where id = %L$q$, tests.company('klasik'), tests.id('g_e5_old')),
  'A GSR stays in the company it was started in.'
);
-- A person moved to a company on periods leaves their GSR behind, and it cannot follow them.
update public.profiles set company_id = tests.company('klasik') where id = tests.id('s_e6');
select tests.assert_raises(
  format($q$update public.reviews set company_id = %L
            where employee_id = %L and cycle_id is null$q$, tests.company('klasik'), tests.id('s_e6')),
  'A GSR stays in the company it was started in.'
);
reset role; select set_config('request.jwt.claims', '', true);
-- The SQL editor may change a GSR's company only into a company on demand. Every change by the
-- SQL editor is first refused by reviews_guard_employee_fields today; it is set aside here, inside
-- the rolled-back transaction, so this rule is seen on its own.
alter table public.reviews disable trigger reviews_guard_employee_fields;
select tests.assert_raises(
  format($q$update public.reviews set company_id = %L
            where employee_id = %L and cycle_id is null$q$, tests.company('klasik'), tests.id('s_e6')),
  'GSRs on demand are not turned on for this company.'
);
alter table public.reviews enable trigger reviews_guard_employee_fields;
select tests.assert(
  (select employee_id = tests.id('s_e5') and company_id = tests.company('rba')
     from public.reviews where id = tests.id('g_e5_old'))
  and not exists (select 1 from public.reviews
                   where company_id = tests.company('klasik') and cycle_id is null),
  'stays: a GSR changed person, or reached a company on periods'
);

-- case: a_manager_who_is_also_a_report
select tests.act_as(tests.id('s_mgr2'));
insert into public.reviews (company_id, employee_id) values (tests.company('rba'), tests.id('s_e3'));
insert into public.reviews (company_id, employee_id) values (tests.company('rba'), tests.id('s_mgr2'));
reset role; select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id)
select case employee_id when tests.id('s_e3') then 'g_e3' else 'g_mgr2' end, id
  from public.reviews where employee_id in (tests.id('s_e3'), tests.id('s_mgr2')) and cycle_id is null;
select tests.act_as(tests.id('s_mgr2'));
select tests.assert(
  tests.rows_of(format($q$update public.reviews set status = 'complete', completed_at = now(), gsr_score = 90
                          where id = %L$q$, tests.id('g_e3'))) = 1,
  'manager_report: a manager could not close the GSR of someone they lead'
);
select tests.assert_raises(
  format($q$update public.reviews set status = 'complete', completed_at = now() where id = %L$q$, tests.id('g_mgr2')),
  'Your own GSR is marked done and reopened by someone who leads you.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('s_lead'));
select tests.assert(
  tests.rows_of(format($q$update public.reviews set status = 'complete', completed_at = now(), gsr_score = 75
                          where id = %L$q$, tests.id('g_mgr2'))) = 1,
  'manager_report: their own manager could not close a manager''s GSR'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select status = 'complete' and gsr_score = 90 from public.reviews where id = tests.id('g_e3'))
  and (select status = 'complete' and gsr_score = 75 from public.reviews where id = tests.id('g_mgr2')),
  'manager_report: the GSRs did not close as they should'
);

-- case: the_person_reflects_on_their_own
select tests.act_as(tests.id('s_e1'));
select tests.assert(
  tests.rows_of(format($q$update public.reviews set employee_reflection = 'Sample reflection 47',
                                                    support_discussion = 'Sample support 47'
                          where id = %L$q$, tests.id('g_e1'))) = 1,
  'reflects: the person could not write their reflection'
);
select tests.assert_raises(
  format($q$update public.reviews set manager_feedback = 'Sample 47' where id = %L$q$, tests.id('g_e1')),
  'Only admins can edit review scores, status, and feedback.'
);
select tests.assert_raises(
  format($q$update public.reviews set done_on = '2020-01-01' where id = %L$q$, tests.id('g_e1')),
  'Only admins can edit review scores, status, and feedback.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select employee_reflection = 'Sample reflection 47' and support_discussion = 'Sample support 47'
          and manager_feedback is null and done_on is null
     from public.reviews where id = tests.id('g_e1')),
  'reflects: the reflection did not land, or a refused write did'
);

-- ---------------------------------------------------------------------------------------
-- Seeing one
-- ---------------------------------------------------------------------------------------

-- case: who_sees_a_gsr
select tests.act_as(tests.id('s_e1'));
select tests.assert(
  (select count(*) = 1 from public.reviews where id = tests.id('g_e1'))
  and (select count(*) = 1 from public.gsr_last_started where employee_id = tests.id('s_e1')
          and last_started_on = (now() at time zone 'Pacific/Kiritimati')::date),
  'sees: the person cannot read their own GSR'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('s_mgr'));
select tests.assert(
  (select count(*) = 1 from public.reviews where id = tests.id('g_e1'))
  and (select count(*) = 1 from public.gsr_last_started where employee_id = tests.id('s_e1')),
  'sees: a leader cannot read a led person''s GSR'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('s_admin'));
select tests.assert(
  (select count(*) = 1 from public.reviews where id = tests.id('g_e1'))
  and (select count(*) = 1 from public.gsr_last_started where employee_id = tests.id('s_e1')
          and company_id = tests.company('rba')),
  'sees: an admin cannot read a GSR'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('s_e2'));
select tests.assert(
  (select count(*) = 0 from public.reviews where id = tests.id('g_e1'))
  and (select count(*) = 0 from public.gsr_last_started where employee_id = tests.id('s_e1')),
  'sees: a peer reads another person''s GSR'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('k_admin'));
select tests.assert(
  (select count(*) = 0 from public.reviews where id = tests.id('g_e1'))
  and (select count(*) = 0 from public.gsr_last_started where company_id = tests.company('rba')),
  'sees: another company''s admin reads an rba GSR'
);
reset role; select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------------------
-- A company on periods, as before
-- ---------------------------------------------------------------------------------------

-- case: cycle_reviews_unchanged
-- A month in klasik: the person opens it, it carries no dates, an admin locks it with a score and
-- reopens it exactly as before, and no writer moves a review out of its cycle or into one.
select tests.act_as(tests.id('k_e1'));
insert into public.reviews (cycle_id, company_id, employee_id)
values (tests.id('c_k_month'), tests.company('klasik'), tests.id('k_e1'))
on conflict (cycle_id, employee_id) do nothing;
reset role; select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id)
select 'r_k_month', id from public.reviews where cycle_id = tests.id('c_k_month') and employee_id = tests.id('k_e1');
select tests.act_as(tests.id('k_admin'));
select tests.assert(
  tests.rows_of(format($q$update public.reviews set status = 'complete', completed_at = now(), gsr_score = 70,
                                                    reviewer_id = %L
                          where id = %L$q$, tests.id('k_admin'), tests.id('r_k_month'))) = 1,
  'cycle_unchanged: an admin could not lock a month'
);
select tests.assert(
  (select status = 'complete' and gsr_score = 70 and started_on is null and done_on is null
     from public.reviews where id = tests.id('r_k_month')),
  'cycle_unchanged: a locked month carries dates or lost its score'
);
select tests.assert_raises(
  format($q$update public.reviews set gsr_score = 80 where id = %L$q$, tests.id('r_k_month')),
  'This review is signed off. Reopen it to change it.'
);
update public.reviews set status = 'in_progress', completed_at = null where id = tests.id('r_k_month');
select tests.assert(
  (select status = 'in_progress' and gsr_score is null and started_on is null and done_on is null
     from public.reviews where id = tests.id('r_k_month')),
  'cycle_unchanged: reopening a month did not release its score, or gave it dates'
);
select tests.assert_raises(
  format($q$update public.reviews set cycle_id = null where id = %L$q$, tests.id('r_k_month')),
  'A review in a cycle stays in a cycle, and a GSR on its own stays on its own.'
);
select tests.assert_raises(
  format($q$update public.reviews set started_on = '2031-06-01' where id = %L$q$, tests.id('r_k_month')),
  '%reviews_home_check%'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('s_admin'));
insert into public.review_cycles (company_id, name, cadence, period_start, period_end)
values (tests.company('rba'), 'Sample rba month 47', 'monthly', '2031-07-01', '2031-07-31');
select tests.assert_raises(
  format($q$update public.reviews set cycle_id = (select id from public.review_cycles where name = 'Sample rba month 47')
            where id = %L$q$, tests.id('g_e2')),
  'A review in a cycle stays in a cycle, and a GSR on its own stays on its own.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select cycle_id is not null from public.reviews where id = tests.id('r_k_month'))
  and (select cycle_id is null from public.reviews where id = tests.id('g_e2')),
  'cycle_unchanged: a review moved into or out of a cycle'
);

-- ---------------------------------------------------------------------------------------
-- No way back
-- ---------------------------------------------------------------------------------------

-- case: no_way_back_once_a_gsr_exists
select tests.assert_raises(
  format($q$update public.companies set gsr_mode = 'periods' where id = %L$q$, tests.company('rba')),
  'This company has GSRs on demand, so it cannot go back to periods from here.'
);
select tests.assert(
  (select gsr_mode = 'on_demand' from public.companies where id = tests.company('rba')),
  'no_way_back: the company went back to periods'
);
