# Project assistant

**Status: designed, not built.** Shelved on 2026-09-15 for a future round. Nothing in this
document has been implemented. The reference SQL below is written as `0013`, which has since
been taken: take the next free number in `supabase/migrations/` when you build this, and check
the schema against what is there now rather than against this document. Read `CLAUDE.md` and
`README.md` first; everything here obeys those rules and this document does not override them.

This is the full specification for a per-company to-do module, designed for Kingdom Custom
Construction. It exists so the next session can build it without re-deciding anything. Where a
decision was close, the rejected option and the reason are recorded, so a future reader can
reopen it deliberately rather than by accident.

## The request

> For Kingdom Custom Construction, make a Project assistant setting for a to do list as part of
> the dashboard, where Project managers can create a to do for the assistant and it auto updates
> based on importance and location.

"The assistant" is the human project assistant or coordinator who runs errands between jobsites,
suppliers, counters, and the office. Not an AI. "Auto updates" means the list re-orders and
re-groups itself as facts change, so the person working it never has to plan the day by hand.

## What it is

Anyone at the company files an item in about fifteen seconds: a sentence, a place, a day. Two
toggles capture the facts that actually decide urgency, which are whether somebody is standing
around waiting and whether a client is waiting on an answer. The list then plans itself into five
blocks, described under "The ordering rule" below.

Places are a real list the company keeps rather than typed text, so "Lot 14 Silverbrook" is one
stop and not three. The module is switched on per company by Rococo, so Klasik can have it later
with one checkbox and no code.

## Decisions

Each of these was contested during design. The rejected alternative is recorded next to it.

### The module is gated by `companies.modules`, an untyped `text[]`

The gate has to live on the company row because `AppLayout` fetches nothing and reads only
`useHub()`, so a gate stored in its own table cannot reach the sidebar without a new fetch and
its own loading and error branches. An array rather than a boolean per module means module two
costs one string instead of a migration. There is deliberately no check constraint: constraining
the list reintroduces a migration per module, which is the cost the array exists to avoid. The
typed registry in `src/lib/modules.ts` and the Rococo-only editor are the guards, which is the
same trade `companies.theme_key` already makes.

Rejected: a boolean column per module, a check-constrained array, and a `company_modules` table
which is more principled and cannot reach the sidebar.

**No component may ever branch on `company.slug`.** `hasModule(company, key)` is the only reader
of the array.

### Location is a table, not a free-text column

Grouping a run needs identity. "Lot 14 Silverbrook", "Silverbrook Lot 14", and "Silverbrook" are
one place typed three ways, and batching the run is the entire request. Free text plus a
normalized key is genuinely cheaper and upgrades cleanly, but it fails on exactly the names a
custom builder uses, which are client names on lots. The non-jobsite stops, the permit counter
and the lumberyard and the office, repeat harder than the lots do.

Rejected: free text with a `locationKey`, which won the cost review and loses on the real names.

### No projects table

Nothing in the hub has a project concept, and a projects table promises budgets, schedules, and
draws that nobody is funding. More concretely, `0006_seed_companies.sql` notes Kingdom's domain
is confirmed because an existing Kingdom estimating tool uses it, so Rococo has already shipped
them a tool that almost certainly names the same lots. Two divergent lists of job names is the
fastest way to make this module untrusted. A place row with `kind = 'site'` carries the name,
address, and area, which answers "what is open on Silverbrook" and seeds a real project entity
later if forty lots ever justify one.

### Anyone can file; only managers change how important something is

Kingdom has exactly one admin, the owner. The person doing the project manager job day to day is
a superintendent, an employee. An admin-only insert policy would lock out the very person the
feature is for, and the failure would be a silently rejected insert rather than a missing button.
So insert resolves through `private.is_company_member`.

The importance facts are protected on update by a guard trigger instead. The split is by what
each person actually knows:

- **The manager owns** what the task is and how much it matters: `title`, `detail`, `place_id`,
  `pickup_place_id`, `assignee_id`, `priority`, `is_blocking`, `blocking_note`, `client_waiting`.
- **The person working the list owns** what they learn firsthand: `status`, `waiting_on`,
  `follow_up_on`, `due_on`, `due_time`, `window_kind`, `location_note`, `pickup_done`,
  `done_note`.
- **The filer owns what they filed.** Whoever created a row can edit all of it. Without this, the
  superintendent can file a task and then never touch it again, which defeats the widened insert
  policy.

`window_kind` sits with the person working the list on purpose: they are the one who learns the
inspector's slot. That does mean a fake fixed window is the strongest available lever on the
ordering. It is visible to the manager in the pinned strip, which is judged sufficient. If it
ever matters, move `window_kind` to the manager set and leave `due_time` with the assistant.

### A fetch-and-deliver errand is one row, not two

One row with `pickup_place_id` and a `pickup_done` boolean. It sits in the supplier's group until
the box is in the truck, then moves to the destination's group. Two legs duplicates the row into
both stops and makes every count ambiguous. Filing it permanently under the pickup leaves it
sitting at a supplier the assistant already left.

