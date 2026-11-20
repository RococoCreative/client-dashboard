-- 0047_gsr_conversion.test.sql
-- Proves what happens when a company moves from GSR months to GSRs on demand: its past months
-- turn into GSRs that stand on their own in the same write, their goals follow them, the months
-- and their left-out rows go, a private copy keeps everything removed, and no other company's
-- row moves. Three runs from the same start, each rolled back to it before the next:
--
--   1. rba shaped like Klasik's live data: three months (one closed), goals in each, one for a
--      person with no review that month, three people left out, a quarterly cycle signed off, and
--      a person who has since moved to klasik.
--   2. rba shaped like its own live data, the first company this runs on: one closed month with
--      two reviews (one complete and scored, one not), two goals, two people left out, and an
--      open quarterly cycle with one review.
--   3. rba with no GSR months at all.
--
-- klasik and kingdom stay on periods throughout, with data of their own, and their fingerprints
-- are the proof they are untouched.
--
-- Runs inside one transaction the harness opens and rolls back; never begin or commit here. The
-- savepoint below is this file's own.

-- The fingerprint is supabase/tests/fingerprint.sql itself, read in as the body of a test-local
-- function, so this test and the hand-run query cannot drift apart.
\set fingerprint_sql `cd "$(git rev-parse --show-toplevel)" && cat supabase/tests/fingerprint.sql`
create function tests.fingerprint()
returns table (slug text, tbl text, n bigint, hash text)
language sql
stable
as :'fingerprint_sql';

-- Every column of every review row a company holds, with each row's physical place (ctid), which
-- any update moves, even one that changes no value. For "changes no row".
create function tests.full_hash(p_company uuid)
returns text
language sql
stable
as $$
  select md5(concat_ws('|',
    (select string_agg(t.ctid::text || to_jsonb(t)::text, ',' order by t.id) from public.review_cycles t where t.company_id = p_company),
    (select string_agg(t.ctid::text || to_jsonb(t)::text, ',' order by t.id) from public.reviews t where t.company_id = p_company),
    (select string_agg(t.ctid::text || to_jsonb(t)::text, ',' order by t.id) from public.review_scores t where t.company_id = p_company),
    (select string_agg(t.ctid::text || to_jsonb(t)::text, ',' order by t.id) from public.goals t where t.company_id = p_company),
    (select string_agg(t.ctid::text || to_jsonb(t)::text, ',' order by t.id) from public.goal_notes t where t.company_id = p_company),
    (select string_agg(t.ctid::text || to_jsonb(t)::text, ',' order by t.cycle_id, t.employee_id) from public.cycle_omissions t where t.company_id = p_company)
  ))
$$;

-- How many rows a statement touched as whoever is acting, so a write RLS quietly skips reads 0.
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

-- Moves rba over the way the owner will, in the SQL editor, naming it.
create function tests.move_rba()
returns void
language plpgsql
as $$
begin
  perform set_config('hub.gsr_on_demand_for', 'rba', true);
  update public.companies set gsr_mode = 'on_demand' where slug = 'rba';
  perform set_config('hub.gsr_on_demand_for', '', true);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- Setup shared by every run, as system
-- ---------------------------------------------------------------------------------------
-- rba: an admin, a manager who leads e1 to e6, six people with GSRs, three who are left out.
select tests.create_person('c_admin', tests.company('rba'), 'admin');
select tests.create_person('c_mgr', tests.company('rba'), 'manager');
select tests.create_person('c_e1', tests.company('rba'));
select tests.create_person('c_e2', tests.company('rba'));
select tests.create_person('c_e3', tests.company('rba'));
select tests.create_person('c_e4', tests.company('rba'));
select tests.create_person('c_e5', tests.company('rba'));
select tests.create_person('c_e6', tests.company('rba'));
select tests.create_person('c_o1', tests.company('rba'));
select tests.create_person('c_o2', tests.company('rba'));
select tests.create_person('c_o3', tests.company('rba'));
select tests.create_person('c_rococo', null, 'employee', true);
-- klasik and kingdom, on periods.
select tests.create_person('c_k_admin', tests.company('klasik'), 'admin');
select tests.create_person('c_k_e1', tests.company('klasik'));
select tests.create_person('c_k_e2', tests.company('klasik'));
select tests.create_person('c_k_o1', tests.company('klasik'));
select tests.create_person('c_g_e1', tests.company('kingdom'));
select tests.create_person('c_g_e2', tests.company('kingdom'));
update public.profiles set view_all_divisions = true
 where id in (tests.id('c_admin'), tests.id('c_k_admin'));
update public.profiles set reports_to = tests.id('c_mgr')
 where id in (tests.id('c_e1'), tests.id('c_e2'), tests.id('c_e3'), tests.id('c_e4'), tests.id('c_e5'), tests.id('c_e6'));

-- klasik: an October month with one GSR locked and one open, a goal and a note on each, one
-- person left out; a quarterly cycle with one review.
insert into public.review_cycles (company_id, name, cadence, period_start, period_end) values
  (tests.company('klasik'), 'Sample klasik October 47c', 'monthly', '2026-10-01', '2026-10-31'),
  (tests.company('klasik'), 'Sample klasik Q4 47c', 'quarterly', '2026-10-01', '2026-12-31'),
  (tests.company('kingdom'), 'Sample kingdom November 47c', 'monthly', '2026-11-01', '2026-11-30');
insert into tests.fixture (name, id)
select case name when 'Sample klasik October 47c' then 'k_oct'
                 when 'Sample klasik Q4 47c' then 'k_q4'
                 else 'g_nov' end, id
  from public.review_cycles where name like 'Sample % 47c';
insert into public.goals (company_id, employee_id, cycle_id, scope, kind, title, is_focus) values
  (tests.company('klasik'), tests.id('c_k_e1'), tests.id('k_oct'), 'cycle', 'role', 'Sample klasik goal one 47c', true),
  (tests.company('klasik'), tests.id('c_k_e2'), tests.id('k_oct'), 'cycle', 'professional', 'Sample klasik goal two 47c', false),
  (tests.company('kingdom'), tests.id('c_g_e1'), tests.id('g_nov'), 'cycle', 'role', 'Sample kingdom goal one 47c', false),
  (tests.company('kingdom'), tests.id('c_g_e2'), tests.id('g_nov'), 'cycle', 'role', 'Sample kingdom goal two 47c', false);
insert into tests.fixture (name, id)
select 'k_goal_one', id from public.goals where title = 'Sample klasik goal one 47c';
insert into public.goal_notes (goal_id, body)
select id, 'Sample klasik note 47c' from public.goals where title like 'Sample klasik goal % 47c';
insert into public.reviews (cycle_id, company_id, employee_id, status, completed_at, gsr_score) values
  (tests.id('k_oct'), tests.company('klasik'), tests.id('c_k_e1'), 'complete', '2026-11-03 15:00+00', 82),
  (tests.id('k_oct'), tests.company('klasik'), tests.id('c_k_e2'), 'in_progress', null, null),
  (tests.id('k_q4'), tests.company('klasik'), tests.id('c_k_e1'), 'not_started', null, null),
  (tests.id('g_nov'), tests.company('kingdom'), tests.id('c_g_e1'), 'in_progress', null, null),
  (tests.id('g_nov'), tests.company('kingdom'), tests.id('c_g_e2'), 'in_progress', null, null);
insert into tests.fixture (name, id)
select 'k_rev_open', id from public.reviews where cycle_id = tests.id('k_oct') and employee_id = tests.id('c_k_e2');
insert into public.cycle_omissions (cycle_id, employee_id) values (tests.id('k_oct'), tests.id('c_k_o1'));

-- Every run starts from here.
savepoint before_any_move;

