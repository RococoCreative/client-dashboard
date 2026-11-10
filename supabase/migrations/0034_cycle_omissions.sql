-- 0034_cycle_omissions.sql
-- An admin chooses who is in each review cycle. Paste after 0029; idempotent.
--
-- Written as 0024, before 0028 and 0029 were applied live, and renumbered to follow them. Live
-- holds 0001 to 0023, 0024 and 0025 (claude/elegant-cray-bnb85m), then 0028 and 0029; that
-- branch keeps 0026, 0027 and 0030 to 0033, and none of them touches what this file does, so it
-- can go before or after them, as long as it follows 0029. Two functions here are
-- also defined on main, so they are rebuilt on the version live now rather than on 0023:
-- guard_goal_frozen is 0029's, and guard_goal_note_frozen is 0023's (0028 and 0029 leave it
-- alone), each with the omission check added. An omission never stops the delete of the cycle,
-- the person or the company it hangs on, so deleting a cycle (which takes its goals and their
-- notes since 0029), a person or a company works exactly as it does after 0029.
--
-- A cycle covers everybody active on the roster, which is right for most cycles and wrong for
-- some: a company of five where three do GSRs this month, someone on leave for a quarter, a new
-- hire who starts mid-period. Until now each of those people read as a review still owed, so a
-- cycle that was finished said 3 of 5, and nothing could say otherwise.
--
--   1. cycle_omissions: one row per person left out of one cycle. Everyone is in by default, so
--      a company that never omits anybody works exactly as before. Adding someone back deletes
--      the row. Each row keeps who left the person out, when, and an optional reason.
--   2. Leaving someone out deletes nothing. A review already started is set aside, untouched,
--      and comes back if they are added back. A signed-off review is a score of record, so it
--      cannot be left out until it is reopened, and a closed cycle cannot change its roster.
--   3. While a person is left out of a cycle, nobody can open a review for them in it or sign
--      one off, and their goals and goal notes in that month are frozen, the way a closed or
--      locked month freezes them (0021, 0023).
--
-- The app reads the roster of a cycle as the active people with no row here, plus anyone whose
-- review in it is signed off (lib/gsr/cycles.ts, cycleRoster), on every screen that counts or
-- scores a cycle.

-- ---------------------------------------------------------------------------------------
-- 1. cycle_omissions
-- ---------------------------------------------------------------------------------------

create table if not exists public.cycle_omissions (
  cycle_id     uuid not null references public.review_cycles (id) on delete cascade,
  employee_id  uuid not null references public.profiles (id) on delete cascade,
  company_id   uuid not null references public.companies (id) on delete cascade,
  reason       text,
  -- The admin who left the person out. Null once that admin's profile is gone.
  omitted_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (cycle_id, employee_id),
  constraint cycle_omissions_reason_check check (reason is null or length(reason) <= 500)
);

create index if not exists cycle_omissions_employee_id_idx on public.cycle_omissions (employee_id);
create index if not exists cycle_omissions_company_id_idx on public.cycle_omissions (company_id);
create index if not exists cycle_omissions_omitted_by_idx on public.cycle_omissions (omitted_by);

grant select, insert, delete on public.cycle_omissions to authenticated;
revoke all on public.cycle_omissions from anon;

-- The cycle decides the company, the session decides who did it, and the clock decides when,
-- whatever the caller sent. The person has to be on the cycle's company's team, a signed-off
-- review has to be reopened first, and a closed cycle keeps the roster it closed with. BEFORE,
-- so the policies see the stamped row.
create or replace function public.stamp_cycle_omission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_status  text;
begin
  select c.company_id, c.status into v_company, v_status
    from public.review_cycles c
   where c.id = new.cycle_id;
  if v_company is null then
    raise exception 'That review cycle does not exist.';
  end if;
  if v_status = 'closed' then
    raise exception 'This review cycle is closed. Reopen it to change who is in it.'
      using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.profiles p
     where p.id = new.employee_id and p.company_id = v_company
  ) then
    raise exception 'That person is not on this company''s team.'
      using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.reviews r
     where r.cycle_id = new.cycle_id
       and r.employee_id = new.employee_id
       and r.status = 'complete'
  ) then
    raise exception 'Their review in this cycle is signed off. Reopen it before leaving them out.'
      using errcode = 'check_violation';
  end if;
  new.company_id := v_company;
  new.omitted_by := private.auth_profile_id();
  new.created_at := now();
  new.reason     := nullif(btrim(new.reason), '');
  return new;
