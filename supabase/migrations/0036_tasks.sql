-- 0036_tasks.sql
-- Tasks a company assigns to its people, each with an ordered checklist of steps. Paste after
-- 0035; idempotent.
--
-- Why: a company with the tasks module hands out work with a due date and a priority, and
-- people complete it. Admins create tasks for anyone and see them all; an employee sees only
-- what is assigned to them, completes it, and may create tasks for themselves. A task can repeat:
-- completing it opens the next copy. A task can belong to one of the company's marketing
-- campaigns. Tasks are deleted for real; nothing is archived.
--
--   1. public.tasks and public.task_steps: the two tables, their grants and policies.
--   2. public.guard_task(): stamps who created and completed a task, keeps a task, its person
--      and its campaign in one company, pins the columns only the database writes, and limits
--      what someone who did not assign a task may change.
--   3. public.guard_task_step(): a step takes its company from its task; someone who did not
--      assign the task may only tick and untick its steps.
--   4. public.sync_task_completion(): ticking the last step completes the task, and unticking a
--      step reopens it.
--   5. public.recur_task(): completing a repeating task opens the next copy.
--   6. Moving a person to another company clears them as assignee on the old company's tasks.
--
-- The rule triggers write with the transaction setting hub.task_internal set to '1', and the
-- guards leave such a write as the trigger made it. Each rule trigger restores the setting
-- before it returns, so it never outlives the write it was set for. PostgREST gives a client
-- no way to set it.
--
-- Tasks are content, not configuration, so they carry no audit trigger.

-- ---------------------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------------------

create table if not exists public.tasks (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies (id) on delete cascade,
  title                text not null,
  description          text,
  assignee_id          uuid references public.profiles (id) on delete set null,
  created_by           uuid references public.profiles (id) on delete set null,
  due_date             date,
  priority             text not null default 'medium',
  recurrence           text,
  campaign_id          uuid references public.marketing_campaigns (id) on delete set null,
  completed_at         timestamptz,
  completed_by         uuid references public.profiles (id) on delete set null,
  next_task_id         uuid references public.tasks (id) on delete set null,
  notified_assignee_id uuid references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint tasks_title_check check (btrim(title) <> ''),
  constraint tasks_priority_check check (priority in ('low', 'medium', 'high')),
  constraint tasks_recurrence_check check (
    recurrence is null
    or recurrence in ('daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')
  ),
  constraint tasks_recurrence_due_check check (recurrence is null or due_date is not null)
);

create index if not exists tasks_company_completed_idx on public.tasks (company_id, completed_at);
create index if not exists tasks_assignee_id_idx on public.tasks (assignee_id);
create index if not exists tasks_campaign_id_idx on public.tasks (campaign_id);
create index if not exists tasks_created_by_idx on public.tasks (created_by);
create index if not exists tasks_completed_by_idx on public.tasks (completed_by);
create index if not exists tasks_next_task_id_idx on public.tasks (next_task_id);
create index if not exists tasks_notified_assignee_id_idx on public.tasks (notified_assignee_id);

create table if not exists public.task_steps (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  title      text not null,
  sort_order integer not null default 0,
  done_at    timestamptz,
  constraint task_steps_title_check check (btrim(title) <> '')
);

create index if not exists task_steps_task_idx on public.task_steps (task_id, sort_order);
create index if not exists task_steps_company_id_idx on public.task_steps (company_id);

alter table public.tasks enable row level security;
alter table public.task_steps enable row level security;

revoke all on public.tasks from anon, authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
revoke all on public.task_steps from anon, authenticated;
grant select, insert, update, delete on public.task_steps to authenticated;

-- An admin sees and changes every task in the company; anyone else, only what is assigned to
-- them. An employee creates tasks only for themselves and without a campaign (created_by is
-- stamped by the guard before this check runs). The guard narrows what an update may change.
drop policy if exists "Admins and assignees read tasks" on public.tasks;
create policy "Admins and assignees read tasks"
  on public.tasks for select to authenticated
  using (private.can_manage_company(company_id) or assignee_id = private.auth_profile_id());

drop policy if exists "Admins and self create tasks" on public.tasks;
create policy "Admins and self create tasks"
  on public.tasks for insert to authenticated
  with check (
    private.can_manage_company(company_id)
    or (assignee_id = private.auth_profile_id()
        and private.is_company_member(company_id)
        and campaign_id is null)
  );

