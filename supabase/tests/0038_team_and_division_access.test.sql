-- 0038_team_and_division_access.test.sql
-- Proves the access rules of 0038: a manager sees and leads the people below them in the
-- reporting chain and nobody else (unless a division view shows them employees), an employee sees
-- themselves only even when someone reports to them, an admin who does not see every division
-- sees and manages only their divisions plus anyone unplaced, owners and admins who see every
-- division see the whole company, pay stays with admins, a manager writes a report's monthly goals
-- and notes but never ratings or sign-off, the profile guards keep placement and view access where
-- the design puts them, a new row's RETURNING is judged on its own columns, divisions and cycles
-- are changed only by a full-scope admin, invitations follow the person, the directory is the
-- company's, private stays private, and the one-shot backfill never runs twice.
--
-- Runs inside one transaction the harness opens and rolls back; never begin or commit here.
-- State carries from case to case, so each case puts back, as system, what it changed.

-- Test-local helpers, gone with the rollback. Neither is security definer, so each answers as
-- whoever is acting.
create function tests.sees(p_table text, p_name text)
returns boolean
language plpgsql
as $$
declare
  v_found boolean;
begin
  execute format(
    'select exists (select 1 from public.%I where %I = $1)',
    p_table, case when p_table = 'profiles' then 'id' else 'employee_id' end
  ) into v_found using tests.id(p_name);
  return v_found;
end;
$$;

-- Sets the claims a signed-in request carries without leaving system, so a helper answers for
-- that person while every row stays readable to the comparison around it.
create function tests.claims_of(p_name text)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', tests.user_of(tests.id(p_name)), 'role', 'authenticated')::text, true);
end;
$$;
grant execute on function tests.sees(text, text), tests.claims_of(text) to authenticated;

-- Setup, as system.
select tests.create_person('r_owner', tests.company('rba'), 'owner');
select tests.create_person('r_full', tests.company('rba'), 'admin');
select tests.create_person('r_north_admin', tests.company('rba'), 'admin');
select tests.create_person('r_south_admin', tests.company('rba'), 'admin');
select tests.create_person('r_mgr', tests.company('rba'), 'manager');
select tests.create_person('r_e1', tests.company('rba'));
select tests.create_person('r_e2', tests.company('rba'));
select tests.create_person('r_peer', tests.company('rba'));
select tests.create_person('r_south', tests.company('rba'));
select tests.create_person('r_both', tests.company('rba'));
select tests.create_person('r_unplaced', tests.company('rba'));
select tests.create_person('r_emp_lead', tests.company('rba'));
select tests.create_person('r_e3', tests.company('rba'));
select tests.create_person('r_inactive_mgr', tests.company('rba'), 'manager');
select tests.create_person('l_admin', tests.company('klasik'), 'admin');
select tests.create_person('nobody', null);
select tests.create_person('rococo', null, 'employee', true);

insert into public.company_divisions (company_id, name) values
  (tests.company('rba'), 'Test North'), (tests.company('rba'), 'Test South'), (tests.company('rba'), 'Test West');
insert into tests.fixture (name, id)
select case name when 'Test North' then 'div_north' when 'Test South' then 'div_south' else 'div_west' end, id
  from public.company_divisions where name in ('Test North', 'Test South', 'Test West');

update public.profiles set view_all_divisions = true where id = tests.id('r_full');
update public.profiles set division_ids = array[tests.id('div_north')] where id = tests.id('r_owner');
update public.profiles
   set division_ids = array[tests.id('div_north')], view_division_ids = array[tests.id('div_north')]
 where id = tests.id('r_north_admin');
update public.profiles
   set division_ids = array[tests.id('div_south')], view_division_ids = array[tests.id('div_south'), tests.id('div_west')]
 where id = tests.id('r_south_admin');
