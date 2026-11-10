-- 0024_company_modules.test.sql
-- Proves the module switch (0024): every company starts with no modules, only Rococo (or a
-- system write) can change a company's modules, the existing slug and theme protection still
-- holds, and a company admin can still rename their own company.
--
-- Runs inside one transaction the harness opens and rolls back; never begin or commit here.

-- Setup, as system.
select tests.create_person('klasik_admin', tests.company('klasik'), 'admin');
select tests.create_person('klasik_employee', tests.company('klasik'));
select tests.create_person('rococo_admin', null, 'employee', true);

-- case: modules_column_default
do $$
begin
  if exists (select 1 from public.companies where modules <> '{}') then
    raise exception 'modules_column_default: a seeded company has modules on';
  end if;
  if (select count(*) from public.companies where slug in ('kingdom', 'klasik', 'rba') and modules = '{}') <> 3 then
    raise exception 'modules_column_default: the three seeded companies do not all read {}';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'companies' and column_name = 'modules'
       and data_type = 'ARRAY' and is_nullable = 'NO'
  ) then
    raise exception 'modules_column_default: companies.modules is not a not-null array';
  end if;
end;
$$;

-- case: company_admin_cannot_change_modules
select tests.act_as(tests.id('klasik_admin'));
select tests.assert_raises(
  $q$update public.companies set modules = '{wins}' where slug = 'klasik'$q$,
  '%Only Rococo admins can change a company slug, theme or modules.%'
);

-- case: company_admin_cannot_change_slug_or_theme
select tests.assert_raises(
  $q$update public.companies set theme_key = 'rba' where slug = 'klasik'$q$,
  '%Only Rococo admins can change a company slug, theme or modules.%'
);
select tests.assert_raises(
  $q$update public.companies set slug = 'klasik-two' where slug = 'klasik'$q$,
  '%Only Rococo admins can change a company slug, theme or modules.%'
);

-- case: company_admin_can_still_rename
do $$
declare
  v_rows integer;
begin
  update public.companies set name = 'Klasik Renamed' where slug = 'klasik';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'company_admin_can_still_rename: % row(s) renamed by a Klasik admin', v_rows;
  end if;
end;
$$;

-- case: employee_cannot_update_company
select tests.act_as(tests.id('klasik_employee'));
do $$
declare
  v_rows integer;
begin
  update public.companies set name = 'Klasik By Employee' where slug = 'klasik';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'employee_cannot_update_company: % row(s) renamed by a Klasik employee', v_rows;
  end if;
end;
$$;

-- case: rococo_can_change_modules
select tests.act_as(tests.id('rococo_admin'));
do $$
declare
  v_rows integer;
begin
  update public.companies set modules = '{switchboard,wins}' where slug = 'kingdom';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'rococo_can_change_modules: % row(s) updated by a Rococo admin', v_rows;
  end if;
end;
$$;
reset role;
select set_config('request.jwt.claims', '', true);
do $$
begin
  if (select modules from public.companies where slug = 'kingdom') is distinct from '{switchboard,wins}'::text[] then
    raise exception 'rococo_can_change_modules: Kingdom reads back %',
      (select modules from public.companies where slug = 'kingdom');
  end if;
end;
$$;

-- case: unknown_keys_allowed
select tests.act_as(tests.id('rococo_admin'));
do $$
declare
  v_rows integer;
begin
  update public.companies set modules = '{future_key}' where slug = 'rba';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'unknown_keys_allowed: % row(s) saved with an unknown key', v_rows;
  end if;
end;
$$;

-- case: system_can_change_modules
reset role;
select set_config('request.jwt.claims', '', true);
do $$
declare
  v_rows integer;
begin
  update public.companies set modules = '{production}' where slug = 'klasik';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'system_can_change_modules: % row(s) updated as system', v_rows;
  end if;
end;
$$;

-- case: guard_body_is_current
do $$
declare
  v_def text := pg_get_functiondef('public.guard_company_fields()'::regprocedure);
begin
  if position('new.modules is distinct from old.modules' in v_def) = 0 then
    raise exception 'guard_body_is_current: guard_company_fields does not check modules';
  end if;
  if position('private.is_rococo_admin()' in v_def) = 0 then
    raise exception 'guard_body_is_current: guard_company_fields does not call private.is_rococo_admin()';
  end if;
  if (select count(*) from pg_trigger
       where tgrelid = 'public.companies'::regclass
         and tgname = 'companies_guard_fields'
         and not tgisinternal) <> 1 then
    raise exception 'guard_body_is_current: expected exactly one companies_guard_fields trigger';
  end if;
end;
$$;
