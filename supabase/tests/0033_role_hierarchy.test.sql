-- 0033_role_hierarchy.test.sql
-- Proves the role hierarchy (0033): owner and manager are role values, an owner is an admin
-- everywhere and a manager is employee-level, grants are ranked (only an owner or Rococo grants
-- owner, nobody grants above their own rank or changes, invites or removes someone ranked above
-- them, signed in or not), an invitation only names someone on its own company's roster who has
-- not signed in yet, the insert guards on profiles and invitations keep sign-up working, and
-- reports_to never points at oneself, another company or round in a loop, is cleared when a
-- person changes company, and is judged only when it changes, so a line saved before 0033 never
-- blocks a first sign-in.
--
-- Runs inside one transaction the harness opens and rolls back; never begin or commit here.
-- State carries from case to case, so each case puts back, as system, what it changed.

-- Setup, as system.
select tests.create_person('k_owner', tests.company('kingdom'), 'owner');
select tests.create_person('k_admin', tests.company('kingdom'), 'admin');
select tests.create_person('k_admin2', tests.company('kingdom'), 'admin');
select tests.create_person('k_manager', tests.company('kingdom'), 'manager');
select tests.create_person('k_emp', tests.company('kingdom'));
select tests.create_person('k_emp2', tests.company('kingdom'));
select tests.create_person('l_admin', tests.company('klasik'), 'admin');
select tests.create_person('l_emp', tests.company('klasik'));
select tests.create_person('rococo', null, 'employee', true);

-- case: role_values_widened
update public.profiles set role = 'manager' where id = tests.id('k_emp2');
select tests.assert(
  (select role from public.profiles where id = tests.id('k_emp2')) = 'manager',
  'role_values_widened: manager is not a role value'
);
update public.profiles set role = 'employee' where id = tests.id('k_emp2');
select tests.assert_raises(
  format($q$update public.profiles set role = 'boss' where id = %L$q$, tests.id('k_emp2')),
  '%profiles_role_check%'
);
select tests.assert_raises(
  format(
    $q$insert into public.invitations (company_id, email, role)
       values (%L, 'sample.boss@example.com', 'boss')$q$,
    tests.company('kingdom')
  ),
  '%invitations_role_check%'
);
select tests.assert(
  (select count(*) from pg_constraint where conname = 'profiles_role_check') = 1,
  'role_values_widened: profiles_role_check is not exactly one constraint'
);
select tests.assert(
  (select count(*) from pg_constraint where conname = 'invitations_role_check') = 1,
  'role_values_widened: invitations_role_check is not exactly one constraint'
);

