-- 0003_gsr.sql
-- Goal Setting and Review (GSR): the configurable performance review system. Paste after
-- 0002; idempotent and safe to re-run.
--
-- The scoring model is the one Austin built for Klasik, made configurable. A company
-- defines PILLARS, each with a weight (percent of the overall score) and a scoring type:
--   'rating'        the reviewer rates each of the pillar's CRITERIA on a 1..N scale
--                   (Klasik: Brand Impact and Character & Values, five criteria each, 1..5)
--   'deliverables'  the reviewer enters target vs actual line items and the pillar scores
--                   the average achievement, each item capped at 100% (Klasik: Deliverables)
-- Overall = sum(pillar score * weight) / sum(weights). The arithmetic lives in
-- src/lib/gsr/scoring.ts (pure, tested) and is never duplicated in SQL.
--
-- A REVIEW CYCLE is one review period for one company (monthly, quarterly, whatever they
-- run). Every employee gets one REVIEW per cycle, which holds the REVIEW SCORES and the
-- manager's feedback. GOALS belong to an employee (optionally tied to a cycle) and carry
-- action steps; employees own their goals, admins own reviews and scores.

set check_function_bodies = off;

-- gsr_pillars --------------------------------------------------------------------------

create table if not exists public.gsr_pillars (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  name              text not null,
  description       text,
  weight            numeric(5,2) not null default 0,
  scoring_type      text not null default 'rating',
  rating_scale_max  integer not null default 5,
  sort_order        integer not null default 0,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint gsr_pillars_weight_check check (weight >= 0 and weight <= 100),
  constraint gsr_pillars_scoring_type_check check (scoring_type in ('rating', 'deliverables')),
  constraint gsr_pillars_scale_check check (rating_scale_max between 2 and 10)
);

create index if not exists gsr_pillars_company_id_idx on public.gsr_pillars (company_id);

-- gsr_criteria -------------------------------------------------------------------------
-- The named things a 'rating' pillar rates (Klasik: DNA, Identity, Mission ...).

