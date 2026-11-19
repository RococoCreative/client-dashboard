# Hub Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move setup into the module it configures, turn many-item pages into list and detail, turn the person page into tabs, and make text readable, in three releases to live.

**Architecture:** Three shared UI primitives (list and detail, read-first row, type classes) plus two theme tokens are built once and applied page by page. Screens move by route; every old address redirects. No service, mock, RLS or scoring code changes meaning.

**Tech Stack:** Vite, React 19, TypeScript, Tailwind v4 theme tokens, react-router v6, vitest + Testing Library, Playwright for the screenshot pass.

**Spec:** `docs/superpowers/specs/2026-11-19-hub-clarity-design.md`

## Global Constraints

- Branch `claude/hub-clarity`, cut from live (`origin/main`). Each phase merges to `main`, then `main` merges into `claude/laughing-cannon-50onn9` (the held GSR rhythm branch).
- No migration, no service signature change, no change to who can see or do what. A screen that moves keeps its gate (`AdminOnly`, `LeadOnly`, `CapabilityOnly`, `ModuleOnly`, `can(...)`).
- Theme tokens only. A new token is added to all four themes (`rococo`, `klasik`, `kingdom`, `rba`) in `src/index.css`.
- Copy: calm, plain, no em dashes, industry neutral. Every new file opens with a comment saying why it exists. No barrel files.
- Layout rules from the spec: gutters 48 / 24 / 16px, card padding 24 / 16px, nothing within 16px of an edge, text fits by layout first, then size (never under 12px), then truncation.
- Icon buttons (pencil, back, chevron, plus, search, menu) carry an accessible name and a tooltip, 36px on desktop and 44px at phone width. Retire, Delete and primary actions keep their words.
- Read first applies to setup fields. Ratings, KPI and financial results, deliverable task ratings and scorecard cells stay live controls.
- Gates before every commit that ends a task: `npm run lint`, `npx vitest run`, and `VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=sb_publishable_placeholder npm run build`.

## Review Focus

1. A role address for a role that is gone or belongs to another company (a Rococo admin switches company in the sidebar): the detail shows "That role is not in this company." beside the list, never another company's role. Test in Task 4.
2. A person tab the viewer may not open (a manager on `/people/:id/setup`, any tab name that does not exist): lands on Overview. Test in Task 5.
3. An old bookmark with a hash, `/goals/roles#role-goals-<id>`: lands on People, Roles without error. Test in Task 3.
4. A 60-character role name and a person name with no spaces at 390px: no sideways scroll, name wraps or truncates with the full name on hover. Screenshot check in Tasks 6, 14, 20.
5. A company with no roles, no divisions, or no Monthly GSRs pillar: each page shows one quiet line and its add action, never an empty frame. Tests in Tasks 4 and 8.

## File Structure

New:
- `src/test/denseLoad.ts`: demo-only RBA-sized sample data, switched on by `?load=dense`.
- `src/components/ui/type.ts`: the type scale as class constants.
- `src/components/ui/ListDetail.tsx`, `src/components/ui/EditRow.tsx` (+ tests).
- `src/pages/people/peopleTabs.ts`, `RolesPage.tsx`, `DivisionsPage.tsx`, `personTabs.ts`.
- `src/components/people/PeopleHeader.tsx`, `RoleDetail.tsx`, `RoleMetricsSection.tsx`, `RoleGoalsSection.tsx`.
- `src/components/people/person/PersonOverview.tsx`, `PersonGsrGoals.tsx`, `PersonScorecardTab.tsx`, `PersonReviews.tsx`, `PersonSetup.tsx`.
- Phase 2: `src/pages/gsr/reviewsTabs.ts`, `gsrTabs.ts`, `ReviewsSetupPage.tsx`, `GsrSetupPage.tsx`, `src/pages/production/productionTabs.ts`, `ProductionSetupPage.tsx`, `src/components/gsr/RequiredGoalsField.tsx`, `src/components/home/TeamBlock.tsx`, `src/components/settings/MovedCard.tsx`.

Moved (same code, new home): `components/settings/DivisionsPanel.tsx` to `components/people/`, `PillarsPanel.tsx` and `DeliverableCategoriesPanel.tsx` to `components/reviews/`, `MilestoneTemplatePanel.tsx` to `components/production/`.

