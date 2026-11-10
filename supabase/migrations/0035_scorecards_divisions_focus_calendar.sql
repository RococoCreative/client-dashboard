-- 0035_scorecards_divisions_focus_calendar.sql
-- A focus topic calendar, role scorecards, the monthly review's opening discussion and project
-- notes, divisions inside a company, and projects per person. Paste after 0034 (and 0032, in
-- whichever order those two went in); idempotent.
--
-- Every company gets all of this; what differs between them is rows (rule 12). RBA's roles,
-- metrics and divisions are data and live in supabase/seeds/rba_scorecards.sql, run once this is
-- applied.
--
--   1. focus_topics: one theme per company per month, planned ahead. The new month dialog and the
--      monthly cycle read it; nothing here copies it anywhere.
--   2. role_metrics: what a job role is scored on each month (a percent, a 1 to N rating, or a
--      plain number), with an optional target. Optimization rate is simply a percent metric.
--   3. metric_entries: a person's result on one metric for one month, and per project where the
--      metric is per project. The value is checked against the metric's kind here, so a percent is
--      0 to 100 and a rating sits on its scale whatever the caller sends. The arithmetic (month
--      result, year to date, the year grid) is src/lib/scorecard.ts and nowhere else.
--   4. reviews.support_discussion: the opening question of a monthly review, "What would help you
--      do your job better?". The employee writes it on their own open review, and the employee
--      guard becomes a list of what they may write rather than of what they may not, so a column
--      added later is admin-only until a migration says otherwise. 0029's signed-off guard
--      compares the whole row, so a completed review freezes this column with the rest.
--   5. review_project_notes: the project-by-project discussion on a review, one note per project.
--      Admins write, the person reads their own, and a signed-off review keeps its notes.
--   6. A goal someone else set for a person is theirs to work, not to rewrite. An employee may move
--      its completion, its status and its why, tick its action steps and write notes, but not
--      change what the goal is or delete it. goals.created_by becomes the person who filed it
--      (a profile, like every newer table) instead of an account, stamped by the database.
--   7. company_divisions: the parts of a company (RBA South, RBA North), and profiles.division_id.
--   8. profiles.can_view_divisions: who besides owners and Rococo sees the split. Only an owner of
--      the person's company or a Rococo admin may set it; admins set a person's division.
--   9. project_assignments: who works on which project. Moving a person to another company takes
--      them off the old company's projects.
--
-- Rebuilt functions are copied from their latest bodies with only the lines named added:
-- guard_profile_fields and guard_profile_insert from 0033, guard_review_employee_fields from 0023.
-- guard_goal_frozen (latest 0034) is not touched; the goal lock is its own trigger beside it, and
-- a write has to pass both.

-- ---------------------------------------------------------------------------------------
-- 1. focus_topics
-- ---------------------------------------------------------------------------------------

create table if not exists public.focus_topics (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  -- Always the first of a month.
  month        date not null,
  theme        text not null,
  description  text,
  created_by   uuid references public.profiles (id) on delete set null,
  updated_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint focus_topics_month_check check (extract(day from month) = 1),
  constraint focus_topics_theme_check check (btrim(theme) <> ''),
  constraint focus_topics_company_month_key unique (company_id, month)
);

create index if not exists focus_topics_created_by_idx on public.focus_topics (created_by);
create index if not exists focus_topics_updated_by_idx on public.focus_topics (updated_by);

drop trigger if exists focus_topics_pin_company on public.focus_topics;
create trigger focus_topics_pin_company
  before update on public.focus_topics
  for each row execute function public.pin_company_id();

drop trigger if exists focus_topics_stamp_actor on public.focus_topics;
create trigger focus_topics_stamp_actor
  before insert or update on public.focus_topics
  for each row execute function public.stamp_actor();

drop trigger if exists focus_topics_set_updated_at on public.focus_topics;
create trigger focus_topics_set_updated_at
  before update on public.focus_topics
  for each row execute function public.set_updated_at();

alter table public.focus_topics enable row level security;
revoke all on public.focus_topics from anon, authenticated;
grant select, insert, update, delete on public.focus_topics to authenticated;

drop policy if exists "Members read focus topics" on public.focus_topics;
create policy "Members read focus topics"
  on public.focus_topics for select to authenticated
  using (private.is_company_member(company_id));

