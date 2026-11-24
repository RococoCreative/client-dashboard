-- 0051_rococo_admins.test.sql
-- Proves the Rococo admin list (0051): a Rococo admin is an address on the list whose account has a
-- confirmed email and whose profile is active, never just an address on Rococo's domain; the
-- profile flag is written only by the list's own sync, for everyone; only Rococo admins read, add
-- or remove entries, and who added one is stamped by the database; addresses are lowercased and
-- must be on Rococo's domain; removing someone turns their profile off and adding them back turns
-- it on; nobody can remove their own entry, and the last entry stays; every change is audited; and
-- the sign-up gate admits a Rococo address only when it is on the list.
--
-- Runs inside one transaction the harness opens and rolls back; never begin or commit here.

-- How many rows a statement touched as whoever is acting, so a delete that RLS quietly skips
-- reads as 0.
create function tests.rows_of(p_sql text)
returns integer
language plpgsql
as $$
declare
  v_rows integer;
begin
  execute p_sql;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;
grant execute on function tests.rows_of(text) to authenticated;

-- A person's address, read as system so a case can name it while acting as someone else.
create function tests.email_of(p_profile uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select email from public.profiles where id = p_profile
$$;
grant execute on function tests.email_of(uuid) to authenticated;

-- Setup, as system.
select tests.create_person('rococo', null, 'employee', true);
select tests.create_person('rococo2', null, 'employee', true);
select tests.create_person('kingdom_admin', tests.company('kingdom'), 'admin');
select tests.create_person('kingdom_employee', tests.company('kingdom'));

-- case: listed_and_flagged
select tests.assert(
  (select count(*) from public.profiles p
     join public.rococo_admins r on r.email = lower(p.email)
    where p.id in (tests.id('rococo'), tests.id('rococo2'))
      and p.is_rococo_admin) = 2,
  'listed_and_flagged: a Rococo profile is not flagged or its address is not on the list'
);

-- case: helper_needs_list_and_confirmation
select tests.act_as(tests.id('rococo'));
select tests.assert(private.is_rococo_admin(), 'helper_needs_list_and_confirmation: a listed, confirmed, active Rococo admin is not one');
reset role;
select set_config('request.jwt.claims', '', true);
update auth.users set email_confirmed_at = null where id = tests.user_of(tests.id('rococo'));
select tests.act_as(tests.id('rococo'));
select tests.assert(not private.is_rococo_admin(), 'helper_needs_list_and_confirmation: an unconfirmed address counts as a Rococo admin');
reset role;
select set_config('request.jwt.claims', '', true);
update auth.users set email_confirmed_at = now() where id = tests.user_of(tests.id('rococo'));
update public.profiles set is_active = false where id = tests.id('rococo');
select tests.act_as(tests.id('rococo'));
select tests.assert(not private.is_rococo_admin(), 'helper_needs_list_and_confirmation: an inactive profile counts as a Rococo admin');
reset role;
select set_config('request.jwt.claims', '', true);
update public.profiles set is_active = true where id = tests.id('rococo');

-- case: helper_needs_the_flag
-- Only the list's sync clears the flag on a listed address, so this stands in for the column and the
-- list ever disagreeing: the flag must hold as well.
select set_config('hub.rococo_sync', '1', true);
update public.profiles set is_rococo_admin = false where id = tests.id('rococo');
select set_config('hub.rococo_sync', '', true);
select tests.act_as(tests.id('rococo'));
select tests.assert(not private.is_rococo_admin(), 'helper_needs_the_flag: a listed profile without the flag counts as a Rococo admin');
reset role;
select set_config('request.jwt.claims', '', true);
select set_config('hub.rococo_sync', '1', true);
update public.profiles set is_rococo_admin = true where id = tests.id('rococo');
select set_config('hub.rococo_sync', '', true);
select tests.act_as(tests.id('rococo'));
select tests.assert(private.is_rococo_admin(), 'helper_needs_the_flag: restoring the flag did not restore the Rococo admin');
reset role;
select set_config('request.jwt.claims', '', true);

-- case: changed_account_address_is_not_enough
-- An account's address is the one a signed-in person can change; their profile's address is not.
-- Moving the account onto a listed address nobody has claimed yet gives nothing.
insert into public.rococo_admins (email) values ('sample.unclaimed@rocococreative.io');
update auth.users set email = 'sample.unclaimed@rocococreative.io', email_confirmed_at = now()
 where id = tests.user_of(tests.id('kingdom_employee'));
select tests.act_as(tests.id('kingdom_employee'));
select tests.assert(not private.is_rococo_admin(), 'changed_account_address_is_not_enough: a changed account address made a Rococo admin');
reset role;
select set_config('request.jwt.claims', '', true);
update auth.users set email = tests.email_of(tests.id('kingdom_employee'))
 where id = tests.user_of(tests.id('kingdom_employee'));
delete from public.rococo_admins where email = 'sample.unclaimed@rocococreative.io';

-- case: entries_are_never_edited
select tests.assert_raises(
  format($q$update public.rococo_admins set email = 'sample.typo@rocococreative.io' where email = %L$q$,
    tests.email_of(tests.id('rococo2'))),
  'A Rococo admin entry is removed and added again, never edited.'
);

-- case: list_is_never_truncated
select tests.assert_raises('truncate public.rococo_admins', 'The last Rococo admin cannot be removed.');
select tests.assert(
  (select count(*) from public.rococo_admins
    where email in (tests.email_of(tests.id('rococo')), tests.email_of(tests.id('rococo2')))) = 2,
  'list_is_never_truncated: an entry was edited or the list was emptied'
);

-- case: account_address_must_match_profile
-- A listed, flagged, active Rococo admin whose confirmed account address moves away from their
-- profile's address is no longer one.
update auth.users set email = 'sample.elsewhere@rocococreative.io', email_confirmed_at = now()
 where id = tests.user_of(tests.id('rococo2'));
select tests.act_as(tests.id('rococo2'));
select tests.assert(not private.is_rococo_admin(), 'account_address_must_match_profile: an account at another address counts as a Rococo admin');
reset role;
select set_config('request.jwt.claims', '', true);
update auth.users set email = tests.email_of(tests.id('rococo2'))
 where id = tests.user_of(tests.id('rococo2'));
select tests.act_as(tests.id('rococo2'));
select tests.assert(private.is_rococo_admin(), 'account_address_must_match_profile: putting the address back did not restore the Rococo admin');
reset role;
select set_config('request.jwt.claims', '', true);

-- case: deleting_who_added_keeps_the_entry
-- added_by is on delete set null, which Postgres carries out as an update; that one edit goes through.
select tests.create_person('rococo3', null, 'employee', true);
select tests.act_as(tests.id('rococo3'));
insert into public.rococo_admins (email) values ('sample.kept@rocococreative.io');
reset role;
select set_config('request.jwt.claims', '', true);
delete from public.profiles where id = tests.id('rococo3');
select tests.assert(
  not exists (select 1 from public.profiles where id = tests.id('rococo3')),
  'deleting_who_added_keeps_the_entry: the person who added an entry could not be deleted'
);
select tests.assert(
  (select added_by is null from public.rococo_admins where email = 'sample.kept@rocococreative.io'),
  'deleting_who_added_keeps_the_entry: the entry is gone or still names the deleted person'
);
delete from public.rococo_admins
 where email = 'sample.kept@rocococreative.io' or email like 'rococo3.%@rocococreative.io';

-- case: domain_alone_is_not_enough
insert into auth.users (email, email_confirmed_at, raw_user_meta_data)
values ('sample.unlisted@rocococreative.io', now(), '{}'::jsonb);
insert into tests.fixture (name, id)
select 'unlisted', id from public.profiles where email = 'sample.unlisted@rocococreative.io';
select tests.assert(
  (select not is_rococo_admin from public.profiles where id = tests.id('unlisted')),
  'domain_alone_is_not_enough: an unlisted Rococo sign-up was flagged'
);
select tests.act_as(tests.id('unlisted'));
select tests.assert(not private.is_rococo_admin(), 'domain_alone_is_not_enough: an unlisted Rococo address counts as a Rococo admin');
reset role;
select set_config('request.jwt.claims', '', true);

-- case: flag_cannot_be_written
select tests.assert_raises(
  format('update public.profiles set is_rococo_admin = true where id = %L', tests.id('kingdom_admin')),
  'Rococo admins are added and removed on the Permissions page.'
);
update public.profiles set is_rococo_admin = false where id = tests.id('kingdom_admin');
select tests.act_as(tests.id('rococo'));
select tests.assert_raises(
  format('update public.profiles set is_rococo_admin = true where id = %L', tests.id('kingdom_admin')),
  'Rococo admins are added and removed on the Permissions page.'
);
select tests.assert(
  tests.rows_of(format('update public.profiles set is_rococo_admin = false where id = %L', tests.id('kingdom_admin'))) = 1,
  'flag_cannot_be_written: writing the flag at its current value did not go through'
);
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select not is_rococo_admin from public.profiles where id = tests.id('kingdom_admin')),
  'flag_cannot_be_written: the flag moved'
);

