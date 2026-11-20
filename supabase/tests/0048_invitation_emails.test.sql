-- 0048_invitation_emails.test.sql
-- Proves an invitation's address is one plain address (0048): the three shapes that are not one
-- (a display name with an address in angle brackets, a bare bracketed address, two addresses with
-- a comma) are refused on insert even from an owner writing straight to the API, and a normal
-- address is accepted. Also proves last_emailed_at, the invitation email's pace, is written only
-- with no signed-in user: an owner can neither set it on insert nor change it, and the system can.
--
-- Runs inside one transaction the harness opens and rolls back; never begin or commit here.

-- Setup, as system.
select tests.create_person('inv_owner', tests.company('kingdom'), 'owner');

-- case: bad_addresses_refused
select tests.act_as(tests.id('inv_owner'));
select tests.assert_raises(
  format(
    $q$insert into public.invitations (company_id, email, role) values (%L, 'x <ceo@otherco.com>', 'employee')$q$,
    tests.company('kingdom')
  ),
  '%invitations_email_address_check%'
);
select tests.assert_raises(
  format(
    $q$insert into public.invitations (company_id, email, role) values (%L, '<ceo@otherco.com>', 'employee')$q$,
    tests.company('kingdom')
  ),
  '%invitations_email_address_check%'
);
select tests.assert_raises(
  format(
    $q$insert into public.invitations (company_id, email, role) values (%L, 'a@gmail.com,ceo@otherco.com', 'employee')$q$,
    tests.company('kingdom')
  ),
  '%invitations_email_address_check%'
);

-- case: plain_address_accepted
insert into public.invitations (company_id, email, role)
values (tests.company('kingdom'), 'sample.new+hire@example.com', 'employee');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select count(*) from public.invitations where email = 'sample.new+hire@example.com') = 1,
  'plain_address_accepted: a normal address was not stored'
);
select tests.assert(
  (select last_emailed_at from public.invitations where email = 'sample.new+hire@example.com') is null,
  'plain_address_accepted: a new invitation starts with a send time'
);
select tests.assert(
  (select count(*) from pg_constraint where conname = 'invitations_email_address_check') = 1,
  'plain_address_accepted: invitations_email_address_check is not exactly one constraint'
);

-- case: signed_in_writer_cannot_pace
select tests.act_as(tests.id('inv_owner'));
select tests.assert_raises(
  format(
    $q$insert into public.invitations (company_id, email, role, last_emailed_at) values (%L, 'sample.paced@example.com', 'employee', now())$q$,
    tests.company('kingdom')
  ),
  'Only the invitation email records when it was sent.'
);
select tests.assert_raises(
  $q$update public.invitations set last_emailed_at = now() where email = 'sample.new+hire@example.com'$q$,
  'Only the invitation email records when it was sent.'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- case: system_paces
-- What the notify function's service client does: claim, then put the old value back.
update public.invitations set last_emailed_at = now() where email = 'sample.new+hire@example.com';
select tests.assert(
  (select last_emailed_at from public.invitations where email = 'sample.new+hire@example.com') is not null,
  'system_paces: the system could not record a send'
);
select tests.act_as(tests.id('inv_owner'));
select tests.assert_raises(
  $q$update public.invitations set last_emailed_at = null where email = 'sample.new+hire@example.com'$q$,
  'Only the invitation email records when it was sent.'
);
-- An owner still edits the rest of the row.
update public.invitations set title = 'Carpenter' where email = 'sample.new+hire@example.com';
reset role;
select set_config('request.jwt.claims', '', true);
update public.invitations set last_emailed_at = null where email = 'sample.new+hire@example.com';
select tests.assert(
  (select last_emailed_at is null and title = 'Carpenter' from public.invitations where email = 'sample.new+hire@example.com'),
  'system_paces: the send time was not put back, or the owner''s edit did not stick'
);
