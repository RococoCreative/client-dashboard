# Team and division access, persistence, GSR hardening, task links: design

This file is the agreed design for the sprint that readies the hub for RBA's employee rollout.
It exists so the migrations, the services and the screens are built against one written record of
what was decided and why.

## Purpose

RBA is about to invite employees. Before adoption grows the hub has to be right on four counts:
who can see whom (managers and divisions), whether what people save stays saved, whether the GSR
workflow holds end to end, and how tasks connect to people and goals. Access is enforced in the
database; the screens follow it.

## Decisions made with the owner

| Topic | Decision |
|---|---|
| Manager reach | A manager sees everyone below them in the reporting chain: direct reports, their reports, and so on. |
| Manager vs division | Assignment wins. A manager always sees the people in their chain, whatever division they are in. |
| Manager powers | Read the team's profile, GSRs, goals, KPIs, deliverables and ratings. Assign and edit the team's tasks. Edit the team's monthly goals and goal notes on open months, and open a team member's monthly GSR. Locking a month, ratings, sign-off, compensation, financial figures and profile edits stay with owners and admins. |
| Who is division limited | Owners and Rococo always see the whole company. Admins and managers each carry division view access. Employees see themselves only. |
| Existing admins | Start with access to all divisions, so nothing changes for them until an owner narrows it. |
| Membership vs access | A person's divisions (where they work) and their view access (what they may see) are separate settings. |
| Both | Both means both divisions. Generalised: a person may belong to any set of the company's divisions; the screens label "every division" as "Both" when a company has exactly two. |
| Task links | A task can be linked to a GSR goal from inside the GSR, either by linking an existing task or by creating a new one there. |
| Task completion | Informational. It never moves a goal's completion or any score. A linked task shows its live state wherever the goal shows, past GSRs included. |
| Scoring math | Validated as it is. No new weights before Friday's review. |

Defaults chosen where the owner did not decide:

- A person with no division is visible to owners, Rococo and every admin of the company, whatever
  the admin's own division access, so an admin who adds someone can always open the record and
  place them. Managers see an unplaced person only through their chain. The People tab flags these
  rows as "No division".
- View access is set by an owner or Rococo only, the same rule as the existing "Can view
  divisions" (the dashboard and Scorecards split), which stays as it is and keeps its meaning.
- A task linked to a goal belongs to the goal's person: its assignee must be that person. Assigning
  it to someone else is refused with a message telling the user to unlink first. Nothing is
  silently cleared.

## The access model

Three questions, answered by `private` helpers (security definer, stable, never exposed):

