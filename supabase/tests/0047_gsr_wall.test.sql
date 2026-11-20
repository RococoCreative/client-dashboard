-- 0047_gsr_wall.test.sql
-- Proves the wall 0047 puts around GSRs on demand: every company starts on periods, no signed-in
-- account changes the format (Rococo admins included), the change run by hand in the database
-- must name the one company it is for and touches no other, a new company is born on periods
-- unless the SQL editor names it, and everything 0046 put on every company is taken back for a
-- company on periods (and is gone after a re-paste): no member opens a cycle, a month takes any
-- dates again, a cycle's kind follows its cadence, weekly cycles are gone, a person's rhythm
-- decides nothing about whose GSR a month holds, and a manager sets no rhythm. Rhythm takes None
-- and Daily, and once a company is on demand its managers set the rhythm, and only the rhythm,
-- of the people they lead.
--
-- The cases that need every company on periods run before a_named_company_moves.
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

-- Setup, as system. g_e1 reports to g_mgr; nobody leads g_e2 but the admins.
select tests.create_person('g_owner', tests.company('rba'), 'owner');
select tests.create_person('g_admin', tests.company('rba'), 'admin');
select tests.create_person('g_mgr', tests.company('rba'), 'manager');
select tests.create_person('g_e1', tests.company('rba'));
select tests.create_person('g_e2', tests.company('rba'));
select tests.create_person('g_rococo', null, 'employee', true);
update public.profiles set view_all_divisions = true where id in (tests.id('g_owner'), tests.id('g_admin'));
update public.profiles set reports_to = tests.id('g_mgr') where id = tests.id('g_e1');

-- ---------------------------------------------------------------------------------------
-- The setting
-- ---------------------------------------------------------------------------------------

-- case: mode_defaults_to_periods
select tests.assert(
  (select count(*) = 3 and bool_and(gsr_mode = 'periods')
     from public.companies where slug in ('kingdom', 'klasik', 'rba')),
  'mode_default: a company did not start on periods'
);