-- case: only_rococo_reads_and_writes
select tests.act_as(tests.id('kingdom_admin'));
select tests.assert(
  (select count(*) from public.rococo_admins) = 0,
  'only_rococo_reads_and_writes: a company admin reads the Rococo admin list'
);
select tests.assert_raises(
  $q$insert into public.rococo_admins (email) values ('sample.sneak@rocococreative.io')$q$,
  '%row-level security%'
);
select tests.assert(
  tests.rows_of('delete from public.rococo_admins') = 0,
  'only_rococo_reads_and_writes: a company admin removed a list entry'
);
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select count(*) from public.rococo_admins
    where email in (tests.email_of(tests.id('rococo')), tests.email_of(tests.id('rococo2')))) = 2,
  'only_rococo_reads_and_writes: a list entry went missing'
);

-- case: added_by_is_stamped
select tests.act_as(tests.id('rococo'));
insert into public.rococo_admins (email, added_by) values ('sample.added@rocococreative.io', tests.id('kingdom_admin'));
select tests.assert(
  (select added_by = tests.id('rococo') from public.rococo_admins where email = 'sample.added@rocococreative.io'),
  'added_by_is_stamped: the entry names someone other than the Rococo admin who added it'
);

-- case: email_shape
select tests.assert_raises(
  $q$insert into public.rococo_admins (email) values ('someone@example.com')$q$,
  '%rococo_admins_email_check%'
);
select tests.assert_raises(
  $q$insert into public.rococo_admins (email) values ('sam@rocococreative.io.evil.test')$q$,
  '%rococo_admins_email_check%'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- case: mixed_case_address_matches_profile
insert into auth.users (email, email_confirmed_at, raw_user_meta_data)
values ('sam@rocococreative.io', now(), '{}'::jsonb);
insert into tests.fixture (name, id)
select 'sam', id from public.profiles where email = 'sam@rocococreative.io';
select tests.assert(
  (select not is_rococo_admin from public.profiles where id = tests.id('sam')),
  'mixed_case_address_matches_profile: an unlisted address was flagged at sign-up'
);
select tests.act_as(tests.id('rococo'));
insert into public.rococo_admins (email) values ('  Sam@RococoCreative.io ');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  exists (select 1 from public.rococo_admins where email = 'sam@rocococreative.io'),
  'mixed_case_address_matches_profile: the address was not stored lowercased and trimmed'
);
select tests.assert(
  (select is_rococo_admin and is_active from public.profiles where id = tests.id('sam')),
  'mixed_case_address_matches_profile: adding the address did not turn the profile on'
);
select tests.act_as(tests.id('sam'));
select tests.assert(private.is_rococo_admin(), 'mixed_case_address_matches_profile: an added address is not a Rococo admin');
reset role;
select set_config('request.jwt.claims', '', true);

