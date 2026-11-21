-- 0049_delete_people.test.sql
-- Proves deleting a person who has signed in (0049): an admin deletes a signed-in employee they
-- manage and everything on the person's profile goes with them (reviews and their scores, goals
-- in an open month, a closed month and a locked month, notes, private steps, ratings, KPIs, pay,
-- deliverables), the tasks they created or were given stay with the name blanked, their account
-- goes and their address is blocked; the sign-in gate then refuses the address, admits it once a
-- pending invitation made after the block exists (one made before it does not count), and signing
-- in through that invitation lifts the block. Deleting a manager, by an admin or from the SQL
-- editor, blanks their name on what they set, wrote, created, entered and reviewed for others, even
-- in a closed or locked month. Deleting someone who sent an owner invitation before being demoted,
-- someone who sent an invitation outside a limited admin's divisions, or the creator of a GSR month
-- in a company on demand goes through, with only the sender or creator cleared, while clearing
-- either by hand is still refused. The guard refuses
-- deleting yourself, a Rococo admin's profile, someone ranked above you and a company's only
-- owner, each with its message; a manager who is not an admin, an admin of another company and an
-- admin limited to some divisions (outside them) delete nothing; a person who never signed in is
-- removed as before and nothing is blocked; and no other company's rows change.
--
-- Runs inside one transaction the harness opens and rolls back; never begin or commit here.

-- The fingerprint is supabase/tests/fingerprint.sql itself, read in as the body of a test-local
-- function, the way 0047_gsr_conversion.test.sql reads it.
\set fingerprint_sql `cd "$(git rev-parse --show-toplevel)" && cat supabase/tests/fingerprint.sql`
create function tests.fingerprint()
returns table (slug text, tbl text, n bigint, hash text)
language sql
stable
as :'fingerprint_sql';

-- How many rows a statement touched as whoever is acting, so a delete that RLS quietly skips
-- reads as 0.
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

-- Sets the claims a signed-in request carries without leaving system, so a stamp records that
-- person as the writer while setup stays free of row level security.
create function tests.claims_of(p_name text)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', tests.user_of(tests.id(p_name)), 'role', 'authenticated')::text, true);
end;
$$;

-- What the gate answers for an address: null when it admits, else its message. The gate is run
-- as supabase_auth_admin, the only role Supabase calls it as.
create table tests.gate_answer (email text primary key, message text);
grant usage on schema tests to supabase_auth_admin;
grant select, insert, update on tests.gate_answer to supabase_auth_admin;
create function tests.ask_gate(p_email text)
returns text
language plpgsql
as $$
declare
  v_message text;
begin
  set local role supabase_auth_admin;
  insert into tests.gate_answer (email, message)
  values (p_email, public.restrict_signups(jsonb_build_object('user', jsonb_build_object('email', p_email))) -> 'error' ->> 'message')
  on conflict (email) do update set message = excluded.message;
  reset role;
  select message into v_message from tests.gate_answer where email = p_email;
  return v_message;
end;
$$;

-- Setup, as system.
select tests.create_person('d_owner', tests.company('rba'), 'owner');
select tests.create_person('d_admin', tests.company('rba'), 'admin');
select tests.create_person('d_mgr', tests.company('rba'), 'manager');
select tests.create_person('d_mgr2', tests.company('rba'), 'manager');
select tests.create_person('d_emp', tests.company('rba'));
select tests.create_person('d_emp2', tests.company('rba'));
select tests.create_person('d_north_admin', tests.company('rba'), 'admin');
select tests.create_person('d_north', tests.company('rba'));
select tests.create_person('d_south', tests.company('rba'));
select tests.create_person('k_admin', tests.company('kingdom'), 'admin');
select tests.create_person('k_emp', tests.company('kingdom'));
select tests.create_person('rococo', null, 'employee', true);
select tests.create_person('rococo_placed', null, 'employee', true);
update public.profiles set company_id = tests.company('rba') where id = tests.id('rococo_placed');

update public.profiles set reports_to = tests.id('d_mgr') where id in (tests.id('d_emp'), tests.id('d_emp2'));

insert into public.company_divisions (company_id, name) values
  (tests.company('rba'), 'Test North'), (tests.company('rba'), 'Test South');
insert into tests.fixture (name, id)
select case name when 'Test North' then 'div_north' else 'div_south' end, id
  from public.company_divisions where name in ('Test North', 'Test South');