end;
$$;
revoke execute on function public.stamp_cycle_omission() from public, anon, authenticated;

-- Adding someone back is a roster change too, so a closed cycle refuses it. A row going because
-- its cycle, its person or its company is being deleted goes with them: the parent is already
-- gone when the cascade arrives, and nothing here stops that.
create or replace function public.guard_cycle_omission_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = old.employee_id)
     or not exists (select 1 from public.companies co where co.id = old.company_id) then
    return old;
  end if;
  if exists (
    select 1 from public.review_cycles c
     where c.id = old.cycle_id and c.status = 'closed'
  ) then
    raise exception 'This review cycle is closed. Reopen it to change who is in it.'
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;
revoke execute on function public.guard_cycle_omission_delete() from public, anon, authenticated;

drop trigger if exists cycle_omissions_stamp on public.cycle_omissions;
create trigger cycle_omissions_stamp
  before insert on public.cycle_omissions
  for each row execute function public.stamp_cycle_omission();

drop trigger if exists cycle_omissions_guard_delete on public.cycle_omissions;
create trigger cycle_omissions_guard_delete
  before delete on public.cycle_omissions
  for each row execute function public.guard_cycle_omission_delete();

alter table public.cycle_omissions enable row level security;

-- Admins see and change their company's rosters. A person sees only their own row, so their
-- own screens can say they are not part of a cycle; nobody else learns who was left out.
drop policy if exists "Admins and the person read cycle omissions" on public.cycle_omissions;
create policy "Admins and the person read cycle omissions"
  on public.cycle_omissions for select to authenticated
  using (employee_id = private.auth_profile_id() or private.can_manage_company(company_id));

drop policy if exists "Admins leave people out of cycles" on public.cycle_omissions;
create policy "Admins leave people out of cycles"
  on public.cycle_omissions for insert to authenticated
  with check (private.can_manage_company(company_id));

drop policy if exists "Admins add people back to cycles" on public.cycle_omissions;
create policy "Admins add people back to cycles"
  on public.cycle_omissions for delete to authenticated
  using (private.can_manage_company(company_id));

-- ---------------------------------------------------------------------------------------
-- 2. No review is opened or signed off for someone left out
-- ---------------------------------------------------------------------------------------
-- Covers the admin's Start review and Start all, and the employee's own Start my GSR (0020).
-- A review set aside keeps everything in it; it just cannot be signed off until its person is
-- back in the cycle.

create or replace function public.guard_review_omitted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- An update matters only when it signs the review off.
  if tg_op = 'UPDATE' then
    if new.status <> 'complete' or old.status = 'complete' then
      return new;
    end if;
  end if;
  if exists (
    select 1 from public.cycle_omissions o
     where o.cycle_id = new.cycle_id and o.employee_id = new.employee_id
  ) then
    raise exception 'This person is not part of this cycle. Add them back on the cycle page first.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_review_omitted() from public, anon, authenticated;

drop trigger if exists reviews_guard_omitted on public.reviews;
create trigger reviews_guard_omitted
  before insert or update on public.reviews
  for each row execute function public.guard_review_omitted();

