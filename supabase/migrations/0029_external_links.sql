-- 0029_external_links.sql
-- Links to a company's own outside tools, such as Monday boards. Paste after 0028; idempotent.
--
-- Why: a company with the external_links module keeps a short list of links to the tools it
-- already runs elsewhere, shown in the section of the hub where people work. These are links and
-- approved public embeds only: no record from the outside tool is copied here, and the tool's own
-- sign-in still applies when someone follows a link. Admins keep the list; who reads each link is
-- decided here by its audience, never by the screen.
--
--   1. public.external_links: members read the links meant for everyone, admins read them all,
--      admins write and delete. Links and embed links are https only, and a link is shown as an
--      embed only when an admin has flagged it as a public share view with an embed link.
--   2. Triggers: the company is pinned, who changed it and when, and an audit of what it points to
--      and who sees it.

-- ---------------------------------------------------------------------------------------
-- 1. External links
-- ---------------------------------------------------------------------------------------

create table if not exists public.external_links (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  nav_group        text not null,
  label            text not null,
  destination_note text,
  url              text not null,
  provider         text not null default 'other',
  embed_url        text,
  embed_is_public  boolean not null default false,
  audience         text not null default 'everyone',
  sort_order       integer not null default 0,
  created_by       uuid references public.profiles (id) on delete set null,
  updated_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint external_links_nav_group_check
    check (nav_group in ('home', 'sales_finance', 'production', 'people_hr')),
  constraint external_links_label_check check (btrim(label) <> ''),
  constraint external_links_url_check check (url ~ '^https://'),
  constraint external_links_embed_url_check check (embed_url is null or embed_url ~ '^https://'),
  constraint external_links_embed_public_check check (not embed_is_public or embed_url is not null),
  constraint external_links_provider_check
    check (provider in ('monday', 'quickbooks', 'google_sheets', 'other')),
  constraint external_links_audience_check check (audience in ('admins', 'everyone'))
);

-- The first index also covers the company foreign key.
create index if not exists external_links_company_group_idx
  on public.external_links (company_id, nav_group, sort_order);
create index if not exists external_links_created_by_idx on public.external_links (created_by);
create index if not exists external_links_updated_by_idx on public.external_links (updated_by);

-- ---------------------------------------------------------------------------------------
-- 2. Triggers
-- ---------------------------------------------------------------------------------------
-- BEFORE triggers fire in name order; none of these depends on another's result. The audit
-- watches what a link points to and who sees it; its order and note are not watched.

drop trigger if exists external_links_pin_company on public.external_links;
create trigger external_links_pin_company
  before update on public.external_links
  for each row execute function public.pin_company_id();

drop trigger if exists external_links_stamp_actor on public.external_links;
create trigger external_links_stamp_actor
  before insert or update on public.external_links
  for each row execute function public.stamp_actor();

drop trigger if exists external_links_set_updated_at on public.external_links;
create trigger external_links_set_updated_at
  before update on public.external_links
  for each row execute function public.set_updated_at();

drop trigger if exists external_links_audit on public.external_links;
create trigger external_links_audit
  after insert or update or delete on public.external_links
  for each row execute function private.audit_change(
    'nav_group', 'label', 'url', 'provider', 'embed_url', 'embed_is_public', 'audience'
  );

-- ---------------------------------------------------------------------------------------
-- 3. Row level security, grants and policies
-- ---------------------------------------------------------------------------------------

alter table public.external_links enable row level security;

revoke all on public.external_links from anon, authenticated;
grant select, insert, update, delete on public.external_links to authenticated;

drop policy if exists "Members read external links" on public.external_links;
create policy "Members read external links"
  on public.external_links for select to authenticated
  using (
    private.is_company_member(company_id)
    and (audience = 'everyone' or private.can_manage_company(company_id))
  );

drop policy if exists "Admins create external links" on public.external_links;
create policy "Admins create external links"
  on public.external_links for insert to authenticated
  with check (private.can_manage_company(company_id));

drop policy if exists "Admins update external links" on public.external_links;
create policy "Admins update external links"
  on public.external_links for update to authenticated
  using (private.can_manage_company(company_id))
  with check (private.can_manage_company(company_id));

drop policy if exists "Admins delete external links" on public.external_links;
create policy "Admins delete external links"
  on public.external_links for delete to authenticated
  using (private.can_manage_company(company_id));