update public.profiles
   set division_ids = array[tests.id('div_north')], view_division_ids = array[tests.id('div_north')],
       view_all_divisions = false
 where id = tests.id('d_north_admin');
update public.profiles set division_ids = array[tests.id('div_north')] where id = tests.id('d_north');
update public.profiles set division_ids = array[tests.id('div_south')] where id = tests.id('d_south');

-- A rating pillar and criterion, a quarterly cycle and two GSR months in rba; the same shape,
-- smaller, in kingdom.
insert into public.gsr_pillars (company_id, name, weight, scoring_type) values
  (tests.company('rba'), 'Test Pillar', 100, 'rating'),
  (tests.company('kingdom'), 'Test Pillar', 100, 'rating');
insert into public.gsr_criteria (pillar_id, company_id, name)
select id, company_id, 'Test Criterion' from public.gsr_pillars where name = 'Test Pillar';
insert into public.review_cycles (company_id, name, cadence, period_start, period_end) values
  (tests.company('rba'), 'Test Q3', 'quarterly', '2026-07-01', '2026-09-30'),
  (tests.company('rba'), 'Test September', 'monthly', '2026-09-01', '2026-09-30'),
  (tests.company('rba'), 'Test October', 'monthly', '2026-10-01', '2026-10-31'),
  (tests.company('kingdom'), 'Test Kingdom Q3', 'quarterly', '2026-07-01', '2026-09-30');
insert into tests.fixture (name, id)
select case name when 'Test Q3' then 'q3' when 'Test September' then 'sep' when 'Test October' then 'oct'
                 else 'k_q3' end, id
  from public.review_cycles where name like 'Test %';

-- Reviews for both employees: the quarter reviewed by the manager, the September and October
-- GSRs by the second manager.
insert into public.reviews (cycle_id, company_id, employee_id, reviewer_id)
select c, tests.company('rba'), e, case when c = tests.id('q3') then tests.id('d_mgr') else tests.id('d_mgr2') end
  from (values (tests.id('q3')), (tests.id('sep')), (tests.id('oct'))) as cy (c)
 cross join (values (tests.id('d_emp')), (tests.id('d_emp2'))) as p (e);
insert into public.reviews (cycle_id, company_id, employee_id)
values (tests.id('k_q3'), tests.company('kingdom'), tests.id('k_emp'));
insert into public.review_scores (review_id, company_id, pillar_id, criterion_id, rating)
select r.id, r.company_id, cr.pillar_id, cr.id, 3
  from public.reviews r
  join public.gsr_criteria cr on cr.company_id = r.company_id and cr.name = 'Test Criterion'
 where r.cycle_id in (tests.id('q3'), tests.id('k_q3'));
insert into public.impact_scores (company_id, employee_id, pillar_id, criterion_id, rating, set_by)
select tests.company('rba'), e, cr.pillar_id, cr.id, 4, tests.id('d_admin')
  from public.gsr_criteria cr
 cross join (values (tests.id('d_emp')), (tests.id('d_emp2'))) as p (e)
 where cr.company_id = tests.company('rba');

-- Goals: each manager sets one for each employee in each month, the employee one of their own,
-- and the employee keeps a yearly goal with private steps.
insert into public.goals (company_id, employee_id, cycle_id, scope, kind, title, created_by)
select tests.company('rba'), e, c, 'cycle', 'role', 'Set by ' || m, tests.id(m)
  from (values (tests.id('sep')), (tests.id('oct'))) as cy (c)
 cross join (values (tests.id('d_emp')), (tests.id('d_emp2'))) as p (e)
 cross join (values ('d_mgr'), ('d_mgr2')) as mg (m);
insert into public.goals (company_id, employee_id, cycle_id, scope, kind, title, created_by)
select tests.company('rba'), tests.id('d_emp'), c, 'cycle', 'professional', 'My own', tests.id('d_emp')
  from (values (tests.id('sep')), (tests.id('oct'))) as cy (c);
insert into public.goals (company_id, employee_id, scope, kind, title, year, created_by)
values (tests.company('rba'), tests.id('d_emp'), 'year', 'role', 'My year', 2026, tests.id('d_emp'));
insert into public.goals (company_id, employee_id, scope, kind, title, year)
values (tests.company('kingdom'), tests.id('k_emp'), 'year', 'role', 'Kingdom year', 2026);
insert into public.goal_private (goal_id, company_id, employee_id, action_steps)
select id, company_id, employee_id, '[{"text": "A private step"}]'::jsonb
  from public.goals where title = 'My year';