-- case: no_signed_in_account_changes_the_mode
select tests.act_as(tests.id('g_owner'));
select tests.assert_raises(
  format($q$update public.companies set gsr_mode = 'on_demand' where id = %L$q$, tests.company('rba')),
  'The GSR format is changed by Rococo in the database.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('g_admin'));
select tests.assert_raises(
  format($q$update public.companies set gsr_mode = 'on_demand' where id = %L$q$, tests.company('rba')),
  'The GSR format is changed by Rococo in the database.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('g_rococo'));
select tests.assert_raises(
  format($q$update public.companies set gsr_mode = 'on_demand' where id = %L$q$, tests.company('rba')),
  'The GSR format is changed by Rococo in the database.'
);
reset role; select set_config('request.jwt.claims', '', true);

-- case: the_change_must_name_the_company
-- As the SQL editor. Nothing named, the wrong company named, and a statement that reaches every
-- company while naming one: each is refused, and nothing moves.
select tests.assert_raises(
  format($q$update public.companies set gsr_mode = 'on_demand' where id = %L$q$, tests.company('rba')),
  'Name the company this change is for: set hub.gsr_on_demand_for to its slug in the same transaction.'
);
select set_config('hub.gsr_on_demand_for', 'klasik', true);
select tests.assert_raises(
  format($q$update public.companies set gsr_mode = 'on_demand' where id = %L$q$, tests.company('rba')),
  'Name the company this change is for: set hub.gsr_on_demand_for to its slug in the same transaction.'
);
select set_config('hub.gsr_on_demand_for', 'rba', true);
select tests.assert_raises(
  $q$update public.companies set gsr_mode = 'on_demand'$q$,
  'Name the company this change is for: set hub.gsr_on_demand_for to its slug in the same transaction.'
);
-- A move is judged by the company it is, not the slug the same statement gives it.
select set_config('hub.gsr_on_demand_for', 'klasik-two', true);
select tests.assert_raises(
  format($q$update public.companies set slug = 'klasik-two', gsr_mode = 'on_demand' where id = %L$q$, tests.company('klasik')),
  'Name the company this change is for: set hub.gsr_on_demand_for to its slug in the same transaction.'
);
select set_config('hub.gsr_on_demand_for', '', true);
select tests.assert(
  (select bool_and(gsr_mode = 'periods') from public.companies where slug in ('kingdom', 'klasik', 'rba')),
  'must_name: a refused change moved a company'
);

-- case: a_company_is_born_on_periods
-- A new company cannot skip the rules above: a signed-in writer creates it on periods only, and
-- the SQL editor creates it on demand only by naming it.
select tests.act_as(tests.id('g_rococo'));
insert into public.companies (slug, name) values ('sample-born-47', 'Sample born 47');
select tests.assert_raises(
  $q$insert into public.companies (slug, name, gsr_mode) values ('sample-eager-47', 'Sample eager 47', 'on_demand')$q$,
  'The GSR format is changed by Rococo in the database.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select gsr_mode = 'periods' from public.companies where slug = 'sample-born-47')
  and not exists (select 1 from public.companies where slug = 'sample-eager-47'),
  'born_on_periods: a new company was not on periods, or the refused one landed'
);
select tests.assert_raises(
  $q$insert into public.companies (slug, name, gsr_mode) values ('sample-unnamed-47', 'Sample unnamed 47', 'on_demand')$q$,
  'Name the company this change is for: set hub.gsr_on_demand_for to its slug in the same transaction.'
);
select set_config('hub.gsr_on_demand_for', 'rba', true);
select tests.assert_raises(
  $q$insert into public.companies (slug, name, gsr_mode) values ('sample-unnamed-47', 'Sample unnamed 47', 'on_demand')$q$,
  'Name the company this change is for: set hub.gsr_on_demand_for to its slug in the same transaction.'
);
select set_config('hub.gsr_on_demand_for', '', true);

-- case: what_0046_put_on_every_company_is_gone
-- Read after the harness has pasted 0046 again and then 0047, so this is the state a re-paste
-- leaves too.
select tests.assert(
  not exists (select 1 from pg_policies
               where schemaname = 'public' and tablename = 'review_cycles'
                 and policyname = 'Members open a GSR period')
  and not exists (select 1 from pg_trigger
                   where tgrelid = 'public.reviews'::regclass and tgname = 'reviews_guard_rhythm')
  and to_regprocedure('public.guard_review_rhythm()') is null
  and to_regprocedure('private.gsr_period_ok(text, date, date)') is null
  and to_regprocedure('private.gsr_period_name(text, date, date)') is null
  and to_regprocedure('private.person_gsr_cadence(uuid)') is null,
  'gone: something 0047 takes back from 0046 is still there'
);

-- ---------------------------------------------------------------------------------------
-- What 0047 takes back from 0046, for a company on periods
-- ---------------------------------------------------------------------------------------

-- case: members_cannot_open_a_cycle
-- A whole calendar month, so nothing but the missing policy can refuse it.
select tests.act_as(tests.id('g_e1'));
select tests.assert_raises(
  format($q$insert into public.review_cycles (company_id, name, cadence, period_start, period_end)
            values (%L, 'Mine 47', 'monthly', '2031-08-01', '2031-08-31')$q$, tests.company('rba')),
  '%row-level security%'
);
reset role; select set_config('request.jwt.claims', '', true);

-- case: a_month_takes_any_dates_again
select tests.act_as(tests.id('g_admin'));
insert into public.review_cycles (company_id, name, cadence, period_start, period_end)
values (tests.company('rba'), 'Sample odd month 47', 'monthly', '2026-12-03', '2026-12-28');
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select kind = 'gsr' and period_start = '2026-12-03' and period_end = '2026-12-28'
     from public.review_cycles where name = 'Sample odd month 47'),
  'any_dates: a month with dates of the admin''s choosing did not land as a GSR'
);

-- case: kind_follows_the_cadence
select tests.act_as(tests.id('g_admin'));
update public.review_cycles set cadence = 'custom' where name = 'Sample odd month 47';
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select cadence = 'custom' and kind = 'review' from public.review_cycles where name = 'Sample odd month 47'),
  'kind_follows: the kind did not follow the cadence'
);
-- A kind sent with the row is overwritten from the cadence.
select tests.act_as(tests.id('g_admin'));
insert into public.review_cycles (company_id, name, kind, cadence, period_start, period_end)
values (tests.company('rba'), 'Sample year 47', 'gsr', 'annual', '2031-01-01', '2031-12-31');
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select kind = 'review' from public.review_cycles where name = 'Sample year 47'),
  'kind_follows: a kind sent with an annual cycle was kept'
);

-- case: weekly_cycles_are_gone
select tests.act_as(tests.id('g_admin'));
select tests.assert_raises(
  format($q$insert into public.review_cycles (company_id, name, cadence, period_start, period_end)
            values (%L, 'Sample week 47', 'weekly', '2031-06-02', '2031-06-08')$q$, tests.company('rba')),
  '%review_cycles_cadence_check%'
);
reset role; select set_config('request.jwt.claims', '', true);

