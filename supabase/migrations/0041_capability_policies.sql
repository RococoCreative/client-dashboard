-- 0041_capability_policies.sql
-- Six behaviours move onto private.can() (0040). Paste after 0040; idempotent; deploy the app the
-- same day.
--
-- Why: who may see pay, change the company row, read the change log, edit milestones, post wins
-- and press Sync now was fixed in code. Each now asks private.can(company, capability), so a
-- company's override row moves it up or down by rank. With no override rows every answer is the
-- one these policies gave before this migration.
--
--   1. Pay: the four compensation_items policies (latest body 0038 section 6b). The company branch
--      also asks for 'pay'; the Rococo branch, the own-row read and the 0038 scope clauses stay.
--      employee_financials is not touched.
--   2. Company row: the companies update policy (latest body 0001) asks for 'company_settings'.
--      guard_company_fields is unchanged, so slug, theme and modules stay with Rococo.
--   3. Change log: a new read policy on audit_events for people with 'audit_log', limited to
--      their own company's rows. The Rococo policy (0025) stays.
--   4. Milestones: the create and update policies (latest body 0026) ask for 'milestones_edit'.
--      Project policies are unchanged.
--   5. Wins: the create policy (latest body 0027) asks for 'wins_post'. The update policy is
--      unchanged.
--   6. Sync now: private.can_sync_source (latest body 0030) asks for 'sync_run', and a new read
--      policy lets a syncer see the sources they may sync. guard_sync_source still limits anyone
--      who cannot manage the company to setting sync_requested_at. Nothing else on the sync
--      tables changes.
--
-- Every policy is dropped by name and created again under the same name, so a second paste, or a
-- paste of an earlier migration followed by this one, ends in the same state.

-- ---------------------------------------------------------------------------------------
-- 1. Pay
-- ---------------------------------------------------------------------------------------

drop policy if exists "The person and their admins read pay" on public.compensation_items;
create policy "The person and their admins read pay"
  on public.compensation_items for select to authenticated
  using (
    private.is_rococo_admin()
    or employee_id = private.auth_profile_id()
    or (company_id = private.auth_company_id()
        and private.can(company_id, 'pay')
        and (private.has_full_scope()
             or employee_id in (select private.manageable_person_ids())))
  );

drop policy if exists "Admins add for the people they manage" on public.compensation_items;
create policy "Admins add for the people they manage"
  on public.compensation_items for insert to authenticated
  with check (
    private.is_rococo_admin()
    or (company_id = private.auth_company_id()
        and private.can(company_id, 'pay')
        and (private.has_full_scope()
             or employee_id in (select private.manageable_person_ids())))
  );

drop policy if exists "Admins change for the people they manage" on public.compensation_items;
create policy "Admins change for the people they manage"
  on public.compensation_items for update to authenticated
  using (
    private.is_rococo_admin()
    or (company_id = private.auth_company_id()
        and private.can(company_id, 'pay')
        and (private.has_full_scope()
             or employee_id in (select private.manageable_person_ids())))
  )
  with check (
    private.is_rococo_admin()
    or (company_id = private.auth_company_id()
        and private.can(company_id, 'pay')
        and (private.has_full_scope()
             or employee_id in (select private.manageable_person_ids())))
  );

drop policy if exists "Admins remove for the people they manage" on public.compensation_items;
create policy "Admins remove for the people they manage"
  on public.compensation_items for delete to authenticated
  using (
    private.is_rococo_admin()
    or (company_id = private.auth_company_id()
        and private.can(company_id, 'pay')
        and (private.has_full_scope()
             or employee_id in (select private.manageable_person_ids())))
  );

-- ---------------------------------------------------------------------------------------
-- 2. The company row
-- ---------------------------------------------------------------------------------------

drop policy if exists "Company admins and Rococo update companies" on public.companies;
create policy "Company admins and Rococo update companies"
  on public.companies for update to authenticated
  using (private.is_rococo_admin() or private.can(id, 'company_settings'))
  with check (private.is_rococo_admin() or private.can(id, 'company_settings'));

-- ---------------------------------------------------------------------------------------
-- 3. The change log
-- ---------------------------------------------------------------------------------------
-- A row with no company is never read this way: private.can() is false for a null company.

drop policy if exists "People with the audit capability read their company's events" on public.audit_events;
create policy "People with the audit capability read their company's events"
  on public.audit_events for select to authenticated
  using (company_id is not null and private.can(company_id, 'audit_log'));

-- ---------------------------------------------------------------------------------------
-- 4. Milestones
-- ---------------------------------------------------------------------------------------
-- A milestone's company is its project's (inherit_from_project, a BEFORE trigger), so the check
-- below reads the project's company whatever the client sent.

drop policy if exists "Admins create milestones" on public.project_milestones;
create policy "Admins create milestones"
  on public.project_milestones for insert to authenticated
  with check (private.can(company_id, 'milestones_edit'));

drop policy if exists "Admins update milestones" on public.project_milestones;
create policy "Admins update milestones"
  on public.project_milestones for update to authenticated
  using (private.can(company_id, 'milestones_edit'))
  with check (private.can(company_id, 'milestones_edit'));

-- ---------------------------------------------------------------------------------------
-- 5. Wins
-- ---------------------------------------------------------------------------------------
-- guard_win (0027) still keeps a win's project in the win's company, and stamp_actor still
-- records who posted it.

drop policy if exists "Admins create wins" on public.wins;
create policy "Admins create wins"
  on public.wins for insert to authenticated
  with check (private.can(company_id, 'wins_post'));

-- ---------------------------------------------------------------------------------------
-- 6. Sync now
-- ---------------------------------------------------------------------------------------

create or replace function private.can_sync_source(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select private.can(cid, 'sync_run') $$;
revoke all on function private.can_sync_source(uuid) from public, anon;
grant execute on function private.can_sync_source(uuid) to authenticated, service_role;

drop policy if exists "Syncers read sync sources" on public.sync_sources;
create policy "Syncers read sync sources"
  on public.sync_sources for select to authenticated
  using (private.can_sync_source(company_id));
