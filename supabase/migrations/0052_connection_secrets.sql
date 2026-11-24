-- 0052_connection_secrets.sql
-- Connection secrets leave every row the browser can read. Paste after 0051; idempotent.
--
-- Why: a provider's account id (a QuickBooks realm id, a HighLevel location id) sat on
-- company_connections, which a company's admins read, and in the audit log and synced rows beside
-- it. Tokens were stored as given. From here the account id lives only sealed, beside the tokens,
-- in tables only the connections Edge Function's service role reads, and every token and account
-- id there must be sealed ("v1:" then base64url, as supabase/functions/_shared/tokenCrypto.ts
-- writes it). The order matters: the audit trigger stops watching the column before it is cleared.
--
--   1. The company_connections audit trigger watches status and provider only.
--   2. A sync error that quotes its connection's account id (a network failure names the request
--      URL, which carries the QuickBooks realm id) is replaced with one fixed line, on that
--      connection's sources and runs only. It runs while the id is still there to match on, so a
--      second paste finds nothing to replace.
--   3. external_account_id is cleared on every connection and must stay null. The column stays so
--      an older function build fails loudly rather than writing it; the account name stays for
--      display.
--   4. Historic audit events for connections lose the account id.
--   5. Synced rows lose the QuickBooks realm id from source_ref.
--   6. connection_tokens gains account_id, and its tokens and account id must be sealed. Live holds
--      no tokens today; a plaintext row would make this paste fail, which is intended.
--   7. public.connection_pending holds a provider sign-in between the OAuth callback and the admin
--      confirming which account to connect. Row level security is on with no policies and only the
--      service role is granted, so no signed-in person or anon ever reads it. A pending connection
--      is keyed by a fresh random id the function mints at the callback, never by the state nonce:
--      the nonce is redeemed at the callback and nothing reads it later, so it has no column and
--      nothing can be keyed on it. A row expires, and goes with its company or with the person who
--      started it.

-- ---------------------------------------------------------------------------------------
-- 1. The audit trigger stops watching the account id
-- ---------------------------------------------------------------------------------------

drop trigger if exists company_connections_audit on public.company_connections;
create trigger company_connections_audit
  after insert or update or delete on public.company_connections
  for each row execute function private.audit_change('status', 'provider');

-- ---------------------------------------------------------------------------------------
-- 2. No account id in a stored sync error
-- ---------------------------------------------------------------------------------------
-- The line replaces the whole error: the id may sit anywhere in it, and nothing else in a
-- network failure's text helps an admin. A run keeps the { message } shape the runs list reads.

update public.sync_sources s
   set last_error = 'The last sync could not reach the outside tool.'
  from public.company_connections c
 where s.connection_id = c.id
   and c.external_account_id <> ''
   and strpos(s.last_error, c.external_account_id) > 0;

update public.sync_runs r
   set error_detail = jsonb_build_object('message', 'The last sync could not reach the outside tool.')
  from public.company_connections c
 where r.connection_id = c.id
   and c.external_account_id <> ''
   and strpos(r.error_detail::text, c.external_account_id) > 0;

-- ---------------------------------------------------------------------------------------
-- 3. No account id on the connection row
-- ---------------------------------------------------------------------------------------

update public.company_connections set external_account_id = null where external_account_id is not null;

alter table public.company_connections drop constraint if exists company_connections_no_account_id;
alter table public.company_connections add constraint company_connections_no_account_id
  check (external_account_id is null);

-- ---------------------------------------------------------------------------------------
-- 4. No account id in the audit log
-- ---------------------------------------------------------------------------------------

update public.audit_events
   set changed = changed - 'external_account_id'
 where table_name = 'company_connections' and changed ? 'external_account_id';

-- ---------------------------------------------------------------------------------------
-- 5. No realm id on synced rows
-- ---------------------------------------------------------------------------------------

update public.sync_records set source_ref = source_ref - 'realmId' where source_ref ? 'realmId';

-- ---------------------------------------------------------------------------------------
-- 6. Sealed tokens and the sealed account id
-- ---------------------------------------------------------------------------------------

alter table public.connection_tokens add column if not exists account_id text;

alter table public.connection_tokens drop constraint if exists connection_tokens_sealed;
alter table public.connection_tokens add constraint connection_tokens_sealed
  check (access_token like 'v1:%' and (refresh_token is null or refresh_token like 'v1:%') and (account_id is null or account_id like 'v1:%'));

-- ---------------------------------------------------------------------------------------
-- 7. Pending connections
-- ---------------------------------------------------------------------------------------

create table if not exists public.connection_pending (
  id                  uuid primary key,
  company_id          uuid not null references public.companies (id) on delete cascade,
  provider            text not null,
  started_by          uuid not null references public.profiles (id) on delete cascade,
  account_name        text,
  access_token        text not null,
  refresh_token       text,
  account_id          text,
  access_expires_at   timestamptz,
  refresh_expires_at  timestamptz,
  scopes              text,
  expires_at          timestamptz not null,
  created_at          timestamptz not null default now()
);

alter table public.connection_pending drop constraint if exists connection_pending_sealed;
alter table public.connection_pending add constraint connection_pending_sealed
  check (access_token like 'v1:%' and (refresh_token is null or refresh_token like 'v1:%') and (account_id is null or account_id like 'v1:%'));

create index if not exists connection_pending_expires_at_idx on public.connection_pending (expires_at);
create index if not exists connection_pending_company_id_idx on public.connection_pending (company_id);
create index if not exists connection_pending_started_by_idx on public.connection_pending (started_by);

alter table public.connection_pending enable row level security;

revoke all on public.connection_pending from public, anon, authenticated;
grant select, insert, update, delete on public.connection_pending to service_role;
