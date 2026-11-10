-- 0031_external_links.test.sql
-- Proves the external links registry (0031): admins write a company's links, members read only
-- the links meant for everyone, admins and Rococo read them all, another company sees and writes
-- nothing, links and embed links are https only, a public embed needs an embed link, the section,
-- tool, audience and label are checked, a link's company is pinned, admins delete, and a change to
-- a watched column writes one audit event while an unwatched one writes none.
--
-- Runs inside one transaction the harness opens and rolls back; never begin or commit here.

-- Setup, as system.
select tests.create_person('k_admin', tests.company('kingdom'), 'admin');
select tests.create_person('k_emp', tests.company('kingdom'));
select tests.create_person('l_admin', tests.company('klasik'), 'admin');
select tests.create_person('rococo', null, 'employee', true);

-- case: admin_creates_link
select tests.act_as(tests.id('k_admin'));
insert into public.external_links (company_id, nav_group, label, url, provider, audience)
values (tests.company('kingdom'), 'sales_finance', 'Sample sales board',
        'https://example.com/monday/sample-sales-board', 'monday', 'everyone');
insert into public.external_links (company_id, nav_group, label, url, provider, audience)
values (tests.company('kingdom'), 'home', 'Sample admin board',
        'https://example.com/monday/sample-admin-board', 'monday', 'admins');
-- tests.fixture is written as system only.
reset role;
select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id)
select 'link_everyone', id from public.external_links where label = 'Sample sales board';
insert into tests.fixture (name, id)
select 'link_admins', id from public.external_links where label = 'Sample admin board';
select tests.assert(
  (select count(*) from public.external_links
    where company_id = tests.company('kingdom') and created_by = tests.id('k_admin')) = 2,
  'admin_creates_link: the two inserts were not stamped with the Kingdom admin'
);

-- case: employee_reads_everyone_links_only
select tests.act_as(tests.id('k_emp'));
select tests.assert(
  (select count(*) from public.external_links where company_id = tests.company('kingdom')) = 1,
  'employee_reads_everyone_links_only: a Kingdom employee does not read exactly one link'
);
select tests.assert(
  (select label from public.external_links where company_id = tests.company('kingdom'))
    = 'Sample sales board',
  'employee_reads_everyone_links_only: the employee reads a link that is not for everyone'
);

-- case: admin_reads_both
select tests.act_as(tests.id('k_admin'));
select tests.assert(
  (select count(*) from public.external_links where company_id = tests.company('kingdom')) = 2,
  'admin_reads_both: a Kingdom admin does not read both links'
);
select tests.act_as(tests.id('rococo'));
select tests.assert(
  (select count(*) from public.external_links where company_id = tests.company('kingdom')) = 2,
  'admin_reads_both: a Rococo admin does not read both links'
);

-- case: other_company_sees_nothing
select tests.act_as(tests.id('l_admin'));
select tests.assert(
  (select count(*) from public.external_links where company_id = tests.company('kingdom')) = 0,
  'other_company_sees_nothing: a Klasik admin reads Kingdom links'
);
select tests.assert_raises(
  format(
    $q$insert into public.external_links (company_id, nav_group, label, url, provider)
       values (%L, 'sales_finance', 'Sample sales board',
               'https://example.com/monday/sample-sales-board', 'monday')$q$,
    tests.company('kingdom')
  ),
  '%row-level security%'
);

-- case: employee_cannot_write
select tests.act_as(tests.id('k_emp'));
select tests.assert_raises(
  format(
    $q$insert into public.external_links (company_id, nav_group, label, url, provider)
       values (%L, 'sales_finance', 'Sample sales board',
               'https://example.com/monday/sample-sales-board', 'monday')$q$,
    tests.company('kingdom')
  ),
  '%row-level security%'
);
do $$
declare
  v_rows integer;
begin
  update public.external_links set label = 'Changed' where company_id = tests.company('kingdom');
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'employee_cannot_write: % link row(s) updated by a Kingdom employee', v_rows;
  end if;
  delete from public.external_links where company_id = tests.company('kingdom');
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'employee_cannot_write: % link row(s) deleted by a Kingdom employee', v_rows;
  end if;
end;
$$;
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select label from public.external_links where id = tests.id('link_everyone')) = 'Sample sales board',
  'employee_cannot_write: a link label changed'
);
select tests.assert(
  (select count(*) from public.external_links where company_id = tests.company('kingdom')) = 2,
  'employee_cannot_write: a link was removed'
);