drop policy if exists "Admins and assignees update tasks" on public.tasks;
create policy "Admins and assignees update tasks"
  on public.tasks for update to authenticated
  using (private.can_manage_company(company_id) or assignee_id = private.auth_profile_id())
  with check (private.can_manage_company(company_id) or assignee_id = private.auth_profile_id());

drop policy if exists "Admins and self delete tasks" on public.tasks;
create policy "Admins and self delete tasks"
  on public.tasks for delete to authenticated
  using (
    private.can_manage_company(company_id)
    or (created_by = private.auth_profile_id() and assignee_id = private.auth_profile_id())
  );

-- A step is open to whoever can see its task. The step guard narrows what a person who did
-- not assign the task may do to ticking and unticking.
drop policy if exists "Task viewers read steps" on public.task_steps;
create policy "Task viewers read steps"
  on public.task_steps for select to authenticated
  using (exists (
    select 1 from public.tasks t
     where t.id = task_steps.task_id
       and (private.can_manage_company(t.company_id) or t.assignee_id = private.auth_profile_id())
  ));

drop policy if exists "Task viewers create steps" on public.task_steps;
create policy "Task viewers create steps"
  on public.task_steps for insert to authenticated
  with check (exists (
    select 1 from public.tasks t
     where t.id = task_steps.task_id
       and (private.can_manage_company(t.company_id) or t.assignee_id = private.auth_profile_id())
  ));

drop policy if exists "Task viewers update steps" on public.task_steps;
create policy "Task viewers update steps"
  on public.task_steps for update to authenticated
  using (exists (
    select 1 from public.tasks t
     where t.id = task_steps.task_id
       and (private.can_manage_company(t.company_id) or t.assignee_id = private.auth_profile_id())
  ))
  with check (exists (
    select 1 from public.tasks t
     where t.id = task_steps.task_id
       and (private.can_manage_company(t.company_id) or t.assignee_id = private.auth_profile_id())
  ));

drop policy if exists "Task viewers delete steps" on public.task_steps;
create policy "Task viewers delete steps"
  on public.task_steps for delete to authenticated
  using (exists (
    select 1 from public.tasks t
     where t.id = task_steps.task_id
       and (private.can_manage_company(t.company_id) or t.assignee_id = private.auth_profile_id())
  ));

-- ---------------------------------------------------------------------------------------
-- 2. The task guard
-- ---------------------------------------------------------------------------------------
-- Security definer so the person's and the campaign's company read past row level security.
-- A pinned reference to a person yields to null once that person's row is gone, so a deleted
-- profile's ON DELETE SET NULL still lands. When the next copy of a series is deleted, its
-- foreign key clears next_task_id on the completed copy before it, and the guard ends the
-- series there too, so reopening that copy can never start the series again.

create or replace function public.guard_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_internal boolean := coalesce(current_setting('hub.task_internal', true), '') = '1';
  v_checks   boolean := not v_internal and auth.uid() is not null;
  v_me       uuid := private.auth_profile_id();
