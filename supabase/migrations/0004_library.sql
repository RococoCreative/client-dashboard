-- 0004_library.sql
-- SOP library and resource library. Paste after 0003; idempotent and safe to re-run.
--
-- SOPs are versioned: the sops row is the document's identity (title, category, status),
-- and every edit appends a sop_versions row holding the full Markdown body. The trigger
-- below numbers versions and keeps sops.current_version in step, so history is complete
-- and the current text is one join away. Attachments hang off the document and live in
-- the private 'hub-files' storage bucket (0005). Employees read published SOPs; drafts
-- and archived documents are visible to admins only. Resources are lighter: a title, a
-- kind, a link or a file, and tags for finding things.

set check_function_bodies = off;

-- sops ---------------------------------------------------------------------------------

create table if not exists public.sops (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  title            text not null,
  category         text not null default 'process',
  summary          text,
  status           text not null default 'draft',
  current_version  integer not null default 0,
  created_by       uuid references auth.users (id) on delete set null default auth.uid(),
  updated_by       uuid references auth.users (id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint sops_category_check check (category in ('safety', 'process', 'client', 'admin', 'field')),
  constraint sops_status_check check (status in ('draft', 'published', 'archived'))
);

create index if not exists sops_company_id_idx on public.sops (company_id, category);

-- sop_versions -------------------------------------------------------------------------

create table if not exists public.sop_versions (
  id           uuid primary key default gen_random_uuid(),
  sop_id       uuid not null references public.sops (id) on delete cascade,
  company_id   uuid not null references public.companies (id) on delete cascade,
  version      integer not null,
  body_md      text not null default '',
  change_note  text,
  created_by   uuid references auth.users (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  constraint sop_versions_sop_version_key unique (sop_id, version)
);

create index if not exists sop_versions_sop_id_idx on public.sop_versions (sop_id, version desc);

-- sop_attachments ----------------------------------------------------------------------

create table if not exists public.sop_attachments (
  id            uuid primary key default gen_random_uuid(),
  sop_id        uuid not null references public.sops (id) on delete cascade,
  company_id    uuid not null references public.companies (id) on delete cascade,
  file_name     text not null,
  -- Object path in the 'hub-files' bucket: {company_id}/sops/{sop_id}/{uuid}-{file_name}
  file_path     text not null,
  content_type  text,
  size_bytes    bigint,
  created_by    uuid references auth.users (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now()
);

create index if not exists sop_attachments_sop_id_idx on public.sop_attachments (sop_id);

-- resources ----------------------------------------------------------------------------

create table if not exists public.resources (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  title        text not null,
  description  text,
  kind         text not null default 'link',
  url          text,
  -- Object path in the 'hub-files' bucket: {company_id}/resources/{uuid}-{file_name}
  file_path    text,
  file_name    text,
  tags         text[] not null default '{}',
  created_by   uuid references auth.users (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint resources_kind_check check (kind in ('link', 'file', 'template', 'video', 'doc')),
  constraint resources_target_check check (url is not null or file_path is not null)
);

create index if not exists resources_company_id_idx on public.resources (company_id);
create index if not exists resources_tags_idx on public.resources using gin (tags);

-- Triggers -------------------------------------------------------------------------------

-- Number each new version after the last and advance the document. Versions are permanent
-- history: never renumbered, never edited in place.
create or replace function public.set_sop_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select company_id into new.company_id from public.sops where id = new.sop_id;
  if new.company_id is null then
    raise exception 'Unknown SOP.';
  end if;
  if new.version is null then
    select coalesce(max(version), 0) + 1 into new.version
      from public.sop_versions where sop_id = new.sop_id;
  end if;
  update public.sops
     set current_version = greatest(current_version, new.version),
         updated_by = coalesce(auth.uid(), updated_by),
         updated_at = now()
   where id = new.sop_id;
  return new;
end;
$$;

create or replace function public.inherit_company_from_sop()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select company_id into new.company_id from public.sops where id = new.sop_id;
  if new.company_id is null then
    raise exception 'Unknown SOP.';
  end if;
  return new;
end;
$$;

create or replace function public.stamp_sop_updated_by()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_by = coalesce(auth.uid(), new.updated_by);
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sop_versions_set_version on public.sop_versions;
create trigger sop_versions_set_version
  before insert on public.sop_versions
  for each row execute function public.set_sop_version();

drop trigger if exists sop_attachments_inherit_company on public.sop_attachments;
create trigger sop_attachments_inherit_company
  before insert on public.sop_attachments
  for each row execute function public.inherit_company_from_sop();

drop trigger if exists sops_stamp_updated_by on public.sops;
create trigger sops_stamp_updated_by
  before update on public.sops
  for each row execute function public.stamp_sop_updated_by();

drop trigger if exists resources_set_updated_at on public.resources;
create trigger resources_set_updated_at
  before update on public.resources
  for each row execute function public.set_updated_at();

revoke all on function public.set_sop_version() from public, anon, authenticated;
revoke all on function public.inherit_company_from_sop() from public, anon, authenticated;
revoke all on function public.stamp_sop_updated_by() from public, anon, authenticated;

-- Row level security ----------------------------------------------------------------------

alter table public.sops             enable row level security;
alter table public.sop_versions     enable row level security;
alter table public.sop_attachments  enable row level security;
alter table public.resources        enable row level security;

-- sops: employees read published documents; admins read everything and write.
drop policy if exists "Members read published SOPs, admins read all" on public.sops;
create policy "Members read published SOPs, admins read all" on public.sops for select
  to authenticated using (
    public.can_manage_company(company_id)
    or (public.is_company_member(company_id) and status = 'published')
  );
drop policy if exists "Admins manage SOPs" on public.sops;
create policy "Admins manage SOPs" on public.sops for all
  to authenticated using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

-- sop_versions and sop_attachments follow the parent document's visibility. Versions are
-- insert-only for admins (history is never rewritten); attachments may be removed.
drop policy if exists "Members read versions of visible SOPs" on public.sop_versions;
create policy "Members read versions of visible SOPs" on public.sop_versions for select
  to authenticated using (
    public.can_manage_company(company_id)
    or (public.is_company_member(company_id)
        and exists (select 1 from public.sops s where s.id = sop_id and s.status = 'published'))
  );
drop policy if exists "Admins add versions" on public.sop_versions;
create policy "Admins add versions" on public.sop_versions for insert
  to authenticated with check (public.can_manage_company(company_id));

drop policy if exists "Members read attachments of visible SOPs" on public.sop_attachments;
create policy "Members read attachments of visible SOPs" on public.sop_attachments for select
  to authenticated using (
    public.can_manage_company(company_id)
    or (public.is_company_member(company_id)
        and exists (select 1 from public.sops s where s.id = sop_id and s.status = 'published'))
  );
drop policy if exists "Admins manage attachments" on public.sop_attachments;
create policy "Admins manage attachments" on public.sop_attachments for all
  to authenticated using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

-- resources: members browse, admins manage.
drop policy if exists "Members read resources" on public.resources;
create policy "Members read resources" on public.resources for select
  to authenticated using (public.is_company_member(company_id));
drop policy if exists "Admins manage resources" on public.resources;
create policy "Admins manage resources" on public.resources for all
  to authenticated using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

-- Anon never reads these tables directly; RLS already denies it, and this removes the grant too.
revoke all on all tables in schema public from anon;