-- case: owner_is_admin_everywhere
select tests.act_as(tests.id('k_owner'));
select tests.assert(private.is_company_admin(), 'owner_is_admin_everywhere: an owner is not a company admin');
select tests.assert(
  private.can_manage_company(tests.company('kingdom')),
  'owner_is_admin_everywhere: an owner cannot manage their own company'
);
select tests.assert(
  not private.can_manage_company(tests.company('klasik')),
  'owner_is_admin_everywhere: a Kingdom owner can manage Klasik'
);
select tests.act_as(tests.id('k_admin'));
select tests.assert(private.is_company_admin(), 'owner_is_admin_everywhere: an admin is not a company admin');
select tests.assert(
  private.can_manage_company(tests.company('kingdom')),
  'owner_is_admin_everywhere: an admin cannot manage their own company'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- case: manager_is_employee_level
select tests.act_as(tests.id('k_manager'));
select tests.assert(not private.is_company_admin(), 'manager_is_employee_level: a manager is a company admin');
select tests.assert(
  not private.can_manage_company(tests.company('kingdom')),
  'manager_is_employee_level: a manager can manage the company'
);
do $$
declare
  v_rows integer;
begin
  update public.profiles set title = 'Changed by a manager' where id = tests.id('k_emp');
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'manager_is_employee_level: % row(s) updated by a manager', v_rows;
  end if;
end;
$$;
reset role;
select set_config('request.jwt.claims', '', true);

-- case: rank_helpers
select tests.assert(private.role_rank('employee') = 1, 'rank_helpers: employee is not rank 1');
select tests.assert(private.role_rank('manager') = 2, 'rank_helpers: manager is not rank 2');
select tests.assert(private.role_rank('admin') = 3, 'rank_helpers: admin is not rank 3');
select tests.assert(private.role_rank('owner') = 4, 'rank_helpers: owner is not rank 4');
select tests.assert(private.role_rank('boss') = 0, 'rank_helpers: an unknown role is not rank 0');
select tests.assert(private.auth_role_rank() = 0, 'rank_helpers: system does not rank 0');
select tests.assert(not private.is_company_owner(), 'rank_helpers: system is an owner');
select tests.act_as(tests.id('k_owner'));
select tests.assert(private.auth_role_rank() = 4, 'rank_helpers: an owner does not rank 4');
select tests.assert(private.is_company_owner(), 'rank_helpers: an owner is not an owner');
select tests.act_as(tests.id('k_admin'));
select tests.assert(private.auth_role_rank() = 3, 'rank_helpers: an admin does not rank 3');
select tests.assert(not private.is_company_owner(), 'rank_helpers: an admin is an owner');
select tests.act_as(tests.id('k_manager'));
select tests.assert(private.auth_role_rank() = 2, 'rank_helpers: a manager does not rank 2');
select tests.assert(not private.is_company_owner(), 'rank_helpers: a manager is an owner');
select tests.act_as(tests.id('rococo'));
select tests.assert(not private.is_company_owner(), 'rank_helpers: a Rococo admin is an owner');
reset role;
select set_config('request.jwt.claims', '', true);

-- case: admin_cannot_grant_owner
select tests.act_as(tests.id('k_admin'));
select tests.assert_raises(
  format($q$update public.profiles set role = 'owner' where id = %L$q$, tests.id('k_emp')),
  'Only an owner or Rococo can make someone an owner.'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- case: owner_and_rococo_grant_owner
select tests.act_as(tests.id('k_owner'));
update public.profiles set role = 'owner' where id = tests.id('k_emp');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select role from public.profiles where id = tests.id('k_emp')) = 'owner',
  'owner_and_rococo_grant_owner: an owner could not make someone an owner'
);
update public.profiles set role = 'employee' where id = tests.id('k_emp');
select tests.act_as(tests.id('rococo'));
update public.profiles set role = 'owner' where id = tests.id('k_emp2');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select role from public.profiles where id = tests.id('k_emp2')) = 'owner',
  'owner_and_rococo_grant_owner: Rococo could not make someone an owner'
);
update public.profiles set role = 'employee' where id = tests.id('k_emp2');

-- case: admin_keeps_todays_grants
select tests.act_as(tests.id('k_admin'));
do $$
declare
  v_role  text;
  v_rows  integer;
begin
  foreach v_role in array array['admin', 'manager', 'employee'] loop
    update public.profiles set role = v_role where id = tests.id('k_emp');
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'admin_keeps_todays_grants: an admin could not set the role %', v_role;
    end if;
  end loop;
end;
$$;
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select role from public.profiles where id = tests.id('k_emp')) = 'employee',
  'admin_keeps_todays_grants: the employee did not end as an employee'
);

-- case: manager_cannot_grant
select tests.act_as(tests.id('k_manager'));
do $$
declare
  v_rows integer;
begin
  update public.profiles set role = 'manager' where id = tests.id('k_emp');
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'manager_cannot_grant: % row(s) given a role by a manager', v_rows;
  end if;
end;
$$;
select tests.assert_raises(
  format($q$update public.profiles set role = 'admin' where id = %L$q$, tests.id('k_manager')),
  'Only admins can change roles or deactivate accounts.'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- case: no_change_to_someone_ranked_above
select tests.act_as(tests.id('k_admin'));
select tests.assert_raises(
  format($q$update public.profiles set role = 'admin' where id = %L$q$, tests.id('k_owner')),
  'You cannot change the role or access of someone ranked above you.'
);
select tests.assert_raises(
  format($q$update public.profiles set is_active = false where id = %L$q$, tests.id('k_owner')),
  'You cannot change the role or access of someone ranked above you.'
);
do $$
declare
  v_rows integer;
begin
  update public.profiles set title = 'Principal' where id = tests.id('k_owner');
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'no_change_to_someone_ranked_above: an admin could not change an owner''s title';
  end if;
end;
$$;
reset role;
select set_config('request.jwt.claims', '', true);
update public.profiles set title = null where id = tests.id('k_owner');

-- case: owner_changes_owner
select tests.create_person('k_owner2', tests.company('kingdom'), 'owner');
select tests.act_as(tests.id('k_owner'));
update public.profiles set role = 'admin' where id = tests.id('k_owner2');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select role from public.profiles where id = tests.id('k_owner2')) = 'admin',
  'owner_changes_owner: an owner could not change another owner'
);
update public.profiles set role = 'owner' where id = tests.id('k_owner2');

