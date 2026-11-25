-- 0053_sop_library.sql
-- The SOP library upgrade: an editor document per version, version authors and "last updated by"
-- stamped by the database, categories each company owns, tags, full text search, sign-offs, and
-- tasks that an SOP sign-off closes. Paste after 0052; idempotent; go forwards only.
--
--   1. Versions carry an editor document. sop_versions gains body_json (the editor's document) and
--      body_text (plain text the database derives from body_json, or from body_md for a version
--      written before this). body_md becomes optional; one of the two bodies is required. The app
--      never sends body_text.
--   2. Who wrote what. Each version gains author_profile_id and author_name; each SOP gains
--      created_by_profile_id, created_by_name, updated_by_profile_id and updated_by_name. All are
--      stamped from the signed-in person (rule 5: a person, found with private.auth_profile_id()).
--      Names are kept on the row because an employee reads an SOP but not every profile (0038).
--      Deleting a person clears their name with their id, as 0049 does elsewhere, and is never
--      taken as an edit by whoever deleted them.
--   3. A saved version is permanent (rule 9), now in the database too: a signed-in writer cannot
--      change one. Only a deleted person's or account's keys clearing gets through.
--   4. Categories are each company's own rows (rule 12): sop_categories. Every SOP filed under one
--      of the five fixed categories moves to its company's row of that name. The fixed column is
--      kept as it was, so the previous app still lists them if it is rolled back, and cleared the
--      first time anyone signed in writes the SOP, so a later paste never refiles an SOP someone
--      has since moved. Members read, admins write.
--   5. Tags: sops.tags, trimmed and deduplicated by the database, up to 20 of 40 characters.
--   6. Search: sops.body_text holds the current version's text; sops.search, kept by trigger,
--      weighs the title first, then tags and summary, then the body. The app queries it through
--      PostgREST; no public function is added (rule 4).
--   7. Sign-offs: sop_signoffs, a record on the person. A person signs off a published SOP for
--      themselves; the database stamps the version, their name, the company and the time. They are
--      read the way 0038 reads every record of a person's: the person, Rococo, and whoever in the
--      company sees them (an owner, a full-scope admin, an admin over their divisions, and the
--      managers they report to up the chain). Nobody signed in changes or removes one.
--   8. Tasks on an SOP: tasks.sop_id. The SOP must be the company's own and published when linked.
--      When a task was assigned is tasks.assigned_at, stamped by the database from the clock on
--      insert and whenever its person or its SOP changes, never written by the app; sign-offs are
--      timed by the clock too. A sign-off closes that person's open tasks on the SOP assigned at or
--      before it. Until then the assignee cannot close the task by hand or by ticking its steps;
--      an admin can. Only an admin or the task's creator moves the link. A recurring task's next
--      copy keeps the link and, assigned after the sign-off that closed the last one, asks for a
--      new sign-off. A task reassigned to someone asks them for one of their own.
--
-- Redefines public.set_sop_version() and public.stamp_sop_updated_by() (0004) and
-- public.recur_task() (0036, 0037). If any of 0004, 0036 or 0037 is pasted again after this one,
-- paste 0053 straight after it.

-- ---------------------------------------------------------------------------------------
-- 4. Categories
-- ---------------------------------------------------------------------------------------
create table if not exists public.sop_categories (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  name        text not null,
  sort_order  integer not null default 0,
  retired_at  timestamptz,
  created_at  timestamptz not null default now(),
  constraint sop_categories_name_check check (btrim(name) <> '' and char_length(name) <= 60)
);
create unique index if not exists sop_categories_company_name_key
  on public.sop_categories (company_id, lower(btrim(name)));

alter table public.sop_categories enable row level security;
grant select, insert, update, delete on public.sop_categories to authenticated;

drop policy if exists "Members read SOP categories" on public.sop_categories;
create policy "Members read SOP categories"
  on public.sop_categories for select to authenticated
  using (private.is_company_member(company_id) or private.can_manage_company(company_id));
drop policy if exists "Admins add SOP categories" on public.sop_categories;
create policy "Admins add SOP categories"
  on public.sop_categories for insert to authenticated
  with check (private.can_manage_company(company_id));
drop policy if exists "Admins change SOP categories" on public.sop_categories;
create policy "Admins change SOP categories"
  on public.sop_categories for update to authenticated
  using (private.can_manage_company(company_id))
  with check (private.can_manage_company(company_id));
drop policy if exists "Admins delete SOP categories" on public.sop_categories;
create policy "Admins delete SOP categories"
  on public.sop_categories for delete to authenticated
  using (private.can_manage_company(company_id));

-- A category never moves company, and its name is kept trimmed.
create or replace function public.guard_sop_category()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  if tg_op = 'UPDATE' then
    new.company_id := old.company_id;
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_sop_category() from public, anon, authenticated;

drop trigger if exists sop_categories_guard on public.sop_categories;
create trigger sop_categories_guard
  before insert or update on public.sop_categories
  for each row execute function public.guard_sop_category();

drop trigger if exists sop_categories_audit on public.sop_categories;
create trigger sop_categories_audit
  after insert or update or delete on public.sop_categories
  for each row execute function private.audit_change('name', 'retired_at');

-- ---------------------------------------------------------------------------------------
-- 1, 2, 5, 6. New columns
-- ---------------------------------------------------------------------------------------
alter table public.sops add column if not exists category_id uuid references public.sop_categories (id) on delete set null;
alter table public.sops add column if not exists tags text[] not null default '{}';
alter table public.sops add column if not exists body_text text;
alter table public.sops add column if not exists search tsvector;
alter table public.sops add column if not exists created_by_profile_id uuid references public.profiles (id) on delete set null;
alter table public.sops add column if not exists created_by_name text;
alter table public.sops add column if not exists updated_by_profile_id uuid references public.profiles (id) on delete set null;
alter table public.sops add column if not exists updated_by_name text;
-- The fixed category is history now (4).
alter table public.sops alter column category drop not null;
alter table public.sops alter column category drop default;

create index if not exists sops_search_idx on public.sops using gin (search);
create index if not exists sops_tags_idx on public.sops using gin (tags);
create index if not exists sops_company_category_idx on public.sops (company_id, category_id);

alter table public.sop_versions add column if not exists body_json jsonb;
alter table public.sop_versions add column if not exists body_text text;
alter table public.sop_versions add column if not exists author_profile_id uuid references public.profiles (id) on delete set null;
alter table public.sop_versions add column if not exists author_name text;
alter table public.sop_versions alter column body_md drop not null;
alter table public.sop_versions alter column body_md drop default;
alter table public.sop_versions drop constraint if exists sop_versions_body_check;
alter table public.sop_versions add constraint sop_versions_body_check
  check (body_md is not null or body_json is not null);
alter table public.sop_versions drop constraint if exists sop_versions_body_json_check;
alter table public.sop_versions add constraint sop_versions_body_json_check
  check (body_json is null
         or (jsonb_typeof(body_json) = 'object'
             and body_json ->> 'type' = 'doc'
             and octet_length(body_json::text) <= 2000000));

-- ---------------------------------------------------------------------------------------
-- 1, 2. Versions: number, author, text, and the SOP's current text
-- ---------------------------------------------------------------------------------------
create or replace function public.sop_body_text(p_json jsonb, p_md text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(
    case
      when p_json is not null then
        (select string_agg(t #>> '{}', ' ') from jsonb_path_query(p_json, 'strict $.**.text') t)
      else p_md
    end,
    500000)
$$;
revoke execute on function public.sop_body_text(jsonb, text) from public, anon, authenticated;

create or replace function public.set_sop_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev text := current_setting('hub.sop_internal', true);
begin
  select company_id into new.company_id from public.sops where id = new.sop_id;
  if new.company_id is null then
    raise exception 'Unknown SOP.';
  end if;
  if (select auth.uid()) is not null then
    -- The database numbers versions and names who saved them, whatever the app sent.
    new.version := null;
    new.created_by := (select auth.uid());
    new.author_profile_id := private.auth_profile_id();
    new.author_name := (select p.full_name from public.profiles p where p.id = new.author_profile_id);
  end if;
  if new.version is null then
    select coalesce(max(version), 0) + 1 into new.version
      from public.sop_versions where sop_id = new.sop_id;
  end if;
  new.body_text := public.sop_body_text(new.body_json, new.body_md);

  perform set_config('hub.sop_internal', '1', true);
  update public.sops
     set current_version = greatest(current_version, new.version),
         body_text = case when new.version >= current_version then new.body_text else body_text end,
         updated_at = now()
   where id = new.sop_id;
  perform set_config('hub.sop_internal', coalesce(v_prev, ''), true);
  return new;
end;
$$;
revoke execute on function public.set_sop_version() from public, anon, authenticated;

-- 3. A saved version is permanent. A deleted person's or account's keys clearing is the one change
-- let through, and the person's name goes with their id.
create or replace function public.guard_sop_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_probe public.sop_versions%rowtype := new;
begin
  if new.author_profile_id is null and old.author_profile_id is not null
     and not exists (select 1 from public.profiles p where p.id = old.author_profile_id) then
    new.author_name := null;
    v_probe.author_profile_id := old.author_profile_id;
    v_probe.author_name := old.author_name;
  end if;
  if new.created_by is null and old.created_by is not null
     and not exists (select 1 from auth.users u where u.id = old.created_by) then
    v_probe.created_by := old.created_by;
  end if;
  if (select auth.uid()) is not null and v_probe is distinct from old then
    raise exception 'A saved version is permanent. Save a new version instead.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_sop_version() from public, anon, authenticated;

drop trigger if exists sop_versions_guard on public.sop_versions;
create trigger sop_versions_guard
  before update on public.sop_versions
  for each row execute function public.guard_sop_version();

-- ---------------------------------------------------------------------------------------
-- 4, 5, 6. The SOP row: its category, its tags, its text and its search
-- ---------------------------------------------------------------------------------------
create or replace function public.normalize_sop()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_internal boolean := coalesce(current_setting('hub.sop_internal', true), '') = '1';
begin
  -- The SOP's text is the current version's, set only by set_sop_version. The fixed category of
  -- before 0053 is history once anyone writes the SOP (4).
  if not v_internal and (select auth.uid()) is not null then
    new.body_text := case when tg_op = 'INSERT' then null else old.body_text end;
    new.category := null;
  end if;

  if new.category_id is not null
     and (tg_op = 'INSERT' or new.category_id is distinct from old.category_id)
     and (select c.company_id from public.sop_categories c where c.id = new.category_id)
         is distinct from new.company_id then
    raise exception 'That category belongs to another company.'
      using errcode = 'check_violation';
  end if;

  select coalesce(array_agg(t.tag order by t.first), '{}') into new.tags
    from (
      select distinct on (lower(btrim(x))) btrim(x) as tag, n as first
        from unnest(coalesce(new.tags, '{}')) with ordinality u (x, n)
       where btrim(coalesce(x, '')) <> ''
       order by lower(btrim(x)), n
    ) t;
  if cardinality(new.tags) > 20
     or exists (select 1 from unnest(new.tags) x where char_length(x) > 40) then
    raise exception 'An SOP takes up to 20 tags of 40 characters each.'
      using errcode = 'check_violation';
  end if;

  new.search :=
    setweight(to_tsvector('english', coalesce(new.title, '')), 'A')
    || setweight(to_tsvector('english', coalesce(array_to_string(new.tags, ' '), '') || ' ' || coalesce(new.summary, '')), 'B')
    || setweight(to_tsvector('english', coalesce(new.body_text, '')), 'C');
  return new;
end;
$$;
revoke execute on function public.normalize_sop() from public, anon, authenticated;

drop trigger if exists sops_normalize on public.sops;
create trigger sops_normalize
  before insert or update on public.sops
  for each row execute function public.normalize_sop();

-- 2. Who created and last updated the SOP. Runs after sops_normalize (triggers fire by name).
create or replace function public.stamp_sop_updated_by()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid;
  v_name text;
begin
  if tg_op = 'UPDATE' then
    -- A deleted person's or account's keys clearing is not an edit by whoever deleted them.
    if new.updated_by_profile_id is null and old.updated_by_profile_id is not null
       and not exists (select 1 from public.profiles p where p.id = old.updated_by_profile_id) then
      new.updated_by_name := null;
      return new;
    end if;
    if new.created_by_profile_id is null and old.created_by_profile_id is not null
       and not exists (select 1 from public.profiles p where p.id = old.created_by_profile_id) then
      new.created_by_name := null;
      return new;
    end if;
    if new.updated_by is null and old.updated_by is not null
       and not exists (select 1 from auth.users u where u.id = old.updated_by) then
      return new;
    end if;
    if new.created_by is null and old.created_by is not null
       and not exists (select 1 from auth.users u where u.id = old.created_by) then
      return new;
    end if;
    -- Nor is a deleted category's key clearing: its SOPs become Uncategorized, nobody edited them.
    if new.category_id is null and old.category_id is not null
       and not exists (select 1 from public.sop_categories c where c.id = old.category_id) then
      return new;
    end if;
  end if;

  if (select auth.uid()) is not null then
    v_me := private.auth_profile_id();
    select p.full_name into v_name from public.profiles p where p.id = v_me;
    if tg_op = 'INSERT' then
      new.created_by := (select auth.uid());
      new.created_by_profile_id := v_me;
      new.created_by_name := v_name;
    else
      new.created_by := old.created_by;
      new.created_by_profile_id := old.created_by_profile_id;
      new.created_by_name := old.created_by_name;
    end if;
    new.updated_by := (select auth.uid());
    new.updated_by_profile_id := v_me;
    new.updated_by_name := v_name;
    new.updated_at := now();
  end if;
  return new;
end;
$$;
revoke execute on function public.stamp_sop_updated_by() from public, anon, authenticated;

drop trigger if exists sops_stamp_updated_by on public.sops;
create trigger sops_stamp_updated_by
  before insert or update on public.sops
  for each row execute function public.stamp_sop_updated_by();

-- ---------------------------------------------------------------------------------------
-- 7. Sign-offs
-- ---------------------------------------------------------------------------------------
create table if not exists public.sop_signoffs (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  sop_id       uuid not null references public.sops (id) on delete cascade,
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  version      integer not null,
  signer_name  text,
  signed_at    timestamptz not null default now()
);
create index if not exists sop_signoffs_sop_person_idx on public.sop_signoffs (sop_id, profile_id, signed_at desc);
create index if not exists sop_signoffs_company_person_idx on public.sop_signoffs (company_id, profile_id);

alter table public.sop_signoffs enable row level security;
grant select, insert on public.sop_signoffs to authenticated;

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
drop policy if exists "People sign off for themselves" on public.sop_signoffs;
create policy "People sign off for themselves"
  on public.sop_signoffs for insert to authenticated
  with check (profile_id = private.auth_profile_id() and private.is_company_member(company_id));

create or replace function public.stamp_sop_signoff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sop  record;
  v_last timestamptz;
begin
  select s.company_id, s.status, s.current_version into v_sop
    from public.sops s where s.id = new.sop_id;
  if not found then
    raise exception 'Unknown SOP.';
  end if;
  new.company_id := v_sop.company_id;
  if v_sop.status <> 'published' then
    raise exception 'Only a published SOP can be signed off.'
      using errcode = 'check_violation';
  end if;
  if (select p.company_id from public.profiles p where p.id = new.profile_id) is distinct from v_sop.company_id then
    raise exception 'Only someone in this company can sign off its SOPs.'
      using errcode = 'check_violation';
  end if;

  if (select auth.uid()) is not null then
    if new.profile_id is distinct from private.auth_profile_id() then
      raise exception 'A sign-off is your own. Nobody signs off for someone else.'
        using errcode = 'check_violation';
    end if;
    new.version := v_sop.current_version;
    -- The clock, not the transaction's start, so a sign-off and the tasks around it keep their order.
    new.signed_at := clock_timestamp();
    -- One sign-off a version, unless a task assigned since asks for another.
    select max(o.signed_at) into v_last
      from public.sop_signoffs o
     where o.sop_id = new.sop_id and o.profile_id = new.profile_id and o.version = new.version;
    if v_last is not null and not exists (
      select 1 from public.tasks t
       where t.sop_id = new.sop_id and t.assignee_id = new.profile_id
         and t.completed_at is null and t.assigned_at > v_last
    ) then
      raise exception 'You have already signed off this version.'
        using errcode = 'check_violation';
    end if;
  else
    new.version := coalesce(new.version, v_sop.current_version);
  end if;
  new.signer_name := (select p.full_name from public.profiles p where p.id = new.profile_id);
  return new;
end;
$$;
revoke execute on function public.stamp_sop_signoff() from public, anon, authenticated;

drop trigger if exists sop_signoffs_stamp on public.sop_signoffs;
create trigger sop_signoffs_stamp
  before insert on public.sop_signoffs
  for each row execute function public.stamp_sop_signoff();

-- ---------------------------------------------------------------------------------------
-- 8. Tasks on an SOP
-- ---------------------------------------------------------------------------------------
alter table public.tasks add column if not exists sop_id uuid references public.sops (id) on delete set null;
create index if not exists tasks_sop_idx on public.tasks (sop_id, assignee_id) where sop_id is not null;

-- When each task was assigned. Tasks from before 0053 were assigned when they were created. The
-- backfill runs with the table's triggers off, so no task's updated_at or stamps move.
alter table public.tasks add column if not exists assigned_at timestamptz;
do $$
begin
  if exists (select 1 from public.tasks where assigned_at is null) then
    alter table public.tasks disable trigger user;
    update public.tasks set assigned_at = created_at where assigned_at is null;
    alter table public.tasks enable trigger user;
  end if;
end $$;
alter table public.tasks alter column assigned_at set default now();
alter table public.tasks alter column assigned_at set not null;

-- A sign-off closes the person's open tasks on the SOP that were assigned at or before it.
create or replace function public.close_tasks_on_signoff()
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
     set completed_at = now(), completed_by = new.profile_id
   where sop_id = new.sop_id
     and assignee_id = new.profile_id
     and completed_at is null
     and assigned_at <= new.signed_at;
  perform set_config('hub.task_internal', coalesce(v_prev, ''), true);
  return null;
end;
$$;
revoke execute on function public.close_tasks_on_signoff() from public, anon, authenticated;

drop trigger if exists sop_signoffs_close_tasks on public.sop_signoffs;
create trigger sop_signoffs_close_tasks
  after insert on public.sop_signoffs
  for each row execute function public.close_tasks_on_signoff();

create or replace function public.guard_task_sop()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_internal boolean := coalesce(current_setting('hub.task_internal', true), '') = '1';
  v_signed_in boolean := (select auth.uid()) is not null;
  v_sop record;
begin
  -- When it was assigned: the clock, on insert and whenever its person or its SOP changes. Never
  -- what the app sent.
  if tg_op = 'INSERT' then
    new.assigned_at := clock_timestamp();
  elsif new.assignee_id is distinct from old.assignee_id or new.sop_id is distinct from old.sop_id then
    new.assigned_at := clock_timestamp();
  else
    new.assigned_at := coalesce(old.assigned_at, new.assigned_at);
  end if;

  -- Moving the link is the assigner's: an admin, or whoever created the task.
  if tg_op = 'UPDATE' and not v_internal and v_signed_in
     and new.sop_id is distinct from old.sop_id
     and not (new.sop_id is null and old.sop_id is not null
              and not exists (select 1 from public.sops s where s.id = old.sop_id))
     and not private.can_manage_company(old.company_id)
     and old.created_by is distinct from private.auth_profile_id() then
    raise exception 'Only the person who assigned this task can change its SOP.'
      using errcode = 'check_violation';
  end if;

  if new.sop_id is not null and (tg_op = 'INSERT' or new.sop_id is distinct from old.sop_id) then
    select s.company_id, s.status into v_sop from public.sops s where s.id = new.sop_id;
    if not found then
      raise exception 'That SOP is not here any more.' using errcode = 'check_violation';
    end if;
    if v_sop.company_id is distinct from new.company_id then
      raise exception 'That SOP belongs to another company.' using errcode = 'check_violation';
    end if;
    if v_sop.status <> 'published' then
      if v_internal then
        -- The next copy of a recurring task whose SOP has since been unpublished goes without it.
        new.sop_id := null;
      else
        raise exception 'Only a published SOP can be assigned.' using errcode = 'check_violation';
      end if;
    end if;
  end if;

  if new.sop_id is not null and new.completed_at is not null
     and (tg_op = 'INSERT' or old.completed_at is null) then
    if new.assignee_id is null or not exists (
      select 1 from public.sop_signoffs o
       where o.sop_id = new.sop_id and o.profile_id = new.assignee_id and o.signed_at >= new.assigned_at
    ) then
      if v_internal then
        -- Ticking every step does not finish an SOP task; the sign-off does.
        new.completed_at := null;
        new.completed_by := null;
      elsif v_signed_in and not private.can_manage_company(new.company_id) then
        raise exception 'This task finishes when the SOP is signed off.'
          using errcode = 'check_violation';
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_task_sop() from public, anon, authenticated;

drop trigger if exists tasks_guard_sop on public.tasks;
create trigger tasks_guard_sop
  before insert or update on public.tasks
  for each row execute function public.guard_task_sop();

-- The 0037 body, with the SOP link carried to the next copy.
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
     campaign_id, notified_assignee_id, sop_id)
  values
    (new.company_id, new.title, new.description, new.assignee_id, new.created_by, v_due,
     new.priority, new.recurrence, new.campaign_id, new.assignee_id, new.sop_id)
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

-- ---------------------------------------------------------------------------------------
-- Backfill (as the SQL editor: nobody signed in, so no stamp moves and no date changes)
-- ---------------------------------------------------------------------------------------
-- Each company gets a category for each fixed one its SOPs use, and those SOPs move to it.
insert into public.sop_categories (company_id, name, sort_order)
select distinct s.company_id, initcap(s.category),
       case s.category when 'safety' then 1 when 'process' then 2 when 'client' then 3
                       when 'admin' then 4 else 5 end
  from public.sops s
 where s.category is not null and s.category_id is null
on conflict (company_id, lower(btrim(name))) do nothing;

update public.sops s
   set category_id = c.id
  from public.sop_categories c
 where s.category is not null
   and s.category_id is null
   and c.company_id = s.company_id
   and lower(c.name) = s.category;

-- Versions written before this get their text and their author's name.
update public.sop_versions v
   set body_text = public.sop_body_text(v.body_json, v.body_md)
 where v.body_text is null;

update public.sop_versions v
   set author_profile_id = p.id, author_name = p.full_name
  from public.profiles p
 where v.author_profile_id is null and v.created_by is not null and p.user_id = v.created_by;

-- SOPs get their current text, their search, and who created and last updated them.
update public.sops s
   set body_text = v.body_text
  from public.sop_versions v
 where v.sop_id = s.id and v.version = s.current_version and s.body_text is null;

update public.sops s
   set created_by_profile_id = p.id, created_by_name = p.full_name
  from public.profiles p
 where s.created_by_profile_id is null and s.created_by is not null and p.user_id = s.created_by;

update public.sops s
   set updated_by_profile_id = p.id, updated_by_name = p.full_name
  from public.profiles p
 where s.updated_by_profile_id is null and s.updated_by is not null and p.user_id = s.updated_by;

update public.sops set search = null where search is null;
