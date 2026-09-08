-- 0010_policy_tuning.sql
-- Performance tuning the Supabase advisor asked for. Nothing about who can see or do what
-- changes: every predicate below is the one already in force. Paste after 0009; idempotent.
--
-- 1. Policies that compared a column to auth.uid() now write (select auth.uid()), so
--    Postgres resolves the caller once per statement instead of once per row.
-- 2. Nine tables had an admin "manage" policy FOR ALL next to a member read policy, which
--    means two permissive SELECT policies, both evaluated on every read. The manage policy
--    becomes insert, update, and delete policies; reads keep the single read policy, which
--    already admits admins on every one of these tables.
-- 3. Covering indexes for the foreign keys the app filters on.

-- 1. auth.uid() as an init plan ----------------------------------------------------------
drop policy if exists "Users read own, teammates, Rococo reads all profiles" on public.profiles;
create policy "Users read own, teammates, Rococo reads all profiles"
  on public.profiles for select to authenticated
  using (
    private.is_rococo_admin()
    or id = (select auth.uid())
    or (company_id is not null and company_id = private.auth_company_id())
  );

drop policy if exists "Users update own, admins update company profiles" on public.profiles;
create policy "Users update own, admins update company profiles"
  on public.profiles for update to authenticated
  using (
    private.is_rococo_admin()
    or id = (select auth.uid())
    or (private.is_company_admin() and company_id is not null and company_id = private.auth_company_id())
  )
  with check (
    private.is_rococo_admin()
    or id = (select auth.uid())
    or (private.is_company_admin() and company_id is not null and company_id = private.auth_company_id())
  );

drop policy if exists "Employees read own reviews, admins read company" on public.reviews;
create policy "Employees read own reviews, admins read company"
  on public.reviews for select to authenticated
  using (employee_id = (select auth.uid()) or private.can_manage_company(company_id));

drop policy if exists "Employees reflect, admins update reviews" on public.reviews;
create policy "Employees reflect, admins update reviews"
  on public.reviews for update to authenticated
  using (employee_id = (select auth.uid()) or private.can_manage_company(company_id))
  with check (employee_id = (select auth.uid()) or private.can_manage_company(company_id));

drop policy if exists "Employees read own scores, admins read company" on public.review_scores;
create policy "Employees read own scores, admins read company"
  on public.review_scores for select to authenticated
  using (
    private.can_manage_company(company_id)
    or exists (
      select 1 from public.reviews r
      where r.id = review_scores.review_id and r.employee_id = (select auth.uid())
    )
  );

drop policy if exists "Employees read own goals, admins read company" on public.goals;
create policy "Employees read own goals, admins read company"
  on public.goals for select to authenticated
  using (employee_id = (select auth.uid()) or private.can_manage_company(company_id));

drop policy if exists "Employees and admins create goals" on public.goals;
create policy "Employees and admins create goals"
  on public.goals for insert to authenticated
  with check (
    private.can_manage_company(company_id)
    or (employee_id = (select auth.uid()) and company_id = private.auth_company_id())
  );

drop policy if exists "Employees and admins update goals" on public.goals;
create policy "Employees and admins update goals"
  on public.goals for update to authenticated
  using (employee_id = (select auth.uid()) or private.can_manage_company(company_id))
  with check (employee_id = (select auth.uid()) or private.can_manage_company(company_id));

drop policy if exists "Employees and admins delete goals" on public.goals;
create policy "Employees and admins delete goals"
  on public.goals for delete to authenticated
  using (employee_id = (select auth.uid()) or private.can_manage_company(company_id));

-- 2. One SELECT policy per table ---------------------------------------------------------
-- company_domains: Rococo only. Reads stay on "Members read own company domains", which
-- includes Rococo admins through is_company_member.
drop policy if exists "Rococo admins manage company domains" on public.company_domains;
drop policy if exists "Rococo admins add company domains" on public.company_domains;
create policy "Rococo admins add company domains"
  on public.company_domains for insert to authenticated
  with check (private.is_rococo_admin());
drop policy if exists "Rococo admins update company domains" on public.company_domains;
create policy "Rococo admins update company domains"
  on public.company_domains for update to authenticated
  using (private.is_rococo_admin()) with check (private.is_rococo_admin());
drop policy if exists "Rococo admins delete company domains" on public.company_domains;
create policy "Rococo admins delete company domains"
  on public.company_domains for delete to authenticated
  using (private.is_rococo_admin());

-- company_goals
drop policy if exists "Admins manage company goals" on public.company_goals;
drop policy if exists "Admins create company goals" on public.company_goals;
create policy "Admins create company goals"
  on public.company_goals for insert to authenticated
  with check (private.can_manage_company(company_id));
drop policy if exists "Admins update company goals" on public.company_goals;
create policy "Admins update company goals"
  on public.company_goals for update to authenticated
  using (private.can_manage_company(company_id)) with check (private.can_manage_company(company_id));
drop policy if exists "Admins delete company goals" on public.company_goals;
create policy "Admins delete company goals"
  on public.company_goals for delete to authenticated
  using (private.can_manage_company(company_id));