update public.profiles set division_ids = array[tests.id('div_north')] where id = tests.id('r_mgr');
update public.profiles set division_ids = array[tests.id('div_south')], reports_to = tests.id('r_mgr') where id = tests.id('r_e1');
update public.profiles set division_ids = array[tests.id('div_south')], reports_to = tests.id('r_e1') where id = tests.id('r_e2');
update public.profiles set division_ids = array[tests.id('div_north')], reports_to = tests.id('r_owner') where id = tests.id('r_peer');
update public.profiles set division_ids = array[tests.id('div_south')] where id = tests.id('r_south');
update public.profiles set division_ids = array[tests.id('div_north'), tests.id('div_south')] where id = tests.id('r_both');
update public.profiles set division_ids = array[tests.id('div_south')], reports_to = tests.id('r_emp_lead') where id = tests.id('r_e3');
update public.profiles set is_active = false where id = tests.id('r_inactive_mgr');

insert into public.review_cycles (company_id, name, cadence, period_start, period_end)
values (tests.company('rba'), 'Test December', 'monthly', '2026-12-01', '2026-12-31'),
       (tests.company('rba'), 'Test January', 'monthly', '2027-01-01', '2027-01-31');
insert into public.reviews (cycle_id, company_id, employee_id)
select c.id, c.company_id, p.id
  from public.review_cycles c
  cross join (values (tests.id('r_e1')), (tests.id('r_south')), (tests.id('r_both')),
                     (tests.id('r_unplaced')), (tests.id('r_peer')), (tests.id('r_e3'))) as p (id)
 where c.name = 'Test December';
insert into public.goals (company_id, employee_id, cycle_id, scope, kind, title)
select c.company_id, p.id, c.id, 'cycle', 'role', 'December goal'
  from public.review_cycles c
  cross join (values (tests.id('r_e1')), (tests.id('r_e2')), (tests.id('r_south')),
                     (tests.id('r_both')), (tests.id('r_unplaced'))) as p (id)
 where c.name = 'Test December';
insert into public.employee_kpis (company_id, employee_id, year, name)
select tests.company('rba'), p.id, 2026, 'Test KPI'
  from (values (tests.id('r_e1')), (tests.id('r_south')), (tests.id('r_both')), (tests.id('r_unplaced'))) as p (id);
insert into public.compensation_items (company_id, employee_id, name, annual_amount)
select tests.company('rba'), p.id, 'Test salary', 50000
  from (values (tests.id('r_e1')), (tests.id('r_south')), (tests.id('r_both')), (tests.id('r_unplaced'))) as p (id);
insert into public.employee_financials (company_id, employee_id, year, metric)
select tests.company('rba'), p.id, 2026, 'Test revenue'
  from (values (tests.id('r_e1')), (tests.id('r_south'))) as p (id);

-- case: manager_sees_their_chain_and_not_their_peers
select tests.act_as(tests.id('r_mgr'));
select tests.assert(tests.sees('profiles', 'r_e1'), 'manager_chain: a manager cannot see a direct report');
select tests.assert(tests.sees('profiles', 'r_e2'), 'manager_chain: a manager cannot see a report''s report');
select tests.assert(tests.sees('reviews', 'r_e1'), 'manager_chain: a manager cannot read a report''s review');
select tests.assert(tests.sees('goals', 'r_e2'), 'manager_chain: a manager cannot read a second-level goal');
select tests.assert(tests.sees('employee_kpis', 'r_e1'), 'manager_chain: a manager cannot read a report''s KPIs');
select tests.assert(not tests.sees('profiles', 'r_peer'), 'manager_chain: a manager sees a peer');
select tests.assert(not tests.sees('profiles', 'r_south'), 'manager_chain: a manager sees someone outside their chain');
select tests.assert(not tests.sees('profiles', 'r_unplaced'), 'manager_chain: a manager sees an unplaced person');
select tests.assert(not tests.sees('profiles', 'r_owner'), 'manager_chain: a manager sees the owner');
select tests.assert(not tests.sees('reviews', 'r_south'), 'manager_chain: a manager reads a review outside their chain');
select tests.assert(not tests.sees('compensation_items', 'r_e1'), 'manager_chain: a manager reads a report''s pay');
select tests.assert(not tests.sees('employee_financials', 'r_e1'), 'manager_chain: a manager reads a report''s financial figures');
select tests.assert(
  (select count(*) from private.team_ids()) = 2,
  'manager_chain: the team is not exactly the two people below the manager'
);
reset role; select set_config('request.jwt.claims', '', true);