-- =======================================================================================
-- Run 1: rba shaped like Klasik's live data
-- =======================================================================================
-- September (closed): e1 locked on October 5, e2 still open; e4 has a goal and no review.
-- October (open): e1 locked November 2, e2 locked October 28, e3 and e4 open; e6 has a goal and
--   no review; o1 and o2 left out.
-- November (open): e1 to e4 open, e5 locked November 12; o3 left out.
-- Q4 (open, quarterly): e1's review signed off with two line items.
insert into public.review_cycles (company_id, name, cadence, period_start, period_end) values
  (tests.company('rba'), 'Sample rba September 47c', 'monthly', '2026-09-01', '2026-09-30'),
  (tests.company('rba'), 'Sample rba October 47c', 'monthly', '2026-10-01', '2026-10-31'),
  (tests.company('rba'), 'Sample rba November 47c', 'monthly', '2026-11-01', '2026-11-30'),
  (tests.company('rba'), 'Sample rba Q4 47c', 'quarterly', '2026-10-01', '2026-12-31');
insert into tests.fixture (name, id)
select case name when 'Sample rba September 47c' then 'r_sep'
                 when 'Sample rba October 47c' then 'r_oct'
                 when 'Sample rba November 47c' then 'r_nov'
                 else 'r_q4' end, id
  from public.review_cycles where name like 'Sample rba % 47c';

insert into public.goals (company_id, employee_id, cycle_id, scope, kind, title, is_focus)
select tests.company('rba'), tests.id(p), tests.id(c), 'cycle', k, t, f
  from (values
    ('c_e1', 'r_sep', 'role', 'Sample sep e1 47c', true),
    ('c_e2', 'r_sep', 'professional', 'Sample sep e2 47c', false),
    ('c_e4', 'r_sep', 'role', 'Sample sep e4 47c', false),
    ('c_e1', 'r_oct', 'role', 'Sample oct e1 focus 47c', true),
    ('c_e1', 'r_oct', 'personal', 'Sample oct e1 personal 47c', false),
    ('c_e2', 'r_oct', 'professional', 'Sample oct e2 47c', false),
    ('c_e3', 'r_oct', 'role', 'Sample oct e3 47c', false),
    ('c_e4', 'r_oct', 'role', 'Sample oct e4 47c', false),
    ('c_e6', 'r_oct', 'professional', 'Sample oct e6 47c', false),
    ('c_e1', 'r_nov', 'role', 'Sample nov e1 47c', false),
    ('c_e3', 'r_nov', 'role', 'Sample nov e3 47c', false),
    ('c_e5', 'r_nov', 'professional', 'Sample nov e5 47c', false)
  ) as v (p, c, k, t, f);
insert into tests.fixture (name, id)
select case title when 'Sample oct e3 47c' then 'g_oct_e3'
                  when 'Sample oct e6 47c' then 'g_oct_e6'
                  else 'g_sep_e4' end, id
  from public.goals where title in ('Sample oct e3 47c', 'Sample oct e6 47c', 'Sample sep e4 47c');
insert into public.goal_notes (goal_id, body)
select id, 'Sample rba note 47c' from public.goals where title in ('Sample sep e1 47c', 'Sample oct e1 focus 47c');

insert into public.reviews (cycle_id, company_id, employee_id, status, completed_at, gsr_score)
select tests.id(c), tests.company('rba'), tests.id(p), s, a::timestamptz, g
  from (values
    ('r_sep', 'c_e1', 'complete', '2026-10-05 15:00+00', 70),
    ('r_sep', 'c_e2', 'in_progress', null, null),
    ('r_oct', 'c_e1', 'complete', '2026-11-02 15:00+00', 80),
    ('r_oct', 'c_e2', 'complete', '2026-10-28 15:00+00', 65),
    ('r_oct', 'c_e3', 'in_progress', null, null),
    ('r_oct', 'c_e4', 'in_progress', null, null),
    ('r_nov', 'c_e1', 'in_progress', null, null),
    ('r_nov', 'c_e2', 'in_progress', null, null),
    ('r_nov', 'c_e3', 'in_progress', null, null),
    ('r_nov', 'c_e4', 'in_progress', null, null),
    ('r_nov', 'c_e5', 'complete', '2026-11-12 15:00+00', 90),
    ('r_q4', 'c_e1', 'not_started', null, null)
  ) as v (c, p, s, a, g);
insert into tests.fixture (name, id)
select case when cycle_id = tests.id('r_sep') and employee_id = tests.id('c_e1') then 'rv_sep_e1'
            when cycle_id = tests.id('r_sep') then 'rv_sep_e2'
            when cycle_id = tests.id('r_oct') and employee_id = tests.id('c_e1') then 'rv_oct_e1'
            when cycle_id = tests.id('r_oct') and employee_id = tests.id('c_e2') then 'rv_oct_e2'
            when cycle_id = tests.id('r_oct') and employee_id = tests.id('c_e3') then 'rv_oct_e3'
            when cycle_id = tests.id('r_nov') then 'rv_nov_e5'
            else 'rv_q4_e1' end, id
  from public.reviews
 where (cycle_id in (tests.id('r_sep'), tests.id('r_q4')))
    or (cycle_id = tests.id('r_oct') and employee_id in (tests.id('c_e1'), tests.id('c_e2'), tests.id('c_e3')))
    or (cycle_id = tests.id('r_nov') and employee_id = tests.id('c_e5'));

-- The quarterly review's line items, then an admin signs it off.
insert into public.review_scores (review_id, pillar_id, label, target, actual, sort_order)
select tests.id('rv_q4_e1'), p.id, 'Sample line ' || p.name, 100, 90, 0
  from public.gsr_pillars p
 where p.company_id = tests.company('rba') and p.name in ('Performance', 'Core Values');
select tests.act_as(tests.id('c_admin'));
update public.reviews set status = 'complete', completed_at = '2026-11-10 15:00+00', reviewer_id = tests.id('c_admin')
 where id = tests.id('rv_q4_e1');
reset role; select set_config('request.jwt.claims', '', true);

insert into public.cycle_omissions (cycle_id, employee_id) values
  (tests.id('r_oct'), tests.id('c_o1')),
  (tests.id('r_oct'), tests.id('c_o2')),
  (tests.id('r_nov'), tests.id('c_o3'));
update public.review_cycles set status = 'closed' where id = tests.id('r_sep');

-- e4 has since been moved to klasik by a Rococo admin.
select tests.act_as(tests.id('c_rococo'));
update public.profiles set company_id = tests.company('klasik') where id = tests.id('c_e4');
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select company_id = tests.company('klasik') from public.profiles where id = tests.id('c_e4')),
  'setup: e4 did not move to klasik'
);

-- What there was before the move.
create temp table fp_before as select * from tests.fingerprint();
create temp table b_cycles as select * from public.review_cycles where company_id = tests.company('rba');
create temp table b_reviews as select * from public.reviews where company_id = tests.company('rba');
create temp table b_goals as select * from public.goals where company_id = tests.company('rba');
create temp table b_omissions as select * from public.cycle_omissions where company_id = tests.company('rba');
create temp table b_scores as select * from public.review_scores where company_id = tests.company('rba');
create temp table b_q4_hash as
select md5(concat_ws('|',
         (select to_jsonb(c)::text from public.review_cycles c where c.id = tests.id('r_q4')),
         (select string_agg(to_jsonb(r)::text, ',' order by r.id) from public.reviews r where r.cycle_id = tests.id('r_q4')),
         (select string_agg(to_jsonb(s)::text, ',' order by s.id)
            from public.review_scores s join public.reviews r on r.id = s.review_id
           where r.cycle_id = tests.id('r_q4')))) as h;
select tests.assert(
  (select count(*) = 3 from b_cycles where kind = 'gsr')
  and (select count(*) = 3 from b_omissions)
  and (select count(*) = 11 from b_reviews where cycle_id <> tests.id('r_q4'))
  and (select count(*) = 12 from b_goals)
  and (select count(*) = 2 from b_scores),
  'setup: rba is not the shape this run expects'
);

select tests.move_rba();

