-- 0017_impact_scores.sql
-- Impact scores live on the person, not inside a review. Paste after 0016; idempotent.
--
-- Until now a rating existed only as a review_scores row attached to one review, so the number
-- a manager carries in their head about a person all quarter had nowhere to live until the
-- meeting, and nothing outside the meeting could move it. This migration does four things.
--
--   1. impact_scores: one row per person per criterion, the working copy. Set and trued up on
--      the profile by an admin; read live by an open review. History is the frozen copy on each
--      completed review (3), so there is no log table and every screen that scores a completed
--      review from review_scores keeps working unchanged.
--   2. Backfill from the newest rated review_scores row per person and criterion, any status,
--      so nobody's numbers vanish the day this lands and a review rated under the old flow
--      becomes that person's starting score.
--   3. Freeze on completion: when a review's status becomes 'complete', the person's current
--      impact ratings are copied into that review's review_scores rows, notes untouched. Done in
--      the database in one statement, so a closed tab cannot leave a review half frozen. Copying
--      rows is not scoring math; lib/gsr/scoring.ts stays the only implementation of the
--      arithmetic. Re-completing a reopened review freezes again, overwriting: the profile is the
--      working copy and the review reports what it was signed off with.
--   4. A third scoring type, 'deliverables_module': a pillar scored from the deliverables module
--      (categories, headings, tasks) rather than from line items typed into the review. The app
--      writes the module's target and actual as one line item on Mark complete, before the
--      status flips, so re-rating a task mid-review moves nothing on the review until sign-off.

-- 1. impact_scores ---------------------------------------------------------------------------

create table if not exists public.impact_scores (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  employee_id   uuid not null references public.profiles (id) on delete cascade,
  pillar_id     uuid not null references public.gsr_pillars (id) on delete cascade,
  criterion_id  uuid not null references public.gsr_criteria (id) on delete cascade,
  rating        numeric(4,2) not null,
  note          text,
  set_by        uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint impact_scores_employee_criterion_key unique (employee_id, criterion_id)
);

create index if not exists impact_scores_employee_id_idx on public.impact_scores (employee_id);
create index if not exists impact_scores_company_id_idx on public.impact_scores (company_id);

grant select, insert, update, delete on public.impact_scores to authenticated;

-- company_id from the person, pillar_id from the criterion, and the two must agree: a criterion
-- belongs to a company (0003), so a person only ever carries a score on their own company's
-- criteria. The rating is checked against the pillar's scale here because a CHECK constraint
-- cannot read another table. Runs as a BEFORE trigger, so the policies below see the stamped row.
create or replace function public.inherit_impact_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pillar_id uuid;
  v_criterion_company uuid;
  v_scale integer;
begin
  select company_id into new.company_id from public.profiles where id = new.employee_id;
  if new.company_id is null then
    raise exception 'This person is not placed with a company yet.';
  end if;
  select c.pillar_id, c.company_id, p.rating_scale_max
    into v_pillar_id, v_criterion_company, v_scale
    from public.gsr_criteria c
    join public.gsr_pillars p on p.id = c.pillar_id
   where c.id = new.criterion_id;
  if v_pillar_id is null then
    raise exception 'That criterion does not exist.';
  end if;
  if v_criterion_company is distinct from new.company_id then
    raise exception 'That criterion belongs to another company.';
  end if;
  new.pillar_id := v_pillar_id;
  if new.rating < 1 or new.rating > v_scale then
    raise exception 'The rating must be between 1 and %.', v_scale;
  end if;
  return new;
end;
$$;
revoke execute on function public.inherit_impact_score() from public, anon, authenticated;

drop trigger if exists impact_scores_inherit on public.impact_scores;
create trigger impact_scores_inherit
  before insert or update on public.impact_scores
  for each row execute function public.inherit_impact_score();

drop trigger if exists impact_scores_set_updated_at on public.impact_scores;
create trigger impact_scores_set_updated_at
  before update on public.impact_scores
  for each row execute function public.set_updated_at();

alter table public.impact_scores enable row level security;