drop policy if exists "Admins add focus topics" on public.focus_topics;
create policy "Admins add focus topics"
  on public.focus_topics for insert to authenticated
  with check (private.can_manage_company(company_id));

drop policy if exists "Admins change focus topics" on public.focus_topics;
create policy "Admins change focus topics"
  on public.focus_topics for update to authenticated
  using (private.can_manage_company(company_id))
  with check (private.can_manage_company(company_id));

drop policy if exists "Admins remove focus topics" on public.focus_topics;
create policy "Admins remove focus topics"
  on public.focus_topics for delete to authenticated
  using (private.can_manage_company(company_id));

-- ---------------------------------------------------------------------------------------
-- 2. role_metrics
-- ---------------------------------------------------------------------------------------

create table if not exists public.role_metrics (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  job_role_id       uuid not null references public.job_roles (id) on delete cascade,
  name              text not null,
  description       text,
  kind              text not null,
  -- Null until the company sets one; a metric with no target is shown, never judged.
  target            numeric,
  -- The top of a rating's scale (1 to scale_max). Read only for kind 'rating'.
  scale_max         integer not null default 5,
  higher_is_better  boolean not null default true,
  -- Entered once per assigned project each month rather than once for the month.
  per_project       boolean not null default false,
  sort_order        integer not null default 0,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint role_metrics_name_check check (btrim(name) <> ''),
  constraint role_metrics_kind_check check (kind in ('percent', 'rating', 'number')),
  constraint role_metrics_scale_max_check check (scale_max between 2 and 10),
  constraint role_metrics_name_key unique (job_role_id, name)
);

create index if not exists role_metrics_company_id_idx on public.role_metrics (company_id);

-- Whether a value fits a metric of this kind: a percent is 0 to 100, a rating 1 to the top of
-- its scale, a number anything. The one statement of the rule, read by both triggers below.
create or replace function private.metric_value_fits(p_kind text, p_scale_max integer, p_value numeric)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'percent' then p_value between 0 and 100
    when 'rating' then p_value between 1 and p_scale_max
    else p_value is not null
  end
$$;
revoke all on function private.metric_value_fits(text, integer, numeric) from public, anon, authenticated;

-- The job role decides the company, and a metric stays in it. Results already entered keep
-- fitting: a metric with results cannot move to a scale they fall outside, or start or stop
-- being per project.
create or replace function public.inherit_role_metric_company()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  select j.company_id into v_company from public.job_roles j where j.id = new.job_role_id;
  if v_company is null then
    raise exception 'That job role does not exist.';
  end if;
  if tg_op = 'UPDATE' and v_company is distinct from old.company_id then
    raise exception 'A metric stays with its own company''s roles.'
      using errcode = 'check_violation';
  end if;
  new.company_id := v_company;
  if tg_op = 'UPDATE' then
    if (new.kind is distinct from old.kind or new.scale_max is distinct from old.scale_max)
       and exists (
         select 1 from public.metric_entries e
          where e.metric_id = new.id
            and not private.metric_value_fits(new.kind, new.scale_max, e.value)
       ) then
      raise exception 'Results already entered for this metric do not fit that scale.'
        using errcode = 'check_violation';
    end if;
    if new.per_project is distinct from old.per_project
       and exists (select 1 from public.metric_entries e where e.metric_id = new.id) then
      raise exception 'Results are already entered for this metric, so whether it is per project cannot change.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.inherit_role_metric_company() from public, anon, authenticated;

-- A metric with results is a record: retire it (untick Active) instead. The same goes for a job
-- role whose metrics have results, since deleting the role would take them. Deleting the whole
-- company is the exception: by the time the cascade arrives the company row is already gone.
create or replace function public.guard_role_metric_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.companies c where c.id = old.company_id) then
    return old;
  end if;
  if exists (select 1 from public.metric_entries e where e.metric_id = old.id) then
    if not exists (select 1 from public.job_roles j where j.id = old.job_role_id) then
      raise exception 'This role has scorecard results entered, so it cannot be deleted. Untick Active to retire it instead.'
        using errcode = 'check_violation';
    end if;
    raise exception 'This metric has results entered, so it cannot be deleted. Untick Active to retire it instead.'
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;
revoke execute on function public.guard_role_metric_delete() from public, anon, authenticated;

