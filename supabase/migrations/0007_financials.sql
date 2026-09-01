-- 0007_financials.sql
-- Financial snapshots: one row per company per period (month, quarter, or year) holding the
-- headline numbers leadership reads before a meeting. Paste after 0006; idempotent.
--
-- Version one is manual entry or CSV upload (source 'manual' or 'csv'); the QuickBooks sync
-- lands later as source 'quickbooks' writing the same rows. Margins are derived in the app
-- (src/lib/financials.ts): gross = revenue - cogs, net = net_profit if entered else
-- revenue - cogs - opex. Admin-only in both directions; employees never see these rows.

create table if not exists public.financial_snapshots (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  period_type   text not null default 'month',
  period_start  date not null,
  period_end    date not null,
  revenue       numeric(14,2) not null default 0,
  -- Direct job costs (cost of goods sold) and overhead (operating expenses).
  cogs          numeric(14,2) not null default 0,
  opex          numeric(14,2) not null default 0,
  -- Optional override when the books say something other than revenue - cogs - opex.
  net_profit    numeric(14,2),
  cash_on_hand  numeric(14,2),
  notes         text,
  source        text not null default 'manual',
  created_by    uuid references auth.users (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint financial_snapshots_period_type_check check (period_type in ('month', 'quarter', 'year')),
  constraint financial_snapshots_period_check check (period_end >= period_start),
  constraint financial_snapshots_source_check check (source in ('manual', 'csv', 'quickbooks')),
  constraint financial_snapshots_company_period_key unique (company_id, period_type, period_start)
);

create index if not exists financial_snapshots_company_idx
  on public.financial_snapshots (company_id, period_type, period_start desc);

drop trigger if exists financial_snapshots_set_updated_at on public.financial_snapshots;
create trigger financial_snapshots_set_updated_at
  before update on public.financial_snapshots
  for each row execute function public.set_updated_at();

alter table public.financial_snapshots enable row level security;

drop policy if exists "Admins manage financial snapshots" on public.financial_snapshots;
create policy "Admins manage financial snapshots" on public.financial_snapshots for all
  to authenticated
  using (public.can_manage_company(company_id))
  with check (public.can_manage_company(company_id));
