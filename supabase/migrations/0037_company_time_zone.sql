-- 0037_company_time_zone.sql
-- Every company keeps its own time zone, and a repeating task counts its next due date from the
-- company's own day. Paste after 0036; idempotent.
--
-- Why: recur_task (0036) read "today" as current_date, which is the database's day (UTC). A
-- daily task completed in the evening in the company's zone, when UTC is already tomorrow,
-- skipped a day. The company's day is a setting every company carries (rule 12), with the zone
-- the companies work in today as its default.
--
--   1. companies.time_zone: a named zone, America/New_York unless an admin sets another.
--   2. public.guard_company_time_zone(): a time zone must be a real named zone.
--   3. The audit watches time_zone with the rest of a company's configuration.
--   4. public.recur_task(): 0036's body with "today" read in the task's company zone.

-- ---------------------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------------------
-- Company admins may change it, under the existing update policy; guard_company_fields does not
-- protect it, so no Rococo admin is needed.

alter table public.companies add column if not exists time_zone text not null default 'America/New_York';

-- ---------------------------------------------------------------------------------------
-- 2. A time zone must be a real named zone
-- ---------------------------------------------------------------------------------------
-- A check constraint cannot read a catalog, so a trigger does it, the same way 0030 checks a
-- sync source's zone: PostgreSQL also reads POSIX-style zones such as 'UTC+5', which the browser
-- (Intl.DateTimeFormat) cannot, so the name must be in pg_timezone_names too.

create or replace function public.guard_company_time_zone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.time_zone is not distinct from old.time_zone then
    return new;
  end if;
  begin
    perform now() at time zone new.time_zone;
  exception when others then
    raise exception 'That time zone is not recognized.';
  end;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.time_zone) then
    raise exception 'That time zone is not recognized.';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_company_time_zone() from public, anon, authenticated;

drop trigger if exists companies_guard_time_zone on public.companies;
create trigger companies_guard_time_zone
  before insert or update on public.companies
  for each row execute function public.guard_company_time_zone();

-- ---------------------------------------------------------------------------------------
-- 3. The audit watches the time zone
-- ---------------------------------------------------------------------------------------
-- 0025's watched columns for companies, with time_zone added.

drop trigger if exists companies_audit on public.companies;
create trigger companies_audit
  after insert or update or delete on public.companies
  for each row execute function private.audit_change('modules', 'slug', 'theme_key', 'name', 'time_zone');

-- ---------------------------------------------------------------------------------------
-- 4. A repeating task steps forward from the company's own day
-- ---------------------------------------------------------------------------------------
-- 0036's body exactly, except that "today" is the date in the task's company zone, read once,
-- where 0036 read current_date. The internal flag is saved and restored as before.

create or replace function public.recur_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev   text := current_setting('hub.task_internal', true);
  v_from   date := new.due_date;
  v_today  date;
  v_days   integer;
  v_months integer;
  v_n      integer;
  v_due    date;
  v_next   uuid;
begin
  select (now() at time zone c.time_zone)::date into v_today
    from public.companies c
   where c.id = new.company_id;

  case new.recurrence
    when 'daily' then v_days := 1;
    when 'weekly' then v_days := 7;
    when 'biweekly' then v_days := 14;
    when 'monthly' then v_months := 1;
    when 'quarterly' then v_months := 3;
    else v_months := 12;
  end case;

  if v_days is not null then
    v_n := greatest(1, (v_today - v_from) / v_days + 1);
    v_due := v_from + v_n * v_days;
  else
    -- Every whole step that ends a month or more before this month is already past, so the
    -- search starts there and walks forward.
    v_n := greatest(1, ((extract(year from v_today)::integer - extract(year from v_from)::integer) * 12
                        + extract(month from v_today)::integer - extract(month from v_from)::integer
                        - 1) / v_months);
    loop
      v_due := (v_from + make_interval(months => v_n * v_months))::date;
      exit when v_due > v_today;
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
