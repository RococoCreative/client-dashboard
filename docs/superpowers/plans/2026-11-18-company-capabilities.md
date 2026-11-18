This file exists to drive Phase 1 of the Kingdom intake build task by task: a per-company capability table, the policies and screens that read it, and Kingdom's roster and permission rows.

# Company Capabilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each company decide the lowest role that may do seven things (see pay, change company settings, read the change log, edit milestones, post wins, press Sync now, open Production), with defaults that reproduce today's behaviour exactly, then load Kingdom's answers as rows.

**Architecture:** A catalog table (`capabilities`) holds each capability and its default lowest role. An override table (`company_capabilities`) holds a company's own choice. One private helper, `private.can(cid, cap)`, answers for the signed-in person and is called from the policies that today call `can_manage_company`. The app reads the same two tables once per active company and exposes `can(cap)` on `HubContext`. A capability only narrows or widens by rank; who a person may see (0038) is untouched and still applies alongside it.

**Tech Stack:** Postgres RLS (Supabase), the SQL harness in `supabase/tests`, Vite, React 19, TypeScript, Vitest and Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-18-kingdom-intake-build-structure.md` (Phase 1, approach A1). Earlier design it completes: `docs/kingdom-revamp-plan.md` slice S13.

## Global Constraints

- CLAUDE.md hard rules bind every task. The ones this plan leans on: the wall is RLS, never UI (rule 4); find the signed-in person by account, never assume a profile has one (rule 5); migrations are append-only and idempotent, `src/types/database.ts` stays in step (rule 8); no branch on a company name, slug or theme key anywhere in a migration, a policy or the app (rule 12).
- The only place a company is named is `supabase/seeds/kingdom_intake.sql`, found by slug, the way `supabase/seeds/rba_scorecards.sql` does it.
- No new function reachable through PostgREST. Helpers live in `private`, are `security definer` with `set search_path = ''`, and are revoked from `public, anon`.
- With no override rows, every existing SQL test file passes unchanged. That is the proof that Klasik and RBA do not move.
- When a migration rebuilds a policy or function, copy its latest body (search every later migration for the name first) and change only the named clause.
- Next free migration number is 0040. This plan uses 0040 and 0041.
- Services throw, pages message (`lib/errors.ts`). Every service function has a mock of the same name (`src/test/mocks/parity.test.ts`).
- Theme tokens and `components/ui/*` primitives only. Every file opens with a comment saying why it exists. Copy is calm and plain with no em dashes.
- Before every commit: `npm run lint`, `npx vitest run`, `npm run build`. For any task touching `supabase/`: `npm run test:sql` as well.

## Decisions this plan makes

These are calls made while planning. Each is cheap to change before Task 2 ships.

1. **Pay means `compensation_items` only.** `employee_financials` (a person's own financial figures) stays as it is. Kingdom allows its Admin to see financial numbers and not pay.
2. **A person keeps reading their own pay.** Today's rule. Kingdom's answer is ambiguous on it (open question 13 in the spec).
3. **Company settings means the company row** (name, logo, time zone). Job roles, divisions, review setup, people and connections stay with admins, since Kingdom's Admin adds people, changes roles and connects systems.
4. **Open Production is a screen gate, not a row gate.** Employees still read project names in the database, because a win they post can name a project.
5. **Only Rococo writes capability rows in this phase.** No settings screen for it yet. Kingdom's rows arrive by seed script.
6. **Edit and archive of wins stays with admins.** That already matches Kingdom's answer, so it gets no capability.
7. **Direct-reports-only teams are not built** (spec C6).

## Capabilities

| Key | Default lowest role (today) | Kingdom |
|---|---|---|
| `pay` | `admin` | `owner` |
| `company_settings` | `admin` | `owner` |
| `audit_log` | `rococo` | `admin` |
| `milestones_edit` | `admin` | `manager` |
| `wins_post` | `admin` | `employee` |
| `sync_run` | `admin` | `manager` |
| `production_view` | `employee` | `manager` |

`rococo` as a lowest role means no company role qualifies. A Rococo admin passes every capability.

## Review Focus

1. **Capabilities fail to load.** A network error while reading them must show the existing "Could not load your company" retry card. It must never fall back to granting anything. Pinned in Task 3.
2. **A Rococo admin switches company in the sidebar.** The previous company's capabilities must not apply to the next one for even one render. Pinned in Task 3.
3. **An admin without `company_settings` opens `/settings`.** They land on the first tab they may open, not on Home and not in a redirect loop. Pinned in Task 4.
4. **An admin without `pay` opens a person.** The annual compensation figure and the compensation table are absent. Neither may render as zero or "Not recorded", which would read as a fact about the person. Pinned in Task 4.
5. **The seed meets a person who already exists.** An address that differs only by letter case, or a person who has already signed in, is matched and updated, never duplicated, and their account link is never touched. Pinned in Task 6.

---

### Task 1: The capability tables and `private.can`

**Files:**
- Create: `supabase/migrations/0040_capabilities.sql`
- Create: `supabase/tests/0040_capabilities.test.sql`
- Modify: `src/types/database.ts`

**Interfaces:**
- Produces (SQL): `public.capabilities (key text primary key, default_min_role text not null, sort_order integer not null)`; `public.company_capabilities (company_id uuid not null references companies on delete cascade, capability text not null references capabilities(key), min_role text not null, primary key (company_id, capability))`; `private.can(cid uuid, cap text) returns boolean`.
- Produces (TS): `type CapabilityKey = "pay" | "company_settings" | "audit_log" | "milestones_edit" | "wins_post" | "sync_run" | "production_view"`; `type CapabilityLevel = Role | "rococo"`; `interface Capability { key: CapabilityKey; default_min_role: CapabilityLevel; sort_order: number }`; `interface CompanyCapability { company_id: string; capability: CapabilityKey; min_role: CapabilityLevel }`.

- [ ] **Step 1: Write the failing test file** `supabase/tests/0040_capabilities.test.sql`, in the style of `0027_wins.test.sql` (setup as system, `tests.act_as`, `tests.assert`, reset role at top level). Setup: Kingdom owner, admin, manager, employee; a Klasik admin; a Rococo admin; one deactivated Kingdom owner (`is_active = false`). Cases:

```sql
-- case: defaults_match_today  (no override rows exist)
select tests.act_as(tests.id('kingdom_admin'));
select tests.assert(private.can(tests.company('kingdom'), 'pay'), 'defaults: an admin lost pay');
select tests.assert(private.can(tests.company('kingdom'), 'company_settings'), 'defaults: an admin lost company settings');
select tests.assert(not private.can(tests.company('kingdom'), 'audit_log'), 'defaults: an admin reads the change log');
select tests.assert(private.can(tests.company('kingdom'), 'milestones_edit') and private.can(tests.company('kingdom'), 'wins_post')
                    and private.can(tests.company('kingdom'), 'sync_run'), 'defaults: an admin lost an admin power');
-- as kingdom_manager and kingdom_employee: all six of the above are false, production_view is true.

-- case: override_narrows      (as system: kingdom pay -> owner)
--   kingdom_admin: can(pay) false. kingdom_owner: true. klasik_admin on klasik: still true.
-- case: override_widens       (as system: kingdom wins_post -> employee, milestones_edit -> manager)
--   kingdom_employee: wins_post true, milestones_edit false. kingdom_manager: both true.
-- case: rococo_level_is_never_met   kingdom_owner: can(audit_log) false with the default.
-- case: rococo_passes_everything    rococo_admin: can(kingdom, each of the seven) true.
-- case: other_company_is_false      klasik_admin: can(kingdom, 'production_view') false.
-- case: deactivated_is_false        deactivated owner: can(kingdom, 'production_view') false.
-- case: unknown_capability_is_false kingdom_owner: can(kingdom, 'no_such_thing') false, no error.
-- case: members_read_only_their_rows  kingdom_employee selects 7 from capabilities,
--   sees kingdom override rows, sees 0 klasik override rows.
-- case: only_rococo_writes          kingdom_owner insert into company_capabilities is refused
--   (`tests.assert_raises`); rococo_admin insert succeeds;
--   nobody but system writes public.capabilities.
-- case: bad_level_refused           min_role 'boss' violates the check constraint.
-- case: override_change_is_audited  after a Rococo insert and update, audit_events holds a row
--   with table_name 'company_capabilities' and company_id = kingdom.
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test:sql`
Expected: FAIL in `0040_capabilities.test.sql` with `function private.can(uuid, unknown) does not exist`.

- [ ] **Step 3: Write `0040_capabilities.sql`.** Header comment: what it adds, "Paste after 0039; idempotent", and that it changes no policy (0041 does). Contents:
  - Both tables with `create table if not exists`. Check constraints: `default_min_role` and `min_role` in `('employee','manager','admin','owner','rococo')`.
  - Seed the seven catalog rows from the table above with `on conflict (key) do nothing`, `sort_order` 1 to 7 in table order.
  - RLS on both. `capabilities`: select to `authenticated` using `true`; no write policy. `company_capabilities`: select using `private.is_rococo_admin() or private.is_company_member(company_id)`; insert, update and delete using and with check `private.is_rococo_admin()`.
  - `private.can(cid uuid, cap text)`: `language sql stable security definer set search_path = ''`. True for `private.is_rococo_admin()`. Otherwise find the signed-in person the way `private.has_full_scope()` does (`user_id = (select auth.uid())`, `is_active`, `not is_rococo_admin`, `company_id = cid`), take `coalesce(override.min_role, catalog.default_min_role)`, and return `level <> 'rococo' and private.role_rank(person.role) >= private.role_rank(level)`. `coalesce(..., false)` so an unknown key, another company or no profile is false. Do not change `private.role_rank`. Grants as on `private.has_full_scope()`.
  - Audit trigger `company_capabilities_audit` using `private.audit_change('min_role')`, attached the way 0025 attaches `job_roles_audit`.

- [ ] **Step 4: Add the four TypeScript types** to `src/types/database.ts` beside `Role`.

- [ ] **Step 5: Run the gates**

Run: `npm run test:sql && npm run lint && npx vitest run && npm run build`
Expected: every SQL file passes, including all pre-existing ones; lint, tests and build pass.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0040_capabilities.sql supabase/tests/0040_capabilities.test.sql src/types/database.ts
git commit -m "Add the capability catalog, company overrides and private.can (0040)"
```

---

### Task 2: Point the policies at capabilities

**Files:**
- Create: `supabase/migrations/0041_capability_policies.sql`
- Create: `supabase/tests/0041_capability_policies.test.sql`

**Interfaces:**
- Consumes: `private.can(cid uuid, cap text) returns boolean` from Task 1.
- Produces: no new names. Six behaviours now follow capability rows.

- [ ] **Step 1: Write the failing test file.** Setup as system: Kingdom owner, admin, manager, employee; Klasik admin and employee; a Rococo admin; one project per company with one milestone; one `compensation_items` row for the Kingdom employee and one for the Klasik employee; one `sync_sources` row per company (copy the minimal insert from `0030_sync_engine.test.sql`). Then insert Kingdom's seven override rows from the Capabilities table. Klasik gets none. Cases, each asserting both companies:

```sql
-- case: pay_follows_capability
--   kingdom_admin: select count(*) from compensation_items where company_id = kingdom  -> 0
--   kingdom_admin: insert a compensation row for kingdom_employee                       -> refused
--   kingdom_owner: reads 1, inserts, updates and deletes one.
--   kingdom_employee: still reads their own row (1).
--   klasik_admin: reads 1 and writes, exactly as before.
-- case: employee_financials_unchanged   kingdom_admin still reads and writes employee_financials.
-- case: company_row_follows_capability
--   kingdom_admin: update companies set name = 'X' where id = kingdom -> 0 rows changed.
--   kingdom_owner: 1 row. klasik_admin on klasik: 1 row. rococo_admin: 1 row.
-- case: audit_follows_capability
--   kingdom_admin reads kingdom audit rows (> 0), reads 0 klasik rows and 0 rows with a null
--   company. kingdom_manager reads 0. klasik_admin reads 0 (default). rococo reads all.
-- case: milestones_follow_capability
--   kingdom_manager inserts a milestone and sets completed_on. kingdom_employee is refused.
--   klasik employee and a klasik manager are refused. klasik_admin succeeds.
--   kingdom_manager cannot insert or update a project (still admin only).
-- case: wins_follow_capability
--   kingdom_employee inserts a win; created_by is stamped with their profile. kingdom_employee's
--   update of that win changes 0 rows. kingdom_admin updates it. klasik employee insert refused.
-- case: sync_follows_capability
--   kingdom_manager: select from sync_sources where company_id = kingdom -> 1 row;
--   update sync_sources set sync_requested_at = now() -> 1 row;
--   update sync_sources set name = 'X' -> refused or unchanged (the 0030 guard);
--   select from sync_records and sync_runs -> 0 rows; insert into sync_sources -> refused.
--   kingdom_employee: reads 0 sync_sources. klasik manager: reads 0, updates 0.
-- case: cross_company_stays_closed
--   kingdom_owner writes nothing in klasik through any of the six paths.
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test:sql`
Expected: FAIL in `0041_capability_policies.test.sql` at `pay_follows_capability` (the Kingdom admin still reads pay).

- [ ] **Step 3: Write `0041_capability_policies.sql`.** Header: what moves, "Paste after 0040; idempotent; deploy the app the same day". For each item, `drop policy if exists` then recreate under the same name, from its latest body:
  - **Pay.** The four `compensation_items` policies from 0038 section 6b. In each, the company branch becomes `company_id = private.auth_company_id() and private.can(company_id, 'pay') and (private.has_full_scope() or employee_id in (select private.manageable_person_ids()))`. The Rococo branch and the "own row" read branch are unchanged. `employee_financials` is not touched.
  - **Company row.** The `companies` update policy becomes `private.is_rococo_admin() or private.can(id, 'company_settings')` in both using and with check. `guard_company_fields` is unchanged.
  - **Change log.** Add policy "People with the audit capability read their company's events" on `audit_events` for select: `company_id is not null and private.can(company_id, 'audit_log')`. The Rococo policy stays.
  - **Milestones.** "Admins create milestones" and "Admins update milestones" use `private.can(company_id, 'milestones_edit')`. Check 0026 and 0029 for any milestone trigger that tests `can_manage_company` and move it to the same call. Project policies are unchanged.
  - **Wins.** "Admins create wins" uses `private.can(company_id, 'wins_post')`. The update policy is unchanged.
  - **Sync now.** `private.can_sync_source(cid)` body becomes `select private.can(cid, 'sync_run')`. Add policy "Syncers read sync sources" on `sync_sources` for select using `private.can_sync_source(company_id)`. Nothing else on the sync tables changes.

- [ ] **Step 4: Run the gates**

Run: `npm run test:sql`
Expected: all files pass. If `0030_sync_engine.test.sql` case `syncer_only_may_request` fails, the rebuilt function body is wrong; do not edit that test.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0041_capability_policies.sql supabase/tests/0041_capability_policies.test.sql
git commit -m "Move pay, company settings, the change log, milestones, wins and Sync now onto capabilities (0041)"
```

---

### Task 3: Capabilities in the app

**Files:**
- Create: `src/lib/capabilities.ts`, `src/lib/capabilities.test.ts`
- Create: `src/services/capabilities.ts`, `src/test/mocks/capabilities.ts`
- Modify: `src/context/HubContext.tsx`, `src/App.tsx` (the provider around line 329, and wherever companies are loaded)
- Modify: the test render helper that builds a `HubValue`, and `demo/` wiring if it lists services
- Test: `src/lib/capabilities.test.ts`, and a new `src/pages/capabilities.test.tsx`

**Interfaces:**
- Consumes: the TS types from Task 1.
- Produces:
  - `src/lib/capabilities.ts`: `type CapabilityMap = Record<CapabilityKey, CapabilityLevel>`; `const CAPABILITY_KEYS: readonly CapabilityKey[]`; `function resolveCapabilities(catalog: Capability[], overrides: CompanyCapability[]): CapabilityMap`; `function meets(role: Role, isRococo: boolean, level: CapabilityLevel | undefined): boolean`.
  - `src/services/capabilities.ts`: `async function loadCapabilities(companyId: string): Promise<CapabilityMap>` (two selects, `company_capabilities` filtered by `company_id`, merged with `resolveCapabilities`).
  - `HubValue.can: (capability: CapabilityKey) => boolean`.
  - Mock: `loadCapabilities` returning the seven defaults, plus `setMockCapabilities(companyId: string, overrides: Partial<CapabilityMap>): void` reset between tests like the other mocks.

- [ ] **Step 1: Write the failing lib tests**

```ts
const catalog: Capability[] = [
  { key: "pay", default_min_role: "admin", sort_order: 1 },
  { key: "audit_log", default_min_role: "rococo", sort_order: 3 },
  { key: "production_view", default_min_role: "employee", sort_order: 7 },
];
it("uses the catalog default when a company has no row", () => {
  expect(resolveCapabilities(catalog, []).pay).toBe("admin");
});
it("lets a company's row win", () => {
  expect(resolveCapabilities(catalog, [{ company_id: "c1", capability: "pay", min_role: "owner" }]).pay).toBe("owner");
});
it("ranks roles employee, manager, admin, owner", () => {
  expect(meets("admin", false, "owner")).toBe(false);
  expect(meets("owner", false, "owner")).toBe(true);
  expect(meets("manager", false, "employee")).toBe(true);
});
it("never lets a company role meet the rococo level", () => {
  expect(meets("owner", false, "rococo")).toBe(false);
});
it("lets a Rococo admin through everything", () => {
  expect(meets("employee", true, "rococo")).toBe(true);
});
it("refuses a capability that did not load", () => {
  expect(meets("owner", false, undefined)).toBe(false);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/lib/capabilities.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the lib, the service and the mock.** `meets` is the only place the app ranks a role against a level.

- [ ] **Step 4: Write the failing provider tests** in `src/pages/capabilities.test.tsx`, rendering the app against the mocks:

```ts
it("does not render the app until the active company's capabilities have loaded", ...);
   // loadCapabilities left pending: the "Loading your company" screen shows, no nav.
it("shows the retry card when capabilities fail to load, and grants nothing", ...);
   // loadCapabilities rejects: "Could not load your company" shows; "Try again" reloads.
it("reloads capabilities when a Rococo admin switches company", ...);
   // company A has wins_post employee, company B the default. After switching to B in the
   // sidebar, nothing rendered between the switch and B's load reflects A's map.
it("keeps a company member's can() false for another company's map", ...);
```

- [ ] **Step 5: Wire the provider.** In `src/App.tsx`, load capabilities for the active company id whenever it changes, keyed by that id. While the loaded map's company id differs from the active one, render the existing `FullScreenLoading`. A load error joins the existing `companiesError` branch. `can = (key) => inCompanyOrRococo && meets(profile.role, isRococo, map[key])`, where a company member only qualifies inside their own company, the same test `isAdmin` uses. On the portfolio (no company) `can` returns `isRococo`.

- [ ] **Step 6: Run the gates**

Run: `npm run lint && npx vitest run && npm run build`
Expected: all pass, including `src/test/mocks/parity.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/capabilities.ts src/lib/capabilities.test.ts src/services/capabilities.ts src/test/mocks/capabilities.ts src/context/HubContext.tsx src/App.tsx src/pages/capabilities.test.tsx
git commit -m "Load a company's capabilities and expose can() on the hub"
```

---

### Task 4: Pay, company settings and the change log on screen

**Files:**
- Modify: `src/pages/people/PersonPage.tsx` (pay loads at 463, the stat at 739, the table near 763)
- Modify: `src/pages/settings/settingsTabs.ts`, `src/pages/settings/SettingsPage.tsx`, `src/App.tsx` (routes at 404 to 406)
- Modify: `src/pages/rococo/ActivityPage.tsx` (extract its list into `src/components/audit/ActivityList.tsx` so both screens share it)
- Modify: `src/services/audit.ts` header comment (who can read)
- Test: `src/pages/capabilities.test.tsx`

**Interfaces:**
- Consumes: `useHub().can`, `setMockCapabilities`.
- Produces: `type SettingsTab = "company" | "roles" | "reviews" | "connections" | "activity"`; `function settingsTabsFor(can: (key: CapabilityKey) => boolean): Array<TabItem & { key: SettingsTab }>` in `settingsTabs.ts` (Company needs `company_settings`, Activity needs `audit_log`, the rest always); `ActivityList({ companyId }: { companyId: string | null | undefined })`.

- [ ] **Step 1: Write the failing page tests**

```ts
describe("an admin without the pay capability", () => {   // setMockCapabilities(kingdom, { pay: "owner" }), signed in as an admin
  it("does not request compensation", ...);               // listCompensation mock not called
  it("shows no Annual compensation figure and no compensation table", ...);  // queryByText returns null for both
  it("still shows the person's financial figures", ...);
});
it("an owner still sees compensation", ...);
describe("an admin without company_settings", () => {
  it("has no Company tab", ...);
  it("lands on Roles from /settings", ...);               // location is /settings/roles
  it("is sent to Roles from /settings/company", ...);
});
it("an admin with audit_log sees an Activity tab listing only their company's events", ...);
   // listAuditEvents mock called with { companyId: <active company id> }
it("an admin without audit_log has no Activity tab and /settings/activity sends them to their first tab", ...);
it("the Rococo activity page still lists every company", ...);
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/pages/capabilities.test.tsx`
Expected: FAIL on the first pay test (compensation is requested).

- [ ] **Step 3: Implement.**
  - `PersonPage`: every `isAdmin` that guards compensation becomes `isAdmin && can("pay")`: the `listCompensation` call, the stat, the table and its edit controls. `listEmployeeFinancials` stays on `isAdmin`.
  - Settings: tabs come from `settingsTabsFor(can)`. `/settings` redirects to the first tab in that list. A tab route the person may not open redirects the same way. Settings itself stays `AdminOnly`.
  - Activity tab renders `ActivityList` with the active company id. Tab copy: heading "Activity", one line "Changes to roles, access and settings for this company."
  - `ActivityPage` keeps its behaviour through the shared component.

- [ ] **Step 4: Run the gates**

Run: `npm run lint && npx vitest run && npm run build`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/pages/people/PersonPage.tsx src/pages/settings src/pages/rococo/ActivityPage.tsx src/components/audit/ActivityList.tsx src/services/audit.ts src/App.tsx src/pages/capabilities.test.tsx
git commit -m "Gate pay, the company tab and a company activity tab on capabilities"
```

---

### Task 5: Wins, milestones and Production on screen

**Files:**
- Modify: `src/pages/WinsPage.tsx` (164, 213, 227, 233), `src/components/home/WinsCard.tsx` if it carries an add control
- Modify: `src/pages/production/ProjectPage.tsx` (158 to 166)
- Modify: `src/lib/navigation.ts`, `src/lib/navigation.test.ts`, `src/components/AppLayout.tsx` (passes `can` to the nav), `src/App.tsx` (routes 386 to 387)
- Test: `src/pages/capabilities.test.tsx`, `src/lib/navigation.test.ts`

**Interfaces:**
- Consumes: `useHub().can`.
- Produces: `NavItem.capability?: CapabilityKey`; the nav builder takes `can` and hides an item whose capability the person lacks; `CapabilityOnly({ capability, children })` route guard in `App.tsx`, sending others Home the way `AdminOnly` does.

- [ ] **Step 1: Write the failing tests**

```ts
// with setMockCapabilities(kingdom, { wins_post: "employee", milestones_edit: "manager", production_view: "manager" })
it("an employee can record a win but sees no edit or archive control", ...);
it("an employee's empty wins page invites them to record one", ...);   // body: "Record a win. It shows here and on Home."
it("a manager can add, edit and complete a milestone", ...);
it("a manager sees no New project button and no project edit control", ...);
it("an employee has no Projects item in the nav and /production sends them Home", ...);
it("a manager has Projects in the nav", ...);
// with defaults
it("with defaults an employee still opens Production read-only and cannot record a win", ...);
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/pages/capabilities.test.tsx src/lib/navigation.test.ts`
Expected: FAIL on the first wins test (no New win button for an employee).

- [ ] **Step 3: Implement.** `WinsPage`: the New win control and its empty-state copy follow `can("wins_post")`; edit and archive stay on `isAdmin`. `ProjectPage`: milestone add, edit, reorder and complete follow `can("milestones_edit")`; project rename and archive stay on `isAdmin`. Navigation: the `projects` item gets `capability: "production_view"`; both production routes are wrapped in `CapabilityOnly`. The win form's project picker is unchanged.

- [ ] **Step 4: Run the gates**

Run: `npm run lint && npx vitest run && npm run build`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/pages/WinsPage.tsx src/components/home/WinsCard.tsx src/pages/production/ProjectPage.tsx src/lib/navigation.ts src/lib/navigation.test.ts src/components/AppLayout.tsx src/App.tsx src/pages/capabilities.test.tsx
git commit -m "Let capabilities decide who records wins, edits milestones and opens Production"
```

---

### Task 6: Kingdom's rows, and the docs

**Files:**
- Create: `supabase/seeds/kingdom_intake.sql`
- Modify: `README.md` (the migrations ledger, the Roles section, the seeds line, "Still pending from Kingdom")
- Propose only, do not apply without Austin's approval: `CLAUDE.md` rule 12, adding "who may do what (`company_capabilities`, 0040: the lowest role for each capability)" to the configured-per-company list.

**Interfaces:**
- Consumes: both migrations.
- Produces: a script run by hand in the SQL editor after 0041 is applied and the app is deployed.

- [ ] **Step 1: Write `kingdom_intake.sql`** in the shape of `supabase/seeds/rba_scorecards.sql`: one transaction, a guard block that raises if slug `kingdom` or `public.company_capabilities` is missing, then:
  - **Capability rows:** the seven Kingdom values from the Capabilities table, `on conflict (company_id, capability) do update set min_role = excluded.min_role`.
  - **Job roles:** add any of these missing by name, after the existing list: Owner, Operations Manager, Project Manager, Executive Assistant, Design Lead, Project Designer, Selections Coordinator, Estimating & Sales Coordinator.
  - **People.** Match on `lower(email)` within Kingdom. Missing: insert with the columns `createStaffProfile` sets (`src/services/profiles.ts:93-117`), `user_id` null. Present: set `role` and `title`, and `job_role_id` only where it is null. Never touch `user_id`, `reports_to`, `is_active` or `full_name` on an existing row. If an address exists outside Kingdom, raise and change nothing.

| Name | Title | Email | Role |
|---|---|---|---|
| Eli Cothran | Owner | eli@kingdomcustomconstruction.com | owner |
| Davis Nix | Owner | davis@kingdomcustomconstruction.com | owner |
| Marvin Waters | Operations Manager | marvin@kingdomcustomconstruction.com | admin |
| Christian Augspurger | Project Manager | christian@kingdomcustomconstruction.com | manager |
| Neo Baldovino | Project Manager | neo@kingdomcustomconstruction.com | manager |
| Ashley Oglesby | Executive Assistant | ashley@kingdomcustomconstruction.com | employee |
| Maddie Cothran | Design Lead | maddie@kingdomcustomconstruction.com | employee |
| Katie Livingstone | Project Designer | katie@kingdomcustomconstruction.com | employee |
| Bailey Tate | Selections Coordinator | bailey@kingdomcustomconstruction.com | employee |
| Stephen Park | Estimating & Sales Coordinator | stephen@kingdomcustomconstruction.com | employee |

  - **Check rows at the end:** one row per person with email, role before, role now, and whether they have signed in; then any other active Kingdom person not in the list, so a leftover test row is seen and handled by hand; then the seven capability rows.
  - Header comment states the consequence: anyone marked Owner today who is not Eli or Davis is lowered, and until Eli or Davis signs in, only Rococo reaches Kingdom's pay and company row.

- [ ] **Step 2: Prove it against the harness database.**

Run: `SQL_KEEP=1 npm run test:sql`, then with the printed `psql` command: create a Kingdom profile for `Marvin@KingdomCustomConstruction.com` with role `owner` and a non-null `user_id` (insert through `auth.users` as `tests.create_person` does, then set the email), run `\i supabase/seeds/kingdom_intake.sql` twice.
Expected: after the first run there are exactly 10 listed people, one Marvin row with role `admin` and its `user_id` unchanged, and 7 capability rows. The second run's check rows are identical and "role before" equals "role now" on every line. Stop the cluster with the printed command.

- [ ] **Step 3: Update `README.md`.** Ledger: 0040 and 0041 listed as written, not applied. Roles section: the seven capabilities, their defaults, and that a company's rows are set by Rococo. Seeds: the new script and its run order (0040, 0041, deploy, seed). Pending from Kingdom: reports-to for eight people, and whether a person sees their own pay.

- [ ] **Step 4: Run the gates**

Run: `npm run lint && npx vitest run && npm run build`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/seeds/kingdom_intake.sql README.md
git commit -m "Add Kingdom's roster and capability rows as a seed, and document capabilities"
```

---

## Rollout, by hand, after merge

1. Paste 0040, then 0041, in the Supabase SQL editor. With no override rows nothing changes for any company.
2. Deploy the app the same day.
3. Run `supabase/seeds/kingdom_intake.sql`. Read the check rows before closing the editor.
4. Sign in as a Rococo admin, step into Kingdom, and confirm the Company tab, a person's compensation and the Activity tab.
5. Record 0040, 0041 and the seed as applied in the README ledger.