begin
  if not v_internal then
    if tg_op = 'INSERT' then
      new.created_by := coalesce(v_me, new.created_by);
    else
      new.company_id := old.company_id;
      new.created_by := case
        when exists (select 1 from public.profiles where id = old.created_by) then old.created_by
      end;
    end if;

    -- Who completed it follows completed_at: the person who set it, and nobody once it clears.
    if new.completed_at is null then
      new.completed_by := null;
    elsif tg_op = 'INSERT' or old.completed_at is null then
      new.completed_by := coalesce(v_me, new.completed_by);
    elsif v_checks then
      new.completed_by := case
        when exists (select 1 from public.profiles where id = old.completed_by) then old.completed_by
      end;
    end if;
  end if;

  if tg_op = 'UPDATE' and old.next_task_id is not null
     and old.completed_at is not null and new.completed_at is null then
    raise exception 'The next one is already open.';
  end if;

  if new.assignee_id is not null
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
     and (select company_id from public.profiles where id = new.assignee_id)
         is distinct from new.company_id then
    raise exception 'That person belongs to another company.';
  end if;

  if new.campaign_id is not null
     and (tg_op = 'INSERT' or new.campaign_id is distinct from old.campaign_id)
     and (select company_id from public.marketing_campaigns where id = new.campaign_id)
         is distinct from new.company_id then
    raise exception 'That campaign belongs to another company.';
  end if;

  if v_checks then
    if tg_op = 'INSERT' then
      new.next_task_id := null;
      new.notified_assignee_id := null;
    else
      new.next_task_id := old.next_task_id;
      new.notified_assignee_id := case
        when exists (select 1 from public.profiles where id = old.notified_assignee_id)
          then old.notified_assignee_id
      end;

      if not private.can_manage_company(old.company_id) then
        if old.created_by = v_me and old.assignee_id = v_me then
          if new.assignee_id is distinct from old.assignee_id
             or new.campaign_id is distinct from old.campaign_id then
            raise exception 'Only the person who assigned this task can change it.';
          end if;
        elsif (new.id, new.title, new.description, new.assignee_id, new.due_date, new.priority,
               new.recurrence, new.campaign_id, new.created_at)
              is distinct from
              (old.id, old.title, old.description, old.assignee_id, old.due_date, old.priority,
               old.recurrence, old.campaign_id, old.created_at) then
          raise exception 'Only the person who assigned this task can change it.';
        end if;
      end if;
    end if;
  end if;

  -- The next copy of this series is gone: the series ends here.
  if tg_op = 'UPDATE' and old.next_task_id is not null
     and not exists (select 1 from public.tasks where id = old.next_task_id) then
    new.next_task_id := null;
    new.recurrence := null;
  end if;

  return new;
end;
$$;
revoke execute on function public.guard_task() from public, anon, authenticated;

-- BEFORE triggers fire in name order: the guard runs before updated_at is stamped.
drop trigger if exists tasks_guard on public.tasks;
create trigger tasks_guard
  before insert or update on public.tasks
  for each row execute function public.guard_task();

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------
-- 3. The step guard
-- ---------------------------------------------------------------------------------------
-- A step removed because its task or company was deleted is let through: the task it belonged
-- to is already gone.

create or replace function public.guard_task_step()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_internal boolean := coalesce(current_setting('hub.task_internal', true), '') = '1';
  v_task     public.tasks%rowtype;
  v_me       uuid;
begin
  if tg_op = 'INSERT' then
    select company_id into new.company_id from public.tasks where id = new.task_id;
    if new.company_id is null then
      raise exception 'That task does not exist.';
    end if;
  elsif tg_op = 'UPDATE' then
    new.task_id := old.task_id;
    new.company_id := old.company_id;
  end if;

  if not v_internal and auth.uid() is not null then
    select * into v_task from public.tasks
     where id = case when tg_op = 'DELETE' then old.task_id else new.task_id end;

    if v_task.id is not null
       and (tg_op <> 'DELETE' or exists (select 1 from public.companies where id = v_task.company_id)) then
      if v_task.next_task_id is not null then
        raise exception 'The next one is already open.';
      end if;

      v_me := private.auth_profile_id();
      if not private.can_manage_company(v_task.company_id)
         and not (v_task.created_by = v_me and v_task.assignee_id = v_me) then
        if tg_op <> 'UPDATE'
           or (new.id, new.title, new.sort_order) is distinct from (old.id, old.title, old.sort_order) then
          raise exception 'Only the person who assigned this task can change its steps.';
        end if;
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_task_step() from public, anon, authenticated;

drop trigger if exists task_steps_guard on public.task_steps;
create trigger task_steps_guard
  before insert or update or delete on public.task_steps
  for each row execute function public.guard_task_step();

-- ---------------------------------------------------------------------------------------
-- 4. Steps complete and reopen their task
-- ---------------------------------------------------------------------------------------
-- Security definer because an employee ticking a step on a task an admin assigned may not
-- write the task's other columns; the write is internal, so it sets completed_by itself.

create or replace function public.sync_task_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev text := current_setting('hub.task_internal', true);
begin
  perform set_config('hub.task_internal', '1', true);
  if old.done_at is null and new.done_at is not null then
    if not exists (select 1 from public.task_steps where task_id = new.task_id and done_at is null) then
      update public.tasks
         set completed_at = now(), completed_by = private.auth_profile_id()
       where id = new.task_id and completed_at is null;
    end if;
  elsif old.done_at is not null and new.done_at is null then
    update public.tasks
       set completed_at = null, completed_by = null
     where id = new.task_id and completed_at is not null;
  end if;
  perform set_config('hub.task_internal', coalesce(v_prev, ''), true);
  return null;
