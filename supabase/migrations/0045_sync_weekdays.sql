-- 0045_sync_weekdays.sql
-- A data source can sync on a set of weekdays, not just one. Paste after 0044; idempotent. Safe to
-- paste before the connections Edge Function is deployed again: the function running today reads
-- only sync_weekday, which stays filled and equal to the lowest day of the set, so until it is
-- redeployed it keeps syncing each scheduled source once a week on that day.
--
-- Why: a company that wants its numbers fresh every working day had to keep one source per day.
-- The set is each source's own row (rule 12); a source with one day behaves exactly as before.
--
--   1. public.sync_sources gains sync_weekdays smallint[] (0 = Sunday .. 6 = Saturday, as
--      sync_weekday) and stale_business_days boolean not null default false. The second is read
--      by the staleness rule that follows; here it is only stored, guarded and audited.
--   2. Every scheduled source gets the set of its single day, before the trigger below exists,
--      so the trigger only ever meets rows that already carry their set.
--   3. public.keep_sync_weekdays(): a BEFORE trigger that keeps the two day columns in step. The
--      set wins whenever a write gives or changes it; a write that changes only the single day
--      (an older client) moves the set to that one day; a write to a row that has a single day
--      and no set yet gives it the set of that day rather than clearing the day. The set is
--      stored sorted with no repeats, and the single day is always its lowest day.
--   4. sync_sources_schedule_check is rebuilt to cover the set (days, time and zone are all set
--      or all null), and sync_sources_weekdays_check keeps the set to one to seven days in 0 to 6
--      with the single day in step.
--   5. sync_sources_audit (0030) is rebuilt with the two new columns added.
--
-- guard_sync_source (0030) is unchanged: it diffs the whole row, so someone who may sync but not
-- manage the company changes neither new column. Policies and grants are unchanged.

-- ---------------------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------------------
-- The old schedule check is dropped first so the backfill below never trips it; section 4 adds
-- it back covering the set.

alter table public.sync_sources drop constraint if exists sync_sources_schedule_check;
alter table public.sync_sources add column if not exists sync_weekdays smallint[];
alter table public.sync_sources add column if not exists stale_business_days boolean not null default false;

-- ---------------------------------------------------------------------------------------
-- 2. Backfill
-- ---------------------------------------------------------------------------------------
-- Before the trigger in section 3 is created, so the trigger only ever meets rows that already
-- carry their set; and before the audit is rebuilt, so filling the set writes no change-log
-- events. A second paste finds nothing to fill.

update public.sync_sources
   set sync_weekdays = array[sync_weekday]
 where sync_weekdays is null
   and sync_weekday is not null;

-- ---------------------------------------------------------------------------------------
-- 3. Keeping the two day columns in step
-- ---------------------------------------------------------------------------------------
-- Named to fire after sync_sources_guard (triggers fire in name order), so the guard sees the
-- write as sent. A set holding a null or a day outside 0 to 6 is left for the check in section 4.

create or replace function public.keep_sync_weekdays()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.sync_weekdays is null and new.sync_weekday is not null then
      new.sync_weekdays := array[new.sync_weekday];
    end if;
  elsif new.sync_weekdays is not distinct from old.sync_weekdays
        and new.sync_weekday is distinct from old.sync_weekday then
    new.sync_weekdays := case when new.sync_weekday is null then null else array[new.sync_weekday] end;
  elsif new.sync_weekdays is null and old.sync_weekdays is null and new.sync_weekday is not null then
    -- A row with a single day and no set yet: an unrelated write gives it the set of its day
    -- instead of clearing the day below.
    new.sync_weekdays := array[new.sync_weekday];
  end if;
  if new.sync_weekdays is not null and array_position(new.sync_weekdays, null) is null then
    if (select count(distinct d) from unnest(new.sync_weekdays) as d) <> cardinality(new.sync_weekdays) then
      raise exception 'Pick each sync day once.';
    end if;
    new.sync_weekdays := array(select d from unnest(new.sync_weekdays) as d order by d);
  end if;
  new.sync_weekday := new.sync_weekdays[1];
  return new;
end;
$$;
revoke execute on function public.keep_sync_weekdays() from public, anon, authenticated;

drop trigger if exists sync_sources_keep_weekdays on public.sync_sources;
create trigger sync_sources_keep_weekdays
  before insert or update on public.sync_sources
  for each row execute function public.keep_sync_weekdays();

-- ---------------------------------------------------------------------------------------
-- 4. Checks
-- ---------------------------------------------------------------------------------------

alter table public.sync_sources drop constraint if exists sync_sources_schedule_check;
alter table public.sync_sources add constraint sync_sources_schedule_check
  check (
    (sync_weekdays is null) = (sync_time is null)
    and (sync_time is null) = (sync_timezone is null)
    and (sync_weekday is null) = (sync_weekdays is null)
  );

alter table public.sync_sources drop constraint if exists sync_sources_weekdays_check;
alter table public.sync_sources add constraint sync_sources_weekdays_check
  check (
    sync_weekdays is null
    or (
      array_ndims(sync_weekdays) = 1
      and cardinality(sync_weekdays) between 1 and 7
      and sync_weekdays <@ '{0,1,2,3,4,5,6}'::smallint[]
      and sync_weekday = sync_weekdays[1]
    )
  );

-- ---------------------------------------------------------------------------------------
-- 5. Audit
-- ---------------------------------------------------------------------------------------
-- The column list of 0030 with sync_weekdays and stale_business_days added.

drop trigger if exists sync_sources_audit on public.sync_sources;
create trigger sync_sources_audit
  after insert or update or delete on public.sync_sources
  for each row execute function private.audit_change(
    'provider', 'connection_id', 'name', 'target_module', 'config', 'field_map', 'record_key',
    'sync_weekday', 'sync_weekdays', 'sync_time', 'sync_timezone', 'stale_after_hours',
    'stale_business_days', 'enabled'
  );