Deleted once their content lives in the new files: `components/settings/JobRolesPanel.tsx`, `components/goals/RoleGoalsPanel.tsx`, `components/goals/roleGoalsAnchor.ts`.

---

# Phase 1: People, and the shared patterns

### Task 1: Dense demo load, type scale, contrast tokens

**Files:**
- Create: `src/test/denseLoad.ts`, `src/components/ui/type.ts`, `src/lib/theme.contrast.test.ts`
- Modify: `src/test/fixtures.ts` (call `applyDenseLoad` for RBA when the page address carries `load=dense`), `src/index.css`, `src/components/ui/forms.ts`

**Interfaces:**
- Produces: `applyDenseLoad(bundle: CompanyBundle): void` (adds made-up people, job roles, role metrics and role goals until RBA holds 22 people, 17 roles, 54 metrics, 35 role goals; turns on modules `tasks`, `external_links`, `production`). Runs only when `new URLSearchParams(window.location.search).get("load") === "dense"`, so page tests never see it.
- Produces: semantic color `link` (`--color-link: var(--t-link)`), class `text-link`.
- Produces from `components/ui/type.ts`: `pageTitleClass` (30px display), `sectionTitleClass` (18px display), `itemTitleClass` (15px medium), `bodyClass` (14px), `secondaryClass` (13px ink-2), `metaClass` (12.5px ink-3). `helpClass` in `forms.ts` becomes 12.5px.