drop trigger if exists role_metrics_inherit_company on public.role_metrics;
create trigger role_metrics_inherit_company
  before insert or update on public.role_metrics
  for each row execute function public.inherit_role_metric_company();

drop trigger if exists role_metrics_guard_delete on public.role_metrics;
create trigger role_metrics_guard_delete
  before delete on public.role_metrics
  for each row execute function public.guard_role_metric_delete();

drop trigger if exists role_metrics_set_updated_at on public.role_metrics;
create trigger role_metrics_set_updated_at
  before update on public.role_metrics
  for each row execute function public.set_updated_at();

alter table public.role_metrics enable row level security;
revoke all on public.role_metrics from anon, authenticated;
grant select, insert, update, delete on public.role_metrics to authenticated;

drop policy if exists "Members read role metrics" on public.role_metrics;
create policy "Members read role metrics"
  on public.role_metrics for select to authenticated
  using (private.is_company_member(company_id));

drop policy if exists "Admins add role metrics" on public.role_metrics;
create policy "Admins add role metrics"
  on public.role_metrics for insert to authenticated
  with check (private.can_manage_company(company_id));

drop policy if exists "Admins change role metrics" on public.role_metrics;
create policy "Admins change role metrics"
  on public.role_metrics for update to authenticated
  using (private.can_manage_company(company_id))
  with check (private.can_manage_company(company_id));

drop policy if exists "Admins remove role metrics" on public.role_metrics;
create policy "Admins remove role metrics"
  on public.role_metrics for delete to authenticated
  using (private.can_manage_company(company_id));

-- ---------------------------------------------------------------------------------------
-- 3. metric_entries
-- ---------------------------------------------------------------------------------------
-- One result per person, metric, month and project, with no project counting as one value
-- (nulls not distinct), so the app can upsert on exactly those four columns.

create table if not exists public.metric_entries (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  employee_id   uuid not null references public.profiles (id) on delete cascade,
  -- No action: a metric with results is retired, not deleted (guard_role_metric_delete).
  metric_id     uuid not null references public.role_metrics (id),
  -- Always the first of a month.
  period_month  date not null,
  project_id    uuid references public.projects (id) on delete set null,
  -- A percent is stored as 0 to 100; a rating as 1 to the metric's scale_max.
  value         numeric not null,
  note          text,
  entered_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint metric_entries_period_check check (extract(day from period_month) = 1),
  constraint metric_entries_key unique nulls not distinct (employee_id, metric_id, period_month, project_id)
);

create index if not exists metric_entries_company_period_idx on public.metric_entries (company_id, period_month);
create index if not exists metric_entries_metric_id_idx on public.metric_entries (metric_id);
create index if not exists metric_entries_project_id_idx on public.metric_entries (project_id);
create index if not exists metric_entries_entered_by_idx on public.metric_entries (entered_by);

-- The metric decides the company. The person has to be on that company's team when the entry is
-- made (an entry stays with the company it was made in if they later move, as a review does), a
-- project has to be the same company's, a per-project metric takes one and any other metric
-- none, and the value has to fit the metric's kind. The session decides who entered it.
create or replace function public.stamp_metric_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company     uuid;
  v_kind        text;
  v_scale_max   integer;
  v_per_project boolean;
begin
  select m.company_id, m.kind, m.scale_max, m.per_project
    into v_company, v_kind, v_scale_max, v_per_project
    from public.role_metrics m
   where m.id = new.metric_id;
  if v_company is null then
    raise exception 'That metric does not exist.';
  end if;
  new.company_id := v_company;

  if tg_op = 'INSERT'
     or new.employee_id is distinct from old.employee_id
     or new.metric_id is distinct from old.metric_id then
    if not exists (
      select 1 from public.profiles p where p.id = new.employee_id and p.company_id = v_company
    ) then
      raise exception 'That person is not on this company''s team.'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.project_id is not null
     and not exists (
       select 1 from public.projects pr where pr.id = new.project_id and pr.company_id = v_company
     ) then
    raise exception 'That project belongs to another company.'
      using errcode = 'check_violation';
  end if;

  if v_per_project and new.project_id is null then
    -- The one write let through: the foreign key clearing a project that is being deleted.
    if not (tg_op = 'UPDATE'
            and old.project_id is not null
            and not exists (select 1 from public.projects pr where pr.id = old.project_id)) then
      raise exception 'This metric is entered per project. Choose the project.'
        using errcode = 'check_violation';
    end if;
  elsif not v_per_project and new.project_id is not null then
    raise exception 'This metric is entered once for the month, not per project.'
      using errcode = 'check_violation';
  end if;

  if not private.metric_value_fits(v_kind, v_scale_max, new.value) then
    raise exception '%',
      case v_kind
        when 'percent' then 'A percent is between 0 and 100.'
        when 'rating' then format('A rating is between 1 and %s.', v_scale_max)
        else 'Enter a number.'
      end
      using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    new.entered_by := coalesce(private.auth_profile_id(), new.entered_by);
    new.created_at := now();
  else
    new.entered_by := coalesce(private.auth_profile_id(), old.entered_by);
    new.created_at := old.created_at;
  end if;
  new.note := nullif(btrim(new.note), '');
  return new;
