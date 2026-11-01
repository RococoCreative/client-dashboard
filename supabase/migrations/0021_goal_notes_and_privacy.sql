-- 0021_goal_notes_and_privacy.sql
-- A goal's notes become a dated log, a yearly goal's private half moves off the shared row, and a
-- goal can be a BHAG. Paste after 0020; idempotent.
--
-- Four changes, the last of which is what keeps the second one true:
--
--   1. goal_notes: one row per note, dated, with its author. Replaces the single progress_notes
--      box, which was overwritten on every save and so kept no history. Information only: nothing
--      scores a note. A monthly GSR goal's notes are the record the meeting works from, so the
--      person and their admins read them; a yearly or BHAG goal's notes are the person's alone.
--   2. goal_private: a yearly or BHAG goal's action steps, readable by its owner only. The goal
--      row itself (title, description, kind, period, completion) stays readable by admins, who
--      see it on the profile and on every quarterly review. Row level security works on rows, so
--      the only way to keep a value from an admin who can read the row is to move it to a row they
--      cannot read.
--   3. goals.scope gains 'bhag': the big goal three to five years out. It has no year and never
--      settles; it stays open until it reaches 100.
--   4. A guard keeps private content off the shared row for good: a yearly or BHAG goal carries
--      no action steps there, no goal carries progress_notes any more, and no goal crosses between
--      the months and the years, because which side a goal is on decides who reads its notes.
--
-- The existing notes and yearly steps move across in section 5. progress_notes stays as a column,
-- emptied, so a tab left open from before this deploy still loads; a later migration drops it.

-- ---------------------------------------------------------------------------------------
-- 1. BHAG
-- ---------------------------------------------------------------------------------------

alter table public.goals drop constraint if exists goals_scope_check;
alter table public.goals add constraint goals_scope_check check (scope in ('cycle', 'year', 'bhag'));

-- ---------------------------------------------------------------------------------------
-- 2. goal_notes
-- ---------------------------------------------------------------------------------------

create table if not exists public.goal_notes (
  id           uuid primary key default gen_random_uuid(),
  goal_id      uuid not null references public.goals (id) on delete cascade,
  company_id   uuid not null references public.companies (id) on delete cascade,
  employee_id  uuid not null references public.profiles (id) on delete cascade,
  -- Who wrote it. Null for a note carried over from progress_notes, which kept no author.
  author_id    uuid references public.profiles (id) on delete set null,
  body         text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint goal_notes_body_check check (length(btrim(body)) > 0)
);

create index if not exists goal_notes_goal_id_idx on public.goal_notes (goal_id, created_at);
create index if not exists goal_notes_employee_id_idx on public.goal_notes (employee_id);
create index if not exists goal_notes_company_id_idx on public.goal_notes (company_id);

grant select, insert, update, delete on public.goal_notes to authenticated;
revoke all on public.goal_notes from anon;

-- The goal decides the company and the person, the session decides the author, and the clock
-- decides the date stamp, whatever the caller sent. An edit keeps the note on its goal, with its
-- author and its date; only the text and updated_at move. BEFORE, so the policies see the
-- stamped row.
create or replace function public.stamp_goal_note()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.goal_id    := old.goal_id;
    new.author_id  := old.author_id;
    new.created_at := old.created_at;
  else
    new.author_id  := private.auth_profile_id();
    new.created_at := now();
    new.updated_at := now();
  end if;
  select g.company_id, g.employee_id
    into new.company_id, new.employee_id
    from public.goals g
   where g.id = new.goal_id;
  if new.company_id is null then
    raise exception 'That goal does not exist.';
  end if;
  return new;
end;
$$;
revoke execute on function public.stamp_goal_note() from public, anon, authenticated;

-- A closed month is a snapshot, notes included: the rule guard_goal_frozen keeps for goals. Both
-- the goal a note is on and, on an update, the goal it names are checked.
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
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_goal_note_frozen() from public, anon, authenticated;

alter table public.goal_notes enable row level security;

-- Read: the person always. An admin only on a monthly GSR goal, the one the meeting works from;
-- a yearly or BHAG goal's notes are the person's alone.
drop policy if exists "Owners read goal notes, admins read GSR notes" on public.goal_notes;
create policy "Owners read goal notes, admins read GSR notes"
  on public.goal_notes for select to authenticated
  using (
    employee_id = private.auth_profile_id()
    or (
      private.can_manage_company(company_id)
      and exists (select 1 from public.goals g where g.id = goal_notes.goal_id and g.scope = 'cycle')
    )
  );

