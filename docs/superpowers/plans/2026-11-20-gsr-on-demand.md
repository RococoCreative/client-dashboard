# GSRs On Demand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a company hold Goal Setting Reviews that stand on their own, with no cycle behind them, scored as an aggregate of the GSRs done in a window, turned on for one company at a time and for RBA first.

**Architecture:** A GSR in a company on demand is a `reviews` row with no cycle, and its goals point at it through `goals.review_id`. One setting, `companies.gsr_mode`, decides the format; the database refuses the new format where it is off, and every new screen sits behind that setting. The period code and the period branches of every database function are left as they are: the new format is added beside them in its own files.

**Tech Stack:** PostgreSQL with row level security (Supabase), plain SQL migrations with a local test harness, Vite, React 19, TypeScript, Tailwind v4 theme tokens, react-router, vitest and Testing Library, Playwright for the screen comparison.

**Spec:** `docs/superpowers/specs/2026-11-20-gsr-on-demand-design.md` (approved by the owner on 2026-11-20). It is the authority; where this plan and the spec disagree, the spec wins, except the one ruling under Task 2.

## Global Constraints

- Branch `claude/gsr-on-demand`, cut from `main`. Nothing merges to `main` and nothing is applied to production before Task 14, and each release step there waits for the owner's say-so.
- One new migration, `supabase/migrations/0047_gsr_on_demand.sql`, built up over Tasks 2 to 5. It is idempotent (the harness applies it twice). `0046_gsr_rhythms.sql` is applied in production and is never edited.
- A rebuilt database function is copied from its latest body (most are in `0046_gsr_rhythms.sql`) and changed only on the lines the task names. The cycle branch of every function keeps its logic and its messages word for word.
- The functions periods use today in `src/lib/gsr` (`scoreGsrMonths`, `monthsWithin`, `gsrCycleInPlay`, `cycleRoster`, `previousCycle`, `carryForward` and the rest) are not changed. On demand gets its own functions in `src/lib/gsr/onDemand.ts`.
- Every new screen and query sits behind `company.gsr_mode === "on_demand"`. Never branch on a company name, slug or theme (rule 12).
- The existing tests are the contract. Every existing database test and every existing page test for a company on periods passes without an edit to what it asserts. The only planned edits are named in Tasks 1 and 2. Any other change to an existing assertion is listed in the task report with its reason.
- Nobody marks their own GSR done or reopens it, whatever their role. No signed-in account changes `gsr_mode`.
- Every "today" in on-demand code is the company's: `companyToday(company.time_zone)` from `src/lib/wins.ts`. The app never sends `started_on` or `done_on`; the database stamps them.
- Scoring math stays in `src/lib/gsr` (rule 7). A GSR's score is `scoreMonth(goals, required)` over its own goals, unchanged.
- No new public database function (a view is allowed), no service-role key, no network in tests. Every service function has its mock in `src/test/mocks/`, with the same exports.
- Copy: calm, plain, no em dashes or en dashes anywhere, no "month" where a GSR has none, no AI model names. Every new file opens with a comment saying why it exists. No barrel files. Theme tokens only; controls are styled only through `src/components/ui/*`.
- Layout rules in force from hub clarity: setup reads first (`EditRow`), one primary action a page, 44px tap targets under the `tap` variant as real layout, no sideways scroll from 390px.
- Gates before every commit that ends a task: `npm run lint`, `npx vitest run`, and `VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=sb_publishable_placeholder npm run build`. Tasks 1 to 5 also run `npm run test:sql` (never two runs at once).

## Review Focus

1. Two people click "New GSR" for the same person in the same moment: one GSR exists and both land on it. Tests in Task 3 (`one_per_person_per_day`) and Task 10.
2. The browser's date is not the company's (late evening, or a viewer in another time zone): the GSR is dated, counted and flagged by the company's date. Tests in Task 3 (`dates_are_the_companys`) and Task 11.
3. "New GSR" on a person who already has two open, including when one of them was started today: the newest opens with the reason shown, never an error page. Tests in Task 3 (`two_open_at_most`) and Task 10.
4. A GSR reopened after a quarterly review was signed off: the signed-off review keeps its number; a review still open recalculates. Test in Task 13.
5. A company on demand that does not score GSRs (no active Monthly GSRs pillar): Mark done works with no score, counts work, averages read as a dash. Tests in Tasks 8 and 11.

## File Structure

New, database:
- `supabase/migrations/0046_gsr_rhythms.sql`, `supabase/tests/0046_gsr_rhythms.test.sql`: carried over from the rhythms branch (Task 1).
- `supabase/migrations/0047_gsr_on_demand.sql`: the setting and the wall, the standalone GSR, its goals, the conversion.
- `supabase/tests/0047_gsr_wall.test.sql`, `0047_gsr_standalone.test.sql`, `0047_gsr_goals.test.sql`, `0047_gsr_conversion.test.sql`.
- `supabase/tests/fingerprint.sql`: the per-company fingerprint used by the conversion test and at release.

New, app:
- `src/lib/gsr/onDemand.ts` (+ test): windows, figures, due flags, current and previous GSR, the review pillar figure, carry forward.
- `src/services/gsrOnDemand.ts`, `src/test/mocks/gsrOnDemand.ts` (+ test), `src/test/onDemandDemo.ts`: reads and writes for standalone GSRs, their mock, and demo sample data.
- `src/pages/gsr/GsrPage.tsx`, `src/pages/gsr/GsrLogPage.tsx`: one GSR, and the log.
- `src/components/gsr/onDemand/`: `GsrGoalsPanel.tsx`, `LastGsrPanel.tsx`, `GsrList.tsx`, `MyGsrOnDemand.tsx`, `PersonGsrs.tsx`, `RhythmRow.tsx`, `DueBadge.tsx`, `useStartGsr.ts`.
- `src/components/home/GsrCardOnDemand.tsx`, `TeamBlockOnDemand.tsx`, `GsrWeekCard.tsx`.
- `src/components/gsr/GoalEditor.tsx`, `FocusTopicCard.tsx`, `AddGoalForm.tsx`: moved out of `GoalSettingPanel.tsx` unchanged so both formats use them.

Changed at one branch point each: `src/App.tsx`, `src/lib/navigation.ts`, `src/pages/gsr/gsrTabs.ts`, `src/pages/gsr/MyGsrPage.tsx`, `src/components/people/person/PersonGsrGoals.tsx`, `src/components/home/EmployeeHome.tsx`, `src/components/home/AdminHome.tsx`, `src/pages/gsr/ReviewPage.tsx`, `src/components/people/person/PersonReviews.tsx`, `src/components/scorecards/compare.ts`, `src/pages/rococo/PortfolioPage.tsx`, `src/pages/rococo/CompaniesPage.tsx`. Also `src/types/database.ts`, `src/services/gsr.ts`, `src/services/companies.ts`, the profiles service, `src/test/fixtures.ts`, `src/test/setup.ts`, `demo/vite.config.ts`, `CLAUDE.md`, `README.md`.

---

# Phase 1: Database