end;
$$;
revoke execute on function public.sync_task_completion() from public, anon, authenticated;

drop trigger if exists task_steps_sync_completion on public.task_steps;
create trigger task_steps_sync_completion
  after update of done_at on public.task_steps
  for each row
  when ((old.done_at is null) <> (new.done_at is null))
  execute function public.sync_task_completion();

-- ---------------------------------------------------------------------------------------
-- 5. A repeating task opens its next copy when it is completed
-- ---------------------------------------------------------------------------------------
-- The next due date steps forward from the completed copy's due date by whole intervals until
-- it falls after today, so a late task lands on the next upcoming slot. Month-based steps are
-- always counted from that due date, so a task due on the 31st keeps the 31st where it can.
-- The copy keeps the original assigner and is marked as already notified, so no assignment
-- email is ever sent for it.

create or replace function public.recur_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev   text := current_setting('hub.task_internal', true);
  v_from   date := new.due_date;
  v_days   integer;
  v_months integer;
  v_n      integer;
  v_due    date;
  v_next   uuid;
begin
  case new.recurrence
    when 'daily' then v_days := 1;
    when 'weekly' then v_days := 7;
    when 'biweekly' then v_days := 14;
    when 'monthly' then v_months := 1;
    when 'quarterly' then v_months := 3;
    else v_months := 12;
  end case;

  if v_days is not null then
    v_n := greatest(1, (current_date - v_from) / v_days + 1);
    v_due := v_from + v_n * v_days;
  else
    -- Every whole step that ends a month or more before this month is already past, so the
    -- search starts there and walks forward.
    v_n := greatest(1, ((extract(year from current_date)::integer - extract(year from v_from)::integer) * 12
                        + extract(month from current_date)::integer - extract(month from v_from)::integer
                        - 1) / v_months);
    loop
      v_due := (v_from + make_interval(months => v_n * v_months))::date;
      exit when v_due > current_date;
      v_n := v_n + 1;
    end loop;
  end if;

  perform set_config('hub.task_internal', '1', true);

  insert into public.tasks
    (company_id, title, description, assignee_id, created_by, due_date, priority, recurrence,
     campaign_id, notified_assignee_id)
  values
    (new.company_id, new.title, new.description, new.assignee_id, new.created_by, v_due,
     new.priority, new.recurrence, new.campaign_id, new.assignee_id)
  returning id into v_next;

  insert into public.task_steps (task_id, company_id, title, sort_order)
  select v_next, new.company_id, s.title, s.sort_order
    from public.task_steps s
   where s.task_id = new.id
   order by s.sort_order, s.id;

  update public.tasks set next_task_id = v_next where id = new.id;

  perform set_config('hub.task_internal', coalesce(v_prev, ''), true);
  return null;
end;
$$;
revoke execute on function public.recur_task() from public, anon, authenticated;

drop trigger if exists tasks_recur on public.tasks;
create trigger tasks_recur
  after update of completed_at on public.tasks
  for each row
  when (old.completed_at is null and new.completed_at is not null
        and new.recurrence is not null and new.next_task_id is null)
  execute function public.recur_task();

-- ---------------------------------------------------------------------------------------
-- 6. A person who moves company stops being the assignee of the old company's tasks
-- ---------------------------------------------------------------------------------------
-- Mirrors clear_milestone_owner_on_move (0026). The tasks stay with the company, unassigned,
-- for an admin to hand to someone else.

create or replace function public.clear_task_assignee_on_move()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev text := current_setting('hub.task_internal', true);
begin
  perform set_config('hub.task_internal', '1', true);
  update public.tasks
     set assignee_id = null
   where assignee_id = new.id
     and company_id is distinct from new.company_id;
  perform set_config('hub.task_internal', coalesce(v_prev, ''), true);
  return null;
end;
$$;
revoke execute on function public.clear_task_assignee_on_move() from public, anon, authenticated;

drop trigger if exists profiles_move_clears_task_assignee on public.profiles;
create trigger profiles_move_clears_task_assignee
  after update of company_id on public.profiles
  for each row
  when (old.company_id is distinct from new.company_id)
  execute function public.clear_task_assignee_on_move();