end;
$$;
revoke execute on function public.stamp_metric_entry() from public, anon, authenticated;

drop trigger if exists metric_entries_stamp on public.metric_entries;
create trigger metric_entries_stamp
  before insert or update on public.metric_entries
  for each row execute function public.stamp_metric_entry();

drop trigger if exists metric_entries_set_updated_at on public.metric_entries;
create trigger metric_entries_set_updated_at
  before update on public.metric_entries
  for each row execute function public.set_updated_at();

alter table public.metric_entries enable row level security;
revoke all on public.metric_entries from anon, authenticated;
grant select, insert, update, delete on public.metric_entries to authenticated;

drop policy if exists "Admins and the person read metric entries" on public.metric_entries;
create policy "Admins and the person read metric entries"
  on public.metric_entries for select to authenticated
  using (employee_id = private.auth_profile_id() or private.can_manage_company(company_id));

drop policy if exists "Admins enter metric results" on public.metric_entries;
create policy "Admins enter metric results"
  on public.metric_entries for insert to authenticated
  with check (private.can_manage_company(company_id));

drop policy if exists "Admins change metric results" on public.metric_entries;
create policy "Admins change metric results"
  on public.metric_entries for update to authenticated
  using (private.can_manage_company(company_id))
  with check (private.can_manage_company(company_id));

drop policy if exists "Admins remove metric results" on public.metric_entries;
create policy "Admins remove metric results"
  on public.metric_entries for delete to authenticated
  using (private.can_manage_company(company_id));

-- ---------------------------------------------------------------------------------------
-- 4. The opening discussion
-- ---------------------------------------------------------------------------------------

alter table public.reviews add column if not exists support_discussion text;

-- The 0023 rule, written as what an employee may change rather than what they may not: their
-- reflection, and now the opening discussion. updated_at moves with any write, and the pillar
-- snapshot is the snapshot trigger's to keep (it fires later and restores it). Anything else on
-- their own review is an admin's, including any column a later migration adds. The message is
-- 0023's.
create or replace function public.guard_review_employee_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_probe public.reviews%rowtype;
begin
  if private.can_manage_company(old.company_id) then
    return new;
  end if;
  v_probe := new;
  v_probe.employee_reflection := old.employee_reflection;
  v_probe.support_discussion := old.support_discussion;
  v_probe.updated_at := old.updated_at;
  v_probe.pillar_snapshot := old.pillar_snapshot;
  if v_probe is distinct from old then
    raise exception 'Only admins can edit review scores, status, and feedback.';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_review_employee_fields() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 5. review_project_notes
-- ---------------------------------------------------------------------------------------

create table if not exists public.review_project_notes (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  review_id   uuid not null references public.reviews (id) on delete cascade,
  project_id  uuid not null references public.projects (id) on delete cascade,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint review_project_notes_key unique (review_id, project_id)
);

create index if not exists review_project_notes_company_id_idx on public.review_project_notes (company_id);
create index if not exists review_project_notes_project_id_idx on public.review_project_notes (project_id);

-- The review decides the company, and the project has to be the same company's. A note stays on
-- the review and project it was written for.
create or replace function public.stamp_review_project_note()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.review_id  := old.review_id;
    new.project_id := old.project_id;
    new.created_at := old.created_at;
  end if;
  select r.company_id into new.company_id from public.reviews r where r.id = new.review_id;
  if new.company_id is null then
    raise exception 'That review does not exist.';
  end if;
  if not exists (
    select 1 from public.projects pr where pr.id = new.project_id and pr.company_id = new.company_id
  ) then
    raise exception 'That project belongs to another company.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.stamp_review_project_note() from public, anon, authenticated;