-- case: reassigning_reports_to_moves_visibility
update public.profiles set reports_to = tests.id('r_owner') where id = tests.id('r_e1');
select tests.act_as(tests.id('r_mgr'));
select tests.assert(not tests.sees('profiles', 'r_e1'), 'reassign: the old manager still sees the person');
select tests.assert(not tests.sees('goals', 'r_e2'), 'reassign: the old manager still reads the person''s report');
reset role; select set_config('request.jwt.claims', '', true);
update public.profiles set reports_to = tests.id('r_mgr') where id = tests.id('r_e1');

-- case: employee_sees_themselves_only
select tests.act_as(tests.id('r_south'));
select tests.assert(
  (select count(*) from public.profiles) = 1 and tests.sees('profiles', 'r_south'),
  'employee_self: an employee sees a profile other than their own'
);
select tests.assert(
  (select count(*) from public.reviews) = 1 and tests.sees('reviews', 'r_south'),
  'employee_self: an employee reads a review other than their own'
);
select tests.assert(
  (select count(*) from public.goals) = 1 and (select count(*) from public.employee_kpis) = 1,
  'employee_self: an employee reads goals or KPIs other than their own'
);
reset role; select set_config('request.jwt.claims', '', true);

-- case: employee_with_reports_gets_nothing
select tests.act_as(tests.id('r_emp_lead'));
select tests.assert(not tests.sees('profiles', 'r_e3'), 'employee_lead: an employee sees the person who reports to them');
select tests.assert(not tests.sees('reviews', 'r_e3'), 'employee_lead: an employee reads their report''s review');
select tests.assert(
  (select count(*) from private.team_ids()) = 0 and (select count(*) from private.led_person_ids()) = 0,
  'employee_lead: an employee leads someone'
);
reset role; select set_config('request.jwt.claims', '', true);

-- case: north_admin_sees_north_both_and_unplaced
select tests.act_as(tests.id('r_north_admin'));
select tests.assert(tests.sees('profiles', 'r_peer'), 'north_admin: cannot see a North employee');
select tests.assert(tests.sees('profiles', 'r_both'), 'north_admin: cannot see someone in Both');
select tests.assert(tests.sees('profiles', 'r_unplaced'), 'north_admin: cannot see an unplaced person');
select tests.assert(tests.sees('profiles', 'r_mgr'), 'north_admin: cannot see a North manager');
select tests.assert(tests.sees('profiles', 'r_full'), 'north_admin: cannot see an unplaced admin');
select tests.assert(not tests.sees('profiles', 'r_south'), 'north_admin: sees a South employee');
select tests.assert(not tests.sees('profiles', 'r_e1'), 'north_admin: sees a South employee in someone else''s chain');
select tests.assert(not tests.sees('profiles', 'r_south_admin'), 'north_admin: sees a South admin');
select tests.assert(not tests.sees('profiles', 'r_owner'), 'north_admin: sees a North owner ranked above them');
select tests.assert(not tests.sees('reviews', 'r_south'), 'north_admin: reads a South review');
select tests.assert(not tests.sees('goals', 'r_south'), 'north_admin: reads a South goal');
select tests.assert(not tests.sees('employee_kpis', 'r_south'), 'north_admin: reads South KPIs');
select tests.assert(not tests.sees('compensation_items', 'r_south'), 'north_admin: reads South pay');
select tests.assert(not tests.sees('employee_financials', 'r_south'), 'north_admin: reads South financial figures');
select tests.assert(tests.sees('reviews', 'r_both'), 'north_admin: cannot read a Both review');
select tests.assert(tests.sees('compensation_items', 'r_unplaced'), 'north_admin: cannot read unplaced pay');
do $$
declare
  v_rows integer;
begin
  update public.employee_kpis set name = 'Changed' where employee_id = tests.id('r_south');
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'north_admin: % South KPI row(s) changed', v_rows;
  end if;
  update public.employee_kpis set name = 'Changed' where employee_id = tests.id('r_both');
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'north_admin: the Both KPI did not change (% rows)', v_rows;
  end if;
end;
$$;
select tests.assert_raises(
  format($q$insert into public.compensation_items (company_id, employee_id, name) values (%L, %L, 'Bonus')$q$,
         tests.company('rba'), tests.id('r_south')),
  '%row-level security%'
);
reset role; select set_config('request.jwt.claims', '', true);

