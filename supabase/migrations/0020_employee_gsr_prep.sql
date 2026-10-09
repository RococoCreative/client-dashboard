-- 0020_employee_gsr_prep.sql
-- An employee can open their own Goal Setting Review for an open month, so they can prefill
-- their goals before the meeting. Paste after 0019; idempotent.
--
-- Until now only an admin created review rows, so a person whose month nobody had started saw
-- "not started" and had nowhere to write. Their goals were already theirs to write (the goals
-- policies have allowed it since 0013); what they lacked was the review to write them under.
--
-- The new insert policy sits beside "Admins create reviews" and is deliberately narrow:
--   - the row is the caller's own, in the caller's own company (company_id is inherited from the
--     cycle by trigger before this check runs, so a cycle in another company fails here);
--   - the cycle is monthly and open. Quarterly, annual and custom reviews are scored, and an
--     admin still starts every one of those;
--   - the row arrives exactly as an admin's "Start review" would make it: not started, with no
--     feedback, reviewer or sign-off. guard_review_employee_fields already stops an employee
--     changing any of those afterwards, so the status still moves only when an admin acts.

drop policy if exists "Employees open their own monthly GSR" on public.reviews;
create policy "Employees open their own monthly GSR"
  on public.reviews for insert to authenticated
  with check (
    employee_id = private.auth_profile_id()
    and company_id = private.auth_company_id()
    and status = 'not_started'
    and previous_status is null
    and manager_feedback is null
    and peer_feedback is null
    and client_feedback is null
    and reviewer_id is null
    and completed_at is null
    and exists (
      select 1 from public.review_cycles c
      where c.id = cycle_id
        and c.company_id = private.auth_company_id()
        and c.cadence = 'monthly'
        and c.status = 'open'
    )
  );