### Anchors are pinned, not sorted inline

A fixed appointment with a clock time is lifted into its own strip at the top of the day and
echoed back into its stop's header as "9:00 anchor here". Sorted inline, a nine o'clock inspection
and a batching decision argue over the same slot. Pinned, the strip gives the shape of the day in
two lines and the run below it is free to order by urgency.

### The soon window defaults to three days and is a per-company setting

Seven days swallows the week into one band and makes the while-you-are-there list too long to
read on a phone. Two is probably too tight for a supplier run. Three is a defensible middle, and
it is one integer on `assistant_settings` passed into the pure module as `opts.soonDays`, so
retuning it is a settings field rather than a code change.

### One visible name

"Project assistant" in the nav, the page header, the dashboard card, the Rococo checkbox, and
`MODULE_LABELS`. The first draft called it "To-dos" in the nav and "Project assistant" everywhere
else, which is three names for one thing.

## The ordering rule

All of it lives in `src/lib/assistant/ordering.ts`. Pure, no clock read inside, no SQL, no sort
callback in a component. This is `CLAUDE.md` rule 6 applied to ranking: the math lives in one
tested place.

```
planDay(
  tasks: AssistantTask[],
  places: AssistantPlace[],
  now: Date,
  opts: { soonDays: number },
): DayPlan
```

Date-only values parse through `parseDate` from `src/lib/format.ts` so a date never shifts a day,
and today is `toDateOnly(now)`.

### Derived helpers

- **`dueAt(task)`**: null when `due_on` is null. Otherwise `parseDate(due_on)` with `due_time`
  applied when set, and 23:59:59.999 local when `due_time` is null. `due_time` arrives from
  PostgREST as `"09:00:00"`; parse `HH:MM:SS`, tolerate `HH:MM`, and set hours, minutes, and
  seconds on the local date. Do not string-slice.
- **`isAnchor(task)`**: `window_kind === "fixed"` AND `due_time` is not null. An anchor is a
  commitment on somebody else's clock.
- **`groupKeyFor(task)`**: the pickup place while `pickup_place_id` is set and `pickup_done` is
  false, otherwise `place_id`. A null result is the Anywhere group. A `place_id` that does not
  resolve in the places array also lands in Anywhere. **A task is never dropped**, because a
  deactivated place would otherwise make open work vanish silently.

### Step 1: band

`bandOf(task, now, soonDays)`, first match wins.

1. `done` when status is `done` or `cancelled`.
2. `waiting` when status is `waiting` AND `follow_up_on` is set AND `follow_up_on` is after today.
   A waiting item with no follow-up date, or one whose date has arrived, falls through to the
   rules below and rejoins live work on its own. **That is the whole of the auto-update
   behaviour: the clock moves, the row does not, nothing is written, and there is no job.**
3. `rebook` when `isAnchor` AND the appointment is properly missed, which means `dueAt` is before
   the start of today, or `dueAt` is more than `REBOOK_GRACE_HOURS` past. A strict `dueAt < now`
   moves a nine o'clock inspection into "needs a new plan" at 9:00:01 while the assistant is
   standing in the driveway with the inspector. Also rebook any `window_kind = "fixed"` task whose
   `due_on` is before today even with no time set, because that is what people mean by fixed.
4. `today` when `dueAt` is set AND `due_on` is on or before today.
5. `today` when `is_blocking` AND (`due_on` is null OR `due_on` is within the soon window). The
   second half is the guard that stops "blocking" becoming the new "high": a blocker dated three
   weeks out means nobody is idle yet.
6. `soon` when `due_on` falls between tomorrow and today plus `soonDays`, inclusive.
7. `later` otherwise.

### Step 2: order within a band

`compareTasks(a, b, now)` compares this tuple ascending, first difference wins. Every element is
a number or a string, so the order is **total**, which is what lets tests assert an exact id
sequence rather than a relation.

| # | Element | Value |
|---|---|---|
| 0 | anchorRank | `isAnchor ? 0 : 1` |
| 1 | anchorAt | `isAnchor ? dueAt.getTime() : 0` |
| 2 | blockingRank | `is_blocking ? 0 : 1` |
| 3 | clientRank | `client_waiting ? 0 : 1` |
| 4 | dueMs | `dueAt?.getTime() ?? MAX_SAFE_INTEGER` |
| 5 | priorityRank | high 0, normal 1, low 2 |
| 6 | sort_order | ascending |
| 7 | created_at | ISO string compare |
| 8 | id | string compare |

Priority sits fifth on purpose. A manager marks everything high, so it is the gut-call tiebreak
and never the driver. Elements 6 to 8 exist only to make the order total.

### Step 3: the plan

`planDay` returns `{ plannedAt, rebook, anchors, anywhere, run, later, waiting, doneToday }`.

- **rebook**: band `rebook`, by `dueAt` ascending then `compareTasks`.
- **anchors**: band `today` **or** `soon` AND `isAnchor`, by `dueAt` then `compareTasks`, rendered
  with a day divider so tomorrow's booked slot is visible without pretending it is today.
  Anchors are excluded from `anywhere` and `run` so nothing is listed twice. The first draft
  scoped this to band `today` only, which made a booked inspection dated tomorrow appear in no
  array at all. A coverage invariant test guards it: for any input, every task appears in exactly
  one output array.