-- A signed-off review keeps its project notes until it is reopened, as it keeps everything else
-- (0029). A note going because its review, project or company is being deleted goes with them.
create or replace function public.guard_review_project_note_signed_off()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from uuid := case when tg_op = 'INSERT' then null else old.review_id end;
  v_to   uuid := case when tg_op = 'DELETE' then null else new.review_id end;
begin
  if tg_op = 'DELETE'
     and (not exists (select 1 from public.reviews r where r.id = old.review_id)
          or not exists (select 1 from public.projects pr where pr.id = old.project_id)
          or not exists (select 1 from public.companies c where c.id = old.company_id)) then
    return old;
  end if;
  if exists (
    select 1 from public.reviews r
     where r.id in (v_from, v_to)
       and r.status = 'complete'
  ) then
    raise exception 'This review is signed off. Reopen it to change it.'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_review_project_note_signed_off() from public, anon, authenticated;

drop trigger if exists review_project_notes_guard_signed_off on public.review_project_notes;
create trigger review_project_notes_guard_signed_off
  before insert or update or delete on public.review_project_notes
  for each row execute function public.guard_review_project_note_signed_off();

drop trigger if exists review_project_notes_stamp on public.review_project_notes;
create trigger review_project_notes_stamp
  before insert or update on public.review_project_notes
  for each row execute function public.stamp_review_project_note();

drop trigger if exists review_project_notes_set_updated_at on public.review_project_notes;
create trigger review_project_notes_set_updated_at
  before update on public.review_project_notes
  for each row execute function public.set_updated_at();

alter table public.review_project_notes enable row level security;
revoke all on public.review_project_notes from anon, authenticated;
grant select, insert, update, delete on public.review_project_notes to authenticated;

-- As review feedback: admins read and write, the person reads the notes on their own review.
drop policy if exists "Admins and the person read review project notes" on public.review_project_notes;
create policy "Admins and the person read review project notes"
  on public.review_project_notes for select to authenticated
  using (
    private.can_manage_company(company_id)
    or exists (
      select 1 from public.reviews r
       where r.id = review_project_notes.review_id and r.employee_id = private.auth_profile_id()
    )
  );

drop policy if exists "Admins add review project notes" on public.review_project_notes;
create policy "Admins add review project notes"
  on public.review_project_notes for insert to authenticated
  with check (private.can_manage_company(company_id));

drop policy if exists "Admins change review project notes" on public.review_project_notes;
create policy "Admins change review project notes"
  on public.review_project_notes for update to authenticated
  using (private.can_manage_company(company_id))
  with check (private.can_manage_company(company_id));

drop policy if exists "Admins remove review project notes" on public.review_project_notes;
create policy "Admins remove review project notes"
  on public.review_project_notes for delete to authenticated
  using (private.can_manage_company(company_id));

-- ---------------------------------------------------------------------------------------
-- 6. A goal someone else set is the person's to work, not to rewrite
-- ---------------------------------------------------------------------------------------
-- goals.created_by named an account (0003, default auth.uid()), the one person-shaped column in
-- the GSR tables that did. It becomes the profile of whoever filed the goal, like projects and
-- wins, so "set by the person or by someone else" compares a person with a person (rule 5). Each
-- existing value is mapped through the account it named; one whose account has no profile becomes
-- null. Not an edit anybody made, so the guards, the company stamp and updated_at stay out of it.
-- Runs once: a second paste finds the foreign key already pointing at profiles.
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.goals'::regclass
       and conname = 'goals_created_by_fkey'
       and confrelid = 'auth.users'::regclass
  ) then
    alter table public.goals alter column created_by drop default;
    alter table public.goals drop constraint goals_created_by_fkey;
    alter table public.goals disable trigger user;
    update public.goals g
       set created_by = (select p.id from public.profiles p where p.user_id = g.created_by)
     where g.created_by is not null;
    alter table public.goals enable trigger user;
    alter table public.goals add constraint goals_created_by_fkey
      foreign key (created_by) references public.profiles (id) on delete set null;
  end if;
end $$;

create index if not exists goals_created_by_idx on public.goals (created_by);