-- Notes, stamped with their authors: each manager on every goal of both employees, the employee
-- on their own.
select tests.claims_of('d_mgr');
insert into public.goal_notes (goal_id, body)
select id, 'From the manager' from public.goals where employee_id in (tests.id('d_emp'), tests.id('d_emp2'));
select tests.claims_of('d_mgr2');
insert into public.goal_notes (goal_id, body)
select id, 'From the second manager' from public.goals where employee_id in (tests.id('d_emp'), tests.id('d_emp2'));
select tests.claims_of('d_emp');
insert into public.goal_notes (goal_id, body)
select id, 'From me' from public.goals where employee_id = tests.id('d_emp');
select set_config('request.jwt.claims', '', true);

-- Measured on: KPIs, pay, deliverables.
insert into public.employee_kpis (company_id, employee_id, year, name)
values (tests.company('rba'), tests.id('d_emp'), 2026, 'Test KPI');
insert into public.compensation_items (company_id, employee_id, name, annual_amount)
values (tests.company('rba'), tests.id('d_emp'), 'Test salary', 50000);
insert into public.employee_deliverables (company_id, employee_id, year, name)
values (tests.company('rba'), tests.id('d_emp'), 2026, 'Test deliverable');
insert into public.deliverable_tasks (company_id, employee_id, deliverable_id, name)
select company_id, employee_id, id, 'Test deliverable task'
  from public.employee_deliverables where name = 'Test deliverable';

-- Tasks: one the employee created for their colleague, one the admin gave the employee and the
-- employee completed.
select tests.claims_of('d_emp');
insert into public.tasks (company_id, title, assignee_id)
values (tests.company('rba'), 'Created by the employee', tests.id('d_emp2'));
select tests.claims_of('d_admin');
insert into public.tasks (company_id, title, assignee_id)
values (tests.company('rba'), 'Given to the employee', tests.id('d_emp'));
select tests.claims_of('d_emp');
update public.tasks set completed_at = now() where title = 'Given to the employee';
select set_config('request.jwt.claims', '', true);

-- What each manager made for the company: a project and a figure entered for the colleague. The
-- second manager also last edited the first manager's project.
insert into public.projects (company_id, name, created_by)
values (tests.company('rba'), 'Test project', tests.id('d_mgr')),
       (tests.company('rba'), 'Test project 2', tests.id('d_mgr2'));
select tests.claims_of('d_mgr2');
update public.projects set notes = 'Edited by the second manager' where name = 'Test project';
select set_config('request.jwt.claims', '', true);
insert into public.job_roles (company_id, name) values (tests.company('rba'), 'Test role');
insert into public.role_metrics (company_id, job_role_id, name, kind)
select company_id, id, 'Test metric', 'number' from public.job_roles where name = 'Test role';
insert into public.metric_entries (company_id, employee_id, metric_id, period_month, value, entered_by)
select tests.company('rba'), tests.id('d_emp2'), id, m, 5, tests.id(e)
  from public.role_metrics
 cross join (values ('2026-09-01'::date, 'd_mgr'), ('2026-10-01'::date, 'd_mgr2')) as v (m, e)
 where name = 'Test metric';

-- Sign-off, by the admin: the quarter is signed off, September is locked in and closed, October
-- stays open.
select tests.claims_of('d_admin');
update public.reviews set status = 'complete', completed_at = now()
 where cycle_id = tests.id('q3');
update public.reviews set status = 'complete', completed_at = now(), gsr_score = 80
 where cycle_id = tests.id('sep');
update public.review_cycles set status = 'closed' where id = tests.id('sep');
select set_config('request.jwt.claims', '', true);

-- Who the employee was, kept for after they are gone.
create table tests.gone as
select p.id, p.user_id, lower(p.email) as email from public.profiles p where p.id = tests.id('d_emp');
grant select on tests.gone to authenticated;