-- case: a_klasik_shaped_company_converts
select tests.assert(
  not exists (
    select 1
      from b_reviews b
      join b_cycles c on c.id = b.cycle_id and c.kind = 'gsr'
      left join public.reviews r on r.id = b.id
     where r.id is null
        or r.cycle_id is not null
        or r.started_on is distinct from c.period_start
        or r.company_id is distinct from tests.company('rba')
        or r.employee_id is distinct from b.employee_id
  ),
  'converts: a month review is gone, still in a cycle, or not started on the first of its month in rba'
);
select tests.assert(
  not exists (
    select 1
      from b_goals bg
      left join public.goals g on g.id = bg.id
      left join public.reviews r on r.id = g.review_id
     where g.id is null
        or g.cycle_id is not null
        or r.id is null
        or r.cycle_id is not null
        or r.employee_id is distinct from bg.employee_id
        or r.started_on is distinct from (select c.period_start from b_cycles c where c.id = bg.cycle_id)
        or g.company_id is distinct from tests.company('rba')
  ),
  'converts: a goal is gone, still in a cycle, or not on its person''s GSR for its month'
);
-- A goal whose person had a review that month is on that very review.
select tests.assert(
  not exists (
    select 1
      from b_goals bg
      join b_reviews b on b.cycle_id = bg.cycle_id and b.employee_id = bg.employee_id
      join public.goals g on g.id = bg.id
     where g.review_id is distinct from b.id
  ),
  'converts: a goal did not follow its own review'
);
-- The goal with no review has a not-started GSR of its own, new, dated the first of its month.
select tests.assert(
  (select r.status = 'not_started' and r.started_on = '2026-10-01' and r.done_on is null
          and r.company_id = tests.company('rba') and r.employee_id = tests.id('c_e6')
          and r.gsr_score is null and r.completed_at is null
          and not exists (select 1 from b_reviews b where b.id = r.id)
     from public.goals g join public.reviews r on r.id = g.review_id
    where g.id = tests.id('g_oct_e6')),
  'converts: the goal with no review did not get a new not-started GSR on October 1'
);
select tests.assert(
  (select count(*) = 2 from public.reviews r
    where r.company_id = tests.company('rba')
      and not exists (select 1 from b_reviews b where b.id = r.id)),
  'converts: the conversion created other than the two GSRs for goals with no review'
);
select tests.assert(
  not exists (select 1 from public.review_cycles where company_id = tests.company('rba') and kind = 'gsr')
  and not exists (select 1 from public.cycle_omissions where company_id = tests.company('rba'))
  and exists (select 1 from public.review_cycles where id = tests.id('r_q4')),
  'converts: a month or a left-out row of rba remains, or the quarterly cycle went'
);
-- Notes stay on their goals.
select tests.assert(
  (select count(*) = 2 from public.goal_notes n join b_goals bg on bg.id = n.goal_id
    where n.body = 'Sample rba note 47c' and n.company_id = tests.company('rba')),
  'converts: a note did not stay on its goal'
);

-- case: the_flag_is_gone_after_the_conversion (checked again in run 2)
select tests.assert(
  current_setting('hub.gsr_conversion', true) is distinct from '1',
  'flag: hub.gsr_conversion is still set after the move'
);

-- case: scores_and_completion_survive
-- Every converted review is the row it was, but for its cycle, its dates and when it was last
-- touched.
select tests.assert(
  not exists (
    select 1
      from b_reviews b
      join b_cycles c on c.id = b.cycle_id and c.kind = 'gsr'
      join public.reviews r on r.id = b.id
     where (to_jsonb(r) - 'cycle_id' - 'started_on' - 'done_on' - 'updated_at')
           is distinct from (to_jsonb(b) - 'cycle_id' - 'started_on' - 'done_on' - 'updated_at')
  ),
  'survive: status, score, completion or something else changed on a converted review'
);
select tests.assert(
  (select status = 'complete' and gsr_score = 80 and completed_at = '2026-11-02 15:00+00'
     from public.reviews where id = tests.id('rv_oct_e1')),
  'survive: e1''s October GSR lost its status, score or completion'
);

-- case: locked_after_its_month_stays_in_its_month
select tests.assert(
  (select done_on = '2026-09-30' from public.reviews where id = tests.id('rv_sep_e1'))
  and (select done_on = '2026-10-31' from public.reviews where id = tests.id('rv_oct_e1')),
  'locked_after: a GSR locked after its month did not stay in its month'
);

-- case: done_in_a_running_month_counts_that_day
select tests.assert(
  (select done_on = '2026-11-12' from public.reviews where id = tests.id('rv_nov_e5'))
  and (select done_on = '2026-10-28' from public.reviews where id = tests.id('rv_oct_e2')),
  'done_in_month: a GSR locked inside its month did not count on that day'
);

-- case: unfinished_stays_open_even_in_a_closed_month
select tests.assert(
  (select status = 'in_progress' and done_on is null and cycle_id is null and started_on = '2026-09-01'
     from public.reviews where id = tests.id('rv_sep_e2')),
  'unfinished: the open review from the closed month is not an open GSR'
);
select tests.assert(
  not exists (
    select 1 from public.reviews r join b_reviews b on b.id = r.id
     where b.status <> 'complete' and r.done_on is not null
  ),
  'unfinished: an open review was given a done date'
);

-- case: scored_reviews_are_untouched
select tests.assert(
  (select h from b_q4_hash) = md5(concat_ws('|',
    (select to_jsonb(c)::text from public.review_cycles c where c.id = tests.id('r_q4')),
    (select string_agg(to_jsonb(r)::text, ',' order by r.id) from public.reviews r where r.cycle_id = tests.id('r_q4')),
    (select string_agg(to_jsonb(s)::text, ',' order by s.id)
       from public.review_scores s join public.reviews r on r.id = s.review_id
      where r.cycle_id = tests.id('r_q4')))),
  'scored_untouched: the quarterly cycle, its review or its line items changed'
);

-- case: other_companies_are_untouched
select tests.assert(
  not exists (
    (select * from fp_before where slug in ('klasik', 'kingdom')
     except
     select * from tests.fingerprint() where slug in ('klasik', 'kingdom'))
    union all
    (select * from tests.fingerprint() where slug in ('klasik', 'kingdom')
     except
     select * from fp_before where slug in ('klasik', 'kingdom'))
  )
  and (select count(*) = 12 from fp_before where slug in ('klasik', 'kingdom')),
  'other_companies: a fingerprint of klasik or kingdom changed'
);
select tests.assert(
  exists (select 1 from fp_before where slug = 'klasik' and tbl = 'reviews' and n = 3)
  and exists (select 1 from fp_before where slug = 'kingdom' and tbl = 'goals' and n = 2),
  'other_companies: the fingerprint did not read the data it should'
);
select tests.assert(
  not exists (select 1 from public.reviews where company_id <> tests.company('rba') and cycle_id is null)
  and (select gsr_mode = 'periods' from public.companies where slug = 'klasik')
  and (select gsr_mode = 'periods' from public.companies where slug = 'kingdom'),
  'other_companies: another company has a GSR with no cycle, or moved'
);

-- case: a_person_who_moved_company_converts_cleanly
-- e4 is in klasik now; their October and November reviews and both goals converted in rba, the
-- September goal (no review that month) on a new GSR in rba, and nothing of theirs landed in
-- klasik.
select tests.assert(
  (select count(*) = 3 from public.reviews
    where employee_id = tests.id('c_e4') and company_id = tests.company('rba') and cycle_id is null)
  and (select count(*) = 2 from public.goals g join public.reviews r on r.id = g.review_id
        where g.employee_id = tests.id('c_e4') and g.company_id = tests.company('rba')
          and r.company_id = tests.company('rba'))
  and (select r.status = 'not_started' and r.started_on = '2026-09-01' and r.company_id = tests.company('rba')
         from public.goals g join public.reviews r on r.id = g.review_id where g.id = tests.id('g_sep_e4'))
  and not exists (select 1 from public.reviews where employee_id = tests.id('c_e4') and company_id = tests.company('klasik'))
  and not exists (select 1 from public.goals where employee_id = tests.id('c_e4') and company_id = tests.company('klasik')),
  'moved_person: e4''s GSRs or goals did not stay in rba, or something landed in klasik'
);