-- case: full_scope_admin_and_owner_see_the_whole_company
select tests.act_as(tests.id('r_full'));
select tests.assert(
  (select count(*) from public.profiles) = (select count(*) from public.profile_directory where company_id = tests.company('rba')),
  'full_scope: an admin who sees every division does not see the whole company'
);
select tests.assert(
  (select count(*) from public.reviews) = 6 and (select count(*) from public.compensation_items) = 4,
  'full_scope: an admin who sees every division misses reviews or pay'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('r_owner'));
select tests.assert(
  (select count(*) from public.profiles) = (select count(*) from public.profile_directory where company_id = tests.company('rba')),
  'owner: an owner does not see the whole company'
);
select tests.assert(
  (select count(*) from public.reviews) = 6 and (select count(*) from public.employee_financials) = 2,
  'owner: an owner misses reviews or financial figures'
);
select tests.assert(not tests.sees('profiles', 'l_admin'), 'owner: an owner sees another company');
reset role; select set_config('request.jwt.claims', '', true);

-- case: manager_division_view_shows_employees_only
update public.profiles set view_division_ids = array[tests.id('div_north')] where id = tests.id('r_mgr');
select tests.act_as(tests.id('r_mgr'));
select tests.assert(tests.sees('profiles', 'r_peer'), 'manager_view: a North view does not show a North employee');
select tests.assert(tests.sees('reviews', 'r_both'), 'manager_view: a North view does not show a Both employee''s review');
select tests.assert(not tests.sees('profiles', 'r_north_admin'), 'manager_view: a North view shows a North admin');
select tests.assert(not tests.sees('profiles', 'r_owner'), 'manager_view: a North view shows a North owner');
select tests.assert(not tests.sees('profiles', 'r_south'), 'manager_view: a North view shows a South employee');
select tests.assert(not tests.sees('compensation_items', 'r_both'), 'manager_view: a manager reads pay through a division view');
reset role; select set_config('request.jwt.claims', '', true);
update public.profiles set view_division_ids = '{}' where id = tests.id('r_mgr');

-- case: the_row_rule_and_the_set_agree
-- sees_profile (one row) and viewable_person_ids (the whole company) state one rule twice.
do $$
declare
  v_name text;
begin
  foreach v_name in array array['r_owner', 'r_full', 'r_north_admin', 'r_south_admin', 'r_mgr', 'r_e1', 'r_emp_lead'] loop
    perform tests.claims_of(v_name);
    if (select coalesce(array_agg(v.id order by v.id), '{}') from private.viewable_person_ids() as v (id))
       is distinct from
       (select coalesce(array_agg(p.id order by p.id), '{}') from public.profiles p
         where private.sees_profile(p.id, p.company_id, p.role, p.division_ids, p.reports_to)) then
      raise exception 'row_rule_and_set: the two disagree for %', v_name;
    end if;
  end loop;
end;
$$;
select set_config('request.jwt.claims', '', true);

-- case: helpers_return_nothing_for_rococo_inactive_and_no_company
do $$
declare
  v_name text;
begin
  foreach v_name in array array['rococo', 'r_inactive_mgr', 'nobody'] loop
    perform tests.claims_of(v_name);
    if (select count(*) from private.viewable_person_ids()) <> 0
       or (select count(*) from private.manageable_person_ids()) <> 0
       or (select count(*) from private.led_person_ids()) <> 0
       or (select count(*) from private.team_ids()) <> 0 then
      raise exception 'helpers_empty: a helper returned people for %', v_name;
    end if;
  end loop;
  perform tests.claims_of('rococo');
  if not private.has_full_scope() then
    raise exception 'helpers_empty: Rococo is not full scope';
  end if;
  perform tests.claims_of('r_inactive_mgr');
  if private.has_full_scope() then
    raise exception 'helpers_empty: an inactive person is full scope';
  end if;
end;
$$;
select set_config('request.jwt.claims', '', true);

-- case: manager_writes_monthly_goals_and_notes_not_ratings
select tests.act_as(tests.id('r_mgr'));
insert into public.goals (company_id, employee_id, cycle_id, scope, kind, title)
select c.company_id, tests.id('r_e1'), c.id, 'cycle', 'professional', 'Set by the manager'
  from public.review_cycles c where c.name = 'Test December';