-- A person reads their own; admins manage their company's. There is no employee write path, so
-- nobody can move their own number.
drop policy if exists "Own impact scores and admins read" on public.impact_scores;
create policy "Own impact scores and admins read"
  on public.impact_scores for select to authenticated
  using (employee_id = private.auth_profile_id() or private.can_manage_company(company_id));
drop policy if exists "Admins set impact scores" on public.impact_scores;
create policy "Admins set impact scores"
  on public.impact_scores for insert to authenticated
  with check (private.can_manage_company(company_id));
drop policy if exists "Admins update impact scores" on public.impact_scores;
create policy "Admins update impact scores"
  on public.impact_scores for update to authenticated
  using (private.can_manage_company(company_id)) with check (private.can_manage_company(company_id));
drop policy if exists "Admins delete impact scores" on public.impact_scores;
create policy "Admins delete impact scores"
  on public.impact_scores for delete to authenticated
  using (private.can_manage_company(company_id));

-- Moving a person to another company deletes their working copy rather than restamping it: a
-- criterion belongs to a company, so the rows would point at criteria the new company cannot
-- read. Their frozen reviews stay with the old company, as 0014 established for reviews.
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
    delete from public.impact_scores where employee_id = new.id;
  end if;
  return new;
end;
$$;
revoke execute on function public.move_employee_company() from public, anon, authenticated;

-- 2. Backfill -------------------------------------------------------------------------------
-- The newest rated row per person and criterion, by the period the review covers. Rows the
-- inherit trigger would refuse are left out rather than aborting the migration: a rating over
-- the pillar's current scale, a zero, or a review from a company the person has since left.

insert into public.impact_scores (company_id, employee_id, pillar_id, criterion_id, rating, note, set_by)
select distinct on (r.employee_id, s.criterion_id)
       r.company_id, r.employee_id, s.pillar_id, s.criterion_id, s.rating, null, r.reviewer_id
  from public.review_scores s
  join public.reviews r        on r.id = s.review_id
  join public.review_cycles rc on rc.id = r.cycle_id
  join public.gsr_criteria c   on c.id = s.criterion_id
  join public.gsr_pillars p    on p.id = s.pillar_id
  join public.profiles pr      on pr.id = r.employee_id and pr.company_id = r.company_id
 where s.criterion_id is not null
   and s.rating is not null
   and s.rating between 1 and p.rating_scale_max
 order by r.employee_id, s.criterion_id, rc.period_start desc, s.updated_at desc
on conflict (employee_id, criterion_id) do nothing;

-- 3. Freeze on completion ------------------------------------------------------------------
-- Fires after guard_review_employee_fields (a BEFORE trigger) has already refused a status
-- change from anyone but an admin, so this opens no new write path. Only active criteria of
-- active rating pillars are copied; a retired criterion stops travelling with the person.

create or replace function public.freeze_review_ratings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'complete' and old.status is distinct from 'complete' then
    insert into public.review_scores (review_id, company_id, pillar_id, criterion_id, rating)
    select new.id, new.company_id, i.pillar_id, i.criterion_id, i.rating
      from public.impact_scores i
      join public.gsr_criteria c on c.id = i.criterion_id and c.is_active
      join public.gsr_pillars p  on p.id = i.pillar_id and p.is_active and p.scoring_type = 'rating'
     where i.employee_id = new.employee_id
       and i.company_id = new.company_id
    on conflict (review_id, criterion_id) where criterion_id is not null
    do update set rating = excluded.rating;
  end if;
  return new;
end;
$$;
revoke execute on function public.freeze_review_ratings() from public, anon, authenticated;

drop trigger if exists reviews_freeze_ratings on public.reviews;
create trigger reviews_freeze_ratings
  after update of status on public.reviews
  for each row execute function public.freeze_review_ratings();

-- 4. deliverables_module --------------------------------------------------------------------

alter table public.gsr_pillars drop constraint if exists gsr_pillars_scoring_type_check;
alter table public.gsr_pillars add constraint gsr_pillars_scoring_type_check
  check (scoring_type in ('rating', 'deliverables', 'deliverables_module'));
