-- 0043_milestone_status.test.sql
-- Proves a milestone's status (0043): it is one of three values, a plain milestone starts not
-- started, and the status and the completed-on date stay in step whichever of the two a write
-- changes, with "today" read in the company's own time zone and the date winning when a write
-- sends both.
--
-- Runs inside one transaction the harness opens and rolls back; never begin or commit here.

-- Setup, as system. Kingdom works in a zone far from UTC, so today there is a different date from
-- UTC's for most of the day, and a trigger reading current_date would be caught.
update public.companies set time_zone = 'Pacific/Kiritimati' where id = tests.company('kingdom');
select tests.create_person('kingdom_admin', tests.company('kingdom'), 'admin');

with p as (
  insert into public.projects (company_id, name, reference)
  values (tests.company('kingdom'), 'Sample job 941', '941')
  returning id
)
insert into tests.fixture (name, id) select 'project', id from p;

with m as (
  insert into public.project_milestones (project_id, title, completed_on)
  values (tests.id('project'), 'Already done', '2026-09-01')
  returning id
)
insert into tests.fixture (name, id) select 'done_before', id from m;

with m as (
  insert into public.project_milestones (project_id, title)
  values (tests.id('project'), 'Plain milestone')
  returning id
)
insert into tests.fixture (name, id) select 'plain', id from m;

-- case: existing_rows_backfilled
-- The one-time backfill is proven by the harness pasting 0043 twice; here a row written with a
-- date and no status reads complete, which is what the backfill leaves an existing row as.
select tests.assert(
  (select status = 'complete' and completed_on = '2026-09-01'
     from public.project_milestones where id = tests.id('done_before')),
  'existing_rows_backfilled: a row with a completed-on date does not read complete'
);

-- case: default_is_not_started
select tests.assert(
  (select status = 'not_started' and completed_on is null
     from public.project_milestones where id = tests.id('plain')),
  'default_is_not_started: a plain milestone does not read not started with no date'
);

-- case: complete_sets_the_date
select tests.act_as(tests.id('kingdom_admin'));
update public.project_milestones set status = 'complete' where id = tests.id('plain');
select tests.assert(
  (select m.status = 'complete' and m.completed_on = (now() at time zone c.time_zone)::date
     from public.project_milestones m
     join public.companies c on c.id = m.company_id
    where m.id = tests.id('plain')),
  'complete_sets_the_date: completing did not set today in the company''s time zone'
);

-- case: reopening_clears_the_date
update public.project_milestones set status = 'in_progress' where id = tests.id('plain');
select tests.assert(
  (select status = 'in_progress' and completed_on is null
     from public.project_milestones where id = tests.id('plain')),
  'reopening_clears_the_date: in progress kept the completed-on date'
);

-- case: date_sets_complete
update public.project_milestones set status = 'not_started' where id = tests.id('plain');
update public.project_milestones set completed_on = '2026-10-01' where id = tests.id('plain');
select tests.assert(
  (select status = 'complete' and completed_on = '2026-10-01'
     from public.project_milestones where id = tests.id('plain')),
  'date_sets_complete: a date did not make the milestone complete with that date'
);

-- case: clearing_the_date_reopens
update public.project_milestones set completed_on = null where id = tests.id('plain');
select tests.assert(
  (select status = 'not_started' and completed_on is null
     from public.project_milestones where id = tests.id('plain')),
  'clearing_the_date_reopens: clearing the date did not put it back to not started'
);

-- case: both_given_date_wins
update public.project_milestones set status = 'complete' where id = tests.id('plain');
update public.project_milestones set status = 'not_started', completed_on = '2026-10-02' where id = tests.id('plain');
select tests.assert(
  (select status = 'complete' and completed_on = '2026-10-02'
     from public.project_milestones where id = tests.id('plain')),
  'both_given_date_wins: a status and a date together did not keep the date'
);

-- case: bad_status_refused
select tests.assert_raises(
  format($q$update public.project_milestones set status = 'done' where id = %L$q$, tests.id('plain')),
  '%project_milestones_status_check%'
);
reset role;
select set_config('request.jwt.claims', '', true);
