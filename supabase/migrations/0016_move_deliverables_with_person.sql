-- 0016_move_deliverables_with_person.sql
-- Deliverables travel with the person, the way KPIs and compensation already do. Paste after
-- 0015; idempotent.
--
-- 0014 item 5 established the rule: moving somebody to another company takes their person-scoped
-- work with them, because otherwise the company they left keeps reading and writing it and the
-- company they joined sees nothing. 0015 then added two more person-scoped tables and did not
-- extend the handler, so it reopened exactly that hole for the new module.
--
-- Left as it was, a Rococo admin moving a person on the portfolio's People tab leaves
-- employee_deliverables and deliverable_tasks stamped with the old company. Three things follow
-- from the policies in 0015: the old company's admins keep reading, re-rating and deleting the
-- brief of somebody who no longer works there; the new company's admins see an empty module and
-- build it again from scratch; and the headings become uneditable by either of them, because an
-- update passes USING on the old company, gets restamped to the new one by the inheritance
-- trigger, and is then refused by the WITH CHECK.
--
-- category_id is cleared in the same statement. A category belongs to a company (0015), so the
-- one a heading was filed under is unreadable to its new company. groupByCategory already files a
-- heading with no readable category under "Uncategorized", so nothing is lost and an admin refiles
-- it, which is the behaviour a deleted category already has.
create or replace function public.move_employee_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.company_id is distinct from old.company_id and new.company_id is not null then
    update public.employee_kpis      set company_id = new.company_id where employee_id = new.id;
    update public.compensation_items set company_id = new.company_id where employee_id = new.id;
    update public.goals              set company_id = new.company_id where employee_id = new.id and cycle_id is null;
    -- Headings before tasks, so the parent is already right when the children are restamped.
    update public.employee_deliverables
       set company_id = new.company_id, category_id = null
     where employee_id = new.id;
    update public.deliverable_tasks  set company_id = new.company_id where employee_id = new.id;
  end if;
  return new;
end;
$$;
revoke execute on function public.move_employee_company() from public, anon, authenticated;