-- case: https_only
select tests.act_as(tests.id('k_admin'));
select tests.assert_raises(
  format(
    $q$insert into public.external_links (company_id, nav_group, label, url, provider)
       values (%L, 'sales_finance', 'Sample sales board', 'http://example.com', 'monday')$q$,
    tests.company('kingdom')
  ),
  '%external_links_url_check%'
);
select tests.assert_raises(
  format(
    $q$insert into public.external_links (company_id, nav_group, label, url, provider)
       values (%L, 'sales_finance', 'Sample sales board', 'javascript:alert(1)', 'monday')$q$,
    tests.company('kingdom')
  ),
  '%external_links_url_check%'
);
select tests.assert_raises(
  format(
    $q$insert into public.external_links (company_id, nav_group, label, url, provider, embed_url)
       values (%L, 'sales_finance', 'Sample sales board',
               'https://example.com/monday/sample-sales-board', 'monday', 'http://example.com')$q$,
    tests.company('kingdom')
  ),
  '%external_links_embed_url_check%'
);

-- case: public_embed_needs_embed_url
select tests.assert_raises(
  format(
    $q$insert into public.external_links (company_id, nav_group, label, url, provider, embed_is_public)
       values (%L, 'sales_finance', 'Sample sales board',
               'https://example.com/monday/sample-sales-board', 'monday', true)$q$,
    tests.company('kingdom')
  ),
  '%external_links_embed_public_check%'
);

-- case: nav_group_and_values_checked
select tests.assert_raises(
  format(
    $q$insert into public.external_links (company_id, nav_group, label, url, provider)
       values (%L, 'utility', 'Sample sales board',
               'https://example.com/monday/sample-sales-board', 'monday')$q$,
    tests.company('kingdom')
  ),
  '%external_links_nav_group_check%'
);
select tests.assert_raises(
  format(
    $q$insert into public.external_links (company_id, nav_group, label, url, provider)
       values (%L, 'sales_finance', 'Sample sales board',
               'https://example.com/monday/sample-sales-board', 'slack')$q$,
    tests.company('kingdom')
  ),
  '%external_links_provider_check%'
);
select tests.assert_raises(
  format(
    $q$insert into public.external_links (company_id, nav_group, label, url, provider, audience)
       values (%L, 'sales_finance', 'Sample sales board',
               'https://example.com/monday/sample-sales-board', 'monday', 'managers')$q$,
    tests.company('kingdom')
  ),
  '%external_links_audience_check%'
);
select tests.assert_raises(
  format(
    $q$insert into public.external_links (company_id, nav_group, label, url, provider)
       values (%L, 'sales_finance', '   ',
               'https://example.com/monday/sample-sales-board', 'monday')$q$,
    tests.company('kingdom')
  ),
  '%external_links_label_check%'
);

-- case: company_pinned
update public.external_links set company_id = tests.company('klasik')
 where id = tests.id('link_everyone');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select company_id from public.external_links where id = tests.id('link_everyone'))
    = tests.company('kingdom'),
  'company_pinned: a link moved to another company'
);

-- case: admin_deletes
select tests.act_as(tests.id('k_admin'));
do $$
declare
  v_rows integer;
begin
  delete from public.external_links where id = tests.id('link_admins');
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'admin_deletes: % link row(s) deleted by a Kingdom admin', v_rows;
  end if;
end;
$$;
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  not exists (select 1 from public.external_links where id = tests.id('link_admins')),
  'admin_deletes: the admins link is still there'
);

-- case: audit_on_watched_change
-- Every event in one transaction shares a created_at, so count before and after.
select set_config('audit.before', (
  select count(*) from public.audit_events
   where table_name = 'external_links' and row_id = tests.id('link_everyone')::text
)::text, true);
select tests.act_as(tests.id('k_admin'));
update public.external_links set label = 'Sample sales pipeline'
 where id = tests.id('link_everyone');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select count(*) from public.audit_events
    where table_name = 'external_links' and row_id = tests.id('link_everyone')::text)
    - current_setting('audit.before')::bigint = 1,
  'audit_on_watched_change: a label change did not write exactly one audit event'
);
select tests.assert(
  exists (select 1 from public.audit_events
           where table_name = 'external_links'
             and row_id = tests.id('link_everyone')::text
             and action = 'update'
             and changed ? 'label'),
  'audit_on_watched_change: no audit event names the label change'
);
select set_config('audit.before', (
  select count(*) from public.audit_events
   where table_name = 'external_links' and row_id = tests.id('link_everyone')::text
)::text, true);
select tests.act_as(tests.id('k_admin'));
update public.external_links set sort_order = 5 where id = tests.id('link_everyone');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select count(*) from public.audit_events
    where table_name = 'external_links' and row_id = tests.id('link_everyone')::text)
    = current_setting('audit.before')::bigint,
  'audit_on_watched_change: a sort order change wrote an audit event'
);
