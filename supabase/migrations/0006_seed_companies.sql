-- 0006_seed_companies.sql
-- The three client companies, their sign-in domains, and a starting GSR configuration for
-- each. Paste after 0005; idempotent: existing companies are left alone and pillars are
-- seeded only for a company that has none yet, so re-running never duplicates or
-- overwrites what an admin has since edited in GSR Settings.
--
-- Domains: Kingdom's is confirmed (the estimating tool uses it). Klasik's and RBA's are
-- taken from their public websites; confirm them in the Rococo admin section before
-- inviting anyone, since a domain here decides who can self-serve a sign-in.

insert into public.companies (slug, name, theme_key) values
  ('klasik',  'Klasik Construction',          'klasik'),
  ('rba',     'RBA Projects',                 'rba'),
  ('kingdom', 'Kingdom Custom Construction',  'kingdom')
on conflict (slug) do nothing;

insert into public.company_domains (domain, company_id)
select d.domain, c.id
  from (values
    ('kingdomcustomconstruction.com', 'kingdom'),
    ('beklasik.com',                  'klasik'),
    ('rbaprojects.com',               'rba')
  ) as d(domain, slug)
  join public.companies c on c.slug = d.slug
on conflict (domain) do nothing;

-- Klasik: the live configuration from the Klasik Executive Dashboard, ported as-is.
-- Deliverables 50%, Brand Impact 25%, Character & Values 25%; both rating pillars on 1..5.
do $$
declare
  v_company uuid;
  v_deliv   uuid;
  v_brand   uuid;
  v_values  uuid;
begin
  select id into v_company from public.companies where slug = 'klasik';
  if v_company is null or exists (select 1 from public.gsr_pillars where company_id = v_company) then
    return;
  end if;

  insert into public.gsr_pillars (company_id, name, description, weight, scoring_type, sort_order)
  values (v_company, 'Deliverables',
          'Target vs actual on the deliverable groups agreed for the period.',
          50, 'deliverables', 1)
  returning id into v_deliv;

  insert into public.gsr_pillars (company_id, name, description, weight, scoring_type, rating_scale_max, sort_order)
  values (v_company, 'Brand Impact',
          'How fully the person lives the Klasik brand pillars, rated 1 to 5.',
          25, 'rating', 5, 2)
  returning id into v_brand;

  insert into public.gsr_pillars (company_id, name, description, weight, scoring_type, rating_scale_max, sort_order)
  values (v_company, 'Character & Values',
          'How fully the person lives the Klasik core values, rated 1 to 5.',
          25, 'rating', 5, 3)
  returning id into v_values;

  insert into public.gsr_criteria (pillar_id, company_id, name, description, sort_order) values
    (v_brand, v_company, 'DNA',
     'Communication is our DNA, transcending every core value. It demands active listening, concise delivery, and a culture of transparency where information flows freely.', 1),
    (v_brand, v_company, 'Identity',
     'A concierge in Carhartt, a crew of construction nerds who take the stress out of building. Meticulous craftsmen, obsessed with performance.', 2),
    (v_brand, v_company, 'Mission',
     'We preserve the integrity of design while providing our customer with a construction experience unmatched by anyone else in the industry.', 3),
    (v_brand, v_company, 'Company Vision',
     'We define luxury through performance, delivering an unparalleled experience rooted in trust and execution.', 4),
    (v_brand, v_company, 'Culture Vision',
     'We build beautiful spaces for our customers so that we can build a beautiful life for ourselves.', 5),
    (v_values, v_company, 'Curiosity',
     'An innate fascination with craftsmanship and the built world. Natural tinkerers who use hands and minds to dissect, fix, and perfect everything.', 1),
    (v_values, v_company, 'Integrity',
     'Driven by self-respect, we execute at the highest level because it is our nature, not for applause.', 2),
    (v_values, v_company, 'Competency',
     'Proactive preparation over reactive environments. Through disciplined planning and individualized growth, we master our roles.', 3),
    (v_values, v_company, 'Tenacity',
     'Relentless drive for elite performance. We embrace temporary discomfort of challenges, holding ourselves to rigorous accountability.', 4),
    (v_values, v_company, 'Community & Entrepreneurship',
     'We build community assets by treating customer success as our own. Entrepreneurial spirit pairs lean discipline with a generous heart.', 5);
end $$;

-- Kingdom: the four pillars from the project brief as a starting point, equal weights,
-- each rated on the pillar itself until the team names finer criteria in GSR Settings.
do $$
declare
  v_company uuid;
  v_pillar  uuid;
  v_row     record;
begin
  select id into v_company from public.companies where slug = 'kingdom';
  if v_company is null or exists (select 1 from public.gsr_pillars where company_id = v_company) then
    return;
  end if;

  for v_row in
    select * from (values
      ('Field Execution',      'Quality and pace of work on site.',                   1),
      ('Safety',               'Safe practices, near-miss reporting, PPE, housekeeping.', 2),
      ('Client Communication', 'Responsiveness, clarity, and expectation setting with clients.', 3),
      ('Quality',              'Finish quality, punch-list discipline, and rework avoided.', 4)
    ) as t(name, description, sort_order)
  loop
    insert into public.gsr_pillars (company_id, name, description, weight, scoring_type, rating_scale_max, sort_order)
    values (v_company, v_row.name, v_row.description, 25, 'rating', 5, v_row.sort_order)
    returning id into v_pillar;
    insert into public.gsr_criteria (pillar_id, company_id, name, description, sort_order)
    values (v_pillar, v_company, v_row.name, v_row.description, 1);
  end loop;
end $$;

-- RBA: a neutral starting point (performance on deliverables, values, growth). Edit freely.
do $$
declare
  v_company uuid;
  v_values  uuid;
  v_growth  uuid;
begin
  select id into v_company from public.companies where slug = 'rba';
  if v_company is null or exists (select 1 from public.gsr_pillars where company_id = v_company) then
    return;
  end if;

  insert into public.gsr_pillars (company_id, name, description, weight, scoring_type, sort_order)
  values (v_company, 'Performance', 'Target vs actual on the deliverables agreed for the period.', 40, 'deliverables', 1);

  insert into public.gsr_pillars (company_id, name, description, weight, scoring_type, rating_scale_max, sort_order)
  values (v_company, 'Core Values', 'How fully the person lives the company values, rated 1 to 5.', 30, 'rating', 5, 2)
  returning id into v_values;

  insert into public.gsr_pillars (company_id, name, description, weight, scoring_type, rating_scale_max, sort_order)
  values (v_company, 'Professional Development', 'Growth against the development plan, rated 1 to 5.', 30, 'rating', 5, 3)
  returning id into v_growth;

  insert into public.gsr_criteria (pillar_id, company_id, name, sort_order) values
    (v_values, v_company, 'Ownership', 1),
    (v_values, v_company, 'Craftsmanship', 2),
    (v_values, v_company, 'Communication', 3),
    (v_growth, v_company, 'Skills growth', 1),
    (v_growth, v_company, 'Leadership', 2);
end $$;
