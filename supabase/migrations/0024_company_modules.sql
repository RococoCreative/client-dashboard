-- 0024_company_modules.sql
-- A per-company module switch. Paste after 0023; idempotent.
--
--   1. companies.modules lists the app modules a Rococo admin switched on for a company. The app
--      reads it only through src/lib/modules.ts (hasModule); with none on, a company sees the
--      standard hub. No check constraint: the app ignores unknown keys, so a key can be retired
--      without a migration. No company has a module on until Rococo turns one on.
--   2. Only Rococo changes it, the same way only Rococo changes a slug or a theme: the 0009
--      guard_company_fields body, with modules added to the fields it protects. The trigger
--      companies_guard_fields (0001) and the policies are unchanged.

alter table public.companies add column if not exists modules text[] not null default '{}';

create or replace function public.guard_company_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not private.is_rococo_admin() then
    if new.slug is distinct from old.slug or new.theme_key is distinct from old.theme_key or new.modules is distinct from old.modules then
      raise exception 'Only Rococo admins can change a company slug, theme or modules.';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_company_fields() from public, anon, authenticated;
