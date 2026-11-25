-- sandbox_company.sql
-- A company for Rococo to test in on the live hub, so new work (importing SOPs, assigning tasks,
-- signing off, reviews) is tried there before it reaches a client's people. It is an ordinary
-- company (rule 12: its shape is its rows), walled off from the three clients by the same row level
-- security, and it never touches their rows.
--
-- What it adds, in one transaction:
--   * The company "Sandbox" (slug sandbox) on the Rococo theme, with every module on, Financials on,
--     GSRs by month, in America/New_York. No sign-in domain, so nobody joins it except by invitation.
--   * Its review setup in the shape Klasik runs live: Deliverables 40 (from the deliverables
--     module), Brand Impact 20 and Character & Values 20 (each rated 1 to 5 on five criteria), and
--     Monthly GSRs 20 (two required GSRs a month); five deliverable categories; three job roles.
--   * Four people on the roster, none signed in yet: an admin, a manager who reports to the admin,
--     and two employees who report to the manager. Their addresses are plus addresses of the one
--     inbox you set below (name+sandbox-admin@..., +sandbox-manager, +sandbox-employee,
--     +sandbox-nologin). The last one is never meant to sign in, to test people with no account.
--   * Two SOP categories, a published SOP and a draft, a task on the published SOP for the employee
--     (their sign-off closes it), a plain task, a win, a project and a link, so every screen has
--     something on it.
--
-- Before running: set v_inbox on the marked line to an inbox you read that is not on rocococreative.io
-- (the sign-in gate admits a rocococreative.io address only when it is on the Rococo admin list, so
-- an invitation to one is refused) and not on a client's sign-in domain. A Gmail address works:
-- Gmail delivers name+anything@gmail.com to name@gmail.com.
--
-- Run it once in the Supabase SQL editor. Safe to run again: a second run finds everything in place
-- and changes nothing, and never undoes what has been changed in the hub since. It stops with a
-- plain message, changing nothing, if the inbox is unset or unsafe, or if one of the four addresses
-- already belongs to someone outside the Sandbox.
--
-- After running, as a Rococo admin: open Sandbox from the portfolio, go to People, and press Send
-- invite on the admin, manager and employee rows. Each email arrives in your inbox; open each link in
-- a separate browser profile or a private window to be that person. Create this month's GSR period
-- from GSRs when you want to test GSRs.
--
-- To remove the Sandbox later: Rococo, Companies, delete it. That disconnects its connections,
-- removes its files and cascades its rows; the test people's sign-ins go on the block list like any
-- deleted person's.

begin;

do $$
declare
  -- Set this to your own test inbox. ------------------------------------------------------------
  v_inbox   constant text := 'yourname@gmail.com';
  -- ----------------------------------------------------------------------------------------------
  v_local   text;
  v_domain  text;
  v_company uuid;
  v_brand   uuid;
  v_values  uuid;
  v_admin   uuid;
  v_manager uuid;
  v_emp     uuid;
  v_safety  uuid;
  v_process uuid;
  v_sop     uuid;
  v_draft   uuid;
  v_clash   text;
