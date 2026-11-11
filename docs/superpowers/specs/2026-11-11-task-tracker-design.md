# Task tracker: design

This file is the agreed design for the task tracker module. It exists so the implementation
plan and the build are checked against one written record of what was decided and why.

## Purpose

A company's admins assign work to people, with a due date and a priority, and people complete
it. It replaces spreadsheets. It was requested by RBA and is built as a module any company can
have switched on. Tasks can also be attached to a marketing campaign, so the Marketing page
shows the work behind each campaign.

## Decisions made with the owner

| Topic | Decision |
|---|---|
| Availability | A `tasks` module key, switched on per company under Rococo, Companies. RBA first. |
| Who assigns | Admins (owners and managers) create tasks, assign them to anyone, and see every task. |
| Employees | See only tasks assigned to them, complete them, and create tasks for themselves. |
| Task state | Open or done. No in-progress step. |
| Subtasks | Checklist steps: a line of text and a checkbox, in order. No assignee or date of their own. |
| Progress | Percent complete is steps done out of total steps. Ticking the last step completes the task. |
| Recurring | A task can repeat. The next copy is created when the current one is completed. |
| Notifications | An email on assignment, plus a count of open tasks on the Tasks nav item. |
| Who gets email | Only people who have an account. No email on completion. No reminders. |
| Deleting | Real deletion. No archive. |
| Marketing | A task can be attached to a marketing campaign. Initiatives come later. |

## Out of scope

Due-soon and overdue reminders, comments, file attachments, per-step assignees, a
calendar-driven recurrence schedule, marketing initiatives, and a Home dashboard card.

## The module gate

- Add `tasks` to `MODULE_KEYS`, `MODULE_LABELS`, and `MODULE_DESCRIPTIONS` in `src/lib/modules.ts`.
- Routes and the nav item are gated with `hasModule(company, "tasks")`, like every other module.
- Nothing branches on a company name, slug, or theme key.

## Screens

### Tasks page (`/tasks`)

Two tabs. Employees see only the first.

- **Mine:** my open tasks, sorted by due date with undated tasks last, overdue marked. Each row
  shows title, due date, priority, percent complete when the task has steps, and a repeat mark
  when it repeats. A toggle shows my completed tasks. "Add a task" creates a task assigned to me.
- **Everyone** (admins): every task in the company. Filters: person, priority, campaign, open
  or done. "Add a task" opens the form with an assignee picker that lists the whole active
  roster, with "not signed in yet" marked on people without an account and never filtered out.

### Task page (`/tasks/:id`)

- Title, description, assignee, assigned by, due date, priority, repeat, campaign (admins only).
- The checklist: tick and untick steps. Whoever may edit the task may add, rename, reorder, and
  remove steps.
- Mark complete, and reopen.
- The page calls `assertInCompany()` on the loaded task, per the standing rule for records
  loaded by an id from the URL.

### Marketing page

Each campaign shows its task count and overall progress (tasks done out of tasks), a list of
its tasks, and an "Add a task" action that pre-fills the campaign.

### Person page

Admins see the person's open tasks in a compact list that links to each task.

### Navigation

A **Tasks** item for everyone at a company with the module on, with the count of the signed-in
person's open tasks. A Rococo admin stepped into a company has no profile there, so they see
no count.

## Rules

### Who may do what

| Action | Admin | Employee |
|---|---|---|
| See a task | Any in the company | Only tasks assigned to them |
| Create | For anyone, or unassigned | Only for themselves |
| Edit fields, steps, repeat | Any task | Only tasks they created for themselves |
| Tick and untick steps | Any task | Tasks assigned to them |
| Complete and reopen | Any task | Tasks assigned to them |
| Attach a campaign | Yes | No |
| Delete | Any task | Only tasks they created for themselves |

### Completion

- A task is done when `completed_at` is set.
- Ticking the last unticked step completes the task.
- Unticking a step on a completed task reopens it.
- Marking a task done by hand is allowed with steps unticked, and leaves the steps as they are.
- Percent complete is ticked steps out of all steps, rounded to a whole number. A task with no
  steps has no percent.