-- Invitations for the employee's address made while they are still here, dated two minutes back:
-- one by rba's admin (an admin can invite an address by itself), which the delete clears, and one
-- in kingdom by Rococo (only Rococo invites an address on another company's domain), which is
-- kingdom's to keep and must not open the gate once they are deleted.
select tests.act_as(tests.id('d_admin'));
insert into public.invitations (company_id, email, role)
values (tests.company('rba'), (select email from tests.gone where id = tests.id('d_emp')), 'employee');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('rococo'));
insert into public.invitations (company_id, email, role)
values (tests.company('kingdom'), (select email from tests.gone where id = tests.id('d_emp')), 'employee');
reset role;
select set_config('request.jwt.claims', '', true);
update public.invitations set created_at = now() - interval '2 minutes'
 where email = (select email from tests.gone where id = tests.id('d_emp'));

-- The employee's reviews and how many scores each employee's reviews hold, before.
create table tests.gone_reviews as
select r.id, (select count(*) from public.review_scores s where s.review_id = r.id) as scores
  from public.reviews r where r.employee_id = tests.id('d_emp');
create table tests.colleague_scores as
select count(*) as n from public.review_scores s join public.reviews r on r.id = s.review_id
 where r.employee_id = tests.id('d_emp2');
select tests.assert(
  (select sum(scores) from tests.gone_reviews) > 0 and (select n from tests.colleague_scores) > 0,
  'setup: the reviews hold no scores to delete'
);

create temp table fp_before as select * from tests.fingerprint();