-- case: rhythm_no_longer_blocks_a_month
select tests.act_as(tests.id('g_admin'));
update public.profiles set gsr_cadence = 'weekly' where id = tests.id('g_e1');
insert into public.review_cycles (company_id, name, cadence, period_start, period_end)
values (tests.company('rba'), 'Sample month 47', 'monthly', '2031-09-01', '2031-09-30');
insert into public.reviews (cycle_id, company_id, employee_id)
select c.id, c.company_id, tests.id('g_e1') from public.review_cycles c where c.name = 'Sample month 47';
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select gsr_cadence = 'weekly' from public.profiles where id = tests.id('g_e1'))
  and exists (select 1 from public.reviews r join public.review_cycles c on c.id = r.cycle_id
               where c.name = 'Sample month 47' and r.employee_id = tests.id('g_e1')),
  'rhythm_no_block: a weekly person''s review in a month did not open'
);

-- case: periods_manager_cannot_set_a_rhythm
select tests.act_as(tests.id('g_mgr'));
select tests.assert(
  tests.rows_of(format($q$update public.profiles set gsr_cadence = 'monthly' where id = %L$q$, tests.id('g_e1'))) = 0,
  'periods_manager: a manager set a rhythm in a company on periods'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select gsr_cadence = 'weekly' from public.profiles where id = tests.id('g_e1')),
  'periods_manager: the rhythm moved'
);

-- case: rhythm_takes_none_and_daily
select tests.act_as(tests.id('g_admin'));
select tests.assert(
  tests.rows_of(format($q$update public.profiles set gsr_cadence = 'none' where id = %L$q$, tests.id('g_e1'))) = 1,
  'none_and_daily: an admin could not set None'
);
select tests.assert(
  tests.rows_of(format($q$update public.profiles set gsr_cadence = 'daily' where id = %L$q$, tests.id('g_e1'))) = 1,
  'none_and_daily: an admin could not set Daily'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select gsr_cadence = 'daily' from public.profiles where id = tests.id('g_e1')),
  'none_and_daily: the rhythm did not land as Daily'
);

-- ---------------------------------------------------------------------------------------
-- Moving one company
-- ---------------------------------------------------------------------------------------

-- case: a_named_company_moves
select set_config('hub.gsr_on_demand_for', 'rba', true);
update public.companies set gsr_mode = 'on_demand' where id = tests.company('rba');
select set_config('hub.gsr_on_demand_for', '', true);
select tests.assert(
  (select gsr_mode = 'on_demand' from public.companies where slug = 'rba')
  and (select bool_and(gsr_mode = 'periods') from public.companies where slug in ('kingdom', 'klasik')),
  'named_moves: RBA did not move, or another company moved with it'
);
select tests.assert(
  exists (select 1 from public.audit_events
           where table_name = 'companies' and row_id = tests.company('rba')::text
             and changed->'gsr_mode'->>'new' = 'on_demand'),
  'named_moves: the change was not audited'
);

-- case: on_demand_manager_sets_only_the_rhythm
select tests.act_as(tests.id('g_mgr'));
select tests.assert(
  tests.rows_of(format($q$update public.profiles set gsr_cadence = 'weekly' where id = %L$q$, tests.id('g_e1'))) = 1,
  'on_demand_manager: a manager could not set a led person''s rhythm'
);
select tests.assert_raises(
  format($q$update public.profiles set title = 'Sample title 47' where id = %L$q$, tests.id('g_e1')),
  'A manager can change only the GSR rhythm of the people they lead.'
);
select tests.assert_raises(
  format($q$update public.profiles set gsr_cadence = 'biweekly', phone = '555-0147' where id = %L$q$, tests.id('g_e1')),
  'A manager can change only the GSR rhythm of the people they lead.'
);
select tests.assert_raises(
  format($q$update public.profiles set reports_to = null where id = %L$q$, tests.id('g_e1')),
  'A manager can change only the GSR rhythm of the people they lead.'
);
select tests.assert(
  tests.rows_of(format($q$update public.profiles set gsr_cadence = 'weekly' where id = %L$q$, tests.id('g_e2'))) = 0,
  'on_demand_manager: a manager set the rhythm of someone they do not lead'
);
select tests.assert_raises(
  format($q$update public.profiles set gsr_cadence = 'weekly' where id = %L$q$, tests.id('g_mgr')),
  'Only admins can change employment details.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select gsr_cadence = 'weekly' and title is distinct from 'Sample title 47' and reports_to = tests.id('g_mgr')
     from public.profiles where id = tests.id('g_e1'))
  and (select gsr_cadence = 'monthly' from public.profiles where id = tests.id('g_e2'))
  and (select gsr_cadence = 'monthly' from public.profiles where id = tests.id('g_mgr')),
  'on_demand_manager: the rhythm did not land, or another column or person moved'
);