-- case: backup_holds_what_was_removed
-- One row per removed cycle and left-out row, per converted review and per moved goal, each
-- payload the whole row as it was, so every cycle and left-out row can be rebuilt and every
-- converted review and moved goal names the cycle it belonged to.
select tests.assert(
  (select count(*) = 3 from private.gsr_conversion_backup where company_id = tests.company('rba') and what = 'cycle')
  and (select count(*) = 3 from private.gsr_conversion_backup where company_id = tests.company('rba') and what = 'omission')
  and (select count(*) = 11 from private.gsr_conversion_backup where company_id = tests.company('rba') and what = 'review_cycle')
  and (select count(*) = 12 from private.gsr_conversion_backup where company_id = tests.company('rba') and what = 'goal_cycle')
  and (select count(*) = 2 from private.gsr_conversion_backup where company_id = tests.company('rba') and what = 'created_gsr')
  and not exists (select 1 from private.gsr_conversion_backup where company_id <> tests.company('rba')),
  'backup: not one row for each removed or re-pointed row'
);
select tests.assert(
  not exists (
    (select payload from private.gsr_conversion_backup where what = 'cycle'
     except select to_jsonb(c) from b_cycles c where c.kind = 'gsr')
    union all
    (select to_jsonb(c) from b_cycles c where c.kind = 'gsr'
     except select payload from private.gsr_conversion_backup where what = 'cycle')
  ),
  'backup: the cycle rows are not the removed cycles, whole'
);
select tests.assert(
  not exists (
    (select payload from private.gsr_conversion_backup where what = 'omission'
     except select to_jsonb(o) from b_omissions o)
    union all
    (select to_jsonb(o) from b_omissions o
     except select payload from private.gsr_conversion_backup where what = 'omission')
  ),
  'backup: the omission rows are not the removed left-out rows, whole'
);
select tests.assert(
  not exists (
    (select payload from private.gsr_conversion_backup where what = 'review_cycle'
     except select to_jsonb(b) from b_reviews b join b_cycles c on c.id = b.cycle_id and c.kind = 'gsr')
    union all
    (select to_jsonb(b) from b_reviews b join b_cycles c on c.id = b.cycle_id and c.kind = 'gsr'
     except select payload from private.gsr_conversion_backup where what = 'review_cycle')
  ),
  'backup: the review rows are not the converted reviews as they were'
);
select tests.assert(
  not exists (
    (select payload from private.gsr_conversion_backup where what = 'goal_cycle'
     except select to_jsonb(g) from b_goals g)
    union all
    (select to_jsonb(g) from b_goals g
     except select payload from private.gsr_conversion_backup where what = 'goal_cycle')
  ),
  'backup: the goal rows are not the moved goals as they were'
);
select tests.assert(
  not exists (
    (select payload from private.gsr_conversion_backup where what = 'created_gsr'
     except select to_jsonb(r) from public.reviews r
             where r.company_id = tests.company('rba') and not exists (select 1 from b_reviews b where b.id = r.id))
    union all
    (select to_jsonb(r) from public.reviews r
      where r.company_id = tests.company('rba') and not exists (select 1 from b_reviews b where b.id = r.id)
     except select payload from private.gsr_conversion_backup where what = 'created_gsr')
  ),
  'backup: the created_gsr rows are not the GSRs the move made, whole'
);
-- Rebuilt from the backup alone: every cycle and left-out row, and the cycle of each review and
-- goal, read back through the row types.
select tests.assert(
  (select count(*) = 3 from private.gsr_conversion_backup k,
          jsonb_populate_record(null::public.review_cycles, k.payload) c
    where k.what = 'cycle' and c.kind = 'gsr' and c.company_id = tests.company('rba'))
  and (select count(*) = 3 from private.gsr_conversion_backup k,
          jsonb_populate_record(null::public.cycle_omissions, k.payload) o
    where k.what = 'omission' and o.cycle_id in (tests.id('r_oct'), tests.id('r_nov')))
  and (select count(*) = 0 from private.gsr_conversion_backup k
        where k.what in ('review_cycle', 'goal_cycle')
          and (k.payload->>'cycle_id')::uuid not in (tests.id('r_sep'), tests.id('r_oct'), tests.id('r_nov'))),
  'backup: the rows do not rebuild into cycles, left-out rows, and the cycle of each review and goal'
);

-- case: no_way_back
select tests.assert_raises(
  $q$update public.companies set gsr_mode = 'periods' where slug = 'rba'$q$,
  'This company has GSRs on demand, so it cannot go back to periods from here.'
);

-- case: the_company_then_works
-- e5 starts a new GSR; the manager works a converted open one and marks it done.
select tests.act_as(tests.id('c_e5'));
select tests.assert(
  tests.rows_of(format($q$insert into public.reviews (company_id, employee_id) values (%L, %L)$q$,
                       tests.company('rba'), tests.id('c_e5'))) = 1,
  'then_works: a person could not start a GSR after the move'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('c_mgr'));
select tests.assert(
  tests.rows_of(format($q$update public.goals set progress = 60 where id = %L$q$, tests.id('g_oct_e3'))) = 1,
  'then_works: a manager could not work a goal on a converted open GSR'
);
select tests.assert(
  tests.rows_of(format($q$update public.reviews
                             set status = 'complete', completed_at = now(), gsr_score = 60, reviewer_id = %L
                           where id = %L$q$, tests.id('c_mgr'), tests.id('rv_oct_e3'))) = 1,
  'then_works: a manager could not mark a converted open GSR done'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select status = 'complete' and done_on = (now() at time zone 'America/New_York')::date
          and started_on = '2026-10-01'
     from public.reviews where id = tests.id('rv_oct_e3')),
  'then_works: the converted GSR was not done today, or lost its start'
);

rollback to savepoint before_any_move;

-- =======================================================================================
-- Run 2: rba shaped like its own live data
-- =======================================================================================
-- August (closed): e1 locked September 3 and scored, e2 not finished; a goal each; o1 and o2 left
-- out. Q3 (open, quarterly): e1's review, signed off with its line items.
insert into public.review_cycles (company_id, name, cadence, period_start, period_end) values
  (tests.company('rba'), 'Sample rba August 47c', 'monthly', '2026-08-01', '2026-08-31'),
  (tests.company('rba'), 'Sample rba Q3 47c', 'quarterly', '2026-07-01', '2026-09-30');
insert into tests.fixture (name, id)
select case name when 'Sample rba August 47c' then 'r_aug' else 'r_q3' end, id
  from public.review_cycles where name in ('Sample rba August 47c', 'Sample rba Q3 47c');
insert into public.goals (company_id, employee_id, cycle_id, scope, kind, title, is_focus) values
  (tests.company('rba'), tests.id('c_e1'), tests.id('r_aug'), 'cycle', 'role', 'Sample aug e1 47c', true),
  (tests.company('rba'), tests.id('c_e2'), tests.id('r_aug'), 'cycle', 'professional', 'Sample aug e2 47c', false);
insert into public.reviews (cycle_id, company_id, employee_id, status, completed_at, gsr_score) values
  (tests.id('r_aug'), tests.company('rba'), tests.id('c_e1'), 'complete', '2026-09-03 15:00+00', 75),
  (tests.id('r_aug'), tests.company('rba'), tests.id('c_e2'), 'in_progress', null, null),
  (tests.id('r_q3'), tests.company('rba'), tests.id('c_e1'), 'not_started', null, null);
