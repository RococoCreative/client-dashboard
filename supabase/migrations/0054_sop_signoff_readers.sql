-- 0054_sop_signoff_readers.sql
-- SOP sign-offs are a record on the person: they show on the person's Overview under SOPs signed
-- off, so the managers who lead someone see that a procedure was read and completed. 0053 let only
-- the person and the company's admins read them. This reads them the way 0038 reads every record
-- of a person's: the person, Rococo, and whoever in the company sees the person (an owner, a
-- full-scope admin, an admin over their divisions, and the managers they report to up the chain).
-- A fellow employee, and a manager the person does not report to, still read nothing.
--
-- Writing is unchanged: a person signs off for themselves, and nobody signed in changes or removes
-- a sign-off. Paste after 0053; idempotent; go forwards only. If 0053 is ever pasted again, paste
-- 0054 straight after it, or the narrower 0053 policy comes back beside this one.

drop policy if exists "People read their own sign-offs, admins read all" on public.sop_signoffs;
drop policy if exists "The person and those who see them read sign-offs" on public.sop_signoffs;
create policy "The person and those who see them read sign-offs"
  on public.sop_signoffs for select to authenticated
  using (
    private.is_rococo_admin()
    or profile_id = private.auth_profile_id()
    or (company_id = private.auth_company_id()
        and (private.has_full_scope()
             or profile_id in (select private.viewable_person_ids())))
  );