- [ ] **Step 1: Write the failing contrast test** in `src/lib/theme.contrast.test.ts`: read `src/index.css` with `node:fs`, parse each `[data-theme="..."]` block's `--t-*` hex values, and assert for all four themes that the WCAG contrast of `--t-ink-3` on `--t-surface`, `--t-ink-3` on `--t-bg`, `--t-link` on `--t-surface` and `--t-link` on `--t-bg` is `>= 4.5`.
- [ ] **Step 2: Run** `npx vitest run src/lib/theme.contrast.test.ts`. Expected: FAIL (`--t-link` missing; `ink-3` under 4.5 in at least `rba`).
- [ ] **Step 3: Change `src/index.css`**: in each theme raise `--t-ink-3` the least amount that passes, keeping its hue; add `--t-link` (the accent's hue, adjusted to pass); map `--color-link` in the `@theme inline` block. Replace `text-accent` with `text-link` on link text across `src/` (buttons, borders, marks and active nav backgrounds keep `accent`).
- [ ] **Step 4: Add `type.ts` and `denseLoad.ts`**, wire `applyDenseLoad` into `fixtures.ts`.
- [ ] **Step 5: Run the gates.** Expected: all pass, test count up by the contrast cases, no existing assertion changed.
- [ ] **Step 6: Commit** `Add the link and ink-3 contrast tokens, the type scale, and a dense demo load`.

### Task 2: List and detail, and the read-first row

**Files:**
- Create: `src/components/ui/ListDetail.tsx`, `src/components/ui/EditRow.tsx`, `src/components/ui/ListDetail.test.tsx`, `src/components/ui/EditRow.test.tsx`

**Interfaces:**
- Produces:
```ts
export interface ListDetailItem { id: string; title: string; meta?: string; muted?: boolean }
export default function ListDetail(props: {
  label: string;                       // accessible name of the list, e.g. "Job roles"
  items: ListDetailItem[];
  selectedId: string | null;           // null: nothing chosen (phone shows the list)
  hrefFor: (id: string) => string;     // each item is a link, so it has its own address
  backHref: string;                    // the list's own address, for the phone back arrow
  countLabel: string;                  // "17 roles"
  searchLabel?: string;                // shows a search box when set; filters on title
  actions?: ReactNode;                 // the one add button
  footer?: ReactNode;                  // e.g. retired group
  children: ReactNode;                 // the detail
}): JSX.Element
export default function EditRow(props: {
  display: ReactNode;                  // the row as text
  editLabel: string;                   // accessible name of the pencil, e.g. "Edit Optimization rate"
  editing: boolean; onEdit: () => void; onDone: () => void;
  children: ReactNode;                 // the form shown while editing
}): JSX.Element
```
- Layout: at `lg` and up, list 320px beside the detail; below `lg`, the list alone when `selectedId` is null, otherwise the detail with a back arrow link to `backHref`. The selected item carries `aria-current="true"`.

- [ ] **Step 1: Write failing tests.** `ListDetail`: renders every item as a link to `hrefFor(id)`; the selected one has `aria-current`; typing "site" in the search box leaves only titles containing it; no match shows "Nothing matches that."; with `selectedId` null the detail is not rendered. `EditRow`: shows `display` and a button named `editLabel`; clicking it calls `onEdit`; with `editing` true it shows `children` and a "Done" button that calls `onDone`.
- [ ] **Step 2: Run** `npx vitest run src/components/ui/ListDetail.test.tsx src/components/ui/EditRow.test.tsx`. Expected: FAIL, modules not found.
- [ ] **Step 3: Implement both** with existing primitives (`IconButton`, `Button`, `inputClass`) and lucide icons already in the project.
- [ ] **Step 4: Run the tests, then the gates.** Expected: PASS.
- [ ] **Step 5: Commit** `Add the list and detail and read-first row primitives`.

### Task 3: People tabs, Divisions tab, roster tidy, redirects

**Files:**
- Create: `src/pages/people/peopleTabs.ts`, `src/components/people/PeopleHeader.tsx`, `src/pages/people/DivisionsPage.tsx`
- Move: `src/components/settings/DivisionsPanel.tsx` to `src/components/people/DivisionsPanel.tsx`
- Modify: `src/pages/people/PeoplePage.tsx`, `src/App.tsx`, `src/pages/settings/settingsTabs.ts`, `src/pages/settings/SettingsPage.tsx`, `src/pages/gsr/goalsTabs.ts`, `src/pages/gsr/GoalsPage.tsx`, tests that name the moved screens
- Test: `src/pages/hub-clarity-people.test.tsx` (new)

**Interfaces:**
- Produces: `PEOPLE_TABS` = Roster `/people` (end), Roles `/people/roles`, Divisions `/people/divisions`; `peopleTabsFor(isAdmin: boolean)` returns all three for admins and none for a manager (their page stays "Your team", no tab row).
- Produces: `PeopleHeader({ tab }: { tab: "roster" | "roles" | "divisions" })`: the page header plus the tab row.
- Routes: `people/roles` and `people/roles/:roleId` (`AdminOnly`, Task 4 fills them), `people/divisions` (`AdminOnly`). Redirects: `/settings/roles` and `/goals/roles` to `/people/roles`.
- `SETTINGS_TABS` loses `roles`; `GOALS_TABS` loses `roles`.

- [ ] **Step 1: Write failing tests** in `hub-clarity-people.test.tsx` (mock lines as in `src/pages/pages.test.tsx`): an RBA admin on `/people` sees tabs Roster, Roles, Divisions; a manager sees no tab row; the roster shows each person's hub role as text and no role `combobox`, and no Deactivate or Remove button, while Send invite and Copy link remain; `/people/divisions` shows the Divisions panel; rendering `App` routes at `/settings/roles`, `/goals/roles` and `/goals/roles#role-goals-x` lands on `/people/roles`.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.** Roster: replace the role select with `ROLE_LABELS[role]`; remove Deactivate, Reactivate and Remove from rows (Task 5 puts them on the person's Setup tab); keep invite actions. Move `DivisionsPanel`. Add the routes and redirects. Settings, Company gains a short "Roles and divisions are under People." line with a link (the full signpost card comes in Task 10).
- [ ] **Step 4: Update the existing tests** that reached Roles or Divisions through Settings or changed a role from the roster, pointing them at the new screens with the same assertions.
- [ ] **Step 5: Run the gates.** Expected: PASS.
- [ ] **Step 6: Commit** `Give People its Roster, Roles and Divisions tabs, and redirect the old addresses`.

### Task 4: Roles as list and detail

**Files:**
- Create: `src/pages/people/RolesPage.tsx`, `src/components/people/RoleDetail.tsx`, `src/components/people/RoleMetricsSection.tsx`, `src/components/people/RoleGoalsSection.tsx`
- Delete: `src/components/settings/JobRolesPanel.tsx`, `src/components/goals/RoleGoalsPanel.tsx`, `src/components/goals/roleGoalsAnchor.ts` (update `roleGoalsPath` callers in `GoalSettingPanel.tsx` and `PersonScorecard.tsx` to `/people/roles/${roleId}`)
- Test: `src/pages/hub-clarity-roles.test.tsx` (new); migrate the role cases in `build-ui1.test.tsx`, `pages.test.tsx`, `ia.test.tsx`

