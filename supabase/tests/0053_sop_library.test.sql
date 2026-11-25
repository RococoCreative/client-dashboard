-- 0053_sop_library.test.sql
-- Proves the SOP library upgrade (0053): an editor version's text is derived by the database and
-- feeds search; who wrote a version and who last changed an SOP are stamped by the database; a
-- saved version is permanent; a deleted person's name clears from versions and SOPs without
-- refusing the delete; tags normalize; categories stay inside their company; a person signs off a
-- published SOP for themselves only; a sign-off closes that person's open tasks on the SOP that
-- were assigned before it, and only those; an assignee cannot close an SOP task by hand or by
-- ticking its steps; an admin can; a recurring SOP task's next copy keeps its SOP.
--
-- Runs inside one transaction the harness opens and rolls back; never begin or commit here.

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

-- A small editor document: a heading and a bulleted step.
create function tests.sop_doc(p_heading text, p_step text)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('type', 'doc', 'content', jsonb_build_array(
    jsonb_build_object('type', 'heading', 'attrs', jsonb_build_object('level', 2),
      'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', p_heading))),
    jsonb_build_object('type', 'bulletList', 'content', jsonb_build_array(
      jsonb_build_object('type', 'listItem', 'content', jsonb_build_array(
        jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(
          jsonb_build_object('type', 'text', 'text', p_step,
            'marks', jsonb_build_array(jsonb_build_object('type', 'bold')))))))))))
$$;
grant execute on function tests.sop_doc(text, text) to authenticated;

-- Setup, as system.
select tests.create_person('kingdom_owner', tests.company('kingdom'), 'owner');
select tests.create_person('kingdom_admin', tests.company('kingdom'), 'admin');
select tests.create_person('kingdom_leaver', tests.company('kingdom'), 'admin');
select tests.create_person('kingdom_employee', tests.company('kingdom'));
select tests.create_person('kingdom_employee2', tests.company('kingdom'));
select tests.create_person('klasik_admin', tests.company('klasik'), 'admin');

-- case: admin_writes_an_editor_version
select tests.act_as(tests.id('kingdom_admin'));
insert into public.sops (company_id, title, status, summary, tags)
values (tests.company('kingdom'), 'Ladder safety', 'published', 'Before any work at height', array['Height']);
insert into public.sop_versions (sop_id, body_json, change_note)
select id, tests.sop_doc('Purpose', 'Inspect the ladder feet'), 'First version'
  from public.sops where title = 'Ladder safety';
reset role;
select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id) select 'sop_ladder', id from public.sops where title = 'Ladder safety';
select tests.assert(
  (select body_text like '%Purpose%' and body_text like '%Inspect the ladder feet%'
     from public.sop_versions where sop_id = tests.id('sop_ladder') and version = 1),
  'admin_writes_an_editor_version: the version text was not derived from its document'
);
select tests.assert(
  (select body_text like '%Inspect the ladder feet%' and current_version = 1
     from public.sops where id = tests.id('sop_ladder')),
  'admin_writes_an_editor_version: the SOP does not carry its current text'
);
select tests.assert(
  (select search @@ to_tsquery('english', 'inspect:* & ladd:*') from public.sops where id = tests.id('sop_ladder')),
  'admin_writes_an_editor_version: prefix search does not find words in the body'
);
select tests.assert(
  (select search @@ to_tsquery('english', 'height:*') from public.sops where id = tests.id('sop_ladder')),
  'admin_writes_an_editor_version: search does not find a tag'
);
select tests.assert(
  (select author_profile_id = tests.id('kingdom_admin') and author_name = 'kingdom_admin'
     from public.sop_versions where sop_id = tests.id('sop_ladder') and version = 1),
  'admin_writes_an_editor_version: the version does not name who saved it'
);
select tests.assert(
  (select created_by_name = 'kingdom_admin' and updated_by_name = 'kingdom_admin'
          and updated_by_profile_id = tests.id('kingdom_admin')
     from public.sops where id = tests.id('sop_ladder')),
  'admin_writes_an_editor_version: the SOP does not name who created and last updated it'
);