-- case: guard_self
select tests.act_as(tests.id('d_admin'));
select tests.assert_raises(
  format('delete from public.profiles where id = %L', tests.id('d_admin')),
  'You cannot delete yourself.'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- case: guard_rococo_profile
-- A Rococo admin parked on rba's roster is someone d_admin manages, so the guard is the reason.
select tests.act_as(tests.id('d_admin'));
select tests.assert_raises(
  format('delete from public.profiles where id = %L', tests.id('rococo_placed')),
  'A Rococo admin is removed by Rococo.'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- case: guard_ranked_above
select tests.act_as(tests.id('d_admin'));
select tests.assert_raises(
  format('delete from public.profiles where id = %L', tests.id('d_owner')),
  'You cannot delete someone ranked above you.'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- case: guard_last_owner
-- Only Rococo outranks an owner, and an owner cannot delete themselves, so Rococo is who meets it.
select tests.act_as(tests.id('rococo'));
select tests.assert_raises(
  format('delete from public.profiles where id = %L', tests.id('d_owner')),
  'This is the company''s only owner. Make someone else an owner first.'
);
select tests.assert_raises(
  format('delete from public.profiles where id = %L', tests.id('rococo')),
  'You cannot delete yourself.'
);
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select count(*) from public.profiles where id in (tests.id('d_admin'), tests.id('rococo_placed'), tests.id('d_owner'), tests.id('rococo'))) = 4,
  'guards: a refused delete removed someone'
);

-- case: manager_cannot_delete
select tests.act_as(tests.id('d_mgr'));
select tests.assert(
  tests.rows_of(format('delete from public.profiles where id = %L', tests.id('d_emp2'))) = 0,
  'manager_cannot_delete: a manager who is not an admin deleted their report'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- case: other_company_admin_cannot_delete
select tests.act_as(tests.id('k_admin'));
select tests.assert(
  tests.rows_of(format('delete from public.profiles where id = %L', tests.id('d_emp2'))) = 0,
  'other_company_admin_cannot_delete: a kingdom admin deleted someone in rba'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- case: limited_admin_cannot_delete_outside
select tests.act_as(tests.id('d_north_admin'));
select tests.assert(
  tests.rows_of(format('delete from public.profiles where id = %L', tests.id('d_south'))) = 0,
  'limited_admin_cannot_delete_outside: a North admin deleted someone in South'
);
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select count(*) from public.profiles where id in (tests.id('d_emp2'), tests.id('d_south'))) = 2,
  'refusals: someone was deleted who should not have been'
);

-- case: limited_admin_deletes_inside
select tests.act_as(tests.id('d_north_admin'));
select tests.assert(
  tests.rows_of(format('delete from public.profiles where id = %L', tests.id('d_north'))) = 1,
  'limited_admin_deletes_inside: a North admin could not delete someone in North'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- case: admin_deletes_signed_in_employee
select tests.act_as(tests.id('d_admin'));
select tests.assert(
  tests.rows_of(format('delete from public.profiles where id = %L', tests.id('d_emp'))) = 1,
  'admin_deletes_signed_in_employee: the delete did not reach the employee'
);
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  not exists (select 1 from public.profiles where id = tests.id('d_emp'))
  and not exists (select 1 from public.profile_directory where id = tests.id('d_emp')),
  'admin_deletes_signed_in_employee: the profile or its directory row is still there'
);
select tests.assert(
  not exists (select 1 from public.reviews where employee_id = tests.id('d_emp'))
  and not exists (select 1 from public.review_scores where review_id in (select id from tests.gone_reviews))
  and (select count(*) from public.review_scores s join public.reviews r on r.id = s.review_id
        where r.employee_id = tests.id('d_emp2')) = (select n from tests.colleague_scores),
  'admin_deletes_signed_in_employee: their reviews or scores stayed, or the colleague''s went'
);
select tests.assert(
  not exists (select 1 from public.goals where employee_id = tests.id('d_emp'))
  and not exists (select 1 from public.goal_notes where employee_id = tests.id('d_emp'))
  and not exists (select 1 from public.goal_private where employee_id = tests.id('d_emp')),
  'admin_deletes_signed_in_employee: goals, notes or private steps stayed'
);
select tests.assert(
  not exists (select 1 from public.impact_scores where employee_id = tests.id('d_emp'))
  and not exists (select 1 from public.employee_kpis where employee_id = tests.id('d_emp'))
  and not exists (select 1 from public.compensation_items where employee_id = tests.id('d_emp'))
  and not exists (select 1 from public.employee_deliverables where employee_id = tests.id('d_emp'))
  and not exists (select 1 from public.deliverable_tasks where employee_id = tests.id('d_emp')),
  'admin_deletes_signed_in_employee: ratings, KPIs, pay or deliverables stayed'
);
select tests.assert(
  (select created_by is null and assignee_id = tests.id('d_emp2') from public.tasks where title = 'Created by the employee')
  and (select assignee_id is null and completed_by is null and created_by = tests.id('d_admin')
         from public.tasks where title = 'Given to the employee'),
  'admin_deletes_signed_in_employee: a task went, or still names the employee'
);
select tests.assert(
  not exists (select 1 from auth.users where id = (select user_id from tests.gone where id = tests.id('d_emp'))),
  'admin_deletes_signed_in_employee: the account is still there'
);
select tests.assert(
  (select company_id = tests.company('rba') and blocked_by = tests.id('d_admin')
     from private.blocked_signups where email = (select email from tests.gone where id = tests.id('d_emp'))),
  'admin_deletes_signed_in_employee: the address was not blocked, or not as rba by the admin'
);

-- case: manager_deleted_blanks_their_name
-- What the manager set, wrote, created, entered and reviewed for others stays, without their
-- name, in the closed and locked month too.
select tests.act_as(tests.id('d_admin'));
select tests.assert(
  tests.rows_of(format('delete from public.profiles where id = %L', tests.id('d_mgr'))) = 1,
  'manager_deleted_blanks_their_name: the delete did not reach the manager'
);
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select count(*) from public.goals where employee_id = tests.id('d_emp2') and created_by is null) = 2
  and (select count(*) from public.goals where employee_id = tests.id('d_emp2')) = 4,
  'manager_deleted_blanks_their_name: the colleague''s goals went or still name the manager'
);
select tests.assert(
  (select count(*) from public.goal_notes where employee_id = tests.id('d_emp2') and author_id is null) = 4
  and (select count(*) from public.goal_notes where employee_id = tests.id('d_emp2')) = 8,
  'manager_deleted_blanks_their_name: the notes on the colleague''s goals went or still name the manager'
);
select tests.assert(
  (select reports_to is null from public.profiles where id = tests.id('d_emp2'))
  and (select count(*) from public.reviews where employee_id = tests.id('d_emp2') and reviewer_id is null) = 1
  and (select created_by is null and updated_by = tests.id('d_mgr2') from public.projects where name = 'Test project')
  and (select entered_by is null from public.metric_entries
        where employee_id = tests.id('d_emp2') and period_month = '2026-09-01'),
  'manager_deleted_blanks_their_name: a manager link, reviewer, project or figure still names them, or another name moved'
);
select tests.assert(
  (select status = 'complete' and gsr_score = 80 from public.reviews
    where employee_id = tests.id('d_emp2') and cycle_id = tests.id('sep')),
  'manager_deleted_blanks_their_name: the colleague''s locked month changed'
);