-- case: nobody_changes_own_role
select tests.act_as(tests.id('k_owner'));
select tests.assert_raises(
  format($q$update public.profiles set role = 'admin' where id = %L$q$, tests.id('k_owner')),
  'You cannot change your own role or deactivate your own account.'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- case: insert_guard
select tests.act_as(tests.id('k_admin'));
select tests.assert_raises(
  format(
    $q$insert into public.profiles (id, email, full_name, company_id, role)
       values (gen_random_uuid(), 'sample.owner1@example.com', 'Sample Owner', %L, 'owner')$q$,
    tests.company('kingdom')
  ),
  'Only an owner or Rococo can make someone an owner.'
);
insert into public.profiles (id, email, full_name, company_id, role)
values (gen_random_uuid(), 'sample.admin1@example.com', 'Sample Admin', tests.company('kingdom'), 'admin');
select tests.act_as(tests.id('k_owner'));
insert into public.profiles (id, email, full_name, company_id, role)
values (gen_random_uuid(), 'sample.owner2@example.com', 'Sample Owner', tests.company('kingdom'), 'owner');
select tests.act_as(tests.id('rococo'));
insert into public.profiles (id, email, full_name, company_id, role)
values (gen_random_uuid(), 'sample.owner3@example.com', 'Sample Owner', tests.company('kingdom'), 'owner');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select count(*) from public.profiles
    where email in ('sample.admin1@example.com', 'sample.owner2@example.com', 'sample.owner3@example.com')) = 3,
  'insert_guard: an allowed roster insert is missing'
);
select tests.assert(
  not exists (select 1 from public.profiles where email = 'sample.owner1@example.com'),
  'insert_guard: an admin put an owner on the roster'
);

-- case: invitation_guard
select tests.act_as(tests.id('k_admin'));
select tests.assert_raises(
  format(
    $q$insert into public.invitations (company_id, email, role)
       values (%L, 'sample.invite1@example.com', 'owner')$q$,
    tests.company('kingdom')
  ),
  'Only an owner or Rococo can make someone an owner.'
);
insert into public.invitations (company_id, email, role)
values (tests.company('kingdom'), 'sample.invite1@example.com', 'admin');
select tests.assert_raises(
  $q$update public.invitations set role = 'owner' where email = 'sample.invite1@example.com'$q$,
  'Only an owner or Rococo can make someone an owner.'
);
select tests.act_as(tests.id('k_owner'));
insert into public.invitations (company_id, email, role)
values (tests.company('kingdom'), 'sample.invite2@example.com', 'owner');
select tests.act_as(tests.id('rococo'));
insert into public.invitations (company_id, email, role)
values (tests.company('kingdom'), 'sample.invite3@example.com', 'owner');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select role from public.invitations where email = 'sample.invite1@example.com') = 'admin',
  'invitation_guard: the admin invitation did not keep its role'
);
select tests.assert(
  (select count(*) from public.invitations
    where email in ('sample.invite2@example.com', 'sample.invite3@example.com') and role = 'owner') = 2,
  'invitation_guard: an owner invitation from an owner or Rococo is missing'
);