update public.goals set progress = 40 where employee_id = tests.id('r_e1') and title = 'December goal';
insert into public.goal_notes (goal_id, body)
select g.id, 'Talked it through' from public.goals g where g.employee_id = tests.id('r_e1') and g.title = 'December goal';
select tests.assert_raises(
  format($q$insert into public.goals (company_id, employee_id, scope, kind, title, year)
            values (%L, %L, 'year', 'professional', 'A year goal', 2027)$q$,
         tests.company('rba'), tests.id('r_e1')),
  '%row-level security%'
);
select tests.assert_raises(
  format($q$insert into public.impact_scores (company_id, employee_id, pillar_id, criterion_id, rating)
            select %L, %L, k.pillar_id, k.id, 3 from public.gsr_criteria k
             where k.company_id = %L limit 1$q$,
         tests.company('rba'), tests.id('r_e1'), tests.company('rba')),
  '%row-level security%'
);
select tests.assert_raises(
  format($q$insert into public.review_scores (review_id, company_id, pillar_id, rating)
            select r.id, r.company_id, p.id, 3 from public.reviews r
              join public.gsr_pillars p on p.company_id = r.company_id
             where r.employee_id = %L limit 1$q$,
         tests.id('r_e1')),
  '%row-level security%'
);
select tests.assert_raises(
  format($q$insert into public.reviews (cycle_id, company_id, employee_id, employee_reflection)
            select c.id, c.company_id, %L, 'In their words' from public.review_cycles c where c.name = 'Test January'$q$,
         tests.id('r_e2')),
  '%row-level security%'
);
insert into public.reviews (cycle_id, company_id, employee_id)
select c.id, c.company_id, tests.id('r_e2') from public.review_cycles c where c.name = 'Test January';
select tests.assert_raises(
  format($q$insert into public.reviews (cycle_id, company_id, employee_id)
            select c.id, c.company_id, %L from public.review_cycles c where c.name = 'Test January'$q$,
         tests.id('r_peer')),
  '%row-level security%'
);
do $$
declare
  v_rows integer;
begin
  update public.reviews set gsr_score = 80, status = 'complete', completed_at = now()
   where employee_id = tests.id('r_e1');
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'manager_writes: a manager locked a report''s month (% rows)', v_rows;
  end if;
end;
$$;
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  exists (select 1 from public.goals where title = 'Set by the manager' and created_by = tests.id('r_mgr'))
  and (select progress from public.goals where employee_id = tests.id('r_e1') and title = 'December goal') = 40
  and exists (select 1 from public.goal_notes where body = 'Talked it through' and author_id = tests.id('r_mgr'))
  and exists (select 1 from public.reviews r join public.review_cycles c on c.id = r.cycle_id
               where c.name = 'Test January' and r.employee_id = tests.id('r_e2') and r.status = 'not_started'),
  'manager_writes: the goal, its progress, the note or the opened GSR did not land'
);

-- case: a_person_cannot_widen_their_own_access
select tests.act_as(tests.id('r_south'));
update public.profiles set full_name = 'Renamed South', title = 'Lead', phone = '555-0100' where id = tests.id('r_south');
select tests.assert_raises(
  format($q$update public.profiles set view_all_divisions = true where id = %L$q$, tests.id('r_south')),
  'Only an owner or Rococo can choose which divisions someone can see.'
);
select tests.assert_raises(
  format($q$update public.profiles set division_ids = %L where id = %L$q$,
         array[tests.id('div_north')], tests.id('r_south')),
  'Only admins can change employment details.'
);
select tests.assert_raises(
  format($q$update public.profiles set reports_to = %L where id = %L$q$, tests.id('r_mgr'), tests.id('r_south')),
  'Only admins can change employment details.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('r_mgr'));
select tests.assert_raises(
  format($q$update public.profiles set view_division_ids = %L where id = %L$q$,
         array[tests.id('div_south')], tests.id('r_mgr')),
  'Only an owner or Rococo can choose which divisions someone can see.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select full_name = 'Renamed South' and title = 'Lead' and phone = '555-0100'
     from public.profiles where id = tests.id('r_south')),
  'self_access: a person could not change their own name, title or phone'
);

