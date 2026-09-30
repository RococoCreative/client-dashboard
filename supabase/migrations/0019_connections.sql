-- 0019_connections.sql
-- Each company's own connections to outside systems (GoHighLevel, QuickBooks Online), made by
-- that company's admin signing in to that system from Company Hub. Paste after 0018; idempotent.
--
-- Two tables, split by who may read them:
--
--   1. company_connections: one row per company and provider, the status an admin sees on the
--      Connections card (connected, which account, when, last sync). Admins of the company read
--      it. Nothing in the browser writes it: the connections Edge Function does, with the
--      service role, after the provider's OAuth callback lands.
--   2. connection_tokens: the access and refresh tokens themselves. Row level security is on and
--      there are no policies, so the anon and authenticated roles can never read a token; only
--      the service role, which the Edge Function holds, can. The browser never talks to a
--      provider directly.
--
-- Providers are rows and configuration, never a branch on the company (rule 12): a new provider
-- is a new value in the check below and a new entry in the function's registry.

create table if not exists public.company_connections (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies (id) on delete cascade,
  provider               text not null,
  status                 text not null default 'not_connected',
  -- The account on the provider's side: a HighLevel location id, a QuickBooks realm id.
  external_account_id    text,
  external_account_name  text,
  scopes                 text,
  connected_by           uuid references public.profiles (id) on delete set null,
  connected_at           timestamptz,
  last_synced_at         timestamptz,
  last_error             text,
  -- Per-connection settings a later sync reads (pipelines that count as sales, accounting
  -- method, currency). Shape is the provider's; the app treats it as opaque until it needs it.
  settings               jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint company_connections_provider_check check (provider in ('gohighlevel', 'quickbooks')),
  constraint company_connections_status_check check (status in ('not_connected', 'connected', 'error')),
  constraint company_connections_company_provider_key unique (company_id, provider)
);
create index if not exists company_connections_company_id_idx on public.company_connections (company_id);
grant select on public.company_connections to authenticated;

drop trigger if exists company_connections_set_updated_at on public.company_connections;
create trigger company_connections_set_updated_at
  before update on public.company_connections
  for each row execute function public.set_updated_at();

alter table public.company_connections enable row level security;
drop policy if exists "Admins read connections" on public.company_connections;
create policy "Admins read connections"
  on public.company_connections for select to authenticated
  using (private.can_manage_company(company_id));

create table if not exists public.connection_tokens (
  connection_id       uuid primary key references public.company_connections (id) on delete cascade,
  access_token        text not null,
  refresh_token       text,
  access_expires_at   timestamptz,
  refresh_expires_at  timestamptz,
  updated_at          timestamptz not null default now()
);
alter table public.connection_tokens enable row level security;
revoke all on public.connection_tokens from public, anon, authenticated;

-- A connection that is no longer connected keeps no tokens, whichever path cleared it.
create or replace function public.clear_connection_tokens()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'not_connected' then
    delete from public.connection_tokens where connection_id = new.id;
  end if;
  return new;
end;
$$;
revoke execute on function public.clear_connection_tokens() from public, anon, authenticated;

drop trigger if exists company_connections_clear_tokens on public.company_connections;
create trigger company_connections_clear_tokens
  after update of status on public.company_connections
  for each row execute function public.clear_connection_tokens();