-- case: the_app_cannot_write_the_derived_text
select tests.act_as(tests.id('kingdom_admin'));
update public.sops set body_text = 'forged', summary = 'Before any work at height.' where id = tests.id('sop_ladder');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select body_text not like '%forged%' from public.sops where id = tests.id('sop_ladder')),
  'the_app_cannot_write_the_derived_text: a signed-in writer set the SOP text directly'
);

-- case: updated_by_follows_the_last_writer
select tests.act_as(tests.id('kingdom_owner'));
update public.sops set title = 'Ladder safety and setup' where id = tests.id('sop_ladder');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select updated_by_name = 'kingdom_owner' and created_by_name = 'kingdom_admin'
     from public.sops where id = tests.id('sop_ladder')),
  'updated_by_follows_the_last_writer: the stamp did not move to the owner, or the creator moved'
);

-- case: a_member_cannot_write_a_version
select tests.act_as(tests.id('kingdom_employee'));
select tests.assert_raises(
  format($q$insert into public.sop_versions (sop_id, body_json) values (%L, %L::jsonb)$q$,
    tests.id('sop_ladder'), tests.sop_doc('A', 'B')),
  '%row-level security%'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- case: a_version_needs_a_body
select tests.act_as(tests.id('kingdom_admin'));
select tests.assert_raises(
  format($q$insert into public.sop_versions (sop_id, change_note) values (%L, 'empty')$q$, tests.id('sop_ladder')),
  '%sop_versions_body_check%'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- case: a_saved_version_is_permanent
select tests.act_as(tests.id('kingdom_admin'));
select tests.assert(
  tests.rows_of(format($q$update public.sop_versions set change_note = 'rewritten' where sop_id = %L$q$,
    tests.id('sop_ladder'))) = 0,
  'a_saved_version_is_permanent: an admin rewrote a saved version'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- case: tags_normalize
select tests.act_as(tests.id('kingdom_admin'));
update public.sops set tags = array[' Crane ', 'crane', '', 'Lift'] where id = tests.id('sop_ladder');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select tags = array['Crane', 'Lift'] from public.sops where id = tests.id('sop_ladder')),
  'tags_normalize: tags were not trimmed, deduplicated and emptied of blanks'
);
select tests.act_as(tests.id('kingdom_admin'));
select tests.assert_raises(
  format($q$update public.sops set tags = array[repeat('x', 41)] where id = %L$q$, tests.id('sop_ladder')),
  '%up to 20 tags%'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- case: categories_stay_in_their_company
select tests.act_as(tests.id('klasik_admin'));
insert into public.sop_categories (company_id, name) values (tests.company('klasik'), 'Field');
reset role;
select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id)
select 'klasik_field', id from public.sop_categories where company_id = tests.company('klasik') and name = 'Field';
select tests.act_as(tests.id('kingdom_admin'));
insert into public.sop_categories (company_id, name) values (tests.company('kingdom'), 'Safety');
select tests.assert_raises(
  format($q$update public.sops set category_id = %L where id = %L$q$, tests.id('klasik_field'), tests.id('sop_ladder')),
  '%another company%'
);
select tests.assert_raises(
  format($q$insert into public.sop_categories (company_id, name) values (%L, ' safety ')$q$, tests.company('kingdom')),
  '%sop_categories_company_name_key%'
);
reset role;
select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('kingdom_employee'));
select tests.assert(
  (select count(*) from public.sop_categories) = 1,
  'categories_stay_in_their_company: an employee does not read exactly their own company''s categories'
);
select tests.assert_raises(
  format($q$insert into public.sop_categories (company_id, name) values (%L, 'Mine')$q$, tests.company('kingdom')),
  '%row-level security%'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- case: a_member_signs_off_a_published_sop
select tests.act_as(tests.id('kingdom_admin'));
insert into public.tasks (company_id, title, assignee_id, sop_id)
values (tests.company('kingdom'), 'Read ladder safety', tests.id('kingdom_employee'), tests.id('sop_ladder'));
reset role;
select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id) select 'task_before', id from public.tasks where title = 'Read ladder safety';
-- A task assigned after the sign-off is a request for a new one.
insert into public.tasks (company_id, title, assignee_id, sop_id, created_at)
values (tests.company('kingdom'), 'Read ladder safety again', tests.id('kingdom_employee'), tests.id('sop_ladder'), now() + interval '1 hour');
insert into tests.fixture (name, id) select 'task_after', id from public.tasks where title = 'Read ladder safety again';
select tests.act_as(tests.id('kingdom_employee'));
insert into public.sop_signoffs (sop_id, profile_id) values (tests.id('sop_ladder'), tests.id('kingdom_employee'));
select tests.assert(
  (select version = 1 and signer_name = 'kingdom_employee' and company_id = tests.company('kingdom')
     from public.sop_signoffs where sop_id = tests.id('sop_ladder')),
  'a_member_signs_off_a_published_sop: the sign-off does not carry its version, name and company'
);
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select completed_at is not null and completed_by = tests.id('kingdom_employee')
     from public.tasks where id = tests.id('task_before')),
  'a_member_signs_off_a_published_sop: the sign-off did not close the task assigned before it'
);
select tests.assert(
  (select completed_at is null from public.tasks where id = tests.id('task_after')),
  'a_member_signs_off_a_published_sop: a sign-off closed a task assigned after it'
);