**Interfaces:**
- Consumes: `ListDetail`, `EditRow` (Task 2); `PeopleHeader` (Task 3); services `listJobRoles(companyId, true)`, `listJobRoleGoals`, `listRoleMetrics(companyId, true)`, `listCompanyProfiles`, `updateJobRole`, `createJobRole`, `deleteJobRole`, `createJobRoleGoal`, `updateJobRoleGoal`, `deleteJobRoleGoal`, `createRoleMetric`, `updateRoleMetric`, `deleteRoleMetric`, `updateProfile`, all unchanged.
- Produces: `RolesPage()` reading `useParams().roleId`. With no id on a wide screen it opens the first active role (a replace navigation), so the detail is never empty.
- List item: title = role name, meta = `"{n} people · {m} metrics"` (singular "1 person"), retired roles in a "Retired roles (n)" group below, muted.
- Detail order: header (label "Job role", name as `h2`, pencil "Rename role"), About (description, dashboard modules), Who holds this role (names linking to `/people/:id`, a "Put someone in this role" select of active people not in it, which calls `updateProfile(id, { job_role_id })`), Role goals, Scorecard metrics, then Retire or Restore and Delete with the existing confirm copy.
- Kept exactly: the per-role write queue and pending module ticks from `RoleCard`, metric validation (`parseNumber`, `SCALES`), every existing error message.

- [ ] **Step 1: Write failing tests**: `/people/roles` as an RBA admin lists every role with its counts and opens the first; clicking another role changes the address to `/people/roles/<id>` and the `h2` to its name; the search box narrows the list; a metric row is text until its pencil is clicked, then a form, and saving a new name updates the row; adding a role goal shows it under Role goals; "Put someone in this role" moves that person under Who holds this role; a role id from another company shows "That role is not in this company." with the list still usable (Review Focus 1); a company with no roles shows "No job roles yet." and Add role (Review Focus 5); two quick module ticks send two writes that both land (the queue).
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement**, moving logic out of the two deleted panels rather than rewriting it.
- [ ] **Step 4: Migrate the old role tests**, keeping their assertions.
- [ ] **Step 5: Run the gates.** Expected: PASS.
- [ ] **Step 6: Commit** `Show job roles as a list and one role at a time`.

### Task 5: The person page as tabs

**Files:**
- Create: `src/pages/people/personTabs.ts`, `src/components/people/person/PersonOverview.tsx`, `PersonGsrGoals.tsx`, `PersonScorecardTab.tsx`, `PersonReviews.tsx`, `PersonSetup.tsx`
- Modify: `src/pages/people/PersonPage.tsx` (becomes loader, header, tab row and a switch), `src/components/tasks/PersonTasks.tsx`, `src/App.tsx`
- Test: `src/pages/hub-clarity-person.test.tsx` (new); update `ia.test.tsx`, `person-tasks-team.test.tsx`, `capabilities-screens.test.tsx`, `build-ui2.test.tsx` to open the tab their section now lives on