insert into tests.fixture (name, id)
select case when cycle_id = tests.id('r_q3') then 'rv_q3_e1'
            when employee_id = tests.id('c_e1') then 'rv_aug_e1'
            else 'rv_aug_e2' end, id
  from public.reviews where cycle_id in (tests.id('r_aug'), tests.id('r_q3'));
insert into public.review_scores (review_id, pillar_id, label, target, actual, sort_order)
select tests.id('rv_q3_e1'), p.id, 'Sample line ' || p.name, 100, 75, 0
  from public.gsr_pillars p
 where p.company_id = tests.company('rba') and p.name in ('Performance', 'Core Values');
select tests.act_as(tests.id('c_admin'));
update public.reviews set status = 'complete', completed_at = '2026-10-02 15:00+00', reviewer_id = tests.id('c_admin')
 where id = tests.id('rv_q3_e1');
reset role; select set_config('request.jwt.claims', '', true);
insert into public.cycle_omissions (cycle_id, employee_id) values
  (tests.id('r_aug'), tests.id('c_o1')),
  (tests.id('r_aug'), tests.id('c_o2'));
update public.review_cycles set status = 'closed' where id = tests.id('r_aug');

create temp table fp_before as select * from tests.fingerprint();
create temp table b_reviews as select * from public.reviews where company_id = tests.company('rba');
create temp table b_signed_off as
select md5(concat_ws('|',
         (select string_agg(to_jsonb(s)::text, ',' order by s.id) from public.review_scores s where s.review_id = tests.id('rv_q3_e1')),
         (select pillar_snapshot::text from public.reviews where id = tests.id('rv_q3_e1')),
         (select pillar_snapshot::text from public.reviews where id = tests.id('rv_aug_e1')))) as h,
       (select count(*) from public.review_scores s where s.review_id = tests.id('rv_q3_e1')) as n,
       (select pillar_snapshot is not null from public.reviews where id = tests.id('rv_q3_e1')) as snapped;

select tests.move_rba();

-- case: the_flag_is_gone_after_the_conversion
-- Straight after the move, in the same transaction: the flag is down, and the guards it stood
-- aside are back for everyone, the SQL editor included.
select tests.assert(
  current_setting('hub.gsr_conversion', true) is distinct from '1',
  'flag: hub.gsr_conversion is still set after the move'
);
select tests.assert_raises(
  format($q$update public.reviews set cycle_id = null, started_on = '2026-10-01' where id = %L$q$,
         tests.id('k_rev_open')),
  'Only admins can edit review scores, status, and feedback.'
);
select tests.assert_raises(
  format($q$update public.goals set progress = 50 where id = %L$q$, tests.id('k_goal_one')),
  'This month''s GSR is locked in. Reopen the review to change its goals.'
);
select tests.assert(
  (select cycle_id = tests.id('k_oct') and started_on is null from public.reviews where id = tests.id('k_rev_open')),
  'flag: the klasik review left its month'
);

-- case: the_live_rba_shape_converts
select tests.assert(
  (select cycle_id is null and started_on = '2026-08-01' and done_on = '2026-08-31'
          and status = 'complete' and gsr_score = 75 and completed_at = '2026-09-03 15:00+00'
          and company_id = tests.company('rba')
     from public.reviews where id = tests.id('rv_aug_e1')),
  'live_shape: the scored August GSR did not convert, done on August 31'
);
select tests.assert(
  (select cycle_id is null and started_on = '2026-08-01' and done_on is null and status = 'in_progress'
          and company_id = tests.company('rba')
     from public.reviews where id = tests.id('rv_aug_e2')),
  'live_shape: the unfinished August review did not end an open GSR'
);
select tests.assert(
  (select count(*) = 2 from public.goals g join public.reviews r on r.id = g.review_id
    where g.title in ('Sample aug e1 47c', 'Sample aug e2 47c') and g.cycle_id is null
      and r.id in (tests.id('rv_aug_e1'), tests.id('rv_aug_e2')) and r.employee_id = g.employee_id),
  'live_shape: the two goals did not follow their reviews'
);
select tests.assert(
  not exists (select 1 from public.review_cycles where id = tests.id('r_aug'))
  and not exists (select 1 from public.cycle_omissions where company_id = tests.company('rba'))
  and (select count(*) = 1 from public.reviews where cycle_id = tests.id('r_q3'))
  and (select count(*) = 3 from public.reviews where company_id = tests.company('rba')),
  'live_shape: the month or its left-out rows remain, or a review was added or lost'
);
select tests.assert(
  (select count(*) = 1 from private.gsr_conversion_backup where what = 'cycle')
  and (select count(*) = 2 from private.gsr_conversion_backup where what = 'omission')
  and (select count(*) = 2 from private.gsr_conversion_backup where what = 'review_cycle')
  and (select count(*) = 2 from private.gsr_conversion_backup where what = 'goal_cycle'),
  'live_shape: the backup does not hold one row for each removed or re-pointed row'
);

-- case: signed_off_line_items_are_untouched
select tests.assert(
  (select n = 2 and snapped from b_signed_off)
  and (select h from b_signed_off) = md5(concat_ws('|',
    (select string_agg(to_jsonb(s)::text, ',' order by s.id) from public.review_scores s where s.review_id = tests.id('rv_q3_e1')),
    (select pillar_snapshot::text from public.reviews where id = tests.id('rv_q3_e1')),
    (select pillar_snapshot::text from public.reviews where id = tests.id('rv_aug_e1')))),
  'signed_off: a line item or a pillar snapshot changed'
);

-- case: other_companies_are_untouched (run 2)
select tests.assert(
  not exists (
    (select * from fp_before where slug in ('klasik', 'kingdom')
     except
     select * from tests.fingerprint() where slug in ('klasik', 'kingdom'))
    union all
    (select * from tests.fingerprint() where slug in ('klasik', 'kingdom')
     except
     select * from fp_before where slug in ('klasik', 'kingdom'))
  ),
  'other_companies: a fingerprint of klasik or kingdom changed in run 2'
);

-- case: converting_twice_changes_nothing
create temp table h_before as
select (select tests.full_hash(tests.company('rba'))) as rba,
       (select tests.full_hash(tests.company('klasik'))) as klasik,
       (select tests.full_hash(tests.company('kingdom'))) as kingdom,
       (select count(*) from private.gsr_conversion_backup) as backups;
select private.convert_gsrs_to_on_demand(tests.company('rba'));
select tests.assert(
  (select rba = tests.full_hash(tests.company('rba'))
          and klasik = tests.full_hash(tests.company('klasik'))
          and kingdom = tests.full_hash(tests.company('kingdom'))
          and backups = (select count(*) from private.gsr_conversion_backup)
     from h_before)
  and current_setting('hub.gsr_conversion', true) is distinct from '1',
  'twice: converting again touched a row, added a backup row, or left the flag up'
);

-- case: the_conversion_is_out_of_reach
-- No signed-in account can run it or its trigger, and the SQL editor cannot run it on a company
-- on periods.
select tests.assert(
  not has_function_privilege('authenticated', 'private.convert_gsrs_to_on_demand(uuid)', 'execute')
  and not has_function_privilege('anon', 'private.convert_gsrs_to_on_demand(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.convert_gsrs_on_gsr_mode()', 'execute')
  and not has_function_privilege('anon', 'private.convert_gsrs_on_gsr_mode()', 'execute')
  and not has_table_privilege('authenticated', 'private.gsr_conversion_backup', 'select')
  and not has_table_privilege('anon', 'private.gsr_conversion_backup', 'select'),
  'out_of_reach: a signed-in account can run the conversion or read its backup'
);
select tests.assert(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like '%convert%'
  ),
  'out_of_reach: a public function converts'
);
select tests.assert_raises(
  format($q$select private.convert_gsrs_to_on_demand(%L)$q$, tests.company('klasik')),
  'GSRs on demand are not turned on for this company.'
);
select tests.assert(
  (select klasik = tests.full_hash(tests.company('klasik')) from h_before)
  and current_setting('hub.gsr_conversion', true) is distinct from '1',
  'out_of_reach: a refused conversion changed klasik or left the flag up'
);