### Recurring tasks

- Repeat options: daily, weekly, every two weeks, monthly, quarterly, yearly.
- A repeating task must have a due date.
- When a repeating task is completed, the next copy is created with the same title,
  description, priority, assignee, creator, campaign, repeat, and steps, all steps unticked.
- The next due date steps forward from the previous due date by the repeat interval until it
  falls after the day of completion. A weekly task finished three weeks late lands on the next
  upcoming slot, not on a date already in the past.
- One open copy exists at a time. A late task is one overdue task, never a pile.
- A completed copy that has already produced its next copy cannot be reopened, and its steps
  are locked. The page says the next one is already open.
- Turning the repeat off on the open copy stops the series. Deleting the open copy also ends
  it. Completed copies stay as history.
- No email is sent for a copy created by recurrence.

### People

- A task attaches to `profiles.id`, so it can be assigned to someone who has never signed in.
- Deactivating a person leaves their tasks in place for an admin to reassign.
- Moving a person to another company clears them as assignee on the old company's tasks, the
  same way milestones behave (0026). Those tasks become unassigned and stay with the company.

## Data

One migration, `0036_tasks.sql`, idempotent, following the existing numbered pattern.
`src/types/database.ts` gains matching types.

### `public.tasks`

| Column | Notes |
|---|---|
| `id` | uuid primary key |
| `company_id` | not null, references companies, cascade |
| `title` | not null, not blank |
| `description` | text, nullable |
| `assignee_id` | references profiles, nullable (unassigned), set null on delete |
| `created_by` | references profiles, set null on delete. Null when a Rococo admin created it. |
| `due_date` | date, nullable. Required when `recurrence` is set. |
| `priority` | `low`, `medium`, `high`. Default `medium`. |
| `recurrence` | null, or `daily`, `weekly`, `biweekly`, `monthly`, `quarterly`, `yearly` |
| `campaign_id` | references marketing_campaigns, nullable, set null on delete |
| `completed_at` | timestamptz, nullable |
| `completed_by` | references profiles, nullable |
| `next_task_id` | references tasks, nullable. Set on a completed copy once its next copy exists. |
| `notified_assignee_id` | the assignee the last assignment email went to, nullable |
| `created_at`, `updated_at` | standard, with the shared `set_updated_at` trigger |

### `public.task_steps`

| Column | Notes |
|---|---|
| `id` | uuid primary key |
| `task_id` | not null, references tasks, cascade |
| `company_id` | not null, copied from the task by trigger |
| `title` | not null, not blank |
| `sort_order` | integer |
| `done_at` | timestamptz, nullable |

### Security

Every policy resolves through the `private` schema helpers. Anon has no grant.

- **Select:** `private.can_manage_company(company_id)`, or `assignee_id = private.auth_profile_id()`.
- **Insert:** an admin of the company, or an employee inserting a task where assignee and
  creator are both themselves and no campaign is set.
- **Update:** an admin, or the assignee.
- **Delete:** an admin, or the creator of a task assigned to themselves.
- **Guard trigger on tasks:** when the caller is not an admin and did not create the task for
  themselves, the only columns that may change are `completed_at` and `completed_by`. A
  non-admin may never set `campaign_id`, change `assignee_id`, or change `company_id`.
- **Campaign check:** a task's campaign must belong to the task's company.
- **Steps:** readable and tickable by whoever can see the task. Adding, renaming, reordering,
  and removing a step follows the task's edit rule. A guard trigger limits a non-editor to
  changing `done_at`.

### Triggers

- **Auto-complete:** after a step is ticked, if every step of the task is ticked, set
  `completed_at`. After a step is unticked on a completed task, clear `completed_at`.
- **Recurrence:** when `completed_at` goes from null to set on a task with a `recurrence` and
  no `next_task_id`, create the next copy and its steps, and store its id in `next_task_id`.
  Runs as security definer, because an employee completing an admin-assigned task could not
  insert the copy themselves.