-- case: only_an_owner_sets_view_access_and_a_role_change_clears_it
select tests.act_as(tests.id('r_full'));
select tests.assert_raises(
  format($q$update public.profiles set view_division_ids = %L where id = %L$q$,
         array[tests.id('div_north')], tests.id('r_mgr')),
  'Only an owner or Rococo can choose which divisions someone can see.'
);
select tests.assert_raises(
  $q$insert into public.profiles (email, company_id, role, view_all_divisions)
     values ('sample.viewer@rbaprojects.com', (select company_id from public.profiles where id = tests.id('r_full')), 'employee', true)$q$,
  'Only an owner or Rococo can choose which divisions someone can see.'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('r_owner'));
update public.profiles set view_division_ids = array[tests.id('div_north')] where id = tests.id('r_mgr');
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  exists (select 1 from public.audit_events
           where table_name = 'profiles' and row_id = tests.id('r_mgr')::text and changed ? 'view_division_ids'),
  'view_access: a change of view access was not audited'
);
select tests.act_as(tests.id('r_full'));
update public.profiles set role = 'employee' where id = tests.id('r_mgr');
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select view_division_ids = '{}' and not view_all_divisions from public.profiles where id = tests.id('r_mgr')),
  'view_access: a role change by a non-owner kept the view access'
);
update public.profiles set role = 'manager' where id = tests.id('r_mgr');

-- case: north_admin_places_only_inside_their_view
select tests.act_as(tests.id('r_north_admin'));
select tests.assert_raises(
  format($q$update public.profiles set division_ids = %L where id = %L$q$,
         array[tests.id('div_south')], tests.id('r_unplaced')),
  'You can only place people in divisions you can see.'
);
select tests.assert_raises(
  format($q$update public.profiles set division_ids = %L where id = %L$q$,
         array[tests.id('div_north')], tests.id('r_both')),
  'You can only place people in divisions you can see.'
);
select tests.assert_raises(
  format($q$update public.profiles set division_id = %L where id = %L$q$,
         tests.id('div_north'), tests.id('r_both')),
  'This person works in more than one division.%'
);
select tests.assert_raises(
  format($q$update public.profiles set division_ids = %L where id = %L$q$,
         array[tests.id('div_north')], tests.id('r_full')),
  'Only an owner or an admin who sees every division can put someone at your rank or above in a division.'
);
select tests.assert_raises(
  format($q$update public.profiles set reports_to = %L where id = %L$q$, tests.id('r_south'), tests.id('r_peer')),
  'You can only choose a manager you can see.'
);
update public.profiles set division_ids = array[tests.id('div_north')], title = 'Placed' where id = tests.id('r_unplaced');
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select division_ids = array[tests.id('div_north')] and division_id = tests.id('div_north')
     from public.profiles where id = tests.id('r_unplaced')),
  'placement: the North admin could not place someone in North, or the mirror did not follow'
);
update public.profiles set division_ids = '{}' where id = tests.id('r_unplaced');
-- A South subtree below a North person.
update public.profiles set reports_to = tests.id('r_peer') where id = tests.id('r_south');
select tests.act_as(tests.id('r_north_admin'));
select tests.assert_raises(
  format($q$update public.profiles set reports_to = %L where id = %L$q$, tests.id('r_north_admin'), tests.id('r_peer')),
  'Some of the people who report to this person are outside the divisions you can see%'
);
reset role; select set_config('request.jwt.claims', '', true);
update public.profiles set reports_to = null where id = tests.id('r_south');
select tests.assert(
  (select reports_to = tests.id('r_owner') from public.profiles where id = tests.id('r_peer')),
  'placement: the North admin captured a subtree'
);

-- case: an_added_row_reads_back
select tests.act_as(tests.id('r_owner'));
do $$
declare
  v_id uuid;
begin
  insert into public.profiles (email, full_name, company_id, role, division_ids)
  values ('sample.staff.south@rbaprojects.com', 'Sample South Staff', tests.company('rba'), 'employee',
          array[tests.id('div_south')])
  returning id into v_id;
  if v_id is null or not exists (select 1 from public.profiles where id = v_id) then
    raise exception 'added_row: the owner could not read back a row they added';
  end if;