rollback to savepoint before_any_move;

-- =======================================================================================
-- Run 3: rba with no GSR months
-- =======================================================================================
-- case: a_company_with_nothing_to_convert_moves
insert into public.review_cycles (company_id, name, cadence, period_start, period_end)
values (tests.company('rba'), 'Sample rba Q2 47c', 'quarterly', '2026-04-01', '2026-06-30');
insert into public.reviews (cycle_id, company_id, employee_id)
select id, tests.company('rba'), tests.id('c_e1') from public.review_cycles where name = 'Sample rba Q2 47c';
create temp table fp_before as select * from tests.fingerprint();
select tests.move_rba();
select tests.assert(
  (select gsr_mode = 'on_demand' from public.companies where slug = 'rba')
  and not exists (select 1 from private.gsr_conversion_backup)
  and not exists (
    (select * from fp_before except select * from tests.fingerprint())
    union all
    (select * from tests.fingerprint() except select * from fp_before)
  )
  and current_setting('hub.gsr_conversion', true) is distinct from '1',
  'nothing_to_convert: the move failed, wrote a backup row, or changed a row'
);

rollback to savepoint before_any_move;

-- =======================================================================================
-- Run 4: done dates at the edges of a month
-- =======================================================================================
-- A month that has not ended, around the company's today: e1 marked complete with no completion
-- time, e2 marked complete before the month began. A converted GSR's done date stays inside its
-- month and is never later than today.
insert into public.review_cycles (company_id, name, cadence, period_start, period_end)
select tests.company('rba'), 'Sample rba running month 47c', 'monthly', d - 5, d + 20
  from (select (now() at time zone 'America/New_York')::date as d) t;
insert into tests.fixture (name, id)
select 'r_run', id from public.review_cycles where name = 'Sample rba running month 47c';
insert into public.reviews (cycle_id, company_id, employee_id, status, completed_at, gsr_score)
select tests.id('r_run'), tests.company('rba'), tests.id(p), 'complete', a, g
  from (values
    ('c_e1', null::timestamptz, 55),
    ('c_e2', now() - interval '12 days', 45)
  ) as v (p, a, g);
insert into tests.fixture (name, id)
select case employee_id when tests.id('c_e1') then 'rv_run_e1' else 'rv_run_e2' end, id
  from public.reviews where cycle_id = tests.id('r_run');
select tests.move_rba();

-- case: done_before_its_month_is_dated_its_first_day
select tests.assert(
  (select done_on = started_on and started_on = (now() at time zone 'America/New_York')::date - 5
          and status = 'complete' and gsr_score = 45
     from public.reviews where id = tests.id('rv_run_e2')),
  'done_before: a GSR marked complete before its month began is not dated its first day'
);

-- case: done_with_no_time_in_a_running_month_is_dated_today
select tests.assert(
  (select done_on = (now() at time zone 'America/New_York')::date and completed_at is null
          and status = 'complete' and gsr_score = 55
     from public.reviews where id = tests.id('rv_run_e1')),
  'done_no_time: a GSR complete with no completion time in a running month is not dated today'
);

rollback to savepoint before_any_move;

-- =======================================================================================
-- Run 5: a day already taken
-- =======================================================================================
-- case: a_day_already_taken_refuses_the_move_in_plain_words
-- kingdom moves first, so g_e1's November month there becomes a GSR started November 1. A Rococo
-- admin then moves g_e1 to rba, which gives them a review in its own November month. Moving rba
-- would date that one November 1 too, and a person has one GSR a day: the move is refused in
-- plain words and nothing changes.
select set_config('hub.gsr_on_demand_for', 'kingdom', true);
update public.companies set gsr_mode = 'on_demand' where slug = 'kingdom';
select set_config('hub.gsr_on_demand_for', '', true);
select tests.act_as(tests.id('c_rococo'));
update public.profiles set company_id = tests.company('rba') where id = tests.id('c_g_e1');
reset role; select set_config('request.jwt.claims', '', true);
insert into public.review_cycles (company_id, name, cadence, period_start, period_end)
values (tests.company('rba'), 'Sample rba November taken 47c', 'monthly', '2026-11-01', '2026-11-30');
insert into public.reviews (cycle_id, company_id, employee_id)
select id, tests.company('rba'), tests.id('c_g_e1') from public.review_cycles where name = 'Sample rba November taken 47c';
select tests.assert(
  exists (select 1 from public.reviews where employee_id = tests.id('c_g_e1') and cycle_id is null
            and started_on = '2026-11-01' and company_id = tests.company('kingdom')),
  'day_taken: setup did not leave g_e1 a kingdom GSR started November 1'
);
create temp table fp_before as select * from tests.fingerprint();
create temp table h_before as
select tests.full_hash(tests.company('rba')) as rba,
       (select count(*) from private.gsr_conversion_backup where company_id = tests.company('rba')) as backups;
select tests.assert_raises(
  'select tests.move_rba()',
  'Someone in this company already has a GSR dated the first day of a month being converted. Nothing was changed.'
);
select tests.assert(
  (select gsr_mode = 'periods' from public.companies where slug = 'rba')
  and (select rba = tests.full_hash(tests.company('rba')) and backups = 0 from h_before)
  and (select count(*) = 0 from private.gsr_conversion_backup where company_id = tests.company('rba'))
  and not exists (
    (select * from fp_before except select * from tests.fingerprint())
    union all
    (select * from tests.fingerprint() except select * from fp_before)
  )
  and current_setting('hub.gsr_conversion', true) is distinct from '1',
  'day_taken: the refused move changed something, or left the flag up'
);

rollback to savepoint before_any_move;

-- =======================================================================================
-- Run 6: putting a move back by hand
-- =======================================================================================
-- case: the_backup_puts_a_move_back_by_hand
-- rba shaped like its own live data (run 2), plus a goal set for o1 before they were left out, so
-- the move also makes a GSR, and a note on e1's goal. After the move, the put-back written above
-- private.gsr_conversion_backup in 0047 is read from the migration (the lines between its marker
-- lines, without their '--   ') and run as it stands, so the comment and this case cannot drift
-- apart. First the four ways it must stop having changed nothing, each undone before the next,
-- then the put-back itself with edits made since the move.
\set put_back_sql `cd "$(git rev-parse --show-toplevel)" && sed -n '/^-- put back: from here$/,/^-- put back: to here$/p' supabase/migrations/0047_gsr_on_demand.sql | sed -e '1d' -e '$d' -e 's/^--   //'`
insert into public.review_cycles (company_id, name, cadence, period_start, period_end) values
  (tests.company('rba'), 'Sample rba August 47c', 'monthly', '2026-08-01', '2026-08-31'),
  (tests.company('rba'), 'Sample rba Q3 47c', 'quarterly', '2026-07-01', '2026-09-30');
insert into tests.fixture (name, id)
select case name when 'Sample rba August 47c' then 'r_aug' else 'r_q3' end, id
  from public.review_cycles where name in ('Sample rba August 47c', 'Sample rba Q3 47c');
insert into public.goals (company_id, employee_id, cycle_id, scope, kind, title, is_focus) values
  (tests.company('rba'), tests.id('c_e1'), tests.id('r_aug'), 'cycle', 'role', 'Sample aug e1 47c', true),
  (tests.company('rba'), tests.id('c_e2'), tests.id('r_aug'), 'cycle', 'professional', 'Sample aug e2 47c', false),
  (tests.company('rba'), tests.id('c_o1'), tests.id('r_aug'), 'cycle', 'personal', 'Sample aug o1 47c', false);
insert into tests.fixture (name, id)
select case title when 'Sample aug e1 47c' then 'g_aug_e1' else 'g_aug_e2' end, id
  from public.goals where title in ('Sample aug e1 47c', 'Sample aug e2 47c');