-- case: sql_editor_deletes_and_blocks
-- With nobody signed in the guard stands aside, the cascade is the same, and the block names
-- nobody as the one who deleted.
insert into tests.gone
select p.id, p.user_id, lower(p.email) from public.profiles p where p.id = tests.id('d_mgr2');
delete from public.profiles where id = tests.id('d_mgr2');
select tests.assert(
  (select count(*) from public.goals where employee_id = tests.id('d_emp2') and created_by is null) = 4
  and (select count(*) from public.goal_notes where employee_id = tests.id('d_emp2') and author_id is null) = 8
  and (select count(*) from public.reviews where employee_id = tests.id('d_emp2') and reviewer_id is null) = 3
  and (select created_by is null and updated_by is null from public.projects where name = 'Test project 2')
  and (select updated_by is null from public.projects where name = 'Test project')
  and (select count(*) from public.metric_entries where employee_id = tests.id('d_emp2') and entered_by is null) = 2,
  'sql_editor_deletes_and_blocks: something the second manager did went, or still names them'
);
select tests.assert(
  (select b.blocked_by is null and b.company_id = tests.company('rba')
     from private.blocked_signups b join tests.gone g on g.email = b.email
    where g.id = tests.id('d_mgr2'))
  and not exists (select 1 from auth.users u join tests.gone g on g.user_id = u.id where g.id = tests.id('d_mgr2')),
  'sql_editor_deletes_and_blocks: the address was not blocked, or the account stayed'
);

-- case: deleted_persons_waiting_invitation_cleared
-- The delete cleared rba's invitation and left kingdom's.
select tests.assert(
  not exists (select 1 from public.invitations
               where email = (select email from tests.gone where id = tests.id('d_emp'))
                 and company_id = tests.company('rba'))
  and (select count(*) from public.invitations
        where email = (select email from tests.gone where id = tests.id('d_emp'))
          and company_id = tests.company('kingdom') and accepted_at is null) = 1,
  'deleted_persons_waiting_invitation_cleared: rba''s invitation stayed, or kingdom''s went'
);

-- case: gate_refuses_deleted_address
-- Kingdom's invitation, made before the delete, is still pending and does not open the gate.
select tests.assert(
  tests.ask_gate((select email from tests.gone where id = tests.id('d_emp')))
    = 'This address was removed from the hub. Ask an owner or admin to invite you again.',
  'gate_refuses_deleted_address: the gate admitted a deleted address, or an invitation made before the delete opened it'
);
-- Time passes: the block is a minute old. The older invitation still does not count.
update private.blocked_signups set blocked_at = blocked_at - interval '1 minute'
 where email = (select email from tests.gone where id = tests.id('d_emp'));
select tests.assert(
  tests.ask_gate((select email from tests.gone where id = tests.id('d_emp'))) is not null,
  'gate_refuses_deleted_address: an invitation older than the block opened the gate'
);
select tests.assert(
  tests.ask_gate('someone.new@' || (select domain from public.company_domains
                                     where company_id = tests.company('rba') order by domain limit 1)) is null,
  'gate_refuses_deleted_address: a new address on the company''s domain is no longer admitted'
);
select tests.assert(
  tests.ask_gate('someone@gmail.test')
    = 'This email is not set up for Company Hub yet. Ask your company admin for an invitation.',
  'gate_refuses_deleted_address: the ordinary refusal changed'
);

-- case: gate_admits_with_invitation
-- The admin invites the address again, after the block, with nothing in the way.
select tests.act_as(tests.id('d_admin'));
insert into public.invitations (company_id, email, role)
values (tests.company('rba'), (select email from tests.gone where id = tests.id('d_emp')), 'employee');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  tests.ask_gate((select email from tests.gone where id = tests.id('d_emp'))) is null,
  'gate_admits_with_invitation: a pending invitation made after the block did not open the gate'
);

-- case: invitation_sign_in_lifts_block
insert into auth.users (email, raw_user_meta_data)
values ((select email from tests.gone where id = tests.id('d_emp')), '{"full_name": "d_emp again"}'::jsonb);
select tests.assert(
  (select company_id = tests.company('rba') and user_id is not null
     from public.profiles where lower(email) = (select email from tests.gone where id = tests.id('d_emp'))),
  'invitation_sign_in_lifts_block: signing in did not place the person in rba'
);
select tests.assert(
  not exists (select 1 from private.blocked_signups where email = (select email from tests.gone where id = tests.id('d_emp'))),
  'invitation_sign_in_lifts_block: the block stayed'
);
select tests.assert(
  (select accepted_at is not null from public.invitations
    where email = (select email from tests.gone where id = tests.id('d_emp')) and company_id = tests.company('rba')),
  'invitation_sign_in_lifts_block: the invitation was not settled'
);