1. **Who can I see?** `private.viewable_person_ids()` returns the profile ids of my company I may
   read. For the caller:
   - Rococo admin: not called (Rococo's branch short-circuits every policy).
   - Owner: everyone in the company.
   - Admin: themselves, their chain, everyone with no division, and everyone with at least one
     division in their view access (`view_all_divisions`, or an overlap between the person's
     `division_ids` and the admin's `view_division_ids`).
   - Manager: themselves, their chain, and everyone with a division in their view access.
   - Employee: themselves.
2. **Whom do I manage?** `private.manageable_person_ids()`: admin-level powers. Owner: everyone in
   the company. Admin: everyone they can see. Manager and employee: nobody. Rococo short-circuits.
3. **Whom do I lead?** `private.led_person_ids()`: manager-level powers (tasks, monthly goals,
   goal notes, opening a GSR). The manageable set plus the caller's chain.

The chain is `private.chain_ids(root)`: a recursive walk down `reports_to` from `root`, capped at
50 levels, active and inactive people alike (an inactive person's history stays with their
manager). `private.team_ids()` is the chain of the caller.

Row predicates for a person-owned table (`employee_id` column) become:

```sql
-- read
private.is_rococo_admin()
or employee_id = private.auth_profile_id()
or (company_id = private.auth_company_id() and employee_id in (select private.viewable_person_ids()))
-- admin write
private.is_rococo_admin()
or (company_id = private.auth_company_id() and employee_id in (select private.manageable_person_ids()))
```

Pay is narrower than the GSR: `compensation_items` and `employee_financials` are read through the
manageable set, so a manager never reads a report's pay or financial figures.

The `in (select ...)` form is evaluated once per statement, which keeps lists cheap.

### Tables and what changes

| Table | Read | Write |
|---|---|---|
| profiles | self, viewable | update: self (guarded) or admin over manageable; insert/delete: admin, and the row must land inside the admin's scope |
| profile_directory (new) | every member of the company | trigger only |
| reviews | self, viewable | admin over manageable; a leader may insert the not-started shape of a monthly GSR for a led person in an open monthly cycle |
| review_scores, review_project_notes | via the review: self, viewable | admin over manageable (via the review) |
| goals | self, viewable | self (as today), admin over manageable, leader over led (monthly goals only, `scope = 'cycle'`) |
| goal_notes | owner always; viewable on cycle goals | author; leader over led on cycle goals |
| goal_private | owner only (unchanged) | owner only (unchanged) |
| employee_kpis, employee_deliverables, deliverable_tasks, impact_scores, metric_entries, cycle_omissions | self, viewable | admin over manageable |
| compensation_items, employee_financials | self, manageable | admin over manageable |
| tasks | assignee self, viewable assignee, unassigned for admins | insert/update: admin over manageable, leader over led, self for own (as today); campaigns stay admin only |
| task_steps | via the task | via the task |

Company-level configuration (cycles, pillars, criteria, job roles, divisions, focus topics, SOPs,
resources, projects, marketing, financial snapshots) keeps its company-wide rules. A division
limited admin still runs the company's configuration; division access limits people, not setup.

### Columns

- `profiles.division_ids uuid[] not null default '{}'`: where the person works. Every id must be a
  division of the person's company (trigger). Deleting a division removes it from every array.
- `profiles.division_id` stays for one release as a read-only mirror: the single division when
  there is exactly one, otherwise null. A write to it from an older client is mapped into
  `division_ids`. It is dropped in a later migration once no client reads it.
- `profiles.view_all_divisions boolean not null default false`: sees every division.
- `profiles.view_division_ids uuid[] not null default '{}'`: the divisions seen otherwise.
- Backfill: `division_ids` from `division_id`; `view_all_divisions = true` for every admin.
- Only an owner or Rococo changes `view_all_divisions` or `view_division_ids`. A company move
  clears all three, as it clears `division_id` today.
- An admin may only place a person in divisions they can view (or none), only point `reports_to`
  at someone they can view, and only edit people they manage. Each refusal has its own message.

### The directory

Names on screens that are not about the person (who assigned a task, who owns a milestone, who
signed off a review, who wrote a note) come from `profile_directory`: `id`, `company_id`,
`full_name`, `title`, `is_active`. A trigger on profiles keeps it in step. Every company member
reads their company's directory. No email, phone, role, dates or divisions are in it. Name pickers
for assigning work use the visible profiles, not the directory.

### Manager in the app

- `HubContext` gains `isLead` (owner, admin, manager, or Rococo). `isAdmin` keeps its meaning.
- Managers get the People tab (their visible people) and person pages, read only except tasks.
- On a person page a manager sees profile details, the scorecard, goals, KPIs, deliverables,
  ratings (read only), tasks (add and edit), review history, and a link to open or start this
  month's GSR. Compensation, financial figures and edit controls for profile fields are hidden.
- On a team member's GSR a manager edits the month's goals and notes while the month is open and
  unlocked. Mark complete, lock, reopen and ratings stay admin only.
- Tasks gets a "Team" tab for managers (the existing Everyone tab, filtered by RLS).

## Persistence

- Every delete verifies that a row went (`.select("id")`), so a refused delete reads as a refusal.
- `BlurInput` accepts an async `onSave`. A rejected or `false` result puts the stored value back.
  It shows a quiet status beside the field: "Saving", "Saved", "Not saved" (`aria-live`).
- Money fields refuse what they cannot parse instead of saving 0 or blank.
- Writes that are two steps (task with steps, project with assignment) undo the first step when the
  second fails, so a retry never duplicates.
- Profile edits on a person page are queued, so an older response never overwrites a newer one,
  and a response for a different person or company is dropped.
- Add forms guard against double submission.
- When a task is assigned to someone who has not signed in, the screen says no email went.

## GSR hardening

| Bug | Fix |
|---|---|
| Reopen in a closed cycle strands the review | Reopen is refused while the cycle is closed (database and screen). |
| Retrying a failed sign-off duplicates line items | Sign-off reads the review's current line items from the database before writing. |
| Re-signing keeps ratings for retired criteria | Freezing deletes the review's rating rows for criteria not frozen this time. |
| Two people opening the same GSR collide | Opening is an insert that ignores the duplicate, then a read; Start all carries on past one failure and always reloads. |
| Carrying a goal forward makes it the clicker's | A carried goal keeps the original goal's `created_by`. |
| A complete month with no Monthly GSRs pillar stays editable | A complete monthly review freezes its goals and notes, scored or not. The score of record still needs `gsr_score`. |
| The lock score can come from stale goals | The lock dialog re-reads the month's goals before it shows and writes the score. |
| Closing a cycle strands unlocked months silently | Closing asks first and says how many reviews are not complete. |
| Rating and note on a person race | Writes per criterion are queued. |
| Reviews can be started in a closed cycle | Refused (database and screen). |
| A review's person can be from another company | Refused by trigger. |
| A manager editing a goal an admin set is refused as if they were the employee | The "set for you" rule applies only to the goal's own person. |

## Tasks and goals

- `tasks.goal_id uuid references goals(id) on delete set null`. Only a monthly goal (`scope =
  'cycle'`) of the task's assignee, in the task's company, may be linked (trigger). Changing the
  assignee of a linked task is refused until it is unlinked.
- The link follows the month's freeze: linking or unlinking is refused when the goal's month is
  closed, complete or omitted. A task's own completion is never frozen by its goal.
- A recurring task's next copy does not carry the link (a new copy belongs to a later month).
- Tasks are read through their assignee, so the goal's person always sees the tasks on their own
  goals; anyone who can see the person sees them too.
- Person page: an Add task action pre-fills the person, and the Tasks section lists open tasks and
  recent done ones.
- GSR: each goal lists its linked tasks with their live state, offers "Link a task" (the person's
  open tasks not linked elsewhere) and "New task" (pre-filled person and goal) while the month is
  editable. Past and locked months show the list read only.
- Completion stays informational. Nothing writes `goals.progress` from tasks.

## People tab

- Columns: Person (name, title), Division, Reports to, Role, Status, actions. Hire date and
  department move to the person page.
- Filters: a division chip row (All, each division, "No division"), a search box over name, title
  and email, and an "Inactive" toggle. Filters narrow what RLS already returned; they never widen.
- Empty results say why ("No one in RBA South matches 'sam'" or "No one has been placed in a
  division yet").
- Each row links to the profile; the profile links to this month's GSR and to tasks.

## Out of scope

New scoring weights, a manager approval workflow, division-scoped company configuration,
per-person notification settings, dropping `profiles.division_id` (next release).

## Revisions after the design review

Three independent reviews (security, SQL feasibility, sprint coverage) found holes in the first
draft. These rules replace anything above that disagrees with them.

### Who counts as a lead, and how far down

- Chain powers (seeing and leading the people below you) belong to managers, admins and owners
  only. An employee whom someone reports to gets nothing from it; the person page warns when
  "Reports to" points at an employee ("They will not see this person until they are a manager").
- Nobody leads or division-views someone ranked at or above them, except an owner. A manager's
  division view access shows employees only; their own manager, admins and owners stay hidden
  unless they are in the manager's chain, and they never are by definition.
- A full-scope admin is an owner, a Rococo admin, or an admin with `view_all_divisions`.
  `private.has_full_scope()` names it. Full scope reads and writes every row of the company,
  including rows of people who have since moved company (their history stays readable).

### Profiles

- Row visibility on `profiles` is written over the row's own columns (role, division_ids,
  reports_to) plus the caller's chain, never as `id in (set)`, so an insert's RETURNING and an
  update's new row are judged correctly. Child tables use the id sets.
- The profiles INSERT and UPDATE policies keep their company-admin shape; placement is enforced by
  BEFORE triggers on NEW with one message per refusal:
  - a non-full-scope admin edits only people they manage;
  - added or removed `division_ids` must be divisions they can view;
  - `reports_to` must point at someone they can view, and a non-full-scope admin may change a
    person's `reports_to` only when they can already view everyone in that person's chain;
  - only an owner or Rococo sets `view_all_divisions` or `view_division_ids`, on insert or update;
  - a role change made by anyone but an owner or Rococo clears both view settings.
- The self branch of `guard_profile_fields` becomes a whitelist: a person may change their own
  `full_name`, `title` and `phone`, nothing else. A future column is admin-only by default.
- `guard_profile_division` does the mirror and the validation (it already fires before the field
  guard): if `division_ids` changed, `division_id` follows; else if `division_id` changed, the
  array follows; every id in either array belongs to the person's company, no nulls or
  duplicates; a company move clears all four division columns.
- `division_ids`, `view_all_divisions` and `view_division_ids` join the audited columns.
- The backfill is one-shot: it runs only when the columns are being created, so re-pasting the
  migration never widens access an owner has narrowed.

### Configuration that holds people's data

- Divisions: only a full-scope admin adds, renames or removes one. A division someone still works
  in cannot be deleted ("Move the N people out of RBA North first"). Deleting one strips it from
  everyone's view access through a security-definer cleanup that the profile guards let through.
- Review cycles: any admin creates one; only a full-scope admin edits, closes, reopens or deletes
  one, because a cycle cascades to every person's reviews and goals.
- Invitations: an admin reads and writes an invitation only for someone they manage. An
  invitation by address for an unclaimed person they cannot manage is refused.

### Shared company content, on purpose

Project teams (`project_assignments`), milestone owners and the directory's names and titles stay
readable company-wide: they describe projects and who to talk to, not a person's record. Sync
records stay admin-only as today.

### Tasks

- Writes go through the led set, never through visibility: a manager who only views a division
  cannot add, tick or edit steps on those tasks.
- `guard_task` and `guard_task_step` get a leader branch: a caller who leads both the old and the
  new assignee edits like an admin. Campaigns are pinned for non-admins in the guard.
- A plain assignee may change only `completed_at` and `goal_id` on a task someone else assigned,
  so a person can link their own tasks to their own goals.
- Unlinking is always allowed, frozen month or not, and database-driven clears (a deleted goal, a
  deleted person, a company move, `hub.task_internal`) pass. Only linking checks the freeze.
  Changing the assignee of a linked task in the same write that unlinks it is allowed.
- `clear_task_assignee_on_move` also clears `goal_id`.
- Delete: admins over the manageable set; leaders over tasks they created for led people; anyone
  over a task they made for themselves.
- `notify` sends only when the caller created the task or is an owner or admin of its company.

### GSR

- `goals.employee_id` is pinned on update for every signed-in caller but Rococo.
- A carried goal takes `created_by` from its source goal, only when the source belongs to the same
  person; otherwise the caller.
- The "set for you" rule binds only the goal's own person.
- A complete monthly review freezes its goals and notes whether or not it was scored. Months
  already marked complete freeze when this ships; the release notes say so.
- The freeze deletes stale criterion rows under the freeze flag, which `guard_signed_off_scores`
  lets through for that review only. Line items (criterion null) are never touched.
- A partial unique index on `review_scores (review_id, pillar_id) where criterion_id is null` is
  created only when no duplicates exist; otherwise the migration reports them.
- Reviews: refused into a closed cycle; refused to leave complete while the cycle is closed; the
  person must belong to the cycle's company (checked on insert or a change of person or cycle).
  A leader's insert is the not-started shape with no reflection or discussion, sent as an insert
  that ignores a duplicate.

### App consequences

- `lib/people.ts` gains the pure helpers the screens share: `chainOf(people, rootId)`,
  `isLeadRole`, `ledBy(viewer, people)`, `divisionLabel`, `canViewDivision`, `isDivisionLimited`.
  Pickers for assigning work use `ledBy`.
- Division consumers move to `division_ids`: a person in Both counts in each division's figures
  and once in Combined (`compare.ts`, the dashboard split, Scorecards, DivisionsPanel counts).
- A division-limited viewer sees chips only for the divisions they can view, and company-wide
  figures are labelled "in your divisions".
- Managers: a `lead` nav audience (People, Tasks Team); `LeadOnly` routes for people and the team
  tasks tab; read-only person page apart from tasks; GSR goal editing for led people; the review
  back link returns to the person; copy never says "your manager" to the manager.
- `ProgressSlider` rolls back when its save fails. KPI, compensation and financial rows queue
  their writes per row; job role module toggles queue.
- A person who is in the company but hidden from the viewer reads "You do not have access to this
  person", not "not in this company".

### Rollout

Paste 0038 then 0039 in the SQL editor, then deploy the app the same day. The new client selects
the new columns and the directory, so it must not deploy before the migrations. An old client left
open after the migrations keeps working with blank names on a few employee screens until reload.

### Known residual

Two people editing the same field at the same moment still resolve last write wins. Patches send
only the fields that changed, so different fields never overwrite each other. A concurrency token
is follow-up work.