create table if not exists public.gsr_criteria (
  id           uuid primary key default gen_random_uuid(),
  pillar_id    uuid not null references public.gsr_pillars (id) on delete cascade,
  company_id   uuid not null references public.companies (id) on delete cascade,
  name         text not null,
  description  text,
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists gsr_criteria_pillar_id_idx on public.gsr_criteria (pillar_id);
create index if not exists gsr_criteria_company_id_idx on public.gsr_criteria (company_id);

-- review_cycles ------------------------------------------------------------------------

create table if not exists public.review_cycles (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  name               text not null,
  cadence            text not null default 'monthly',
  period_start       date not null,
  period_end         date not null,
  -- Optional company-wide focus for the period (Klasik's "monthly theme").
  theme              text,
  theme_description  text,
  status             text not null default 'open',
  created_by         uuid references auth.users (id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint review_cycles_cadence_check
    check (cadence in ('monthly', 'quarterly', 'semiannual', 'annual', 'custom')),
  constraint review_cycles_period_check check (period_end >= period_start),
  constraint review_cycles_status_check check (status in ('open', 'closed'))
);

create index if not exists review_cycles_company_id_idx on public.review_cycles (company_id, period_start desc);

-- reviews ------------------------------------------------------------------------------

create table if not exists public.reviews (
  id                   uuid primary key default gen_random_uuid(),
  cycle_id             uuid not null references public.review_cycles (id) on delete cascade,
  company_id           uuid not null references public.companies (id) on delete cascade,
  employee_id          uuid not null references public.profiles (id) on delete cascade,
  status               text not null default 'not_started',
  -- How the previous period's goals landed, in the reviewer's judgment.
  previous_status      text,
  manager_feedback     text,
  peer_feedback        text,
  client_feedback      text,
  -- The one field an employee may write on their own review.
  employee_reflection  text,
  reviewer_id          uuid references public.profiles (id) on delete set null,
  completed_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint reviews_status_check check (status in ('not_started', 'in_progress', 'complete')),
  constraint reviews_previous_status_check
    check (previous_status is null or previous_status in ('hit', 'partial', 'miss', 'pending')),
  constraint reviews_cycle_employee_key unique (cycle_id, employee_id)
);

create index if not exists reviews_company_id_idx on public.reviews (company_id);
create index if not exists reviews_employee_id_idx on public.reviews (employee_id);

-- review_scores ------------------------------------------------------------------------
-- One row per rated criterion (rating pillars: criterion_id + rating) or per deliverable
-- line item (deliverables pillars: label + target + actual).

create table if not exists public.review_scores (
  id            uuid primary key default gen_random_uuid(),
  review_id     uuid not null references public.reviews (id) on delete cascade,
  company_id    uuid not null references public.companies (id) on delete cascade,
  pillar_id     uuid not null references public.gsr_pillars (id) on delete cascade,
  criterion_id  uuid references public.gsr_criteria (id) on delete cascade,
  label         text,
  rating        numeric(4,2),
  target        numeric(12,2),
  actual        numeric(12,2),
  notes         text,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint review_scores_rating_check check (rating is null or rating >= 0),
  constraint review_scores_target_check check (target is null or target >= 0),
  constraint review_scores_actual_check check (actual is null or actual >= 0)
);

create index if not exists review_scores_review_id_idx on public.review_scores (review_id);
create unique index if not exists review_scores_review_criterion_key
  on public.review_scores (review_id, criterion_id) where criterion_id is not null;

-- goals --------------------------------------------------------------------------------

create table if not exists public.goals (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  employee_id     uuid not null references public.profiles (id) on delete cascade,
  cycle_id        uuid references public.review_cycles (id) on delete set null,
  kind            text not null default 'professional',
  title           text not null,
  description     text,
  status          text not null default 'not_started',
  -- [{ "text": "...", "done": false }, ...]
  action_steps    jsonb not null default '[]'::jsonb,
  progress_notes  text,
  sort_order      integer not null default 0,
  created_by      uuid references auth.users (id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint goals_kind_check check (kind in ('professional', 'personal', 'role')),
  constraint goals_status_check
    check (status in ('not_started', 'in_progress', 'on_track', 'achieved', 'missed')),
  constraint goals_action_steps_check check (jsonb_typeof(action_steps) = 'array')
);

create index if not exists goals_employee_id_idx on public.goals (employee_id);
create index if not exists goals_company_id_idx on public.goals (company_id);

-- company_goals ------------------------------------------------------------------------
-- The handful of shared numbers leadership tracks for the year (Klasik's Company Goals).

create table if not exists public.company_goals (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  year             integer not null,
  name             text not null,
  target_display   text,
  current_display  text,
  target_numeric   numeric(14,2),
  current_numeric  numeric(14,2),
  is_hit           boolean not null default false,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists company_goals_company_year_idx on public.company_goals (company_id, year);

-- Consistency triggers -------------------------------------------------------------------
-- Child rows inherit company_id from their parent so a client can never file a score under
-- the wrong company, and every RLS predicate can stay a cheap column comparison.

create or replace function public.inherit_company_from_pillar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select company_id into new.company_id from public.gsr_pillars where id = new.pillar_id;
  if new.company_id is null then
    raise exception 'Unknown pillar.';
  end if;
  return new;
end;
$$;

create or replace function public.inherit_company_from_cycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select company_id into new.company_id from public.review_cycles where id = new.cycle_id;
  if new.company_id is null then
    raise exception 'Unknown review cycle.';
  end if;
  return new;
end;
$$;

create or replace function public.inherit_company_from_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select company_id into new.company_id from public.reviews where id = new.review_id;
  if new.company_id is null then
    raise exception 'Unknown review.';
  end if;
  return new;
end;
$$;

-- Employees may update exactly one column of their own review: employee_reflection.
create or replace function public.guard_review_employee_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.can_manage_company(old.company_id) then
    return new;
  end if;
  if row(new.cycle_id, new.company_id, new.employee_id, new.status, new.previous_status,
         new.manager_feedback, new.peer_feedback, new.client_feedback, new.reviewer_id,
         new.completed_at)
     is distinct from
     row(old.cycle_id, old.company_id, old.employee_id, old.status, old.previous_status,
         old.manager_feedback, old.peer_feedback, old.client_feedback, old.reviewer_id,
         old.completed_at) then
    raise exception 'Only admins can edit review scores, status, and feedback.';
  end if;
  return new;
end;
$$;

drop trigger if exists gsr_criteria_inherit_company on public.gsr_criteria;
create trigger gsr_criteria_inherit_company
  before insert or update of pillar_id on public.gsr_criteria
  for each row execute function public.inherit_company_from_pillar();

drop trigger if exists reviews_inherit_company on public.reviews;
create trigger reviews_inherit_company
  before insert or update of cycle_id on public.reviews
  for each row execute function public.inherit_company_from_cycle();

drop trigger if exists review_scores_inherit_company on public.review_scores;
create trigger review_scores_inherit_company
  before insert or update of review_id on public.review_scores
  for each row execute function public.inherit_company_from_review();

drop trigger if exists reviews_guard_employee_fields on public.reviews;
create trigger reviews_guard_employee_fields
  before update on public.reviews
  for each row execute function public.guard_review_employee_fields();

drop trigger if exists gsr_pillars_set_updated_at on public.gsr_pillars;
create trigger gsr_pillars_set_updated_at
  before update on public.gsr_pillars for each row execute function public.set_updated_at();
drop trigger if exists gsr_criteria_set_updated_at on public.gsr_criteria;
create trigger gsr_criteria_set_updated_at
  before update on public.gsr_criteria for each row execute function public.set_updated_at();
drop trigger if exists review_cycles_set_updated_at on public.review_cycles;
create trigger review_cycles_set_updated_at
  before update on public.review_cycles for each row execute function public.set_updated_at();
drop trigger if exists reviews_set_updated_at on public.reviews;
create trigger reviews_set_updated_at
  before update on public.reviews for each row execute function public.set_updated_at();
drop trigger if exists review_scores_set_updated_at on public.review_scores;
create trigger review_scores_set_updated_at
  before update on public.review_scores for each row execute function public.set_updated_at();
drop trigger if exists goals_set_updated_at on public.goals;
create trigger goals_set_updated_at
  before update on public.goals for each row execute function public.set_updated_at();
drop trigger if exists company_goals_set_updated_at on public.company_goals;
create trigger company_goals_set_updated_at
  before update on public.company_goals for each row execute function public.set_updated_at();

revoke all on function public.inherit_company_from_pillar() from public, anon, authenticated;
revoke all on function public.inherit_company_from_cycle() from public, anon, authenticated;
revoke all on function public.inherit_company_from_review() from public, anon, authenticated;
revoke all on function public.guard_review_employee_fields() from public, anon, authenticated;

-- Row level security ----------------------------------------------------------------------

alter table public.gsr_pillars    enable row level security;
alter table public.gsr_criteria   enable row level security;
alter table public.review_cycles  enable row level security;
alter table public.reviews        enable row level security;
alter table public.review_scores  enable row level security;
alter table public.goals          enable row level security;
alter table public.company_goals  enable row level security;

-- Configuration and cycles: every member reads, admins write.
drop policy if exists "Members read pillars" on public.gsr_pillars;
create policy "Members read pillars" on public.gsr_pillars for select
  to authenticated using (public.is_company_member(company_id));
drop policy if exists "Admins manage pillars" on public.gsr_pillars;
create policy "Admins manage pillars" on public.gsr_pillars for all
  to authenticated using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

drop policy if exists "Members read criteria" on public.gsr_criteria;
create policy "Members read criteria" on public.gsr_criteria for select
  to authenticated using (public.is_company_member(company_id));
drop policy if exists "Admins manage criteria" on public.gsr_criteria;
create policy "Admins manage criteria" on public.gsr_criteria for all
  to authenticated using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

drop policy if exists "Members read cycles" on public.review_cycles;
create policy "Members read cycles" on public.review_cycles for select
  to authenticated using (public.is_company_member(company_id));
drop policy if exists "Admins manage cycles" on public.review_cycles;
create policy "Admins manage cycles" on public.review_cycles for all
  to authenticated using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

drop policy if exists "Members read company goals" on public.company_goals;
create policy "Members read company goals" on public.company_goals for select
  to authenticated using (public.is_company_member(company_id));
drop policy if exists "Admins manage company goals" on public.company_goals;
create policy "Admins manage company goals" on public.company_goals for all
  to authenticated using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

-- reviews: an employee sees only their own; admins see and write their company's. The
-- employee update path exists for employee_reflection only (guard trigger above).
drop policy if exists "Employees read own reviews, admins read company" on public.reviews;
create policy "Employees read own reviews, admins read company" on public.reviews for select
  to authenticated using (employee_id = auth.uid() or public.can_manage_company(company_id));
drop policy if exists "Admins create reviews" on public.reviews;
create policy "Admins create reviews" on public.reviews for insert
  to authenticated with check (public.can_manage_company(company_id));
drop policy if exists "Employees reflect, admins update reviews" on public.reviews;
create policy "Employees reflect, admins update reviews" on public.reviews for update
  to authenticated
  using (employee_id = auth.uid() or public.can_manage_company(company_id))
  with check (employee_id = auth.uid() or public.can_manage_company(company_id));
drop policy if exists "Admins delete reviews" on public.reviews;
create policy "Admins delete reviews" on public.reviews for delete
  to authenticated using (public.can_manage_company(company_id));

-- review_scores: readable with the parent review; admin-only writes.
drop policy if exists "Employees read own scores, admins read company" on public.review_scores;
create policy "Employees read own scores, admins read company" on public.review_scores for select
  to authenticated using (
    public.can_manage_company(company_id)
    or exists (select 1 from public.reviews r where r.id = review_id and r.employee_id = auth.uid())
  );
drop policy if exists "Admins manage scores" on public.review_scores;
create policy "Admins manage scores" on public.review_scores for all
  to authenticated using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

-- goals: employees own theirs (within their own company), admins see and edit everyone's.
drop policy if exists "Employees read own goals, admins read company" on public.goals;
create policy "Employees read own goals, admins read company" on public.goals for select
  to authenticated using (employee_id = auth.uid() or public.can_manage_company(company_id));
drop policy if exists "Employees and admins create goals" on public.goals;
create policy "Employees and admins create goals" on public.goals for insert
  to authenticated with check (
    public.can_manage_company(company_id)
    or (employee_id = auth.uid() and company_id = public.auth_company_id())
  );
drop policy if exists "Employees and admins update goals" on public.goals;
create policy "Employees and admins update goals" on public.goals for update
  to authenticated
  using (employee_id = auth.uid() or public.can_manage_company(company_id))
  with check (employee_id = auth.uid() or public.can_manage_company(company_id));
drop policy if exists "Employees and admins delete goals" on public.goals;
create policy "Employees and admins delete goals" on public.goals for delete
  to authenticated using (employee_id = auth.uid() or public.can_manage_company(company_id));