-- gsr_criteria
drop policy if exists "Admins manage criteria" on public.gsr_criteria;
drop policy if exists "Admins create criteria" on public.gsr_criteria;
create policy "Admins create criteria"
  on public.gsr_criteria for insert to authenticated
  with check (private.can_manage_company(company_id));
drop policy if exists "Admins update criteria" on public.gsr_criteria;
create policy "Admins update criteria"
  on public.gsr_criteria for update to authenticated
  using (private.can_manage_company(company_id)) with check (private.can_manage_company(company_id));
drop policy if exists "Admins delete criteria" on public.gsr_criteria;
create policy "Admins delete criteria"
  on public.gsr_criteria for delete to authenticated
  using (private.can_manage_company(company_id));

-- gsr_pillars
drop policy if exists "Admins manage pillars" on public.gsr_pillars;
drop policy if exists "Admins create pillars" on public.gsr_pillars;
create policy "Admins create pillars"
  on public.gsr_pillars for insert to authenticated
  with check (private.can_manage_company(company_id));
drop policy if exists "Admins update pillars" on public.gsr_pillars;
create policy "Admins update pillars"
  on public.gsr_pillars for update to authenticated
  using (private.can_manage_company(company_id)) with check (private.can_manage_company(company_id));
drop policy if exists "Admins delete pillars" on public.gsr_pillars;
create policy "Admins delete pillars"
  on public.gsr_pillars for delete to authenticated
  using (private.can_manage_company(company_id));

-- resources
drop policy if exists "Admins manage resources" on public.resources;
drop policy if exists "Admins create resources" on public.resources;
create policy "Admins create resources"
  on public.resources for insert to authenticated
  with check (private.can_manage_company(company_id));
drop policy if exists "Admins update resources" on public.resources;
create policy "Admins update resources"
  on public.resources for update to authenticated
  using (private.can_manage_company(company_id)) with check (private.can_manage_company(company_id));
drop policy if exists "Admins delete resources" on public.resources;
create policy "Admins delete resources"
  on public.resources for delete to authenticated
  using (private.can_manage_company(company_id));

-- review_cycles
drop policy if exists "Admins manage cycles" on public.review_cycles;
drop policy if exists "Admins create cycles" on public.review_cycles;
create policy "Admins create cycles"
  on public.review_cycles for insert to authenticated
  with check (private.can_manage_company(company_id));
drop policy if exists "Admins update cycles" on public.review_cycles;
create policy "Admins update cycles"
  on public.review_cycles for update to authenticated
  using (private.can_manage_company(company_id)) with check (private.can_manage_company(company_id));
drop policy if exists "Admins delete cycles" on public.review_cycles;
create policy "Admins delete cycles"
  on public.review_cycles for delete to authenticated
  using (private.can_manage_company(company_id));

-- review_scores
drop policy if exists "Admins manage scores" on public.review_scores;
drop policy if exists "Admins create scores" on public.review_scores;
create policy "Admins create scores"
  on public.review_scores for insert to authenticated
  with check (private.can_manage_company(company_id));
drop policy if exists "Admins update scores" on public.review_scores;
create policy "Admins update scores"
  on public.review_scores for update to authenticated
  using (private.can_manage_company(company_id)) with check (private.can_manage_company(company_id));
drop policy if exists "Admins delete scores" on public.review_scores;
create policy "Admins delete scores"
  on public.review_scores for delete to authenticated
  using (private.can_manage_company(company_id));

-- sop_attachments
drop policy if exists "Admins manage attachments" on public.sop_attachments;
drop policy if exists "Admins add attachments" on public.sop_attachments;
create policy "Admins add attachments"
  on public.sop_attachments for insert to authenticated
  with check (private.can_manage_company(company_id));
drop policy if exists "Admins update attachments" on public.sop_attachments;
create policy "Admins update attachments"
  on public.sop_attachments for update to authenticated
  using (private.can_manage_company(company_id)) with check (private.can_manage_company(company_id));
drop policy if exists "Admins delete attachments" on public.sop_attachments;
create policy "Admins delete attachments"
  on public.sop_attachments for delete to authenticated
  using (private.can_manage_company(company_id));

-- sops
drop policy if exists "Admins manage SOPs" on public.sops;
drop policy if exists "Admins create SOPs" on public.sops;
create policy "Admins create SOPs"
  on public.sops for insert to authenticated
  with check (private.can_manage_company(company_id));
drop policy if exists "Admins update SOPs" on public.sops;
create policy "Admins update SOPs"
  on public.sops for update to authenticated
  using (private.can_manage_company(company_id)) with check (private.can_manage_company(company_id));
drop policy if exists "Admins delete SOPs" on public.sops;
create policy "Admins delete SOPs"
  on public.sops for delete to authenticated
  using (private.can_manage_company(company_id));

-- 3. Covering indexes --------------------------------------------------------------------
create index if not exists goals_cycle_id_idx on public.goals (cycle_id);
create index if not exists review_scores_company_id_idx on public.review_scores (company_id);
create index if not exists review_scores_pillar_id_idx on public.review_scores (pillar_id);
create index if not exists review_scores_criterion_id_idx on public.review_scores (criterion_id);
create index if not exists sop_versions_company_id_idx on public.sop_versions (company_id);
create index if not exists sop_attachments_company_id_idx on public.sop_attachments (company_id);