-- case: never_signed_in_removed_as_before
insert into public.profiles (company_id, email, full_name)
values (tests.company('rba'), 'test.roster@example.test', 'Test Roster');
select tests.act_as(tests.id('d_admin'));
select tests.assert(
  tests.rows_of($q$delete from public.profiles where email = 'test.roster@example.test'$q$) = 1,
  'never_signed_in_removed_as_before: the roster row was not removed'
);
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  not exists (select 1 from private.blocked_signups where email = 'test.roster@example.test'),
  'never_signed_in_removed_as_before: removing someone who never signed in blocked their address'
);

-- case: rococo_deletes_owner_when_another_remains
select tests.create_person('d_owner2', tests.company('rba'), 'owner');
insert into tests.gone
select p.id, p.user_id, lower(p.email) from public.profiles p where p.id = tests.id('d_owner2');
select tests.act_as(tests.id('rococo'));
select tests.assert(
  tests.rows_of(format('delete from public.profiles where id = %L', tests.id('d_owner2'))) = 1,
  'rococo_deletes_owner_when_another_remains: Rococo could not delete an owner with another left'
);
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select blocked_by = tests.id('rococo') and company_id = tests.company('rba')
     from private.blocked_signups b join tests.gone g on g.email = b.email
    where g.id = tests.id('d_owner2'))
  and not exists (select 1 from auth.users u join tests.gone g on g.user_id = u.id where g.id = tests.id('d_owner2')),
  'rococo_deletes_owner_when_another_remains: the owner''s address was not blocked by Rococo, or the account stayed'
);

-- case: blocked_signups_is_private
select tests.act_as(tests.id('d_admin'));
select tests.assert_raises('select * from private.blocked_signups', '%permission denied%');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  not has_function_privilege('authenticated', 'private.remove_deleted_account()', 'execute')
  and not has_function_privilege('anon', 'private.remove_deleted_account()', 'execute')
  and not has_table_privilege('authenticated', 'private.blocked_signups', 'select'),
  'blocked_signups_is_private: a signed-in role can reach the block list or its writer'
);

-- case: other_companies_untouched
select tests.assert(
  not exists (
    (select * from fp_before where slug in ('klasik', 'kingdom'))
    except
    (select * from tests.fingerprint() where slug in ('klasik', 'kingdom'))
  ),
  'other_companies_untouched: a fingerprint of klasik or kingdom changed'
);
select tests.assert(
  (select n from fp_before where slug = 'kingdom' and tbl = 'reviews') = 1
  and (select n from fp_before where slug = 'kingdom' and tbl = 'goals') = 1,
  'other_companies_untouched: the fingerprint did not read the kingdom data it should'
);
select tests.assert(
  (select count(*) from public.profiles where id in (tests.id('k_admin'), tests.id('k_emp'))) = 2,
  'other_companies_untouched: a kingdom person went'
);

-- case: demoted_inviter_deleted_cleanly
-- An owner sends an owner invitation, is made an admin, and a full admin deletes them. Clearing the
-- invitation's sender is the account delete's write, not the admin's, so it is not judged as the
-- admin granting owner. The admin still cannot clear the sender by hand.
select tests.create_person('d_exowner', tests.company('rba'), 'owner');
select tests.claims_of('d_exowner');
insert into public.invitations (company_id, email, role)
values (tests.company('rba'), 'test.future.owner@example.test', 'owner');
select set_config('request.jwt.claims', '', true);
update public.profiles set role = 'admin' where id = tests.id('d_exowner');
select tests.assert(
  (select invited_by = tests.user_of(tests.id('d_exowner')) from public.invitations where email = 'test.future.owner@example.test'),
  'demoted_inviter_deleted_cleanly: setup did not record the sender'
);
select tests.act_as(tests.id('d_admin'));
select tests.assert_raises(
  $q$update public.invitations set invited_by = null where email = 'test.future.owner@example.test'$q$,
  'Only an owner or Rococo can make someone an owner.'
);
select tests.assert(
  tests.rows_of(format('delete from public.profiles where id = %L', tests.id('d_exowner'))) = 1,
  'demoted_inviter_deleted_cleanly: the delete did not reach the demoted inviter'
);
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select invited_by is null and role = 'owner' and accepted_at is null
     from public.invitations where email = 'test.future.owner@example.test'),
  'demoted_inviter_deleted_cleanly: the invitation went, changed, or still names the sender'
);

