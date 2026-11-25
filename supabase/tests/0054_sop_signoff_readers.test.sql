-- 0054_sop_signoff_readers.test.sql
-- Proves 0054: a person's SOP sign-offs are read the way 0038 reads every record of a person's. The
-- manager they report to reads them; a manager they do not report to and a fellow employee do not.
--
-- Runs inside one transaction the harness opens and rolls back; never begin or commit here.

select tests.create_person('kingdom_admin', tests.company('kingdom'), 'admin');
select tests.create_person('kingdom_employee', tests.company('kingdom'));
select tests.create_person('kingdom_employee2', tests.company('kingdom'));

-- A published SOP the employee signs off.
select tests.act_as(tests.id('kingdom_admin'));
insert into public.sops (company_id, title, status) values (tests.company('kingdom'), 'Ladder safety', 'published');
insert into public.sop_versions (sop_id, body_md, change_note)
select id, '## Purpose', 'First version' from public.sops where title = 'Ladder safety';
reset role;
select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id) select 'sop_ladder', id from public.sops where title = 'Ladder safety';
select tests.act_as(tests.id('kingdom_employee'));
insert into public.sop_signoffs (sop_id, profile_id) values (tests.id('sop_ladder'), tests.id('kingdom_employee'));
reset role;
select set_config('request.jwt.claims', '', true);

-- case: those who lead a person read their sign-offs
-- The manager they report to reads it; a manager they do
-- not report to, and a fellow employee, do not.
select tests.create_person('kingdom_lead', tests.company('kingdom'), 'manager');
select tests.create_person('kingdom_other_lead', tests.company('kingdom'), 'manager');
update public.profiles set reports_to = tests.id('kingdom_lead') where id = tests.id('kingdom_employee');
select tests.act_as(tests.id('kingdom_lead'));
select tests.assert(
  (select count(*) from public.sop_signoffs where profile_id = tests.id('kingdom_employee')) > 0,
  'those_who_lead_read_signoffs: the manager the person reports to does not read their sign-offs'
);
reset role;
select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('kingdom_other_lead'));
select tests.assert(
  (select count(*) from public.sop_signoffs where profile_id = tests.id('kingdom_employee')) = 0,
  'those_who_lead_read_signoffs: a manager the person does not report to reads their sign-offs'
);
reset role;
select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('kingdom_employee2'));
select tests.assert(
  (select count(*) from public.sop_signoffs where profile_id = tests.id('kingdom_employee')) = 0,
  'those_who_lead_read_signoffs: a fellow employee reads someone else''s sign-offs'
);
reset role;
select set_config('request.jwt.claims', '', true);