-- case: signing_again_needs_a_reason
select tests.act_as(tests.id('kingdom_employee2'));
insert into public.sop_signoffs (sop_id, profile_id) values (tests.id('sop_ladder'), tests.id('kingdom_employee2'));
select tests.assert_raises(
  format($q$insert into public.sop_signoffs (sop_id, profile_id) values (%L, %L)$q$,
    tests.id('sop_ladder'), tests.id('kingdom_employee2')),
  '%already signed off this version%'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- case: nobody_signs_for_someone_else
select tests.act_as(tests.id('kingdom_employee'));
select tests.assert_raises(
  format($q$insert into public.sop_signoffs (sop_id, profile_id) values (%L, %L)$q$,
    tests.id('sop_ladder'), tests.id('kingdom_employee2')),
  '%your own%'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- case: who_reads_sign_offs
select tests.act_as(tests.id('kingdom_employee'));
select tests.assert(
  (select count(*) from public.sop_signoffs) = 1,
  'who_reads_sign_offs: an employee reads sign-offs other than their own'
);
reset role;
select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('kingdom_admin'));
select tests.assert(
  (select count(*) from public.sop_signoffs where sop_id = tests.id('sop_ladder')) = 2,
  'who_reads_sign_offs: an admin does not read every sign-off'
);
select tests.assert(
  tests.rows_of(format($q$delete from public.sop_signoffs where sop_id = %L$q$, tests.id('sop_ladder'))) = 0,
  'who_reads_sign_offs: a sign-off was deleted'
);
reset role;
select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('klasik_admin'));
select tests.assert(
  (select count(*) from public.sop_signoffs) = 0,
  'who_reads_sign_offs: another company reads these sign-offs'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- case: only_a_published_sop
select tests.act_as(tests.id('kingdom_admin'));
insert into public.sops (company_id, title) values (tests.company('kingdom'), 'Draft crane checks');
insert into public.sop_versions (sop_id, body_json)
select id, tests.sop_doc('Checks', 'Walk the site') from public.sops where title = 'Draft crane checks';
reset role;
select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id) select 'sop_draft', id from public.sops where title = 'Draft crane checks';
select tests.act_as(tests.id('kingdom_admin'));
select tests.assert_raises(
  format($q$insert into public.tasks (company_id, title, assignee_id, sop_id) values (%L, 'x', %L, %L)$q$,
    tests.company('kingdom'), tests.id('kingdom_employee'), tests.id('sop_draft')),
  '%published SOP can be assigned%'
);
reset role;
select set_config('request.jwt.claims', '', true);
select tests.act_as(tests.id('klasik_admin'));
select tests.assert_raises(
  format($q$insert into public.tasks (company_id, title, sop_id) values (%L, 'x', %L)$q$,
    tests.company('klasik'), tests.id('sop_ladder')),
  '%another company%'
);
reset role;
select set_config('request.jwt.claims', '', true);
-- As system, so the draft is visible and the refusal is the sign-off rule, not row level security.
select tests.assert_raises(
  format($q$insert into public.sop_signoffs (sop_id, profile_id) values (%L, %L)$q$,
    tests.id('sop_draft'), tests.id('kingdom_employee')),
  '%Only a published SOP can be signed off%'
);

