-- 0005_storage.sql
-- The private 'hub-files' storage bucket for SOP attachments and resource files. Paste
-- after 0004; idempotent and safe to re-run.
--
-- The bucket is PRIVATE: nothing in the hub is public, so files are read through short
-- lived signed URLs minted by a signed-in member (createSignedUrl honors the SELECT policy
-- below). Object paths are {company_id}/{area}/... and every policy binds that leading
-- segment to the caller's company, so one company can never read or overwrite another's
-- files even though every company shares the bucket.

insert into storage.buckets (id, name, public, file_size_limit)
values ('hub-files', 'hub-files', false, 52428800)
on conflict (id) do nothing;

-- A bucket someone already created by hand may be public; pin the flag either way.
update storage.buckets set public = false where id = 'hub-files';

-- The leading path segment as a uuid, or null when it is not one (a bad path must deny,
-- never raise from inside a policy).
create or replace function public.path_company_id(object_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(object_name, '/', 1)
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(object_name, '/', 1)::uuid
    else null
  end
$$;

revoke all on function public.path_company_id(text) from public, anon;
grant execute on function public.path_company_id(text) to authenticated;

drop policy if exists "Members read own company files" on storage.objects;
create policy "Members read own company files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'hub-files'
    and public.is_company_member(public.path_company_id(name))
  );

drop policy if exists "Admins upload own company files" on storage.objects;
create policy "Admins upload own company files"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'hub-files'
    and public.can_manage_company(public.path_company_id(name))
  );

drop policy if exists "Admins update own company files" on storage.objects;
create policy "Admins update own company files"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'hub-files'
    and public.can_manage_company(public.path_company_id(name))
  )
  with check (
    bucket_id = 'hub-files'
    and public.can_manage_company(public.path_company_id(name))
  );

drop policy if exists "Admins delete own company files" on storage.objects;
create policy "Admins delete own company files"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'hub-files'
    and public.can_manage_company(public.path_company_id(name))
  );
