-- 0037_company_time_zone.test.sql
-- Proves 0037: every company carries a time zone, America/New_York unless set; a zone that is
-- not a real named zone is refused; a company admin may set their own company's zone and no
-- other; and a repeating task counts its next due date from its company's own day, not the
-- database's, so a daily task completed when UTC is already tomorrow lands on tomorrow in the
-- company's zone.
--
-- Runs inside one transaction the harness opens and rolls back; never begin or commit here.

-- Setup, as system.
set local timezone = 'UTC';
select tests.create_person('k_admin', tests.company('klasik'), 'admin');
select tests.create_person('kingdom_admin', tests.company('kingdom'), 'admin');

-- case: default_zone_on_existing_companies
select tests.assert(
  (select count(*) = 3 and bool_and(time_zone = 'America/New_York')
     from public.companies where slug in ('kingdom', 'klasik', 'rba')),
  'default_zone_on_existing_companies: a seeded company is not on America/New_York'
);
insert into public.companies (slug, name) values ('zone-default-test', 'Zone default test');
select tests.assert(
  (select time_zone = 'America/New_York' from public.companies where slug = 'zone-default-test'),
  'default_zone_on_existing_companies: a new company did not take the default zone'
);

-- case: invalid_zone_rejected
select tests.assert_raises(
  format('update public.companies set time_zone = %L where id = %L', 'Mars/Olympus_Mons', tests.company('klasik')),
  'That time zone is not recognized.'
);
-- PostgreSQL reads a POSIX-style zone, but the browser cannot, so it is refused too.
select tests.assert_raises(
  format('update public.companies set time_zone = %L where id = %L', 'UTC+5', tests.company('klasik')),
  'That time zone is not recognized.'
);
select tests.assert_raises(
  format('insert into public.companies (slug, name, time_zone) values (%L, %L, %L)',
         'zone-bad-test', 'Zone bad test', 'Not/AZone'),
  'That time zone is not recognized.'
);

-- case: admin_sets_own_company_zone_only
select tests.act_as(tests.id('k_admin'));
update public.companies set time_zone = 'America/Chicago' where id = tests.company('klasik');
update public.companies set time_zone = 'America/Denver' where id = tests.company('kingdom');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select time_zone = 'America/Chicago' from public.companies where id = tests.company('klasik')),
  'admin_sets_own_company_zone_only: the admin could not set their own company''s zone'
);
select tests.assert(
  (select time_zone = 'America/New_York' from public.companies where id = tests.company('kingdom')),
  'admin_sets_own_company_zone_only: the admin changed another company''s zone'
);

-- case: daily_task_counts_from_company_day
-- now() is fixed for the transaction, so the zone is chosen once to make the company's day
-- differ from UTC's: before noon UTC a zone twelve hours behind (UTC is already tomorrow there),
-- otherwise a zone fourteen hours ahead. Either way the old reading, current_date in UTC, would
-- give a different answer for the overdue task below.
update public.companies
   set time_zone = case when extract(hour from now() at time zone 'UTC') < 12 then 'Etc/GMT+12'
                        else 'Pacific/Kiritimati' end
 where id = tests.company('rba');
select tests.assert(
  (select (now() at time zone time_zone)::date <> current_date from public.companies where id = tests.company('rba')),
  'daily_task_counts_from_company_day: the company''s day matches UTC''s, so the case proves nothing'
);
insert into public.tasks (company_id, title, due_date, recurrence)
select c.id, t.title, (now() at time zone c.time_zone)::date + t.offset_days, 'daily'
  from public.companies c,
       (values ('Sample zone task due today', 0), ('Sample zone task due yesterday', -1)) t(title, offset_days)
 where c.id = tests.company('rba');
update public.tasks set completed_at = now() where title like 'Sample zone task %';
select tests.assert(
  (select count(*) = 2
          and bool_and(t.due_date = (now() at time zone c.time_zone)::date + 1)
     from public.tasks t
     join public.companies c on c.id = t.company_id
    where t.title like 'Sample zone task %' and t.completed_at is null),
  'daily_task_counts_from_company_day: a next copy is not due tomorrow in the company''s zone'
);
select tests.assert(
  (select bool_and(t.due_date <> current_date + 1)
     from public.tasks t
    where t.title = 'Sample zone task due yesterday' and t.completed_at is null),
  'daily_task_counts_from_company_day: the overdue copy still counts from UTC''s day'
);

-- case: internal_flag_restored
select tests.assert(
  coalesce(current_setting('hub.task_internal', true), '') = '',
  'internal_flag_restored: the flag is still set after a repeating task was completed'
);