-- case: an_assignee_cannot_close_an_sop_task_by_hand
select tests.act_as(tests.id('kingdom_admin'));
update public.sops set status = 'published' where id = tests.id('sop_draft');
insert into public.tasks (company_id, title, assignee_id, sop_id)
values (tests.company('kingdom'), 'Crane checks', tests.id('kingdom_employee'), tests.id('sop_draft'));
reset role;
select set_config('request.jwt.claims', '', true);
insert into tests.fixture (name, id) select 'task_crane', id from public.tasks where title = 'Crane checks';
insert into public.task_steps (task_id, title, sort_order) values (tests.id('task_crane'), 'Read it', 1);
select tests.act_as(tests.id('kingdom_employee'));
select tests.assert_raises(
  format($q$update public.tasks set completed_at = now() where id = %L$q$, tests.id('task_crane')),
  '%finishes when the SOP is signed off%'
);
select tests.assert_raises(
  format($q$update public.tasks set sop_id = null where id = %L$q$, tests.id('task_crane')),
  '%assigned this task%'
);
update public.task_steps set done_at = now() where task_id = tests.id('task_crane');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select completed_at is null from public.tasks where id = tests.id('task_crane')),
  'an_assignee_cannot_close_an_sop_task_by_hand: ticking every step closed an SOP task'
);
select tests.act_as(tests.id('kingdom_admin'));
update public.tasks set completed_at = now() where id = tests.id('task_crane');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select completed_at is not null and completed_by = tests.id('kingdom_admin') from public.tasks where id = tests.id('task_crane')),
  'an_assignee_cannot_close_an_sop_task_by_hand: an admin could not close it by hand'
);

-- case: a_recurring_sop_task_keeps_its_sop
select tests.act_as(tests.id('kingdom_admin'));
insert into public.tasks (company_id, title, assignee_id, sop_id, recurrence, due_date)
values (tests.company('kingdom'), 'Yearly ladder refresher', tests.id('kingdom_employee2'), tests.id('sop_ladder'), 'yearly', current_date);
update public.tasks set completed_at = now() where title = 'Yearly ladder refresher';
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select n.sop_id = tests.id('sop_ladder') and n.completed_at is null
     from public.tasks t join public.tasks n on n.id = t.next_task_id
    where t.title = 'Yearly ladder refresher'),
  'a_recurring_sop_task_keeps_its_sop: the next copy lost its SOP'
);

-- case: deleting_a_person_clears_their_name
select tests.act_as(tests.id('kingdom_leaver'));
insert into public.sop_versions (sop_id, body_json, change_note)
values (tests.id('sop_ladder'), tests.sop_doc('Purpose', 'Inspect the feet and the rungs'), 'Second version');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select updated_by_name = 'kingdom_leaver' and current_version = 2 from public.sops where id = tests.id('sop_ladder')),
  'deleting_a_person_clears_their_name: the leaver is not the last writer'
);
select tests.act_as(tests.id('kingdom_owner'));
delete from public.profiles where id = tests.id('kingdom_leaver');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.assert(
  (select author_profile_id is null and author_name is null and body_text like '%rungs%'
     from public.sop_versions where sop_id = tests.id('sop_ladder') and version = 2),
  'deleting_a_person_clears_their_name: the version still names the deleted person or lost its text'
);
select tests.assert(
  (select updated_by_profile_id is null and updated_by_name is null and updated_by is null
     from public.sops where id = tests.id('sop_ladder')),
  'deleting_a_person_clears_their_name: the SOP names the deleted person or whoever deleted them'
);