end;
$$;
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('r_north_admin'));
do $$
declare
  v_id uuid;
begin
  insert into public.profiles (email, full_name, company_id, role, division_ids, reports_to)
  values ('sample.staff.north@rbaprojects.com', 'Sample North Staff', tests.company('rba'), 'employee',
          array[tests.id('div_north')], tests.id('r_north_admin'))
  returning id into v_id;
  if v_id is null or not exists (select 1 from public.profiles where id = v_id) then
    raise exception 'added_row: a North admin could not read back a North row they added';
  end if;
end;
$$;
select tests.assert_raises(
  format($q$insert into public.profiles (email, company_id, role, division_ids)
            values ('sample.staff.other@rbaprojects.com', %L, 'employee', %L)$q$,
         tests.company('rba'), array[tests.id('div_south')]),
  'You can only place people in divisions you can see.'
);
select tests.assert_raises(
  format($q$insert into public.profiles (email, company_id, role, reports_to)
            values ('sample.staff.other@rbaprojects.com', %L, 'employee', %L)$q$,
         tests.company('rba'), tests.id('r_south')),
  'You can only choose a manager you can see.'
);
reset role; select set_config('request.jwt.claims', '', true);

-- case: divisions_are_full_scope_config
select tests.act_as(tests.id('r_north_admin'));
select tests.assert_raises(
  format($q$insert into public.company_divisions (company_id, name) values (%L, 'Test East')$q$, tests.company('rba')),
  '%row-level security%'
);
do $$
declare
  v_rows integer;
begin
  delete from public.company_divisions where id = tests.id('div_south');
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'divisions: a North admin removed a division';
  end if;
end;
$$;
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('r_full'));
select tests.assert_raises(
  format($q$delete from public.company_divisions where id = %L$q$, tests.id('div_south')),
  'Move the % people out of Test South first.'
);
delete from public.company_divisions where id = tests.id('div_west');
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  not exists (select 1 from public.company_divisions where id = tests.id('div_west'))
  and (select view_division_ids = array[tests.id('div_south')] from public.profiles where id = tests.id('r_south_admin')),
  'divisions: removing an empty division did not strip it from view access'
);

-- case: only_a_full_scope_admin_changes_a_cycle
select tests.act_as(tests.id('r_north_admin'));
do $$
declare
  v_rows integer;
begin
  update public.review_cycles set status = 'closed' where name = 'Test December';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'cycles: a North admin closed a cycle';
  end if;
  delete from public.review_cycles where name = 'Test December';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'cycles: a North admin removed a cycle';
  end if;
end;
$$;
insert into public.review_cycles (company_id, name, cadence, period_start, period_end)
values (tests.company('rba'), 'Test February', 'monthly', '2027-02-01', '2027-02-28');
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('r_full'));
do $$
declare
  v_rows integer;
begin
  update public.review_cycles set theme = 'Safety' where name = 'Test February';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'cycles: a full-scope admin could not change a cycle';
  end if;
end;
$$;
reset role; select set_config('request.jwt.claims', '', true);

-- case: invitations_follow_the_person
insert into public.profiles (email, full_name, company_id, role, division_ids)
values ('sample.south.roster@rbaprojects.com', 'Sample South Roster', tests.company('rba'), 'employee',
        array[tests.id('div_south')]);
insert into public.invitations (company_id, email, role, profile_id)
select tests.company('rba'), 'sample.south.roster@rbaprojects.com', 'employee', p.id
  from public.profiles p where p.email = 'sample.south.roster@rbaprojects.com';
select tests.act_as(tests.id('r_north_admin'));
select tests.assert(
  not exists (select 1 from public.invitations where email = 'sample.south.roster@rbaprojects.com'),
  'invitations: a North admin reads a South person''s invitation'
);
delete from public.invitations where email = 'sample.south.roster@rbaprojects.com';
select tests.assert_raises(
  format($q$insert into public.invitations (company_id, email, role) values (%L, 'sample.south.roster@rbaprojects.com', 'employee')$q$,
         tests.company('rba')),
  'You can only invite people in the divisions you can see.'
);
insert into public.invitations (company_id, email, role)
values (tests.company('rba'), 'sample.new.north@rbaprojects.com', 'employee');
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  exists (select 1 from public.invitations where email = 'sample.south.roster@rbaprojects.com'),
  'invitations: a North admin removed a South person''s invitation'
);
select tests.act_as(tests.id('r_full'));
select tests.assert(
  exists (select 1 from public.invitations where email = 'sample.south.roster@rbaprojects.com'),
  'invitations: a full-scope admin cannot read a South invitation'
);
reset role; select set_config('request.jwt.claims', '', true);