- **anywhere**: band `today` or `soon`, `groupKeyFor` null, not an anchor. Band first, then
  `compareTasks`. Rendered in a fixed position above the run, because clearing calls from the
  driveway before starting the truck is how the day actually runs.
- **run**: band `today` or `soon`, `groupKeyFor` set, not an anchor, grouped by `groupKeyFor`.
  Each group is `{ key, place, today, soon, anchorAt }`. Group order: groups holding a `today`
  item come before groups holding only `soon` items, then by `compareTasks` of the group's first
  item, then `place.sort_order`, then `place.name.localeCompare`. `anchorAt` echoes the earliest
  anchor at that stop into the header.
- **later**: band `later`, by `dueAt` ascending with nulls last.
- **waiting**: band `waiting`, by `follow_up_on` ascending with nulls last.
- **doneToday**: status `done` and `completed_at` is today, newest first.

### Stability

The page holds `plannedAt` in `useState`, set once on mount, and derives the plan in a `useMemo`
over the data and `plannedAt`. Saves fold the returned row back through the upsert helper and
re-derive, so the list reacts to a tap the reader just made. Nothing else redraws it: no
interval, no animated reorder. The header carries a quiet "Planned at 7:12 AM" line, a Refresh
control, and a count of rows created since. Rows moving between the moment somebody reads item
three and the moment they tap it is how a phone list loses trust.

Exported for test: `dueAt`, `isAnchor`, `groupKeyFor`, `bandOf`, `compareTasks`, `planDay`,
`DEFAULT_SOON_DAYS = 3`, `REBOOK_GRACE_HOURS`.

## Worked example

Kingdom, Thursday 17 September, 7:05 AM, `soonDays = 3`. Places: Lot 14 Silverbrook (site),
Southside Supply (supplier), County permit counter (agency).

| Filed | Where | Facts |
|---|---|---|
| A. Call in the framing inspection for Lot 9 | none | no date, blocking, "framing crew of four waiting" |
| B. Foundation inspection walk | Lot 14 | Sep 17, 09:00, fixed |
| C. Pick up cabinet hardware, drop at Lot 14 | pickup Southside, drop Lot 14 | Sep 17, blocking, "trim carpenter Friday" |
| D. Drop the revised plan set | County counter | Sep 17, 14:00, fixed, high priority |
| E. Photograph framing for the draw | Lot 14 | Sep 19, low priority |

What comes out:

- **Needs a new plan**: empty, not rendered.
- **Pinned today**: B at 9:00 Lot 14, then D at 2:00 PM County counter.
- **From anywhere**: A, leading because blocking is element 2 of the tuple.
- **The run**: Southside Supply holding C, because `pickup_done` is false. Then Lot 14, header
  "9:00 anchor here", holding E under a "while you are there" divider.
- **Later, Waiting, Done today**: empty.

Then watch it work. Tap "Picked up" on C: `groupKeyFor` now returns Lot 14, Southside empties and
disappears, and Lot 14 jumps to the top of the run because it now holds a `today` item. Set C to
waiting with a Friday follow-up: it leaves the run entirely, and Friday morning rule 2 stops
matching, so it returns at the top by itself with nothing written.

Two things this shows on purpose. D is the only high-priority row and priority decided nothing,
because D is pinned by its clock. E is the lowest-priority row and it still surfaces, because it
sits at a stop the assistant is already going to, which is the entire point of grouping by place.

## Files

New:

| Path | Purpose |
|---|---|
| `supabase/migrations/00NN_project_assistant.sql` | The whole schema. Number it next in sequence at build time. |
| `src/lib/modules.ts` | The module registry, written like `src/lib/theme.ts` one level up: `ModuleKey`, `MODULE_LABELS`, `MODULE_KEYS`, `hasModule`. The only reader of the array. |
| `src/lib/modules.test.ts` | Pins `hasModule` against null, empty, present, and an unknown string. |
| `src/lib/assistant/ordering.ts` | The whole ordering rule, pure. |
| `src/lib/assistant/ordering.test.ts` | One describe per exported function, exact id sequences. |
| `src/services/assistant.ts` | Places, tasks, settings. Plain async functions that throw. |
| `src/test/mocks/assistant.ts` | Hand-written twin with the identical export surface. |
| `src/pages/assistant/AssistantPage.tsx` | The working surface. A list of bordered cards at every width, never a table. |
| `src/pages/assistant/AssistantSettingsPage.tsx` | Admin only. Default assignee, soon window, the place book. |
| `src/components/assistant/TaskCard.tsx` | Full-width done label wrapping the shared checkbox at `min-h-[44px]`. |
| `src/components/assistant/QuickAdd.tsx` | The fifteen-second path. Inline, not a dialog. |
| `src/components/assistant/TaskDialog.tsx` | The full record form, modelled on `CampaignDialog`. |
| `src/components/assistant/PlacePicker.tsx` | Type-ahead over existing places that surfaces matches before offering to create, with a near-match warning. A select is a scroll on a cracked screen. |

