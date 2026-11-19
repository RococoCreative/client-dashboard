-- 0042_company_display_settings.sql
-- Two display settings every company carries. Paste after 0041; idempotent.
--
-- Why: how long a win stays on Home and whether a company keeps the manual Financials page are
-- differences between companies, so they are columns (rule 12), each defaulting to what every
-- company has today.
--
--   1. companies.wins_home_days: null means the five newest wins with no age limit; a number
--      means wins from the last that many days. Must be 1 to 3650 (ten years), so no value can
--      push the Home cut-off past a date the app can work with.
--   2. companies.manual_financials: true keeps the manual Financials page, as today.
--   3. Only Rococo changes either, the same way only Rococo changes a slug, theme or modules:
--      the 0024 guard_company_fields body with both columns added to the protected fields.
--   4. The audit watches both: 0037's watched columns for companies, with both added.

-- ---------------------------------------------------------------------------------------
-- 1 and 2. The columns
-- ---------------------------------------------------------------------------------------

alter table public.companies add column if not exists wins_home_days integer;
alter table public.companies add column if not exists manual_financials boolean not null default true;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'companies_wins_home_days_check') then
    alter table public.companies add constraint companies_wins_home_days_check check (wins_home_days between 1 and 3650);
  end if;
end $$;

-- ---------------------------------------------------------------------------------------
-- 3. Only Rococo changes them
-- ---------------------------------------------------------------------------------------

create or replace function public.guard_company_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not private.is_rococo_admin() then
    if new.slug is distinct from old.slug
       or new.theme_key is distinct from old.theme_key
       or new.modules is distinct from old.modules
       or new.wins_home_days is distinct from old.wins_home_days
       or new.manual_financials is distinct from old.manual_financials then
      raise exception 'Only Rococo admins can change a company slug, theme, modules or display settings.';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_company_fields() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 4. The audit watches both
-- ---------------------------------------------------------------------------------------

drop trigger if exists companies_audit on public.companies;
create trigger companies_audit
  after insert or update or delete on public.companies
  for each row execute function private.audit_change('modules', 'slug', 'theme_key', 'name', 'time_zone', 'wins_home_days', 'manual_financials');