-- The database says who filed a goal: the signed-in person on insert, and nobody changes it after,
-- except the foreign key clearing a profile that is being deleted. A write with nobody signed in
-- (the SQL editor, a migration) keeps what it sends.
--
-- Then the lock. An employee working their own goals (not an admin of the goal's company, not
-- Rococo, and signed in) may not delete a goal someone else filed for them, or change its title,
-- description, kind, focus mark, month, scope or year. Its completion, status, why, action steps,
-- order and carried-from link stay theirs, and its notes and a yearly goal's private steps are on
-- their own tables (0021), which this does not touch. A goal with no creator on file is the
-- person's own, so nothing filed before this locks unexpectedly. guard_goal_frozen fires first and
-- is unchanged; a write has to pass both.
create or replace function public.guard_goal_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if (select auth.uid()) is not null then
      new.created_by := private.auth_profile_id();
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE'
     and (select auth.uid()) is not null
     and new.created_by is distinct from old.created_by
     and not (new.created_by is null
              and old.created_by is not null
              and not exists (select 1 from public.profiles p where p.id = old.created_by)) then
    new.created_by := old.created_by;
  end if;

  if (select auth.uid()) is null
     or private.can_manage_company(old.company_id)
     or old.created_by is null
     or old.created_by = old.employee_id then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'This goal was set for you, so only an admin can remove it.'
      using errcode = 'check_violation';
  end if;
  if row(new.title, new.description, new.kind, new.is_focus, new.cycle_id, new.scope, new.year)
     is distinct from
     row(old.title, old.description, old.kind, old.is_focus, old.cycle_id, old.scope, old.year) then
    raise exception 'This goal was set for you, so only an admin can change what it is. You can still move its completion, tick its steps and add notes.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_goal_owner() from public, anon, authenticated;

drop trigger if exists goals_guard_owner on public.goals;
create trigger goals_guard_owner
  before insert or update or delete on public.goals
  for each row execute function public.guard_goal_owner();

-- ---------------------------------------------------------------------------------------
-- 7. company_divisions
-- ---------------------------------------------------------------------------------------

create table if not exists public.company_divisions (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  name        text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint company_divisions_name_check check (btrim(name) <> ''),
  constraint company_divisions_name_key unique (company_id, name)
);

drop trigger if exists company_divisions_pin_company on public.company_divisions;
create trigger company_divisions_pin_company
  before update on public.company_divisions
  for each row execute function public.pin_company_id();

drop trigger if exists company_divisions_set_updated_at on public.company_divisions;
create trigger company_divisions_set_updated_at
  before update on public.company_divisions
  for each row execute function public.set_updated_at();

alter table public.company_divisions enable row level security;
revoke all on public.company_divisions from anon, authenticated;
grant select, insert, update, delete on public.company_divisions to authenticated;

drop policy if exists "Members read divisions" on public.company_divisions;
create policy "Members read divisions"
  on public.company_divisions for select to authenticated
  using (private.is_company_member(company_id));

drop policy if exists "Admins add divisions" on public.company_divisions;
create policy "Admins add divisions"
  on public.company_divisions for insert to authenticated
  with check (private.can_manage_company(company_id));

drop policy if exists "Admins change divisions" on public.company_divisions;
create policy "Admins change divisions"
  on public.company_divisions for update to authenticated
  using (private.can_manage_company(company_id))
  with check (private.can_manage_company(company_id));

drop policy if exists "Admins remove divisions" on public.company_divisions;
create policy "Admins remove divisions"
  on public.company_divisions for delete to authenticated
  using (private.can_manage_company(company_id));

-- ---------------------------------------------------------------------------------------
-- 8. A person's division, and who sees the split
-- ---------------------------------------------------------------------------------------

alter table public.profiles
  add column if not exists division_id uuid references public.company_divisions (id) on delete set null;
alter table public.profiles
  add column if not exists can_view_divisions boolean not null default false;

create index if not exists profiles_division_id_idx on public.profiles (division_id);

-- A person's division is their own company's, and neither it nor the right to see the split
-- travels: a move to another company clears both, as guard_job_role clears the job role. BEFORE,
-- and named to fire ahead of guard_profile_fields, which lets only Rococo and the system move a
-- person anyway.
create or replace function public.guard_profile_division()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.company_id is distinct from old.company_id then
    new.division_id := null;
    new.can_view_divisions := false;
  end if;
  if new.division_id is not null
     and not exists (
       select 1 from public.company_divisions d
        where d.id = new.division_id and d.company_id = new.company_id
     ) then
    raise exception 'That division belongs to another company.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_profile_division() from public, anon, authenticated;

