-- 0042_company_display_settings.test.sql
-- Proves the two display settings on a company (0042): the defaults leave every company as it is
-- today, only a Rococo admin changes them, the days must be 1 to 3650, and the audit records both.
--
-- Runs inside one transaction the harness opens and rolls back; never begin or commit here.

-- Setup, as system.
select tests.create_person('kingdom_owner', tests.company('kingdom'), 'owner');
select tests.create_person('kingdom_admin', tests.company('kingdom'), 'admin');
select tests.create_person('rococo_admin', null, 'employee', true);

-- case: defaults_are_today
do $$
begin
  perform tests.assert(
    not exists (select 1 from public.companies where wins_home_days is not null or manual_financials is not true),
    'defaults_are_today: a company does not carry the defaults'
  );
end $$;

-- case: rococo_sets_both
select tests.act_as(tests.id('rococo_admin'));
do $$
declare
  v_rows integer;
begin
  update public.companies set wins_home_days = 14, manual_financials = false where id = tests.company('kingdom');
  get diagnostics v_rows = row_count;
  perform tests.assert(v_rows = 1, 'rococo_sets_both: the update did not land');
  perform tests.assert(
    exists (select 1 from public.companies where id = tests.company('kingdom') and wins_home_days = 14 and manual_financials = false),
    'rococo_sets_both: Kingdom does not carry the new values'
  );
  perform tests.assert(
    exists (select 1 from public.companies where id = tests.company('klasik') and wins_home_days is null and manual_financials = true),
    'rococo_sets_both: Klasik changed'
  );
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- case: company_cannot_set
select tests.act_as(tests.id('kingdom_owner'));
select tests.assert_raises(
  $q$update public.companies set wins_home_days = 7 where id = tests.company('kingdom')$q$,
  'Only Rococo admins can change a company slug, theme, modules or display settings.'
);
select tests.assert_raises(
  $q$update public.companies set manual_financials = true where id = tests.company('kingdom')$q$,
  'Only Rococo admins can change a company slug, theme, modules or display settings.'
);
do $$
declare
  v_rows integer;
begin
  update public.companies set name = 'Kingdom renamed', time_zone = 'America/Chicago' where id = tests.company('kingdom');
  get diagnostics v_rows = row_count;
  perform tests.assert(v_rows = 1, 'company_cannot_set: the owner could no longer change name and time zone');
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- case: days_must_be_positive
select tests.act_as(tests.id('rococo_admin'));
select tests.assert_raises(
  $q$update public.companies set wins_home_days = 0 where id = tests.company('kingdom')$q$,
  '%check constraint%'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- case: days_capped_at_3650
select tests.act_as(tests.id('rococo_admin'));
select tests.assert_raises(
  $q$update public.companies set wins_home_days = 3651 where id = tests.company('kingdom')$q$,
  '%companies_wins_home_days_check%'
);
do $$
declare
  v_rows integer;
begin
  update public.companies set wins_home_days = 3650 where id = tests.company('kingdom');
  get diagnostics v_rows = row_count;
  perform tests.assert(
    v_rows = 1 and exists (select 1 from public.companies where id = tests.company('kingdom') and wins_home_days = 3650),
    'days_capped_at_3650: 3650 days was not accepted'
  );
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- case: changes_are_audited
select tests.act_as(tests.id('rococo_admin'));
update public.companies set wins_home_days = 21 where id = tests.company('klasik');
update public.companies set manual_financials = false where id = tests.company('klasik');
reset role;
select set_config('request.jwt.claims', '', true);
do $$
begin
  perform tests.assert(
    exists (select 1 from public.audit_events where table_name = 'companies' and row_id = tests.company('klasik')::text and changed ? 'wins_home_days'),
    'changes_are_audited: wins_home_days is not in the log'
  );
  perform tests.assert(
    exists (select 1 from public.audit_events where table_name = 'companies' and row_id = tests.company('klasik')::text and changed ? 'manual_financials'),
    'changes_are_audited: manual_financials is not in the log'
  );
end $$;