-- case: remove_turns_the_person_off
select tests.act_as(tests.id('rococo'));
select tests.assert(
  tests.rows_of(format('delete from public.rococo_admins where email = %L', tests.email_of(tests.id('rococo2')))) = 1,
  'remove_turns_the_person_off: the entry was not removed'
);
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select not is_rococo_admin and not is_active from public.profiles where id = tests.id('rococo2')),
  'remove_turns_the_person_off: a removed person keeps their flag or stays active'
);
select tests.act_as(tests.id('rococo2'));
select tests.assert(not private.is_rococo_admin(), 'remove_turns_the_person_off: a removed person is still a Rococo admin');
reset role;
select set_config('request.jwt.claims', '', true);

-- case: re_add_turns_them_back_on
select tests.act_as(tests.id('rococo'));
insert into public.rococo_admins (email) values (tests.email_of(tests.id('rococo2')));
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select is_rococo_admin and is_active from public.profiles where id = tests.id('rococo2')),
  're_add_turns_them_back_on: adding the address back did not turn the profile on'
);
select tests.act_as(tests.id('rococo2'));
select tests.assert(private.is_rococo_admin(), 're_add_turns_them_back_on: a re-added person is not a Rococo admin');
reset role;
select set_config('request.jwt.claims', '', true);