-- Add: anyone who can read the goal's notes, as themselves.
drop policy if exists "Owners and admins add goal notes" on public.goal_notes;
create policy "Owners and admins add goal notes"
  on public.goal_notes for insert to authenticated
  with check (
    author_id = private.auth_profile_id()
    and (
      (employee_id = private.auth_profile_id() and company_id = private.auth_company_id())
      or (
        private.can_manage_company(company_id)
        and exists (select 1 from public.goals g where g.id = goal_notes.goal_id and g.scope = 'cycle')
      )
    )
  );

-- Edit and delete: the author. A note carried over from progress_notes has no author and is the
-- person's own.
drop policy if exists "Authors edit their goal notes" on public.goal_notes;
create policy "Authors edit their goal notes"
  on public.goal_notes for update to authenticated
  using (author_id = private.auth_profile_id() or (author_id is null and employee_id = private.auth_profile_id()))
  with check (author_id = private.auth_profile_id() or (author_id is null and employee_id = private.auth_profile_id()));

drop policy if exists "Authors delete their goal notes" on public.goal_notes;
create policy "Authors delete their goal notes"
  on public.goal_notes for delete to authenticated
  using (author_id = private.auth_profile_id() or (author_id is null and employee_id = private.auth_profile_id()));

-- ---------------------------------------------------------------------------------------
-- 3. goal_private
-- ---------------------------------------------------------------------------------------

create table if not exists public.goal_private (
  goal_id      uuid primary key references public.goals (id) on delete cascade,
  company_id   uuid not null references public.companies (id) on delete cascade,
  employee_id  uuid not null references public.profiles (id) on delete cascade,
  -- [{ "text": "...", "done": false }, ...], the same shape goals.action_steps has.
  action_steps jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint goal_private_action_steps_check check (jsonb_typeof(action_steps) = 'array')
);

create index if not exists goal_private_employee_id_idx on public.goal_private (employee_id);

grant select, insert, update, delete on public.goal_private to authenticated;
revoke all on public.goal_private from anon;

-- Company and person from the goal. A monthly goal keeps its steps on the goal, where the review
-- reads them, so a private row is only ever the private half of a yearly or BHAG goal.
create or replace function public.stamp_goal_private()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope text;
begin
  if tg_op = 'UPDATE' then
    new.goal_id := old.goal_id;
  end if;
  select g.company_id, g.employee_id, g.scope
    into new.company_id, new.employee_id, v_scope
    from public.goals g
   where g.id = new.goal_id;
  if v_scope is null then
    raise exception 'That goal does not exist.';
  end if;
  if v_scope = 'cycle' then
    raise exception 'A monthly goal keeps its action steps on the goal, where the review reads them.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.stamp_goal_private() from public, anon, authenticated;

alter table public.goal_private enable row level security;

-- The owner, and only the owner, for every operation. There is no admin branch, on purpose.
drop policy if exists "Owners read their private goal steps" on public.goal_private;
create policy "Owners read their private goal steps"
  on public.goal_private for select to authenticated
  using (employee_id = private.auth_profile_id());

drop policy if exists "Owners add their private goal steps" on public.goal_private;
create policy "Owners add their private goal steps"
  on public.goal_private for insert to authenticated
  with check (employee_id = private.auth_profile_id() and company_id = private.auth_company_id());

drop policy if exists "Owners update their private goal steps" on public.goal_private;
create policy "Owners update their private goal steps"
  on public.goal_private for update to authenticated
  using (employee_id = private.auth_profile_id())
  with check (employee_id = private.auth_profile_id() and company_id = private.auth_company_id());

drop policy if exists "Owners delete their private goal steps" on public.goal_private;
create policy "Owners delete their private goal steps"
  on public.goal_private for delete to authenticated
  using (employee_id = private.auth_profile_id());

-- ---------------------------------------------------------------------------------------
-- 4. A person's notes and private steps travel with their yearly goals
-- ---------------------------------------------------------------------------------------
-- Same as 0018, plus the two new tables. Monthly goals stay with the company the month was in,
-- and their notes stay with them.