drop trigger if exists profiles_guard_division on public.profiles;
create trigger profiles_guard_division
  before insert or update on public.profiles
  for each row execute function public.guard_profile_division();

-- The 0033 body with three additions: the foreign key clearing a division that is being deleted
-- passes like the job role and manager clears; in the company-admin branch only an owner changes
-- can_view_divisions; and in the person's own branch can_view_divisions is refused and
-- division_id joins the employment details only admins set.
create or replace function public.guard_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_probe   public.profiles%rowtype;
  v_cleared boolean := false;
begin
  new.email := old.email;
  if (select auth.uid()) is null or private.is_rococo_admin() then
    return new;
  end if;

  v_probe := new;
  v_probe.updated_at := old.updated_at;
  if new.reports_to is null
     and old.reports_to is not null
     and not exists (select 1 from public.profiles m where m.id = old.reports_to) then
    v_probe.reports_to := old.reports_to;
    v_cleared := true;
  end if;
  if new.job_role_id is null
     and old.job_role_id is not null
     and not exists (select 1 from public.job_roles j where j.id = old.job_role_id) then
    v_probe.job_role_id := old.job_role_id;
    v_cleared := true;
  end if;
  if new.division_id is null
     and old.division_id is not null
     and not exists (select 1 from public.company_divisions d where d.id = old.division_id) then
    v_probe.division_id := old.division_id;
    v_cleared := true;
  end if;
  if v_cleared and v_probe is not distinct from old then
    return new;
  end if;

  if old.is_rococo_admin then
    raise exception 'A Rococo admin''s profile can only be changed by Rococo.';
  end if;

  if old.user_id = (select auth.uid()) and not old.is_active then
    raise exception 'This account is inactive, so its profile cannot be changed.';
  end if;

  if new.user_id is distinct from old.user_id then
    raise exception 'An account link is set when the person signs in and cannot be changed here.';
  end if;

  if new.company_id is distinct from old.company_id
     or new.is_rococo_admin is distinct from old.is_rococo_admin then
    raise exception 'Only Rococo admins can change company assignment or Rococo access.';
  end if;

  if private.is_company_admin() and old.company_id = private.auth_company_id() then
    if old.user_id = (select auth.uid())
       and (new.role is distinct from old.role or new.is_active is distinct from old.is_active) then
      raise exception 'You cannot change your own role or deactivate your own account.';
    end if;
    if new.role is distinct from old.role then
      if new.role = 'owner' and not private.is_company_owner() then
        raise exception 'Only an owner or Rococo can make someone an owner.';
      end if;
      if private.role_rank(new.role) > private.auth_role_rank() then
        raise exception 'You cannot grant a role above your own.';
      end if;
    end if;
    if (new.role is distinct from old.role or new.is_active is distinct from old.is_active)
       and private.role_rank(old.role) > private.auth_role_rank() then
      raise exception 'You cannot change the role or access of someone ranked above you.';
    end if;
    if new.can_view_divisions is distinct from old.can_view_divisions
       and not private.is_company_owner() then
      raise exception 'Only an owner or Rococo can choose who sees the divisions.';
    end if;
    return new;
  end if;

  if old.user_id is distinct from (select auth.uid()) then
    raise exception 'You can only edit your own profile.';
  end if;
  if new.role is distinct from old.role or new.is_active is distinct from old.is_active then
    raise exception 'Only admins can change roles or deactivate accounts.';
  end if;
  if new.can_view_divisions is distinct from old.can_view_divisions then
    raise exception 'Only an owner or Rococo can choose who sees the divisions.';
  end if;
  if new.hire_date is distinct from old.hire_date
     or new.department is distinct from old.department
     or new.reports_to is distinct from old.reports_to
     or new.job_role_id is distinct from old.job_role_id
     or new.division_id is distinct from old.division_id then
    raise exception 'Only admins can change employment details.';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_profile_fields() from public, anon, authenticated;