SQL tests follow `supabase/tests/0039_gsr_guards_and_task_goal_links.test.sql`: no `begin` or `commit`, people made with `tests.create_person(name, tests.company(slug), role)`, acting through `tests.act_as(tests.id(name))`, checks through `tests.assert(ok, message)` and `tests.assert_raises(sql, like)`. Each case below is one named block whose failure message starts with the case name. A statement run with no `tests.act_as` is the SQL editor: `auth.uid()` is null.

### Task 1: Carry migration 0046 and its tests onto this branch

`main` must hold every applied migration. Nothing here changes behaviour.

**Files:**
- Create: `supabase/migrations/0046_gsr_rhythms.sql`, `supabase/tests/0046_gsr_rhythms.test.sql` (byte for byte from `origin/claude/laughing-cannon-50onn9`)
- Modify: `supabase/tests/0038_team_and_division_access.test.sql` (take that branch's version), `src/types/database.ts`, `src/services/gsr.ts` (`CYCLE_COLUMNS`), the profiles service column list, `src/test/fixtures.ts`, `README.md` ("What is applied live")

**Interfaces:**
- Produces: `export type CycleKind = "gsr" | "review";` and `kind: CycleKind` on `ReviewCycle`; `gsr_cadence` on `Profile`, typed `GsrCadence` (Task 6 defines the union; here use `"weekly" | "biweekly" | "monthly" | "quarterly"`). `Cadence` is not widened.

- [ ] **Step 1:** `git show origin/claude/laughing-cannon-50onn9:<path> > <path>` for the three SQL files; `cmp` each against `/home/user/cd-rhythm/<path>` and expect no output.
- [ ] **Step 2:** Add the two types and fields; select `kind` and `gsr_cadence`; in fixtures give every cycle `kind` (`"gsr"` when monthly, else `"review"`) and every profile `gsr_cadence: "monthly"`.
- [ ] **Step 3:** Run `npm run test:sql`. Expected: `SQL tests: 21 passed, 0 failed (46 migrations applied, 23 re-applied)`.
- [ ] **Step 4:** README: 0046 is applied live (2026-11-20). Gates. Commit `Carry migration 0046, its tests and its types onto main's line`.

### Task 2: Migration 0047, part 1: the setting and the wall

**Ruling:** the spec says 0046's tests come over unchanged. They cannot stay unchanged once 0047 reverses parts of 0046, because every test runs against the final schema. This task removes from `0046_gsr_rhythms.test.sql` each case 0047 reverses and names, in the commit body, the 0047 case that replaces it. Cost if wrong: none; the 0046 file itself is untouched.

**Files:**
- Create: `supabase/migrations/0047_gsr_on_demand.sql`, `supabase/tests/0047_gsr_wall.test.sql`
- Modify: `supabase/tests/0046_gsr_rhythms.test.sql`, `supabase/tests/0038_team_and_division_access.test.sql` (back to `origin/main`'s text: a manager cannot lock a report's month)

**Interfaces (produced, exact names):**
- `companies.gsr_mode text not null default 'periods'`, constraint `companies_gsr_mode_check` (`'periods'`, `'on_demand'`); `gsr_mode` joins the columns `companies_audit` watches.
- `private.gsr_on_demand(p_company uuid) returns boolean`: stable, security definer, `search_path = ''`, granted like the other private helpers.
- `public.guard_company_fields()`: the 0042 body, plus, for every signed-in writer including Rococo admins: a change to `gsr_mode` raises `The GSR format is changed by Rococo in the database.`
- Trigger `companies_guard_gsr_mode` (before update of `gsr_mode`), function `public.guard_company_gsr_mode()`:
  - to `'on_demand'` unless `current_setting('hub.gsr_on_demand_for', true) = new.slug`: raises `Name the company this change is for: set hub.gsr_on_demand_for to its slug in the same transaction.`
  - to `'periods'` when the company has a review with no cycle: raises `This company has GSRs on demand, so it cannot go back to periods from here.`
- Taken back from 0046: policy `"Members open a GSR period"` dropped; trigger `reviews_guard_rhythm` and `public.guard_review_rhythm()` dropped; `private.gsr_period_ok` and `private.gsr_period_name` dropped; `review_cycles_cadence_check` back to monthly, quarterly, annual, custom; `review_cycles_kind_cadence_check` is monthly with `'gsr'`, the other three with `'review'`; `public.guard_review_cycle_period()` reduced to one job: on insert and update, `kind` is set from the cadence (monthly is `'gsr'`, anything else `'review'`).
- Narrowed to companies on demand: policy `"Leaders lock and reopen a GSR for the people they lead"` and the leader branch of `public.guard_review_employee_fields()` apply only when `cycle_id is null`; policy `"Leaders set the GSR rhythm of the people they lead"` and the leader branch of `public.guard_profile_fields()` apply only when `private.gsr_on_demand(company_id)`.
- `profiles_gsr_cadence_check`: `'none'`, `'daily'`, `'weekly'`, `'biweekly'`, `'monthly'`, `'quarterly'`.

- [ ] **Step 1: Write the failing tests** in `0047_gsr_wall.test.sql`:

| Case | Asserts |
|---|---|
| `mode_defaults_to_periods` | all three seeded companies read `'periods'` |
| `no_signed_in_account_changes_the_mode` | an owner, an admin and a Rococo admin each raise `The GSR format is changed by Rococo in the database.` |
| `the_change_must_name_the_company` | as the SQL editor: no setting raises; the setting naming `klasik` while updating `rba` raises; `update public.companies set gsr_mode = 'on_demand'` with no `where` raises and leaves all three on periods |
| `a_named_company_moves` | with `set_config('hub.gsr_on_demand_for', 'rba', true)`, updating `rba` succeeds; `klasik` and `kingdom` still read `'periods'` |
| `members_cannot_open_a_cycle` | an employee's insert into `review_cycles` is refused by row level security |
| `a_month_takes_any_dates_again` | an admin inserts a monthly cycle from 2026-12-03 to 2026-12-28; its `kind` is `'gsr'` |
| `kind_follows_the_cadence` | an admin changes that cycle's cadence to `custom`; its `kind` becomes `'review'` |
| `weekly_cycles_are_gone` | an insert with cadence `'weekly'` violates `review_cycles_cadence_check` |
| `rhythm_no_longer_blocks_a_month` | an admin sets a person's `gsr_cadence` to `'weekly'`, then opens that person's review in a monthly cycle |
| `periods_manager_cannot_set_a_rhythm` | a manager's update of a report's `gsr_cadence` changes 0 rows |
| `rhythm_takes_none_and_daily` | an admin sets `'none'`, then `'daily'` |

- [ ] **Step 2:** Run `npm run test:sql`; expect the new file to fail (no `gsr_mode` column).
- [ ] **Step 3:** Write the migration's sections for this task, in the order of the Interfaces list. Before each constraint that replaces one of 0046's, a `do` block names any row that would break it and stops, as 0046 does.
- [ ] **Step 4:** Trim `0046_gsr_rhythms.test.sql`; restore the 0038 test from `origin/main`.
- [ ] **Step 5:** Run `npm run test:sql`. Expected: `SQL tests: 22 passed, 0 failed (47 migrations applied, 24 re-applied)`. Gates. Commit `Add the GSR format setting and wall it off in the database`.

### Task 3: Migration 0047, part 2: a GSR with no cycle

**Files:**
- Modify: `supabase/migrations/0047_gsr_on_demand.sql` (append)
- Create: `supabase/tests/0047_gsr_standalone.test.sql`

**Interfaces (produced):**
- `reviews.cycle_id` nullable; `reviews.started_on date`; `reviews.done_on date`; constraint `reviews_home_check`: a review has a cycle and no dates, or no cycle and a `started_on`.
- Unique index `reviews_person_day_key on public.reviews (employee_id, started_on)` (not partial, so `on conflict (employee_id, started_on) do nothing` can name it).
- `public.inherit_company_from_cycle()`: with no cycle, the company is the person's; otherwise unchanged.
- `public.guard_review_cycle()`: returns at once for a review that has no cycle and had none; a signed-in writer never moves a review between having a cycle and having none.
- Trigger `reviews_stamp_gsr` (before insert or update), function `public.stamp_standalone_gsr()`. For a review with no cycle:
  - insert: raises `GSRs on demand are not turned on for this company.` unless `private.gsr_on_demand(new.company_id)`; `started_on` is the company's date, `(now() at time zone <company time_zone>)::date`, whatever was sent; if the person already has a GSR started that day the row passes on to the unique key; otherwise, when the person already has two not complete, raises `This person already has two GSRs open. Mark the earlier one done first.`
  - update: `started_on` never changes; `done_on` becomes the company's date when status becomes `complete`, is cleared when it leaves `complete`, and otherwise keeps its value.
  - When `current_setting('hub.gsr_conversion', true) = '1'` (Task 5), dates are kept as given and the mode and limit checks are skipped.
  The name matters: before triggers fire in name order, so this runs after `reviews_inherit_company` has set the company. A before-insert trigger runs before `on conflict` is judged, which is why a same-day duplicate must pass the limit check.
- `public.guard_review_employee_fields()` (Task 2's body), first check, before the admin pass: on a review with no cycle, when `private.auth_profile_id() = old.employee_id` and any of `status`, `completed_at`, `gsr_score`, `reviewer_id` differs, raises `Your own GSR is marked done and reopened by someone who leads you.`
- Insert policies on `reviews`: `"People start their own GSR"` and `"Leaders start a GSR for the people they lead"`: `cycle_id is null`, the same blank-row conditions as the two monthly open policies, the person is the caller or in `private.led_person_ids()`.
- View `public.gsr_last_started` with `security_invoker = true`: `company_id`, `employee_id`, `max(started_on) as last_started_on` over reviews with no cycle; `select` granted to `authenticated`.

- [ ] **Step 1: Write the failing tests** in `0047_gsr_standalone.test.sql`. Setup moves `rba` on demand as the SQL editor; `klasik` stays on periods.

| Case | Asserts |
|---|---|
| `periods_company_refuses_a_gsr` | in `klasik`, an admin, a manager and the person each raise `GSRs on demand are not turned on for this company.` |
| `person_starts_their_own`, `leader_starts_for_a_report`, `admin_starts_for_someone_they_manage` | one row each, `cycle_id` null, company `rba` |
| `stranger_cannot_start` | an employee for a peer, and a `klasik` admin for an `rba` person, are refused |
| `dates_are_the_companys` | with the company's `time_zone` set to `Pacific/Kiritimati`, `started_on = (now() at time zone 'Pacific/Kiritimati')::date`; a `started_on` sent by the client is ignored |
| `one_per_person_per_day` | a second insert with `on conflict (employee_id, started_on) do nothing` inserts 0 rows and one GSR exists; a plain second insert is a unique violation |
| `two_open_at_most` | with two open GSRs on earlier days (dated under `hub.gsr_conversion`), a third start raises the two-open message; with two open and one of them started today, `on conflict do nothing` inserts 0 rows and raises nothing; reopening a done GSR while two are open succeeds |
| `leader_marks_done_and_reopens` | a manager sets `status`, `completed_at`, `gsr_score = 80`, `reviewer_id`; `done_on` is the company's date; reopening clears `done_on` and `gsr_score` |
| `leader_changes_nothing_else` | a manager writing `manager_feedback` raises `A manager can lock and reopen a GSR, and nothing else on it.` |
| `nobody_closes_their_own` | an employee, a manager, an admin and an owner, each on their own GSR, raise `Your own GSR is marked done and reopened by someone who leads you.` for done and for reopen |
| `a_manager_who_is_also_a_report` | closes a report's GSR; cannot close their own; their own manager can |
| `who_sees_a_gsr` | the person, a leader and an admin read it; a peer and a `klasik` admin read 0 rows; `gsr_last_started` follows the same wall |
| `cycle_reviews_unchanged` | a review opened in a monthly cycle in `klasik` has no dates and is locked by an admin exactly as before |

- [ ] **Step 2:** Run `npm run test:sql`; expect the new file to fail.
- [ ] **Step 3:** Append the migration sections.
- [ ] **Step 4:** Run `npm run test:sql`. Expected: `23 passed, 0 failed`. Gates. Commit `Let a GSR stand on its own in a company on demand`.

### Task 4: Migration 0047, part 3: goals, notes and tasks on a GSR

**Files:**
- Modify: `supabase/migrations/0047_gsr_on_demand.sql` (append)
- Create: `supabase/tests/0047_gsr_goals.test.sql`

**Interfaces (produced):**
- `goals.review_id uuid references public.reviews (id) on delete cascade`, indexed.
- `goals_cycle_scope_check` replaced by `goals_home_check`: `(scope = 'cycle' and (cycle_id is null) <> (review_id is null)) or (scope <> 'cycle' and review_id is null)`.
- Unique index `goals_one_focus_per_gsr on public.goals (review_id) where is_focus`.
- A goal with a `review_id`: that review has no cycle and its person is the goal's person, else `A goal on a GSR belongs to that GSR's person.`; its company is the person's.
- `public.guard_goal_frozen()` and `public.guard_goal_note_frozen()`: the 0046 bodies plus a branch on the goal's `review_id` (old and new): when that GSR is complete, `This GSR is done. Reopen it to change its goals.` and `This GSR is done. Reopen it to change its notes.` The update exemptions the cycle branch has (outcome note, timestamps, a carried-from goal that is gone) hold for this branch too. Both return at once when `hub.gsr_conversion` is `'1'`.
- `public.guard_task()`: the 0046 body with two changes: a goal may carry tasks when `scope = 'cycle'` and its cycle's kind is `'gsr'` or it has a `review_id`; a new link to a goal whose GSR is complete raises `That GSR is done, so its goals take no new tasks.`
- `public.guard_goal_owner()` (latest body in 0039): `review_id` joins the fields a person cannot change on a goal someone else set for them.

- [ ] **Step 1: Write the failing tests** in `0047_gsr_goals.test.sql`:

| Case | Asserts |
|---|---|
| `goal_needs_one_home` | a GSR goal with neither a cycle nor a GSR, one with both, and a yearly goal with a `review_id` each violate `goals_home_check` |
| `goal_on_a_gsr_is_its_persons` | a goal for another person on that GSR raises `A goal on a GSR belongs to that GSR's person.` |
| `one_focus_per_gsr` | a second focus goal on one GSR is a unique violation |
| `person_and_leader_work_goals` | the person adds and edits; a leader adds; a peer is refused |
| `done_freezes_goals_and_notes` | both messages above, for insert, update and delete |
| `reopen_thaws` | after a manager reopens, the same writes succeed |
| `task_links_to_an_open_gsr_goal` | succeeds; then with the GSR done a new link raises `That GSR is done, so its goals take no new tasks.` |
| `deleting_a_gsr_takes_its_goals` | an admin deletes the GSR; its goals are gone |
| `cycle_goals_unchanged` | in `klasik`, a locked month still raises `This month's GSR is locked in. Reopen the review to change its goals.` and `Only a monthly GSR goal can have tasks.` |
| `private_stays_private` | `goal_private` still refuses a GSR goal |

- [ ] **Step 2:** Run; expect FAIL. **Step 3:** Append the sections. **Step 4:** Run `npm run test:sql`. Expected: `24 passed, 0 failed`. Gates. Commit `Give a GSR its own goals, notes and task links`.

### Task 5: Migration 0047, part 4: moving a company over

**Files:**
- Modify: `supabase/migrations/0047_gsr_on_demand.sql` (append)
- Create: `supabase/tests/0047_gsr_conversion.test.sql`, `supabase/tests/fingerprint.sql`

**Interfaces (produced):**
- Table `private.gsr_conversion_backup (id bigint generated always as identity primary key, company_id uuid not null, converted_at timestamptz not null default now(), what text not null, payload jsonb not null)`; `what` is one of `'cycle'`, `'omission'`, `'review_cycle'`, `'goal_cycle'`. Row level security on, no policies.
- `private.convert_gsrs_to_on_demand(p_company uuid) returns void`: security definer; sets `hub.gsr_conversion` to `'1'` for the transaction. In order: back up; for each review in a cycle of kind `'gsr'`, set `started_on` to the cycle's first day and, when the review is complete, `done_on` to `least(period_end, (completed_at at time zone <company time_zone>)::date)` (the cycle's last day when `completed_at` is null), then clear `cycle_id`; move that person's goals in that cycle to the review (`review_id` set, `cycle_id` cleared); for a goal in such a cycle whose person has no review there, create a not-started GSR dated the cycle's first day and move the goal to it; delete the company's `'gsr'` cycles.
- Trigger `companies_convert_gsrs` (after update of `gsr_mode`, when it moves from `'periods'` to `'on_demand'`).
- `public.guard_signed_off_review()` (latest body in 0029): returns at once when `hub.gsr_conversion` is `'1'`.
- `supabase/tests/fingerprint.sql`: one `select` giving, for each company slug and each of `review_cycles`, `reviews`, `review_scores`, `goals`, `goal_notes`, `cycle_omissions`, the row count and `md5` of the ordered row hashes, each row hashed as `md5((to_jsonb(t) - 'started_on' - 'done_on' - 'review_id')::text)`. It reads out no names and no text a person wrote.

- [ ] **Step 1: Write the failing tests** in `0047_gsr_conversion.test.sql`. The setup builds a company shaped like Klasik's live data: two open months (one with two of four GSRs complete and scored, one with four in progress), goals in both including one for a person with no review that month, three people left out, and a quarterly cycle with one review signed off.

| Case | Asserts |
|---|---|
| `a_klasik_shaped_company_converts` | every former month review has no cycle and `started_on` on the first of its month; goals carry `review_id` and no `cycle_id`; the goal with no review has a not-started GSR; no `'gsr'` cycle and no omission row of that company remains |
| `scores_and_completion_survive` | `status`, `gsr_score` and `completed_at` are unchanged on every converted review |
| `locked_after_its_month_stays_in_its_month` | a September GSR completed on October 5 has `done_on = 2026-09-30` |
| `done_in_a_running_month_counts_that_day` | completed November 12 inside November: `done_on = 2026-11-12` |
| `unfinished_stays_open_even_in_a_closed_month` | not complete in a closed cycle: converted, `done_on` null |
| `scored_reviews_are_untouched` | the quarterly cycle, its reviews, their scores and line items hash the same before and after |
| `other_companies_are_untouched` | the fingerprints of the two other companies are equal before and after |
| `backup_holds_what_was_removed` | one `'cycle'` row per removed cycle, one `'omission'` row per removed omission, one `'review_cycle'` row per converted review, one `'goal_cycle'` row per moved goal |
| `no_way_back` | `This company has GSRs on demand, so it cannot go back to periods from here.` |
| `the_company_then_works` | a person starts a new GSR; a manager marks a converted open one done |

- [ ] **Step 2:** Run; expect FAIL. **Step 3:** Append the sections; write `fingerprint.sql`. **Step 4:** Run `npm run test:sql`. Expected: `SQL tests: 25 passed, 0 failed (47 migrations applied, 24 re-applied)`. Gates. Commit `Convert a company's past GSRs when it moves to on demand`.

---

# Phase 2: App foundation (no screen changes)

### Task 6: Types and the on-demand rules

**Files:**
- Modify: `src/types/database.ts`, `src/test/fixtures.ts` (type-required fields only)
- Create: `src/lib/gsr/onDemand.ts`, `src/lib/gsr/onDemand.test.ts`

**Interfaces (produced):**

```ts
// src/types/database.ts
export type GsrMode = "periods" | "on_demand";
export type GsrCadence = "none" | "daily" | "weekly" | "biweekly" | "monthly" | "quarterly";
// Company gains gsr_mode: GsrMode. Goal gains review_id: string | null.
// Review gains started_on: string | null and done_on: string | null. Review.cycle_id stays string.
export type Gsr = Omit<Review, "cycle_id" | "started_on"> & { cycle_id: null; started_on: string };

// src/lib/gsr/onDemand.ts
export interface DateRange { from: string; to: string }
export type GsrWindow = "week" | "month" | "quarter";
export type GsrFigureRow = Pick<Gsr, "employee_id" | "status" | "started_on" | "done_on" | "gsr_score">;
export type DueState = "none" | "ok" | "due" | "overdue";
export const GSR_RHYTHMS: readonly GsrCadence[];            // none, daily, weekly, biweekly, monthly, quarterly
export const GSR_RHYTHM_LABELS: Record<GsrCadence, string>; // None, Daily, Weekly, Every two weeks, Monthly, Quarterly
export const GSR_WINDOW_LABELS: Record<GsrWindow | "custom", string>; // This week, This month, This quarter, Custom dates
export function windowRange(window: GsrWindow, today: string): DateRange;
export function isOpen(gsr: Pick<Gsr, "status">): boolean;                 // status is not "complete"
export function windowFigures(gsrs: GsrFigureRow[], range: DateRange): { done: number; average: number | null; inProgress: number };
export function figuresByPerson(gsrs: GsrFigureRow[], range: DateRange): Map<string, { done: number; average: number | null; open: number }>;
export function dueFor(cadence: GsrCadence, lastStartedOn: string | null, today: string): { state: DueState; dueOn: string | null };
export function currentGsr<T extends Pick<Gsr, "status" | "started_on" | "created_at">>(gsrs: T[]): T | null;
export function previousGsr<T extends Pick<Gsr, "id" | "started_on" | "created_at">>(gsrs: T[], current: T): T | null;
export function gsrGoals(goals: Goal[], reviewId: string): Goal[];          // scope "cycle" and review_id === reviewId
export function scoreGsrsInPeriod<T extends GsrFigureRow>(period: { period_start: string; period_end: string }, gsrs: T[]): { gsrs: Array<{ gsr: T; counted: boolean }>; target: number; actual: number };
export function carryForwardToGsr(goal: Goal, reviewId: string, sortOrder?: number): Omit<CarriedGoal, "cycle_id"> & { cycle_id: null; review_id: string };
```

Rules the signatures do not fix: `done` counts GSRs whose `done_on` is in the range; `average` is `averageScore` (from `scoring.ts`) of those with a score, null when none; `inProgress` and `open` ignore the range. `scoreGsrsInPeriod` lists GSRs done inside the period (counted when they have a score) and GSRs open now (never counted); `target` is `LOCKED_MONTH_TARGET` for each counted one, `actual` their scores added. `dueFor`: `"none"` cadence gives `{ state: "none", dueOn: null }`; with no last GSR the person is due today; otherwise `dueOn` is the last start plus the next working day (Monday to Friday) for daily, 7 days, 14 days, one calendar month, three calendar months (a month with no such day takes its last day); before `dueOn` is `"ok"`, on it `"due"`, after it `"overdue"`. Date arithmetic is on the date string in UTC, as `homeCutoff` in `src/lib/wins.ts` does. `currentGsr` is the newest open one; `previousGsr` is the latest one started before `current` (ties by `created_at`).

- [ ] **Step 1: Write the failing tests** in `onDemand.test.ts`:

```ts
it("runs a week Monday to Sunday", () => {
  expect(windowRange("week", "2026-09-15")).toEqual({ from: "2026-09-14", to: "2026-09-20" });
  expect(windowRange("month", "2026-09-15")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  expect(windowRange("quarter", "2026-09-15")).toEqual({ from: "2026-07-01", to: "2026-09-30" });
});
it("counts done GSRs in the window and open ones whatever the window", () => {
  const rows: GsrFigureRow[] = [
    { employee_id: "a", status: "complete", started_on: "2026-09-07", done_on: "2026-09-14", gsr_score: 80 },
    { employee_id: "a", status: "complete", started_on: "2026-09-14", done_on: "2026-09-16", gsr_score: 90 },
    { employee_id: "b", status: "complete", started_on: "2026-09-01", done_on: "2026-09-10", gsr_score: 50 },
    { employee_id: "c", status: "not_started", started_on: "2026-08-01", done_on: null, gsr_score: null },
    { employee_id: "d", status: "complete", started_on: "2026-09-15", done_on: "2026-09-15", gsr_score: null },
  ];
  expect(windowFigures(rows, { from: "2026-09-14", to: "2026-09-20" })).toEqual({ done: 3, average: 85, inProgress: 1 });
  expect(figuresByPerson(rows, { from: "2026-09-14", to: "2026-09-20" }).get("a")).toEqual({ done: 2, average: 85, open: 0 });
  expect(windowFigures(rows, { from: "2026-10-01", to: "2026-10-31" })).toEqual({ done: 0, average: null, inProgress: 1 });
});
it("says when a person is due", () => {
  expect(dueFor("none", null, "2026-09-15")).toEqual({ state: "none", dueOn: null });
  expect(dueFor("weekly", null, "2026-09-15")).toEqual({ state: "due", dueOn: "2026-09-15" });
  expect(dueFor("daily", "2026-09-11", "2026-09-14")).toEqual({ state: "due", dueOn: "2026-09-14" }); // Friday to Monday
  expect(dueFor("daily", "2026-09-11", "2026-09-15").state).toBe("overdue");
  expect(dueFor("weekly", "2026-09-08", "2026-09-15").state).toBe("due");
  expect(dueFor("biweekly", "2026-09-08", "2026-09-15")).toEqual({ state: "ok", dueOn: "2026-09-22" });
  expect(dueFor("monthly", "2026-01-31", "2026-02-27").dueOn).toBe("2026-02-28");
  expect(dueFor("quarterly", "2026-11-30", "2027-03-01")).toEqual({ state: "overdue", dueOn: "2027-02-28" });
});
it("scores a review period from the GSRs done inside it", () => {
  const rows: GsrFigureRow[] = [
    { employee_id: "a", status: "complete", started_on: "2026-07-01", done_on: "2026-07-10", gsr_score: 70 },
    { employee_id: "a", status: "complete", started_on: "2026-09-01", done_on: "2026-09-30", gsr_score: 90 },
    { employee_id: "a", status: "complete", started_on: "2026-09-20", done_on: "2026-10-01", gsr_score: 100 },
    { employee_id: "a", status: "in_progress", started_on: "2026-10-01", done_on: null, gsr_score: null },
  ];
  const figure = scoreGsrsInPeriod({ period_start: "2026-07-01", period_end: "2026-09-30" }, rows);
  expect([figure.target, figure.actual]).toEqual([200, 160]);
  expect(figure.gsrs.map((g) => g.counted)).toEqual([true, true, false]); // the two done inside, then the open one
});
it("finds the current and the previous GSR", () => {
  const g = (id: string, started_on: string, status: "complete" | "in_progress") => ({ id, started_on, status, created_at: `${started_on}T09:00:00Z` });
  const all = [g("1", "2026-06-02", "complete"), g("2", "2026-09-08", "in_progress"), g("3", "2026-09-15", "in_progress")];
  expect(currentGsr(all)?.id).toBe("3");
  expect(previousGsr(all, all[2])?.id).toBe("2");
  expect(previousGsr(all, all[0])).toBeNull();
  expect(currentGsr([all[0]])).toBeNull();
});
it("carries a goal to a GSR, never to a cycle", () => {
  const goal = { ...RBA.goals[0], is_focus: true, progress: 60, action_steps: [{ text: "Done", done: true }, { text: "Open", done: false }] };
  const carried = carryForwardToGsr(goal, "gsr-9");
  expect(carried).toMatchObject({ review_id: "gsr-9", cycle_id: null, scope: "cycle", is_focus: false, progress: 0, carried_from_goal_id: goal.id });
  expect(carried.action_steps).toEqual([{ text: "Open", done: false }]);
});
```

- [ ] **Step 2:** Run `npx vitest run src/lib/gsr/onDemand.test.ts`; expect FAIL (module missing).
- [ ] **Step 3:** Add the types; give every fixture company `gsr_mode: "periods"`, every fixture goal `review_id: null`, every fixture review `started_on: null, done_on: null`; widen `GsrCadence` (Task 1's narrower union goes). Implement `onDemand.ts`.
- [ ] **Step 4:** Run the file, then the gates. Commit `Add the rules for GSRs on demand`.

### Task 7: Services, mocks and the demo switch

**Files:**
- Create: `src/services/gsrOnDemand.ts`, `src/test/mocks/gsrOnDemand.ts`, `src/test/mocks/gsrOnDemand.test.ts`, `src/test/onDemandDemo.ts`
- Modify: `src/services/gsr.ts`, `src/services/companies.ts`, the profiles service, `src/test/mocks/gsr.ts`, `src/test/fixtures.ts`, `src/test/setup.ts`, `demo/vite.config.ts`

**Interfaces (produced):**

```ts
// src/services/gsrOnDemand.ts (same exports in the mock)
export const TWO_OPEN_MESSAGE = "This person already has two GSRs open. Mark the earlier one done first.";
export const OWN_GSR_MESSAGE = "Your own GSR is marked done and reopened by someone who leads you.";
export async function getGsr(id: string): Promise<Gsr>;
export async function listPersonGsrs(companyId: string, employeeId: string): Promise<Gsr[]>;   // newest first
export async function listGsrsForLog(companyId: string, range: DateRange): Promise<Gsr[]>;      // done in range, or open now
export async function listLastGsrDates(companyId: string): Promise<Array<{ employee_id: string; last_started_on: string }>>; // view gsr_last_started
export async function startGsr(companyId: string, employeeId: string): Promise<{ gsr: Gsr; atLimit: boolean }>;
export async function markGsrDone(id: string, score: number | null, reviewerId: string): Promise<Gsr>;
export async function reopenGsr(id: string): Promise<Gsr>;
export async function deleteGsr(id: string): Promise<void>;
// mock only
export function resetMockGsrs(): void;
export function setMockGsrMode(companyId: string, mode: GsrMode): void;
export function seedMockGsr(row: Partial<Gsr> & Pick<Gsr, "company_id" | "employee_id" | "started_on">): Gsr;
```

`startGsr` inserts with the duplicate ignored on `employee_id,started_on` (as `ensureReview` does on its key), then returns the person's newest GSR; when the insert fails with `TWO_OPEN_MESSAGE` it returns the newest with `atLimit: true`; any other error is thrown. `markGsrDone` writes `status: "complete"`, `completed_at`, `gsr_score`, `reviewer_id`. `reopenGsr` writes `status: "in_progress"`, `completed_at: null`. In `gsr.ts`: `listEmployeeReviews` and `listCompanyReviews` return only reviews that have a cycle (`.not("cycle_id", "is", null)`), so period code never meets a standalone GSR; `GOAL_COLUMNS` and `GoalInput` gain `review_id`. `Company` selects `gsr_mode`; `CompanyPatch` does not gain it. `ProfilePatch` gains `gsr_cadence`.

The mock keeps standalone GSRs in their own array (seeded from a new `CompanyBundle` key `gsrs`, empty in every fixture) and mirrors the database: the wall message for a company not on demand, one per person per day, the two-open limit, `OWN_GSR_MESSAGE` when `reviewerId` is the GSR's person, and in `mocks/gsr.ts` a goal with a `review_id` is refused with `This GSR is done. Reopen it to change its goals.` once that GSR is done. `src/test/setup.ts` calls `resetMockGsrs()` after each test. The demo: `?gsr=on_demand`, read where `?load=dense` is read, calls `applyOnDemandDemo(rba)`: RBA's company reads on demand, its monthly cycles and their reviews are gone, and people carry a mix of rhythms with GSRs dated from today backwards (several done this week, some in progress, one person with two open, one overdue, one with rhythm None).

- [ ] **Step 1: Write the failing tests** in `mocks/gsrOnDemand.test.ts`: "refuses a GSR in a company on periods"; "starts one GSR however many times it is asked the same day"; "returns the newest with atLimit when two are open"; "refuses the person marking their own GSR done"; "freezes a done GSR's goals"; "keeps period reviews and standalone GSRs in separate lists". Also one test beside the existing tests for `src/lib/errors.ts`: `errorMessage` returns each new database message unchanged (the wall message, `TWO_OPEN_MESSAGE`, `OWN_GSR_MESSAGE`, and the two done messages for goals and notes), since they are written as the line a person reads. `src/test/mocks/parity.test.ts` must pass for the new pair.
- [ ] **Step 2:** Run; expect FAIL. **Step 3:** Implement. **Step 4:** Gates (the whole suite: no existing test may change). Commit `Add the services and mocks for GSRs on demand`.

---

# Phase 3: Screens, each behind `company.gsr_mode`

Page tests follow `src/pages/home-audience.test.tsx`: `vi.mock` each service to its mock, `renderWithHub(<Page />, makeHub(persona, company))`. A company on demand in a test is `{ ...RBA.company, gsr_mode: "on_demand" }` with `setMockGsrMode(RBA.company.id, "on_demand")` and rows from `seedMockGsr`. The test clock is 2026-09-15.

### Task 8: One GSR's page

**Files:**
- Create: `src/pages/gsr/GsrPage.tsx`, `src/components/gsr/onDemand/GsrGoalsPanel.tsx`, `src/components/gsr/GoalEditor.tsx`, `src/components/gsr/FocusTopicCard.tsx`, `src/components/gsr/AddGoalForm.tsx`, `src/pages/gsr-page.test.tsx`
- Modify: `src/components/gsr/GoalSettingPanel.tsx` (imports the three moved parts; nothing else), `src/App.tsx` (route `gsr/reviews/:reviewId`)

**Interfaces:**
- Consumes: Task 6 and Task 7.
- Produces: `GsrPage` (default export, reads `:reviewId`); `GsrGoalsPanel({ gsr, goals, notes, names, roleGoals, required, topic, canEdit, taskLinks, onGoals, onNotes, onError })` where `topic` is `FocusTopic | null`. The route renders `GsrPage` when `company.gsr_mode === "on_demand"` and `ReviewPage` otherwise.

Behaviour: load `getGsr`, call `assertInCompany()`, then the person's GSRs, goals, notes, role goals, the focus topic of the month `started_on` falls in (`listFocusTopics(companyId, month, month)`), the active Monthly GSRs pillar for `required_goals`, and task links when the tasks module is on. Title `GSR · {started date}`. Status `In progress`, or `Done {date}` with the score and who marked it done. The parts a monthly GSR shows today are shown from the same components: opening discussion, goals (ranked, mandatory and stretch counted by `requiredAndStretch`), role goals in one click, notes, tasks on goals, role scorecard, project notes. A shared part that takes `review: Review` and never reads `cycle_id` takes the fields it reads instead: a type-only change. The three moved parts keep their props and markup. "Mark done" is the page's one primary action, shown to an admin or a leader of the person (the test `ReviewPage` uses for `isLeader`) who is not the person; it re-reads the goals, then confirms with `Mark this GSR done at {score}%?`, or `Mark this GSR done?` in a company with no active Monthly GSRs pillar, then calls `markGsrDone(id, score, profile.id)`. The person sees no button and the line `Your manager marks this GSR done.` "Reopen" shows to the same people on a done GSR. A done GSR is read only. An admin who manages the person also has a worded `Delete GSR` at the foot of the page, away from the everyday controls; it confirms with `Delete this GSR and its goals?`, calls `deleteGsr`, and returns to the person's GSRs.

- [ ] **Step 1: Write the failing tests** in `gsr-page.test.tsx`:
  - "shows an open GSR with its goals and the focus topic of the month it was started in"
  - "adds a goal to the GSR, not to a cycle" (the created goal has `review_id` equal to the GSR's id and `cycle_id` null)
  - "lets a manager mark a report's GSR done and shows the score it locked" (goals at 50 and 30 with two mandatory: the dialog reads `Mark this GSR done at 40%?`, then the page reads Done and 40%)
  - "gives the person no Mark done and says their manager does it"
  - "does not let an admin mark their own GSR done"
  - "reopens a done GSR for a manager and never for the person"
  - "marks done with no score in a company that does not score GSRs" (Review Focus 5)
  - "lets an admin delete a GSR after a confirm, and offers it to nobody else"
  - "says a GSR from another company is not here" (the `assertInCompany` line, after switching company)
  - "keeps the monthly page for a company on periods"
- [ ] **Step 2:** Run; expect FAIL. **Step 3:** Move the three parts (run the existing suite: green with no test edited), then build the page. **Step 4:** Gates. Commit `Add the page for one GSR on demand`.

### Task 9: The last GSR, inside the new one

**Files:**
- Create: `src/components/gsr/onDemand/LastGsrPanel.tsx`, `src/pages/gsr-last.test.tsx`
- Modify: `src/pages/gsr/GsrPage.tsx`

**Interfaces:**
- Consumes: `previousGsr`, `gsrGoals`, `carryForwardToGsr`, `markGsrDone`, `scoreMonth`.
- Produces: `LastGsrPanel({ current, last, goals, notes, names, required, canClose, canEdit, onGoals, onClosed, onError })`, mounted where "Last month at a glance" sits on the monthly page.

Behaviour: heading `Last GSR`, its start date, `In progress` or `Done` with date and score; each goal with its completion, its notes read only. With no earlier GSR: `No earlier GSR yet.` When the last one is still open: its goals' completion can be changed there by anyone who may change it on its own page, and "Mark done" shows to those who may close it (the Task 8 rule), with the same confirm; after it, the module reads Done. Each goal under 100 has "Carry forward", which creates `carryForwardToGsr(goal, current.id)` and then reads `Carried forward`, as the monthly page does through `carried_from_goal_id`.

- [ ] **Step 1: Write the failing tests** in `gsr-last.test.tsx`: "pulls in the last GSR whatever the gap" (started 2026-06-02, current 2026-09-15); "closes the last GSR from inside the new one"; "lets the person see their last GSR and gives them no way to close it"; "carries an unfinished goal forward once"; "says there is no earlier GSR on a first one".
- [ ] **Step 2 to 4:** Run (FAIL), implement, gates. Commit `Pull the last GSR into the new one`.

### Task 10: Starting a GSR, My GSR, a person's GSRs, and rhythm

**Files:**
- Create: `src/components/gsr/onDemand/useStartGsr.ts`, `GsrList.tsx`, `MyGsrOnDemand.tsx`, `PersonGsrs.tsx`, `RhythmRow.tsx`, `src/pages/gsr-start.test.tsx`
- Modify: `src/pages/gsr/MyGsrPage.tsx`, `src/components/people/person/PersonGsrGoals.tsx`, `src/pages/gsr/GsrPage.tsx`

**Interfaces:**
- Produces: `useStartGsr(): { start: (employeeId: string) => Promise<void>; busy: boolean; error: string }`: calls `startGsr`, then navigates to `/gsr/reviews/{id}` with router state `{ atLimit }`. `GsrList({ gsrs, names })`: a person's GSRs newest first, each a link with its start date, `In progress` or `Done {date}`, and its score. `RhythmRow({ person, canEdit, onPatch })`: an `EditRow` showing `GSR_RHYTHM_LABELS[person.gsr_cadence]` with a select of `GSR_RHYTHMS`.

`RhythmRow` is the rhythms branch's select (`/home/user/cd-rhythm/src/components/people/person/PersonRhythmSelect.tsx`, reference only) rebuilt as a read-first row with the six rhythms.

Behaviour: `MyGsrPage` and `PersonGsrGoals` each gain one branch at the top: on demand renders `MyGsrOnDemand` or `PersonGsrs`; otherwise the file runs as today. `MyGsrOnDemand`: the current GSR (`currentGsr`) as a card with "Open my GSR", or "Start a GSR"; when one is due, the line `A GSR is due.`; then `GsrList`. `PersonGsrs`: `RhythmRow` (editable by an admin and by a leader of the person, never by the person), "New GSR", `GsrList`; the yearly goals panel below stays. `GsrPage` arriving with `atLimit`: the notice `{First name} already has two GSRs open. Mark the earlier one done first. You can do it here, in Last GSR.` (for the person themself: `You already have two GSRs open. Your manager marks the earlier one done first.`).

- [ ] **Step 1: Write the failing tests** in `gsr-start.test.tsx`: "starts a GSR and opens it"; "opens today's GSR when one was already started today" (one row after two starts; Review Focus 1); "opens the newest and says why when two are open" (Review Focus 3, also with one of the two started today); "lists a person's GSRs newest first and opens a done one read only"; "offers Start a GSR on My GSR when none is open"; "lets an admin and the person's manager change the rhythm, and nobody else"; "shows no rhythm and no New GSR in a company on periods".
- [ ] **Step 2 to 4:** Run (FAIL), implement, gates. Commit `Start GSRs on demand and list a person's GSRs`.

### Task 11: The GSRs log

**Files:**
- Create: `src/pages/gsr/GsrLogPage.tsx`, `src/components/gsr/onDemand/DueBadge.tsx`, `src/pages/gsr-log.test.tsx`
- Modify: `src/App.tsx` (routes `gsr` and `gsr/cycles/:cycleId`), `src/lib/navigation.ts`, `src/pages/gsr/gsrTabs.ts`

**Interfaces:**
- Consumes: `listGsrsForLog`, `listLastGsrDates`, `windowRange`, `windowFigures`, `figuresByPerson`, `dueFor`, `useStartGsr`.
- Produces: `GsrLogPage` (default export); `DueBadge({ state })` rendering nothing for `"none"` and `"ok"`, `Due today` for `"due"`, `Overdue` for `"overdue"`.

Behaviour: in a company on demand, `/gsr` renders `GsrLogPage` for an admin or a lead and sends anyone else to `/my/gsr`; `/gsr/cycles/:cycleId` redirects to `/gsr`; the sidebar's GSRs item shows to leads too; the first tab reads `GSRs` where it reads `Periods`. A company on periods keeps every route, item and label. The page: a window select (`This week` by default, `This month`, `This quarter`, `Custom dates` with two date inputs), the division switch where the company has divisions, the headline `{done} GSRs done · Average {average} · {inProgress} in progress` (a dash when the average is null), and the people table: person, last GSR (`Never` when none), rhythm, done, average, `DueBadge`. People are the active people the viewer can see, for a manager the people they lead. Each name links to `/people/{id}/gsr`. "New GSR" is the one primary action and asks for a person; each row has a quiet start or open control. One read of `listGsrsForLog` and one of `listLastGsrDates` per window, never one per person. At phone width rows stack, as Scorecards' do.

- [ ] **Step 1: Write the failing tests** in `gsr-log.test.tsx`:
  - "counts done GSRs and averages them for this week" (seed done 80 on 2026-09-14, done 90 on 2026-09-15, done 50 on 2026-09-10, one open: `2 GSRs done · Average 85 · 1 in progress`)
  - "changes Done and Average with the window and leaves In progress and Overdue alone" (`This month`: `3 GSRs done · Average 73 · 1 in progress`)
  - "uses the company's date, not the browser's" (company `time_zone: "Pacific/Kiritimati"` with the clock at 2026-09-20T12:00:00Z: this week is September 21 to 27; Review Focus 2)
  - "shows a manager only the people they lead" and "sends an employee to My GSR"
  - "flags a lapsed rhythm as Overdue and never flags rhythm None"
  - "starts a GSR from a row"
  - "reads averages as a dash in a company that does not score GSRs" (Review Focus 5)
  - "keeps the monthly list, its tab label and its sidebar audience for a company on periods"
- [ ] **Step 2 to 4:** Run (FAIL), implement, gates. Commit `Add the GSRs log`.

### Task 12: Home

**Files:**
- Create: `src/components/home/GsrCardOnDemand.tsx`, `TeamBlockOnDemand.tsx`, `GsrWeekCard.tsx`, `src/pages/gsr-home.test.tsx`
- Modify: `src/components/home/EmployeeHome.tsx`, `src/components/home/AdminHome.tsx`

**Interfaces:**
- Produces: `GsrCardOnDemand({ person })`, `TeamBlockOnDemand({ reports })`, `GsrWeekCard({ companyId })`, each loading its own data through Task 7's services.

Behaviour: one branch in each Home file. Employee and manager: where the monthly GSR block is, `GsrCardOnDemand` shows the current GSR's start date, its progress (the `monthTotal` figure over its goals) and "Open my GSR", or "Start a GSR", and `A GSR is due.` when `dueFor` says due or overdue; the quarter line reads `scoreGsrsInPeriod`. Manager: where `TeamBlock` is, `TeamBlockOnDemand` lists each direct report with their last GSR date, `In progress`, `DueBadge`, and a way to start or open; each row is a full tap target on a phone. Admin: the GSR month card and the "GSRs complete" tile give way to `GsrWeekCard`: this week's headline, up to five overdue people, and a link to `/gsr`; the scored review card and tile stay.

- [ ] **Step 1: Write the failing tests** in `gsr-home.test.tsx`: "shows the current GSR with its progress and Open my GSR"; "offers Start a GSR and says one is due"; "lists each report's last GSR and whether one is in progress, due or overdue"; "gives an admin one GSRs this week card with done, average, in progress and who is overdue"; "shows an admin no still-open reminder for a GSR month" (a company on demand has none, so the attention card needs no change). `src/pages/home-audience.test.tsx` passes unedited.
- [ ] **Step 2 to 4:** Run (FAIL), implement, gates. Commit `Show GSRs on demand on Home`.

### Task 13: Everywhere a month was counted, and the written rules

**Files:**
- Modify: `src/pages/gsr/ReviewPage.tsx`, `src/components/people/person/PersonReviews.tsx`, `src/components/scorecards/compare.ts` and its caller, `src/pages/rococo/PortfolioPage.tsx`, `src/pages/rococo/CompaniesPage.tsx`, `CLAUDE.md`, `README.md`
- Create: `src/pages/gsr-counted.test.tsx`

**Interfaces:**
- Consumes: `scoreGsrsInPeriod`, `listPersonGsrs`, `listGsrsForLog`, `windowRange`, `windowFigures`, `Company.gsr_mode`. Produces nothing later tasks use.

Behaviour, each behind the setting: a scored review's Monthly GSRs pillar reads `scoreGsrsInPeriod(cycle, the person's GSRs)`; its body lists the GSRs done in the period with date and score, and open ones as `Not counted yet`; sign-off writes the same one line item (`target`, `actual`) it writes today; a signed-off review reads `{n} GSRs` where it reads months. `PersonReviews` reads the same figure. The division comparison shows `GSRs done this month` per division from `listGsrsForLog`. The Rococo portfolio shows this week's done count and average for a company on demand. Rococo, Companies shows `GSR format` as `By month` or `On demand` through `Shown`, with no control. `CLAUDE.md`: rule 7 says who marks a GSR done in a company on demand and that nobody closes their own; rule 12 lists `gsr_mode` as configured per company, and the window figures and the due rule as shared code. `README.md`: a section on GSRs on demand, 0047 under what is written and not yet applied, and how a company is moved (the statement in Task 14, Step 9).

- [ ] **Step 1: Write the failing tests** in `gsr-counted.test.tsx`: "scores a review's GSR pillar from the GSRs done inside its period" (done 70 and 90 inside: the pillar reads 80; one done the day after the period and one open are not counted); "leaves the pillar out when no GSR was done"; "keeps a signed-off review's number when a GSR is reopened afterwards, and recalculates a review still open" (Review Focus 4); "shows GSRs done this month in the division comparison"; "shows the GSR format on Rococo, Companies as text with no control".
- [ ] **Step 2 to 4:** Run (FAIL), implement, gates. Commit `Count GSRs on demand wherever a month was counted`.

---

# Phase 4: Proof and release

### Task 14: Prove the wall, then release one step at a time

Run by the controller, not an implementer. Each of Steps 7 to 10 waits for the owner's say-so.

- [ ] **Step 1: Gates.** Lint, `npx vitest run`, build, `npm run test:sql` (`25 passed, 0 failed`).
- [ ] **Step 2: The contract.** `git diff --stat origin/main -- '*.test.ts' '*.test.tsx' supabase/tests src/test/fixtures.ts`. Every changed existing file is one Tasks 1, 2, 6 or 7 named. Anything else is read line by line and listed for the owner.
- [ ] **Step 3: Screens identical on periods.** Check `origin/main` out into a second worktree, run both demos, and capture every GSR, review, Home, person and Rococo screen for `klasik` (admin, manager, employee) and `kingdom` (admin) at 390, 768 and 1440 wide. Compare pixel by pixel. Expected: no difference.
- [ ] **Step 4: New screens on a phone.** With `?company=rba&gsr=on_demand&load=dense`: every on-demand screen at 390 is exactly 390 wide, has no tap target under 44px and no overlapping hit areas; at 768 and 1440 nothing scrolls sideways.
- [ ] **Step 5: Today's app on tomorrow's database.** In the `origin/main` worktree from Step 3, copy in this branch's `0046` and `0047` migration files (untracked, not committed) and run `npm run test:sql` there, so `main`'s own tests run against the new schema. Expected: `20 passed, 0 failed`, which is the proof a release can be rolled back.
- [ ] **Step 6: Whole-branch review** on the most capable model, then one fix wave and one re-review.
- [ ] **Step 7: Apply 0047 to production.** Run `fingerprint.sql` and keep the result; apply the migration; compare every function, policy, constraint, trigger and index it names with a local database built from the files, as was done for 0046; run `fingerprint.sql` again. Expected: the two fingerprints are equal for all three companies.
- [ ] **Step 8: Ship the app.** Merge to `main` with a merge commit, confirm CI is green, fingerprint again (equal), and ask the owner to open one of Klasik's GSR months on the live site.
- [ ] **Step 9: Move RBA.** In one transaction: `select set_config('hub.gsr_on_demand_for', 'rba', true); update public.companies set gsr_mode = 'on_demand' where slug = 'rba';`. Expected: RBA has two standalone GSRs and no GSR cycle; Klasik's and Kingdom's fingerprints are equal to Step 7's.
- [ ] **Step 10:** Ask the owner to confirm RBA's GSRs screen on the live site.