-- case: limited_admin_deletes_an_inviter
-- A former full admin, now an employee in North, invited someone on the South roster. The North
-- admin may delete them, though the invitation is outside the divisions the North admin can see.
select tests.create_person('d_ex_admin', tests.company('rba'), 'admin');
update public.profiles set view_all_divisions = true where id = tests.id('d_ex_admin');
insert into public.profiles (company_id, email, full_name, division_ids)
values (tests.company('rba'), 'test.south.roster@example.test', 'Test South Roster', array[tests.id('div_south')]);
select tests.claims_of('d_ex_admin');
insert into public.invitations (company_id, email, role, profile_id)
select tests.company('rba'), email, 'employee', id from public.profiles where email = 'test.south.roster@example.test';
select set_config('request.jwt.claims', '', true);
update public.profiles
   set role = 'employee', view_all_divisions = false, division_ids = array[tests.id('div_north')]
 where id = tests.id('d_ex_admin');
select tests.claims_of('d_north_admin');
select tests.assert(
  not private.invitation_in_scope(tests.company('rba'),
        (select id from public.profiles where email = 'test.south.roster@example.test'), 'test.south.roster@example.test'),
  'limited_admin_deletes_an_inviter: the invitation is in the North admin''s scope, so this proves nothing'
);
-- Clearing the sender by hand is still the guard's to refuse. Row level security already hides
-- this invitation from the North admin, so the guard is reached with their claims as system.
select tests.assert_raises(
  $q$update public.invitations set invited_by = null where email = 'test.south.roster@example.test'$q$,
  'You can only invite people in the divisions you can see.'
);
select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('d_north_admin'));
select tests.assert(
  tests.rows_of(format('delete from public.profiles where id = %L', tests.id('d_ex_admin'))) = 1,
  'limited_admin_deletes_an_inviter: the North admin could not delete the former admin'
);
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select invited_by is null from public.invitations where email = 'test.south.roster@example.test'),
  'limited_admin_deletes_an_inviter: the invitation went or still names the sender'
);

-- case: cycle_creator_deleted_cleanly
-- An admin created the quarter, and a GSR month in rba after it moved to GSRs on demand (moving
-- converts the months, so the month is put in the way the put-back does, under hub.gsr_conversion
-- with nobody signed in: the one way a month exists in a company on demand). Deleting the creator
-- keeps both with created_by cleared; clearing it on the month by hand is still refused.
select tests.create_person('d_cyc', tests.company('rba'), 'admin');
update public.profiles set view_all_divisions = true where id = tests.id('d_cyc');
update public.review_cycles set created_by = tests.user_of(tests.id('d_cyc')) where id = tests.id('q3');
select set_config('hub.gsr_on_demand_for', 'rba', true);
update public.companies set gsr_mode = 'on_demand' where id = tests.company('rba');
select set_config('hub.gsr_conversion', '1', true);
insert into public.review_cycles (company_id, name, cadence, period_start, period_end, created_by)
values (tests.company('rba'), 'Test November', 'monthly', '2026-11-01', '2026-11-30', tests.user_of(tests.id('d_cyc')));
select set_config('hub.gsr_conversion', '', true);
insert into tests.fixture (name, id) select 'nov', id from public.review_cycles where name = 'Test November';
-- Clearing the creator by hand is still the guard's to refuse, reached with the admin's claims as
-- system (row level security may hide a month in a company on demand).
select tests.claims_of('d_admin');
select tests.assert_raises(
  format('update public.review_cycles set created_by = null where id = %L', tests.id('nov')),
  'This company has GSRs on demand, so it opens no GSR months.'
);
select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('d_admin'));
select tests.assert(
  tests.rows_of(format('delete from public.profiles where id = %L', tests.id('d_cyc'))) = 1,
  'cycle_creator_deleted_cleanly: the delete did not reach the cycles'' creator'
);
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select count(*) from public.review_cycles
    where id in (tests.id('q3'), tests.id('nov')) and created_by is null) = 2
  and (select kind = 'gsr' and name = 'Test November' from public.review_cycles where id = tests.id('nov')),
  'cycle_creator_deleted_cleanly: a cycle went, changed, or still names its creator'
);