Edited:

| Path | Change |
|---|---|
| `src/types/database.ts` | `Company.modules`. New unions and interfaces, label maps in the Labels section. |
| `src/services/companies.ts` | `modules` on the `COLUMNS` string and on `CompanyPatch`. **Missing the COLUMNS edit is the silent failure**: PostgREST returns only named columns, the flag reads `undefined`, and the module disappears with no error and no failing test. |
| `src/test/mocks/companies.ts` | Mirror both edits, plus `modules: []` in the `createCompany` literal. |
| `src/test/fixtures.ts` | `modules` on the COMPANIES rows. Optional `places`, `tasks`, and `assistantSettings` on `CompanySpec`, filled only for `co-kingdom`. Two bundle fields. Kingdom's people reordered so the coordinator is `profiles[1]`, because `personaProfile` maps the employee persona there and the demo has to show the assistant's own run. Export `KINGDOM` beside `KLASIK`. |
| `src/components/status.ts` | `TASK_STATUS_TONE`, `TASK_PRIORITY_TONE`, `BAND_TONE` keyed on the `Band` type imported from the ordering module, the way `GOAL_OUTCOME_TONE` already imports from `lib/gsr/goals.ts`. |
| `src/App.tsx` | A `ModuleOnly` guard in the shape of the existing three, and two routes. |
| `src/components/AppLayout.tsx` | `NavItem.requires?: ModuleKey` and one predicate covering both nav arrays. |
| `src/pages/DashboardPage.tsx` | An admin card in the right column, its service call added to the existing `Promise.all` behind a `hasModule` ternary so Klasik and RBA never fire it. A separate card in `EmployeeDashboard` showing the viewer's own run. |
| `src/pages/rococo/CompaniesPage.tsx` | A checkbox per `MODULE_KEYS` beside the theme select. This is where Klasik gets turned on later. |
| `src/pages/CompanySettingsPage.tsx` | One read-only pair in the "Managed by Rococo" section, rendering `EMPTY` when the list is empty. |
| `demo/vite.config.ts` | Add `assistant` to the alias alternation. Missing this breaks `npm run demo` with all three CI gates green, because `demo/` is in no tsconfig include. |
| `src/pages/pages.test.tsx` | One `vi.mock` line and a new describe block. |
| `src/App.rococo.test.tsx` | One `vi.mock` line. This is the file people forget; without it the real service runs against the mocked client and the page renders an error Notice, which reads as a content failure rather than a missing mock. |
| `CLAUDE.md` | Name the Project assistant as the first per-company module, and state that a module is gated by a key in `companies.modules`, read only through `src/lib/modules.ts`, owned by Rococo, and that no component may branch on `company.slug`. Hard rule 1 currently ends "A new tenant is a new theme block plus a `theme_key`, nothing else", which stops being true. |
| `README.md` | One row in the module table, one line in the migration order. |

## Build order

Each step ends green on `npm run lint`, `npx vitest run`, and `npm run build`.

1. **Migration.** Paste it into the Supabase SQL editor twice to prove it is idempotent. Verify
   Kingdom shows `modules = {assistant}` and the others show `{}`. Then sign in as a Klasik admin
   and rename the company, which proves the rebuilt `guard_company_fields` still works for
   everyone. See the trap under "Known traps" below.
2. **Types.** Row types, unions, label maps, `Company.modules`.
3. **`src/lib/modules.ts` and its test.**
4. **`src/lib/assistant/ordering.ts` and its test.** The whole rule with no UI anywhere near it.
   This step is the feature; everything after it is plumbing.
5. **`companies.ts` COLUMNS and CompanyPatch**, mirrored in the mock.
6. **Service, mock, demo alias, and both `vi.mock` lines, together.** Three of the four are
   invisible to CI.
7. **Fixtures**, including the Kingdom people reorder. The suite is the check on that reorder,
   since `department` and `reports_to` are assigned by list index in `build()`.
8. **Tone maps.**
9. **Components and `AssistantPage`.**
10. **`AssistantSettingsPage`.**
11. **Shell**: the guard, the routes, the nav predicate.
12. **Dashboard cards.** The existing Klasik dashboard tests passing proves the Kingdom-only call
    never fires there.
13. **Rococo checkbox and the read-only settings line.**
14. **Docs and a full demo walk** as `?persona=admin&company=kingdom`, then
    `?persona=employee&company=kingdom`, then `?company=klasik` to confirm the module is invisible.

## Tests

Unit, in `ordering.test.ts`:

- A fixed window missed yesterday lands in rebook; a soft target that slipped by a day lands in
  today.
- A nine o'clock anchor at ten o'clock is still pinned today, not a rebook.
- Blocking with no date is today; blocking dated past the soon window stays in later.
- A waiting item with a future follow-up stays waiting; one whose date arrived rejoins; one with
  no follow-up date rejoins immediately.
