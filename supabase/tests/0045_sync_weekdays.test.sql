-- 0045_sync_weekdays.test.sql
-- Proves a data source can sync on a set of weekdays (0045): the set is filled from the single day
-- a source already had, the single day always equals the lowest day of the set (so the deployed
-- function that still reads only the single day keeps working), an older client that writes only
-- the single day still works, the schedule is all or nothing, a bad set is refused, the business
-- days switch starts off for every source, a syncer who is not an admin changes neither column,
-- and changes to both are audited.
--
-- Runs inside one transaction the harness opens and rolls back; never begin or commit here.

-- Setup, as system. Kingdom lets managers press Sync now, so the manager below may only do that.
select tests.create_person('kingdom_admin', tests.company('kingdom'), 'admin');
select tests.create_person('kingdom_manager', tests.company('kingdom'), 'manager');
insert into public.company_capabilities (company_id, capability, min_role)
values (tests.company('kingdom'), 'sync_run', 'manager');

with c as (
  insert into public.company_connections (company_id, provider, status)
  values (tests.company('kingdom'), 'google_sheets', 'connected')
  returning id
)
insert into tests.fixture (name, id) select 'k_sheets', id from c;

-- case: backfilled_from_the_single_day
-- A source as it stood before 0045: only the single day. The new column, its trigger and its
-- checks are taken away inside this rolled-back transaction, the row is written, and 0045 itself
-- is pasted again, so the backfill that runs here is the migration's own.
alter table public.sync_sources drop column sync_weekdays;
drop trigger if exists sync_sources_keep_weekdays on public.sync_sources;
alter table public.sync_sources add constraint sync_sources_schedule_check
  check ((sync_weekday is null) = (sync_time is null) and (sync_time is null) = (sync_timezone is null));
with s as (
  insert into public.sync_sources (company_id, connection_id, provider, name, target_module, sync_weekday, sync_time, sync_timezone)
  values (tests.company('kingdom'), tests.id('k_sheets'), 'google_sheets', 'Sample weekly tab', 'sales_reporting', 1, '07:00', 'America/Chicago')
  returning id
)
insert into tests.fixture (name, id) select 'weekly', id from s;
\ir ../migrations/0045_sync_weekdays.sql
select tests.assert(
  (select sync_weekdays = '{1}'::smallint[] and sync_weekday = 1 from public.sync_sources where id = tests.id('weekly')),
  'backfilled_from_the_single_day: a source on Mondays did not get the set {1}'
);

-- case: set_keeps_single_day_in_step
select tests.act_as(tests.id('kingdom_admin'));
update public.sync_sources set sync_weekdays = '{5,1,3,2,4}' where id = tests.id('weekly');
select tests.assert(
  (select sync_weekdays = '{1,2,3,4,5}'::smallint[] and sync_weekday = 1 from public.sync_sources where id = tests.id('weekly')),
  'set_keeps_single_day_in_step: Monday to Friday did not leave the single day on Monday'
);
update public.sync_sources set sync_weekdays = '{6,3}' where id = tests.id('weekly');
select tests.assert(
  (select sync_weekdays = '{3,6}'::smallint[] and sync_weekday = 3 from public.sync_sources where id = tests.id('weekly')),
  'set_keeps_single_day_in_step: the single day did not move to the lowest day of the new set'
);
-- When a write sends both, the set wins and the single day follows it.
update public.sync_sources set sync_weekdays = '{2,4}', sync_weekday = 6 where id = tests.id('weekly');
select tests.assert(
  (select sync_weekdays = '{2,4}'::smallint[] and sync_weekday = 2 from public.sync_sources where id = tests.id('weekly')),
  'set_keeps_single_day_in_step: a write that sent both did not keep the single day on the set''s lowest day'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- case: single_day_alone_still_works
select tests.act_as(tests.id('kingdom_admin'));
insert into public.sync_sources (company_id, connection_id, provider, name, target_module, sync_weekday, sync_time, sync_timezone)
values (tests.company('kingdom'), tests.id('k_sheets'), 'google_sheets', 'Sample older client tab', 'sales_reporting', 3, '07:00', 'America/Chicago');
reset role;
select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id) select 'older', id from public.sync_sources where name = 'Sample older client tab';
select tests.act_as(tests.id('kingdom_admin'));
select tests.assert(
  (select sync_weekdays = '{3}'::smallint[] and sync_weekday = 3 from public.sync_sources where id = tests.id('older')),
  'single_day_alone_still_works: an insert with only the single day did not get the set {3}'
);
update public.sync_sources set sync_weekday = 5 where id = tests.id('older');
select tests.assert(
  (select sync_weekdays = '{5}'::smallint[] and sync_weekday = 5 from public.sync_sources where id = tests.id('older')),
  'single_day_alone_still_works: an update to only the single day did not move the set with it'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- case: schedule_is_all_or_nothing
select tests.act_as(tests.id('kingdom_admin'));
select tests.assert_raises(
  format(
    $q$insert into public.sync_sources (company_id, connection_id, provider, name, target_module, sync_weekdays)
       values (%L, %L, 'google_sheets', 'Days only', 'sales_reporting', '{1,2}')$q$,
    tests.company('kingdom'), tests.id('k_sheets')
  ),
  '%sync_sources_schedule_check%'
);
select tests.assert_raises(
  format($q$update public.sync_sources set sync_time = null where id = %L$q$, tests.id('weekly')),
  '%sync_sources_schedule_check%'
);
select tests.assert_raises(
  format($q$update public.sync_sources set sync_timezone = null where id = %L$q$, tests.id('weekly')),
  '%sync_sources_schedule_check%'
);
update public.sync_sources set sync_weekdays = null, sync_time = null, sync_timezone = null where id = tests.id('weekly');
select tests.assert(
  (select sync_weekdays is null and sync_weekday is null and sync_time is null and sync_timezone is null
     from public.sync_sources where id = tests.id('weekly')),
  'schedule_is_all_or_nothing: clearing the set, time and zone did not clear both day columns'
);
-- An older client clears the single day, time and zone together; the set clears with it.
update public.sync_sources set sync_weekday = null, sync_time = null, sync_timezone = null where id = tests.id('older');
select tests.assert(
  (select sync_weekdays is null and sync_weekday is null from public.sync_sources where id = tests.id('older')),
  'schedule_is_all_or_nothing: clearing the single day, time and zone left a set behind'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- case: bad_sets_refused
select tests.act_as(tests.id('kingdom_admin'));
update public.sync_sources set sync_weekdays = '{1}', sync_time = '07:00', sync_timezone = 'America/Chicago' where id = tests.id('weekly');
select tests.assert_raises(
  format($q$update public.sync_sources set sync_weekdays = '{}' where id = %L$q$, tests.id('weekly')),
  '%check constraint%'
);
select tests.assert_raises(
  format($q$update public.sync_sources set sync_weekdays = '{7}' where id = %L$q$, tests.id('weekly')),
  '%check constraint%'
);
select tests.assert_raises(
  format($q$update public.sync_sources set sync_weekdays = '{-1,2}' where id = %L$q$, tests.id('weekly')),
  '%check constraint%'
);
select tests.assert_raises(
  format($q$update public.sync_sources set sync_weekdays = '{1,1}' where id = %L$q$, tests.id('weekly')),
  'Pick each sync day once.'
);
select tests.assert_raises(
  format($q$update public.sync_sources set sync_weekdays = '{1,null}' where id = %L$q$, tests.id('weekly')),
  '%sync_sources_weekdays_check%'
);
select tests.assert_raises(
  format($q$update public.sync_sources set sync_weekday = 7 where id = %L$q$, tests.id('weekly')),
  '%check constraint%'
);
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select sync_weekdays = '{1}'::smallint[] and sync_weekday = 1 from public.sync_sources where id = tests.id('weekly')),
  'bad_sets_refused: a refused set changed the source'
);