**Interfaces:**
- Produces: `type PersonTab = "overview" | "gsr" | "scorecard" | "tasks" | "reviews" | "setup"`; `personTabsFor(v: { personId: string; isAdmin: boolean; tasksOn: boolean; rococoPerson: boolean }): TabItem[]` (Tasks only when the module is on; Setup only for admins; a Rococo admin's row gets Overview and GSR and goals only, as today's page shows them).
- Routes: `people/:profileId` (Overview) and `people/:profileId/:tab`, both `LeadOnly`. An unknown tab, or one `personTabsFor` does not return, redirects to Overview.
- `PersonPage` keeps its single load and its write queues; each tab is a component given the loaded data and the existing callbacks. Pay is requested only when `isAdmin && can("pay")`, as today.
- `PersonTasks` gains `limit?: number` and `moreHref?: string` (Overview shows 3 open tasks and "All tasks").
- Tab contents:
  - Overview: current GSR block, latest score and average, open tasks (limit 3), who reports to them, a read-only details strip (email, hired, job role linking to `/people/roles/:id`, division, reports to, hub access, department, phone) with "Edit in Setup" for admins.
  - GSR and goals: current GSR block, then "This year, next year and the BHAG".
  - Scorecard: role scorecard and projects, personal KPIs, financial figures (admins).
  - Tasks: `PersonTasks` in full.
  - Reviews: impact score ratings, deliverables, review history, latest scored review.
  - Setup: the details form, hub role, divisions and view access, compensation where pay is allowed, then Deactivate or Reactivate and Remove (the roster's rules and confirm copy, moved; Remove only for a person with no account and no pending invitation).

- [ ] **Step 1: Write failing tests**: an admin on `/people/:id` sees six tabs and the Overview cards; `/people/:id/setup` shows the details form and Deactivate; a manager sees no Setup tab, and `/people/:id/setup` and `/people/:id/nope` land on Overview (Review Focus 2); the Reviews tab holds ratings and review history; the Scorecard tab holds KPIs; Deactivate on Setup marks the person inactive; Remove on a never-signed-in person with no invitation deletes them and returns to `/people`; a person without `can("pay")` viewer shows no compensation on any tab.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement** by moving JSX blocks out of `PersonPage.tsx` into the tab components unchanged, then adding the Overview strip and the tab row.
- [ ] **Step 4: Update the listed existing tests** to the new addresses, keeping their assertions.
- [ ] **Step 5: Run the gates.** Expected: PASS.
- [ ] **Step 6: Commit** `Turn the person page into tabs and move account actions to Setup`.

### Task 6: Phase 1 screenshot pass and release

- [ ] **Step 1: Run the demo** with `npm run demo`, open pages with `?persona=admin&company=rba&load=dense` (and `persona=manager`), and with Playwright capture `/people`, `/people/roles`, `/people/roles/<long-name role>`, `/people/divisions`, `/people/<id>` and each person tab at 390, 768 and 1440 wide. Record `document.documentElement.scrollHeight` and `scrollWidth`.
- [ ] **Step 2: Check the measures**: `scrollWidth` equals the viewport at every width; Roles and each person tab under 2 screens at 1440 by 900; gutters hold; a 60-character role name wraps or truncates cleanly (Review Focus 4). Fix what fails, rerun.
- [ ] **Step 3: Run the gates** and `npm run test:sql` (unchanged SQL must still pass).
- [ ] **Step 4: Merge to `main`** with a merge commit, push, confirm CI is green.
- [ ] **Step 5: Merge `main` into `claude/laughing-cannon-50onn9`**, settle conflicts keeping both the rhythm behaviour and the new layout, run the gates there, push.

---

# Phase 2: Setup in each module, and the reports

### Task 7: Reviews, Setup

**Files:** Create `src/pages/gsr/reviewsTabs.ts`, `src/pages/gsr/ReviewsSetupPage.tsx`. Move `PillarsPanel.tsx` and `DeliverableCategoriesPanel.tsx` to `src/components/reviews/`. Modify `CyclesPage.tsx` (tab row when `section === "reviews"`), `App.tsx`, `settingsTabs.ts`, `SettingsPage.tsx`. Test `src/pages/hub-clarity-setup.test.tsx`.

**Interfaces:** `REVIEWS_TABS` = Cycles `/reviews` (end), Setup `/reviews/setup` (`AdminOnly`). Pillars render as rows (number, name, scoring type, weight, chevron); one open at a time, held in component state; the open pillar shows its fields through `EditRow` and its criteria as read-first rows; Move up, Move down and Delete pillar sit at the foot of the open pillar. Redirects: `/settings/reviews`, `/reviews/settings`, `/gsr/settings` to `/reviews/setup`.

- [ ] **Step 1: Failing tests**: `/reviews` shows tabs Cycles and Setup; `/reviews/setup` lists pillars closed with name, type and weight, and the "Weights total 100%" badge; opening one shows its criteria and closes any other; editing a weight through its pencil saves; the three old addresses redirect.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: Migrate tests that reached pillars through Settings.** **Step 5: Gates.** **Step 6: Commit** `Move review setup under Reviews, one pillar open at a time`.

### Task 8: GSRs, Setup

**Files:** Create `src/pages/gsr/gsrTabs.ts`, `src/pages/gsr/GsrSetupPage.tsx`, `src/components/gsr/RequiredGoalsField.tsx`. Modify `CyclesPage.tsx` (tab row when `section === "gsr"`), `App.tsx`, `goalsTabs.ts`, `GoalsPage.tsx`, `src/components/reviews/PillarsPanel.tsx`, `src/lib/navigation.ts`.

**Interfaces:** `GSR_TABS` = Periods `/gsr` (end), Setup `/gsr/setup` (`AdminOnly`). `RequiredGoalsField({ pillar: GsrPillar; onSaved: (p: GsrPillar) => void })` edits `required_goals` through `updatePillar`. The Monthly GSRs pillar card shows "N goals each" as text with a link to `/gsr/setup`. Nav label "Monthly GSRs" becomes "GSRs". `GOALS_TABS` loses `focus`; `/goals/focus` redirects to `/gsr/setup`.

- [ ] **Step 1: Failing tests**: `/gsr/setup` shows the focus topic calendar and "Goals each GSR requires" with the stored number; changing it saves through `updatePillar`; a company with no active Monthly GSRs pillar shows "GSRs are not scored here yet." and the calendar (Review Focus 5); the sidebar reads "GSRs"; `/goals/focus` redirects.
- [ ] **Step 2 to 6:** run, implement, migrate, gates, commit `Move GSR setup under GSRs`.

### Task 9: Projects, Setup

**Files:** Create `src/pages/production/productionTabs.ts`, `src/pages/production/ProductionSetupPage.tsx`. Move `MilestoneTemplatePanel.tsx` to `src/components/production/`. Modify `ProductionPage.tsx`, `App.tsx`, `settingsTabs.ts`, `SettingsPage.tsx`; update `phase2-milestones.test.tsx`.

**Interfaces:** Tabs Projects `/production` (end), Setup `/production/setup`, the Setup tab and route gated exactly as the Settings tab is today (`AdminOnly`, `ModuleOnly module="production"`). `/settings/production` redirects.

- [ ] **Steps:** failing tests (tab visible to an admin with the module, hidden otherwise; the panel renders on `/production/setup`; redirect), implement, migrate, gates, commit `Move standard milestones under Projects`.

### Task 10: Settings and Goals, slimmed

**Files:** Create `src/components/settings/MovedCard.tsx`. Modify `settingsTabs.ts`, `SettingsPage.tsx`, `goalsTabs.ts`.

**Interfaces:** `SETTINGS_TABS` = Company, Connections, Activity (capability gates unchanged). `MovedCard` lists four rows, each a link: "Job roles and divisions" to `/people/roles`, "Pillars, weights and deliverable categories" to `/reviews/setup`, "Focus topics and the goals a GSR requires" to `/gsr/setup`, "Standard milestones" to `/production/setup` (that row only with the production module). Company fields become read first with one Edit button. `GOALS_TABS` = Company, People.

- [ ] **Steps:** failing tests (three tabs; the card and its links; Company shows values as text until Edit), implement, gates, commit `Slim Settings to the company itself and signpost what moved`.

### Task 11: Scorecards as one table

**Files:** Modify `src/pages/gsr/ScorecardsPage.tsx`, `src/components/scorecards/compare.ts` only if a helper is needed (no arithmetic change); update `build-ui2.test.tsx`.

**Interfaces:** A role `select` ("All roles" plus roles that have people) replaces the chips. One table with a header row per role (role name, people count) followed by that role's people; each role's metric columns stay as today within its block. Roles with nobody are not shown. Page label reads "People". On a narrow screen each person becomes a stacked card.

- [ ] **Steps:** failing tests (select lists only roles with people; choosing one shows only that block; a role with nobody is absent; existing cell labels unchanged), implement, gates, commit `Show scorecards as one table grouped by role`.

### Task 12: Home by audience

**Files:** Create `src/components/home/TeamBlock.tsx`. Modify `src/pages/DashboardPage.tsx`; update dashboard tests.

**Interfaces:** `TeamBlock({ companyId, viewer, people, cycles })` for a non-admin lead: one row per person in `ledBy(viewer, people)` who reports to the viewer directly, with the current GSR status (from `listCycleReviews` of the GSR cycle in play: Not started, In progress, Complete), open task count and overdue count (from `listTasks(companyId, { status: "open" })`, only when the tasks module is on), each row linking to `/people/:id`. Employee Home order: GSR card first with a primary "Start my GSR" or "Open my GSR" button, then tasks, goals, scores, figures, company goals, SOPs. Manager Home: GSR card, `TeamBlock`, then the employee order. Admin Home: attention card and open cycles first, then tiles. An empty links panel is one line of text, last.

- [ ] **Steps:** failing tests (manager sees "Your team" with their direct reports and statuses; employee's first card is the GSR with a primary button; empty links render as one line after the cards; admin's first section is attention), implement, gates, commit `Order Home by who is looking, with a team block for managers`.

### Task 13: My GSR title and naming

**Files:** Modify `src/pages/gsr/MyGsrPage.tsx`, `MyReviewsPage.tsx`, `MyGoalsPage.tsx`, `src/pages/gsr/myTabs.ts`, `ScorecardsPage.tsx` label.

**Interfaces:** Each My page has a `PageHeader`. The GSR, Reviews, Goals tab row shows only when the viewer's sidebar does not list those three (admins, whose sidebar has only My GSR).

- [ ] **Steps:** failing tests (an employee sees a title and no tab row; an admin sees the tab row), implement, gates, commit `Title the My pages and drop the tabs the sidebar already gives`.

### Task 14: Phase 2 screenshot pass and release

- [ ] Same five steps as Task 6, over `/reviews/setup`, `/gsr/setup`, `/production/setup`, `/settings/company`, `/goals`, `/scorecards`, and Home as admin, manager and employee. Measure: no setup page over 3 screens at 1440 by 900.

---

# Phase 3: Sweep and phone

### Task 15: A failed save says so in words

**Files:** Modify `src/components/ui/BlurInput.tsx`, `BlurInput.test.tsx`, `src/components/ui/ProgressSlider.tsx`.

**Interfaces:** When a save fails, `BlurInput` renders visible text "Not saved" (danger color, 12px) directly under the field, in addition to the outline, inside a wrapper that does not change the field's width. It clears on the next successful save or when the stored value is restored.

- [ ] **Steps:** failing test (`getByText("Not saved")` is visible, not `sr-only`, after a rejected save, and gone after a later success), implement, gates, commit `Say Not saved beside a field whose save failed`.

### Task 16: Sweep, reviews and GSR screens

**Files:** `src/pages/gsr/ReviewPage.tsx`, `CyclePage.tsx`, `CyclesPage.tsx`, `src/components/gsr/*`.

- [ ] Apply the layout rules, type classes, `text-link`, icon buttons for row actions and one primary action per page. Setup-like fields on these pages (cycle name and dates, feedback headings) read first; goals, ratings and results stay live. No behaviour or copy that a test pins changes. Gates, then commit `Apply the clarity patterns to the review and GSR screens`.

### Task 17: Sweep, money, marketing, production, wins

**Files:** `src/pages/FinancialsPage.tsx`, `MarketingPage.tsx`, `src/pages/salesFinance/*`, `src/pages/production/*`, `src/pages/WinsPage.tsx`, `src/components/settings/ConnectionsPanel.tsx`, `DataSourcesPanel.tsx`.

- [ ] Same treatment. Data sources (the longest remaining setup list) becomes list and detail on Settings, Connections if it holds more than three sources, else stays as rows. Gates, commit `Apply the clarity patterns to finance, marketing, production and connections`.

### Task 18: Sweep, tasks, library, Rococo

**Files:** `src/pages/tasks/*`, `src/components/tasks/*`, `src/pages/resources/*`, `src/pages/sops/*`, `src/pages/rococo/*`, remaining `src/components/*`.

- [ ] Same treatment. Gates, commit `Apply the clarity patterns to tasks, the library and the Rococo pages`.

### Task 19: Phone pass

**Files:** `src/components/AppLayout.tsx` and any page the pass flags.

- [ ] Capture every route in `src/App.tsx` at 390 by 844 for admin, manager and employee with `load=dense`. Required: `scrollWidth === 390` everywhere; tap targets at least 44px (`@media (pointer: coarse)` raises `IconButton` and row heights); tabs scroll sideways; tables stack or scroll in their own box; page gutter 16px. Fix, rerun, gates, commit `Make every page work at phone width`.

### Task 20: Final pass and release

- [ ] Same five steps as Task 6 over every route at 390, 768 and 1440. Confirm the spec's measures: no setup page over 3 screens, every repeated item named and addressable, contrast test green, every old address redirecting. Merge to `main`, then into the rhythm branch.