create or replace function public.move_employee_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.company_id is distinct from old.company_id and new.company_id is not null then
    update public.employee_kpis        set company_id = new.company_id where employee_id = new.id;
    update public.employee_financials  set company_id = new.company_id where employee_id = new.id;
    update public.compensation_items   set company_id = new.company_id where employee_id = new.id;
    update public.goals                set company_id = new.company_id where employee_id = new.id and cycle_id is null;
    update public.goal_notes n
       set company_id = new.company_id
      from public.goals g
     where g.id = n.goal_id and g.employee_id = new.id and g.cycle_id is null;
    update public.goal_private         set company_id = new.company_id where employee_id = new.id;
    update public.employee_deliverables
       set company_id = new.company_id, category_id = null
     where employee_id = new.id;
    update public.deliverable_tasks    set company_id = new.company_id where employee_id = new.id;
    delete from public.impact_scores where employee_id = new.id;
  end if;
  return new;
end;
$$;
revoke execute on function public.move_employee_company() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 5. Move what is already there
-- ---------------------------------------------------------------------------------------
-- The stamping and freeze triggers on the new tables are dropped while the rows move, so the
-- carried notes keep the date of the goal's last update and a closed month's notes come across
-- too. Each insert skips what is already there, and the goal rows are only cleared once their
-- content has a home, so a second run finds nothing left to do.

drop trigger if exists goal_private_stamp on public.goal_private;
insert into public.goal_private (goal_id, company_id, employee_id, action_steps, created_at, updated_at)
select g.id, g.company_id, g.employee_id, g.action_steps, g.created_at, g.updated_at
  from public.goals g
 where g.scope <> 'cycle'
   and jsonb_typeof(g.action_steps) = 'array'
   and jsonb_array_length(g.action_steps) > 0
on conflict (goal_id) do nothing;

drop trigger if exists goal_notes_stamp on public.goal_notes;
drop trigger if exists goal_notes_guard_frozen on public.goal_notes;
insert into public.goal_notes (goal_id, company_id, employee_id, author_id, body, created_at, updated_at)
select g.id, g.company_id, g.employee_id, null, btrim(g.progress_notes), g.updated_at, g.updated_at
  from public.goals g
 where g.progress_notes is not null
   and btrim(g.progress_notes) <> ''
   and not exists (select 1 from public.goal_notes n where n.goal_id = g.id and n.author_id is null);

-- Clearing the shared row is not an edit anybody made, so it leaves updated_at, the company
-- stamp and a closed month's freeze alone.
alter table public.goals disable trigger goals_guard_frozen;
alter table public.goals disable trigger goals_inherit_company;
alter table public.goals disable trigger goals_set_updated_at;
update public.goals set progress_notes = null where progress_notes is not null;
update public.goals set action_steps = '[]'::jsonb where scope <> 'cycle' and action_steps <> '[]'::jsonb;
alter table public.goals enable trigger goals_set_updated_at;
alter table public.goals enable trigger goals_inherit_company;
alter table public.goals enable trigger goals_guard_frozen;

-- ---------------------------------------------------------------------------------------
-- 6. Triggers
-- ---------------------------------------------------------------------------------------

create trigger goal_notes_stamp
  before insert or update on public.goal_notes
  for each row execute function public.stamp_goal_note();
create trigger goal_notes_guard_frozen
  before insert or update or delete on public.goal_notes
  for each row execute function public.guard_goal_note_frozen();
drop trigger if exists goal_notes_set_updated_at on public.goal_notes;
create trigger goal_notes_set_updated_at
  before update on public.goal_notes
  for each row execute function public.set_updated_at();

create trigger goal_private_stamp
  before insert or update on public.goal_private
  for each row execute function public.stamp_goal_private();
drop trigger if exists goal_private_set_updated_at on public.goal_private;
create trigger goal_private_set_updated_at
  before update on public.goal_private
  for each row execute function public.set_updated_at();

-- The shared row stays shared. Raised rather than silently stripped, so a tab left open from
-- before this deploy says what happened instead of losing what was typed.
create or replace function public.guard_goal_private_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.progress_notes is not null then
    raise exception 'Notes now live in each goal''s notes log. Reload the page to add one.'
      using errcode = 'check_violation';
  end if;
  if new.scope <> 'cycle' and new.action_steps <> '[]'::jsonb then
    raise exception 'A yearly goal''s action steps are private to its owner now. Reload the page to add them.'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and (old.scope = 'cycle') <> (new.scope = 'cycle') then
    raise exception 'A monthly goal stays in its month, and a yearly goal stays out of the months.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_goal_private_fields() from public, anon, authenticated;

drop trigger if exists goals_guard_private_fields on public.goals;
create trigger goals_guard_private_fields
  before insert or update on public.goals
  for each row execute function public.guard_goal_private_fields();
