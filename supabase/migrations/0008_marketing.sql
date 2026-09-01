-- 0008_marketing.sql
-- Marketing campaign tracker: a lightweight board of what is planned, running, paused, and
-- done, with budget vs actual spend and the key result. Paste after 0007; idempotent.
-- Not a marketing platform, just the tracking surface leadership reads. Admin-only.

create table if not exists public.marketing_campaigns (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  name              text not null,
  channel           text,
  status            text not null default 'planned',
  start_date        date,
  end_date          date,
  budget            numeric(14,2),
  actual_spend      numeric(14,2),
  goal              text,
  key_metric_label  text,
  key_metric_value  numeric(14,2),
  results           text,
  notes             text,
  sort_order        integer not null default 0,
  created_by        uuid references auth.users (id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint marketing_campaigns_status_check check (status in ('planned', 'active', 'paused', 'complete')),
  constraint marketing_campaigns_dates_check check (end_date is null or start_date is null or end_date >= start_date)
);

create index if not exists marketing_campaigns_company_idx on public.marketing_campaigns (company_id, status);

drop trigger if exists marketing_campaigns_set_updated_at on public.marketing_campaigns;
create trigger marketing_campaigns_set_updated_at
  before update on public.marketing_campaigns
  for each row execute function public.set_updated_at();

alter table public.marketing_campaigns enable row level security;

drop policy if exists "Admins manage marketing campaigns" on public.marketing_campaigns;
create policy "Admins manage marketing campaigns" on public.marketing_campaigns for all
  to authenticated
  using (public.can_manage_company(company_id))
  with check (public.can_manage_company(company_id));

-- Anon never reads these tables directly; RLS already denies it, and this removes the grant too.
revoke all on all tables in schema public from anon;