begin
  if lower(v_inbox) = 'yourname@gmail.com' then
    raise exception 'Set v_inbox at the top of this script to your own test inbox. Nothing was changed.';
  end if;
  if v_inbox !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'v_inbox is not an email address. Nothing was changed.';
  end if;
  v_local := split_part(split_part(lower(v_inbox), '@', 1), '+', 1);
  v_domain := split_part(lower(v_inbox), '@', 2);
  if v_domain = 'rocococreative.io' then
    raise exception 'Use an inbox outside rocococreative.io: the sign-in gate refuses a rocococreative.io address that is not on the Rococo admin list. Nothing was changed.';
  end if;
  if exists (select 1 from public.company_domains d where d.domain = v_domain) then
    raise exception 'That inbox is on a client''s sign-in domain, so its test people would land in that company. Use another inbox. Nothing was changed.';
  end if;

  -- The company. Created once; a second run leaves whatever has been set since.
  insert into public.companies (slug, name, theme_key, time_zone, modules, manual_financials)
  values ('sandbox', 'Sandbox', 'rococo', 'America/New_York',
          array['switchboard', 'production', 'wins', 'data_sources', 'external_links', 'tasks'], true)
  on conflict (slug) do nothing;
  select id into v_company from public.companies where slug = 'sandbox';

  -- The four addresses must be free, or already the Sandbox's own.
  select string_agg(p.email, ', ') into v_clash
    from public.profiles p
   where lower(p.email) in (
           v_local || '+sandbox-admin@' || v_domain,
           v_local || '+sandbox-manager@' || v_domain,
           v_local || '+sandbox-employee@' || v_domain,
           v_local || '+sandbox-nologin@' || v_domain)
     and p.company_id is distinct from v_company;
  if v_clash is not null then
    raise exception 'These addresses already belong to someone outside the Sandbox: %. Nothing was changed.', v_clash;
  end if;

  -- Review setup, only for a Sandbox with no pillars yet.
  if not exists (select 1 from public.gsr_pillars where company_id = v_company) then
    insert into public.gsr_pillars
      (company_id, name, description, weight, scoring_type, rating_scale_max, sort_order, is_active, required_goals)
    values
      (v_company, 'Deliverables', 'Target vs actual on the deliverable groups agreed for the period.',
       40, 'deliverables_module', 5, 1, true, 2);
    insert into public.gsr_pillars
      (company_id, name, description, weight, scoring_type, rating_scale_max, sort_order, is_active, required_goals)
    values
      (v_company, 'Brand Impact', 'How fully the person lives the brand pillars, rated 1 to 5.',
       20, 'rating', 5, 2, true, 2)
    returning id into v_brand;
    insert into public.gsr_pillars
      (company_id, name, description, weight, scoring_type, rating_scale_max, sort_order, is_active, required_goals)
    values
      (v_company, 'Character & Values', 'How fully the person lives the core values, rated 1 to 5.',
       20, 'rating', 5, 3, true, 2)
    returning id into v_values;
    insert into public.gsr_pillars
      (company_id, name, description, weight, scoring_type, rating_scale_max, sort_order, is_active, required_goals)
    values
      (v_company, 'Monthly GSRs',
       'How fully the person completes their monthly GSRs, each month at the score an admin locked in.',
       20, 'gsr_goals', 5, 4, true, 2);
    insert into public.gsr_criteria (pillar_id, company_id, name, sort_order, is_active) values
      (v_brand, v_company, 'Communication', 1, true),
      (v_brand, v_company, 'Identity', 2, true),
      (v_brand, v_company, 'Mission', 3, true),
      (v_brand, v_company, 'Company Vision', 4, true),
      (v_brand, v_company, 'Culture', 5, true),
      (v_values, v_company, 'Curiosity', 1, true),
      (v_values, v_company, 'Integrity', 2, true),
      (v_values, v_company, 'Competency', 3, true),
      (v_values, v_company, 'Tenacity', 4, true),
      (v_values, v_company, 'Community', 5, true);
  end if;

  insert into public.deliverable_categories (company_id, name, sort_order, is_active)
  select v_company, c.name, c.ord, true
    from (values ('BD & Sales', 1), ('Production', 2), ('Financial', 3), ('Operations & Systems', 4), ('Leadership', 5)) as c(name, ord)
   where not exists (select 1 from public.deliverable_categories d where d.company_id = v_company and lower(d.name) = lower(c.name));

  insert into public.job_roles (company_id, name, sort_order, is_active, dashboard_modules)
  select v_company, r.name, r.ord, true, '{}'
    from (values ('General Manager', 1), ('Project Manager', 2), ('Site Supervisor', 3)) as r(name, ord)
   where not exists (select 1 from public.job_roles j where j.company_id = v_company and lower(j.name) = lower(r.name));

  -- People, the way the People screen adds them: on the roster, no account until they sign in.
  insert into public.profiles (company_id, email, full_name, title, role, division_ids, job_role_id)
  select v_company, p.email, p.full_name, p.title, p.role, '{}',
         (select j.id from public.job_roles j where j.company_id = v_company and j.name = p.job)
    from (values
      (v_local || '+sandbox-admin@' || v_domain, 'Sandbox Admin', 'General Manager', 'admin', 'General Manager', 1),
      (v_local || '+sandbox-manager@' || v_domain, 'Sandbox Manager', 'Project Manager', 'manager', 'Project Manager', 2),
      (v_local || '+sandbox-employee@' || v_domain, 'Sandbox Employee', 'Site Supervisor', 'employee', 'Site Supervisor', 3),
      (v_local || '+sandbox-nologin@' || v_domain, 'Sandbox No Login', 'Site Supervisor', 'employee', 'Site Supervisor', 4)
    ) as p(email, full_name, title, role, job, ord)
   where not exists (select 1 from public.profiles x where lower(x.email) = lower(p.email))
   order by p.ord;

  select id into v_admin from public.profiles where lower(email) = v_local || '+sandbox-admin@' || v_domain;
  select id into v_manager from public.profiles where lower(email) = v_local || '+sandbox-manager@' || v_domain;
  select id into v_emp from public.profiles where lower(email) = v_local || '+sandbox-employee@' || v_domain;

  -- Reporting lines, only where none is set: manager to admin, both employees to the manager.
  update public.profiles set reports_to = v_admin where id = v_manager and reports_to is null;
  update public.profiles set reports_to = v_manager
   where company_id = v_company and reports_to is null
     and lower(email) in (v_local || '+sandbox-employee@' || v_domain, v_local || '+sandbox-nologin@' || v_domain);

  -- SOP categories and two SOPs, only for a Sandbox with no SOPs yet.
  insert into public.sop_categories (company_id, name, sort_order)
  values (v_company, 'Safety', 1), (v_company, 'Process', 2)
  on conflict (company_id, lower(btrim(name))) do nothing;
  if not exists (select 1 from public.sops where company_id = v_company) then
    select id into v_safety from public.sop_categories where company_id = v_company and name = 'Safety';
    select id into v_process from public.sop_categories where company_id = v_company and name = 'Process';
    insert into public.sops (company_id, title, summary, status, category_id, tags)
    values (v_company, 'Daily site walk', 'The walk every crew takes before work starts.', 'published', v_safety, array['Daily', 'Site'])
    returning id into v_sop;
    insert into public.sop_versions (sop_id, body_md, change_note) values (v_sop,
      E'## Purpose\n\nCatch hazards before the crew starts.\n\n## Steps\n\n1. Walk the site with the lead.\n2. Note anything that does not match the plan.\n3. Photograph each hazard and post it to the shared drive.\n\n## Checks\n\n- Hazards noted and photographed\n- Lead has signed the sheet\n',
      'First version');
    insert into public.sops (company_id, title, summary, status, category_id, tags)
    values (v_company, 'Change order handling', 'How a scope change is priced, approved and recorded.', 'draft', v_process, array['Client'])
    returning id into v_draft;
    insert into public.sop_versions (sop_id, body_md, change_note) values (v_draft,
      E'## Purpose\n\nKeep every scope change priced and signed before work changes.\n\n## Steps\n\n1. Price the change.\n2. Get the client''s written approval.\n3. Record it on the project.\n',
      'First version');

    -- A task on the published SOP (the employee's sign-off closes it) and a plain one.
    insert into public.tasks (company_id, title, description, assignee_id, created_by, due_date, priority, sop_id)
    values (v_company, 'Complete SOP: Daily site walk',
            'Read the SOP and do what it asks, then sign it off on the SOP''s page. Signing off finishes this task.',
            v_emp, v_admin, current_date + 7, 'medium', v_sop);
    insert into public.tasks (company_id, title, assignee_id, created_by, due_date, priority)
    values (v_company, 'Order safety signage for the yard', v_manager, v_admin, current_date + 3, 'high');
  end if;

  if not exists (select 1 from public.wins where company_id = v_company) then
    insert into public.wins (company_id, title, won_on) values (v_company, 'Sandbox set up for testing', current_date);
  end if;
  if not exists (select 1 from public.projects where company_id = v_company) then
    insert into public.projects (company_id, name, reference) values (v_company, 'Sample project', 'SB-001');
  end if;
  if not exists (select 1 from public.external_links where company_id = v_company) then
    insert into public.external_links (company_id, nav_group, label, url, provider, audience)
    values (v_company, 'home', 'Shared drive', 'https://drive.google.com', 'other', 'everyone');
  end if;
end $$;

commit;

-- Check: the Sandbox's people, who each reports to, and whether they have signed in. Expect four rows.
select p.full_name, p.role, p.email, m.full_name as reports_to, (p.user_id is not null) as signed_in
  from public.profiles p
  join public.companies c on c.id = p.company_id and c.slug = 'sandbox'
  left join public.profiles m on m.id = p.reports_to
 order by case p.role when 'admin' then 1 when 'manager' then 2 else 3 end, p.full_name;