-- The 0033 body with one addition: a roster row added with the split already visible is an owner's
-- or Rococo's to add, the same rule as changing it.
create or replace function public.guard_profile_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or private.is_rococo_admin() then
    return new;
  end if;
  if new.role = 'owner' and not private.is_company_owner() then
    raise exception 'Only an owner or Rococo can make someone an owner.';
  end if;
  if private.role_rank(new.role) > private.auth_role_rank() then
    raise exception 'You cannot grant a role above your own.';
  end if;
  if new.can_view_divisions and not private.is_company_owner() then
    raise exception 'Only an owner or Rococo can choose who sees the divisions.';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_profile_insert() from public, anon, authenticated;

-- Who sees the split is access, so it joins the columns 0025 records for Rococo.
drop trigger if exists profiles_audit on public.profiles;
create trigger profiles_audit
  after insert or update or delete on public.profiles
  for each row execute function private.audit_change('role', 'is_active', 'is_rococo_admin', 'company_id', 'reports_to', 'job_role_id', 'can_view_divisions');

-- ---------------------------------------------------------------------------------------
-- 9. project_assignments
-- ---------------------------------------------------------------------------------------

create table if not exists public.project_assignments (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  project_id   uuid not null references public.projects (id) on delete cascade,
  employee_id  uuid not null references public.profiles (id) on delete cascade,
  -- What they do on it, in the company's words ("Project manager"). Optional.
  role         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint project_assignments_role_check check (role is null or length(role) <= 100),
  constraint project_assignments_key unique (project_id, employee_id)
);

create index if not exists project_assignments_employee_id_idx on public.project_assignments (employee_id);
create index if not exists project_assignments_company_id_idx on public.project_assignments (company_id);

-- The project decides the company, and the person has to be on that company's team.
create or replace function public.stamp_project_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select pr.company_id into new.company_id from public.projects pr where pr.id = new.project_id;
  if new.company_id is null then
    raise exception 'That project does not exist.';
  end if;
  if tg_op = 'INSERT'
     or new.employee_id is distinct from old.employee_id
     or new.project_id is distinct from old.project_id then
    if not exists (
      select 1 from public.profiles p where p.id = new.employee_id and p.company_id = new.company_id
    ) then
      raise exception 'That person is not on this company''s team.'
        using errcode = 'check_violation';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
  end if;
  new.role := nullif(btrim(new.role), '');
  return new;
end;
$$;
revoke execute on function public.stamp_project_assignment() from public, anon, authenticated;

drop trigger if exists project_assignments_stamp on public.project_assignments;
create trigger project_assignments_stamp
  before insert or update on public.project_assignments
  for each row execute function public.stamp_project_assignment();

drop trigger if exists project_assignments_set_updated_at on public.project_assignments;
create trigger project_assignments_set_updated_at
  before update on public.project_assignments
  for each row execute function public.set_updated_at();

alter table public.project_assignments enable row level security;
revoke all on public.project_assignments from anon, authenticated;
grant select, insert, update, delete on public.project_assignments to authenticated;

drop policy if exists "Members read project assignments" on public.project_assignments;
create policy "Members read project assignments"
  on public.project_assignments for select to authenticated
  using (private.is_company_member(company_id));

drop policy if exists "Admins assign projects" on public.project_assignments;
create policy "Admins assign projects"
  on public.project_assignments for insert to authenticated
  with check (private.can_manage_company(company_id));

drop policy if exists "Admins change project assignments" on public.project_assignments;
create policy "Admins change project assignments"
  on public.project_assignments for update to authenticated
  using (private.can_manage_company(company_id))
  with check (private.can_manage_company(company_id));

drop policy if exists "Admins unassign projects" on public.project_assignments;
create policy "Admins unassign projects"
  on public.project_assignments for delete to authenticated
  using (private.can_manage_company(company_id));

-- A person who moves company comes off the old company's projects. Every path that changes a
-- person's company runs this, move_employee_company (left alone) included.
create or replace function public.clear_project_assignments_on_move()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.project_assignments
   where employee_id = new.id
     and company_id is distinct from new.company_id;
  return null;
end;
$$;
revoke execute on function public.clear_project_assignments_on_move() from public, anon, authenticated;

drop trigger if exists profiles_move_clears_project_assignments on public.profiles;
create trigger profiles_move_clears_project_assignments
  after update of company_id on public.profiles
  for each row
  when (old.company_id is distinct from new.company_id)
  execute function public.clear_project_assignments_on_move();