-- ---------------------------------------------------------------------------------------
-- 3. A month someone is left out of is frozen for them
-- ---------------------------------------------------------------------------------------
-- guard_goal_frozen as 0029 left it, plus the same check for a month the person is left out
-- of. 0029's two pass-throughs come first and are kept as they are: a goal going because its
-- cycle is being deleted, and a carried_from_goal_id the foreign key clears. The why still passes
-- on its own. An omission whose person or company is being deleted no longer counts, so it never
-- stops that delete; the closed and locked checks are 0029's, unchanged.

create or replace function public.guard_goal_frozen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from  uuid := case when tg_op = 'INSERT' then null else old.cycle_id end;
  v_to    uuid := case when tg_op = 'DELETE' then null else new.cycle_id end;
  v_whose uuid := case when tg_op = 'DELETE' then old.employee_id else new.employee_id end;
  v_probe public.goals%rowtype;
begin
  if tg_op = 'DELETE'
     and old.cycle_id is not null
     and not exists (select 1 from public.review_cycles c where c.id = old.cycle_id) then
    return old;
  end if;
  if tg_op = 'UPDATE' then
    v_probe := new;
    v_probe.outcome_note := old.outcome_note;
    v_probe.updated_at := old.updated_at;
    if new.carried_from_goal_id is null
       and old.carried_from_goal_id is not null
       and not exists (select 1 from public.goals g where g.id = old.carried_from_goal_id) then
      v_probe.carried_from_goal_id := old.carried_from_goal_id;
    end if;
    if v_probe is not distinct from old then
      return new;
    end if;
  end if;
  if exists (
    select 1 from public.review_cycles c
    where c.id in (v_from, v_to) and c.status = 'closed'
  ) then
    raise exception 'This review cycle is closed. Reopen it to change its goals.'
      using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.reviews r
    where r.cycle_id in (v_from, v_to)
      and r.employee_id = v_whose
      and r.status = 'complete'
      and r.gsr_score is not null
  ) then
    raise exception 'This month''s GSR is locked in. Reopen the review to change its goals.'
      using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.cycle_omissions o
    where o.cycle_id in (v_from, v_to)
      and o.employee_id = v_whose
      and exists (select 1 from public.profiles p where p.id = o.employee_id)
      and exists (select 1 from public.companies co where co.id = o.company_id)
  ) then
    raise exception 'This person is not part of this month''s GSRs. Add them back to change its goals.'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_goal_frozen() from public, anon, authenticated;

-- guard_goal_note_frozen as 0023 left it (0028 and 0029 do not change it), plus the month the
-- goal's person is left out of, with the same pass-through for an omission whose person or
-- company is being deleted. A cycle delete reaches a note only after its goal is gone, so none of
-- these checks finds a row and the note goes with the goal.
create or replace function public.guard_goal_note_frozen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from uuid := case when tg_op = 'INSERT' then null else old.goal_id end;
  v_to   uuid := case when tg_op = 'DELETE' then null else new.goal_id end;
begin
  if exists (
    select 1
      from public.goals g
      join public.review_cycles c on c.id = g.cycle_id
     where g.id in (v_from, v_to)
       and c.status = 'closed'
  ) then
    raise exception 'This review cycle is closed. Reopen it to change its notes.'
      using errcode = 'check_violation';
  end if;
  if exists (
    select 1
      from public.goals g
      join public.reviews r on r.cycle_id = g.cycle_id and r.employee_id = g.employee_id
     where g.id in (v_from, v_to)
       and r.status = 'complete'
       and r.gsr_score is not null
  ) then
    raise exception 'This month''s GSR is locked in. Reopen the review to change its notes.'
      using errcode = 'check_violation';
  end if;
  if exists (
    select 1
      from public.goals g
      join public.cycle_omissions o on o.cycle_id = g.cycle_id and o.employee_id = g.employee_id
      join public.profiles p on p.id = o.employee_id
      join public.companies co on co.id = o.company_id
     where g.id in (v_from, v_to)
  ) then
    raise exception 'This person is not part of this month''s GSRs. Add them back to change its notes.'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_goal_note_frozen() from public, anon, authenticated;