-- case: invitation_to_owner_row
-- Signing in with an invitation that names a roster row claims that row, role and all, so naming
-- an owner who has not signed in yet hands over an owner whatever role the invitation carries.
with p as (
  insert into public.profiles (id, email, full_name, company_id, role)
  values (gen_random_uuid(), 'sample.roster.owner@example.com', 'Sample Roster Owner', tests.company('kingdom'), 'owner')
  returning id
)
insert into tests.fixture (name, id) select 'k_roster_owner', id from p;
select tests.act_as(tests.id('k_admin'));
select tests.assert_raises(
  format(
    $q$insert into public.invitations (company_id, email, role, profile_id)
       values (%L, 'sample.taker1@example.com', 'employee', %L)$q$,
    tests.company('kingdom'), tests.id('k_roster_owner')
  ),
  'You cannot invite someone ranked above you.'
);
select tests.act_as(tests.id('k_owner'));
insert into public.invitations (company_id, email, role, profile_id)
values (tests.company('kingdom'), 'sample.roster.owner@example.com', 'owner', tests.id('k_roster_owner'));
reset role;
select set_config('request.jwt.claims', '', true);
delete from public.invitations where email = 'sample.roster.owner@example.com';
select tests.act_as(tests.id('rococo'));
insert into public.invitations (company_id, email, role, profile_id)
values (tests.company('kingdom'), 'sample.roster.owner@example.com', 'employee', tests.id('k_roster_owner'));
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  not exists (select 1 from public.invitations where email = 'sample.taker1@example.com'),
  'invitation_to_owner_row: an admin pointed an invitation at an owner'
);
select tests.assert(
  (select count(*) from public.invitations where profile_id = tests.id('k_roster_owner')) = 1,
  'invitation_to_owner_row: an owner or Rococo could not invite an owner who has not signed in'
);

-- case: invitation_update_guarded
-- Every update is checked, not just a change of role, so moving an owner's invitation to another
-- address is judged like a new invitation. The roster-bound one is Rococo's from the case above.
insert into public.invitations (company_id, email, role)
values (tests.company('kingdom'), 'sample.offer.owner@example.com', 'owner');
select tests.act_as(tests.id('k_admin'));
select tests.assert_raises(
  $q$update public.invitations set email = 'sample.taker2@example.com'
      where email = 'sample.offer.owner@example.com'$q$,
  'Only an owner or Rococo can make someone an owner.'
);
select tests.assert_raises(
  $q$update public.invitations set email = 'sample.taker3@example.com'
      where email = 'sample.roster.owner@example.com'$q$,
  'You cannot invite someone ranked above you.'
);
select tests.assert_raises(
  $q$update public.invitations set role = 'employee', email = 'sample.taker4@example.com'
      where email = 'sample.offer.owner@example.com'$q$,
  'You cannot change an invitation for someone ranked above you.'
);
-- An admin still corrects an invitation they could have sent.
update public.invitations set email = 'sample.invite1.fixed@example.com' where email = 'sample.invite1@example.com';
select tests.act_as(tests.id('k_owner'));
update public.invitations set email = 'sample.offer.owner2@example.com' where email = 'sample.offer.owner@example.com';
-- A roster-bound invitation stays at its person's address (0028), so Rococo changes its title.
select tests.act_as(tests.id('rococo'));
update public.invitations set title = 'Owner' where email = 'sample.roster.owner@example.com';
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  not exists (select 1 from public.invitations where email like 'sample.taker%'),
  'invitation_update_guarded: an admin moved an owner invitation to another address'
);
select tests.assert(
  (select count(*) from public.invitations
    where email = 'sample.offer.owner2@example.com'
       or (email = 'sample.roster.owner@example.com' and title = 'Owner')) = 2,
  'invitation_update_guarded: an owner or Rococo could not change an owner invitation'
);
select tests.assert(
  exists (select 1 from public.invitations where email = 'sample.invite1.fixed@example.com' and role = 'admin'),
  'invitation_update_guarded: an admin could not correct an admin invitation'
);
update public.invitations set email = 'sample.invite1@example.com' where email = 'sample.invite1.fixed@example.com';
delete from public.invitations
 where email in ('sample.offer.owner2@example.com', 'sample.roster.owner@example.com');