insert into public.goal_notes (goal_id, body) values (tests.id('g_aug_e1'), 'Sample aug note 47c');
insert into public.reviews (cycle_id, company_id, employee_id, status, completed_at, gsr_score) values
  (tests.id('r_aug'), tests.company('rba'), tests.id('c_e1'), 'complete', '2026-09-03 15:00+00', 75),
  (tests.id('r_aug'), tests.company('rba'), tests.id('c_e2'), 'in_progress', null, null),
  (tests.id('r_q3'), tests.company('rba'), tests.id('c_e1'), 'not_started', null, null);
insert into tests.fixture (name, id)
select case when cycle_id = tests.id('r_q3') then 'rv_q3_e1' else 'rv_aug_e2' end, id
  from public.reviews
 where cycle_id = tests.id('r_q3') or (cycle_id = tests.id('r_aug') and employee_id = tests.id('c_e2'));
insert into public.review_scores (review_id, pillar_id, label, target, actual, sort_order)
select tests.id('rv_q3_e1'), p.id, 'Sample line ' || p.name, 100, 75, 0
  from public.gsr_pillars p
 where p.company_id = tests.company('rba') and p.name in ('Performance', 'Core Values');
select tests.act_as(tests.id('c_admin'));
update public.reviews set status = 'complete', completed_at = '2026-10-02 15:00+00', reviewer_id = tests.id('c_admin')
 where id = tests.id('rv_q3_e1');
reset role; select set_config('request.jwt.claims', '', true);
insert into public.cycle_omissions (cycle_id, employee_id, reason) values
  (tests.id('r_aug'), tests.id('c_o1'), 'Sample reason 47c'),
  (tests.id('r_aug'), tests.id('c_o2'), null);
update public.review_cycles set status = 'closed' where id = tests.id('r_aug');
insert into public.projects (company_id, name) values (tests.company('rba'), 'Sample project 47c');

-- Every row of a company's six review tables as it is now, every column, with its physical place,
-- so even an update that changes no value shows.
create function tests.rows_now(p_company uuid)
returns table (tbl text, body jsonb)
language sql
stable
as $$
  select 'review_cycles', to_jsonb(t) || jsonb_build_object('ctid', t.ctid::text) from public.review_cycles t where t.company_id = p_company
  union all select 'reviews', to_jsonb(t) || jsonb_build_object('ctid', t.ctid::text) from public.reviews t where t.company_id = p_company
  union all select 'review_scores', to_jsonb(t) || jsonb_build_object('ctid', t.ctid::text) from public.review_scores t where t.company_id = p_company
  union all select 'goals', to_jsonb(t) || jsonb_build_object('ctid', t.ctid::text) from public.goals t where t.company_id = p_company
  union all select 'goal_notes', to_jsonb(t) || jsonb_build_object('ctid', t.ctid::text) from public.goal_notes t where t.company_id = p_company
  union all select 'cycle_omissions', to_jsonb(t) || jsonb_build_object('ctid', t.ctid::text) from public.cycle_omissions t where t.company_id = p_company
  union all select 'review_project_notes', to_jsonb(t) || jsonb_build_object('ctid', t.ctid::text) from public.review_project_notes t where t.company_id = p_company
$$;

create temp table fp_before as select * from tests.fingerprint();
create temp table b_rows as
select 'review_cycles' as tbl, to_jsonb(t) - 'updated_at' as row from public.review_cycles t where t.company_id = tests.company('rba')
union all select 'reviews', to_jsonb(t) - 'updated_at' from public.reviews t where t.company_id = tests.company('rba')
union all select 'review_scores', to_jsonb(t) - 'updated_at' from public.review_scores t where t.company_id = tests.company('rba')
union all select 'goals', to_jsonb(t) - 'updated_at' from public.goals t where t.company_id = tests.company('rba')
union all select 'goal_notes', to_jsonb(t) - 'updated_at' from public.goal_notes t where t.company_id = tests.company('rba')
union all select 'cycle_omissions', to_jsonb(t) from public.cycle_omissions t where t.company_id = tests.company('rba');

select tests.move_rba();
select tests.assert(
  not exists (select 1 from public.review_cycles where id = tests.id('r_aug'))
  and (select count(*) = 1 from private.gsr_conversion_backup where what = 'created_gsr'),
  'put_back: the move did not happen as this case expects'
);
insert into tests.fixture (name, id)
select 'gsr_o1', id from public.reviews where employee_id = tests.id('c_o1') and cycle_id is null;

-- case: the_put_back_stops_for_a_goal_added_to_a_gsr_the_move_made
savepoint put_back_case;
select tests.act_as(tests.id('c_admin'));
insert into public.goals (company_id, employee_id, review_id, scope, kind, title)
values (tests.company('rba'), tests.id('c_o1'), tests.id('gsr_o1'), 'cycle', 'role', 'Sample after the move 47c');
reset role; select set_config('request.jwt.claims', '', true);
create temp table s_before as select * from tests.rows_now(tests.company('rba'));
select tests.assert_raises(:'put_back_sql',
  'This move cannot be put back yet, and nothing was changed. Goals added to its GSRs since the move: 1.%GSRs the move made that changed since: 0.%Score rows on GSRs the%move made: 0.%Project notes on GSRs%the move made: 0. Delete them.');
select tests.assert(
  (select gsr_mode = 'on_demand' from public.companies where slug = 'rba')
  and not exists ((select * from s_before except all select * from tests.rows_now(tests.company('rba')))
                  union all (select * from tests.rows_now(tests.company('rba')) except all select * from s_before))
  and current_setting('hub.gsr_conversion', true) is distinct from '1',
  'put_back_stops: a goal added to a GSR the move made did not stop it with nothing changed'
);
rollback to savepoint put_back_case;

-- case: the_put_back_stops_for_a_goal_added_to_a_converted_gsr
select tests.act_as(tests.id('c_admin'));
insert into public.goals (company_id, employee_id, review_id, scope, kind, title)
values (tests.company('rba'), tests.id('c_e2'), tests.id('rv_aug_e2'), 'cycle', 'role', 'Sample after the move 47c');
reset role; select set_config('request.jwt.claims', '', true);
create temp table s_before as select * from tests.rows_now(tests.company('rba'));
select tests.assert_raises(:'put_back_sql',
  'This move cannot be put back yet, and nothing was changed. Goals added to its GSRs since the move: 1.%GSRs the move made that changed since: 0.%Score rows on GSRs the%move made: 0.%Project notes on GSRs%the move made: 0. Delete them.');
select tests.assert(
  (select gsr_mode = 'on_demand' from public.companies where slug = 'rba')
  and not exists ((select * from s_before except all select * from tests.rows_now(tests.company('rba')))
                  union all (select * from tests.rows_now(tests.company('rba')) except all select * from s_before))
  and current_setting('hub.gsr_conversion', true) is distinct from '1',
  'put_back_stops: a goal added to a converted GSR did not stop it with nothing changed'
);
rollback to savepoint put_back_case;

-- case: the_put_back_stops_for_a_gsr_the_move_made_marked_done
-- o1 carries a rating, so marking the GSR done freezes it into a score row.
insert into public.impact_scores (company_id, employee_id, pillar_id, criterion_id, rating)
select tests.company('rba'), tests.id('c_o1'), c.pillar_id, c.id, 3
  from public.gsr_criteria c join public.gsr_pillars p on p.id = c.pillar_id
 where p.company_id = tests.company('rba') and p.scoring_type = 'rating' and p.is_active and c.is_active
 order by c.id limit 1;
select tests.act_as(tests.id('c_admin'));
update public.reviews set status = 'complete', completed_at = now(), gsr_score = 40, reviewer_id = tests.id('c_admin')
 where id = tests.id('gsr_o1');
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select count(*) = 1 from public.review_scores where review_id = tests.id('gsr_o1')),
  'put_back_stops: marking the GSR done froze no rating'
);
create temp table s_before as select * from tests.rows_now(tests.company('rba'));
select tests.assert_raises(:'put_back_sql',
  'This move cannot be put back yet, and nothing was changed. Goals added to its GSRs since the move: 0.%GSRs the move made that changed since: 1.%Score rows on GSRs the%move made: 1.%Project notes on GSRs%the move made: 0. Delete them.');