-- case: the_directory_is_the_companys
update public.profiles set title = 'Site lead' where id = tests.id('r_south');
select set_config('tests.rba_people', (select count(*) from public.profiles where company_id = tests.company('rba'))::text, true);
select tests.act_as(tests.id('r_e3'));
select tests.assert(
  (select count(*) from public.profile_directory)::text = current_setting('tests.rba_people'),
  'directory: an employee does not read their whole company''s directory'
);
select tests.assert(
  (select title from public.profile_directory where id = tests.id('r_south')) = 'Site lead',
  'directory: a title change did not reach the directory'
);
select tests.assert(
  not exists (select 1 from public.profile_directory where company_id = tests.company('klasik')),
  'directory: an employee reads another company''s directory'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.assert(
  not exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'profile_directory'
                 and column_name in ('email', 'phone', 'role', 'division_ids', 'hire_date')),
  'directory: the directory carries more than names and titles'
);
select tests.assert(
  not exists (select 1 from public.profile_directory where id = tests.id('rococo')),
  'directory: a Rococo admin with no company is listed'
);

-- case: private_stays_private
select tests.act_as(tests.id('r_south'));
insert into public.goals (company_id, employee_id, scope, kind, title, year)
values (tests.company('rba'), tests.id('r_south'), 'year', 'personal', 'Private year goal', 2027);
insert into public.goal_private (goal_id, company_id, employee_id, action_steps)
select g.id, g.company_id, g.employee_id, '["Step one"]'::jsonb from public.goals g where g.title = 'Private year goal';
insert into public.goal_notes (goal_id, body)
select g.id, 'Only mine' from public.goals g where g.title = 'Private year goal';
select tests.assert(
  (select count(*) from public.goal_private) = 1 and (select count(*) from public.goal_notes where body = 'Only mine') = 1,
  'private: the owner cannot read their own private steps or yearly note'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('r_owner'));
select tests.assert(
  not exists (select 1 from public.goal_private) and not exists (select 1 from public.goal_notes where body = 'Only mine'),
  'private: the company owner reads private steps or a yearly note'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('r_full'));
select tests.assert(
  not exists (select 1 from public.goal_private) and not exists (select 1 from public.goal_notes where body = 'Only mine'),
  'private: a full-scope admin reads private steps or a yearly note'
);
reset role; select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('rococo'));
select tests.assert(
  not exists (select 1 from public.goal_private) and not exists (select 1 from public.goal_notes where body = 'Only mine'),
  'private: Rococo reads private steps or a yearly note'
);
select tests.assert(
  exists (select 1 from public.goal_notes where body = 'Talked it through'),
  'private: Rococo cannot read a monthly goal note'
);
reset role; select set_config('request.jwt.claims', '', true);

-- case: the_backfill_runs_once
-- Re-runs the migration's own backfill block, as a second paste would, against an admin an owner
-- has narrowed. The block is read from the harness's copy of the migration.
do $$
declare
  v_file  text := regexp_replace(current_setting('data_directory'), '/data$', '')
                  || '/migrations/0038_team_and_division_access.sql';
  v_block text;
begin
  v_block := substring(pg_read_file(v_file) from '-- backfill:start\s*(do \$\$.*end \$\$);\s*-- backfill:end');
  if v_block is null then
    raise exception 'backfill_once: the backfill block was not found in %', v_file;
  end if;
  execute v_block;
end;
$$;
select tests.assert(
  (select not view_all_divisions from public.profiles where id = tests.id('r_north_admin'))
  and (select view_all_divisions from public.profiles where id = tests.id('r_full'))
  and (select division_ids = array[tests.id('div_north'), tests.id('div_south')] from public.profiles where id = tests.id('r_both')),
  'backfill_once: pasting again widened a narrowed admin or rewrote divisions'
);