-- case: invitation_names_an_unclaimed_roster_row
-- The same claim makes an invitation that names someone already signed in, or someone in
-- another company, a way into their account, so an admin can only name a person on their own
-- company's roster who has not signed in yet. That rule is 0028's guard_invitation_target, which
-- this migration leaves to it, so the refusals read as 0028 words them.
with p as (
  insert into public.profiles (id, email, full_name, company_id, role)
  values (gen_random_uuid(), 'sample.roster.emp@example.com', 'Sample Roster Employee', tests.company('kingdom'), 'employee')
  returning id
)
insert into tests.fixture (name, id) select 'k_roster_emp', id from p;
with p as (
  insert into public.profiles (id, email, full_name, company_id, role)
  values (gen_random_uuid(), 'sample.roster.klasik@example.com', 'Sample Klasik Roster', tests.company('klasik'), 'employee')
  returning id
)
insert into tests.fixture (name, id) select 'l_roster_emp', id from p;
insert into public.invitations (company_id, email, role, profile_id, accepted_at)
values (tests.company('kingdom'), 'sample.accepted@example.com', 'employee', tests.id('k_emp'), now());
select tests.act_as(tests.id('k_admin'));
select tests.assert_raises(
  format(
    $q$insert into public.invitations (company_id, email, role, profile_id)
       values (%L, 'sample.taker5@example.com', 'employee', %L)$q$,
    tests.company('kingdom'), tests.id('k_emp')
  ),
  'An invitation can only be for someone on this company''s roster who has not signed in yet%'
);
select tests.assert_raises(
  format(
    $q$insert into public.invitations (company_id, email, role, profile_id)
       values (%L, 'sample.taker6@example.com', 'employee', %L)$q$,
    tests.company('kingdom'), tests.id('l_roster_emp')
  ),
  'An invitation can only be for someone on this company''s roster who has not signed in yet%'
);
select tests.assert_raises(
  $q$update public.invitations set accepted_at = null, email = 'sample.taker7@example.com'
      where email = 'sample.accepted@example.com'$q$,
  'An invitation is accepted by signing in%'
);
-- An accepted invitation is history and can still be tidied; the roster row gets its invite.
update public.invitations set title = 'Carpenter' where email = 'sample.accepted@example.com';
insert into public.invitations (company_id, email, role, profile_id)
values (tests.company('kingdom'), 'sample.roster.emp@example.com', 'employee', tests.id('k_roster_emp'));
reset role;
select set_config('request.jwt.claims', '', true);
insert into auth.users (id, email, raw_user_meta_data)
values (gen_random_uuid(), 'sample.roster.emp@example.com', '{}'::jsonb);
select tests.assert(
  not exists (select 1 from public.invitations where email like 'sample.taker%'),
  'invitation_names_an_unclaimed_roster_row: an admin named someone signed in or in another company'
);
select tests.assert(
  (select user_id is not null and company_id = tests.company('kingdom')
     from public.profiles where id = tests.id('k_roster_emp')),
  'invitation_names_an_unclaimed_roster_row: the invited roster row was not claimed at sign-in'
);
select tests.assert(
  (select user_id = id from public.profiles where id = tests.id('k_emp')),
  'invitation_names_an_unclaimed_roster_row: a signed-in person changed account'
);
delete from public.invitations
 where email in ('sample.accepted@example.com', 'sample.roster.emp@example.com');

-- case: delete_guard
-- An admin may remove anyone who has never signed in, which cascades their reviews, goals, KPIs
-- and compensation, so the rank rule covers removal too.
with p as (
  insert into public.profiles (id, email, full_name, company_id, role)
  values (gen_random_uuid(), 'sample.roster.owner3@example.com', 'Sample Roster Owner Three', tests.company('kingdom'), 'owner')
  returning id
)
insert into tests.fixture (name, id) select 'k_roster_owner3', id from p;
with p as (
  insert into public.profiles (id, email, full_name, company_id, role)
  values (gen_random_uuid(), 'sample.roster.admin@example.com', 'Sample Roster Admin', tests.company('kingdom'), 'admin')
  returning id
)
insert into tests.fixture (name, id) select 'k_roster_admin', id from p;
select tests.act_as(tests.id('k_admin'));
select tests.assert_raises(
  format($q$delete from public.profiles where id = %L$q$, tests.id('k_roster_owner')),
  'You cannot remove someone ranked above you.'
);
delete from public.profiles where id = tests.id('k_roster_admin');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  exists (select 1 from public.profiles where id = tests.id('k_roster_owner')),
  'delete_guard: an admin removed an owner who has not signed in'
);
select tests.act_as(tests.id('k_owner'));
delete from public.profiles where id = tests.id('k_roster_owner');
select tests.act_as(tests.id('rococo'));
delete from public.profiles where id = tests.id('k_roster_owner3');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  not exists (
    select 1 from public.profiles
     where id in (tests.id('k_roster_owner'), tests.id('k_roster_owner3'), tests.id('k_roster_admin'))
  ),
  'delete_guard: an owner, Rococo or an admin could not remove someone they outrank or match'
);