- The soon window is inclusive at both ends.
- Three items all marked high sort by due time, proving priority is a tiebreak.
- Blocking with no date outranks client-waiting at 4pm, which outranks a plain item at 4pm.
- Two rows identical in every ranked field come out in `created_at` order, then id order.
- `groupKeyFor` returns the pickup while `pickup_done` is false and the destination once true,
  and never both.
- The five-item worked example returns the exact id sequence, then the second exact sequence
  after `pickup_done` flips.
- **Coverage invariant**: every task appears in exactly one output array, for every input.
- A task whose `place_id` is not in the places array lands in Anywhere and is not dropped.
- Edges: empty list, done items filtered before banding, an anchor dated tomorrow appearing once.

Page, in `pages.test.tsx`:

- Renders for a Kingdom admin hub with a real fixture task title, the anchors strip, and a place
  group header.
- Renders for a Kingdom employee hub with quick add and the done control, without the admin-only
  delete action.
- Moving a task to waiting removes it from the run and shows it under waiting, **asserted on a
  task the test created through quick add**, never on a seeded row and never on a section count.
  The mock arrays are module-level and mutated across the file with no reset.
- The settings page renders the place book and the default assignee select for an admin.
- A Kingdom admin dashboard shows the card and a Klasik admin does not, which is the gate proven
  at the page level.

In `App.rococo.test.tsx`: the nav entry is present after stepping into Kingdom and absent for a
Klasik hub.

**Keep the fixtures clock-independent.** `src/test/fixtures.ts` has zero calls to `new Date()` and
anchors everything on an absolute `NOW`. A Kingdom task with an absolute `due_on` drifts into a
different band as real time passes, and the suite starts failing on its own within weeks. Build
the fixture tasks so their band is fixed by construction: blocking with a null `due_on` is always
today, non-blocking with a null `due_on` is always later, waiting with a null `follow_up_on` is
always live. Assert on titles and group headings, not on which band a dated row landed in.

## Known traps

These were found by review before any code was written. Do not rediscover them.

1. **`guard_company_fields` must be rebuilt from the 0009 body, not the 0001 body.** The live
   function is the one at `0009_private_helpers.sql`, which calls `private.is_rococo_admin()`.
   The `public.is_rococo_admin` that 0001's body calls no longer exists; the `SET SCHEMA` loop in
   0009 moved it. Copying 0001 ships a function that raises on every company update for all three
   tenants, and no CI gate notices.
2. **Trigger firing order is load-bearing.** Postgres fires `BEFORE` row triggers in
   trigger-name alphabetical order, so `assistant_tasks_guard_fields` runs before
   `assistant_tasks_stamp`. Folding the company check and the `completed_at` stamp into one
   function keeps the two from disagreeing. Leave the comment in the migration explaining it.
3. **`completed_at` needs a trigger.** `doneToday` depends on it, and if the status select writes
   only `{ status: "done" }` the task leaves every live band and appears nowhere. That is exactly
   the "is it done or did I lose it" moment the list exists to prevent.
4. **Do not extract a shared filter chip in this change.** The chip class string is copy-pasted in
   four places today. Adopting a new primitive into Resources, SOPs, and Financials inside a
   feature change touches pages every Klasik and RBA user opens, for a module neither company can
   see, with no visual regression coverage in the suite. Copy it a fifth time, note it in the
   commit message, and extract it in a commit whose whole job is that.
5. **Do not change `src/components/ui/forms.ts` for the iOS focus-zoom defect.** Every input is
   14px and mobile Safari zooms whenever a focused field is under 16px. It is real and it will
   bite here first, since this is the first module designed for a phone in a truck. The fix
   touches every control on every page in all three tenants and deserves its own reviewable
   commit. What this module does locally is make the done control a full-row label at
   `min-h-[44px]`.

## Open questions for Kingdom

None of these block the build. Each has a default that is cheap to change later.

| Question | Why it matters | Default |
|---|---|---|
| Do lot names need to match the estimating tool exactly? | Rococo already shipped Kingdom a tool that names the same lots. If the two lists drift, people stop trusting whichever one they are not looking at. | Kingdom names their own stops in the settings page the first week. Nothing is seeded, so nothing has to be unpicked, and lining the lists up later is renaming a handful of rows. |
| How far ahead is "while you are already there"? Three days or the week? | The only number in the ordering rule. Too high and every stop shows a long list nobody reads past. Too low and the assistant drives back to the same supplier on Friday. | Three days. It is a settings field, changeable in five seconds. |
| Does everyone see the whole list? | A shared list works because the superintendent can see the inspection is booked without texting anyone. It also means everything filed there is visible company-wide, so it is the wrong place for anything sensitive. | Everyone at the company sees everything. Narrowing it later is one clause in one policy. |
| Is a written note enough to close something out, or does the owner want a photo? | If a note is not enough he re-asks, and once he is re-asking the list has stopped saving time. | A written note. Photos are first in the deferred list. |

## Deferred

Each has the trigger that would pull it forward.

- **Photo evidence** on a closed item, in the existing private `hub-files` bucket at
  `{company_id}/assistant/{task_id}/`, read through expiring links. Trigger: the first time a
  manager re-asks about something the list already says is done.
