# Task Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-company Tasks module: admins assign tasks with a due date, priority, checklist steps and an optional repeat; people complete them; the assignee gets one email; tasks can attach to a marketing campaign.

**Architecture:** Two tables (`tasks`, `task_steps`) behind RLS, with database triggers owning the rules that must hold from every screen (who may change what, auto-complete, recurrence, the reopen lock). A pure lib computes what screens display. A plain service plus a mock that mirrors it. A small `notify` Edge Function sends the assignment email through Resend.

**Tech Stack:** Vite, React 19, TypeScript, Tailwind v4, Supabase (Postgres, RLS, Edge Functions on Deno), Resend HTTP API, Vitest and Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-11-task-tracker-design.md`

## Global Constraints

- Colors, fonts, radii, and shadows come only from the semantic tokens in `src/index.css`. No hex in a component.
- Controls use the shared primitives in `src/components/ui/*`.
- Services throw; pages catch and show a line from `lib/errors.ts`. No data libraries, no new global store.
- Pages pass `company_id` explicitly and query by it. A record loaded by a URL id goes through `assertInCompany()`.
- Policies resolve through `private.auth_profile_id()`, `private.is_company_member(cid)`, `private.can_manage_company(cid)`. No new function callable through PostgREST.
- Nothing filters people by whether they have an account. `hasAccount()` marks a row only. The one exception the owner chose: the assignment email goes only to people with an account.
- No branch on a company name, slug, or theme key.
- Every file opens with a comment saying why it exists. Components are PascalCase files with `export default function Name()`. No barrel files.
- Copy is calm and plain, industry neutral, with no em dashes and no AI model identifiers.
- The migration is idempotent and append-only: `supabase/migrations/0036_tasks.sql`. `src/types/database.ts` stays in step.
- Tests never touch the network. Every service function has a mock with the same name (`src/test/mocks/parity.test.ts` enforces it).
- The test clock is fixed at 2026-09-15T12:00:00Z (`src/test/setup.ts`).
- Before every commit: `npm run lint`, `npx vitest run`, `npm run build` all pass.

## Review Focus

1. **An employee edits an admin-assigned task through the API directly.** Only completion may change. Pinned by the database checks in Task 1.
2. **A recurring task is completed twice in quick succession (two tabs).** Exactly one next copy exists. Pinned in Task 1 (the trigger acts only when `next_task_id` is null) and the mock test in Task 3.
3. **A task is reassigned.** The new assignee gets one email; saving again without changing the assignee sends none. Pinned in Task 8.
4. **A Rococo admin switches company while a task page is open.** The page shows the not-in-this-company line, not another tenant's task. Pinned in Task 5.
5. **The email service is down or unconfigured.** The task still saves and the page says the email did not send. Pinned in Task 4.

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0036_tasks.sql` | Tables, policies, guard and rule triggers. |
| `src/types/database.ts` | `Task`, `TaskStep`, `TaskWithSteps`, `TaskPriority`, `TaskRecurrence`. |
| `src/lib/tasks.ts` (+ test) | Pure display rules: percent, overdue, sort, labels, campaign progress. |
| `src/lib/modules.ts`, `src/lib/navigation.ts` | The `tasks` module key and nav item. |
| `src/services/tasks.ts` | Data layer. |
| `src/test/mocks/tasks.ts`, `src/test/fixtures.ts` | Mock with the trigger behavior, and fixture tasks. |
| `demo/vite.config.ts` | Add `tasks` to the service alias list. |
| `src/pages/tasks/TasksPage.tsx`, `tasksTabs.ts` | Mine and Everyone. |
| `src/pages/tasks/TaskPage.tsx` | One task. |
| `src/components/tasks/TaskForm.tsx`, `TaskRow.tsx`, `StepList.tsx` | Shared pieces of the two pages, the Marketing page, and the Person page. |
| `src/pages/tasks.test.tsx` | Page tests for the module. |
| `src/pages/MarketingPage.tsx`, `src/pages/people/PersonPage.tsx` | Campaign tasks; a person's open tasks. |
| `src/App.tsx`, `src/components/AppLayout.tsx` | Routes; the nav count. |
| `supabase/functions/notify/index.ts` | The assignment email. |
| `README.md`, `CLAUDE.md` | The module, the function, its secrets. |

---

### Task 1: Schema, policies, and triggers

**Files:**
- Create: `supabase/migrations/0036_tasks.sql`
- Modify: `src/types/database.ts`

**Interfaces:**
- Produces (TypeScript, in `src/types/database.ts`):

```ts
export type TaskPriority = "low" | "medium" | "high";
export type TaskRecurrence = "daily" | "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";
export interface Task {
  id: string; company_id: string; title: string; description: string | null;
  assignee_id: string | null; created_by: string | null; due_date: string | null;
  priority: TaskPriority; recurrence: TaskRecurrence | null; campaign_id: string | null;
  completed_at: string | null; completed_by: string | null; next_task_id: string | null;
  notified_assignee_id: string | null; created_at: string; updated_at: string;
}
export interface TaskStep { id: string; task_id: string; company_id: string; title: string; sort_order: number; done_at: string | null; }
export type TaskWithSteps = Task & { steps: TaskStep[] };
```

- [ ] **Step 1: Write `0036_tasks.sql`**, following the header and section style of `0027_wins.sql`. Contents:

  - `public.tasks` and `public.task_steps` with the columns in the spec. Constraints: title not blank; `priority in ('low','medium','high')`; `recurrence` null or one of the six values; `recurrence is null or due_date is not null`. Indexes on `(company_id, completed_at)`, `assignee_id`, `campaign_id`, `task_steps (task_id, sort_order)`.
  - Grants: `revoke all ... from anon, authenticated; grant select, insert, update, delete ... to authenticated` on both tables.
  - Policies on `tasks`: select `private.can_manage_company(company_id) or assignee_id = private.auth_profile_id()`; insert `private.can_manage_company(company_id) or (assignee_id = private.auth_profile_id() and private.is_company_member(company_id) and campaign_id is null)`; update same as select for `using` and `with check`; delete `private.can_manage_company(company_id) or (created_by = private.auth_profile_id() and assignee_id = private.auth_profile_id())`.
  - Policies on `task_steps`: all four commands allowed when the parent task is visible, written as `exists (select 1 from public.tasks t where t.id = task_id and (private.can_manage_company(t.company_id) or t.assignee_id = private.auth_profile_id()))`. The guard narrows what a non-editor may do.
  - **Internal flag:** rule triggers call `perform set_config('hub.task_internal', '1', true)` before writing, and guards skip their permission checks when `current_setting('hub.task_internal', true) = '1'` or `auth.uid() is null`. PostgREST exposes no way for a client to call `set_config`.
  - `public.guard_task()` BEFORE INSERT OR UPDATE, security definer, `search_path = ''`, execute revoked:
    - Always: on insert `created_by := coalesce(private.auth_profile_id(), new.created_by)`; on update pin `company_id` and `created_by`. Raise when the assignee or the campaign belongs to another company (`'That person belongs to another company.'`, `'That campaign belongs to another company.'`). When `completed_at` goes null to set, `completed_by := private.auth_profile_id()`; when cleared, `completed_by := null`. On update, raise `'The next one is already open.'` when `old.next_task_id is not null` and `completed_at` is being cleared.
    - When checks apply: pin `next_task_id` and `notified_assignee_id` to their old values (null on insert). If the caller cannot manage the company: on update, when `old.created_by` and `old.assignee_id` both equal the caller, `assignee_id` and `campaign_id` must not change; otherwise every column except `completed_at` and `completed_by` must equal its old value, else raise `'Only the person who assigned this task can change it.'`.
  - `public.guard_task_step()` BEFORE INSERT OR UPDATE OR DELETE, security definer: copy `company_id` from the task on insert; pin `task_id` and `company_id` on update. When checks apply: raise `'The next one is already open.'` if the task has a `next_task_id`; if the caller cannot manage the company and is not the task's creator-and-assignee, refuse insert and delete and allow an update to change only `done_at`, else raise `'Only the person who assigned this task can change its steps.'`.
  - `public.sync_task_completion()` AFTER UPDATE OF `done_at` ON `task_steps`: set the flag; when `done_at` went null to set and no step of the task has `done_at is null`, `update tasks set completed_at = now() where id = new.task_id and completed_at is null`; when `done_at` went set to null, `update tasks set completed_at = null where id = new.task_id and completed_at is not null`.
  - `public.recur_task()` AFTER UPDATE OF `completed_at` ON `tasks`, firing when `old.completed_at is null and new.completed_at is not null and new.recurrence is not null and new.next_task_id is null`: set the flag; compute the next due date as `old.due_date + n * step` for the smallest `n >= 1` that lands after `current_date`, where step is 1 day, 7 days, 14 days, 1 month, 3 months, or 1 year; insert the copy (same company, title, description, assignee, created_by, priority, recurrence, campaign; `notified_assignee_id = assignee_id` so no email is ever claimed for it); copy the steps with `done_at` null; set `next_task_id` on the completed row.
  - `public.clear_task_assignee_on_move()` AFTER UPDATE OF `company_id` ON `profiles`, mirroring `clear_milestone_owner_on_move` (0026) with the flag set.
  - `set_updated_at` trigger on `tasks`.

- [ ] **Step 2: Add the types above to `src/types/database.ts`**, beside `MarketingCampaign`, each with a one-line comment naming migration 0036.

- [ ] **Step 3: Apply the migration to the live project** with the Supabase `execute_sql` tool (project `jjdcejevdqpwuastsmpq`), passing the file's exact contents. Run it twice; the second run must succeed, proving it is idempotent.

- [ ] **Step 4: Verify the rules against the live database.** One `execute_sql` call per check, each inside `begin; ... rollback;` so nothing persists. Act as a person with `set local role authenticated; select set_config('request.jwt.claims', json_build_object('sub', '<user_id>', 'role', 'authenticated')::text, true);`. Use an existing RBA admin and an existing RBA employee with accounts, found by query first. Expected results:

| Check | Expected |
|---|---|
| Employee selects tasks | Only rows where they are assignee |
| Employee inserts a task assigned to someone else | RLS error |
| Employee updates `title` on an admin-assigned task | `Only the person who assigned this task can change it.` |
| Employee sets `completed_at` on an admin-assigned task | Succeeds, `completed_by` is the employee |
| Employee ticks both steps of a two-step task | Task `completed_at` set |
| Employee unticks one step | Task `completed_at` null |
| Weekly task, due 2026-10-01, completed | One new open task, due the first date in the 7-day series after today, steps unticked, `notified_assignee_id = assignee_id`, old row's `next_task_id` set |
| Clear `completed_at` on that completed row | `The next one is already open.` |
| Any client sets `notified_assignee_id` | Value unchanged |
| Admin of another company selects | No rows |

- [ ] **Step 5: Run the Supabase security advisors** (`get_advisors`, type `security`) and fix anything new that names `tasks` or `task_steps`.

- [ ] **Step 6: Gates and commit.** `npm run lint && npx vitest run && npm run build`, then commit `Add the tasks schema, policies, and rule triggers (0036)`.

---

### Task 2: Display rules

**Files:**
- Create: `src/lib/tasks.ts`, `src/lib/tasks.test.ts`

**Interfaces:**
- Produces:

```ts
export const PRIORITY_LABELS: Record<TaskPriority, string>;      // Low, Medium, High
export const RECURRENCE_LABELS: Record<TaskRecurrence, string>;  // Daily, Weekly, Every two weeks, Monthly, Quarterly, Yearly
export function percentComplete(steps: Pick<TaskStep, "done_at">[]): number | null;
export function isDone(task: Pick<Task, "completed_at">): boolean;
export function isOverdue(task: Pick<Task, "due_date" | "completed_at">, today: string): boolean; // today is YYYY-MM-DD
export function sortTasks<T extends Pick<Task, "due_date" | "priority" | "created_at">>(tasks: T[]): T[];
export function isLocked(task: Pick<Task, "next_task_id">): boolean;
export function canEditTask(task: Pick<Task, "created_by" | "assignee_id">, me: { profileId: string; isAdmin: boolean }): boolean;
export function campaignProgress(tasks: Pick<Task, "completed_at">[]): { done: number; total: number };
```

- [ ] **Step 1: Write the failing tests** in `src/lib/tasks.test.ts`:

```ts
expect(percentComplete([])).toBeNull();
expect(percentComplete([{ done_at: "x" }, { done_at: null }, { done_at: null }])).toBe(33);
expect(percentComplete([{ done_at: "x" }, { done_at: "y" }])).toBe(100);
expect(isOverdue({ due_date: "2026-09-14", completed_at: null }, "2026-09-15")).toBe(true);
expect(isOverdue({ due_date: "2026-09-15", completed_at: null }, "2026-09-15")).toBe(false);
expect(isOverdue({ due_date: "2026-09-01", completed_at: "x" }, "2026-09-15")).toBe(false);
expect(isOverdue({ due_date: null, completed_at: null }, "2026-09-15")).toBe(false);
// sortTasks: earliest due date first; undated last; same date high before medium before low; then oldest created first
expect(canEditTask({ created_by: "a", assignee_id: "a" }, { profileId: "a", isAdmin: false })).toBe(true);
expect(canEditTask({ created_by: "b", assignee_id: "a" }, { profileId: "a", isAdmin: false })).toBe(false);
expect(canEditTask({ created_by: "b", assignee_id: "c" }, { profileId: "a", isAdmin: true })).toBe(true);
expect(campaignProgress([{ completed_at: "x" }, { completed_at: null }])).toEqual({ done: 1, total: 2 });
```

- [ ] **Step 2:** Run `npx vitest run src/lib/tasks.test.ts`. Expected: fails, module not found.
- [ ] **Step 3:** Implement `src/lib/tasks.ts`. `sortTasks` returns a new array.
- [ ] **Step 4:** Run the test. Expected: passes.
- [ ] **Step 5:** Gates and commit `Add the task display rules`.

---

### Task 3: Service, mock, and fixtures

**Files:**
- Create: `src/services/tasks.ts`, `src/test/mocks/tasks.ts`, `src/test/mocks/tasks.test.ts`
- Modify: `src/test/fixtures.ts`, `demo/vite.config.ts` (add `tasks` to the alias list)

**Interfaces:**
- Produces (same exports in the service and the mock):

```ts
export type TaskInput = { company_id: string; title: string; assignee_id: string | null; description?: string | null;
  due_date?: string | null; priority?: TaskPriority; recurrence?: TaskRecurrence | null; campaign_id?: string | null; steps?: string[] };
export type TaskPatch = Partial<Pick<Task, "title" | "description" | "assignee_id" | "due_date" | "priority" | "recurrence" | "campaign_id">>;
export function listTasks(companyId: string, opts?: { assigneeId?: string; campaignId?: string; status?: "open" | "done" | "all" }): Promise<TaskWithSteps[]>;
export function getTask(id: string): Promise<TaskWithSteps>;
export function countOpenTasks(companyId: string, assigneeId: string): Promise<number>;
export function createTask(input: TaskInput): Promise<TaskWithSteps>;
export function updateTask(id: string, patch: TaskPatch): Promise<TaskWithSteps>;
export function deleteTask(id: string): Promise<void>;
export function completeTask(id: string): Promise<TaskWithSteps>;
export function reopenTask(id: string): Promise<TaskWithSteps>;
export function addStep(taskId: string, title: string): Promise<TaskWithSteps>;
export function renameStep(stepId: string, title: string): Promise<TaskWithSteps>;
export function setStepDone(stepId: string, done: boolean): Promise<TaskWithSteps>;
export function moveStep(stepId: string, direction: "up" | "down"): Promise<TaskWithSteps>;
export function removeStep(stepId: string): Promise<TaskWithSteps>;
export function notifyAssignment(taskId: string): Promise<{ sent: boolean }>;
```

  Every step function returns the whole task re-read, so a page always shows what the triggers decided. `status` defaults to `"open"`. The service selects steps with a nested select, `steps:task_steps(...)`, ordered by `sort_order`. `notifyAssignment` calls `invokeFunction("notify", { task_id })`.

- Fixtures: add `tasks: Task[]` and `taskSteps: TaskStep[]` to the bundle. Turn the `tasks` module on for RBA only in `COMPANIES` (Kingdom has every module through `MODULE_KEYS`, Klasik stays without). For RBA and Kingdom give: one open admin-assigned task to the first employee, due 2026-09-10 (overdue on the test clock), high priority, with three steps, one ticked; one open weekly task to the same employee due 2026-09-18 with two steps; one self-created employee task with no due date; one completed task; one open task for the person who has not signed in; one task attached to the first campaign.

- [ ] **Step 1: Write the failing mock tests** in `src/test/mocks/tasks.test.ts`, which pin that the mock behaves as the database does:

```ts
// ticking the last step completes the task
// unticking a step on a completed task reopens it
// completing a weekly task due 2026-09-18 on the test clock creates one open copy due 2026-09-25 with every step unticked
// completing an overdue weekly task due 2026-09-01 creates a copy due 2026-09-22 (first slot after 2026-09-15)
// completeTask twice on the same recurring task leaves exactly one open copy
// reopenTask on a completed task with next_task_id rejects with "The next one is already open."
// countOpenTasks counts only that person's open tasks in that company
// listTasks(companyId) never returns another company's task
```

- [ ] **Step 2:** Run it. Expected: fails, module not found.
- [ ] **Step 3:** Implement the mock, the service, the fixtures, and the demo alias. The mock's `notifyAssignment` resolves `{ sent: true }`.
- [ ] **Step 4:** Run `npx vitest run src/test/mocks`. Expected: the new tests and `parity.test.ts` pass.
- [ ] **Step 5:** Gates and commit `Add the tasks service, mock, and fixtures`.

---

### Task 4: Tasks page

**Files:**
- Create: `src/pages/tasks/TasksPage.tsx`, `src/pages/tasks/tasksTabs.ts`, `src/components/tasks/TaskForm.tsx`, `src/components/tasks/TaskRow.tsx`, `src/pages/tasks.test.tsx`

**Interfaces:**
- Consumes: Task 2 and Task 3 exports; `listProfiles` from `services/profiles.ts`; `listCampaigns` from `services/marketing.ts`; `hasAccount` from `lib/people.ts`; `friendlyError` pattern from `lib/errors.ts`.
- Produces:
  - `export default function TasksPage({ tab }: { tab: "mine" | "everyone" })`
  - `tasksTabs.ts`: `TASKS_TABS = [{ key: "mine", to: "/tasks", label: "Mine", end: true }, { key: "everyone", to: "/tasks/everyone", label: "Everyone" }]`, in the shape `goalsTabs.ts` uses.
  - `TaskForm({ companyId, people, campaigns, initial, lockAssigneeTo, canSetCampaign, onSaved, onClose })`: a `Modal` used for create and edit. `lockAssigneeTo` hides the assignee picker and fixes the assignee (an employee's own task). Fields: title (required), description, assignee, due date, priority, repeat, campaign, and on create a "Steps" textarea, one step per line. Choosing a repeat with no due date shows "A repeating task needs a due date." and blocks save.
  - `TaskRow({ task, assigneeName, today, showAssignee })`: one row linking to `/tasks/:id`.

- Behavior: Mine lists `listTasks(company.id, { assigneeId: profile.id })`, sorted with `sortTasks`, with a "Show completed" toggle. Everyone (admins only; the tab is not rendered for employees) lists all tasks with selects for person, priority, campaign, and status. After `createTask` or an assignee change, the page calls `notifyAssignment(task.id)` when the assignee is someone other than `profile.id`; a rejection shows `Notice` text "The task was saved. The email did not send." and keeps the task. Loading uses `SkeletonRows`; an empty list uses `EmptyState` with "No open tasks." People without an account are listed in the assignee picker with " · not signed in yet".

- [ ] **Step 1: Write the failing page tests** in `src/pages/tasks.test.tsx`, with the `vi.mock` block from `pages.test.tsx` plus `tasks`:

```ts
// employee on Mine: sees their overdue task marked "Overdue", does not see a coworker's task, sees no "Everyone" tab
// employee adds a task for themselves: it appears in the list, and notifyAssignment is not called
// admin on Everyone: sees tasks for several people, including the person who has not signed in
// admin filters by person: only that person's tasks remain
// admin creates a task for an employee with two steps: row shows "0%", notifyAssignment called once with the new id
// notifyAssignment rejects: the row is still listed and "The task was saved. The email did not send." shows
// repeat chosen with no due date: "A repeating task needs a due date." and createTask not called
```

- [ ] **Step 2:** Run `npx vitest run src/pages/tasks.test.tsx`. Expected: fails, module not found.
- [ ] **Step 3:** Implement the page and the two components.
- [ ] **Step 4:** Run the test. Expected: passes.
- [ ] **Step 5:** Gates and commit `Add the Tasks page`.

---

### Task 5: Task page

**Files:**
- Create: `src/pages/tasks/TaskPage.tsx`, `src/components/tasks/StepList.tsx`
- Modify: `src/pages/tasks.test.tsx`

**Interfaces:**
- Consumes: Task 2, Task 3, `TaskForm` from Task 4, `assertInCompany` from `lib/tenancy.ts`.
- Produces:
  - `export default function TaskPage()`, reading `:taskId`.
  - `StepList({ task, canEdit, locked, onChange })`: checkboxes for every step; when `canEdit`, an add field (`BlurInput` pattern), rename, move up, move down, remove. `onChange(task: TaskWithSteps)` receives the re-read task.

- Behavior: loads `getTask`, then `assertInCompany(task, company.id, "task")`; a failure renders the friendly error, never the task. Shows title, description, assignee, assigned by, due date with an overdue mark, priority, repeat label, campaign name (admins), and percent complete when there are steps. "Mark complete" and "Reopen" for the assignee and admins. "Edit" and "Delete" (with `ConfirmDialog`) when `canEditTask`. When `isLocked(task)`: no Reopen, steps read-only, and the line "This one is done. The next one is already open." After completing a repeating task, the page links to the new copy. Delete returns to `/tasks`.

- [ ] **Step 1: Add the failing tests:**

```ts
// employee opens their admin-assigned task: can tick a step, sees no Edit or Delete
// ticking the last step shows the task as complete
// employee opens their own self-created task: sees Edit and Delete
// admin completes a weekly task: a link to the next one appears; the completed page shows "The next one is already open." and no Reopen
// a task id from another company renders "That task is not in this company." and none of the task's title
// admin deletes a task after confirming: lands on /tasks and the task is gone from listTasks
```

- [ ] **Step 2:** Run. Expected: fails.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: passes.
- [ ] **Step 5:** Gates and commit `Add the task page`.

---

### Task 6: Module gate, routes, and the nav count

**Files:**
- Modify: `src/lib/modules.ts`, `src/lib/modules.test.ts`, `src/lib/navigation.ts`, `src/lib/navigation.test.ts`, `src/App.tsx`, `src/components/AppLayout.tsx`, `src/pages/tasks.test.tsx`

**Interfaces:**
- Consumes: `TasksPage`, `TaskPage`, `countOpenTasks`.
- Produces:
  - `MODULE_KEYS` gains `"tasks"` (last). Label `Tasks`. Description: `Tasks assigned to people, with due dates, steps, and repeats, and the tasks behind each marketing campaign.`
  - `NAV_ITEMS` gains `{ id: "tasks", to: "/tasks", label: "Tasks", icon: ListChecks, audience: "both", group: "home", requires: "tasks" }` after `wins`.
  - Routes: `tasks` → `<ModuleOnly module="tasks"><TasksPage tab="mine" /></ModuleOnly>`; `tasks/everyone` → the same inside `AdminOnly` with `tab="everyone"`; `tasks/:taskId` → `<ModuleOnly module="tasks"><TaskPage /></ModuleOnly>`. `tasks/everyone` is declared before `tasks/:taskId`.
  - `AppLayout` shows a small count beside the Tasks item: `countOpenTasks(company.id, profile.id)`, loaded when the company has the module and the viewer is not a Rococo admin, refreshed on route change. Zero shows nothing. A failed count shows nothing.

- [ ] **Step 1: Add the failing tests:**

```ts
// modules.test: "tasks" is a module key with a label and a description
// navigation.test: the Tasks item shows for an admin and an employee of a company with the module, and for neither without it
// tasks.test (AppLayout): an RBA employee sees "Tasks" with their open count; a Klasik employee sees no "Tasks" item
// tasks.test: ModuleOnly redirects /tasks to Home for a company without the module
```

- [ ] **Step 2:** Run. Expected: fails.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the full suite. Fix any existing test that counted module keys or nav items.
- [ ] **Step 5:** Gates and commit `Put Tasks behind a module, with routes and the nav count`.

---

### Task 7: Marketing and Person tie-ins

**Files:**
- Modify: `src/pages/MarketingPage.tsx`, `src/pages/people/PersonPage.tsx`, `src/pages/tasks.test.tsx`

**Interfaces:**
- Consumes: `listTasks`, `campaignProgress`, `TaskRow`, `TaskForm`, `hasModule`.

- Behavior: both additions render only when `hasModule(company, "tasks")`. On Marketing, each campaign shows "N of M tasks done" and, expanded, its tasks as `TaskRow`s plus "Add a task", which opens `TaskForm` with the campaign pre-filled. Tasks load once with `listTasks(company.id, { status: "all" })` and are grouped by `campaign_id` in the page. On the Person page, a "Tasks" section lists `listTasks(company.id, { assigneeId: person.id })` with a link to each, and "No open tasks." when empty.

- [ ] **Step 1: Add the failing tests:**

```ts
// Marketing with the module: the first campaign shows "0 of 1 tasks done"; adding a task from the campaign raises it to "0 of 2"
// Marketing without the module (Klasik): no task count text
// Person page with the module: the employee's open tasks are listed
// Person page for someone not signed in yet: their task is listed
```

- [ ] **Step 2:** Run. Expected: fails.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: passes.
- [ ] **Step 5:** Gates and commit `Show tasks on campaigns and on a person`.

---

### Task 8: Assignment email

**Files:**
- Create: `supabase/functions/notify/index.ts`
- Modify: `README.md` (functions section), `CLAUDE.md` (hard rule 6 gains one sentence on `notify`)

**Interfaces:**
- Consumes: `notifyAssignment` already calls `invokeFunction("notify", { task_id })`.
- Produces: `POST /functions/v1/notify` with body `{ task_id: string }`, answering `{ sent: boolean }` or `{ error: string }`. Deployed with the gateway JWT check on.

- Behavior, in order. The file is self-contained and follows `supabase/functions/connections/http.ts` for CORS, the user client, and the service client.
  1. Answer `OPTIONS` with CORS headers.
  2. Build a client from the caller's JWT. Read the caller's profile (`id, full_name, is_active`). No profile or inactive: 403.
  3. Read the task through the caller's client (`id, company_id, title, due_date, assignee_id`). Not visible: 404.
  4. `assignee_id` null or equal to the caller's profile id: answer `{ sent: false }`.
  5. With the service client, read the assignee (`email, user_id, is_active`) and the company name. No `user_id` or inactive: answer `{ sent: false }`.
  6. Claim, with the service client, in one statement: update `notified_assignee_id` to the assignee where `id` matches, `assignee_id` still equals that assignee, and `notified_assignee_id` is null or a different person; select the row back. No row returned: answer `{ sent: false }`.
  7. Send through `https://api.resend.com/emails` with `RESEND_API_KEY`. From: `"<company name>" <TASKS_FROM_EMAIL>`. Subject: `New task: <title>`. Text body:

```
<assigner name> assigned you a task.

<title>
Due <Month D, YYYY>            (line omitted when there is no due date)

Open it: <APP_URL>/tasks/<id>
```

     The HTML body carries the same three facts with the link as a plain anchor, values HTML-escaped. `APP_URL` is the first entry of the `APP_ORIGINS` secret the connections function already uses.
  8. If Resend answers an error, release the claim (set `notified_assignee_id` back to null) and answer 502 `{ error: "The email service did not accept the message." }`.
  9. Missing `RESEND_API_KEY` or `TASKS_FROM_EMAIL`: 503 `{ error: "Task emails are not set up yet." }`, checked before the claim.

- [ ] **Step 1: Write the function.**
- [ ] **Step 2: Create the Resend key.** List domains with the Resend connector to get the id of `companyhub.rocococreative.io`, then create an API key named `Company Hub task emails`, `sending_access`, restricted to that domain. The token goes straight into the secret in the next step and is not written to any file or commit.
- [ ] **Step 3: Set the function secrets** with the Supabase connector: `RESEND_API_KEY` (the new token) and `TASKS_FROM_EMAIL` = `tasks@companyhub.rocococreative.io`.
- [ ] **Step 4: Deploy `notify`** with the Supabase connector, JWT verification on.
- [ ] **Step 5: Verify live, without sending.** Call the function with no Authorization header: expect 401 from the gateway. Confirm in the Edge Function logs that the function booted.
- [ ] **Step 6: Document.** README: the function, who may call it, its two secrets, the deploy command `supabase functions deploy notify`. CLAUDE.md rule 6: one sentence saying `notify` sends the task assignment email through Resend and is the only place the Resend key lives.
- [ ] **Step 7:** Gates and commit `Send the task assignment email`.

---

### Task 9: Visual check and handoff

- [ ] **Step 1:** Run `npm run demo`, open Tasks as an RBA admin and as an RBA employee, at desktop and phone widths, and screenshot Mine, Everyone, a task with steps, and the Marketing campaign tasks. Fix anything that breaks the quiet design rules (hairline borders, dense rhythm, tokens only).
- [ ] **Step 2:** Full gates one more time, push the branch.
- [ ] **Step 3:** Report to the owner: what is live in the database and function already, what goes live when the branch is merged and deployed, and the one switch left for them (turning the Tasks module on for RBA under Rococo, Companies), followed by a real assignment to confirm the email arrives.
