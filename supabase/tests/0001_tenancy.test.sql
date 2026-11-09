-- 0001_tenancy.test.sql
-- Proves the harness itself: migrations 0001 to 0023 apply in order, and the company wall
-- holds on profiles when a test acts as a real signed-in person. Every later test file leans
-- on the same helpers, so if this file passes they can be trusted.
--
-- Runs inside one transaction the harness opens and rolls back; never begin or commit here.

-- Setup, as system.
select tests.create_person('klasik_admin', tests.company('klasik'), 'admin');
select tests.create_person('kingdom_employee', tests.company('kingdom'));
select tests.create_person('rococo_admin', null, 'employee', true);

-- case: migrations_applied
do $$
begin
  if (select count(*) from public.companies where slug in ('kingdom', 'klasik', 'rba')) <> 3 then
    raise exception 'migrations_applied: the three seeded companies are missing';
  end if;
  if to_regprocedure('private.can_manage_company(uuid)') is null then
    raise exception 'migrations_applied: private.can_manage_company(uuid) does not exist';
  end if;
end;
$$;

-- case: act_as_reads_own_profile
select tests.act_as(tests.id('klasik_admin'));
do $$
begin
  if (select count(*) from public.profiles where id = tests.id('klasik_admin')) <> 1 then
    raise exception 'act_as_reads_own_profile: klasik_admin cannot read their own profile';
  end if;
end;
$$;

-- case: klasik_admin_cannot_read_kingdom_profile
do $$
begin
  if (select count(*) from public.profiles where id = tests.id('kingdom_employee')) <> 0 then
    raise exception 'klasik_admin_cannot_read_kingdom_profile: a Kingdom profile is visible to a Klasik admin';
  end if;
end;
$$;

-- case: klasik_admin_cannot_update_kingdom_profile
do $$
declare
  v_rows integer;
begin
  update public.profiles set title = 'x' where id = tests.id('kingdom_employee');
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'klasik_admin_cannot_update_kingdom_profile: % Kingdom row(s) updated by a Klasik admin', v_rows;
  end if;
end;
$$;

-- case: klasik_admin_reads_one_company
do $$
begin
  if (select count(*) from public.companies) <> 1 then
    raise exception 'klasik_admin_reads_one_company: a Klasik admin sees % companies', (select count(*) from public.companies);
  end if;
end;
$$;

-- case: rococo_reads_kingdom_profile
select tests.act_as(tests.id('rococo_admin'));
do $$
begin
  if (select count(*) from public.profiles where id = tests.id('kingdom_employee')) <> 1 then
    raise exception 'rococo_reads_kingdom_profile: a Rococo admin cannot read a Kingdom profile';
  end if;
end;
$$;

-- case: anon_has_no_table_access
reset role;
select set_config('request.jwt.claims', '', true);
set role anon;
select tests.assert_raises('select 1 from public.profiles', '%permission denied%');
reset role;
select set_config('request.jwt.claims', '', true);

-- case: company_lookup_while_acting
select tests.act_as(tests.id('klasik_admin'));
select tests.assert(tests.company('kingdom') is not null,
  'company_lookup_while_acting: tests.company cannot find kingdom while acting as klasik_admin');
reset role;
select set_config('request.jwt.claims', '', true);