- **Coarse route order** using the `area` field the places table already carries, so stops of
  equal urgency come out in driving order rather than alphabetically. Trigger: roughly a dozen
  live stops, or anyone saying the run still zigzags.
- **Per-stage checklists** that file the same handful of items every time a job reaches framing or
  drywall, hung off the SOP library rather than a recurrence engine. Kingdom's Foundation
  inspection SOP already documents the hold points and who calls the inspector.
- **Counts on the monthly review**: items closed on time, and items where a client was waiting, as
  evidence for Kingdom's Client Communication and Field Execution pillars. Counts only, never a
  score, because scoring math lives in `src/lib/gsr/scoring.ts` and nowhere else.
- **Turn the module on for Klasik**, who have both a Project Manager and an Office Manager running
  the same errands. Trigger: one checkbox. No code, no migration, no deploy, which is the whole
  reason the gate is built this way.

## Appendix: the migration

Reference implementation, with the review fixes applied. Renumber at build time and paste it into
the Supabase SQL editor twice to confirm it is idempotent.

```sql
-- 00NN_project_assistant.sql
-- The Project assistant module: a shared to-do list for the person who runs errands between
-- jobsites, suppliers, counters and the office. Three tables (assistant_places, the company's
-- own list of stops; assistant_tasks, the work; assistant_settings, the one configuration row)
-- plus a per-company module switch on companies.modules that only Rococo can change.
--
-- The database stores facts and nothing else. Which item comes first, how the day groups by
-- place, and when a waiting item comes back are all computed in src/lib/assistant/ordering.ts,
-- pure and unit tested, the way scoring.ts and goals.ts already work. There is no view here,
-- no generated column, and no function that computes a business value.
--
-- Paste after the previous migration; idempotent.

-- 1. The module switch, on the row the shell already loads. ------------------------------
alter table public.companies
  add column if not exists modules text[] not null default '{}'::text[];

-- No check constraint on purpose: constraining the list means a migration per module, which is
-- the cost the array exists to avoid. The registry in src/lib/modules.ts and the Rococo-only
-- editor are the guards, the same trade companies.theme_key already makes.

-- Rococo owns which modules a company has, the way it owns slug and theme. This is the 0009
-- body (which calls private.is_rococo_admin; the public helper was moved away by 0009) with the
-- new column added. The companies_guard_fields trigger from 0001 already points here.
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
       or new.modules is distinct from old.modules then
      raise exception 'Only Rococo admins can change a company slug, theme, or modules.';
    end if;
  end if;
  return new;
end;
$$;

-- 2. assistant_places: the company's own list of stops. ----------------------------------
-- Grouping a run needs identity, not a string: one lot typed three ways is one stop. A task
-- with no place at all (a call, a portal submission) leaves place_id null and the ordering
-- module renders it as the Anywhere group, so nothing is seeded and nothing is required.
create table if not exists public.assistant_places (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  name         text not null,
  kind         text not null default 'site',
  address      text,
  area         text,
  notes        text,
  is_active    boolean not null default true,
  sort_order   integer not null default 0,
  created_by   uuid references auth.users (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint assistant_places_kind_check
    check (kind in ('site','supplier','office','agency','showroom','client'))
);

create index if not exists assistant_places_company_id_idx
  on public.assistant_places (company_id);
create index if not exists assistant_places_company_active_idx
  on public.assistant_places (company_id, is_active);

alter table public.assistant_places enable row level security;
revoke all on public.assistant_places from anon;

drop policy if exists "Members read places" on public.assistant_places;
create policy "Members read places"
  on public.assistant_places for select to authenticated
  using (private.is_company_member(company_id));

drop policy if exists "Members add places" on public.assistant_places;
create policy "Members add places"
  on public.assistant_places for insert to authenticated
  with check (private.is_company_member(company_id));

-- Members fix a name from the field; the guard below keeps is_active and sort_order to admins.
-- Without this, the first "Miller residence" filed next to "Miller house" splits the run into
-- two stops and only the owner can merge them.
drop policy if exists "Members update places" on public.assistant_places;
create policy "Members update places"
  on public.assistant_places for update to authenticated
  using (private.is_company_member(company_id))
  with check (private.is_company_member(company_id));

drop policy if exists "Admins delete places" on public.assistant_places;
create policy "Admins delete places"
  on public.assistant_places for delete to authenticated
  using (private.can_manage_company(company_id));

create or replace function public.guard_assistant_place_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if private.can_manage_company(old.company_id) then
    return new;
  end if;
  if new.company_id is distinct from old.company_id
     or new.is_active is distinct from old.is_active
     or new.sort_order is distinct from old.sort_order then
    raise exception 'Only owners and managers can retire or reorder a place.';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_assistant_place_fields() from public, anon, authenticated;

drop trigger if exists assistant_places_guard_fields on public.assistant_places;
create trigger assistant_places_guard_fields
  before update on public.assistant_places
  for each row execute function public.guard_assistant_place_fields();

-- 3. assistant_tasks: the work. ----------------------------------------------------------
-- Every column is a fact somebody asserts. window_kind separates a window that cannot move
-- (an inspection, a counter cutoff) from a date a manager picked. is_blocking is the "people
-- are standing around" fact, kept apart from priority because a manager marks everything high.
-- pickup_place_id plus pickup_done is a fetch-and-deliver errand: one row that moves from the
-- supplier's stop to the destination's stop when the box is in the truck.
-- Deliberately absent: cost of delay in money, duration, and dependencies. This must not become
-- a schedule competing with the real one.
create table if not exists public.assistant_tasks (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  title            text not null,
  detail           text,
  assignee_id      uuid references public.profiles (id) on delete set null,
  place_id         uuid references public.assistant_places (id) on delete set null,
  pickup_place_id  uuid references public.assistant_places (id) on delete set null,
  pickup_done      boolean not null default false,
  location_note    text,
  due_on           date,
  due_time         time,
  window_kind      text not null default 'target',
  priority         text not null default 'normal',
  is_blocking      boolean not null default false,
  blocking_note    text,
  client_waiting   boolean not null default false,
  status           text not null default 'open',
  waiting_on       text,
  follow_up_on     date,
  done_note        text,
  completed_at     timestamptz,
  sort_order       integer not null default 0,
  created_by       uuid references auth.users (id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint assistant_tasks_window_kind_check check (window_kind in ('fixed','target')),
  constraint assistant_tasks_priority_check check (priority in ('high','normal','low')),
  constraint assistant_tasks_status_check check (status in ('open','waiting','done','cancelled')),
  constraint assistant_tasks_waiting_on_check
    check (waiting_on is null or waiting_on in ('client','supplier','contractor','agency','teammate','other')),
  constraint assistant_tasks_due_time_check check (due_time is null or due_on is not null),
  constraint assistant_tasks_completed_check
    check ((status = 'done') = (completed_at is not null)),
  constraint assistant_tasks_pickup_check
    check (pickup_place_id is null or place_id is null or pickup_place_id <> place_id)
);

create index if not exists assistant_tasks_company_id_idx on public.assistant_tasks (company_id);
create index if not exists assistant_tasks_company_status_idx on public.assistant_tasks (company_id, status);
create index if not exists assistant_tasks_assignee_idx on public.assistant_tasks (assignee_id);
create index if not exists assistant_tasks_place_idx on public.assistant_tasks (place_id);
create index if not exists assistant_tasks_live_due_idx
  on public.assistant_tasks (company_id, due_on)
  where status in ('open','waiting');

alter table public.assistant_tasks enable row level security;
revoke all on public.assistant_tasks from anon;

-- One select policy, and it already admits admins.
drop policy if exists "Members read tasks" on public.assistant_tasks;
create policy "Members read tasks"
  on public.assistant_tasks for select to authenticated
  using (private.is_company_member(company_id));

-- Anyone at the company may file work. Kingdom has one admin and the manager function sits with
-- a superintendent, so admin-only filing would lock out the person this is built for.
drop policy if exists "Members create tasks" on public.assistant_tasks;
create policy "Members create tasks"
  on public.assistant_tasks for insert to authenticated
  with check (private.is_company_member(company_id));

drop policy if exists "Assignee creator and admins update tasks" on public.assistant_tasks;
create policy "Assignee creator and admins update tasks"
  on public.assistant_tasks for update to authenticated
  using (
    private.can_manage_company(company_id)
    or assignee_id = (select auth.uid())
    or created_by = (select auth.uid())
  )
  with check (
    private.can_manage_company(company_id)
    or assignee_id = (select auth.uid())
    or created_by = (select auth.uid())
  );

drop policy if exists "Creator and admins delete tasks" on public.assistant_tasks;
create policy "Creator and admins delete tasks"
  on public.assistant_tasks for delete to authenticated
  using (private.can_manage_company(company_id) or created_by = (select auth.uid()));

-- 4. assistant_settings: one row per company. --------------------------------------------
-- default_assignee_id prefills the filing form. It never decides who may be assigned; the
-- coordinator takes holidays and the estimator runs errands on a busy week. soon_days is the
-- only ordering parameter the company owns, handed to the pure module.
create table if not exists public.assistant_settings (
  company_id           uuid primary key references public.companies (id) on delete cascade,
  default_assignee_id  uuid references public.profiles (id) on delete set null,
  soon_days            integer not null default 3,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint assistant_settings_soon_days_check check (soon_days between 1 and 30)
);

alter table public.assistant_settings enable row level security;
revoke all on public.assistant_settings from anon;

drop policy if exists "Members read assistant settings" on public.assistant_settings;
create policy "Members read assistant settings"
  on public.assistant_settings for select to authenticated
  using (private.is_company_member(company_id));

drop policy if exists "Admins create assistant settings" on public.assistant_settings;
create policy "Admins create assistant settings"
  on public.assistant_settings for insert to authenticated
  with check (private.can_manage_company(company_id));

drop policy if exists "Admins update assistant settings" on public.assistant_settings;
create policy "Admins update assistant settings"
  on public.assistant_settings for update to authenticated
  using (private.can_manage_company(company_id)) with check (private.can_manage_company(company_id));

drop policy if exists "Admins delete assistant settings" on public.assistant_settings;
create policy "Admins delete assistant settings"
  on public.assistant_settings for delete to authenticated
  using (private.can_manage_company(company_id));

-- 5. Provenance and the done stamp. ------------------------------------------------------
-- A task never gets to assert its own company. When a place is set, the company comes from the
-- place; when there is none, the insert WITH CHECK has already pinned company_id to a company
-- the caller belongs to. Either way every other reference must resolve to that same company.
-- completed_at is stamped here too, so a status select that writes only { status: 'done' }
-- cannot make a task vanish from every band.
--
-- Trigger order matters: Postgres fires BEFORE row triggers in trigger-name alphabetical order,
-- so assistant_tasks_guard_fields runs before assistant_tasks_stamp. Keeping the company check
-- in the stamp means the two cannot disagree about what company_id ends up as.
create or replace function public.stamp_assistant_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  if new.place_id is not null then
    select company_id into v_company from public.assistant_places where id = new.place_id;
    if v_company is null then
      raise exception 'That place is not on this company list.';
    end if;
    new.company_id := v_company;
  end if;

  if new.pickup_place_id is not null then
    select company_id into v_company from public.assistant_places where id = new.pickup_place_id;
    if v_company is distinct from new.company_id then
      raise exception 'The pickup place belongs to another company.';
    end if;
  end if;

  if new.assignee_id is not null then
    select company_id into v_company from public.profiles where id = new.assignee_id;
    if v_company is distinct from new.company_id then
      raise exception 'That person is not with this company.';
    end if;
  end if;

  if new.status = 'done' and new.completed_at is null then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;

  return new;
end;
$$;
revoke execute on function public.stamp_assistant_task() from public, anon, authenticated;

drop trigger if exists assistant_tasks_stamp on public.assistant_tasks;
create trigger assistant_tasks_stamp
  before insert or update on public.assistant_tasks
  for each row execute function public.stamp_assistant_task();

-- 6. The field guard: who owns which facts. ----------------------------------------------
-- Owners and managers own what a task is and how much it matters. Whoever filed it owns what
-- they filed. Anyone else working the list owns what they learn firsthand: whether it is done,
-- who they are waiting on, and when it is actually happening. That split is what keeps the
-- ordering worth trusting, because nobody can silently re-rank work someone else gave them.
create or replace function public.guard_assistant_task_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if private.can_manage_company(old.company_id) or old.created_by = auth.uid() then
    return new;
  end if;
  if row(new.company_id, new.title, new.detail, new.assignee_id, new.place_id,
         new.pickup_place_id, new.priority, new.is_blocking, new.blocking_note,
         new.client_waiting, new.sort_order, new.created_by)
     is distinct from
     row(old.company_id, old.title, old.detail, old.assignee_id, old.place_id,
         old.pickup_place_id, old.priority, old.is_blocking, old.blocking_note,
         old.client_waiting, old.sort_order, old.created_by) then
    raise exception 'Only owners and managers can change what a task is, where it is, or how important it is.';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_assistant_task_fields() from public, anon, authenticated;

drop trigger if exists assistant_tasks_guard_fields on public.assistant_tasks;
create trigger assistant_tasks_guard_fields
  before update on public.assistant_tasks
  for each row execute function public.guard_assistant_task_fields();

-- 7. Timestamps: reuse the function from 0001, never redefine it. -------------------------
drop trigger if exists assistant_places_set_updated_at on public.assistant_places;
create trigger assistant_places_set_updated_at
  before update on public.assistant_places
  for each row execute function public.set_updated_at();

drop trigger if exists assistant_tasks_set_updated_at on public.assistant_tasks;
create trigger assistant_tasks_set_updated_at
  before update on public.assistant_tasks
  for each row execute function public.set_updated_at();

drop trigger if exists assistant_settings_set_updated_at on public.assistant_settings;
create trigger assistant_settings_set_updated_at
  before update on public.assistant_settings
  for each row execute function public.set_updated_at();

-- 8. Turn the module on for Kingdom, once. ------------------------------------------------
-- Guarded on the settings row the way 0006 guards its seeds: if Kingdom has ever been set up
-- for this module, a second paste does nothing, so re-running the file cannot undo a later
-- decision by Rococo to switch it off. No places and no tasks are seeded: the stops and the
-- work are the company's to name.
do $$
declare
  v_id uuid;
begin
  select id into v_id from public.companies where slug = 'kingdom';
  if v_id is null then
    return;
  end if;
  if exists (select 1 from public.assistant_settings where company_id = v_id) then
    return;
  end if;
  insert into public.assistant_settings (company_id) values (v_id);
  update public.companies
     set modules = modules || array['assistant']
   where id = v_id and not (modules @> array['assistant']);
end $$;
```

## Before any of this ships

Kingdom has one person signed in, with no title and no admin rights, and no review cycles. Nobody
there can configure this module, or anything else, until somebody is promoted to admin. That is
true regardless of whether this gets built.