-- case: own_entry_cannot_be_removed
-- Removing your own entry clears your own flag after your entry is gone, and the 0047 profile guard
-- refuses that. The app never offers it; this pins that the database refuses it too.
select tests.act_as(tests.id('rococo'));
select tests.assert_raises(
  format('delete from public.rococo_admins where email = %L', tests.email_of(tests.id('rococo'))),
  'A Rococo admin''s profile can only be changed by Rococo.'
);
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select is_rococo_admin and is_active from public.profiles where id = tests.id('rococo'))
  and exists (select 1 from public.rococo_admins where email = tests.email_of(tests.id('rococo'))),
  'own_entry_cannot_be_removed: a Rococo admin removed their own entry'
);

-- case: last_entry_stays
select tests.act_as(tests.id('rococo'));
delete from public.rococo_admins where email <> tests.email_of(tests.id('rococo'));
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select count(*) from public.rococo_admins) = 1,
  'last_entry_stays: the other entries were not removed'
);
select tests.assert_raises(
  format('delete from public.rococo_admins where email = %L', tests.email_of(tests.id('rococo'))),
  'The last Rococo admin cannot be removed.'
);
select tests.assert_raises(
  'delete from public.rococo_admins',
  'The last Rococo admin cannot be removed.'
);
select tests.assert(
  (select count(*) from public.rococo_admins) = 1
  and (select is_rococo_admin and is_active from public.profiles where id = tests.id('rococo')),
  'last_entry_stays: the last entry or its profile changed'
);

-- case: every_change_is_audited
select tests.assert(
  (select count(*) from public.audit_events
    where table_name = 'rococo_admins' and action = 'insert' and changed ? 'email') >= 5
  and (select count(*) from public.audit_events
    where table_name = 'rococo_admins' and action = 'delete' and changed ? 'email') >= 3
  and not exists (select 1 from public.audit_events
    where table_name = 'rococo_admins' and (action not in ('insert', 'delete') or not changed ? 'email')),
  'every_change_is_audited: a list change was not audited'
);

-- case: gate_admits_only_listed_rococo
select tests.assert(
  public.restrict_signups(jsonb_build_object('user', jsonb_build_object('email', tests.email_of(tests.id('rococo'))))) = '{}'::jsonb,
  'gate_admits_only_listed_rococo: a listed Rococo address was refused'
);
select tests.assert(
  public.restrict_signups(jsonb_build_object('user', jsonb_build_object('email', 'sample.unlisted2@rocococreative.io')))
    -> 'error' ->> 'message' = 'This Rococo address is not on the Rococo admin list. Ask a Rococo admin to add you.',
  'gate_admits_only_listed_rococo: an unlisted Rococo address was not refused with the list message'
);
insert into public.invitations (company_id, email, role)
values (tests.company('kingdom'), 'sample.unlisted3@rocococreative.io', 'employee');
select tests.assert(
  public.restrict_signups(jsonb_build_object('user', jsonb_build_object('email', 'sample.unlisted3@rocococreative.io')))
    -> 'error' ->> 'message' = 'This Rococo address is not on the Rococo admin list. Ask a Rococo admin to add you.',
  'gate_admits_only_listed_rococo: an invitation let an unlisted Rococo address through'
);
select tests.assert(
  public.restrict_signups(jsonb_build_object('user', jsonb_build_object('email',
    'sample.person@' || (select domain from public.company_domains
                          where company_id = tests.company('kingdom') order by domain limit 1)))) = '{}'::jsonb,
  'gate_admits_only_listed_rococo: a Kingdom address was refused'
);