- **Reopen lock:** clearing `completed_at`, or changing steps, is refused on a task that has a
  `next_task_id`.
- **Move:** changing a profile's company clears that profile from `assignee_id` on tasks.

The recurrence date step is interval arithmetic that lives only in SQL. The app never
computes a next due date. It only labels the repeat.

## Application code

| File | Purpose |
|---|---|
| `src/lib/tasks.ts` | Pure, tested: percent complete, overdue, sort order, repeat labels, campaign progress. |
| `src/services/tasks.ts` | List, get, create, update, delete, complete, reopen, step operations, open count, notify. Throws on error. |
| `src/test/mocks/tasks.ts` | The mock with the same exports, including the auto-complete and recurrence behavior the database triggers provide. |
| `src/pages/tasks/TasksPage.tsx` | The two tabs. |
| `src/pages/tasks/TaskPage.tsx` | One task. |
| `src/pages/MarketingPage.tsx` | Campaign tasks and progress. |
| `src/pages/people/PersonPage.tsx` | The person's open tasks. |
| `src/App.tsx`, nav | Routes and the nav item with its count, behind the module gate. |

Controls use the shared primitives in `components/ui/*`. Colors come from theme tokens only.
Copy is plain, industry neutral, and has no em dashes.

## Assignment email

### When

After a task is created or its assignee changes, when all of these hold: the assignee is not
the person making the change, the assignee has an account (`user_id` is set) and is active,
and `notified_assignee_id` differs from `assignee_id`.

One known limit: the hub sets `user_id` when a person first requests a sign-in link, not when
they first get in. A person in that state counts as having an account.

### How

A new Edge Function, `supabase/functions/notify`, called by the app through `invokeFunction`
after a successful save.

1. The function builds a client from the caller's JWT, as the connections function does.
2. It calls a security definer database function, `claim_task_notification(task_id)`, which
   checks the caller can manage the task's company and the conditions above, sets
   `notified_assignee_id = assignee_id` in one statement, and returns the task title, due date,
   assigner name, company name, and assignee email only when it claimed the send. A second call
   returns nothing, so an email can never go twice for one assignment.
3. The function sends one plain email through the Resend API and returns.

- **From:** `tasks@companyhub.rocococreative.io`, with the company name as the sender name.
- **Content:** who assigned the task, its title, its due date when set, and a link to
  `/tasks/:id`. Plain text and simple HTML, no tracking.
- **Secrets:** `RESEND_API_KEY` and `TASKS_FROM_EMAIL` as Supabase function secrets. Neither
  reaches the browser or Vercel. The function uses no service-role key.

### Failure

Saving the task never depends on the email. If the function call fails, the page keeps the
saved task and shows one line saying the task was saved and the email did not send. If the
browser closes between the save and the call, that email is missed. This trade-off was
accepted in favor of a simpler build than a database-driven queue.

## Testing

- **Unit:** `src/lib/tasks.test.ts` covers percent, overdue, sorting, and campaign progress.
- **Pages:** tests against the mocked data layer for Mine, Everyone, the task page, the
  employee's limits, the campaign tie-in, the nav count, and the module gate (a company
  without `tasks` has no nav item and the routes redirect home).
- **No network in CI.** The notify call is mocked with the rest of the service.
- **Database:** after the migration is applied, the policies and triggers are verified
  against the live project with a scripted set of checks, covering an employee's limits,
  auto-complete, recurrence, the reopen lock, and the claim function.
- **Gates:** `npm run lint`, `npx vitest run`, and `npm run build` pass before each commit.

## Rollout

1. Apply `0036_tasks.sql` in the Supabase SQL editor.
2. Create a Resend API key with sending access, and set the two function secrets.
3. Deploy the `notify` function.
4. Deploy the app.
5. Switch the `tasks` module on for RBA under Rococo, Companies.
