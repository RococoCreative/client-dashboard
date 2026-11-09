-- docs/rba-klasik-parity.sql
-- Exists so there is a record of how RBA's configuration was brought level with Klasik's on
-- 2026-11-09. This is a one-off data change, not a migration: it changes rows only, never the
-- schema, the same way Klasik's own Deliverables pillar was switched (docs/q3-mock-findings.md).
-- It was run once against the live project in the SQL editor's role. Do not re-run it: RBA
-- now owns this configuration and edits it in Settings.
--
-- What it copies: the shape of Klasik's review (four pillars, their scoring types and weights,
-- five rated criteria a pillar, two required GSRs a month), the deliverable categories and the
-- job roles. What it leaves out on purpose: Klasik's own words (brand pillar and core value
-- text), its company goal figures, its review cycles and its people. Those belong to Klasik.
--
-- Guard: it refuses to touch RBA if any review, impact score or person already exists there.

begin;

do $$
declare
  v_rba         uuid;
  v_performance uuid;
  v_values      uuid;
  v_growth      uuid;
  v_brand       uuid;
begin
  select id into v_rba from public.companies where slug = 'rba';
  if v_rba is null then
    raise exception 'RBA company row not found';
  end if;
  if exists (select 1 from public.reviews where company_id = v_rba)
     or exists (select 1 from public.impact_scores where company_id = v_rba)
     or exists (select 1 from public.profiles where company_id = v_rba) then
    raise exception 'RBA already has people or scores; change its configuration in Settings instead';
  end if;

  select id into v_performance from public.gsr_pillars
   where company_id = v_rba and name = 'Performance';
  select id into v_values from public.gsr_pillars
   where company_id = v_rba and name = 'Core Values';
  select id into v_growth from public.gsr_pillars
   where company_id = v_rba and name = 'Professional Development';
  if v_performance is null or v_values is null or v_growth is null then
    raise exception 'RBA pillars are not the seeded set; nothing changed';
  end if;

  -- 1. Deliverables, 40, scored from the deliverables module at sign-off (Klasik: Decision B).
  update public.gsr_pillars
     set name = 'Deliverables',
         description = 'Target vs actual on the deliverable groups agreed for the period.',
         weight = 40,
         scoring_type = 'deliverables_module',
         sort_order = 1,
         is_active = true,
         required_goals = 2
   where id = v_performance;

  -- 2. Brand Impact, 20, rated 1 to 5 on five brand criteria. Klasik's slot names, no Klasik
  --    text: RBA writes its own descriptions.
  insert into public.gsr_pillars
    (company_id, name, description, weight, scoring_type, rating_scale_max, sort_order, is_active, required_goals)
  values
    (v_rba, 'Brand Impact', 'How fully the person lives the RBA brand pillars, rated 1 to 5.',
     20, 'rating', 5, 2, true, 2)
  returning id into v_brand;

  insert into public.gsr_criteria (pillar_id, company_id, name, sort_order, is_active) values
    (v_brand, v_rba, 'DNA', 1, true),
    (v_brand, v_rba, 'Identity', 2, true),
    (v_brand, v_rba, 'Mission', 3, true),
    (v_brand, v_rba, 'Company Vision', 4, true),
    (v_brand, v_rba, 'Culture Vision', 5, true);

  -- 3. Character & Values, 20, rated 1 to 5. Keeps RBA's three placeholder values until RBA
  --    names its own; Klasik's five values are Klasik's.
  update public.gsr_pillars
     set name = 'Character & Values',
         description = 'How fully the person lives the RBA core values, rated 1 to 5.',
         weight = 20,
         scoring_type = 'rating',
         rating_scale_max = 5,
         sort_order = 3,
         is_active = true,
         required_goals = 2
   where id = v_values;

  -- 4. Monthly GSRs, 20, two mandatory GSRs a month, scored from locked months only.
  insert into public.gsr_pillars
    (company_id, name, description, weight, scoring_type, rating_scale_max, sort_order, is_active, required_goals)
  values
    (v_rba, 'Monthly GSRs',
     'How fully the person completes their monthly GSRs, each month at the score an admin locked in.',
     20, 'gsr_goals', 5, 4, true, 2);

  -- Klasik has no Professional Development pillar. Its two criteria go with it (cascade).
  delete from public.gsr_pillars where id = v_growth;

  -- Deliverable categories, in Klasik's order.
  insert into public.deliverable_categories (company_id, name, sort_order, is_active)
  select v_rba, c.name, c.sort_order, true
    from (values
      ('BD & Sales', 1),
      ('Production', 2),
      ('Financial', 3),
      ('Operations & Systems', 4),
      ('Leadership', 5)
    ) as c(name, sort_order)
   where not exists (
     select 1 from public.deliverable_categories d
      where d.company_id = v_rba and lower(d.name) = lower(c.name));

  -- Job roles, in Klasik's order, carrying no dashboard modules (as Klasik's do today).
  insert into public.job_roles (company_id, name, sort_order, is_active, dashboard_modules)
  select v_rba, r.name, r.sort_order, true, '{}'
    from (values
      ('Project Coordinator', 1),
      ('Production Manager', 2),
      ('Site Supervisor', 3),
      ('Owner', 4),
      ('General Manager', 5),
      ('Bookkeeper', 6),
      ('Accountant', 7),
      ('Human Resources', 8)
    ) as r(name, sort_order)
   where not exists (
     select 1 from public.job_roles j
      where j.company_id = v_rba and lower(j.name) = lower(r.name));
end $$;

commit;