-- case: signup_still_creates_profiles
insert into public.invitations (company_id, email, role)
values (tests.company('kingdom'), 'sample.newowner@example.com', 'owner');
insert into auth.users (id, email, raw_user_meta_data)
values (gen_random_uuid(), 'sample.newowner@example.com', '{}'::jsonb);
select tests.assert(
  (select count(*) from public.profiles
    where email = 'sample.newowner@example.com'
      and company_id = tests.company('kingdom')
      and role = 'owner') = 1,
  'signup_still_creates_profiles: an invited owner did not get an owner profile'
);
select tests.assert(
  (select accepted_at is not null from public.invitations where email = 'sample.newowner@example.com'),
  'signup_still_creates_profiles: the invitation was not accepted'
);
insert into auth.users (id, email, raw_user_meta_data)
values (gen_random_uuid(), 'sample.staff@rocococreative.io', '{}'::jsonb);
select tests.assert(
  (select is_rococo_admin from public.profiles where email = 'sample.staff@rocococreative.io'),
  'signup_still_creates_profiles: a Rococo sign-up is not a Rococo admin'
);

-- case: reports_to_not_self
select tests.act_as(tests.id('k_admin'));
select tests.assert_raises(
  format($q$update public.profiles set reports_to = id where id = %L$q$, tests.id('k_emp')),
  'A person cannot report to themselves.'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- case: reports_to_same_company
select tests.act_as(tests.id('rococo'));
select tests.assert_raises(
  format(
    $q$update public.profiles set reports_to = %L where id = %L$q$,
    tests.id('l_admin'), tests.id('k_emp')
  ),
  'That person is in another company.'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- case: reports_to_no_loop
select tests.act_as(tests.id('k_admin'));
update public.profiles set reports_to = tests.id('k_emp2') where id = tests.id('k_emp');
select tests.assert_raises(
  format(
    $q$update public.profiles set reports_to = %L where id = %L$q$,
    tests.id('k_emp'), tests.id('k_emp2')
  ),
  'That would make a reporting loop.'
);
update public.profiles set reports_to = tests.id('k_emp') where id = tests.id('k_manager');
select tests.assert_raises(
  format(
    $q$update public.profiles set reports_to = %L where id = %L$q$,
    tests.id('k_manager'), tests.id('k_emp2')
  ),
  'That would make a reporting loop.'
);
update public.profiles set reports_to = tests.id('k_owner') where id = tests.id('k_admin2');
update public.profiles set reports_to = null where id = tests.id('k_emp');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select reports_to from public.profiles where id = tests.id('k_admin2')) = tests.id('k_owner'),
  'reports_to_no_loop: a plain chain was not saved'
);
select tests.assert(
  (select reports_to is null from public.profiles where id = tests.id('k_emp')),
  'reports_to_no_loop: reports_to could not be cleared'
);
update public.profiles set reports_to = null
 where id in (tests.id('k_emp'), tests.id('k_emp2'), tests.id('k_manager'), tests.id('k_admin2'));

-- case: move_clears_reporting_lines
update public.profiles set reports_to = tests.id('k_admin') where id = tests.id('k_emp');
update public.profiles set reports_to = tests.id('k_emp') where id = tests.id('k_emp2');
select tests.act_as(tests.id('rococo'));
update public.profiles set company_id = tests.company('klasik') where id = tests.id('k_emp');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select company_id = tests.company('klasik') and reports_to is null
     from public.profiles where id = tests.id('k_emp')),
  'move_clears_reporting_lines: the moved person still reports into the company they left'
);
select tests.assert(
  (select company_id = tests.company('kingdom') and reports_to is null
     from public.profiles where id = tests.id('k_emp2')),
  'move_clears_reporting_lines: someone in the old company still reports to the moved person'
);
update public.profiles set company_id = tests.company('kingdom') where id = tests.id('k_emp');