-- case: defaults_are_today
select tests.assert(
  (select bool_and(stale_business_days = false) from public.sync_sources),
  'defaults_are_today: a source counts business days only before anyone chose it'
);
select tests.assert(
  (select column_default = 'false' and is_nullable = 'NO'
     from information_schema.columns
    where table_schema = 'public' and table_name = 'sync_sources' and column_name = 'stale_business_days'),
  'defaults_are_today: stale_business_days is not a not-null column defaulting to false'
);

-- case: syncer_cannot_change_schedule
select tests.act_as(tests.id('kingdom_manager'));
do $$
declare
  v_rows integer;
begin
  update public.sync_sources set sync_requested_at = now() where id = tests.id('weekly');
  get diagnostics v_rows = row_count;
  perform tests.assert(v_rows = 1, 'syncer_cannot_change_schedule: the manager could not request a sync');
  perform tests.assert_raises(
    format($q$update public.sync_sources set sync_weekdays = '{1,2}' where id = %L$q$, tests.id('weekly')),
    'You can request a sync but not change the source.'
  );
  perform tests.assert_raises(
    format($q$update public.sync_sources set sync_weekday = 2 where id = %L$q$, tests.id('weekly')),
    'You can request a sync but not change the source.'
  );
  perform tests.assert_raises(
    format($q$update public.sync_sources set stale_business_days = true where id = %L$q$, tests.id('weekly')),
    'You can request a sync but not change the source.'
  );
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select sync_weekdays = '{1}'::smallint[] and stale_business_days = false and sync_requested_at is not null
     from public.sync_sources where id = tests.id('weekly')),
  'syncer_cannot_change_schedule: the manager''s request did not land, or the schedule changed'
);

-- case: changes_are_audited
select set_config('audit.before', (
  select count(*) from public.audit_events where table_name = 'sync_sources' and row_id = tests.id('weekly')::text
)::text, true);
select tests.act_as(tests.id('kingdom_admin'));
update public.sync_sources set sync_weekdays = '{1,2,3,4,5}', stale_business_days = true where id = tests.id('weekly');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select count(*) from public.audit_events
    where table_name = 'sync_sources'
      and row_id = tests.id('weekly')::text
      and action = 'update'
      and changed -> 'sync_weekdays' = '{"old": [1], "new": [1, 2, 3, 4, 5]}'::jsonb
      and changed -> 'stale_business_days' = '{"old": false, "new": true}'::jsonb
      and not changed ? 'sync_weekday'
      and actor_profile_id = tests.id('kingdom_admin')) = 1
  and (select count(*) from public.audit_events
        where table_name = 'sync_sources' and row_id = tests.id('weekly')::text)
      - current_setting('audit.before')::bigint = 1,
  'changes_are_audited: the set and the business days switch were not written to the change log as one event'
);
