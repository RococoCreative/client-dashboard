-- kingdom_permissions.sql
-- Kingdom's seven permission levels, as data (rule 12: a company's shape is its rows), and nothing
-- else. Kingdom's owners and admins add their own people on the People page, so this script
-- touches no person, role or job role; kingdom_intake.sql, which also seeds the roster, is on hold.
--
-- Run once in the Supabase SQL editor after 0040 and 0041 are pasted and the app is deployed. It
-- refuses to run without both migrations. Safe to run again: a second run writes nothing.
--
-- What changes for Kingdom when it runs: only an owner sees pay and changes the company name,
-- logo and time zone; admins get an Activity tab; managers edit milestones and may sync; everyone
-- records wins; Production is for managers and up. Set the right people to owner on the People
-- page first, or only Rococo reaches Kingdom's pay and company settings. People with the hub open
-- need to reload.
--
-- Ends with one check row per permission: its level for Kingdom now.

begin;

do $$
begin
  if not exists (select 1 from public.companies where slug = 'kingdom') then
    raise exception 'No company with slug kingdom. Nothing was changed.';
  end if;
  -- 0040 adds the table and 0041 moves the policies onto it; rows written before 0041 would hide
  -- pay on screen while the old policies still serve it, so both must be in.
  if to_regclass('public.company_capabilities') is null
     or not exists (select 1 from pg_policies
                     where schemaname = 'public' and tablename = 'sync_sources'
                       and policyname = 'Syncers read sync sources') then
    raise exception 'Apply 0040_capabilities.sql and 0041_capability_policies.sql first. Nothing was changed.';
  end if;
end $$;

insert into public.company_capabilities (company_id, capability, min_role)
select c.id, v.capability, v.min_role
  from public.companies c
 cross join (values
   ('pay',              'owner'),
   ('company_settings', 'owner'),
   ('audit_log',        'admin'),
   ('milestones_edit',  'manager'),
   ('wins_post',        'employee'),
   ('sync_run',         'manager'),
   ('production_view',  'manager')
 ) as v (capability, min_role)
 where c.slug = 'kingdom'
on conflict (company_id, capability) do update
  set min_role = excluded.min_role
  where public.company_capabilities.min_role is distinct from excluded.min_role;

commit;

select k.sort_order, k.key as permission, k.default_min_role as default_level,
       coalesce(cc.min_role, k.default_min_role) as kingdom_level
  from public.capabilities k
  join public.companies c on c.slug = 'kingdom'
  left join public.company_capabilities cc on cc.company_id = c.id and cc.capability = k.key
 order by k.sort_order;