-- case: legacy_line_does_not_block_sign_in
-- A line saved before 0033 that crosses companies or loops is what the pre-check lists. Signing
-- in claims a roster row with an update that names company_id, so if an unchanged line were
-- judged again those people could never sign in. Set up with the guard off, as 0033 finds them.
with p as (
  insert into public.profiles (id, email, full_name, company_id, role)
  values (gen_random_uuid(), 'sample.legacy.cross@example.com', 'Sample Legacy Cross', tests.company('kingdom'), 'employee')
  returning id
)
insert into tests.fixture (name, id) select 'k_legacy_cross', id from p;
with p as (
  insert into public.profiles (id, email, full_name, company_id, role)
  values (gen_random_uuid(), 'sample.legacy.loop1@example.com', 'Sample Legacy Loop One', tests.company('kingdom'), 'employee')
  returning id
)
insert into tests.fixture (name, id) select 'k_legacy_loop1', id from p;
with p as (
  insert into public.profiles (id, email, full_name, company_id, role)
  values (gen_random_uuid(), 'sample.legacy.loop2@example.com', 'Sample Legacy Loop Two', tests.company('kingdom'), 'employee')
  returning id
)
insert into tests.fixture (name, id) select 'k_legacy_loop2', id from p;
alter table public.profiles disable trigger profiles_guard_reports_to;
update public.profiles set reports_to = tests.id('l_emp') where id = tests.id('k_legacy_cross');
update public.profiles set reports_to = tests.id('k_legacy_loop2') where id = tests.id('k_legacy_loop1');
update public.profiles set reports_to = tests.id('k_legacy_loop1') where id = tests.id('k_legacy_loop2');
alter table public.profiles enable trigger profiles_guard_reports_to;
insert into auth.users (id, email, raw_user_meta_data)
values (gen_random_uuid(), 'sample.legacy.cross@example.com', '{}'::jsonb);
insert into auth.users (id, email, raw_user_meta_data)
values (gen_random_uuid(), 'sample.legacy.loop1@example.com', '{}'::jsonb);
select tests.assert(
  (select user_id is not null and reports_to = tests.id('l_emp')
     from public.profiles where id = tests.id('k_legacy_cross')),
  'legacy_line_does_not_block_sign_in: a cross-company line stopped a first sign-in'
);
select tests.assert(
  (select user_id is not null and reports_to = tests.id('k_legacy_loop2')
     from public.profiles where id = tests.id('k_legacy_loop1')),
  'legacy_line_does_not_block_sign_in: a reporting loop stopped a first sign-in'
);
-- Saving the same line again is not a change; a new broken line is still refused, Rococo
-- included; clearing one always works.
select tests.act_as(tests.id('rococo'));
update public.profiles set reports_to = tests.id('l_emp') where id = tests.id('k_legacy_cross');
update public.profiles set reports_to = tests.id('k_legacy_loop1') where id = tests.id('k_legacy_loop2');
select tests.assert_raises(
  format(
    $q$update public.profiles set reports_to = %L where id = %L$q$,
    tests.id('l_admin'), tests.id('k_legacy_cross')
  ),
  'That person is in another company.'
);
update public.profiles set reports_to = null where id = tests.id('k_legacy_loop1');
select tests.assert_raises(
  format(
    $q$update public.profiles set reports_to = %L where id = %L$q$,
    tests.id('k_legacy_loop2'), tests.id('k_legacy_loop1')
  ),
  'That would make a reporting loop.'
);
update public.profiles set reports_to = null
 where id in (tests.id('k_legacy_cross'), tests.id('k_legacy_loop1'), tests.id('k_legacy_loop2'));
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  not exists (
    select 1 from public.profiles
     where id in (tests.id('k_legacy_cross'), tests.id('k_legacy_loop1'), tests.id('k_legacy_loop2'))
       and reports_to is not null
  ),
  'legacy_line_does_not_block_sign_in: a legacy line could not be cleared'
);

-- case: audit_still_records_roles
select set_config('audit.before', (
  select count(*) from public.audit_events
   where table_name = 'profiles' and row_id = tests.id('k_emp')::text
)::text, true);
select tests.act_as(tests.id('k_owner'));
update public.profiles set role = 'manager' where id = tests.id('k_emp');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select count(*) from public.audit_events
    where table_name = 'profiles' and row_id = tests.id('k_emp')::text)
    = current_setting('audit.before')::bigint + 1,
  'audit_still_records_roles: the role change did not write exactly one event'
);
select tests.assert(
  exists (
    select 1 from public.audit_events
     where table_name = 'profiles'
       and row_id = tests.id('k_emp')::text
       and actor_profile_id = tests.id('k_owner')
       and changed -> 'role' = '{"old": "employee", "new": "manager"}'::jsonb
  ),
  'audit_still_records_roles: the newest event does not carry the role change'
);
update public.profiles set role = 'employee' where id = tests.id('k_emp');
