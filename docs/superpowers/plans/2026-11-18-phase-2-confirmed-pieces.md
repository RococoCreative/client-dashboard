This file exists to drive Phase 2 of the Kingdom intake build task by task: the small pieces Kingdom's answers already settled, each built as a setting every company carries with today's behaviour as its default.

# Phase 2: Confirmed Small Pieces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five settled pieces: how long a win stays on Home with an archive behind it, a switch for the manual Financials page, three milestone statuses with a standard set per company, sync on a set of weekdays with staleness that can skip weekends, and Sync now with a last-updated stamp on Production.

**Architecture:** Each difference between companies becomes a column or rows with a default equal to today, never a branch on a company. Two company columns (0042), a milestone status kept in step with the completed date by trigger (0043), a per-company milestone template copied onto each new project by trigger (0044), and a weekday set plus a weekdays-only staleness flag on a sync source (0045). Pure rules live in `src/lib` and `supabase/functions/_shared/sync`, tested without a network.

**Tech Stack:** Postgres RLS and triggers (Supabase), the SQL harness in `supabase/tests`, a Deno Edge Function sharing code with the app tests, Vite, React 19, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-18-kingdom-intake-build-structure.md` (Phase 2, lines 196 to 203, and collisions C4, C5, C7).

## Global Constraints

- CLAUDE.md hard rules bind every task: theme tokens and `components/ui/*` only (rules 1, 11); renders with no backend, hermetic tests (rule 2); services throw, pages message (rule 3); the wall is RLS (rule 4); migrations append-only and idempotent with `src/types/database.ts` in step (rule 8); copy calm and plain with no em dashes, industry neutral (rule 10); no branch on a company name, slug or theme key (rule 12).
- Every new setting defaults to today's behaviour. With no company row or column changed, every existing test passes unchanged and Klasik and RBA see no difference, except where a task says a shared wording changes.
- No company's values are written in code or in a migration. Kingdom's values (14 days, its six phases, weekdays at 8 AM) are entered in the app after release.
- Migrations: 0042, 0043, 0044, 0045, in that order. Header shape and idempotence patterns follow 0037 and 0041. When a migration rebuilds a function, trigger or policy, copy its latest body (search later migrations for the name) and change only the named part.
- Services use explicit column lists. A new column is added to the list, the type, the patch type, the mock and the fixtures in the same task. Every service function has a same-named mock (`src/test/mocks/parity.test.ts`).
- Every file opens with a comment saying why it exists. No AI model identifiers.
- Before every commit: `npm run lint`, `npx vitest run`, `npm run build`; and `npm run test:sql` for any task touching `supabase/`.

## Decisions this plan makes

1. **Rococo sets the two company settings** (days a win stays on Home, and the manual Financials switch) on Rococo > Companies, like modules. Company admins do not.
2. **A win that has aged off Home goes to an Archive view everyone can browse.** A win an admin removed stays hidden, as today.
3. **The Financials switch is an opt-out column, not a module.** Modules are opt-in, so a module would switch Financials off for every new company.
4. **Milestone status is shared code for all three companies.** The badge "Open" becomes "Not started" or "In progress". Completing a milestone still records a date.
5. **A company's standard milestones are set by its admins in Settings**, and apply to projects created after that. Existing projects are not touched.
6. **A sync source keeps its single weekday column filled** (the first day of the set) so the function already deployed keeps working until it is redeployed.
7. **Weekdays-only staleness is a flag on the source.** The threshold stays in hours, so "2 days" is 48 with the flag on.
8. **The admin action on a win reads "Remove", not "Archive", for all three companies.** With a days setting on, the page has an Archive tab for wins that aged off Home; the admin action hides a win everywhere, including that tab, so it needs a different name. Dialog body: "It leaves the Wins page and Home for everyone. It is kept in the record, not deleted."

## Review Focus

1. **A company in another time zone, late in the evening.** "14 days" and "weekday" are judged in the company's own day and the source's own zone, not the browser's and not UTC. Pinned in Tasks 2 and 6.
2. **A source synced Friday afternoon, checked Monday at 7 AM** with the weekdays-only flag on and a 48 hour threshold is not stale. With the flag off it is. Pinned in Task 7.
3. **A manager on Production who cannot read connections.** The stamp and the button work from the source row alone, and never read "Not connected" because the connection list came back empty. Pinned in Task 8.
4. **Financials switched off while someone has `/financials` open or bookmarked.** They are sent Home, the Home card and the portfolio figure are gone, and nothing requests snapshots. Pinned in Task 3.
5. **A milestone marked complete and then reopened.** The date clears, the status follows, and the counts on the project list agree. Pinned in Task 4.

---

### Task 1: Two company settings (0042)

**Files:**
- Create: `supabase/migrations/0042_company_display_settings.sql`, `supabase/tests/0042_company_display_settings.test.sql`
- Modify: `src/types/database.ts` (Company), `src/services/companies.ts` (`COLUMNS`, `CompanyPatch`), `src/test/mocks/companies.ts`, `src/test/fixtures.ts`, `src/lib/audit.ts` (plain labels for the two columns), `src/pages/rococo/CompaniesPage.tsx`
- Test: the SQL test; `src/pages/phase2-settings.test.tsx`

**Interfaces:**
- Produces (SQL): `companies.wins_home_days integer null` (check `> 0`), `companies.manual_financials boolean not null default true`.
- Produces (TS): `Company.wins_home_days: number | null`, `Company.manual_financials: boolean`; both in `CompanyPatch`.

- [ ] **Step 1: Write the failing SQL test.** Setup: Kingdom owner and admin, a Rococo admin. Cases:

```sql
-- case: defaults_are_today      every company: wins_home_days is null and manual_financials is true.
-- case: rococo_sets_both        rococo: update companies set wins_home_days = 14, manual_financials = false
--                               where id = kingdom -> 1 row; klasik unchanged.
-- case: company_cannot_set      kingdom_owner: each of the two updates is refused with the guard's
--                               message (tests.assert_raises); name and time_zone still update.
-- case: days_must_be_positive   rococo: wins_home_days = 0 violates the check.
-- case: changes_are_audited     audit_events has a companies row whose changed carries
--                               wins_home_days and one carrying manual_financials.
```

- [ ] **Step 2: Run it to see it fail.** `npm run test:sql`. Expected: FAIL, column `wins_home_days` does not exist.

- [ ] **Step 3: Write `0042_company_display_settings.sql`.** Add both columns (`add column if not exists`, the check through a `pg_constraint` guard). Rebuild `guard_company_fields` from its latest body (0024) adding both columns to the Rococo-only list, with the message "Only Rococo admins can change a company slug, theme, modules or display settings." Rebuild `companies_audit` from its latest definition (0037) adding both columns.

- [ ] **Step 4: Bring the app in step.** Type, column list, patch type, mock (`createCompany` default and `updateCompany`), fixtures (all three companies: `null` and `true`), audit labels ("days a win stays on Home", "manual Financials page").

- [ ] **Step 5: Write the failing page test, then the controls.** On Rococo > Companies, per company, beside the module checkboxes: a number field "Days a win stays on Home" using `BlurInput` (blank means "the five newest, with no age limit") and a checkbox "Manual Financials page". Both save through the page's existing `patchCompany` queue.

```ts
it("saves 14 days for a company on blur and shows it after a reload of the list", ...); // updateCompany(id, { wins_home_days: 14 })
it("clears the days back to blank as null", ...);                                       // { wins_home_days: null }
it("refuses 0 and negative days with a plain line and does not save", ...);
it("switches manual Financials off for one company only", ...);                          // { manual_financials: false }
```

- [ ] **Step 6: Run the gates.** `npm run test:sql && npm run lint && npx vitest run && npm run build`. All pass.

- [ ] **Step 7: Commit.** `git commit -m "Add a win's days on Home and the manual Financials switch as company settings (0042)"`

---

### Task 2: Wins leave Home after their days and move to an archive

**Files:**
- Modify: `src/lib/wins.ts` (create if absent) and `src/lib/wins.test.ts`, `src/services/wins.ts`, `src/test/mocks/wins.ts`, `src/components/home/WinsCard.tsx`, `src/pages/WinsPage.tsx`, `src/pages/DashboardPage.tsx` (pass the company to the card)
- Test: `src/lib/wins.test.ts`, `src/pages/phase2-settings.test.tsx`

**Interfaces:**
- Consumes: `Company.wins_home_days`, `Company.time_zone`.
- Produces: `homeCutoff(days: number | null, today: string): string | null` (the earliest `won_on` still on Home, as `YYYY-MM-DD`; null when days is null); `listWins(companyId, opts?: { includeArchived?: boolean; limit?: number; wonOnOrAfter?: string; wonBefore?: string })`.

- [ ] **Step 1: Write the failing lib tests.**

```ts
it("has no cut-off when the company has no setting", () => expect(homeCutoff(null, "2026-11-18")).toBeNull());
it("keeps a win for exactly its days", () => expect(homeCutoff(14, "2026-11-18")).toBe("2026-11-05")); // won on the 5th is day 14
it("crosses a month and a year", () => expect(homeCutoff(14, "2027-01-03")).toBe("2026-12-21"));
it("keeps today's win when the setting is 1", () => expect(homeCutoff(1, "2026-11-18")).toBe("2026-11-18"));
```

- [ ] **Step 2: Run to see them fail,** then implement `homeCutoff` with date arithmetic on the date string, not on local time.

- [ ] **Step 3: Write the failing page tests.** "Today" is the company's own day: use the helper tasks already use for a company's day (search `src/lib` for the function that turns `company.time_zone` into today's date) and do not call the browser's date.

```ts
// company.wins_home_days = 14, today 2026-09-15 in the test clock
it("the Home card shows a win won 13 days ago and not one won 14 days before the cut-off", ...);
it("the Home card with no setting still shows the five newest", ...);
it("the Wins page has Recent and Archive when the company has a setting, and only one list when it does not", ...);
it("Archive lists wins older than the cut-off, newest first, and never a win an admin removed", ...);
it("an empty Archive says so plainly", ...);            // "No older wins yet."
it("uses the company's day, not the browser's", ...);    // company zone Pacific/Kiritimati vs a UTC clock near midnight
```

- [ ] **Step 4: Implement.** Service and mock gain the two date options (`gte` and `lt` on `won_on`). `WinsCard` takes `company`, asks for `wonOnOrAfter` when a cut-off exists, limit 5 either way. `WinsPage` shows tabs only when a cut-off exists: Recent asks `wonOnOrAfter`, Archive asks `wonBefore`. New win, edit and remove are unchanged and available in both views to those who have them today. Update the card's header comment, which says there is no age cut-off.

- [ ] **Step 5: Run the gates and commit.** `git commit -m "Let a win leave Home after the company's days and browse older wins in an archive"`

---

### Task 3: The manual Financials switch on screen

**Files:**
- Modify: `src/lib/navigation.ts` (+ test), `src/App.tsx` (route at the Financials line), `src/pages/DashboardPage.tsx` (snapshot load near 260, section near 494), `src/pages/rococo/PortfolioPage.tsx` (load at 68, alert at 115, stat near 202, button at 231), `src/pages/salesFinance/SalesFinancePage.tsx` (the manual Financials link near 44)
- Test: `src/pages/phase2-settings.test.tsx`, `src/lib/navigation.test.ts`

**Interfaces:**
- Consumes: `Company.manual_financials`.
- Produces: `NavItem.setting?: "manual_financials"` (an item hidden when that company setting is false); `SettingOnly({ setting, children })` route guard in `App.tsx`, sending others Home like `ModuleOnly`.

- [ ] **Step 1: Write the failing tests.**

```ts
// company.manual_financials = false
it("has no Financials item in the sidebar or the Home shortcuts", ...);
it("sends /financials Home", ...);
it("shows no Financials section on Home and does not request snapshots", ...);   // listSnapshots mock not called
it("the Sales and Finance page does not point at a manual Financials page", ...);
it("the portfolio shows no financial figure, no 'No financials yet' alert and no Financials button for that company, and still shows them for the others", ...);
// company.manual_financials = true (every fixture default)
it("is unchanged: nav item, route, Home section and portfolio figure are all present", ...);
```

- [ ] **Step 2: Run to see them fail, implement, run the gates.** The person page's "Your figures" (`employee_financials`) is a different feature and is not touched.

- [ ] **Step 3: Commit.** `git commit -m "Hide the manual Financials page, its Home section and its portfolio figure when a company has it off"`

---

### Task 4: Milestone status (0043)

**Files:**
- Create: `supabase/migrations/0043_milestone_status.sql`, `supabase/tests/0043_milestone_status.test.sql`
- Modify: `src/types/database.ts`, `src/lib/milestones.ts` (+ test), `src/services/projects.ts` (`MILESTONE_COLUMNS`, `MilestonePatch`), `src/test/mocks/projects.ts`, `src/components/production/MilestoneList.tsx`, `src/pages/production/ProjectPage.tsx` (filter chips)
- Test: the SQL test, `src/lib/milestones.test.ts`, `src/pages/phase2-milestones.test.tsx`

**Interfaces:**
- Produces (SQL): `project_milestones.status text not null default 'not_started'`, check in `('not_started','in_progress','complete')`; trigger function `public.sync_milestone_status()` on insert and update.
- Produces (TS): `type MilestoneStatus = "not_started" | "in_progress" | "complete"`; `ProjectMilestone.status`; `MILESTONE_STATUS_LABELS` ("Not started", "In progress", "Complete"); `isComplete(m)` reads `status === "complete"`.

- [ ] **Step 1: Write the failing SQL test.** One Kingdom project, an admin, a company whose `time_zone` differs from UTC. Cases:

```sql
-- case: existing_rows_backfilled   (insert two rows as system before the assertions run is not
--                                  possible after migration; instead:) a row inserted with
--                                  completed_on set and no status reads status 'complete'.
-- case: default_is_not_started     a plain insert reads 'not_started' and completed_on null.
-- case: complete_sets_the_date     update status = 'complete' -> completed_on = today in the
--                                  company's time zone.
-- case: date_sets_complete         update completed_on = '2026-10-01' on a not_started row ->
--                                  status 'complete', date kept.
-- case: reopening_clears_the_date  update status = 'in_progress' on a complete row ->
--                                  completed_on null.
-- case: clearing_the_date_reopens  update completed_on = null on a complete row -> 'not_started'.
-- case: both_given_date_wins       update status = 'not_started', completed_on = '2026-10-02'
--                                  in one statement -> 'complete' with that date.
-- case: bad_status_refused         status 'done' violates the check.
```

- [ ] **Step 2: Run to see it fail,** then write `0043_milestone_status.sql`: the column and check; a one-time backfill `status = 'complete' where completed_on is not null and status <> 'complete'`; the BEFORE trigger implementing the cases above, named so it fires after `project_milestones_inherit` (BEFORE triggers fire in name order; it needs the company to find the zone). Update 0026's claim only in the new header: note that "there is no status" in 0026 is superseded.

- [ ] **Step 3: Write the failing lib and page tests.**

```ts
it("counts a milestone as complete from its status", ...);          // milestoneCounts unchanged in shape
it("shows Not started, In progress, or Complete with its date", ...);
it("a person who may edit picks a status from a select; picking Complete shows today's completed date after the save", ...);
it("clearing the completed date puts the milestone back to Not started", ...);
it("someone who may not edit sees the status as text and no select", ...);
it("the Open filter shows Not started and In progress; the Done filter shows Complete", ...);
```

- [ ] **Step 4: Implement,** rendering from what the service returned after each save. Update the type's comment that says there is no status.

- [ ] **Step 5: Run the gates and commit.** `git commit -m "Give milestones three statuses kept in step with the completed date (0043)"`

---

### Task 5: A company's standard milestones (0044)

**Files:**
- Create: `supabase/migrations/0044_milestone_templates.sql`, `supabase/tests/0044_milestone_templates.test.sql`, `src/services/milestoneTemplates.ts`, `src/test/mocks/milestoneTemplates.ts`, `src/components/settings/MilestoneTemplatePanel.tsx`
- Modify: `src/types/database.ts`, `src/pages/settings/settingsTabs.ts`, `src/pages/settings/SettingsPage.tsx`, `src/App.tsx` (the settings tab routes follow `SETTINGS_TABS`), `src/lib/audit.ts` (table label), `demo/vite.config.ts` (service alias list)
- Test: the SQL test, `src/pages/phase2-milestones.test.tsx`

**Interfaces:**
- Produces (SQL): `public.milestone_templates (id uuid pk, company_id uuid not null references companies on delete cascade, title text not null, kind text not null default 'milestone', sort_order integer not null default 0, archived_at timestamptz, created_at, updated_at)`; trigger `projects_apply_milestone_template` AFTER INSERT on `projects`.
- Produces (TS): `interface MilestoneTemplate`; service `listMilestoneTemplates(companyId)`, `createMilestoneTemplate(companyId, { title, kind, sort_order })`, `updateMilestoneTemplate(id, patch)`, `archiveMilestoneTemplate(id)`, `reorderMilestoneTemplates(companyId, ids)`; `SettingsTab` gains `"production"`.

- [ ] **Step 1: Write the failing SQL test.**

```sql
-- case: no_template_no_milestones   a project created at a company with no template rows has 0
--                                   milestones (today's behaviour).
-- case: template_is_copied          three live template rows (two milestones, one letter) and one
--                                   archived: a new project gets exactly three milestones with the
--                                   same titles, kinds and order, status 'not_started', its company.
-- case: existing_projects_untouched a project created before the rows were added still has 0.
-- case: later_edits_do_not_reach_back  renaming a template row leaves the copied milestone as it was.
-- case: admins_write_members_read   an admin inserts, updates and archives; an employee and a
--                                   manager read and are refused on write; another company reads 0.
-- case: company_is_pinned           a row cannot be moved to another company.
-- case: changes_are_audited         audit_events has a milestone_templates row.
```

- [ ] **Step 2: Run to see it fail,** then write `0044_milestone_templates.sql`: the table with kind and title checks matching `project_milestones`; RLS (read `is_company_member`, write `can_manage_company`), a pin on `company_id`, `set_updated_at`; the audit trigger on `title, kind, sort_order, archived_at`; and the copy trigger as a `security definer` function with `set search_path = ''`, revoked from `public, anon, authenticated`.

- [ ] **Step 3: Write the failing page tests.**

```ts
it("Settings shows a Production tab only when the company has the production module", ...);
it("lists the standard milestones in order and adds one at the end", ...);      // createMilestoneTemplate(companyId, { title, kind: "milestone", sort_order: next })
it("marks a row as a letter", ...);
it("renames on blur, reorders with the arrows, and removes after a confirm", ...);
it("says plainly that the list applies to projects created from now on", ...);
   // copy: "Every new project starts with these. Projects that already exist keep the milestones they have."
it("an empty list explains what it is for", ...);
   // copy: "No standard milestones yet. Add the checkpoints every project should start with."
```

- [ ] **Step 4: Implement** the service, mock, panel and tab (tab label "Production", placed before Connections), following `MilestoneList` for the row controls. Add the service to the demo alias list.

- [ ] **Step 5: Run the gates and commit.** `git commit -m "Let a company set the standard milestones every new project starts with (0044)"`

---

### Task 6: Sync on a set of weekdays (0045)

**Files:**
- Create: `supabase/migrations/0045_sync_weekdays.sql`, `supabase/tests/0045_sync_weekdays.test.sql`
- Modify: `supabase/functions/_shared/sync/types.ts`, `supabase/functions/_shared/sync/schedule.ts`, `supabase/functions/_shared/sync/tick.ts` if it names the column, `supabase/functions/connections/sync.ts` (`SOURCE_COLUMNS`, the tick filter), `src/types/database.ts`, `src/services/sync.ts`, `src/test/mocks/sync.ts`, `src/lib/sync/draft.ts` (+ test), `src/components/settings/DataSourcesPanel.tsx`, `src/lib/audit.ts`
- Test: the SQL test, `src/lib/sync/schedule.test.ts`, `src/lib/sync/draft.test.ts`, `src/lib/sync/tick.test.ts`

**Interfaces:**
- Produces (SQL): `sync_sources.sync_weekdays smallint[]` (each 0 to 6, at least one, no repeats), `sync_sources.stale_business_days boolean not null default false`. `sync_weekday` stays and always equals the lowest day in the set.
- Produces (TS): `SyncSourceSpec.sync_weekdays: number[] | null`; `scheduleOf` returns `{ weekdays: number[]; time; timezone }`; `latestSlot(schedule, now)` is the most recent slot across the set; `isDue` unchanged in meaning.

- [ ] **Step 1: Write the failing SQL test.**

```sql
-- case: backfilled_from_the_single_day  a source that had sync_weekday = 1 has sync_weekdays = {1}.
-- case: set_keeps_single_day_in_step    update sync_weekdays = '{1,2,3,4,5}' -> sync_weekday = 1.
-- case: single_day_alone_still_works    an insert that gives only sync_weekday = 3 (an older
--                                       client) gets sync_weekdays = {3}.
-- case: schedule_is_all_or_nothing      days without a time or zone is refused; clearing all three
--                                       together is allowed and clears both day columns.
-- case: bad_sets_refused                '{}' , '{7}' and '{1,1}' are each refused.
-- case: defaults_are_today              stale_business_days is false on every existing source.
-- case: syncer_cannot_change_schedule   a person with sync_run and not admin cannot change
--                                       sync_weekdays or stale_business_days (the 0030 guard).
-- case: changes_are_audited             both columns appear in audit_events.
```

- [ ] **Step 2: Run to see it fail,** then write `0045_sync_weekdays.sql`: both columns; the backfill; the array check; `sync_sources_schedule_check` rebuilt to cover the set; a BEFORE trigger (or an addition to `guard_sync_source` from its latest body) that keeps the two day columns in step as the cases describe; `sync_sources_audit` rebuilt with the two columns added.

- [ ] **Step 3: Write the failing schedule tests** in `src/lib/sync/schedule.test.ts`, which imports the shared code by relative path.

```ts
// zone America/New_York, time 08:00, days Mon to Fri
it("is due on Tuesday at 08:07 when the last attempt was Monday 08:07", ...);
it("is not due on Tuesday at 07:50 when the last attempt was Monday 08:07", ...);
it("is not due on Saturday or Sunday after Friday's run", ...);
it("is due on Monday at 08:07 after Friday's run", ...);
it("makes one attempt per slot: not due again an hour after Tuesday's attempt", ...);
it("a single day set behaves exactly as the weekly schedule did", ...);   // keep every existing weekly test passing unchanged
it("picks the slot in the source's zone across a daylight saving change", ...);
it("a source with no days is never due", ...);
```

- [ ] **Step 4: Implement** the shared schedule over the set; read `sync_weekdays` in the function's column list and filter the tick on it; fall back to `[sync_weekday]` when the set is null so a not-yet-migrated row still works.

- [ ] **Step 5: Draft and UI.** `SourceDraft.weekdays: number[]` replaces the single value. The panel shows seven day checkboxes labelled Mon to Sun under "Sync days", with the existing Time and Time zone. Draft tests: a draft with days and no time is invalid with a plain line; an empty set with no time and zone means no schedule; `draftToInput` sends `sync_weekdays` sorted.

- [ ] **Step 6: Run the gates and commit.** `git commit -m "Let a data source sync on a set of weekdays (0045)"`

---

### Task 7: Staleness that can skip weekends

**Files:**
- Modify: `src/lib/sync/state.ts` (+ `state.test.ts`), `src/lib/attention.ts` if it computes age itself, `src/lib/sync/draft.ts` (+ test), `src/components/settings/DataSourcesPanel.tsx`, `src/services/sync.ts` and its mock (the column, if Task 6 did not already carry it through)
- Test: `src/lib/sync/state.test.ts`, `src/lib/sync/draft.test.ts`

**Interfaces:**
- Consumes: `sync_sources.stale_business_days`, `sync_timezone` (falling back to the company's `time_zone` when a source has no schedule).
- Produces: `businessHoursBetween(from: Date, to: Date, timeZone: string): number` (hours that fall on Monday to Friday in that zone); `syncState` takes `stale_business_days` and a zone and uses it when the flag is on.

- [ ] **Step 1: Write the failing tests.**

```ts
// zone America/New_York
it("counts no hours across a whole weekend", () => /* Fri 17:00 -> Mon 07:00 is 7 + 7 = 14 */ ...);
it("counts every hour between two weekday instants", ...);           // Tue 09:00 -> Wed 09:00 is 24
it("counts nothing when both ends are inside one weekend", ...);
it("is not stale on Monday 07:00 after a Friday 17:00 sync with 48 hours and weekdays only", ...);
it("is stale in the same case with weekdays only off", ...);          // 62 elapsed hours > 48
it("is stale on Wednesday 18:00 after a Friday 17:00 sync with weekdays only", ...);  // 7 + 24 + 24 + 18 = 73 > 48
it("judges the weekend in the source's zone, not UTC", ...);          // Sunday 23:00 New York is Monday in UTC
it("leaves a source with the flag off exactly as before", ...);       // every existing state test unchanged
```

- [ ] **Step 2: Run to see them fail, implement,** then add a checkbox "Count weekdays only" beside "Stale after (hours)" with the help line "Weekends do not count toward the limit." Draft test: the flag round-trips through `draftToInput`.

- [ ] **Step 3: Run the gates and commit.** `git commit -m "Let a data source's staleness count weekdays only"`

---

### Task 8: Sync now and a last-updated stamp on Production

**Files:**
- Create: `src/components/production/ProductionSync.tsx`
- Modify: `src/pages/production/ProductionPage.tsx`
- Test: `src/pages/phase2-production-sync.test.tsx`

**Interfaces:**
- Consumes: `useHub().can("sync_run")`, `hasModule(company, "data_sources")`, `listSyncSources(companyId)`, `requestSync(sourceId)`, `formatDateTime`.
- Produces: `ProductionSync({ companyId }: { companyId: string })`.

- [ ] **Step 1: Write the failing tests.** The manager persona's mock `listConnections` returns an empty list, as RLS does for a non-admin.

```ts
it("a manager with sync_run sees each enabled Production source with 'Last updated' and its time", ...);
it("a source never synced reads 'Not synced yet'", ...);
it("a source whose last sync failed says so and still shows the last good time", ...);   // "The last sync did not finish. Showing figures from {time}."
it("never reads 'Not connected' because the connection list is empty", ...);
it("Sync now calls requestSync for that source, disables while it runs, then re-reads the sources and shows the new time", ...);
it("shows the server's plain reason when a sync is refused", ...);       // the 409 message from the function, through lib/errors
it("is absent without sync_run, and absent when the company does not have data sources", ...);
it("shows nothing when the company has no Production source", ...);
it("an admin still gets the full source panel as before", ...);
```

- [ ] **Step 2: Run to see them fail, implement.** The component lists `enabled && target_module === "pm_capacity"` sources, builds the stamp from `last_success_at`, `last_status` and `last_error` on the source row only, and never calls `listConnections`. It renders above the PM capacity card for anyone with `can("sync_run")` who is not an admin; admins keep `SourcePanel`.

- [ ] **Step 3: Run the gates and commit.** `git commit -m "Put Sync now and a last-updated stamp on Production for people who may sync"`

---

### Task 9: Docs

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the README.** Ledger: 0042 to 0045 as written and not applied; next free number 0046; extend the "go forwards only" note (re-pasting 0024 or 0037 after 0042 restores the old company guard and audit; re-pasting 0030 after 0045 restores the old source audit and schedule check). Sections: Modules (the manual Financials switch is a company setting, not a module, and why), wins (days on Home and the archive), Production (statuses, standard milestones, Sync now for people who may sync, replacing the note that the button is still to come), Data sources (sync days, weekdays-only staleness, and that the `connections` function must be redeployed after 0045 for the new schedule to run). Rollout order for this release: paste 0042 to 0045, then deploy the app, then redeploy the function.

- [ ] **Step 2: Run the gates and commit.** `git commit -m "Document Phase 2: company display settings, milestone statuses and templates, sync days"`

---

## Rollout, by hand

The order matters. The new app loads the company with `wins_home_days` and `manual_financials` at sign-in, so if it is deployed before 0042 every user of all three companies sees "Could not load your company"; it also reads milestone statuses, `milestone_templates` and `sync_weekdays`. The new `connections` function names `sync_weekdays`, so it never goes in before 0045. The migrations go in first; the app and function running today never read the new columns.

1. Back up, then paste 0042, 0043, 0044 and 0045 in order, once each. On their own they change nothing visible for any company.
2. Confirm the API serves the new columns and table: run `notify pgrst, 'reload schema';` in the SQL editor, or make one signed-in read of `milestone_templates`.
3. Only then merge to `main` and let Vercel deploy the app. A preview build pointed at the live project fails the same way until 0042 is in. The milestone badge wording changes with this deploy: "Open" becomes "Not started" or "In progress", and "Done {date}" becomes "Complete {date}". The admin action on a win also changes from "Archive" to "Remove".
4. Redeploy the `connections` function: `supabase functions deploy connections --no-verify-jwt`. Until then a source runs on its lowest day only.
5. In the app, for Kingdom: set 14 days on Rococo > Companies; add the standard milestones in Settings > Production; set sync days and weekdays-only staleness on each source once sources exist.
6. Record 0042 to 0045 as applied, and the `connections` redeploy, in the README's What is applied live.
