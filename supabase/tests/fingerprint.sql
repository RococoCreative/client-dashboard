-- fingerprint.sql
-- A fingerprint of each company's review data, to prove a migration or a move of one company to
-- GSRs on demand changed nothing it should not. Paste it into the SQL editor before the change
-- and again after, and compare the two results by eye or by diff: every row of a company that was
-- meant to stay as it was must read the same.
--
-- For each company slug and each of review_cycles, reviews, review_scores, goals, goal_notes and
-- cycle_omissions it gives the row count and one md5 over every row's own md5, rows taken in id
-- order (cycle_omissions, which has no id, in key order). It reads out no names, no emails and no
-- text a person wrote: only slugs, table names, counts and hashes. Each row is hashed without the
-- three columns 0047 adds (reviews.started_on and done_on, goals.review_id), so a fingerprint
-- taken before 0047 matches one taken after it. review_scores keeps its own review_id, which is
-- older than 0047 and says which review a score belongs to.
--
-- One plain select, so supabase/tests/0047_gsr_conversion.test.sql reads this file as the body of
-- its fingerprint function and the two can never drift apart.
select c.slug, f.tbl, f.n, f.hash
  from public.companies c
 cross join lateral (
         select 'review_cycles'::text as tbl, count(*) as n,
                md5(coalesce(string_agg(md5((to_jsonb(t) - 'started_on' - 'done_on' - 'review_id')::text), ',' order by t.id), '')) as hash
           from public.review_cycles t where t.company_id = c.id
         union all
         select 'reviews', count(*),
                md5(coalesce(string_agg(md5((to_jsonb(t) - 'started_on' - 'done_on' - 'review_id')::text), ',' order by t.id), ''))
           from public.reviews t where t.company_id = c.id
         union all
         select 'review_scores', count(*),
                md5(coalesce(string_agg(md5((to_jsonb(t) - 'started_on' - 'done_on')::text), ',' order by t.id), ''))
           from public.review_scores t where t.company_id = c.id
         union all
         select 'goals', count(*),
                md5(coalesce(string_agg(md5((to_jsonb(t) - 'started_on' - 'done_on' - 'review_id')::text), ',' order by t.id), ''))
           from public.goals t where t.company_id = c.id
         union all
         select 'goal_notes', count(*),
                md5(coalesce(string_agg(md5((to_jsonb(t) - 'started_on' - 'done_on' - 'review_id')::text), ',' order by t.id), ''))
           from public.goal_notes t where t.company_id = c.id
         union all
         select 'cycle_omissions', count(*),
                md5(coalesce(string_agg(md5((to_jsonb(t) - 'started_on' - 'done_on' - 'review_id')::text), ',' order by t.cycle_id, t.employee_id), ''))
           from public.cycle_omissions t where t.company_id = c.id
       ) f
 order by c.slug, f.tbl;