select tests.assert(
  (select gsr_mode = 'on_demand' from public.companies where slug = 'rba')
  and not exists ((select * from s_before except all select * from tests.rows_now(tests.company('rba')))
                  union all (select * from tests.rows_now(tests.company('rba')) except all select * from s_before))
  and current_setting('hub.gsr_conversion', true) is distinct from '1',
  'put_back_stops: a GSR the move made, marked done since, did not stop it with nothing changed'
);
rollback to savepoint put_back_case;

-- case: the_put_back_stops_for_a_project_note_on_a_gsr_the_move_made
select tests.act_as(tests.id('c_admin'));
insert into public.review_project_notes (review_id, project_id, note)
select tests.id('gsr_o1'), id, 'Sample project note 47c' from public.projects where name = 'Sample project 47c';
reset role; select set_config('request.jwt.claims', '', true);
create temp table s_before as select * from tests.rows_now(tests.company('rba'));
select tests.assert_raises(:'put_back_sql',
  'This move cannot be put back yet, and nothing was changed. Goals added to its GSRs since the move: 0.%GSRs the move made that changed since: 0.%Score rows on GSRs the%move made: 0.%Project notes on GSRs%the move made: 1. Delete them.');
select tests.assert(
  (select gsr_mode = 'on_demand' from public.companies where slug = 'rba')
  and not exists ((select * from s_before except all select * from tests.rows_now(tests.company('rba')))
                  union all (select * from tests.rows_now(tests.company('rba')) except all select * from s_before))
  and current_setting('hub.gsr_conversion', true) is distinct from '1',
  'put_back_stops: a project note on a GSR the move made did not stop it with nothing changed'
);
rollback to savepoint put_back_case;

-- case: the_put_back_holds_after_later_columns
-- A column added since the move, to reviews (nullable, with a default) and to the months and
-- left-out rows (required, with a default), changes nothing: the put-back still runs, and the
-- months take the new column's default. Undone, columns and all, before the real put-back.
savepoint put_back_case;
alter table public.reviews add column scratch_47c text default 'later';
alter table public.review_cycles add column scratch_47c text not null default 'later';
alter table public.cycle_omissions add column scratch_47c text not null default 'later';
:put_back_sql
select tests.assert(
  (select gsr_mode = 'periods' from public.companies where slug = 'rba')
  and not exists (select 1 from public.reviews where company_id = tests.company('rba') and cycle_id is null)
  and (select scratch_47c = 'later' and status = 'closed' from public.review_cycles where id = tests.id('r_aug'))
  and (select count(*) = 2 from public.cycle_omissions where cycle_id = tests.id('r_aug') and scratch_47c = 'later'),
  'later_columns: the put-back did not run, or the months did not take the new column''s default'
);
rollback to savepoint put_back_case;
select tests.assert(
  (select gsr_mode = 'on_demand' from public.companies where slug = 'rba')
  and not exists (select 1 from information_schema.columns where column_name = 'scratch_47c'),
  'later_columns: the scratch case was not undone'
);

-- case: the_put_back_holds_in_another_time_zone (the put-back below)
-- The put-back itself, after two edits it keeps: a moved goal's completion changed, and the
-- converted open GSR marked done. It runs with the session a long way from where the move ran,
-- so the copy's times read differently as text; the result is the same.
select tests.act_as(tests.id('c_admin'));
update public.goals set progress = 60 where id = tests.id('g_aug_e2');
update public.reviews set status = 'complete', completed_at = now(), gsr_score = 50, reviewer_id = tests.id('c_admin')
 where id = tests.id('rv_aug_e2');
reset role; select set_config('request.jwt.claims', '', true);

select tests.assert(current_setting('TimeZone') is distinct from 'Pacific/Kiritimati',
  'put_back: the move already ran in the zone this case moves to');
set local time zone 'Pacific/Kiritimati';
:put_back_sql
reset time zone;

select tests.assert(
  (select gsr_mode = 'periods' from public.companies where slug = 'rba')
  and not exists (select 1 from public.reviews where company_id = tests.company('rba') and cycle_id is null)
  and current_setting('hub.gsr_conversion', true) is distinct from '1',
  'put_back: rba is not on periods, still holds a GSR with no cycle, or the flag is up'
);
create temp table a_rows as
select 'review_cycles' as tbl, to_jsonb(t) - 'updated_at' as row from public.review_cycles t where t.company_id = tests.company('rba')
union all select 'reviews', to_jsonb(t) - 'updated_at' from public.reviews t where t.company_id = tests.company('rba')
union all select 'review_scores', to_jsonb(t) - 'updated_at' from public.review_scores t where t.company_id = tests.company('rba')
union all select 'goals', to_jsonb(t) - 'updated_at' from public.goals t where t.company_id = tests.company('rba')
union all select 'goal_notes', to_jsonb(t) - 'updated_at' from public.goal_notes t where t.company_id = tests.company('rba')
union all select 'cycle_omissions', to_jsonb(t) from public.cycle_omissions t where t.company_id = tests.company('rba');
-- Every row is what it was before the move, but the two edited since.
select tests.assert(
  not exists ((select * from b_rows where not (row->>'id' in (tests.id('g_aug_e2')::text, tests.id('rv_aug_e2')::text))
               except all
               select * from a_rows where not (row->>'id' in (tests.id('g_aug_e2')::text, tests.id('rv_aug_e2')::text)))
              union all
              (select * from a_rows where not (row->>'id' in (tests.id('g_aug_e2')::text, tests.id('rv_aug_e2')::text))
               except all
               select * from b_rows where not (row->>'id' in (tests.id('g_aug_e2')::text, tests.id('rv_aug_e2')::text))))
  and (select count(*) = 13 from b_rows) and (select count(*) = 13 from a_rows),
  'put_back: a row of rba is not what it was before the move'
);
-- And those two went back as they are now, in their month, which takes them as a month's.
select tests.assert(
  (select cycle_id = tests.id('r_aug') and review_id is null and progress = 60
     from public.goals where id = tests.id('g_aug_e2'))
  and (select cycle_id = tests.id('r_aug') and started_on is null and done_on is null
              and status = 'complete' and gsr_score = 50 and completed_at is not null
     from public.reviews where id = tests.id('rv_aug_e2')),
  'put_back: an edit made since the move did not go back with its row'
);
select tests.assert(
  not exists (
    (select * from fp_before where slug in ('klasik', 'kingdom')
     except
     select * from tests.fingerprint() where slug in ('klasik', 'kingdom'))
    union all
    (select * from tests.fingerprint() where slug in ('klasik', 'kingdom')
     except
     select * from fp_before where slug in ('klasik', 'kingdom'))
  ),
  'put_back: a fingerprint of klasik or kingdom changed'
);
-- The monthly rules hold again: the closed month refuses its goals, a reopen of the review done
-- since waits for the month, and nobody starts a GSR.
select tests.assert_raises(
  format($q$update public.goals set progress = 10 where id = %L$q$, tests.id('g_aug_e1')),
  'This review cycle is closed. Reopen it to change its goals.'
);
select tests.act_as(tests.id('c_admin'));
select tests.assert_raises(
  format($q$update public.reviews set status = 'in_progress', completed_at = null where id = %L$q$,
         tests.id('rv_aug_e2')),
  'This review cycle is closed. Reopen the cycle first.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('c_e5'));
select tests.assert_raises(
  format($q$insert into public.reviews (company_id, employee_id) values (%L, %L)$q$,
         tests.company('rba'), tests.id('c_e5')),
  'GSRs on demand are not turned on for this company.'
);
reset role; select set_config('request.jwt.claims', '', true);
