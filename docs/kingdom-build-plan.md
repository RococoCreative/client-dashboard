This file exists to drive the Kingdom build task by task; it is the implementation plan derived from docs/kingdom-revamp-plan.md.

# Kingdom build plan

This plan turns the Kingdom revamp assessment into thirteen self-contained tasks that build everything Kingdom's team does not need to answer first: the SQL test harness, module gating and navigation, the audit log, projects and milestones, manual wins, the Sales and Finance pages, the sync engine and its UI, external links, the Google Sheets and QuickBooks adapters, the role hierarchy foundation, and the handoff docs. Each task names its files, tests, verification and commit, so it can be handed to an implementer on its own.

Spec: `docs/kingdom-revamp-plan.md` and `CLAUDE.md` are the binding spec. Where this plan differs from the revamp assessment, the Rulings below win.

## Global Constraints

1. CLAUDE.md hard rules bind every task. In particular: theme tokens only (rule 1), renders with no
   backend and hermetic tests (rule 2), services throw and pages message (rule 3), the company wall is
   RLS via the `private` helpers with `company_id` inherited by trigger and `assertInCompany()` on
   every URL-id page (rule 4), a profile is a person not an account (rule 5), connections and
   provider tokens only through the `connections` Edge Function (rule 6), scoring math only in
   `src/lib/gsr/*` and never reused for new scores (rule 7), migrations append-only and
   `src/types/database.ts` kept in step (rule 8), copy voice with no em dashes (rule 10), file style:
   every file opens with a why-comment, PascalCase default-export components, no barrels, `ui/*`
   primitives, `BlurInput` for save-on-blur (rule 11), a company's shape is data (rule 12), quiet
   design (rule 13).
2. Klasik and RBA see no change. With `companies.modules = '{}'` every route, nav item, label, card and
   existing test behaves exactly as today. Existing tests stay green unchanged, except an assertion
   that a task explicitly changes for a company whose modules are on.
3. No code branches on a company's name, slug or theme key. Kingdom-only behavior is gated only by
   `hasModule(company, key)` from `src/lib/modules.ts`, the single reader of `companies.modules`.
4. Module keys, exactly: `switchboard`, `production`, `wins`, `data_sources`, `external_links`.
   - `switchboard`: the four-section navigation (Home, Sales & Finance, Production, People / HR, plus an
     unlabeled utility group for SOPs, Resources and Settings), the "Home" heading in place of
     "Dashboard", and the Attention and Shortcuts cards on Home.
   - `production`: the Production section: projects, milestones and letters, and the Production
     scaffold cards (client score, cleanliness, job health, warranty, PM capacity).
   - `wins`: the wins page and the Home wins card.
   - `data_sources`: connected Google Sheets and QuickBooks sources, the Sales & Finance reporting and
     Controls pages, the Home freshness card, Settings > Data sources, and the Google row in
     Settings > Connections.
   - `external_links`: the links registry, Monday entry points, external links on Shortcuts and in
     sections, Settings > External links.
5. Section names, exactly: "Home", "Sales & Finance", "Production", "People / HR". The utility group has
   no heading (a hairline separates it). A section with no visible items is hidden.
6. Migration files, exactly: `0024_company_modules.sql`, `0025_audit_log.sql`,
   `0026_projects_milestones.sql`, `0027_wins.sql`, `0030_sync_engine.sql`, `0031_external_links.sql`,
   `0032_sync_schedule.sql`, `0033_role_hierarchy.sql`. Each is idempotent (safe to run twice), never
   edits 0001 to 0023, and rebuilds an existing function from its LATEST body (check the drift report
   from Task 1 for live differences before rebuilding).
7. Nothing is applied to the live Supabase project and the Edge Function is not deployed in this run.
   Supabase MCP use is read-only (SELECT and catalog queries). Migrations are verified with the local
   SQL harness (`npm run test:sql`, Task 1).
8. No live-looking sample data. Fixtures and demo data for new modules use plainly fictional names
   ("Sample job 101", "Sample win") and plainly illustrative numbers.
9. Undefined business logic is never implemented: no financial formulas, capacity math, score math,
   aging thresholds, escalation rules, milestone statuses beyond a completed-on date, win display
   duration beyond "the five most recent", or team field on wins. Show "Not configured" instead.
10. Imported values are read-only in the database: `sync_runs` and `sync_records` have no INSERT,
    UPDATE or DELETE policy for `authenticated`; only the `connections` function's service role writes
    them. No writeback to Google, QuickBooks or Monday; the QuickBooks client has GET methods only.
11. A blank, missing or failed source value renders "-" (the existing `formatMoney`/`formatPercent`
    null behavior), never 0. A failed sync keeps showing the last good data with its time.
12. Every new service function has a mock twin with identical exports in `src/test/mocks/`; every new
    service module is added to the alias regex in `demo/vite.config.ts` and to the `vi.mock` lists in
    `src/pages/pages.test.tsx` and `src/App.rococo.test.tsx`. Exception: `src/services/invoke.ts` is an
    internal helper imported only by `connections.ts` and `sync.ts`, which are always mocked; it has no
    mock and no alias, and no page or component may import it.
13. Permission defaults until Kingdom's capability matrix arrives:
    - writes to projects, milestones, wins, external links and sync source configuration:
      `private.can_manage_company(company_id)`.
    - reads of projects, milestones and wins: `private.is_company_member(company_id)` (members see
      Production and Wins read-only; edit controls only for admins).
    - reads of sync sources, runs and records: `private.can_manage_company(company_id)`; Sales &
      Finance pages and Settings panels are admin-only routes.
    - Sync now: its own predicate `private.can_sync_source(cid)`, which returns
      `private.can_manage_company(cid)` today.
    - audit events: Rococo admins only.
14. Roles: `owner` and `admin` both carry today's admin meaning everywhere (`private.is_company_admin`,
    `isAdmin` in `src/App.tsx`, the `connections` function's admin check). `manager` is employee-level
    until the capability matrix. Owner is granted only by an owner or a Rococo admin.
15. Gates for every task, all must pass before its commit: `npm run lint`, `npx vitest run`,
    `npm run build`. Plus `npm run test:sql` for any task that adds or changes SQL (from Task 1 on),
    and a Deno type-check of the Edge Function for any task that touches `supabase/functions`
    (recipe: copy `supabase/functions` to a scratchpad dir and run
    `DENO_DIR=<scratch>/denocache <scratch>/denotry/node_modules/.bin/deno check --node-modules-dir=auto index.ts`
    from the copied `functions/connections`, with Deno 2.9.6 installed under the scratch dir).
16. UI tasks also do a visual check: run `npm run demo`, open the relevant screens with Playwright
    (pre-installed; `require('playwright')`, `chromium.launch()`), as
    `?persona=admin&company=kingdom`, `?persona=employee&company=kingdom` and
    `?persona=admin&company=klasik`, screenshot them at deviceScaleFactor 1, look at the PNGs, and fix
    layout defects. Screenshots go to the plan workspace, never into the repo.
17. Commits: descriptive plain-sentence subjects in the style of `git log` (no "feat:" prefixes), one
    or more commits per task, each message ending with the session's standard attribution
    trailer lines. No AI model identifiers anywhere else (code, comments, copy, docs).

## Rulings

- R1. `companies.modules text[] not null default '{}'` is approved. CLAUDE.md wording is proposed in
  Tasks 2 and 13 and applied only on Austin's explicit approval; README carries the module
  documentation meanwhile. The proposal: rule 1's last sentence and rule 12's "Configured per
  company already" list name the module gate, and rule 12 gains one sentence: a module is a key in
  `companies.modules`, read only through `src/lib/modules.ts`, changed only by Rococo. Cost if wrong:
  reword two lines, plus a pending guardrails update.
- R2. The utility group (SOPs, Resources, Settings) is unlabeled, below the four sections. Cost: one
  label later.
- R3. Module keys are five, not the assessment plan's seven: `sectioned_nav` and `home_snapshot`
  become `switchboard`; `qbo_controls` folds into `data_sources`. Cost: split a key later.
- R4. `external_people` (PM to roster mapping) is deferred with its UI to the PM capacity slice; no
  table now. Cost: one small migration later.
- R5. `private.my_team_ids()` is deferred to the capability-matrix slice, because the definition of a
  manager's team is Kingdom's open question. Cost: none.
- R6. `wins.team` is deferred (Kingdom's question). Wins carry an optional project. Cost: one column
  later.
- R7. Members read Production and Wins; Sales & Finance stays admin-only. Cost: one policy and route
  guard each.
- R8. The QuickBooks adapter is built read-only and unconfigured (Invoice and Payment queries
  projected through a field map). No aging, escalation, "not sent", partial-payment or cash-basis
  logic. Cost: none if never configured.
- R9. The SQL harness is committed (`supabase/tests/`, `npm run test:sql`), needs a local
  PostgreSQL 16+, and is not part of CI. Cost: remove a folder and a script.
- R10. Kingdom's modules are switched on by a Rococo admin in Rococo > Companies after the migrations
  are applied. No migration seeds modules or roles for a named company or person. Maddie Cothran and
  marvin waters are set to Owner by hand after 0033. Cost: none.
- R11. Field types are `text`, `number`, `currency`, `percent`, `date`. No `period` or `person` type
  until Kingdom's period and PM conventions arrive. Cost: add a type later.
- R12. A sync is all-or-nothing: any validation error (missing required header, wrong type, required
  value blank, duplicate record key) fails the run and keeps the last good data. A row whose mapped
  cells are all blank is skipped and counted. Cost: a stricter-than-needed first run.
- R13. Scheduling is one attempt per weekly slot: a source is due when it is enabled, has a schedule,
  and its last attempt is before its latest slot. A failed scheduled run waits for the next slot or a
  manual Sync now. Cost: a transient failure waits a week unless someone presses Sync now.
- R14. `target_module` values: `sales_reporting`, `financial_reporting`, `controls`, `pm_capacity`.
- R15. Projects are created by hand by admins (`source = 'manual'` only, `reference` holds the job
  number as text) until Kingdom names the master list; it will not be Buildertrend (noted by Kingdom
  in the intake doc). Cost: an import path later.
- R16. Home wins card shows the five most recent non-archived wins; display duration and archival
  rules are pending.
- R17. `audit_events` has no foreign keys (a company delete would fail on its own cascade's audit
  rows); history outlives the company. Cost: none.
- R18. Projects, milestones and wins are content and carry no audit trigger (spec S2: no ordinary
  content edits are logged). Cost: one trigger each later.
- R19. `people_hr` and `home` links show only on Home's Shortcuts card; the People pages are
  unchanged. Cost: one ExternalLinksList on PeoplePage later.
- R20. Accepted as built: an audit row for a moved profile is filed under its new company (OCI-4); a
  sync-only select path is added with the capability matrix (S13), and Task 7's last SQL test
  documents why (OCI-5); providers.test.ts reads the SQL with a dynamic `node:fs` import (OCI-7);
  Read headers reads row 1 only, as the panel hint says (OCI-8). Cost: none now.
- R21. From Task 12 on, Kingdom's `admin` persona is Avery Stone (role admin, Office Manager) and the
  `owner` persona is Marcus Lee (role owner). Task 12 may update any earlier Kingdom test assertion
  that depends on who the signed-in Kingdom admin is or on Marcus Lee's role, and must list each
  such change in its report; Global Constraint 2 permits these. Cost: a few assertion edits.


## Shared contracts

## Kingdom build: shared contracts

Binding for every task in `docs/kingdom-build-plan.md`. Where a task section and this file differ,
this file wins on names, signatures, schema and ownership; the Rulings section of this plan wins on
scope, and the spec wins where no Ruling speaks.
Every existing name below was checked against the code on branch `claude/elegant-cray-bnb85m`
at commit `6d9bfc5` (and, for function bodies and constraints, read-only against live project
`jjdcejevdqpwuastsmpq`).

Conventions every task follows:
- Imports use explicit `.ts`/`.tsx` extensions (tsconfig `allowImportingTsExtensions`).
- `tsconfig.app.json` includes only `src`, but files under `supabase/functions/_shared/` that
  `src` imports are type-checked by `tsc -b` under the app's strict settings (`noUnusedLocals`,
  `verbatimModuleSyntax`), so `_shared` modules use `import type` for types and no Deno, npm or
  `jsr:` imports. Deno checks them too (Task 10, 11).
- `eslint .` already lints `supabase/functions/**`; new `_shared` and function files must pass it.
- A component that loads its own data uses `useAsync` (`data`, `error`, `loading`, `reload`,
  `setData`) and renders `Notice tone="error"` from `errorMessage()` on failure.
- `"-"` is the blank rendering everywhere (`formatMoney`, `formatNumber`, `formatPercent` and
  `formatDate` already return it for null).
- BEFORE triggers on one table fire in name order; every guard below is written to be correct
  regardless of where `set_updated_at` and `stamp_actor` fall in that order.

---

### 1. Interfaces

#### 1.1 `src/lib/modules.ts` (Task 2)

```ts
import type { Company } from "../types/database.ts";

export const MODULE_KEYS = ["switchboard", "production", "wins", "data_sources", "external_links"] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  switchboard: "Switchboard",
  production: "Production",
  wins: "Wins",
  data_sources: "Data sources",
  external_links: "External links",
};

// One plain line each, shown under the checkbox on Rococo > Companies.
export const MODULE_DESCRIPTIONS: Record<ModuleKey, string> = {
  switchboard: "Four-section navigation, the Home heading, and the Attention and Shortcuts cards.",
  production: "Projects, milestones and letters, and the Production cards.",
  wins: "The wins page and the Home wins card.",
  data_sources: "Connected Google Sheets and QuickBooks sources, Sales & Finance, and data freshness.",
  external_links: "Shortcuts to outside tools, including Monday, in each section.",
};

export function isModuleKey(value: string): value is ModuleKey;
// The only reader of companies.modules. Null company (portfolio) is false. Unknown keys ignored.
export function hasModule(company: Pick<Company, "modules"> | null | undefined, key: ModuleKey): boolean;
// The known keys a company has on, in MODULE_KEYS order.
export function enabledModules(company: Pick<Company, "modules"> | null | undefined): ModuleKey[];
// Pure toggle for the Rococo checkboxes: returns a new array, keeps unknown keys untouched,
// never duplicates a key.
export function withModule(modules: readonly string[], key: ModuleKey, on: boolean): string[];
```

Nothing else reads `company.modules` directly (CompaniesPage computes checked state with
`hasModule` and writes `withModule(company.modules, key, checked)` through `updateCompany`).

#### 1.2 `src/lib/navigation.ts` (Task 2; items appended by Tasks 3, 4, 5, 6)

```ts
import type { LucideIcon } from "lucide-react";
import type { Company, LinkNavGroup } from "../types/database.ts";
import type { ModuleKey } from "./modules.ts";

export type NavGroup = LinkNavGroup | "utility";          // "home" | "sales_finance" | "production" | "people_hr" | "utility"
export type NavAudience = "admin" | "employee" | "both";

export interface NavItem {
  id: string;            // stable key, e.g. "dashboard", "my-gsr-admin"
  to: string;
  label: string;         // flat-layout label (today's)
  groupedLabel?: string; // label under the switchboard layout when it differs ("Home" for "/")
  icon: LucideIcon;
  end?: boolean;
  audience: NavAudience;
  group: NavGroup;
  requires?: ModuleKey;  // hidden unless hasModule(company, requires)
}

export const NAV_GROUP_ORDER: readonly NavGroup[] = ["home", "sales_finance", "production", "people_hr", "utility"];
export const NAV_GROUP_LABELS: Record<NavGroup, string | null> = {
  home: "Home", sales_finance: "Sales & Finance", production: "Production", people_hr: "People / HR", utility: null,
};

export const NAV_ITEMS: readonly NavItem[];      // the registry, in flat order (see table in section 3)
export const PORTFOLIO_NAV: readonly NavItem[];  // Rococo portfolio, flat; Task 3 appends Activity

export interface NavSection { group: NavGroup; heading: string | null; items: NavItem[] }
export type NavLayout =
  | { kind: "flat"; items: NavItem[] }
  | { kind: "grouped"; sections: NavSection[] };

// Layout is "grouped" iff hasModule(company, "switchboard"). Items are filtered by audience
// (isAdmin -> "admin" | "both"; else "employee" | "both"), by `requires`, and, for a Rococo
// admin, items whose `to` starts with "/my" are dropped (today's AppLayout rule). Grouped
// sections follow NAV_GROUP_ORDER, items keep registry order, the "/" item shows groupedLabel,
// and a section with no items is omitted.
export function navFor(company: Company, isAdmin: boolean, isRococo: boolean): NavLayout;

// For ShortcutsCard: one entry per visible grouped section except "home" and "utility",
// pointing at the section's first item.
export function sectionShortcuts(layout: NavLayout): Array<{ group: NavGroup; heading: string; to: string }>;
```

AppLayout keeps `portfolio` logic and does
`const layout = portfolio ? { kind: "flat", items: [...PORTFOLIO_NAV] } : navFor(company!, isAdmin, isRococo);`.
Grouped rendering: `<nav aria-label="Primary">`, each section a `<div role="group" aria-label={heading ?? "More"}>`
with an `<p className="eyebrow ...">` heading (no heading for utility, which instead gets a
`border-t border-line` hairline above it). On small screens the bar stays horizontal-scrolling
(section headings hidden below `lg`). `NavEntry` is reused unchanged.

`navigation.test.ts` asserts, with Klasik (`modules = []`): admin flat items equal today's
`ADMIN_NAV` (to, label, icon, end) item for item; employee equals `EMPLOYEE_NAV`; Rococo
in-company admin equals `ADMIN_NAV` minus "/my/gsr"; `PORTFOLIO_NAV` equals today's three
(Task 3 updates this assertion to four). Those literal arrays are copied into the test from
`src/components/AppLayout.tsx:25-52` before Task 2 deletes them.

#### 1.3 `ModuleOnly` route guard (Task 2, named export from `src/App.tsx`)

```tsx
export function ModuleOnly({ module, children }: { module: ModuleKey; children: ReactNode }) {
  const { company } = useHub();
  if (!company) return <RedirectTo path="/rococo" />;
  return hasModule(company, module) ? <>{children}</> : <Navigate to="/" replace />;
}
```
Admin-only module routes nest it inside `AdminOnly`: `<AdminOnly><ModuleOnly module="data_sources">...</ModuleOnly></AdminOnly>`.

#### 1.4 `src/types/database.ts` additions (exact)

Task 2:
```ts
export interface Company { /* existing fields */ modules: string[] }   // raw text[]; unknown keys allowed
```

Task 3:
```ts
export type AuditAction = "insert" | "update" | "delete";
export type AuditActorKind = "user" | "rococo" | "system";
export const AUDIT_ACTOR_KIND_LABELS: Record<AuditActorKind, string> = { user: "Company user", rococo: "Rococo", system: "System" };
export interface AuditEvent {
  id: string;
  company_id: string | null;
  table_name: string;
  row_id: string;
  action: AuditAction;
  changed: Record<string, { old: unknown; new: unknown }>;
  actor_user_id: string | null;
  actor_profile_id: string | null;
  actor_kind: AuditActorKind;
  created_at: string;
}
```

Task 4:
```ts
export type ProjectSource = "manual";
export interface Project {
  id: string; company_id: string; name: string; reference: string | null; notes: string | null;
  source: ProjectSource; source_key: string | null; archived_at: string | null;
  created_by: string | null; updated_by: string | null; created_at: string; updated_at: string;
}
export type MilestoneKind = "milestone" | "letter";
export const MILESTONE_KIND_LABELS: Record<MilestoneKind, string> = { milestone: "Milestone", letter: "Letter" };
export interface ProjectMilestone {
  id: string; company_id: string; project_id: string; title: string; description: string | null;
  kind: MilestoneKind; sort_order: number; target_date: string | null;
  responsible_profile_id: string | null; completed_on: string | null; archived_at: string | null;
  created_by: string | null; updated_by: string | null; created_at: string; updated_at: string;
}
```

Task 5:
```ts
export type WinSourceType = "manual";
export const WIN_SOURCE_LABELS: Record<WinSourceType, string> = { manual: "Manual" };
export interface Win {
  id: string; company_id: string; title: string; description: string | null; won_on: string;
  project_id: string | null; source_type: WinSourceType; source_ref: Record<string, unknown> | null;
  archived_at: string | null; created_by: string | null; updated_by: string | null;
  created_at: string; updated_at: string;
}
```

Task 7 (sync; the field and config types are owned by `_shared` and re-exported):
```ts
export type { FieldType, FieldMapEntry, SourceConfig, SheetsSourceConfig, QuickBooksSourceConfig, SyncProvider, TargetModule } from "../../supabase/functions/_shared/sync/types.ts";
export type ConnectionProvider = "gohighlevel" | "quickbooks" | "google_sheets";
export const CONNECTION_PROVIDER_LABELS = { gohighlevel: "GoHighLevel", quickbooks: "QuickBooks Online", google_sheets: "Google Sheets" };
export const TARGET_MODULE_LABELS: Record<TargetModule, string> = {
  sales_reporting: "Sales reporting", financial_reporting: "Financial reporting", controls: "Controls", pm_capacity: "PM capacity",
};
export const FIELD_TYPE_LABELS: Record<FieldType, string> = { text: "Text", number: "Number", currency: "Currency", percent: "Percent", date: "Date" };
export type SyncRunStatus = "running" | "succeeded" | "failed" | "abandoned";
export type SyncTrigger = "schedule" | "manual";
export interface SyncSource {
  id: string; company_id: string; connection_id: string; provider: SyncProvider; name: string;
  target_module: TargetModule; config: SourceConfig; field_map: FieldMapEntry[]; record_key: string[];
  sync_weekday: number | null; sync_time: string | null; sync_timezone: string | null;
  stale_after_hours: number | null; enabled: boolean; current_run_id: string | null;
  last_attempt_at: string | null; last_success_at: string | null; last_status: SyncRunStatus | null;
  last_error: string | null; sync_requested_at: string | null;
  created_by: string | null; updated_by: string | null; created_at: string; updated_at: string;
}
export interface SyncRun {
  id: string; company_id: string; source_id: string; connection_id: string; trigger_kind: SyncTrigger;
  requested_by: string | null; status: SyncRunStatus; started_at: string; finished_at: string | null;
  rows_read: number; rows_applied: number; rows_blank: number; error_detail: unknown | null;
}
export interface SyncRecord {
  id: string; company_id: string; source_id: string; run_id: string; record_key: string;
  data: Record<string, string | number | null>; source_ref: Record<string, unknown>; created_at: string;
}
```

Task 9:
```ts
export type LinkNavGroup = "home" | "sales_finance" | "production" | "people_hr";   // added in Task 2 (navigation.ts needs it)
export type LinkProvider = "monday" | "quickbooks" | "google_sheets" | "other";
export type LinkAudience = "admins" | "everyone";
export const LINK_PROVIDER_LABELS: Record<LinkProvider, string> = { monday: "Monday", quickbooks: "QuickBooks", google_sheets: "Google Sheets", other: "Other" };
export const LINK_AUDIENCE_LABELS: Record<LinkAudience, string> = { admins: "Admins only", everyone: "Everyone" };
export interface ExternalLink {
  id: string; company_id: string; nav_group: LinkNavGroup; label: string; destination_note: string | null;
  url: string; provider: LinkProvider; embed_url: string | null; embed_is_public: boolean;
  audience: LinkAudience; sort_order: number;
  created_by: string | null; updated_by: string | null; created_at: string; updated_at: string;
}
```
Note: `LinkNavGroup` lands in Task 2 (with a one-line comment that 0031 uses the same four values),
because `navigation.ts` derives `NavGroup` from it.

Task 12:
```ts
export type Role = "owner" | "admin" | "manager" | "employee";
export const ROLE_LABELS: Record<Role, string> = { owner: "Owner", admin: "Admin", manager: "Manager", employee: "Employee" };
```

#### 1.5 Service modules and mock twins

Every function below exists with the identical name and signature in `src/test/mocks/<module>.ts`
(in-memory, seeded from fixtures with `fromAll(b => b.<key>).map(x => ({ ...x }))`, mutations
stamp `updated_at`, throws `new Error("... not found.")` on a missing id). Every module is added to
the demo alias regex in `demo/vite.config.ts` and to the `vi.mock` lists in
`src/pages/pages.test.tsx` and `src/App.rococo.test.tsx`.

`src/services/companies.ts` (Task 2): `COLUMNS` gains `modules`
(`"id, slug, name, theme_key, logo_url, modules, created_at, updated_at"`);
`CompanyPatch = Partial<Pick<Company, "name" | "logo_url" | "theme_key" | "slug" | "modules">>`.
Mock: `createCompany` sets `modules: []`; `CompanyPatch` identical. New
`src/services/companies.test.ts` mocks `./supabase.ts` with a recording `db()` and asserts the
select string for `listCompanies` and `getCompany` contains `modules`.

`src/services/audit.ts` (Task 3):
```ts
export interface AuditFilter { companyId?: string | null; limit?: number; before?: string }
export async function listAuditEvents(filter?: AuditFilter): Promise<AuditEvent[]>; // created_at desc, default limit 100
```
Pure helper `src/lib/audit.ts` (+ `audit.test.ts`): `describeAuditEvent(event: AuditEvent): string`
(for example "profiles: role admin to owner"), `AUDIT_TABLE_LABELS: Record<string, string>`.

`src/services/projects.ts` (Task 4):
```ts
export async function listProjects(companyId: string, opts?: { includeArchived?: boolean }): Promise<Project[]>; // name asc
export async function getProject(id: string): Promise<Project>;
export async function createProject(input: { company_id: string; name: string; reference?: string | null; notes?: string | null }): Promise<Project>;
export type ProjectPatch = Partial<Pick<Project, "name" | "reference" | "notes">>;
export async function updateProject(id: string, patch: ProjectPatch): Promise<Project>;
export async function archiveProject(id: string): Promise<Project>;        // archived_at = now
export async function listMilestones(projectId: string, opts?: { includeArchived?: boolean }): Promise<ProjectMilestone[]>; // sort_order asc
export async function listCompanyMilestones(companyId: string): Promise<ProjectMilestone[]>; // non-archived, for list counts
export async function createMilestone(input: { project_id: string; title: string; kind: MilestoneKind; sort_order: number; description?: string | null; target_date?: string | null; responsible_profile_id?: string | null }): Promise<ProjectMilestone>;
export type MilestonePatch = Partial<Pick<ProjectMilestone, "title" | "description" | "kind" | "target_date" | "responsible_profile_id" | "completed_on">>;
export async function updateMilestone(id: string, patch: MilestonePatch): Promise<ProjectMilestone>;
export async function reorderMilestones(projectId: string, orderedIds: string[]): Promise<ProjectMilestone[]>; // sort_order = index + 1
export async function archiveMilestone(id: string): Promise<ProjectMilestone>;
```
Pure helper `src/lib/milestones.ts` (+ test):
```ts
export function isComplete(m: Pick<ProjectMilestone, "completed_on">): boolean;
export function sortMilestones(ms: ProjectMilestone[]): ProjectMilestone[];          // sort_order, then created_at
export function nextSortOrder(ms: Pick<ProjectMilestone, "sort_order">[]): number;   // max + 1, 1 when empty
export function milestoneCounts(ms: ProjectMilestone[]): { done: number; total: number }; // non-archived only
export function nextTargetDate(ms: ProjectMilestone[]): string | null;              // earliest target_date of open, non-archived
export function moveMilestone(ms: ProjectMilestone[], id: string, direction: "up" | "down"): string[]; // new id order
```

`src/services/wins.ts` (Task 5):
```ts
export async function listWins(companyId: string, opts?: { includeArchived?: boolean; limit?: number }): Promise<Win[]>; // won_on desc, created_at desc
export async function createWin(input: { company_id: string; title: string; won_on: string; description?: string | null; project_id?: string | null }): Promise<Win>;
export type WinPatch = Partial<Pick<Win, "title" | "description" | "won_on" | "project_id">>;
export async function updateWin(id: string, patch: WinPatch): Promise<Win>;
export async function archiveWin(id: string): Promise<Win>;
```

`src/services/invoke.ts` (Task 8; an internal helper, not a service module, no mock, never imported
by a page): `export async function invokeFunction<T>(path: string, body: Record<string, unknown>): Promise<T>`,
the body moved verbatim from the private `invoke` in `src/services/connections.ts`, which then
imports it. `connections.ts` exports are unchanged.

`src/services/sync.ts` (Task 8; `describeSpreadsheet` added by Task 10):
```ts
export interface SyncSourceInput {
  company_id: string; connection_id: string; provider: SyncProvider; name: string; target_module: TargetModule;
  config: SourceConfig; field_map: FieldMapEntry[]; record_key: string[];
  sync_weekday: number | null; sync_time: string | null; sync_timezone: string | null;
  stale_after_hours: number | null; enabled: boolean;
}
export type SyncSourcePatch = Partial<Omit<SyncSourceInput, "company_id" | "provider">>;
export async function listSyncSources(companyId: string): Promise<SyncSource[]>;            // name asc
export async function createSyncSource(input: SyncSourceInput): Promise<SyncSource>;
export async function updateSyncSource(id: string, patch: SyncSourcePatch): Promise<SyncSource>;
export async function setSyncSourceEnabled(id: string, enabled: boolean): Promise<SyncSource>;
export async function listSyncRuns(sourceId: string, limit?: number): Promise<SyncRun[]>;  // started_at desc, default 10
export async function listCurrentRecords(source: Pick<SyncSource, "id" | "current_run_id">): Promise<SyncRecord[]>; // [] when current_run_id null
export interface SyncRunResult { status: "succeeded" | "failed" | "locked"; message: string | null; rows_applied: number }
export async function requestSync(sourceId: string): Promise<SyncRunResult>;               // invokeFunction("connections/sync/run", { source_id })
export interface SpreadsheetDescription { title: string; tabs: Array<{ gid: number; title: string }>; headers: string[] }
export async function describeSpreadsheet(connectionId: string, spreadsheetId: string, gid: number | null): Promise<SpreadsheetDescription>; // Task 10
```
Mock `requestSync` returns `{ status: "succeeded", message: null, rows_applied: <records of current run> }`
and stamps `sync_requested_at`; mock `describeSpreadsheet` returns a fixed fictional description.

`src/services/externalLinks.ts` (Task 9):
```ts
export interface ExternalLinkInput {
  company_id: string; nav_group: LinkNavGroup; label: string; url: string; provider: LinkProvider;
  destination_note?: string | null; embed_url?: string | null; embed_is_public?: boolean;
  audience: LinkAudience; sort_order: number;
}
export type ExternalLinkPatch = Partial<Omit<ExternalLinkInput, "company_id">>;
export async function listExternalLinks(companyId: string, opts?: { navGroup?: LinkNavGroup }): Promise<ExternalLink[]>; // nav_group, sort_order, label
export async function createExternalLink(input: ExternalLinkInput): Promise<ExternalLink>;
export async function updateExternalLink(id: string, patch: ExternalLinkPatch): Promise<ExternalLink>;
export async function deleteExternalLink(id: string): Promise<void>;
```
The mock returns every row of the company (it cannot know the caller); audience filtering is
proven by the 0031 SQL test, never by UI code.

#### 1.6 `src/components/status.ts` (Task 8)

```ts
import type { SyncState } from "../lib/sync/state.ts";
export const SYNC_STATE_TONE: Record<SyncState, BadgeTone> = {
  not_connected: "neutral", awaiting_first_sync: "info", syncing: "info", failed: "danger", stale: "warning", synced: "success",
};
```
No other tone maps are added (wins and milestones use `neutral`/`success` badges inline through Badge).

#### 1.7 Components (path, default export, props)

| Component | Path | Task | Props |
| --- | --- | --- | --- |
| ActivityPage | `src/pages/rococo/ActivityPage.tsx` | 3 | none |
| ProductionPage | `src/pages/production/ProductionPage.tsx` | 4 (6, 8, 9 add) | none |
| ProjectPage | `src/pages/production/ProjectPage.tsx` | 4 | none (`useParams<{ projectId: string }>`) |
| MilestoneList | `src/components/production/MilestoneList.tsx` | 4 | `{ milestones: ProjectMilestone[]; people: Profile[]; canEdit: boolean; onChanged: (next: ProjectMilestone[]) => void }` |
| WinsPage | `src/pages/WinsPage.tsx` | 5 | none |
| AttentionCard | `src/components/home/AttentionCard.tsx` | 5 (8 adds input) | `{ company: Company }` (loads profiles, cycles, campaigns, connections; Task 8 adds sync sources when `data_sources`) |
| WinsCard | `src/components/home/WinsCard.tsx` | 5 | `{ companyId: string }` (five most recent non-archived, `listWins(companyId, { limit: 5 })`) |
| ShortcutsCard | `src/components/home/ShortcutsCard.tsx` | 5 (9 adds links) | `{ company: Company; isAdmin: boolean; isRococo: boolean }` |
| ScaffoldCard | `src/components/scaffold/ScaffoldCard.tsx` | 6 | `{ eyebrow: string; title: string; pending: string[]; children?: ReactNode }`; renders `EmptyState` with `body` "Not configured yet." and `action` = `<Badge tone="neutral">Not configured</Badge>` plus the `pending` list, then `children`; no digits in any string |
| SalesFinancePage | `src/pages/salesFinance/SalesFinancePage.tsx` | 6 (8, 9 add) | none |
| ControlsPage | `src/pages/salesFinance/ControlsPage.tsx` | 6 (8 adds) | none |
| (tabs) | `src/pages/salesFinance/salesFinanceTabs.ts` exports `SALES_FINANCE_TABS: TabItem[]` = Reporting `/sales-finance` (end), Controls `/sales-finance/controls` | 6 | |
| SyncStateBadge | `src/components/sync/SyncStateBadge.tsx` | 8 | `{ state: SyncState }` (syncing shows a spinning `RefreshCw`) |
| FreshnessLine | `src/components/sync/FreshnessLine.tsx` | 8 | `{ source: SyncSource; connection: CompanyConnection \| null; now?: Date }` |
| MappedTable | `src/components/sync/MappedTable.tsx` | 8 (11 via links.ts) | `{ source: SyncSource; records: SyncRecord[] }` |
| SourcePanel | `src/components/sync/SourcePanel.tsx` | 8 | `{ companyId: string; targetModule: TargetModule; scaffold: ReactNode; showRecords?: boolean }`; lists that module's enabled sources with badge, freshness and (when `showRecords`, default true) MappedTable, or renders `scaffold` when none |
| FreshnessCard | `src/components/home/FreshnessCard.tsx` | 8 | `{ companyId: string }` |
| DataSourcesPanel | `src/components/settings/DataSourcesPanel.tsx` | 8 (10 adds describe) | `{ companyId: string }` |
| ExternalLinkButton | `src/components/links/ExternalLinkButton.tsx` | 9 | `{ link: ExternalLink }` (`target="_blank" rel="noopener noreferrer"`, shows label, host, "Opens in a new tab", `destination_note`) |
| EmbedFrame | `src/components/links/EmbedFrame.tsx` | 9 | `{ link: ExternalLink }` (null unless `embed_is_public && embed_url`; `<iframe sandbox="allow-scripts allow-same-origin allow-popups allow-forms" referrerPolicy="no-referrer" loading="lazy" title={link.label}>`, caption "Public share view", ExternalLinkButton beside it) |
| ExternalLinksList | `src/components/links/ExternalLinksList.tsx` | 9 | `{ companyId: string; navGroup: LinkNavGroup }` (renders nothing when empty) |
| ExternalLinksPanel | `src/components/settings/ExternalLinksPanel.tsx` | 9 | `{ companyId: string }` |
| ConnectionsPanel (existing) | `src/components/settings/ConnectionsPanel.tsx` | 7, 10 | `{ companyId: string; providers?: ConnectionProvider[] }`; default `["gohighlevel", "quickbooks"]` |

`src/lib/attention.ts` (Task 5, Task 8 adds two kinds) + test:
```ts
export type AttentionKind = "not_signed_in" | "cycle_overdue" | "campaign_no_budget" | "connection_error" | "sync_failed" | "sync_stale";
export interface AttentionItem { kind: AttentionKind; title: string; detail: string; to: string; severity: "warning" | "danger" }
export interface AttentionInput {
  people: Profile[]; cycles: ReviewCycle[]; campaigns: MarketingCampaign[]; connections: CompanyConnection[];
  sources?: SyncSource[];  // Task 8
  today: string;           // YYYY-MM-DD
  now?: Date;              // Task 8, for staleness
}
export function attentionItems(input: AttentionInput): AttentionItem[];
```
Rules (no thresholds invented): `not_signed_in` = one item when any active person has no account
(`!hasAccount`), to `/people`; `cycle_overdue` = each `status === "open"` cycle with
`period_end < today`, to its `cyclePath`; `campaign_no_budget` = one item per campaign with
status `active` or `paused` and `budget === null`, to `/marketing`; `connection_error` = each
connection with `status === "error"`, to `/settings`; `sync_failed` / `sync_stale` = each enabled
source whose `syncState()` is `failed` / `stale`, to `/settings`. Order: danger first, then input order.

`src/lib/sync/format.ts` (Task 8) + test: `formatMappedValue(value: string | number | null, type: FieldType): string`
(currency `formatMoney`, percent `formatPercent(v, 1)`, number `formatNumber`, date `formatDate`,
text as is, null or "" -> "-").

#### 1.8 `src/lib/sync/state.ts` (Task 7)

```ts
export type SyncState = "not_connected" | "awaiting_first_sync" | "syncing" | "failed" | "stale" | "synced";
export const SYNC_STATE_LABELS: Record<SyncState, string> = {
  not_connected: "Not connected", awaiting_first_sync: "Awaiting first sync", syncing: "Syncing",
  failed: "Sync failed", stale: "Stale data", synced: "Synced",
};
export function ageHours(lastSuccessAt: string | null, now: Date): number | null;
export function syncState(
  source: Pick<SyncSource, "last_status" | "last_success_at" | "stale_after_hours">,
  connection: Pick<CompanyConnection, "status"> | null,
  now?: Date,
): SyncState;
```
Precedence, first match wins: `not_connected` (connection null or `not_connected`); `syncing`
(`last_status === "running"`); `failed` (`last_status` is `failed` or `abandoned`, or connection
`error`); `awaiting_first_sync` (`last_success_at` null); `stale` (`stale_after_hours` set and
`ageHours > stale_after_hours`); `synced`.

#### 1.9 `supabase/functions/_shared/sync/*` (Task 7 unless noted; pure, no Deno or npm imports)

`types.ts`
```ts
export type FieldType = "text" | "number" | "currency" | "percent" | "date";
export const FIELD_TYPES: readonly FieldType[] = ["text", "number", "currency", "percent", "date"];
export type SyncProvider = "google_sheets" | "quickbooks";
export type TargetModule = "sales_reporting" | "financial_reporting" | "controls" | "pm_capacity";
export interface FieldMapEntry { header: string; key: string; label: string; type: FieldType; unit: string | null; required: boolean }
export interface SheetsSourceConfig { spreadsheet_id: string; sheet_gid: number; range: string | null; header_row: number } // header_row 1-based
export interface QuickBooksSourceConfig { entity: "Invoice" | "Payment" }
export type SourceConfig = SheetsSourceConfig | QuickBooksSourceConfig;
export interface SyncSourceSpec {
  id: string; company_id: string; connection_id: string; provider: SyncProvider; config: SourceConfig;
  field_map: FieldMapEntry[]; record_key: string[]; enabled: boolean;
  sync_weekday: number | null; sync_time: string | null; sync_timezone: string | null;
  current_run_id: string | null; last_attempt_at: string | null; last_success_at: string | null;
}
export type CellValue = string | number | boolean | null;
export type ParsedValue = string | number | null;            // dates are "YYYY-MM-DD" strings
export interface RawRow { cells: CellValue[]; ref: Record<string, unknown> }
export interface RawTable { headers: CellValue[]; rows: RawRow[] }
export interface ParsedRow { key: string; data: Record<string, ParsedValue>; source_ref: Record<string, unknown> }
export type ValidationCode = "missing_header" | "wrong_type" | "required_blank" | "duplicate_key" | "bad_config";
export interface ValidationError { code: ValidationCode; message: string; row: number | null; field: string | null }
export type MapResult =
  | { ok: true; rows: ParsedRow[]; rowsRead: number; rowsBlank: number }
  | { ok: false; errors: ValidationError[]; rowsRead: number; rowsBlank: number };
export interface ProviderTokens { accessToken: string; refreshToken: string | null; accessExpiresAt: string | null; refreshExpiresAt: string | null }
export interface TokenStore { load(connectionId: string): Promise<ProviderTokens>; save(connectionId: string, tokens: ProviderTokens): Promise<void> }
export interface ConnectionRef { id: string; external_account_id: string | null }
export interface ProviderAdapter { provider: SyncProvider; read(source: SyncSourceSpec, connection: ConnectionRef): Promise<RawTable> }
export type AdapterRegistry = Partial<Record<SyncProvider, ProviderAdapter>>;
```
`SyncSource` (database.ts) must stay structurally assignable to `SyncSourceSpec`.

`parse.ts`
```ts
export function normalizeHeader(header: string): string;   // moved verbatim from src/lib/csv.ts
export const SHEETS_SERIAL_EPOCH = 25569;
export function serialToIsoDate(serial: number): string;   // UTC ms = (serial - 25569) * 86400000, as YYYY-MM-DD
export function isBlankCell(cell: CellValue | undefined): boolean; // undefined, null, "" or whitespace
export type CellParse = { ok: true; value: ParsedValue } | { ok: false; message: string };
export function parseCell(cell: CellValue | undefined, type: FieldType): CellParse;
export function mapRows(table: RawTable, fieldMap: FieldMapEntry[], recordKey: string[]): MapResult;
```
`src/lib/csv.ts` then does `import { normalizeHeader } from "../../supabase/functions/_shared/sync/parse.ts";`
and `export { normalizeHeader };` so `csv.test.ts` and its other callers are untouched.
`parseCell`: blank -> null for every type; `text` -> trimmed string (numbers and booleans
stringified); `number`/`currency`/`percent` -> finite JS number only, any string or boolean is an
error (percent stays a fraction); `date` -> number is a serial (`serialToIsoDate`), a string must
match `^\d{4}-\d{2}-\d{2}$`, else error. `mapRows`: headers matched by `normalizeHeader` on both
sides; a missing header for a `required` entry is `missing_header` (a missing optional header reads
blank); short rows read blank; a row whose mapped cells are all blank is skipped and counted in
`rowsBlank`; any error fails the whole table (R12); `rowsRead` counts every non-header row.

`keys.ts`
```ts
// Empty recordKey -> `row:${rowNumber}`. Otherwise JSON.stringify of the key fields' values in
// recordKey order; null when any key field is blank (mapRows reports required_blank).
export function buildRecordKey(data: Record<string, ParsedValue>, recordKey: string[], rowNumber: number): string | null;
```

`schedule.ts`
```ts
export interface WeeklySchedule { weekday: number; time: string; timezone: string } // weekday 0 = Sunday .. 6 (JS getDay, PG dow); time "HH:MM" or "HH:MM:SS"; IANA zone
export function scheduleOf(source: Pick<SyncSourceSpec, "sync_weekday" | "sync_time" | "sync_timezone">): WeeklySchedule | null;
export function latestSlot(schedule: WeeklySchedule, now: Date): Date;  // latest instant <= now at that local weekday and time
export function isDue(source: Pick<SyncSourceSpec, "enabled" | "sync_weekday" | "sync_time" | "sync_timezone" | "last_attempt_at">, now: Date): boolean;
```
Intl only. A local time skipped by a spring-forward change resolves to the first valid instant
after the gap; an ambiguous fall-back time resolves to the earlier instant. `isDue` per R13:
enabled, has a schedule, and `last_attempt_at` null or before `latestSlot(schedule, now)`.

`runner.ts`
```ts
export const STALE_RUN_MINUTES = 15;
export interface SyncStore {
  // Marks running runs of this connection started before `olderThan` as abandoned, sets their
  // sources' last_status 'failed' with last_error "The sync stopped before finishing." Returns count.
  abandonStaleRuns(connectionId: string, olderThan: Date): Promise<number>;
  // Inserts a running sync_runs row and sets the source's last_status 'running' and
  // last_attempt_at; a unique-index violation on the running lock returns { locked: true }.
  startRun(input: { source: SyncSourceSpec; trigger: "schedule" | "manual"; requestedBy: string | null; now: Date }): Promise<{ runId: string } | { locked: true }>;
  insertRecords(runId: string, source: SyncSourceSpec, rows: ParsedRow[]): Promise<void>;
  markSource(sourceId: string, patch: { current_run_id?: string; last_success_at?: string; last_status: "succeeded" | "failed"; last_error: string | null }): Promise<void>;
  finishRun(runId: string, result: { status: "succeeded" | "failed"; rowsRead: number; rowsApplied: number; rowsBlank: number; errorDetail: unknown | null; finishedAt: Date }): Promise<void>;
  pruneRecords(sourceId: string, keepRunIds: string[]): Promise<void>;
}
export interface RunOutcome {
  status: "succeeded" | "failed" | "locked"; runId: string | null;
  rowsRead: number; rowsApplied: number; rowsBlank: number; errors: ValidationError[]; message: string | null;
}
export async function runSync(args: {
  source: SyncSourceSpec; connection: ConnectionRef; trigger: "schedule" | "manual"; requestedBy: string | null;
  store: SyncStore; adapters: AdapterRegistry; now?: () => Date;
}): Promise<RunOutcome>;
```
Order: `abandonStaleRuns(now - 15 min)` -> `startRun` (locked: return `locked`, touch nothing else)
-> no adapter: fail "Provider not supported yet" -> `read` (throw: fail with the error's message)
-> `mapRows` (errors: fail, `errorDetail = errors`) -> `insertRecords` -> `markSource({ current_run_id: runId, last_success_at, last_status: "succeeded", last_error: null })`
-> `finishRun(succeeded)` -> `pruneRecords(source.id, [runId, previous current_run_id].filter(Boolean))`.
Failure path: `finishRun(failed)` then `markSource({ last_status: "failed", last_error })`; the
pointer and `last_success_at` are never touched on failure.

`links.ts` (Task 7; Task 11 adds the QuickBooks branch)
```ts
export function parseSpreadsheetUrl(url: string): { spreadsheetId: string; gid: number | null } | null;
export function sheetsUrl(spreadsheetId: string, gid: number | null, row?: number | null): string;
// Sheets ref { spreadsheet_id, sheet_gid, row } -> "Open in Google Sheets", note null.
// Task 11: QuickBooks Invoice ref { entity: "Invoice", Id, realmId, sandbox } -> "Open in QuickBooks",
// note "Opens QuickBooks, sign-in required". Anything else -> null.
export function recordLink(ref: Record<string, unknown>): { href: string; label: string; note: string | null } | null;
```

`supabase/functions/_shared/providers.ts` (Task 10): `export const PROVIDER_KEYS = ["gohighlevel", "quickbooks", "google_sheets"] as const; export type ProviderKey = (typeof PROVIDER_KEYS)[number];`
`connections/index.ts` derives `Provider` from it, and `src/lib/sync/providers.test.ts` asserts
every key appears in the 0030 check (reads the SQL file with `node:fs`) and equals
`keysOf(CONNECTION_PROVIDER_LABELS)`.

`googleSheets.ts` (Task 10): `GOOGLE_SCOPES`, `googleAuthorizeUrl(args)`, `emailFromIdToken(idToken: string): string | null`,
`valuesToRawTable(values: CellValue[][], config: SheetsSourceConfig, sheetTitle: string): RawTable`
(row refs `{ spreadsheet_id, sheet_gid, row }`), `sheetTitleForGid(meta: unknown, gid: number): string | null`,
`createGoogleSheetsAdapter(deps: { clientId: string; clientSecret: string; tokens: TokenStore; fetch: typeof fetch; now: () => Date }): ProviderAdapter`.

`quickbooks.ts` (Task 11): `getPath(obj: unknown, path: string): CellValue`,
`projectEntities(entities: Record<string, unknown>[], fieldMap: FieldMapEntry[], realmId: string, entity: "Invoice" | "Payment", sandbox: boolean): RawTable`
(headers = field_map headers; refs `{ entity, Id, realmId, sandbox }`),
`createQboClient(deps): { query(sql: string, start: number, max: number): Promise<Record<string, unknown>[]> }` (GET only, no other method),
`createQuickBooksAdapter(deps: { clientId: string; clientSecret: string; tokens: TokenStore; fetch: typeof fetch; environment: "sandbox" | "production"; now: () => Date }): ProviderAdapter`
(refreshes and `tokens.save` before the first query when the access token is within 5 minutes of expiry).

`supabase/functions/connections/sync.ts` (Task 10, Deno side): `handleSyncRun(req)`, `handleSyncTick(req)`,
`handleSyncDescribe(req)`, `createSyncStore(service: SupabaseClient): SyncStore`,
`createTokenStore(service: SupabaseClient): TokenStore`, `adaptersFor(...)`: AdapterRegistry (Task 11
registers QuickBooks there). `index.ts` dispatches `POST .../sync/run|tick|describe` to it.

---

### 2. Database objects

Standard block every new table carries (named per table `<t>`):
`alter table public.<t> enable row level security;` `revoke all on public.<t> from anon;` explicit
grants to `authenticated` as listed (anything not listed is revoked from `authenticated`);
index on every FK; `<t>_set_updated_at` BEFORE UPDATE -> `public.set_updated_at()` (0001) where the
table has `updated_at`; policies dropped `if exists` then created. All functions:
`revoke execute ... from public, anon, authenticated` for trigger functions; helpers granted to
`authenticated` (and `service_role` where named).

Shared trigger functions introduced once and reused:
- `public.stamp_actor()` (0026): plpgsql, security definer, `search_path = ''`. INSERT:
  `new.created_by := coalesce(private.auth_profile_id(), new.created_by); new.updated_by := new.created_by;`
  UPDATE: `new.created_by := old.created_by; new.updated_by := coalesce(private.auth_profile_id(), old.updated_by);`.
  Trigger `<t>_stamp_actor` BEFORE INSERT OR UPDATE.
- `public.pin_company_id()` (0026): BEFORE UPDATE, `new.company_id := old.company_id`. Trigger `<t>_pin_company`.

#### 0024_company_modules.sql (Task 2)
- `alter table public.companies add column if not exists modules text[] not null default '{}';` No check constraint.
- `create or replace function public.guard_company_fields()` from the **0009** body (plpgsql,
  security definer, `search_path = public`), condition widened to
  `new.slug is distinct from old.slug or new.theme_key is distinct from old.theme_key or new.modules is distinct from old.modules`,
  message 'Only Rococo admins can change a company slug, theme or modules.'. Trigger
  `companies_guard_fields` (0001, BEFORE UPDATE) unchanged.
- Policies unchanged; `list_companies_public` unchanged (does not return modules).

#### 0025_audit_log.sql (Task 3)
`public.audit_events`: `id uuid primary key default gen_random_uuid()`, `company_id uuid` (no
FK, see note), `table_name text not null`, `row_id text not null`, `action text not null`,
`changed jsonb not null default '{}'::jsonb`, `actor_user_id uuid`, `actor_profile_id uuid`,
`actor_kind text not null`, `created_at timestamptz not null default now()`; constraints
`audit_events_action_check (action in ('insert','update','delete'))`,
`audit_events_actor_kind_check (actor_kind in ('user','rococo','system'))`. Indexes
`audit_events_company_created_idx (company_id, created_at desc)`, `audit_events_created_idx (created_at desc)`,
`audit_events_row_idx (table_name, row_id)`.
- Note: no FK on `company_id` or the actor columns. A FK would make every company delete fail,
  because the cascade's own audit rows (profiles set null, domains and connections deleted) would
  reference the company being deleted. History outlives the company. `row_id` is text because
  `company_domains`' key is `domain`.
- `private.audit_change()`: plpgsql, security definer, `search_path = ''`, returns trigger, takes
  the watched column names as `tg_argv`. `r := to_jsonb(coalesce(new, old))` (old for DELETE);
  `row_id := coalesce(r->>'id', r->>'domain')`; `company_id := case when tg_table_name = 'companies' then (r->>'id')::uuid else (r->>'company_id')::uuid end`;
  INSERT: one event, `changed` = every watched column `{old: null, new: v}`; DELETE: `{old: v, new: null}`;
  UPDATE: only watched columns whose values differ, no row when none differ. Actor:
  `actor_user_id := auth.uid()`, `actor_profile_id := private.auth_profile_id()`,
  `actor_kind := case when auth.uid() is null then 'system' when private.is_rococo_admin() then 'rococo' else 'user' end`.
  Returns null (AFTER trigger). Revoke execute from public, anon, authenticated.
- Triggers, all `AFTER INSERT OR UPDATE OR DELETE ... FOR EACH ROW EXECUTE FUNCTION private.audit_change(...)`:
  `companies_audit ('modules','slug','theme_key','name')`,
  `profiles_audit ('role','is_active','is_rococo_admin','company_id','reports_to','job_role_id')`,
  `invitations_audit ('role','email')`, `company_domains_audit ('domain','company_id')`,
  `company_connections_audit ('status','provider','external_account_id')`,
  `gsr_pillars_audit ('weight','scoring_type','required_goals')`, `job_roles_audit ('dashboard_modules')`.
- RLS: policy `"Rococo admins read audit events"` for select to authenticated using
  `(private.is_rococo_admin())`. Grants: `revoke all on public.audit_events from anon, authenticated; grant select on public.audit_events to authenticated;`.

#### 0026_projects_milestones.sql (Task 4)
`public.projects`: `id uuid pk default gen_random_uuid()`, `company_id uuid not null references public.companies (id) on delete cascade`,
`name text not null`, `reference text`, `notes text`, `source text not null default 'manual'`,
`source_key text`, `archived_at timestamptz`, `created_by uuid references public.profiles (id) on delete set null`,
`updated_by uuid references public.profiles (id) on delete set null`, `created_at`, `updated_at timestamptz not null default now()`;
constraints `projects_name_check (btrim(name) <> '')`, `projects_source_check (source in ('manual'))`.
Indexes `projects_company_id_idx`, `projects_created_by_idx`, `projects_updated_by_idx`, unique
`projects_source_key_key on (company_id, source, source_key) where source_key is not null`.
Triggers `projects_pin_company`, `projects_stamp_actor`, `projects_set_updated_at`.
Policies: `"Members read projects"` select using `private.is_company_member(company_id)`;
`"Admins create projects"` insert with check `private.can_manage_company(company_id)`;
`"Admins update projects"` update using and with check `private.can_manage_company(company_id)`. No delete.
Grants: `select, insert, update` to authenticated.

`public.project_milestones`: `id`, `company_id uuid not null references public.companies (id) on delete cascade`,
`project_id uuid not null references public.projects (id) on delete restrict`, `title text not null`,
`description text`, `kind text not null default 'milestone'`, `sort_order integer not null default 0`,
`target_date date`, `responsible_profile_id uuid references public.profiles (id) on delete set null`,
`completed_on date`, `archived_at timestamptz`, `created_by`, `updated_by` (as projects), timestamps;
constraints `project_milestones_kind_check (kind in ('milestone','letter'))`, `project_milestones_title_check (btrim(title) <> '')`.
Indexes `project_milestones_project_idx (project_id, sort_order)`, `project_milestones_company_id_idx`,
`project_milestones_responsible_idx`, `project_milestones_created_by_idx`, `project_milestones_updated_by_idx`.
- `public.inherit_from_project()` (security definer, `search_path = ''`): sets `new.company_id`
  from `projects` (raise 'That project does not exist.'); when `responsible_profile_id` is set and
  that profile's `company_id` differs, raise 'That person belongs to another company.'. Trigger
  `project_milestones_inherit` BEFORE INSERT OR UPDATE. Plus `project_milestones_stamp_actor`,
  `project_milestones_set_updated_at`.
- `public.clear_milestone_owner_on_move()`: `update public.project_milestones set responsible_profile_id = null where responsible_profile_id = new.id and company_id is distinct from new.company_id;`
  Trigger `profiles_move_clears_milestone_owner` AFTER UPDATE OF company_id ON profiles
  `when (old.company_id is distinct from new.company_id)`. `move_employee_company` (0014, latest body 0017) untouched.
- Policies `"Members read milestones"`, `"Admins create milestones"`, `"Admins update milestones"` (same predicates). No delete. Grants select, insert, update.
- No audit triggers (content, not configuration; R18).

#### 0027_wins.sql (Task 5)
`public.wins`: `id`, `company_id uuid not null references public.companies (id) on delete cascade`,
`title text not null`, `description text`, `won_on date not null`,
`project_id uuid references public.projects (id) on delete set null`,
`source_type text not null default 'manual'`, `source_ref jsonb`, `archived_at`, `created_by`,
`updated_by`, timestamps; constraints `wins_title_check (btrim(title) <> '')`,
`wins_source_type_check (source_type in ('manual'))`. Indexes `wins_company_won_idx (company_id, won_on desc)`,
`wins_project_id_idx`, `wins_created_by_idx`, `wins_updated_by_idx`.
- `public.guard_win()` (security definer, `search_path = ''`) BEFORE INSERT OR UPDATE, trigger
  `wins_guard`: `if auth.uid() is not null then new.source_type := 'manual'; new.source_ref := null; end if;`
  UPDATE pins `company_id`; a set `project_id` whose project is in another company raises
  'That project belongs to another company.'. Plus `wins_stamp_actor`, `wins_set_updated_at`.
- Policies `"Members read wins"`, `"Admins create wins"`, `"Admins update wins"`. No delete. Grants select, insert, update.

#### 0030_sync_engine.sql (Task 7)
- `alter table public.company_connections drop constraint if exists company_connections_provider_check;`
  then add `company_connections_provider_check check (provider in ('gohighlevel','quickbooks','google_sheets'))` (0019 untouched).
- `private.can_sync_source(cid uuid) returns boolean language sql stable security definer set search_path = public as $$ select private.can_manage_company(cid) $$;`
  revoke from public, anon; grant execute to authenticated, service_role.
- `public.sync_sources`: `id`, `company_id uuid not null references public.companies (id) on delete cascade`,
  `connection_id uuid not null references public.company_connections (id) on delete cascade`,
  `provider text not null`, `name text not null`, `target_module text not null`,
  `config jsonb not null default '{}'::jsonb`, `field_map jsonb not null default '[]'::jsonb`,
  `record_key text[] not null default '{}'`, `sync_weekday smallint`, `sync_time time`,
  `sync_timezone text`, `stale_after_hours integer`, `enabled boolean not null default false`,
  `current_run_id uuid` (FK added below), `last_attempt_at timestamptz`, `last_success_at timestamptz`,
  `last_status text`, `last_error text`, `sync_requested_at timestamptz`, `created_by`, `updated_by`, timestamps.
  Constraints: `sync_sources_provider_check (provider in ('google_sheets','quickbooks'))`,
  `sync_sources_target_module_check (target_module in ('sales_reporting','financial_reporting','controls','pm_capacity'))`,
  `sync_sources_name_check (btrim(name) <> '')`, `sync_sources_config_check (jsonb_typeof(config) = 'object')`,
  `sync_sources_field_map_check (jsonb_typeof(field_map) = 'array')`,
  `sync_sources_weekday_check (sync_weekday between 0 and 6)`,
  `sync_sources_schedule_check ((sync_weekday is null) = (sync_time is null) and (sync_time is null) = (sync_timezone is null))`,
  `sync_sources_stale_check (stale_after_hours is null or stale_after_hours > 0)`,
  `sync_sources_last_status_check (last_status is null or last_status in ('running','succeeded','failed','abandoned'))`.
  Indexes `sync_sources_company_id_idx`, `sync_sources_connection_id_idx`, `sync_sources_current_run_id_idx`, `sync_sources_created_by_idx`, `sync_sources_updated_by_idx`.
- `public.sync_runs`: `id`, `company_id uuid not null references public.companies (id) on delete cascade`,
  `source_id uuid not null references public.sync_sources (id) on delete cascade`,
  `connection_id uuid not null references public.company_connections (id) on delete cascade`,
  `trigger_kind text not null`, `requested_by uuid references public.profiles (id) on delete set null`,
  `status text not null default 'running'`, `started_at timestamptz not null default now()`,
  `finished_at timestamptz`, `rows_read integer not null default 0`, `rows_applied integer not null default 0`,
  `rows_blank integer not null default 0`, `error_detail jsonb`. Constraints
  `sync_runs_trigger_kind_check (trigger_kind in ('schedule','manual'))`,
  `sync_runs_status_check (status in ('running','succeeded','failed','abandoned'))`.
  Indexes `sync_runs_company_id_idx`, `sync_runs_source_started_idx (source_id, started_at desc)`,
  `sync_runs_connection_id_idx`, `sync_runs_requested_by_idx`, and the lock
  `create unique index if not exists sync_runs_one_running_per_connection on public.sync_runs (connection_id) where status = 'running'`.
- `alter table public.sync_sources add constraint sync_sources_current_run_id_fkey foreign key (current_run_id) references public.sync_runs (id) on delete set null` (inside a `do` block that checks `pg_constraint` first).
- `public.sync_records`: `id`, `company_id uuid not null references public.companies (id) on delete cascade`,
  `source_id uuid not null references public.sync_sources (id) on delete cascade`,
  `run_id uuid not null references public.sync_runs (id) on delete cascade`, `record_key text not null`,
  `data jsonb not null`, `source_ref jsonb not null default '{}'::jsonb`, `created_at timestamptz not null default now()`;
  constraint `sync_records_run_key_key unique (run_id, record_key)`; indexes
  `sync_records_source_run_idx (source_id, run_id)`, `sync_records_company_id_idx`.
- `public.inherit_from_sync_source()` (security definer, `search_path = ''`): sets `new.company_id`
  from the source (raise 'That source does not exist.'), and on `sync_runs` also
  `new.connection_id`. Triggers `sync_runs_inherit`, `sync_records_inherit` BEFORE INSERT.
- `public.guard_sync_source()` (security definer, `search_path = ''`), trigger `sync_sources_guard`
  BEFORE INSERT OR UPDATE: UPDATE pins `company_id`; the connection must exist, be in the same
  company and have the same provider (raise 'That connection belongs to another company or provider.');
  a non-null `sync_timezone` must be a valid zone (`perform now() at time zone new.sync_timezone`);
  when `auth.uid() is not null`: on INSERT `current_run_id`, `last_*` must be null, on UPDATE they
  must equal old (raise 'Sync results are written by the sync, not edited here.'); and when
  `not private.can_manage_company(old.company_id)` (the caller passes only `can_sync_source`),
  `to_jsonb(new) - '{sync_requested_at,updated_at,updated_by}'::text[]` must equal the same of old
  (raise 'You can request a sync but not change the source.').
- Triggers `sync_sources_stamp_actor`, `sync_sources_set_updated_at`, and
  `sync_sources_audit` -> `private.audit_change('provider','connection_id','name','target_module','config','field_map','record_key','sync_weekday','sync_time','sync_timezone','stale_after_hours','enabled')`.
- Policies: `"Admins read sync sources"` select using `private.can_manage_company(company_id)`;
  `"Admins create sync sources"` insert with check `private.can_manage_company(company_id)`;
  `"Admins and syncers update sync sources"` update using and with check
  `(private.can_manage_company(company_id) or private.can_sync_source(company_id))`. No delete
  (disable instead). `"Admins read sync runs"`, `"Admins read sync records"` select using
  `private.can_manage_company(company_id)`; no insert, update or delete policy on either.
- Grants: `sync_sources` select, insert, update; `sync_runs`, `sync_records` select only
  (`revoke insert, update, delete ... from authenticated`). The service role writes them.
- No `external_people` table (R4).

#### 0031_external_links.sql (Task 9)
`public.external_links`: `id`, `company_id uuid not null references public.companies (id) on delete cascade`,
`nav_group text not null`, `label text not null`, `destination_note text`, `url text not null`,
`provider text not null default 'other'`, `embed_url text`, `embed_is_public boolean not null default false`,
`audience text not null default 'everyone'`, `sort_order integer not null default 0`, `created_by`,
`updated_by`, timestamps. Constraints `external_links_nav_group_check (nav_group in ('home','sales_finance','production','people_hr'))`,
`external_links_label_check (btrim(label) <> '')`, `external_links_url_check (url ~ '^https://')`,
`external_links_embed_url_check (embed_url is null or embed_url ~ '^https://')`,
`external_links_embed_public_check (not embed_is_public or embed_url is not null)`,
`external_links_provider_check (provider in ('monday','quickbooks','google_sheets','other'))`,
`external_links_audience_check (audience in ('admins','everyone'))`. Indexes
`external_links_company_group_idx (company_id, nav_group, sort_order)`, `external_links_created_by_idx`, `external_links_updated_by_idx`.
Triggers `external_links_pin_company`, `external_links_stamp_actor`, `external_links_set_updated_at`,
`external_links_audit ('nav_group','label','url','provider','embed_url','embed_is_public','audience')`.
Policies `"Members read external links"` select using
`private.is_company_member(company_id) and (audience = 'everyone' or private.can_manage_company(company_id))`;
`"Admins create external links"`, `"Admins update external links"`, `"Admins delete external links"`
via `private.can_manage_company(company_id)`. Grants select, insert, update, delete.

#### 0032_sync_schedule.sql (Task 10)
`create extension if not exists pg_cron with schema pg_catalog;`
`create extension if not exists pg_net with schema extensions;` (the harness strips exactly these
two lines and stubs `cron` and `net`). Neither extension is installed live today (checked).
`do` block: `if exists (select 1 from cron.job where jobname = 'hub-sync-tick') then perform cron.unschedule('hub-sync-tick'); end if;`
then `select cron.schedule('hub-sync-tick', '7 * * * *', $job$ select net.http_post(url := (select decrypted_secret from vault.decrypted_secrets where name = 'sync_function_url'), headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_cron_secret')), body := '{}'::jsonb, timeout_milliseconds := 10000) $job$);`
No secret or URL literal in the file.

#### 0033_role_hierarchy.sql (Task 12)
- Drop and re-add `profiles_role_check` and `invitations_role_check` as
  `check (role in ('owner','admin','manager','employee'))` (live today: `admin, employee`, checked).
- `private.is_company_admin()` rebuilt from the **0013** body, only the test widened:
  `select coalesce((select role in ('owner','admin') from public.profiles where user_id = auth.uid() and is_active), false)`.
- New helpers (grant execute to authenticated):
  `private.role_rank(r text) returns integer language sql immutable set search_path = ''`
  (employee 1, manager 2, admin 3, owner 4, else 0);
  `private.is_company_owner() returns boolean stable security definer set search_path = public`
  (role = 'owner', by `user_id = auth.uid() and is_active`);
  `private.auth_role_rank() returns integer stable security definer set search_path = public`
  (caller's rank, 0 when none).
- `public.guard_profile_fields()` rebuilt from the **0018** body. Inside the company-admin branch,
  after the existing self check and before `return new`:
  if role changes: new role 'owner' without `private.is_company_owner()` raises
  'Only an owner or Rococo can make someone an owner.'; `private.role_rank(new.role) > private.auth_role_rank()`
  raises 'You cannot grant a role above your own.'; if role or is_active changes and
  `private.role_rank(old.role) > private.auth_role_rank()` raise 'You cannot change the role or access of someone ranked above you.'.
  Everything else in the body is byte-for-byte 0018.
- `public.guard_profile_insert()` trigger `profiles_guard_insert` BEFORE INSERT ON profiles, and
  `public.guard_invitation_role()` trigger `invitations_guard_role` BEFORE INSERT OR UPDATE OF role ON invitations.
  Both open with `if auth.uid() is null or private.is_rococo_admin() then return new; end if;` (the
  0018 bypass that keeps `handle_new_user` working), then apply the owner rule and the rank rule to `new.role`.
- `public.guard_reports_to()` trigger `profiles_guard_reports_to` BEFORE INSERT OR UPDATE OF reports_to, company_id ON profiles
  (no auth bypass): on UPDATE with a company change, a `reports_to` outside the new company is set
  null silently; then null passes; self raises 'A person cannot report to themselves.'; a manager
  in another company raises 'That person is in another company.'; a walk up `reports_to` from the
  new manager (recursive CTE, `union`, depth cap 50) reaching `new.id` raises 'That would make a reporting loop.'.
- `public.clear_reports_to_on_move()` trigger `profiles_move_clears_reports_to` AFTER UPDATE OF company_id ON profiles
  `when (old.company_id is distinct from new.company_id)`:
  `update public.profiles set reports_to = null where reports_to = new.id and company_id is distinct from new.company_id;`
- A leading `do` block raises NOTICE for each existing cross-company or cyclic `reports_to` row; it fixes nothing.
- No `my_team_ids` (R5), no capability table, no audit trigger change (profiles already watched).

#### Existing functions and constraints a migration rebuilds (check in the drift report)

| Object | Latest body today | Rebuilt by | Live check (2026-11-09, read-only) |
| --- | --- | --- | --- |
| `public.guard_company_fields()` | 0009 (earlier 0001) | 0024 | no `modules` in live body; full-text diff is Task 1's |
| `private.is_company_admin()` | 0013 (0001 public version moved by 0009) | 0033 | live compares `user_id = auth.uid()`, no `owner` (matches 0013) |
| `public.guard_profile_fields()` | 0018 (0001, 0009, 0012, 0013) | 0033 | live has `job_role_id` and `user_id = auth.uid()` (matches 0018) |
| `company_connections_provider_check` | 0019 | 0030 | live `('gohighlevel','quickbooks')` |
| `profiles_role_check`, `invitations_role_check` | 0001 | 0033 | live `('admin','employee')` |

Relied on, never rebuilt: `private.can_manage_company`, `private.is_company_member` (0009),
`private.auth_profile_id`, `private.auth_company_id`, `private.is_rococo_admin` (0013),
`public.handle_new_user` (0014; exercised by the 0033 sign-up test), `public.move_employee_company`
(0014, latest body 0017; left alone, new move triggers are separate), `public.guard_review_employee_fields` (0023),
`public.set_updated_at` (0001). 0006 seeds companies `kingdom`, `klasik`, `rba` and their domains,
so SQL tests look companies up by slug rather than creating them.

#### SQL harness contract (Task 1, used by every SQL task)
- `npm run test:sql` -> `bash supabase/tests/run.sh`. Files: `supabase/tests/run.sh`,
  `supabase/tests/stubs.sql`, `supabase/tests/helpers.sql`, and `supabase/tests/NNNN_<name>.test.sql`
  (`0001_tenancy.test.sql` in Task 1; each migration task adds its own number).
- `helpers.sql` is loaded once, after all migrations (and after the second pass of 0024 and up).
  Each test file then runs in its own transaction that is rolled back
  (`psql -X -q -v ON_ERROR_STOP=1 -c 'begin' -f <file> -c 'rollback'`); a RAISE fails the file.
- `helpers.sql` (schema `tests`, usage granted to authenticated):
  `tests.company(p_slug text) returns uuid` **security definer**, `set search_path = ''`:
  `select id from public.companies where slug = p_slug`; raise `No company with slug %` when missing.
  It is security definer for the same reason as `tests.user_of`: tests call it while acting as a
  user whom RLS hides the other companies from. `grant execute` to authenticated, anon;
  `tests.user_of(p_profile uuid) returns uuid` security definer, `search_path = ''`, used by `act_as`
  (so, like `tests.company`, it is security definer);
  `tests.create_person(p_name text, p_company uuid, p_role text default 'employee', p_rococo boolean default false) returns uuid`
  (inserts `auth.users` so `handle_new_user` runs, then sets company, role, Rococo flag as system;
  records the profile id under `p_name` in `tests.fixture(name text primary key, id uuid)`);
  `tests.id(p_name text) returns uuid`; `tests.act_as(p_profile uuid)` (sets `request.jwt.claims`
  `{sub, role}` with `set_config(..., true)` and `set_config('role', 'authenticated', true)`);
  tests return to system with `reset role; select set_config('request.jwt.claims', '', true);`;
  `tests.assert(p_ok boolean, p_message text)`; `tests.assert_raises(p_sql text, p_like text)`.

---

### 3. Routes and nav

#### Route table after Task 13 (new rows marked with their task)

| Path | Guard | Module | Page |
| --- | --- | --- | --- |
| `/` (index) | company else `/rococo` | | DashboardPage |
| `/gsr`, `/reviews`, `/goals` | WithCompany; employee -> `/my/*` | | CyclesPage / GoalsPage |
| `/reviews/settings`, `/reviews/company-goals` | AdminOnly | | GsrSettingsPage / CompanyGoalsPage |
| `/gsr/settings`, `/gsr/company-goals` | redirect to `/reviews/...` | | |
| `/gsr/cycles/:cycleId`, `/reviews/cycles/:cycleId` | AdminOnly | | CyclePage |
| `/gsr/reviews/:reviewId`, `/reviews/:reviewId` | WithCompany | | ReviewPage |
| `/my`, `/my/gsr`, `/my/reviews`, `/my/goals` | Rococo -> `/`; WithCompany | | MyGsrPage / MyReviewsPage / MyGoalsPage |
| `/people`, `/people/:profileId` | AdminOnly | | PeoplePage / PersonPage |
| `/sops`, `/sops/:sopId` | WithCompany | | SopListPage / SopPage |
| `/sops/new`, `/sops/:sopId/edit` | AdminOnly | | SopEditPage |
| `/resources` | WithCompany | | ResourcesPage |
| `/financials`, `/marketing`, `/settings` | AdminOnly | | FinancialsPage / MarketingPage / CompanySettingsPage |
| `/production` (T4) | ModuleOnly | production | ProductionPage (members read) |
| `/production/projects/:projectId` (T4) | ModuleOnly | production | ProjectPage (`assertInCompany`) |
| `/wins` (T5) | ModuleOnly | wins | WinsPage (members read) |
| `/sales-finance` (T6) | AdminOnly > ModuleOnly | data_sources | SalesFinancePage |
| `/sales-finance/controls` (T6) | AdminOnly > ModuleOnly | data_sources | ControlsPage |
| `/rococo`, `/rococo/companies`, `/rococo/people` | RococoOnly | | Portfolio / Companies / Users |
| `/rococo/activity` (T3) | RococoOnly | | ActivityPage |
| `*` | -> `/` | | |

Deep links that must keep working unchanged, with any modules on or off: every path above that
exists today; `/settings?connected=<provider>` and `/settings?connect_error=<msg>` (the
`connections` callback, now also `google_sheets`); the `/gsr/settings` and `/gsr/company-goals`
redirects; both prefixes for cycles and reviews; the demo's `?persona=&company=` query (kept by
`RedirectTo`). No existing route moves or is renamed.

#### Nav registry (`NAV_ITEMS`, in this exact array order)

| id | to | label (flat) | groupedLabel | icon | end | audience | group | requires | Task |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dashboard | `/` | Dashboard | Home | LayoutDashboard | yes | both | home | | 2 |
| wins | `/wins` | Wins | | Trophy | | both | home | wins | 5 |
| gsr | `/gsr` | GSRs | | CalendarCheck | | admin | people_hr | | 2 |
| reviews | `/reviews` | Reviews | | ClipboardCheck | | admin | people_hr | | 2 |
| goals | `/goals` | Goals | | Target | | admin | people_hr | | 2 |
| my-gsr-employee | `/my/gsr` | My GSR | | CalendarCheck | | employee | people_hr | | 2 |
| my-reviews | `/my/reviews` | My Reviews | | ClipboardCheck | | employee | people_hr | | 2 |
| my-goals | `/my/goals` | My Goals | | Target | | employee | people_hr | | 2 |
| people | `/people` | People | | Users | | admin | people_hr | | 2 |
| projects | `/production` | Projects | | HardHat | | both | production | production | 4 |
| sales-reporting | `/sales-finance` | Reporting | | ChartColumn | yes | admin | sales_finance | data_sources | 6 |
| controls | `/sales-finance/controls` | Controls | | ShieldCheck | | admin | sales_finance | data_sources | 6 |
| sops | `/sops` | SOPs | | BookOpen | | both | utility | | 2 |
| resources | `/resources` | Resources | | FolderOpen | | both | utility | | 2 |
| financials | `/financials` | Financials | | CircleDollarSign | | admin | sales_finance | | 2 |
| marketing | `/marketing` | Marketing | | Megaphone | | admin | sales_finance | | 2 |
| my-gsr-admin | `/my/gsr` | My GSR | | UserRound | | admin | people_hr | | 2 |
| settings | `/settings` | Settings | | Settings | | admin | utility | | 2 |

With `modules = '{}'` the flat filter reproduces today exactly: admin = Dashboard, GSRs, Reviews,
Goals, People, SOPs, Resources, Financials, Marketing, My GSR (UserRound), Settings; employee =
Dashboard, My GSR (CalendarCheck), My Reviews, My Goals, SOPs, Resources; Rococo in a company =
admin minus `/my/gsr`. A company with a module on but `switchboard` off gets that module's items
in the flat list at these positions (Wins after Dashboard; Projects, Reporting, Controls after People).

`PORTFOLIO_NAV`: Portfolio `/rococo` (LayoutGrid, end), Companies `/rococo/companies` (Building2),
People `/rococo/people` (Users), and from Task 3 Activity `/rococo/activity` (History). Task 3 also
appends `{ to: "/rococo/activity", label: "Activity" }` to `PORTFOLIO_TABS` in
`src/pages/rococo/portfolioTabs.ts`.

Grouped results for Kingdom (all five modules): admin sees Home (Home, Wins), Sales & Finance
(Reporting, Controls, Financials, Marketing), Production (Projects), People / HR (GSRs, Reviews,
Goals, People, My GSR), then the hairline and SOPs, Resources, Settings. Employee sees Home (Home,
Wins), Production (Projects), People / HR (My GSR, My Reviews, My Goals), then SOPs, Resources; no
Sales & Finance section. Rococo in Kingdom sees the admin layout minus My GSR.

Home cards (DashboardPage): AdminDashboard title is `hasModule(company, "switchboard") ? "Home" : "Dashboard"`.
Below the existing Stat row, admins get AttentionCard and ShortcutsCard (switchboard), WinsCard
(wins), FreshnessCard (switchboard and data_sources, Task 8). Employees get WinsCard (wins) and ShortcutsCard
(switchboard) under their existing header. With no modules nothing renders and no extra service call is made.

External links placement (Task 9, `external_links` on): ShortcutsCard lists every link the caller
can read, grouped under the four section headings; SalesFinancePage lists `sales_finance` links;
ProductionPage lists `production` links; `home` and `people_hr` links appear only on ShortcutsCard (R19).

---

### 4. Fixtures (`src/test/fixtures.ts`)

All new data is Kingdom's, plainly fictional ("Sample job 101", "Sample win 1"), with illustrative
numbers. Klasik and RBA bundles get empty arrays for every new key. New per-company data is
driven by new optional `CompanySpec` fields set only on the `"co-kingdom"` spec, built inside
`build()` with ids `p("...")` (`kingdom-...`). Each task appends its key to `CompanyBundle`, its
spec field, its builder lines and the bundle's return object; it never reorders or rewrites
existing generation (Kingdom's existing reviews, goals and people keep their ids).

| Task | Change | Shape |
| --- | --- | --- |
| 2 | `COMPANIES[].modules` | kingdom `[...MODULE_KEYS]`, klasik `[]`, rba `[]` |
| 2 | `export const KINGDOM: CompanyBundle = bundleFor("co-kingdom")!;` | next to `KLASIK`, `RBA` |
| 3 | `export const AUDIT_EVENTS: AuditEvent[]` (top level, not in a bundle) | three events: a Kingdom profile role change (rococo actor), a Kingdom `companies.modules` change (rococo), a Klasik invitation insert (user) |
| 4 | spec `projects?: Array<{ name: string; reference: string; notes: string \| null; milestones: Array<{ title: string; kind: MilestoneKind; target_date: string \| null; completed_on: string \| null; responsible?: number }> }>`; bundle `projects: Project[]`, `milestones: ProjectMilestone[]` | Kingdom: "Sample job 101" (ref "101", four milestones, one letter, two complete) and "Sample job 102" (ref "102", two milestones, none complete); ids `kingdom-project-1`, `kingdom-milestone-1-1` |
| 5 | spec `wins?: Array<{ title: string; won_on: string; project?: number; archived?: boolean }>`; bundle `wins: Win[]` | Kingdom: "Sample win 1" to "Sample win 7", one archived, one linked to project 1; all `source_type: "manual"` |
| 8 | bundle `syncSources: SyncSource[]`, `syncRuns: SyncRun[]`, `syncRecords: SyncRecord[]`; Kingdom `connections` gain `kingdom-conn-sheets` (google_sheets, connected) and `kingdom-conn-qbo` (quickbooks, `not_connected`) | six sources, one per `SyncState`: not connected (qbo, controls), awaiting first sync, syncing (`last_status: "running"`), failed with last good data and time (financial_reporting), stale (`stale_after_hours: 24`, old success), synced (sales_reporting); field maps use every FieldType; records include one blank value per type |
| 9 | bundle `externalLinks: ExternalLink[]` | Kingdom: a Monday board link in `sales_finance` (everyone), a Monday link in `production` (everyone), a `home` link (admins), one public embed (`embed_is_public: true`, `https://` sample host) in `production` |
| 12 | Kingdom spec people: Marcus Lee becomes `owner`; append "Avery Stone" (`admin`, "Office Manager") and "Jules Carter" (`manager`, "Field Manager"); `Persona` gains `"owner"` and `"manager"` | `personaProfile`: owner -> first `owner`, manager -> first `manager`, admin -> first `admin` (Klasik and RBA: `profiles[0]`, unchanged), employee -> `profiles[1]` (unchanged); `makeHub().isAdmin = isRococo \|\| isCompanyAdminRole(profile.role)`; from here on Kingdom's `admin` persona is Avery Stone and `owner` is Marcus Lee (R21) |

Mocks read fixtures the existing way: `fromAll((b) => b.projects)`, `fromAll((b) => b.milestones)`,
`fromAll((b) => b.wins)`, `fromAll((b) => b.syncSources)` (and runs, records), `fromAll((b) => b.externalLinks)`,
`AUDIT_EVENTS` for `audit.ts`. Demo personas: `?persona=admin|employee|rococo` today, plus
`owner|manager` from Task 12; `?company=kingdom` shows every module, `klasik` and `rba` none.
Page tests for modules use `makeHub("admin", KINGDOM.company)` and `makeHub("employee", KINGDOM.company)`.

---

### 5. Ownership map (files touched by more than one task)

| File | Tasks, in order, and what each adds |
| --- | --- |
| `package.json` | 1 `test:sql` script only |
| `CLAUDE.md` | none (proposed wording only) |
| `README.md` | 2 a short `## Modules` section after `## Branding`; 13 expands it into the module table and moves it to directly after `## Supabase setup`, plus migration order 0001 to 0033, Data sources and Google setup, SQL harness, applying checklist |
| `supabase/tests/*` | 1 creates harness and `0001_tenancy.test.sql`; 2, 3, 4, 5, 7, 9, 10, 12 each add `00NN_*.test.sql` only |
| `src/types/database.ts` | 2 `Company.modules`, `LinkNavGroup`; 3 audit types; 4 project types; 5 win types; 7 provider union, sync types; 9 link types; 12 `Role`, `ROLE_LABELS` |
| `src/App.tsx` | 2 `ModuleOnly`; 3 `/rococo/activity`; 4 production routes; 5 `/wins`; 6 sales-finance routes; 12 `isAdmin` via `isCompanyAdminRole` |
| `src/lib/navigation.ts` (+test) | 2 creates with today's items and `PORTFOLIO_NAV`; 3 Activity; 4 projects; 5 wins; 6 reporting, controls (each task updates the test's grouped expectations) |
| `src/components/AppLayout.tsx` | 2 only (arrays move out, grouped rendering) |
| `src/test/fixtures.ts` | 2, 3, 4, 5, 8, 9, 12 per section 4 |
| `src/pages/pages.test.tsx` | `vi.mock` lines: 3 audit, 4 projects, 5 wins, 8 sync, 9 externalLinks; tests: 2 nav and Home, 3 activity, 4 production, 5 wins and cards, 6 scaffolds and redirects, 8 sync states, 9 links, 12 owner and manager |
| `src/App.rococo.test.tsx` | 2 adds deliverables, jobRoles, connections mocks and changes the Kingdom heading assertion to "Home"; 3, 4, 5, 8, 9 add their mock line |
| `demo/vite.config.ts` | alias regex gains 3 `audit`, 4 `projects`, 5 `wins`, 8 `sync`, 9 `externalLinks` |
| `src/pages/DashboardPage.tsx` | 2 Home title; 5 Attention, Wins, Shortcuts cards; 8 FreshnessCard; 12 admin count via `isCompanyAdminRole` |
| `src/lib/attention.ts` (+test) | 5 creates; 8 adds `sync_failed`, `sync_stale` and `sources`, `now` input |
| `src/components/home/AttentionCard.tsx` | 5 creates; 8 loads sources under `data_sources` |
| `src/components/home/ShortcutsCard.tsx` | 5 creates (sections); 9 adds links |
| `src/pages/production/ProductionPage.tsx` | 4 creates (list, create); 6 scaffold cards; 8 PM capacity scaffold shows a `pm_capacity` source's state via SourcePanel; 9 `ExternalLinksList navGroup="production"` |
| `src/pages/salesFinance/SalesFinancePage.tsx` | 6 creates (scaffolds); 8 SourcePanel for `sales_reporting` and `financial_reporting`; 9 links |
| `src/pages/salesFinance/ControlsPage.tsx` | 6 creates; 8 SourcePanel for `controls` |
| `src/pages/CompanySettingsPage.tsx` | 8 DataSourcesPanel under `data_sources`; 9 ExternalLinksPanel under `external_links`; 10 passes `providers` incl. `google_sheets` to ConnectionsPanel under `data_sources` |
| `src/components/settings/ConnectionsPanel.tsx` | 7 `providers` prop (default the two existing) and a `google_sheets` blurb; 10 nothing (page passes the list) |
| `src/components/status.ts` | 8 only |
| `src/services/connections.ts` | 8 moves `invoke` to `src/services/invoke.ts` |
| `src/components/settings/DataSourcesPanel.tsx` | 8 creates; 10 "Read headers" via `describeSpreadsheet` |
| `src/services/sync.ts` + mock | 8 creates; 10 adds `describeSpreadsheet` |
| `src/lib/sync/draft.ts` (+test) | 8 creates; 10 adds `withHeaders` |
| `src/lib/csv.ts` | 7 only (re-imports `normalizeHeader`) |
| `supabase/functions/_shared/sync/links.ts` | 7 creates (Sheets); 11 QuickBooks Invoice branch |
| `supabase/functions/_shared/sync/types.ts`, `runner.ts` | 7 only (11 consumes) |
| `supabase/functions/connections/index.ts` | 10 sync dispatch, `google_sheets` ProviderDef, `PROVIDER_KEYS`, `requireAdmin` checks `is_active` and `role in owner, admin`; 12 verifies only |
| `supabase/functions/connections/sync.ts` | 10 creates; 11 registers the QuickBooks adapter |
| `supabase/functions/connections/http.ts` | 10 creates (helpers moved from index.ts); 12 verifies `requireAdmin` |
| `src/lib/people.ts` (+test) | 12 adds `isCompanyAdminRole`, `canGrantRole`, `grantableRoles` |
| `src/pages/people/PeoplePage.tsx`, `PersonPage.tsx`, `src/pages/rococo/UsersPage.tsx`, `PortfolioPage.tsx` | 12 only |
| `src/pages/rococo/CompaniesPage.tsx` | 2 only (module checkboxes) |
| `src/pages/rococo/portfolioTabs.ts` | 3 only |
| `docs/kingdom-revamp-plan.md` | 13 only |

Task 12 helpers in `src/lib/people.ts`:
```ts
export function isCompanyAdminRole(role: Role): boolean;                          // owner or admin
export function canGrantRole(granter: Pick<Profile, "role" | "is_rococo_admin">, role: Role): boolean;
export function grantableRoles(granter: Pick<Profile, "role" | "is_rococo_admin">): Role[]; // ROLE_LABELS order
```

---

### 6. Per-task scope

**Task 1. SQL harness and drift report.** Adds `supabase/tests/` (run.sh, stubs.sql, helpers.sql,
`0001_tenancy.test.sql`) and the `test:sql` script, per section 2's harness contract, against
`/usr/lib/postgresql/16/bin` run as the `postgres` OS user via `runuser`. Writes the drift report
once to the plan workspace (not committed), comparing live `pg_get_functiondef` for every
`public`/`private` function, policies, triggers and check constraints with the harness after 0023.
Must not touch `src`, any migration, or the live project beyond read-only queries.

**Task 2. Module gate and four-section navigation.** 0024; `modules.ts`, `navigation.ts` (+tests);
AppLayout grouped rendering; `ModuleOnly`; `Company.modules` and `LinkNavGroup` in types;
`companies.ts` COLUMNS and patch, its mock and the COLUMNS test; fixtures (`modules`, `KINGDOM`);
Rococo module checkboxes; "Home" heading under `switchboard`; README, and proposed CLAUDE.md
wording in the task report (R1);
App.rococo test's three missing mocks and its Kingdom "Home" assertion. Must not add any new route
or page, rename "Dashboard" for a company without `switchboard`, or touch roles.

**Task 3. Audit log.** 0025, `audit.ts` and mock, `lib/audit.ts`, ActivityPage at `/rococo/activity`,
PORTFOLIO_NAV and PORTFOLIO_TABS entry, `AUDIT_EVENTS` fixture. Must not give company admins any
read (RLS or UI), log content tables, or add write grants.

**Task 4. Projects, milestones and letters.** 0026 (introduces `stamp_actor`, `pin_company_id`),
`projects.ts` and mock, `lib/milestones.ts`, ProductionPage, ProjectPage (`assertInCompany`),
MilestoneList, nav item, routes, fixtures. Members read with no edit controls. Must not add a
status column, project status, dates beyond `target_date`/`completed_on`, health, templates,
deletes, or any automation from completion.

**Task 5. Manual wins and Home cards.** 0027, `wins.ts` and mock, WinsPage, `lib/attention.ts`
(four existing signals only), AttentionCard, WinsCard (five most recent non-archived),
ShortcutsCard (sections only), Home placement per section 3, nav item, route, fixtures. Must not
add `team`, pull wins from anywhere, decide display duration or archival, or show external links.

**Task 6. Scaffolds and Sales & Finance pages.** ScaffoldCard; Production scaffold cards (client
score, cleanliness, job health, warranty, PM capacity) on ProductionPage; SalesFinancePage and
ControlsPage (admin-only, `data_sources`) with tabs and scaffold content; nav items. Must not add
any table, number, scale, average, ranking, colour band or digit in a scaffold.

**Task 7. Sync engine core.** 0030; `_shared/sync/{types,parse,keys,schedule,runner,links}.ts`;
`csv.ts` re-import; `lib/sync/state.ts`; tests in `src/lib/sync/` with a fake store and adapter;
sync row types and the `google_sheets` provider union and label; ConnectionsPanel `providers` prop
so no Google row appears yet. Must not add UI beyond that prop, services, Edge Function code, or
`external_people`.

**Task 8. Sync UI.** `invoke.ts` extraction, `sync.ts` and mock, SyncStateBadge, FreshnessLine,
MappedTable, SourcePanel, `lib/sync/format.ts`, DataSourcesPanel (URL parsing via `links.ts`,
field-map rows, key, weekly schedule, stale threshold, enable, Sync now, recent runs),
FreshnessCard, source panels on the Sales & Finance, Controls and PM capacity places,
`SYNC_STATE_TONE`, attention sync items, fixtures. Must not compute any figure from records,
render a blank as 0, or call any provider.

**Task 9. External links and Monday entry points.** 0031, `externalLinks.ts` and mock,
ExternalLinkButton, EmbedFrame, ExternalLinksList, ExternalLinksPanel, ShortcutsCard links, section
lists per section 3, fixtures. Must not call the Monday API, copy any record, embed anything not
flagged public, or filter audience in the UI.

**Task 10. Edge Function sync routes and Google Sheets.** `connections/sync.ts`, `/sync/run`,
`/sync/tick`, `/sync/describe`, `createSyncStore`, `createTokenStore`, `_shared/providers.ts`,
`_shared/sync/googleSheets.ts` (+ fake-fetch tests in `src/lib/sync/`), Google ProviderDef,
`requireAdmin` (`is_active`, owner or admin), `describeSpreadsheet` service and mock and the panel
button, Google row under `data_sources`, 0032. Deno check passes. Must not deploy, apply 0032,
write to Google, or let any other function read `connection_tokens`.

**Task 11. QuickBooks read-only adapter.** `_shared/sync/quickbooks.ts` (GET-only client, token
rotation saved before the first query, paginated Invoice and Payment queries, projection through
the field map, `source_ref` {entity, Id, realmId, sandbox}), the Invoice branch of `recordLink`,
registration in `adaptersFor`, fake-fetch tests. Must not pull reports or implement aging,
escalation, "not sent", partial payments or cash basis.

**Task 12. Role hierarchy foundation.** 0033 per section 2; `Role`, `ROLE_LABELS`; `lib/people.ts`
role helpers; `isAdmin` in App.tsx; counts at `DashboardPage.tsx:228` and `PortfolioPage.tsx:70`;
the role hint at `PeoplePage.tsx:86`; role selects in PeoplePage (lines 87 and 273), PersonPage
(line 223) and UsersPage (line 103) offer Owner only to an owner or Rococo; fixtures and personas.
Must not add `my_team_ids`, any team access for managers, a capability table, or rewrite any
existing row.

**Task 13. Docs and handoff.** README, proposed CLAUDE.md wording (report only, R1),
`docs/kingdom-revamp-plan.md` status and
rulings, and an "Applying this release" checklist (apply 0024 to 0033 in order, deploy
`connections`, secrets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SYNC_CRON_SECRET`, vault entries
`sync_cron_secret` and `sync_function_url`, turn on Kingdom's modules in Rococo > Companies, set
Owners by hand). Must not change code or migrations.

## Tasks

### Task 1: SQL harness and drift report

#### Goal

Give the repo a local, throwaway PostgreSQL 16 harness that applies every migration in
`supabase/migrations/` against stand-ins for Supabase's own schemas, proves the 0024-and-later
migrations are idempotent by applying them twice, and runs plain-SQL test files that act as a given
user under row level security. `npm run test:sql` runs it. Separately, and once, produce a drift
report comparing the live project's functions, policies, triggers and check constraints with what
the migration files produce, so later tasks rebuild functions from the right body.

Where it fits: this is the first task and depends on nothing. Every later task that adds SQL
(Tasks 2, 3, 4, 5, 7, 9, 10, 12) adds one `supabase/tests/00NN_<name>.test.sql` file and uses the
helpers defined here; their gates include `npm run test:sql`. Tasks 2 and 12 read the drift report
before rebuilding `guard_company_fields`, `is_company_admin` and `guard_profile_fields`.

#### Files

Create:
- `supabase/tests/run.sh`: the harness driver (bash). Starts a cluster, loads stubs, applies
  migrations twice where required, loads helpers, runs each test file in its own rolled-back
  transaction, prints a one-line summary, exits non-zero on any failure.
- `supabase/tests/stubs.sql`: Supabase stand-ins (roles, `auth`, `storage`, `extensions`, `vault`,
  `cron`, `net`, default privileges on `public`).
- `supabase/tests/helpers.sql`: the `tests` schema: fixtures and act-as-a-user helpers.
- `supabase/tests/0001_tenancy.test.sql`: first test file (0001 to 0023 apply; the company wall
  holds on `profiles`).

Modify:
- `package.json`: in `"scripts"` (lines 6 to 15 today), add
  `"test:sql": "bash supabase/tests/run.sh"` directly after the `"test:watch"` line (line 13). Nothing
  else in package.json changes. No new dependency.

Do not create any other file in the repo. The drift report and its raw dumps live outside the repo
(see below).

Every new file opens with a comment saying why it exists (CLAUDE.md rule 11): `#` comments in
`run.sh`, `--` comments in the SQL files.

#### `supabase/tests/run.sh` (behavior, in order)

1. `#!/usr/bin/env bash` and `set -euo pipefail`. Header comment: what the harness is, that it needs
   a local PostgreSQL 16 or newer, that it is not part of CI (CI has no PostgreSQL; the gate is run
   by hand for any change under `supabase/`), how to run it (`npm run test:sql`), and the two
   developer switches below. Resolve the repo root from the script's own location
   (`ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"`) so it runs from any cwd.
2. Find the binaries: `PG_BIN` env var if set; else `/usr/lib/postgresql/16/bin` if it exists; else
   `$(pg_config --bindir)`. Read the major version from `"$PG_BIN/postgres" --version`; if it is
   below 16 or the binary is missing, print
   `The SQL harness needs PostgreSQL 16 or newer. Set PG_BIN to its bin directory.` and exit 2.
   (This machine has PostgreSQL 16.15 at `/usr/lib/postgresql/16/bin`.)
3. Work directory: `WORK="$(mktemp -d /tmp/hubsql.XXXXXX)"`. It must be under `/tmp` literally,
   never `$TMPDIR` or the session scratchpad, for two verified reasons: the server's Unix socket path
   (`$WORK/.s.PGSQL.<port>`) must stay under 107 bytes, and when running as root the server runs as
   the `postgres` OS user, which cannot traverse root-only directories such as `/tmp/claude-0`.
   `chmod 755 "$WORK"`.
4. Run-as: if `id -u` is 0, `chown postgres "$WORK"` and prefix every server-side command
   (`initdb`, `pg_ctl`) with `runuser -u postgres --`. Otherwise run them as the current user. The
   `psql` client always runs as the current user and connects as database user `postgres`.
5. `initdb -U postgres --auth=trust --no-sync -E UTF8 --locale=C -D "$WORK/data"` (quiet). Port:
   `PORT="${SQL_PORT:-54329}"`. Start:
   `pg_ctl -D "$WORK/data" -o "-k $WORK -p $PORT -c listen_addresses='' -c fsync=off" -l "$WORK/server.log" -w start`.
6. `trap cleanup EXIT`: unless `SQL_KEEP=1`, `pg_ctl -D "$WORK/data" -m fast stop` and
   `rm -rf "$WORK"`. With `SQL_KEEP=1`, leave the cluster running and print
   `Cluster kept: psql -h $WORK -p $PORT -U postgres` plus the stop command.
7. `PSQL=("$PG_BIN/psql" -X -q -h "$WORK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1)`.
   Apply `supabase/tests/stubs.sql`.
8. First pass: every `supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql` in lexical order. If
   `SQL_THROUGH` is set (for example `SQL_THROUGH=0023`), skip files whose four-digit number is
   greater. Preprocess each file into `$WORK/migrations/<name>` with the one documented
   transformation: delete lines matching (case-insensitive)
   `^[[:space:]]*create[[:space:]]+extension[[:space:]]+if[[:space:]]+not[[:space:]]+exists[[:space:]]+(pg_cron|pg_net)\b.*;[[:space:]]*$`
   (GNU sed: `sed -E '/.../Id'`). Comment beside it: pg_cron and pg_net cannot be installed in a
   throwaway cluster, so `stubs.sql` provides `cron` and `net` stand-ins; nothing else is ever
   rewritten. Apply with `"${PSQL[@]}" --single-transaction -f <copy>` (the Supabase SQL editor runs a
   pasted file as one transaction too; no migration uses a statement that cannot run in one). On
   failure print `Migration <name> failed.` followed by psql's error and exit 1.
9. Second pass: re-apply, in order, every migration whose number is 0024 or greater (and within
   `SQL_THROUGH` when set). On failure print `Migration <name> is not idempotent.` and exit 1. With
   no such file yet (true in this task) the pass is empty.
10. If `SQL_THROUGH` is set, print `Applied migrations through $SQL_THROUGH; tests skipped.` and exit
    0 (the cleanup trap honours `SQL_KEEP`).
11. Apply `supabase/tests/helpers.sql`.
12. For each `supabase/tests/*.test.sql` in lexical order:
    `"${PSQL[@]}" -c 'begin' -f "$file" -c 'rollback' >"$WORK/out" 2>&1`. Exit 0 counts as passed.
    Otherwise print `FAIL <file name>` and the captured output indented two spaces, and count a
    failure. Test files never contain `begin`, `commit` or `rollback` themselves.
13. Summary line, always printed:
    `SQL tests: <P> passed, <F> failed (<M> migrations applied, <R> re-applied)`. Exit 1 when F > 0
    or when no test file was found; exit 0 otherwise.

#### `supabase/tests/stubs.sql` (object list; this exact set was trial-applied and 0001 to 0023 applied cleanly on top of it)

Roles:
- `create role anon nologin noinherit;`
- `create role authenticated nologin noinherit;`
- `create role service_role nologin noinherit bypassrls;`
- `create role supabase_auth_admin nologin noinherit;`
- `create role authenticator login noinherit;` and `grant anon, authenticated, service_role to authenticator;`

Supabase's default privileges on `public` (the migrations revoke from these, so they must exist):
- `grant usage on schema public to anon, authenticated, service_role;`
- `alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;`
- the same for `functions` and for `sequences`.

Schema `auth` (`grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;`):
- `auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb, raw_app_meta_data jsonb default '{}'::jsonb, created_at timestamptz default now(), updated_at timestamptz default now())`.
  The migrations read `id`, `email` and `raw_user_meta_data` only.
- `auth.uid() returns uuid language sql stable`:
  `select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid`.
  The `nullif(..., '')` matters: after a test resets claims to `''`, a bare `''::jsonb` would error.
- `auth.jwt() returns jsonb`: `select coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb`.
- `auth.role() returns text`: the claims' `role`, same null-safe pattern.
- `grant execute on all functions in schema auth to anon, authenticated, service_role;`

Schema `storage` (usage to anon, authenticated, service_role):
- `storage.buckets (id text primary key, name text not null, owner uuid, public boolean default false, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now())`.
- `storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text, owner uuid, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now())`, `alter table storage.objects enable row level security;`
- `grant all on storage.buckets, storage.objects to anon, authenticated, service_role;`
- `storage.foldername(name text) returns text[] language sql immutable`: every path segment but the last.

Schema `extensions` (empty; usage to anon, authenticated, service_role).

Schema `vault` (no grants to API roles):
- `vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, description text default '', secret text not null, created_at timestamptz default now())`.
- `vault.create_secret(new_secret text, new_name text default null, new_description text default '') returns uuid` (inserts, returns id).
- view `vault.decrypted_secrets` = `select id, name, description, secret, secret as decrypted_secret, created_at from vault.secrets`.

Schema `cron` (no grants to API roles):
- `cron.job (jobid bigserial primary key, schedule text not null, command text not null, nodename text default 'localhost', nodeport integer default 5432, database text default current_database(), username text default current_user, active boolean default true, jobname text unique)`.
- `cron.schedule(job_name text, schedule text, command text) returns bigint`: upsert on `jobname`, return `jobid`.
- `cron.unschedule(job_name text) returns boolean` and `cron.unschedule(job_id bigint) returns boolean`: delete, return whether a row went.

Schema `net` (no grants to API roles):
- `net.requests (id bigserial primary key, url text, body jsonb, headers jsonb, timeout_milliseconds integer, created_at timestamptz default now())`.
- `net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb, headers jsonb default '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds integer default 5000) returns bigint`: records the call, returns its id. Never touches the network.

Note in the file header: `postgres` is a true superuser here (it is not on Supabase), so migrations
run with full rights; tests must always switch to `authenticated` or `anon` before asserting
anything about access.

#### `supabase/tests/helpers.sql` (schema `tests`, loaded after all migrations and after the second pass)

- `create schema if not exists tests; grant usage on schema tests to authenticated, anon;`
- `tests.fixture (name text primary key, id uuid not null)`; `grant select on tests.fixture to authenticated, anon;`
- `tests.company(p_slug text) returns uuid` **security definer**, `set search_path = ''`:
  `select id from public.companies where slug = p_slug`; raise `No company with slug %` when missing.
  It is security definer for the same reason as `tests.user_of`: tests call it while acting as a
  user whom RLS hides the other companies from. `grant execute` to authenticated, anon.
  0006 seeds `kingdom`, `klasik` and `rba` with their domains, so tests always look companies up by
  slug and never create the three.
- `tests.create_person(p_name text, p_company uuid, p_role text default 'employee', p_rococo boolean default false) returns uuid`
  (plpgsql, invoker; call it only as system):
  1. email domain: `rocococreative.io` when `p_rococo`; else the alphabetically first
     `company_domains.domain` of `p_company`; else `example.test`.
  2. email local part: `lower(regexp_replace(p_name, '[^A-Za-z0-9]+', '.', 'g'))` plus `.` plus
     six hex characters of `md5(random()::text)` (avoids collisions within one file).
  3. `insert into auth.users (email, raw_user_meta_data) values (v_email, jsonb_build_object('full_name', p_name)) returning id into v_user;`
     so `handle_new_user` (latest body in 0014) runs exactly as on a real first sign-in.
  4. As system: `update public.profiles set company_id = p_company, role = p_role, is_rococo_admin = p_rococo, full_name = p_name where user_id = v_user returning id into v_profile;`
  5. `insert into tests.fixture (name, id) values (p_name, v_profile) on conflict (name) do update set id = excluded.id;` and return `v_profile`.
- `tests.id(p_name text) returns uuid`: from `tests.fixture`; raise `No fixture named %` when missing.
- `tests.user_of(p_profile uuid) returns uuid` **security definer**, `set search_path = ''`:
  `select user_id from public.profiles where id = p_profile`. It exists because `act_as` must read a
  profile's account id even when the caller is already acting as someone RLS hides it from, and
  `act_as` itself cannot be security definer (Postgres refuses a role change inside one).
  `grant execute on function tests.user_of(uuid) to authenticated, anon;`
- `tests.act_as(p_profile uuid) returns void` (plpgsql, invoker):
  `perform set_config('request.jwt.claims', jsonb_build_object('sub', tests.user_of(p_profile), 'role', 'authenticated')::text, true);`
  `perform set_config('role', 'authenticated', true);`
  Raise `That profile has no account` when `user_of` is null.
- Returning to system is done at top level in the test file, never by a helper:
  `reset role; select set_config('request.jwt.claims', '', true);`
- `tests.assert(p_ok boolean, p_message text) returns void`: raise `Assertion failed: %` unless
  `p_ok is true` (a null counts as failure).
- `tests.assert_raises(p_sql text, p_like text) returns void` (plpgsql, invoker, so the statement runs
  as whoever is acting): execute `p_sql` inside `begin ... exception when others then ... end`;
  record `sqlerrm`; after the block, raise `Expected an error like % from: %` if nothing was raised,
  or `Expected an error like % but got: %` if `sqlerrm not like p_like`. The "nothing raised" raise
  must sit outside the exception block or the handler swallows it.
- `grant execute on all functions in schema tests to authenticated, anon;`

#### Tests to write first: `supabase/tests/0001_tenancy.test.sql`

Write this file before `run.sh` and make the harness pass it. Each case is a `do $$ ... $$;` block
(or a top-level `select tests.assert(...)`) preceded by `-- case: <name>`, and every raise message
starts with the case name. Setup at the top, as system:
`select tests.create_person('klasik_admin', tests.company('klasik'), 'admin');`,
`select tests.create_person('kingdom_employee', tests.company('kingdom'));`,
`select tests.create_person('rococo_admin', null, 'employee', true);`.

Cases:
1. `migrations_applied`: as system, `public.companies` has the three seeded slugs and
   `private.can_manage_company(uuid)` exists (proves 0001 to 0023 applied in order).
2. `act_as_reads_own_profile`: act as `klasik_admin`; `select count(*) from public.profiles where id = tests.id('klasik_admin')` is 1.
3. `klasik_admin_cannot_read_kingdom_profile`: still acting as `klasik_admin`, the same count for
   `kingdom_employee` is 0.
4. `klasik_admin_cannot_update_kingdom_profile`: `update public.profiles set title = 'x' where id = tests.id('kingdom_employee')`
   affects 0 rows (`get diagnostics ... row_count`).
5. `klasik_admin_reads_one_company`: `select count(*) from public.companies` is 1.
6. `rococo_reads_kingdom_profile`: act as `rococo_admin`; the Kingdom count is 1.
7. `anon_has_no_table_access`: return to system, `set role anon;` then
   `tests.assert_raises('select 1 from public.profiles', '%permission denied%')`; return to system.
8. `company_lookup_while_acting`: act as `klasik_admin`; `tests.company('kingdom')` is not null;
   return to system.

Then prove the failure path by hand (not committed): add a temporary
`supabase/tests/9999_fail.test.sql` containing `select tests.assert(false, 'deliberate');`, confirm
`npm run test:sql` prints `FAIL 9999_fail.test.sql`, the summary shows 1 failed and the exit code
is 1, then delete the file. Also confirm a deliberately broken copy of a migration (in a scratch
checkout, never in the repo) stops the run with `Migration <name> failed.`.

#### Drift report (once, not committed)

Write it to
`<scratch>/drift-report.md`,
with raw dumps under `.../scratchpad/drift/`. Never in the repo.

1. Harness side: `SQL_THROUGH=0023 SQL_KEEP=1 npm run test:sql`, then run the four catalog queries
   below against the kept cluster with `psql -A -F $'\t'`, saving each to
   `drift/harness-<name>.tsv`; stop the cluster with the printed command.
2. Live side: the same four queries through the Supabase MCP `execute_sql` tool on project
   `jjdcejevdqpwuastsmpq`. Read-only: SELECT and catalog queries only, nothing else, ever. If the
   result is too large for one call, first fetch `md5(pg_get_functiondef(p.oid))` per function, then
   fetch full definitions only for the ones whose hash differs. Save to `drift/live-<name>.tsv`.
3. Queries:
   - functions: `select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid), pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private') and p.prokind = 'f' order by 1,2,3;`
   - policies: `select schemaname, tablename, policyname, cmd, roles::text, qual, with_check from pg_policies where schemaname in ('public','storage') order by 1,2,3;`
   - triggers: `select c.relnamespace::regnamespace::text, c.relname, t.tgname, pg_get_triggerdef(t.oid) from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and (c.relnamespace = 'public'::regnamespace or t.tgname = 'on_auth_user_created') order by 1,2,3;`
   - check constraints: `select conrelid::regclass::text, conname, pg_get_constraintdef(oid) from pg_constraint where contype = 'c' and connamespace = 'public'::regnamespace order by 1,2;`
   - plus, live only, `select evtname, evtfoid::regproc from pg_event_trigger;` (expect the unmanaged
     `rls_auto_enable`; note it, change nothing).
4. Report: one section per catalog listing objects only live, objects only in the harness, and
   objects whose text differs (with a short unified diff, whitespace-only differences called out as
   such). Close with a "Rebuild targets" table stating, for each of these, whether live matches the
   migration body the later task will copy: `public.guard_company_fields()` (0009 body, rebuilt by
   Task 2 in 0024), `private.is_company_admin()` (0013, Task 12), `public.guard_profile_fields()`
   (0018, Task 12), `company_connections_provider_check` (0019, Task 7), `profiles_role_check` and
   `invitations_role_check` (0001, Task 12). Known live facts to confirm: no `modules` in the live
   `guard_company_fields`; live `is_company_admin` compares `user_id = auth.uid()` with no `owner`;
   live provider check is `('gohighlevel','quickbooks')`; live role checks are `('admin','employee')`.
   Do not fix any drift; report it.

#### Design notes

No UI, no TypeScript. Keep the scripts plain bash and SQL, no new tooling.

#### Verification

- `npm run test:sql` exits 0 and prints `SQL tests: 1 passed, 0 failed (23 migrations applied, 0 re-applied)`.
- The deliberate-failure check above behaves as described, and the temporary file is gone.
- `npm run lint`, `npx vitest run`, `npm run build` all pass (unchanged app; proves package.json is
  still valid).
- `git status` shows only `package.json` and the four new files under `supabase/tests/`.
- No Deno check (nothing under `supabase/functions` changes). No visual check (no UI).

#### Must NOT do

- Touch `src/`, `demo/`, any file in `supabase/migrations/`, `supabase/functions/`, README or
  CLAUDE.md. Add `test:sql` to package.json and nothing else there.
- Add the harness to CI (`.github/workflows/`); it needs a local PostgreSQL (R9).
- Rewrite migrations in the harness beyond the documented pg_cron/pg_net extension-line strip.
- Global Constraint 7: apply anything to the live Supabase project or deploy anything. Supabase MCP
  use is read-only, SELECT and catalog queries on `jjdcejevdqpwuastsmpq` only.
- Global Constraint 8: no live-looking sample data; test people are named by role
  (`klasik_admin`, `kingdom_employee`).
- Global Constraint 9 and 10 do not arise here (no business logic, no imported values); do not
  create any table or policy.
- Commit the drift report or any dump.

#### Commit

Subject: `Add a local SQL harness that applies every migration and tests the company wall`

Message ends with the session's standard attribution trailer lines.

### Task 2: Module gate and four-section navigation

#### Goal

Add a per-company module switch (`companies.modules`) that a Rococo admin turns on, one reader for
it (`src/lib/modules.ts`), and a navigation registry (`src/lib/navigation.ts`) that renders today's
flat sidebar for any company without the `switchboard` module and a four-section sidebar ("Home",
"Sales & Finance", "Production", "People / HR", plus an unlabeled utility group) for a company with
it. Under `switchboard` the Dashboard heading reads "Home". Klasik and RBA (modules `{}`) see no
change at all.

Where it fits: builds on Task 1's SQL harness (`npm run test:sql`, `tests.*` helpers). Every later
UI task uses what this task produces: `hasModule`, `NAV_ITEMS`/`navFor`, `ModuleOnly`, the `KINGDOM`
fixture bundle, and `LinkNavGroup`.

#### Before you start

Read `<scratch>/drift-report.md`
(from Task 1). If it reports that live `public.guard_company_fields()` differs from the 0009 body
beyond whitespace, stop and report; do not guess a merged body.

#### Files

Create:
- `supabase/migrations/0024_company_modules.sql`
- `supabase/tests/0024_company_modules.test.sql`
- `src/lib/modules.ts`, `src/lib/modules.test.ts`
- `src/lib/navigation.ts`, `src/lib/navigation.test.ts`
- `src/services/companies.test.ts`

Modify:
- `src/types/database.ts`: `Company` (lines 11 to 19) gains `modules: string[];` after `logo_url`
  with the comment `// Module keys a Rococo admin switched on (0024). Raw text[]: unknown keys are allowed and ignored; read only through lib/modules.ts.`
  Add, near `Company`, `export type LinkNavGroup = "home" | "sales_finance" | "production" | "people_hr";`
  with the comment `// The four nav sections. 0031's external_links.nav_group check uses the same four values.`
- `src/services/companies.ts`: line 7 becomes
  `const COLUMNS = "id, slug, name, theme_key, logo_url, modules, created_at, updated_at";`
  (this is the COLUMNS trap: without it the module is silently invisible); line 28 becomes
  `export type CompanyPatch = Partial<Pick<Company, "name" | "logo_url" | "theme_key" | "slug" | "modules">>;`.
  Update the header comment (lines 1 to 3) to say modules are Rococo-only like slug and theme.
- `src/test/mocks/companies.ts`: line 4 copies arrays (`COMPANIES.map((c) => ({ ...c, modules: [...c.modules] }))`);
  `createCompany` (line 19) sets `modules: []` before `...input`; `CompanyPatch` (line 24) matches the
  service exactly. Add a one-line why-comment at the top if the file has none.
- `src/test/fixtures.ts`: `COMPANIES` (lines 11 to 15) gains `modules`: kingdom `[...MODULE_KEYS]`
  (import `MODULE_KEYS` from `../lib/modules.ts`), klasik `[]`, rba `[]`. After `RBA` (line 961) add
  `export const KINGDOM: CompanyBundle = bundleFor("co-kingdom")!;` with a comment that Kingdom is the
  company with every module on, used by the module page tests and the demo.
- `src/components/AppLayout.tsx`: delete the local `NavItem` interface and the three arrays (lines
  18 to 52) after copying the arrays into `navigation.test.ts`; import `PORTFOLIO_NAV`, `navFor`,
  `type NavItem`, `type NavLayout` from `../lib/navigation.ts`; trim the lucide import (line 8) to the
  icons still used here (`ArrowLeft`, `LogOut`); replace line 79 with the layout computation; replace
  the `<nav>` block (lines 133 to 137) with flat or grouped rendering (below). `NavEntry` (lines 54 to
  69) is unchanged except that its `item` prop is the imported `NavItem` and its key is `item.id`.
- `src/App.tsx`: add `ModuleOnly` after `AdminOnly` (after line 101); import `hasModule` and
  `type ModuleKey` from `./lib/modules.ts`.
- `src/pages/DashboardPage.tsx`: `AdminDashboard`'s `PageHeader` title (line 223) becomes
  `title={hasModule(company, "switchboard") ? "Home" : "Dashboard"}` (import `hasModule`). Nothing
  else on the page changes; the employee header is untouched.
- `src/pages/rococo/CompaniesPage.tsx`: module checkboxes per company (below).
- `src/pages/pages.test.tsx`: new `describe("navigation and modules")` block and a Companies-page
  module test (below). Import `AppLayout` from `../components/AppLayout.tsx` and `KINGDOM` from
  fixtures.
- `src/App.rococo.test.tsx`: add the three missing lines after line 19:
  `vi.mock("./services/deliverables.ts", () => import("./test/mocks/deliverables.ts"));`
  `vi.mock("./services/jobRoles.ts", () => import("./test/mocks/jobRoles.ts"));`
  `vi.mock("./services/connections.ts", () => import("./test/mocks/connections.ts"));`
  Change line 36 to `expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();`
  (Kingdom is the first "Open hub" card and has `switchboard` on). Add the route and `ModuleOnly`
  tests (below) and widen the file's opening comment to say it also proves routes land the same
  with and without modules.
- `CLAUDE.md` (R1): not edited by this task. Write the exact proposed CLAUDE.md wording (rule 1, rule 12's list and module sentence, the `npm run test:sql` gate line, 'What this is', rule 6's provider list) into the task report under a heading 'Proposed CLAUDE.md wording'; the controller shows it to the user and applies it only on the user's explicit approval.
  This task's part of the proposal: rule 1's last sentence (lines 28 to 29) becomes
  "A new tenant is a new theme block plus a `theme_key`, and the modules it has on (`companies.modules`), nothing else."
  In rule 12's "Configured per company already" list (lines 118 to 123), insert
  "the app modules it has on (`companies.modules`), " right after "theme, ". After the list's closing
  "systems." add the sentence: "A module is a key in `companies.modules`, read only through
  `src/lib/modules.ts` (`hasModule`), and changed only by Rococo; with no modules on, a company sees
  exactly what Klasik and RBA see."
- `README.md`: there is no configured-per-company list in README today, so add a short
  `## Modules` section directly after `## Branding` (which ends before `## Layout`, line 297):
  two or three sentences saying a company can have modules switched on by a Rococo admin in Rococo >
  Companies, that with none on it sees the standard hub, and listing the five keys with their
  `MODULE_DESCRIPTIONS` lines. Nothing else in README changes (Task 13 owns the rest).

Do not touch `demo/vite.config.ts` (no new service module).

#### SQL: `supabase/migrations/0024_company_modules.sql`

Header comment in the existing style: `-- 0024_company_modules.sql`, what and why (a per-company
module switch read by `src/lib/modules.ts`, changed only by Rococo), "Paste after 0023; idempotent."

Objects:
- `alter table public.companies add column if not exists modules text[] not null default '{}';`
  No check constraint: the app ignores unknown keys, so a key can be retired without a migration.
- `create or replace function public.guard_company_fields()` copied from the **0009** body
  (`supabase/migrations/0009_private_helpers.sql`, the `guard_company_fields` definition: plpgsql,
  security definer, `set search_path = public`), with exactly one change: the inner condition becomes
  `new.slug is distinct from old.slug or new.theme_key is distinct from old.theme_key or new.modules is distinct from old.modules`
  and the message becomes `'Only Rococo admins can change a company slug, theme or modules.'`.
  The outer `if auth.uid() is not null and not private.is_rococo_admin() then` stays as is (system
  writes and Rococo pass). Do not copy the 0001 body: it calls helpers that 0009 moved.
- Re-state `revoke all on function public.guard_company_fields() from public, anon, authenticated;`
- The trigger `companies_guard_fields` (0001, BEFORE UPDATE on companies) is unchanged; do not
  recreate it. Policies are unchanged. `list_companies_public` and `lookup_company_for_email` are
  unchanged and do not return `modules`.
- No seed: no migration turns on modules for a named company (R10).

Idempotency: `add column if not exists` and `create or replace`; the harness applies the file twice.

#### SQL tests first: `supabase/tests/0024_company_modules.test.sql`

Setup as system: `klasik_admin` (klasik, admin), `klasik_employee` (klasik), `rococo_admin`
(Rococo). Cases (each `-- case: <name>`, raise messages start with the name):
1. `modules_column_default`: every seeded company has `modules = '{}'`; `information_schema.columns`
   reports `companies.modules` as `ARRAY`, `is_nullable = 'NO'`.
2. `company_admin_cannot_change_modules`: act as `klasik_admin`;
   `tests.assert_raises($q$update public.companies set modules = '{wins}' where slug = 'klasik'$q$, '%Only Rococo admins can change a company slug, theme or modules.%')`.
3. `company_admin_cannot_change_slug_or_theme`: same message for `set theme_key = 'rba'` and for
   `set slug = 'klasik-two'` (existing protection kept).
4. `company_admin_can_still_rename`: `update public.companies set name = 'Klasik Renamed' where slug = 'klasik'`
   affects 1 row.
5. `employee_cannot_update_company`: act as `klasik_employee`; the rename affects 0 rows.
6. `rococo_can_change_modules`: act as `rococo_admin`; set Kingdom's modules to
   `'{switchboard,wins}'`, 1 row; reading back as system gives `{switchboard,wins}`.
7. `unknown_keys_allowed`: as Rococo, `'{future_key}'` saves (no check constraint).
8. `system_can_change_modules`: as system (no claims), an update of modules succeeds.
9. `guard_body_is_current`: `pg_get_functiondef('public.guard_company_fields()'::regprocedure)`
   contains `new.modules is distinct from old.modules` and `private.is_rococo_admin()`, and exactly one
   trigger named `companies_guard_fields` exists on `public.companies`.

#### TypeScript: `src/lib/modules.ts` (exact contract)

```ts
import type { Company } from "../types/database.ts";

export const MODULE_KEYS = ["switchboard", "production", "wins", "data_sources", "external_links"] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  switchboard: "Switchboard",
  production: "Production",
  wins: "Wins",
  data_sources: "Data sources",
  external_links: "External links",
};

// One plain line each, shown under the checkbox on Rococo > Companies.
export const MODULE_DESCRIPTIONS: Record<ModuleKey, string> = {
  switchboard: "Four-section navigation, the Home heading, and the Attention and Shortcuts cards.",
  production: "Projects, milestones and letters, and the Production cards.",
  wins: "The wins page and the Home wins card.",
  data_sources: "Connected Google Sheets and QuickBooks sources, Sales & Finance, and data freshness.",
  external_links: "Shortcuts to outside tools, including Monday, in each section.",
};

export function isModuleKey(value: string): value is ModuleKey;
// The only reader of companies.modules. Null company (portfolio) is false. Unknown keys ignored.
export function hasModule(company: Pick<Company, "modules"> | null | undefined, key: ModuleKey): boolean;
// The known keys a company has on, in MODULE_KEYS order.
export function enabledModules(company: Pick<Company, "modules"> | null | undefined): ModuleKey[];
// Pure toggle for the Rococo checkboxes: returns a new array, keeps unknown keys untouched,
// never duplicates a key.
export function withModule(modules: readonly string[], key: ModuleKey, on: boolean): string[];
```
Rules: `hasModule` reads `company?.modules ?? []` (a row fetched without the column must read as
off, never crash). Nothing else in the app reads `company.modules` directly.

Tests first, `src/lib/modules.test.ts`:
- `MODULE_KEYS` equals `["switchboard", "production", "wins", "data_sources", "external_links"]`.
- `isModuleKey("wins")` true; `isModuleKey("sectioned_nav")`, `isModuleKey("Wins")`, `isModuleKey("")` false.
- `hasModule(null, "wins")` and `hasModule(undefined, "wins")` false; `{ modules: [] }` false;
  `{ modules: ["wins"] }` true for `wins`, false for `production`; `{ modules: ["Wins"] }` false;
  `{ modules: ["future", "wins"] }` true for `wins`; `{} as Pick<Company, "modules">` false.
- `enabledModules({ modules: ["wins", "future", "switchboard", "wins"] })` equals `["switchboard", "wins"]`; `enabledModules(null)` equals `[]`.
- `withModule(["future"], "wins", true)` equals `["future", "wins"]`; `withModule(["wins"], "wins", true)`
  equals `["wins"]`; `withModule(["wins", "future"], "wins", false)` equals `["future"]`;
  `withModule(["wins", "wins"], "wins", false)` equals `[]`; the input array is not mutated.
- Every key has a label and a description, and no label or description contains an em dash.

#### TypeScript: `src/lib/navigation.ts` (exact contract)

```ts
import type { LucideIcon } from "lucide-react";
import type { Company, LinkNavGroup } from "../types/database.ts";
import type { ModuleKey } from "./modules.ts";

export type NavGroup = LinkNavGroup | "utility";
export type NavAudience = "admin" | "employee" | "both";
export interface NavItem {
  id: string; to: string; label: string; groupedLabel?: string; icon: LucideIcon; end?: boolean;
  audience: NavAudience; group: NavGroup; requires?: ModuleKey;
}
export const NAV_GROUP_ORDER: readonly NavGroup[] = ["home", "sales_finance", "production", "people_hr", "utility"];
export const NAV_GROUP_LABELS: Record<NavGroup, string | null> = {
  home: "Home", sales_finance: "Sales & Finance", production: "Production", people_hr: "People / HR", utility: null,
};
export const NAV_ITEMS: readonly NavItem[];
export const PORTFOLIO_NAV: readonly NavItem[];
export interface NavSection { group: NavGroup; heading: string | null; items: NavItem[] }
export type NavLayout = { kind: "flat"; items: NavItem[] } | { kind: "grouped"; sections: NavSection[] };
export function navFor(company: Company, isAdmin: boolean, isRococo: boolean): NavLayout;
export function sectionShortcuts(layout: NavLayout): Array<{ group: NavGroup; heading: string; to: string }>;
```

`NAV_ITEMS` in this task holds exactly these 14 items, in this order (later tasks insert Wins after
Dashboard, and Projects, Reporting and Controls after People, at fixed positions):

| id | to | label | groupedLabel | icon | end | audience | group |
| --- | --- | --- | --- | --- | --- | --- | --- |
| dashboard | `/` | Dashboard | Home | LayoutDashboard | true | both | home |
| gsr | `/gsr` | GSRs | | CalendarCheck | | admin | people_hr |
| reviews | `/reviews` | Reviews | | ClipboardCheck | | admin | people_hr |
| goals | `/goals` | Goals | | Target | | admin | people_hr |
| my-gsr-employee | `/my/gsr` | My GSR | | CalendarCheck | | employee | people_hr |
| my-reviews | `/my/reviews` | My Reviews | | ClipboardCheck | | employee | people_hr |
| my-goals | `/my/goals` | My Goals | | Target | | employee | people_hr |
| people | `/people` | People | | Users | | admin | people_hr |
| sops | `/sops` | SOPs | | BookOpen | | both | utility |
| resources | `/resources` | Resources | | FolderOpen | | both | utility |
| financials | `/financials` | Financials | | CircleDollarSign | | admin | sales_finance |
| marketing | `/marketing` | Marketing | | Megaphone | | admin | sales_finance |
| my-gsr-admin | `/my/gsr` | My GSR | | UserRound | | admin | people_hr |
| settings | `/settings` | Settings | | Settings | | admin | utility |

`PORTFOLIO_NAV`: `{ id: "portfolio", to: "/rococo", label: "Portfolio", icon: LayoutGrid, end: true }`,
`{ id: "companies", to: "/rococo/companies", label: "Companies", icon: Building2 }`,
`{ id: "rococo-people", to: "/rococo/people", label: "People", icon: Users }`, each with
`audience: "both", group: "utility"` (unused there). Task 3 appends Activity.

`navFor` rules: an item is visible when its audience matches (`isAdmin` takes `admin` or `both`,
otherwise `employee` or `both`), its `requires` (if any) passes `hasModule(company, requires)`, and,
for `isRococo`, its `to` does not start with `/my` (today's AppLayout rule). Layout is `grouped`
exactly when `hasModule(company, "switchboard")`; otherwise `flat` with the visible items in registry
order. Grouped: sections in `NAV_GROUP_ORDER`, heading from `NAV_GROUP_LABELS`, items in registry
order, each grouped item returned with `label` replaced by `groupedLabel ?? label` (so the `/` item
reads "Home" and `NavEntry` needs no change), and sections with no visible items omitted.
`sectionShortcuts`: `[]` for flat; for grouped, one entry per section except `home` and `utility`,
`{ group, heading, to: section.items[0].to }`.

Tests first, `src/lib/navigation.test.ts`. Before deleting them, copy today's three arrays from
`src/components/AppLayout.tsx` lines 25 to 52 into the test as `TODAY_ADMIN`, `TODAY_PORTFOLIO`,
`TODAY_EMPLOYEE` (with their lucide imports). Compare on `{ to, label, icon, end: Boolean(end) }`.
Use company literals built from the fixtures: Klasik (`KLASIK.company`, modules `[]`), Kingdom
(`KINGDOM.company`, all five), and ad hoc `{ ...KLASIK.company, modules: [...] }`.
1. Klasik admin (`navFor(klasik, true, false)`) is flat and equals `TODAY_ADMIN` item for item.
2. Klasik employee equals `TODAY_EMPLOYEE`.
3. Klasik as Rococo (`true, true`) equals `TODAY_ADMIN` without `/my/gsr`.
4. `PORTFOLIO_NAV` equals `TODAY_PORTFOLIO` (three items; Task 3 changes this to four).
5. RBA (modules `[]`) gives the same three results as Klasik.
6. Modules on but `switchboard` off (`["wins", "production", "data_sources", "external_links"]`) and
   an unknown key (`["future"]`) are flat, and their items with no `requires` equal today's arrays
   item for item (`layout.items.filter((i) => !i.requires)`); `["future"]` equals today's arrays exactly.
7. Kingdom admin is grouped: headings `["Home", "Sales & Finance", "People / HR", null]`; Home
   `["Home"]`; Sales & Finance `["Financials", "Marketing"]`; People / HR
   `["GSRs", "Reviews", "Goals", "People", "My GSR"]`; utility `["SOPs", "Resources", "Settings"]`.
   No Production section yet (it has no items until Task 4).
8. Kingdom employee: headings `["Home", "People / HR", null]`; People / HR
   `["My GSR", "My Reviews", "My Goals"]`; utility `["SOPs", "Resources"]`; no Sales & Finance.
9. Kingdom as Rococo: as case 7 with People / HR `["GSRs", "Reviews", "Goals", "People"]`.
10. `sectionShortcuts`: Kingdom admin gives
    `[{ group: "sales_finance", heading: "Sales & Finance", to: "/financials" }, { group: "people_hr", heading: "People / HR", to: "/gsr" }]`;
    Kingdom employee gives `[{ group: "people_hr", heading: "People / HR", to: "/my/gsr" }]`; any flat
    layout gives `[]`.
11. Every `NAV_ITEMS` id is unique and every item's group is in `NAV_GROUP_ORDER`.

#### AppLayout grouped rendering

```tsx
const layout: NavLayout = portfolio
  ? { kind: "flat", items: [...PORTFOLIO_NAV] }
  : company ? navFor(company, isAdmin, isRococo) : { kind: "flat", items: [] };
```
Keep `<nav aria-label="Primary">` and its classes. Flat: `layout.items.map((item) => <NavEntry key={item.id} item={item} />)`.
Grouped: each section is `<div role="group" aria-label={section.heading ?? "More"}>` with a
`<p className="eyebrow ...">{heading}</p>` (hidden below `lg`, so the small-screen bar stays one
horizontal scrolling row) followed by its `NavEntry`s; sections stack with a small gap at `lg`. The
utility section has no heading and instead a hairline above it at `lg` (`lg:border-t border-line lg:pt-3`)
and a hairline to its left on small screens (`border-l border-line pl-1 lg:border-l-0 lg:pl-0`).
Theme tokens only (`border-line`, `text-ink-3`, the existing `eyebrow` class); no hex, no new
colors. The theme effect, header, switcher and footer are unchanged.

#### `ModuleOnly` in `src/App.tsx`

```tsx
// A module's pages exist only for a company that has the module on. Typing the URL elsewhere
// lands on Home, the way AdminOnly does for employees.
export function ModuleOnly({ module, children }: { module: ModuleKey; children: ReactNode }) {
  const { company } = useHub();
  if (!company) return <RedirectTo path="/rococo" />;
  return hasModule(company, module) ? <>{children}</> : <Navigate to="/" replace />;
}
```
It is exported (named) in this task because no route uses it until Task 4 and the build's
`noUnusedLocals` rejects an unused private function; the export also lets this task test it.
Admin-only module routes in later tasks nest it inside `AdminOnly`. Add no route in this task.

#### Rococo > Companies module checkboxes

Inside each company's `Section` grid (after the logo field, before the sign-in domains block), a
`md:col-span-12` block: `<fieldset aria-label={`Modules for ${company.name}`}>` with a visible legend
"Modules" (styled with `labelClass`), then one row per `MODULE_KEYS` entry: an `<input type="checkbox" className={checkboxClass}>`
with `id={`co-module-${company.id}-${key}`}`, a `<label htmlFor>` reading `MODULE_LABELS[key]`, and
`MODULE_DESCRIPTIONS[key]` under it in `helpClass`. `checked={hasModule(company, key)}`; on change
call the page's existing `patchCompany(company, { modules: withModule(company.modules, key, e.target.checked) })`
(it already updates local state and calls `refreshCompanies`). One line of help under the fieldset:
"With no modules on, the company sees the standard hub." Use `checkboxClass`, `helpClass`,
`labelClass` from `components/ui/forms.ts`; lay the five out in a responsive grid (`sm:grid-cols-2 lg:grid-cols-3`).

#### Page and app tests

In `src/pages/pages.test.tsx`, `describe("navigation and modules")`:
- `renderWithHub(<AppLayout />, makeHub("admin", KINGDOM.company))`: within
  `screen.getByRole("navigation", { name: "Primary" })`, groups named "Home", "Sales & Finance",
  "People / HR" and "More" exist; a link named "Home" exists and no link named "Dashboard".
- Kingdom employee: no group named "Sales & Finance"; groups "Home", "People / HR", "More"; links
  "My GSR", "My Reviews", "My Goals".
- Klasik admin (`makeHub("admin")`): no `role="group"` inside the nav; the nav's link names, in order,
  equal `["Dashboard", "GSRs", "Reviews", "Goals", "People", "SOPs", "Resources", "Financials", "Marketing", "My GSR", "Settings"]`.
- `DashboardPage` for `makeHub("admin", KINGDOM.company)` shows heading "Home"; the existing Klasik
  test still finds "Dashboard" (unchanged).
- Companies page module boxes (rococo hub, `/rococo/companies`): within the group "Modules for
  Kingdom Custom Construction" all five boxes are checked; within "Modules for Klasik Construction"
  none is; checking Klasik's "Wins" box makes it checked, unchecking it again leaves it unchecked (so
  the shared mock store is back to `[]` for later tests).

In `src/services/companies.test.ts`: mock `./supabase.ts` with a recording `db()`:
```ts
const recorded = vi.hoisted(() => ({ selects: [] as string[] }));
vi.mock("./supabase.ts", () => {
  const builder: Record<string, unknown> = {};
  for (const m of ["eq", "order", "single", "insert", "update", "delete"]) builder[m] = () => builder;
  builder.select = (cols: string) => { recorded.selects.push(cols); return builder; };
  builder.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
  return { db: () => ({ from: () => builder }) };
});
```
Assert the select string for `listCompanies`, `getCompany`, `createCompany` and `updateCompany`
equals `"id, slug, name, theme_key, logo_url, modules, created_at, updated_at"`.

In `src/App.rococo.test.tsx`:
- The existing test, with the heading assertion changed to "Home".
- `describe("ModuleOnly")` using `renderWithHub` with `{ path: "/x", pattern: "/x" }` (so a redirect
  to `/` lands on the helper's `elsewhere` route rather than looping): `module="wins"` with
  `makeHub("admin", KINGDOM.company)` renders its child; with `makeHub("admin")` (Klasik) shows
  "elsewhere"; with `makeHub("rococo", null)` shows "elsewhere".
- `describe("routes land the same with modules on")`: a helper `landing(path, persona, slug)` does
  `window.history.pushState({}, "", `${path}${path.includes("?") ? "&" : "?"}persona=${persona}&company=${slug}`)`,
  `render(<App />)`, awaits `screen.findByRole("navigation", { name: "Primary" })`, then
  `waitFor` until `window.location.pathname` stops changing, and returns `window.location.pathname`
  (and `search`). Use `it.each` over route templates, filling ids from each company's own fixtures
  (`KLASIK` and `KINGDOM`: `cycles[0].id`, `cycles[2].id`, `reviews[0].id`, `profiles[1].id`,
  `sops[0].id`). For the admin persona, each template must land on the same expected path for both
  `klasik` and `kingdom`: `/`, `/gsr`, `/reviews`, `/goals`, `/reviews/settings`,
  `/reviews/company-goals`, `/gsr/cycles/:cycle`, `/reviews/cycles/:cycle2`, `/gsr/reviews/:review`,
  `/reviews/:review`, `/my/gsr`, `/my/reviews`, `/my/goals`, `/people`, `/people/:person`, `/sops`,
  `/sops/new`, `/sops/:sop`, `/sops/:sop/edit`, `/resources`, `/financials`, `/marketing`, `/settings`
  land on themselves; `/gsr/settings` lands on `/reviews/settings`; `/gsr/company-goals` on
  `/reviews/company-goals`; `/my` on `/my/gsr`; `/rococo` and `/nope` on `/`;
  `/settings?connected=gohighlevel` lands on `/settings` with `connected=gohighlevel` still in the
  search. For the employee persona on both companies: `/gsr` lands on `/my/gsr`, `/reviews` on
  `/my/reviews`, `/goals` on `/my/goals`, `/people` and `/settings` on `/`, `/sops` on itself. Keep a
  separate, initially empty `it.each` table named "module routes" for Tasks 4, 5 and 6 to append to.

#### Copy strings

"Home"; "Sales & Finance"; "Production"; "People / HR"; "More" (aria label of the utility group
only, never shown); "Modules"; "Modules for <company name>"; the five `MODULE_LABELS` and
`MODULE_DESCRIPTIONS` exactly as above; "With no modules on, the company sees the standard hub.";
"Only Rococo admins can change a company slug, theme or modules." (database message). No em dashes.

#### Verification

- `npm run lint`, `npx vitest run` (all existing tests green and unchanged apart from the one
  heading line and the three `vi.mock` lines in `App.rococo.test.tsx`), `npm run build`,
  `npm run test:sql` (0001 and 0024 test files pass; 0024 applied twice).
- `grep -rnP "\x{2014}" src/lib/modules.ts src/lib/navigation.ts src/pages/rococo/CompaniesPage.tsx src/components/AppLayout.tsx` (the em dash character) prints nothing.
- `grep -rn "\.modules" src --include=*.ts --include=*.tsx` shows reads only in `src/lib/modules.ts`
  (plus the write in CompaniesPage via `withModule(company.modules, ...)`, fixtures and mocks).
- Visual check: `npm run demo` (port 4173) in the background; a Playwright script kept in the
  scratchpad (`require('playwright')`, `chromium.launch()`, a new context per persona at
  `deviceScaleFactor: 1`, desktop 1280x900 and phone 390x844) opens
  `http://localhost:4173/?persona=admin&company=kingdom`, `?persona=employee&company=kingdom`,
  `?persona=admin&company=klasik`, and `?persona=rococo` then `/rococo/companies` (same tab, the demo
  remembers the persona in sessionStorage). Save PNGs to
  `<scratch>/shots/task-2/`,
  look at every one, and fix layout defects (section spacing, the utility hairline, the phone bar
  scrolling horizontally, checkbox grid). The Klasik shot must match today's sidebar exactly.

#### Must NOT do

- Add any route or page, use `ModuleOnly` on a route, or add nav items for wins, projects or Sales &
  Finance pages (Tasks 4 to 6).
- Rename "Dashboard" for a company without `switchboard`, or change the employee header.
- Touch roles (`Role`, `ROLE_LABELS`, `isAdmin`; Task 12).
- Read `company.modules` anywhere but `src/lib/modules.ts`, or branch on a company name, slug or
  theme key (Global Constraint 3).
- Seed modules for any company in SQL (R10), add a check constraint on `modules`, or change any policy.
- Edit migrations 0001 to 0023.
- Edit CLAUDE.md (R1: the proposed wording goes into the task report only).
- Global Constraint 7: apply 0024 to the live project or deploy anything; Supabase MCP read-only.
- Global Constraint 8: no live-looking sample data.
- Global Constraint 9: no business logic beyond the gate.
- Global Constraint 10: no tables or write paths for imported values.

#### Commits

1. `Companies carry a module list that only Rococo can change` (0024, its SQL test, `Company.modules`,
   `LinkNavGroup`, companies service and mock, `companies.test.ts`, `modules.ts` and its test,
   fixtures, CompaniesPage checkboxes, README).
2. `The sidebar reads one registry and groups into four sections under the switchboard module`
   (`navigation.ts` and its test, AppLayout, `ModuleOnly`, the Home heading, page and app tests).

Each message ends with the session's standard attribution trailer lines.

### Task 3: Audit log

#### Goal

Record every change to privileged configuration and permissions (roles, access, company setup,
domains, connections, pillar weights, job-role modules) from now on, in an `audit_events` table that
only Rococo admins can read and nobody can write from the browser. Rococo gets an Activity page in
the portfolio to read it.

Where it fits: builds on Task 1 (SQL harness and `tests.*` helpers) and Task 2 (`companies.modules`,
which this task watches; `src/lib/navigation.ts` with `PORTFOLIO_NAV`; `navigation.test.ts`, whose
portfolio assertion this task updates). Later migrations (0030 `sync_sources_audit`, 0031
`external_links_audit`) attach `private.audit_change()` from this task to their own tables.

#### Files

Create:
- `supabase/migrations/0025_audit_log.sql`
- `supabase/tests/0025_audit_log.test.sql`
- `src/services/audit.ts`, `src/test/mocks/audit.ts`
- `src/lib/audit.ts`, `src/lib/audit.test.ts`
- `src/pages/rococo/ActivityPage.tsx`

Modify:
- `src/types/database.ts`: add the audit types (below) in a new `// Audit` block after the
  connections block at the end of the file.
- `src/lib/navigation.ts`: append to `PORTFOLIO_NAV`
  `{ id: "activity", to: "/rococo/activity", label: "Activity", icon: History, audience: "both", group: "utility" }`
  (lucide `History`).
- `src/lib/navigation.test.ts`: the `PORTFOLIO_NAV` case now expects today's three plus
  `{ to: "/rococo/activity", label: "Activity", icon: History, end: false }`.
- `src/pages/rococo/portfolioTabs.ts`: append `{ to: "/rococo/activity", label: "Activity" }` to
  `PORTFOLIO_TABS` (line 6 today is the last entry) and update the header comment to name Activity.
- `src/App.tsx`: import `ActivityPage` and add
  `<Route path="rococo/activity" element={<RococoOnly><ActivityPage /></RococoOnly>} />` directly after
  the `rococo/people` route (line 323 today).
- `src/test/fixtures.ts`: `export const AUDIT_EVENTS: AuditEvent[]` at top level (not in a bundle),
  after `ALL_PROFILES`.
- `demo/vite.config.ts`: add `audit` to the alias regex on line 19
  (`...|jobRoles|connections|audit)\.ts$/`).
- `src/pages/pages.test.tsx`: add `vi.mock("../services/audit.ts", () => import("../test/mocks/audit.ts"));`
  after the connections line (line 22) and the Activity page tests.
- `src/App.rococo.test.tsx`: add `vi.mock("./services/audit.ts", () => import("./test/mocks/audit.ts"));`
  after the connections mock line.

#### SQL: `supabase/migrations/0025_audit_log.sql`

Header: `-- 0025_audit_log.sql`, why (who changed which role, access or setting, kept from now on,
readable by Rococo only until the capability matrix decides who else), "Paste after 0024; idempotent."

Table `public.audit_events`:
- `id uuid primary key default gen_random_uuid()`
- `company_id uuid` (no foreign key)
- `table_name text not null`
- `row_id text not null`
- `action text not null`
- `changed jsonb not null default '{}'::jsonb`
- `actor_user_id uuid` (no foreign key)
- `actor_profile_id uuid` (no foreign key)
- `actor_kind text not null`
- `created_at timestamptz not null default now()`
- `constraint audit_events_action_check check (action in ('insert','update','delete'))`
- `constraint audit_events_actor_kind_check check (actor_kind in ('user','rococo','system'))`

Comment in the file why there are no foreign keys: a company delete cascades to its domains and
connections and sets its people's company to null, and each of those writes an audit row that names
the company being deleted, so a foreign key would make every company delete fail; history outlives
the company. `row_id` is text because `company_domains` is keyed by `domain`.

Indexes: `audit_events_company_created_idx on (company_id, created_at desc)`,
`audit_events_created_idx on (created_at desc)`, `audit_events_row_idx on (table_name, row_id)`
(all `if not exists`).

Function `private.audit_change()`: `returns trigger language plpgsql security definer set search_path = ''`.
Watched column names arrive as `tg_argv`. Behavior:
- `r := to_jsonb(coalesce(new, old))` (on DELETE `new` is null so `old` is used); for UPDATE also
  keep `o := to_jsonb(old)` and `n := to_jsonb(new)`.
- `v_row := coalesce(r->>'id', r->>'domain')`.
- `v_company := case when tg_table_name = 'companies' then (r->>'id')::uuid else (r->>'company_id')::uuid end`.
- INSERT: `changed` = one key per watched column, `{"old": null, "new": <value>}`; always write.
- DELETE: one key per watched column, `{"old": <value>, "new": null}`; always write.
- UPDATE: only watched columns where `o->col is distinct from n->col`, each `{"old": ..., "new": ...}`;
  write nothing when none differ.
- Actor: `actor_user_id := auth.uid()`, `actor_profile_id := private.auth_profile_id()`,
  `actor_kind := case when auth.uid() is null then 'system' when private.is_rococo_admin() then 'rococo' else 'user' end`.
- Insert into `public.audit_events (company_id, table_name, row_id, action, changed, actor_user_id, actor_profile_id, actor_kind)`
  with `action := lower(tg_op)`. Return null (it is an AFTER trigger).
- `revoke execute on function private.audit_change() from public, anon, authenticated;`

Triggers (each `drop trigger if exists` first; all
`after insert or update or delete on public.<t> for each row execute function private.audit_change(<cols>)`):
- `companies_audit` on `companies`: `'modules','slug','theme_key','name'`
- `profiles_audit` on `profiles`: `'role','is_active','is_rococo_admin','company_id','reports_to','job_role_id'`
- `invitations_audit` on `invitations`: `'role','email'`
- `company_domains_audit` on `company_domains`: `'domain','company_id'`
- `company_connections_audit` on `company_connections`: `'status','provider','external_account_id'`
- `gsr_pillars_audit` on `gsr_pillars`: `'weight','scoring_type','required_goals'`
- `job_roles_audit` on `job_roles`: `'dashboard_modules'`

RLS and grants:
- `alter table public.audit_events enable row level security;`
- `revoke all on public.audit_events from anon, authenticated;` then
  `grant select on public.audit_events to authenticated;`
- `drop policy if exists "Rococo admins read audit events" on public.audit_events;`
  `create policy "Rococo admins read audit events" on public.audit_events for select to authenticated using (private.is_rococo_admin());`
- No insert, update or delete policy. The trigger function (security definer) is the only writer.

Idempotency: `create table if not exists`, `create index if not exists`, `create or replace function`,
drop-then-create triggers and policy; the harness applies the file twice.

#### SQL tests first: `supabase/tests/0025_audit_log.test.sql`

Setup as system: `kingdom_admin` (kingdom, admin), `kingdom_employee` (kingdom), `rococo_admin`.
Read `audit_events` as system when checking what was written (a company admin cannot read it).
Count deltas, because `create_person` itself writes profile insert events.
1. `role_change_writes_one_event`: act as `kingdom_admin`; set `kingdom_employee`'s role to `admin`.
   As system: exactly one new `profiles` event for that row with `action = 'update'`,
   `changed = '{"role": {"old": "employee", "new": "admin"}}'::jsonb`, `actor_kind = 'user'`,
   `actor_profile_id = tests.id('kingdom_admin')`, `company_id = tests.company('kingdom')`.
2. `unwatched_change_writes_none`: act as `kingdom_admin`; update the employee's `phone`; no new event.
3. `insert_event_carries_new_values`: act as `kingdom_admin`; insert an invitation
   (`company_id` Kingdom, email `audit.test@kingdomcustomconstruction.com`, role `employee`); one
   `invitations` event with `action = 'insert'` and `changed->'email'->>'new'` equal to the email.
4. `rococo_actor_kind`: act as `rococo_admin`; set Kingdom's `modules` to `'{wins}'`; the event has
   `actor_kind = 'rococo'`, `row_id = company id`, `company_id = company id`.
5. `system_actor_kind`: as system (claims cleared) update a pillar's `weight`; the event has
   `actor_kind = 'system'` and null `actor_user_id`.
6. `domain_row_id_is_domain`: as Rococo, insert `company_domains ('audit-test.example', Kingdom)`;
   the event's `row_id` is `audit-test.example`.
7. `company_admin_reads_zero_rows`: with events present, act as `kingdom_admin`;
   `select count(*) from public.audit_events` is 0.
8. `rococo_reads_events`: act as `rococo_admin`; the count is greater than 0.
9. `authenticated_cannot_write`: act as `rococo_admin`; `assert_raises` on
   `insert into public.audit_events (table_name, row_id, action, actor_kind) values ('x','x','insert','user')`,
   on an `update` and on a `delete` of `audit_events`, each `'%permission denied%'`.
10. `company_delete_still_works`: as system insert a company (slug `audit-delete-test`, name
    `Audit delete test`), add a domain and a connection row for it, then delete the company: it
    succeeds, and the audit rows naming its id remain.
11. `one_trigger_each`: each of the seven trigger names exists exactly once in `pg_trigger`.

#### TypeScript types (`src/types/database.ts`, exact)

```ts
export type AuditAction = "insert" | "update" | "delete";
export type AuditActorKind = "user" | "rococo" | "system";
export const AUDIT_ACTOR_KIND_LABELS: Record<AuditActorKind, string> = { user: "Company user", rococo: "Rococo", system: "System" };
export interface AuditEvent {
  id: string;
  company_id: string | null;
  table_name: string;
  row_id: string;
  action: AuditAction;
  changed: Record<string, { old: unknown; new: unknown }>;
  actor_user_id: string | null;
  actor_profile_id: string | null;
  actor_kind: AuditActorKind;
  created_at: string;
}
```

#### `src/services/audit.ts` and mock

```ts
// Read-only: the database writes audit events by trigger, and only Rococo admins can read them (0025).
export interface AuditFilter { companyId?: string | null; limit?: number; before?: string }
export async function listAuditEvents(filter?: AuditFilter): Promise<AuditEvent[]>;
```
`COLUMNS = "id, company_id, table_name, row_id, action, changed, actor_user_id, actor_profile_id, actor_kind, created_at"`.
Query `audit_events`, `order("created_at", { ascending: false })`, `limit(filter?.limit ?? 100)`;
`companyId` a string adds `.eq("company_id", id)`, `null` adds `.is("company_id", null)`, undefined
adds nothing; `before` adds `.lt("created_at", before)`. Throws on error.

`src/test/mocks/audit.ts`: same export and signature, over
`AUDIT_EVENTS.map((e) => ({ ...e }))`, applying the same filter, sort and limit. Opening why-comment.

#### `src/lib/audit.ts` (pure) and tests first

```ts
export const AUDIT_TABLE_LABELS: Record<string, string>;
export function describeAuditEvent(event: AuditEvent): string;
```
`AUDIT_TABLE_LABELS`: `companies` "Company", `profiles` "Person", `invitations` "Invitation",
`company_domains` "Sign-in domain", `company_connections` "Connection", `gsr_pillars` "Pillar",
`job_roles` "Job role", `sync_sources` "Data source", `external_links` "External link" (the last two
are attached by later migrations; listing them here keeps this file single-owner).

`describeAuditEvent` format (the raw table name leads, as in "profiles: role admin to owner"):
- update: `${table_name}: ` + each key of `changed`, in key order, as `${key} ${fmt(old)} to ${fmt(new)}`, joined by `"; "`.
- insert: `${table_name}: added` plus ` (${key} ${fmt(new)}, ...)` over keys whose new value is not null; no parentheses when none.
- delete: `${table_name}: removed` plus ` (${key} ${fmt(old)}, ...)` the same way.
- `fmt`: null or undefined is `none`; `true`/`false` are `yes`/`no`; an array is its items joined by
  `", "` (`none` when empty); a string as is; a number via `String`; any other object via `JSON.stringify`.

`src/lib/audit.test.ts` cases:
1. `{ table_name: "profiles", action: "update", changed: { role: { old: "admin", new: "owner" } } }` gives `"profiles: role admin to owner"`.
2. Two keys: role employee to admin and is_active true to false gives `"profiles: role employee to admin; is_active yes to no"`.
3. Modules `[]` to `["switchboard", "wins"]` gives `"companies: modules none to switchboard, wins"`.
4. Insert of an invitation with role and email gives `"invitations: added (role employee, email new.hire@example.com)"`.
5. Delete of a domain gives `"company_domains: removed (domain old.example, company_id co-1)"`.
6. Insert with every new value null gives `"job_roles: added"`.
7. An object value renders as JSON.
8. No output contains an em dash.

#### Fixture `AUDIT_EVENTS` (top level in `src/test/fixtures.ts`)

Three events, plainly illustrative, newest first by `created_at`:
1. `audit-1`: `company_id: "co-kingdom"`, `table_name: "companies"`, `row_id: "co-kingdom"`,
   `action: "update"`, `changed: { modules: { old: [], new: [...MODULE_KEYS] } }`, actor Rococo
   (`actor_user_id: "rococo-auth-1"`, `actor_profile_id: "rococo-user-1"`, `actor_kind: "rococo"`),
   `created_at: "2026-09-02T15:00:00.000Z"`.
2. `audit-2`: Kingdom `profiles` row `kingdom-user-1`, `update`,
   `changed: { role: { old: "employee", new: "admin" } }`, Rococo actor, `created_at: "2026-09-01T16:00:00.000Z"`.
3. `audit-3`: `company_id: "co-klasik"`, `table_name: "invitations"`, `row_id: "klasik-invite-1"`,
   `action: "insert"`, `changed: { role: { old: null, new: "employee" }, email: { old: null, new: "new.hire@beklasik.com" } }`,
   actor `klasik-auth-1` / `klasik-user-1`, `actor_kind: "user"`, `created_at: "2026-09-01T12:00:00.000Z"`.

#### `src/pages/rococo/ActivityPage.tsx`

Default export `ActivityPage`, no props. `PageHeader` eyebrow "Rococo Creative", title "Activity",
description "Changes to roles, access, company setup and connections, newest first. Only Rococo sees
this." Then `<Tabs items={PORTFOLIO_TABS} />`. A company filter `<select aria-label="Filter by company">`
(`selectClass`) with "All companies" plus every company from `listCompanies()`.
Data: `useAsync(() => Promise.all([listAuditEvents({ companyId: filter || undefined, limit: 100 }), listCompanies(), listAllProfiles()]), [filter])`.
Loading: `SkeletonRows rows={8}`. Error: `Notice tone="error"` with `state.error`.
Table inside `Section padded={false}` with `overflow-x-auto`, using `tableClass`, `thClass`,
`tdClass`; columns When (`formatDateTime(created_at)`), Company (company name, or "-"), Change
(`describeAuditEvent`), By (the actor's `displayName` when `actor_profile_id` matches a profile,
else "-", followed by `<Badge tone="neutral">{AUDIT_ACTOR_KIND_LABELS[actor_kind]}</Badge>`).
"Load more" (`Button variant="secondary" size="sm"`) shows when the last page returned 100 rows;
it fetches `listAuditEvents({ companyId, before: lastEvent.created_at, limit: 100 })` and appends;
the appended rows reset when the filter changes. Empty: `EmptyState` eyebrow "Activity", title
"Nothing recorded yet", body "Role, access and setup changes appear here from now on."

#### Page tests (`src/pages/pages.test.tsx`, in the existing `describe("admin")` or a new `describe("activity")`)

- `renderWithHub(<ActivityPage />, rococo, { path: "/rococo/activity", pattern: "/rococo/activity" })`:
  heading "Activity"; text `companies: modules none to switchboard, production, wins, data_sources, external_links`;
  text `profiles: role employee to admin`; text `invitations: added (role employee, email new.hire@beklasik.com)`;
  "Austin Rococo" appears as the actor; a tab link "Activity" exists.
- Selecting `co-klasik` in "Filter by company" leaves only the invitation event visible.

#### Copy strings

"Activity"; "Changes to roles, access, company setup and connections, newest first. Only Rococo sees
this."; "Filter by company"; "All companies"; column headers "When", "Company", "Change", "By";
"Load more"; "Nothing recorded yet"; "Role, access and setup changes appear here from now on.";
actor kinds "Company user", "Rococo", "System". No em dashes.

#### Verification

- `npm run lint`, `npx vitest run`, `npm run build`, `npm run test:sql` (0001, 0024, 0025 pass;
  0024 and 0025 applied twice).
- `grep -rnP "\x{2014}"` (the em dash character) over the new and changed files prints nothing.
- Visual check: `npm run demo`; Playwright (desktop 1280x900 and phone 390x844, `deviceScaleFactor: 1`)
  opens `?persona=rococo` then `/rococo/activity`, plus `?persona=admin&company=kingdom`,
  `?persona=employee&company=kingdom` and `?persona=admin&company=klasik` home pages (to confirm
  nothing else moved). PNGs to
  `<scratch>/shots/task-3/`;
  look at each and fix table overflow or spacing.

#### Must NOT do

- Give company admins any read of `audit_events`, in RLS or in the UI (waits for the capability
  matrix), or add an Activity entry to any company nav.
- Add insert, update or delete grants or policies on `audit_events`.
- Log content tables (reviews, goals, SOPs, projects, wins and so on); only the seven listed.
- Add a foreign key from `audit_events` to `companies` or `profiles` (R17).
- Edit migrations 0001 to 0024.
- Global Constraint 7: apply anything live or deploy; Supabase MCP read-only.
- Global Constraint 8: fixtures stay plainly illustrative.
- Global Constraint 9: no thresholds, alerts or rules on audit events.
- Global Constraint 10: no write path to imported values.

#### Commits

1. `Record role, access and setup changes in an audit log only Rococo can read` (0025, its SQL test, types).
2. `Rococo reads the audit log on a new Activity tab` (service, mock, `lib/audit.ts` and test, page,
   route, nav, tabs, fixture, demo alias, test mocks).

Each message ends with the session's standard attribution trailer lines.

### Task 4: Projects, milestones and letters

#### Goal

Give a company with the `production` module a Production section where admins create projects by
hand and track each project's milestones and letters: a title, a kind (milestone or letter), an
order, a target date, a responsible person and a completed-on date. Members of the company read it;
only admins edit. Nothing is deleted; projects and milestones are archived.

Where it fits: builds on Task 1 (SQL harness), Task 2 (`hasModule`, `NAV_ITEMS`/`navFor`, the
exported `ModuleOnly` guard in `src/App.tsx`, the `KINGDOM` fixture bundle, the route test tables in
`src/App.rococo.test.tsx`) and Task 3 (`private.audit_change()` exists, but projects are content and
get no audit trigger). This migration introduces `public.stamp_actor()` and `public.pin_company_id()`,
which 0027 (wins), 0030 and 0031 reuse. Task 5's `wins.project_id` references `projects`; Task 6
adds scaffold cards to ProductionPage; Task 9 adds production links to it.

#### Files

Create:
- `supabase/migrations/0026_projects_milestones.sql`
- `supabase/tests/0026_projects_milestones.test.sql`
- `src/services/projects.ts`, `src/test/mocks/projects.ts`
- `src/lib/milestones.ts`, `src/lib/milestones.test.ts`
- `src/pages/production/ProductionPage.tsx`
- `src/pages/production/ProjectPage.tsx`
- `src/components/production/MilestoneList.tsx`

Modify:
- `src/types/database.ts`: project and milestone types (below), in a new `// Production` block.
- `src/lib/navigation.ts`: insert into `NAV_ITEMS` directly after the `people` item:
  `{ id: "projects", to: "/production", label: "Projects", icon: HardHat, audience: "both", group: "production", requires: "production" }`.
- `src/lib/navigation.test.ts`: Kingdom admin headings become
  `["Home", "Sales & Finance", "Production", "People / HR", null]` with Production `["Projects"]`;
  Kingdom employee `["Home", "Production", "People / HR", null]`; Kingdom shortcuts gain
  `{ group: "production", heading: "Production", to: "/production" }` between Sales & Finance and
  People / HR (admin) and before People / HR (employee); a company with `modules: ["production"]`
  (switchboard off) is flat with Projects right after People for admins and right after My Goals for
  employees; Klasik and RBA cases unchanged.
- `src/App.tsx`: import both pages; after the `people/:profileId` route (line 312 today) add
  `<Route path="production" element={<ModuleOnly module="production"><ProductionPage /></ModuleOnly>} />`
  and `<Route path="production/projects/:projectId" element={<ModuleOnly module="production"><ProjectPage /></ModuleOnly>} />`.
  No `AdminOnly`: members read.
- `src/test/fixtures.ts`: `CompanySpec` gains `projects?: Array<{ name: string; reference: string; notes: string | null; milestones: Array<{ title: string; kind: MilestoneKind; target_date: string | null; completed_on: string | null; responsible?: number }> }>`
  (`responsible` is a 0-based index into the company's built `profiles`); `CompanyBundle` gains
  `projects: Project[]` and `milestones: ProjectMilestone[]`; `build()` builds them after
  `connections` and adds both to the returned object; only the `"co-kingdom"` spec sets `projects`.
  Do not reorder or rewrite existing generation.
- `demo/vite.config.ts`: add `projects` to the alias regex (line 19).
- `src/pages/pages.test.tsx`: `vi.mock("../services/projects.ts", () => import("../test/mocks/projects.ts"));`
  after the existing mock lines; production tests. In `describe("navigation and modules")` the Kingdom
  admin case now also expects a group named "Production".
- `src/App.rococo.test.tsx`: `vi.mock("./services/projects.ts", () => import("./test/mocks/projects.ts"));`
  and rows in the "module routes" table.

#### SQL: `supabase/migrations/0026_projects_milestones.sql`

Header: `-- 0026_projects_milestones.sql`, why (projects the company tracks by hand, with ordered
milestones and letters; no status column until the company's status set is agreed; archive, never
delete), "Paste after 0025; idempotent."

Shared trigger functions, introduced here and reused by later migrations:
- `public.stamp_actor()`: `returns trigger language plpgsql security definer set search_path = ''`.
  INSERT: `new.created_by := coalesce(private.auth_profile_id(), new.created_by); new.updated_by := new.created_by;`
  UPDATE: `new.created_by := old.created_by; new.updated_by := coalesce(private.auth_profile_id(), old.updated_by);`
  Return new. `revoke execute ... from public, anon, authenticated;`
- `public.pin_company_id()`: same header; `new.company_id := old.company_id; return new;` (BEFORE
  UPDATE). Revoke likewise.

Table `public.projects`:
- `id uuid primary key default gen_random_uuid()`
- `company_id uuid not null references public.companies (id) on delete cascade`
- `name text not null`, `reference text`, `notes text`
- `source text not null default 'manual'`, `source_key text`
- `archived_at timestamptz`
- `created_by uuid references public.profiles (id) on delete set null`
- `updated_by uuid references public.profiles (id) on delete set null`
- `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`
- `constraint projects_name_check check (btrim(name) <> '')`
- `constraint projects_source_check check (source in ('manual'))`
- Indexes: `projects_company_id_idx (company_id)`, `projects_created_by_idx (created_by)`,
  `projects_updated_by_idx (updated_by)`, unique
  `projects_source_key_key on public.projects (company_id, source, source_key) where source_key is not null`.
- Triggers: `projects_pin_company` BEFORE UPDATE -> `public.pin_company_id()`;
  `projects_stamp_actor` BEFORE INSERT OR UPDATE -> `public.stamp_actor()`;
  `projects_set_updated_at` BEFORE UPDATE -> `public.set_updated_at()` (0001).
- RLS on; `revoke all on public.projects from anon, authenticated; grant select, insert, update on public.projects to authenticated;`
- Policies: `"Members read projects"` for select to authenticated using
  `(private.is_company_member(company_id))`; `"Admins create projects"` for insert with check
  `(private.can_manage_company(company_id))`; `"Admins update projects"` for update using and with
  check `(private.can_manage_company(company_id))`. No delete policy.

Table `public.project_milestones`:
- `id uuid primary key default gen_random_uuid()`
- `company_id uuid not null references public.companies (id) on delete cascade` (set by trigger)
- `project_id uuid not null references public.projects (id) on delete restrict`
- `title text not null`, `description text`
- `kind text not null default 'milestone'`
- `sort_order integer not null default 0`
- `target_date date`
- `responsible_profile_id uuid references public.profiles (id) on delete set null`
- `completed_on date` (a milestone is complete when this is set)
- `archived_at timestamptz`, `created_by`, `updated_by` (as projects), `created_at`, `updated_at`
- `constraint project_milestones_kind_check check (kind in ('milestone','letter'))`
- `constraint project_milestones_title_check check (btrim(title) <> '')`
- Indexes: `project_milestones_project_idx (project_id, sort_order)`,
  `project_milestones_company_id_idx (company_id)`, `project_milestones_responsible_idx (responsible_profile_id)`,
  `project_milestones_created_by_idx (created_by)`, `project_milestones_updated_by_idx (updated_by)`.
- `public.inherit_from_project()` (pattern: `inherit_from_job_role` in
  `supabase/migrations/0018_job_roles.sql`; plpgsql, security definer, `search_path = ''`):
  `select company_id into new.company_id from public.projects where id = new.project_id;` raise
  `'That project does not exist.'` when null; then, when `new.responsible_profile_id is not null`
  and that profile's `company_id is distinct from new.company_id`, raise
  `'That person belongs to another company.'`. Revoke execute from public, anon, authenticated.
  Trigger `project_milestones_inherit` BEFORE INSERT OR UPDATE.
- Triggers `project_milestones_stamp_actor` (BEFORE INSERT OR UPDATE, `stamp_actor`) and
  `project_milestones_set_updated_at` (BEFORE UPDATE). BEFORE triggers fire in name order; none of
  these depends on another's result.
- RLS on; same revoke and `grant select, insert, update` to authenticated. Policies
  `"Members read milestones"`, `"Admins create milestones"`, `"Admins update milestones"` with the
  same predicates as projects. No delete.
- `public.clear_milestone_owner_on_move()` (plpgsql, security definer, `search_path = ''`):
  `update public.project_milestones set responsible_profile_id = null where responsible_profile_id = new.id and company_id is distinct from new.company_id; return null;`
  Trigger `profiles_move_clears_milestone_owner` AFTER UPDATE OF company_id ON public.profiles
  FOR EACH ROW `when (old.company_id is distinct from new.company_id)`. `public.move_employee_company`
  (0014, latest body 0017) is not touched.
- No audit triggers (content, not configuration; R18).

Every trigger `drop trigger if exists` first; every policy `drop policy if exists` first;
`create table if not exists`, `create index if not exists`, `create or replace function`.

#### SQL tests first: `supabase/tests/0026_projects_milestones.test.sql`

Setup as system: `kingdom_admin`, `kingdom_admin_two` (kingdom, admin), `kingdom_employee`,
`klasik_admin`, `klasik_employee`, `rococo_admin`. As system insert one Kingdom project
"Sample job 901" and one Klasik project "Sample job 902" and record their ids (a temp table, or
`tests.fixture` rows named `project_kingdom` and `project_klasik`).
1. `milestone_inherits_company`: act as `kingdom_admin`; insert a milestone for the Kingdom project
   giving `company_id = tests.company('klasik')`; it is stored with Kingdom's id.
2. `responsible_other_company_rejected`: insert with `responsible_profile_id = tests.id('klasik_employee')`
   raises `'%That person belongs to another company.%'`.
3. `missing_project_rejected`: a random `project_id` raises `'%That project does not exist.%'` (or
   the foreign key error; assert the trigger message since it fires first).
4. `cross_company_project_refused`: act as `kingdom_admin`; inserting a milestone into the Klasik
   project raises `'%row-level security%'`.
5. `member_reads`: act as `kingdom_employee`; reads 1 project and its milestones.
6. `member_write_refused`: as `kingdom_employee`, inserting a project raises `'%row-level security%'`;
   updating the Kingdom project's name affects 0 rows; same for a milestone.
7. `other_company_reads_nothing`: act as `klasik_admin`; Kingdom project and milestone counts are 0.
8. `no_delete`: act as `kingdom_admin`; deleting a project and a milestone each raise `'%permission denied%'`.
9. `company_pinned`: as `kingdom_admin`, `update ... set company_id = tests.company('klasik')` on the
   Kingdom project leaves `company_id` Kingdom.
10. `actor_stamped`: an insert by `kingdom_admin` passing `created_by = tests.id('kingdom_employee')`
    stores `created_by = updated_by = kingdom_admin`; an update by `kingdom_admin_two` keeps
    `created_by` and sets `updated_by = kingdom_admin_two`.
11. `rococo_writes_any_company`: act as `rococo_admin`; insert a Klasik project succeeds.
12. `move_clears_owner`: as system, set a Kingdom milestone's responsible to `kingdom_employee`, then
    move `kingdom_employee` to Klasik (`update public.profiles set company_id = ...`); the milestone's
    `responsible_profile_id` is null.
13. `checks_hold`: blank project name and blank milestone title raise `'%check constraint%'`; kind
    `'task'` raises `'%project_milestones_kind_check%'`.
14. `source_key_unique`: as system, two Kingdom projects with `source_key = 'x'` raise
    `'%projects_source_key_key%'`; two with null `source_key` are fine.
15. `anon_no_access`: as `anon`, selecting projects raises `'%permission denied%'`.

#### TypeScript types (`src/types/database.ts`, exact)

```ts
export type ProjectSource = "manual";
export interface Project {
  id: string; company_id: string; name: string; reference: string | null; notes: string | null;
  source: ProjectSource; source_key: string | null; archived_at: string | null;
  created_by: string | null; updated_by: string | null; created_at: string; updated_at: string;
}
export type MilestoneKind = "milestone" | "letter";
export const MILESTONE_KIND_LABELS: Record<MilestoneKind, string> = { milestone: "Milestone", letter: "Letter" };
export interface ProjectMilestone {
  id: string; company_id: string; project_id: string; title: string; description: string | null;
  kind: MilestoneKind; sort_order: number; target_date: string | null;
  responsible_profile_id: string | null; completed_on: string | null; archived_at: string | null;
  created_by: string | null; updated_by: string | null; created_at: string; updated_at: string;
}
```

#### `src/services/projects.ts` (exact signatures) and mock

```ts
export async function listProjects(companyId: string, opts?: { includeArchived?: boolean }): Promise<Project[]>; // name asc
export async function getProject(id: string): Promise<Project>;
export async function createProject(input: { company_id: string; name: string; reference?: string | null; notes?: string | null }): Promise<Project>;
export type ProjectPatch = Partial<Pick<Project, "name" | "reference" | "notes">>;
export async function updateProject(id: string, patch: ProjectPatch): Promise<Project>;
export async function archiveProject(id: string): Promise<Project>;        // archived_at = now
export async function listMilestones(projectId: string, opts?: { includeArchived?: boolean }): Promise<ProjectMilestone[]>; // sort_order asc
export async function listCompanyMilestones(companyId: string): Promise<ProjectMilestone[]>; // non-archived, for list counts
export async function createMilestone(input: { project_id: string; title: string; kind: MilestoneKind; sort_order: number; description?: string | null; target_date?: string | null; responsible_profile_id?: string | null }): Promise<ProjectMilestone>;
export type MilestonePatch = Partial<Pick<ProjectMilestone, "title" | "description" | "kind" | "target_date" | "responsible_profile_id" | "completed_on">>;
export async function updateMilestone(id: string, patch: MilestonePatch): Promise<ProjectMilestone>;
export async function reorderMilestones(projectId: string, orderedIds: string[]): Promise<ProjectMilestone[]>; // sort_order = index + 1
export async function archiveMilestone(id: string): Promise<ProjectMilestone>;
```
Header comment: projects and milestones the company enters by hand; members read, admins write,
by RLS (0026); `company_id` on a milestone comes from its project by trigger, so it is never sent.
Column lists:
`PROJECT_COLUMNS = "id, company_id, name, reference, notes, source, source_key, archived_at, created_by, updated_by, created_at, updated_at"`,
`MILESTONE_COLUMNS = "id, company_id, project_id, title, description, kind, sort_order, target_date, responsible_profile_id, completed_on, archived_at, created_by, updated_by, created_at, updated_at"`.
`listProjects` filters `.eq("company_id", companyId)` and, unless `includeArchived`,
`.is("archived_at", null)`; orders by name. `listMilestones` orders by `sort_order` then
`created_at`. `listCompanyMilestones` filters company and non-archived. `reorderMilestones` updates
each id's `sort_order` to its index + 1 (scoped by `.eq("project_id", projectId)`), then returns
`listMilestones(projectId)`. Archive writes `archived_at: new Date().toISOString()`. All throw on error.

`src/test/mocks/projects.ts` (opening why-comment): identical exports, in-memory over
`fromAll((b) => b.projects).map((x) => ({ ...x }))` and `fromAll((b) => b.milestones).map(...)`;
creates get ids `project-new-<n>` / `milestone-new-<n>` with `source: "manual"`, nulls and now
timestamps; `createMilestone` copies `company_id` from its project (throw `"Project not found."`
when missing); mutations stamp `updated_at`; a missing id throws `"Project not found."` /
`"Milestone not found."`.

#### `src/lib/milestones.ts` (pure) and tests first

```ts
export function isComplete(m: Pick<ProjectMilestone, "completed_on">): boolean;
export function sortMilestones(ms: ProjectMilestone[]): ProjectMilestone[];          // sort_order, then created_at
export function nextSortOrder(ms: Pick<ProjectMilestone, "sort_order">[]): number;   // max + 1, 1 when empty
export function milestoneCounts(ms: ProjectMilestone[]): { done: number; total: number }; // non-archived only
export function nextTargetDate(ms: ProjectMilestone[]): string | null;              // earliest target_date of open, non-archived
export function moveMilestone(ms: ProjectMilestone[], id: string, direction: "up" | "down"): string[]; // new id order
```
`src/lib/milestones.test.ts` (build rows with a small `ms(overrides)` factory):
1. `isComplete({ completed_on: null })` false; `{ completed_on: "2026-09-01" }` true.
2. `sortMilestones` orders `[sort 3, sort 1, sort 2]` to `[1, 2, 3]`; equal `sort_order` falls back to
   `created_at` ascending; the input array is not mutated.
3. `nextSortOrder([])` is 1; `[{ sort_order: 1 }, { sort_order: 3 }, { sort_order: 2 }]` is 4;
   `[{ sort_order: 0 }]` is 1.
4. `milestoneCounts` over four rows (two complete, one open, one archived and complete) is
   `{ done: 2, total: 3 }`; letters count like milestones.
5. `nextTargetDate`: open rows with targets `2026-10-02` and `2026-11-20`, a complete row with
   `2026-08-01`, an archived open row with `2026-09-01`, and an open row with no target give
   `"2026-10-02"`; all complete gives `null`.
6. `moveMilestone` on `[a(1), b(2), c(3)]`: `("c", "up")` gives `["a", "c", "b"]`; `("a", "down")`
   gives `["b", "a", "c"]`; `("a", "up")` and `("c", "down")` give `["a", "b", "c"]`; an unknown id
   gives `["a", "b", "c"]`; unsorted input is sorted first.

#### Fixtures (Kingdom only)

Spec `projects` on `"co-kingdom"`, built with ids `p("project-1")` = `kingdom-project-1` and
`p("milestone-1-1")` = `kingdom-milestone-1-1`, `sort_order` = position + 1,
`created_by: profiles[0].id`, `source: "manual"`, `source_key: null`, `archived_at: null`,
timestamps `EARLIER`:
- "Sample job 101", reference "101", notes null, milestones:
  1. "Contract signed", milestone, target `2026-08-01`, completed `2026-07-30`, responsible 0
  2. "Welcome letter sent", letter, target `2026-08-05`, completed `2026-08-04`
  3. "Framing complete", milestone, target `2026-10-02`, open, responsible 1
  4. "Final walkthrough", milestone, target `2026-11-20`, open
- "Sample job 102", reference "102", notes "Illustrative sample project.", milestones:
  1. "Permit approved", milestone, target `2026-09-25`, open
  2. "Foundation poured", milestone, target `2026-10-15`, open

Job 101 reads "2 of 4 done", next target Oct 2, 2026; job 102 "0 of 2 done", next target Sep 25, 2026.
Klasik and RBA get `projects: []`, `milestones: []`.

#### Pages and component

`ProductionPage` (default export, no props, `/production`): `PageHeader` eyebrow = company name,
title "Production", description "Projects with their milestones and letters, entered by hand.";
admins get a primary action "New project". Data: `useAsync` over
`Promise.all([listProjects(companyId), listCompanyMilestones(companyId)])`, keyed on `companyId`.
Loading `SkeletonRows rows={6}`; error `Notice tone="error"`. A `Section` eyebrow "Projects",
title `pluralize(n, "project")`, `padded={false}`, with a table (`tableClass`/`thClass`/`tdClass`):
Project (a `Link` to `/production/projects/<id>` reading the name), Reference (or "-"), Milestones
(`${done} of ${total} done` from `milestoneCounts` of that project's rows), Next target
(`formatDate(nextTargetDate(rows))`, "-" when null). Empty: `EmptyState` eyebrow "Production",
title "No projects yet", body for admins "Add a project to start tracking its milestones and
letters." and for members "Projects appear here once an admin adds them." New project opens a
`Modal` (`labelledBy="new-project-title"`, heading "New project") with `Field`s Name (required),
Reference (hint "A job number or any short code your team uses."), Notes (textarea); buttons
"Cancel" and "Add project"; an empty name shows `Notice tone="error"` "Give the project a name.";
on success the new row joins the list (sorted by name) and the dialog closes.

`ProjectPage` (default export, `useParams<{ projectId: string }>`): `useAsync` loads
`getProject(projectId)`, then `assertInCompany(project, companyId, "project")` (from
`src/lib/tenancy.ts`; a Rococo admin's switcher changes company without navigating, so a stale id
must not keep another tenant's project on screen), plus `listMilestones(projectId)` and
`listCompanyProfiles(companyId)`; deps `[projectId, companyId]`. Error before data renders the
`Notice` alone (for another company's project: "That project is not in this company.").
`PageHeader` with `backTo="/production"`, `backLabel="Production"`, eyebrow "Project", title =
project name, description `Reference ${reference}` when set. Admins: a "Details" `Section` with
`BlurInput`s for Name (`required`, aria "Project name"), Reference (aria "Reference"), Notes
(multiline, aria "Notes") saving through `updateProject`, and an "Archive project" button
(`variant="danger"`) behind `ConfirmDialog` (title "Archive this project?", body "It leaves the
project list. Its milestones and letters are kept.", confirm "Archive") that calls `archiveProject`
and navigates to `/production`. Members see reference and notes as text.

Milestones `Section` (eyebrow "Milestones and letters", title `pluralize(count, "item")`): a filter
of three buttons in a `role="group"` with `aria-label="Show"`: "All", "Milestones", "Letters", each
with `aria-pressed`. In "All" pass the full non-archived list; in the other two pass the filtered
list with `canEdit={false}` and show a `helpClass` line "Switch to All to edit or reorder." (moving a
row inside a filtered view would renumber against rows that are hidden). Under the list, admins in
"All" get an inline add form: input aria "New milestone title", select aria "New milestone kind"
(Milestone, Letter), button "Add milestone"; it calls `createMilestone({ project_id, title, kind, sort_order: nextSortOrder(all) })`
and appends; an empty title shows "Give it a title." `onChanged` replaces the page's milestone list
through `state.setData`.

`MilestoneList` (`src/components/production/MilestoneList.tsx`, default export, props exactly
`{ milestones: ProjectMilestone[]; people: Profile[]; canEdit: boolean; onChanged: (next: ProjectMilestone[]) => void }`):
renders `sortMilestones(milestones)` as a hairline-divided list. Every row shows `<Badge tone="neutral">Letter</Badge>`
for letters and a completion badge: `<Badge tone="success">Done {formatDate(completed_on)}</Badge>`
when complete, else `<Badge tone="neutral">Open</Badge>`. Read-only rows (`canEdit` false) show the
title, "Target {date}" (or "No target date"), the responsible person's `displayName` (or "No one
assigned") and the description. Editable rows use `BlurInput` and `selectClass` controls with these
aria labels: `Title of <title>` (required), `Kind of <title>` (select), `Target date for <title>`
(`type="date"`, empty saves null), `Responsible for <title>` (select of active people plus
"No one"), `Completed on for <title>` (`type="date"`, empty saves null), `Notes for <title>`
(multiline, `rows={2}`); each save calls `updateMilestone` and `onChanged` with the row replaced.
`IconButton`s `Move <title> up` / `Move <title> down` (`ArrowUp`/`ArrowDown`, disabled at the ends)
call `reorderMilestones(projectId, moveMilestone(milestones, id, dir))` (project id from the rows)
and pass the result, non-archived, to `onChanged`. `IconButton` `Archive <title>` (`Archive` icon)
opens `ConfirmDialog` (title "Archive this item?", body "It leaves the list and the counts. It is
kept, not deleted.", confirm "Archive"), then `archiveMilestone` and `onChanged` without it. Errors
show a `Notice tone="error"` from `errorMessage`. Empty list: "No milestones or letters yet."

#### Page tests (`src/pages/pages.test.tsx`, `describe("production")`; read-only assertions first, mutations after, because the mock store is shared)

Hubs: `const kingdomAdmin = makeHub("admin", KINGDOM.company); const kingdomEmployee = makeHub("employee", KINGDOM.company);`
1. ProductionPage, Kingdom admin: heading "Production"; link "Sample job 101"; "2 of 4 done";
   "Oct 2, 2026"; link "Sample job 102"; "0 of 2 done"; "Sep 25, 2026"; button "New project".
2. ProductionPage, Kingdom employee: the same rows; no "New project" button.
3. ProjectPage, Kingdom employee at `/production/projects/kingdom-project-1` (pattern
   `/production/projects/:projectId`): heading "Sample job 101"; text "Framing complete"; one
   "Letter" badge; no textbox; no "Add milestone", "Move ... up" or "Archive ..." controls.
4. ProjectPage refuses another company's project: Klasik admin hub (`admin`) at
   `/production/projects/kingdom-project-1` shows `/not in this company/` and no "Sample job 101".
5. Letter filter (Kingdom admin): pressing "Letters" lists only "Welcome letter sent", shows "Switch
   to All to edit or reorder." and no "Move" buttons; pressing "All" brings all four back.
6. Reorder (Kingdom admin, job 102): pressing "Move Foundation poured up" puts "Foundation poured"
   before "Permit approved" (order of the `Title of ...` inputs' values).
7. Edit (Kingdom admin, job 102): clearing and typing a new value in "Title of Permit approved" then
   blurring shows the new value; setting "Completed on for Foundation poured" to `2026-09-14` shows
   "Done Sep 14, 2026".
8. Add (Kingdom admin, job 102): typing "Sample milestone" in "New milestone title", choosing
   "Letter", pressing "Add milestone" appends it last with a "Letter" badge.
9. Create project (Kingdom admin): "New project", Name "Sample job 103", "Add project": a link
   "Sample job 103" with "0 of 0 done".

In `src/App.rococo.test.tsx`'s "module routes" table: admin `/production` lands on `/production`
for `kingdom` and on `/` for `klasik`; employee `/production/projects/kingdom-project-1` lands on
itself for `kingdom` (members read) and on `/` for `klasik`.

#### Copy strings

"Production"; "Projects with their milestones and letters, entered by hand."; "New project";
"Projects"; column headers "Project", "Reference", "Milestones", "Next target"; "<n> of <m> done";
"No projects yet"; "Add a project to start tracking its milestones and letters."; "Projects appear
here once an admin adds them."; "Name"; "Reference"; "A job number or any short code your team
uses."; "Notes"; "Add project"; "Give the project a name."; "Project"; "Details"; "Archive project";
"Archive this project?"; "It leaves the project list. Its milestones and letters are kept.";
"Archive"; "Milestones and letters"; "All"; "Milestones"; "Letters"; "Switch to All to edit or
reorder."; "Add milestone"; "Give it a title."; "Letter"; "Milestone"; "Done <date>"; "Open";
"Target <date>"; "No target date"; "No one assigned"; "No one"; "Archive this item?"; "It leaves the
list and the counts. It is kept, not deleted."; "No milestones or letters yet."; database messages
"That project does not exist." and "That person belongs to another company.". No em dashes;
industry-neutral wording (no "job" in UI copy; the fixture names are sample data).

#### Design notes

Theme tokens only; `ui/*` primitives (`Section`, `Badge`, `Button`, `IconButton`, `Modal`, `Field`,
`ConfirmDialog`, `EmptyState`, `Notice`, `SkeletonRows`) and `forms.ts` classes; `BlurInput` for
every save-on-blur field; hairline dividers (`divide-line`), dense rows, 150ms transitions as the
existing primitives already apply.

#### Verification

- `npm run lint`, `npx vitest run`, `npm run build`, `npm run test:sql` (0026 applied twice, all
  test files pass).
- `grep -rnP "\x{2014}"` (the em dash character) over the new and changed files prints nothing.
- Visual check: `npm run demo`; Playwright (desktop 1280x900 and phone 390x844, `deviceScaleFactor: 1`)
  with `?persona=admin&company=kingdom` then `/production` and `/production/projects/kingdom-project-1`;
  `?persona=employee&company=kingdom` then the same two; `?persona=admin&company=klasik` then
  `/production` (must land on Home) and its sidebar (unchanged). PNGs to
  `<scratch>/shots/task-4/`;
  look at each and fix row wrapping, control widths and the phone layout of milestone rows.

#### Must NOT do

- Add a status column, a project status, start or completion dates beyond `target_date` and
  `completed_on`, health, a milestone template or fixed count, any delete (grant, policy or UI), or
  any automation from completing a milestone.
- Make Production admin-only, or show edit controls to members.
- Add an import path (`source` other than `'manual'`; R15) or an audit trigger on these tables.
- Touch `move_employee_company` (latest body 0017) or edit migrations 0001 to 0025.
- Global Constraint 7: apply anything live or deploy; Supabase MCP read-only.
- Global Constraint 8: only plainly fictional sample projects ("Sample job 101") and illustrative dates.
- Global Constraint 9: no milestone statuses beyond a completed-on date, no capacity or health math;
  show "Not configured" for anything undefined (Task 6 adds those cards).
- Global Constraint 10: no write path to imported values.

#### Commits

1. `Projects with ordered milestones and letters, read by members and edited by admins` (0026 and
   its SQL test, types).
2. `A Production section lists projects and edits their milestones and letters` (service, mock,
   `lib/milestones.ts` and test, pages, component, nav, routes, fixtures, demo alias, tests).

Each message ends with the session's standard attribution trailer lines.

### Task 5: Manual wins and Home cards

#### Goal

Give a company with the `wins` module a Wins page where admins record wins by hand (title, date,
description, optionally a project) and members read them, and put three cards on Home: Attention
(built only from signals the hub already has) and Shortcuts under `switchboard`, and Wins (the five
most recent) under `wins`. A company with no modules sees exactly today's dashboard and makes no
extra service call.

Where it fits: builds on Task 1 (SQL harness), Task 2 (`hasModule`, `navFor`/`sectionShortcuts`,
the exported `ModuleOnly`, `KINGDOM`, the "module routes" table in `src/App.rococo.test.tsx`) and
Task 4 (`public.projects` for `wins.project_id`, `public.stamp_actor()`, `listProjects` in
`src/services/projects.ts`). Task 8 later adds sync items to `attention.ts` and a FreshnessCard on
Home; Task 9 adds external links to ShortcutsCard.

#### Files

Create:
- `supabase/migrations/0027_wins.sql`, `supabase/tests/0027_wins.test.sql`
- `src/services/wins.ts`, `src/test/mocks/wins.ts`
- `src/pages/WinsPage.tsx`
- `src/lib/attention.ts`, `src/lib/attention.test.ts`
- `src/components/home/AttentionCard.tsx`, `src/components/home/WinsCard.tsx`,
  `src/components/home/ShortcutsCard.tsx`

Modify:
- `src/types/database.ts`: win types (below), in a new `// Wins` block.
- `src/lib/navigation.ts`: insert into `NAV_ITEMS` directly after the `dashboard` item:
  `{ id: "wins", to: "/wins", label: "Wins", icon: Trophy, audience: "both", group: "home", requires: "wins" }`.
- `src/lib/navigation.test.ts`: Kingdom admin and employee Home sections become `["Home", "Wins"]`;
  a company with `modules: ["wins"]` (switchboard off) is flat with Wins right after Dashboard for
  admin and employee; shortcut expectations unchanged (Home is never a shortcut).
- `src/App.tsx`: import `WinsPage`; add
  `<Route path="wins" element={<ModuleOnly module="wins"><WinsPage /></ModuleOnly>} />` after the
  index route (line 292 today). No `AdminOnly`: members read.
- `src/pages/DashboardPage.tsx`: the cards (below). Import `hasModule`, `AttentionCard`, `WinsCard`,
  `ShortcutsCard`; read `isAdmin` and `isRococo` from `useHub()` where needed.
- `src/test/fixtures.ts`: `CompanySpec` gains `wins?: Array<{ title: string; won_on: string; project?: number; archived?: boolean }>`
  (`project` a 0-based index into the company's built `projects`); `CompanyBundle` gains `wins: Win[]`;
  build after `projects`; only `"co-kingdom"` sets it.
- `demo/vite.config.ts`: add `wins` to the alias regex (line 19).
- `src/pages/pages.test.tsx`: `vi.mock("../services/wins.ts", () => import("../test/mocks/wins.ts"));`; tests below.
- `src/App.rococo.test.tsx`: `vi.mock("./services/wins.ts", () => import("./test/mocks/wins.ts"));`
  and rows in the "module routes" table.

#### SQL: `supabase/migrations/0027_wins.sql`

Header: `-- 0027_wins.sql`, why (wins the company records by hand; a browser write is always manual,
so a later import can be told apart), "Paste after 0026; idempotent."

Table `public.wins`:
- `id uuid primary key default gen_random_uuid()`
- `company_id uuid not null references public.companies (id) on delete cascade`
- `title text not null`, `description text`, `won_on date not null`
- `project_id uuid references public.projects (id) on delete set null`
- `source_type text not null default 'manual'`, `source_ref jsonb`
- `archived_at timestamptz`
- `created_by uuid references public.profiles (id) on delete set null`, `updated_by` the same
- `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`
- `constraint wins_title_check check (btrim(title) <> '')`
- `constraint wins_source_type_check check (source_type in ('manual'))`
- Indexes: `wins_company_won_idx (company_id, won_on desc)`, `wins_project_id_idx (project_id)`,
  `wins_created_by_idx (created_by)`, `wins_updated_by_idx (updated_by)`.
- No `team` column (R6).

`public.guard_win()` (plpgsql, security definer, `search_path = ''`), trigger `wins_guard` BEFORE
INSERT OR UPDATE:
- `if auth.uid() is not null then new.source_type := 'manual'; new.source_ref := null; end if;`
- on UPDATE `new.company_id := old.company_id;`
- when `new.project_id is not null` and that project's `company_id is distinct from new.company_id`,
  raise `'That project belongs to another company.'`.
- return new. Revoke execute from public, anon, authenticated.

Also `wins_stamp_actor` (BEFORE INSERT OR UPDATE -> `public.stamp_actor()` from 0026) and
`wins_set_updated_at` (BEFORE UPDATE -> `public.set_updated_at()`). Do not redefine `stamp_actor`.

RLS on; `revoke all on public.wins from anon, authenticated; grant select, insert, update on public.wins to authenticated;`
Policies (drop if exists, then create): `"Members read wins"` select using
`(private.is_company_member(company_id))`; `"Admins create wins"` insert with check
`(private.can_manage_company(company_id))`; `"Admins update wins"` update using and with check
`(private.can_manage_company(company_id))`. No delete.

#### SQL tests first: `supabase/tests/0027_wins.test.sql`

Setup as system: `kingdom_admin`, `kingdom_employee`, `klasik_admin`, `rococo_admin`; one Kingdom
project and one Klasik project inserted as system.
1. `browser_write_forced_manual`: act as `kingdom_admin`; insert a win with
   `source_ref = '{"from": "elsewhere"}'`; stored `source_type = 'manual'`, `source_ref is null`.
2. `browser_update_cannot_set_provenance`: as `kingdom_admin`, update that win's `source_ref`; it stays null.
3. `system_write_keeps_ref`: as system, insert with `source_ref = '{"from": "test"}'`; it is kept.
4. `member_reads`: as `kingdom_employee`, the Kingdom win count is at least 1.
5. `member_write_refused`: as `kingdom_employee`, insert raises `'%row-level security%'`; an update
   affects 0 rows.
6. `other_company_refused`: as `klasik_admin`, Kingdom wins count is 0 and inserting with Kingdom's
   `company_id` raises `'%row-level security%'`.
7. `project_other_company_rejected`: as `kingdom_admin`, a win with the Klasik project raises
   `'%That project belongs to another company.%'`.
8. `company_pinned`: as `kingdom_admin`, setting `company_id` to Klasik leaves it Kingdom.
9. `no_delete`: as `kingdom_admin`, delete raises `'%permission denied%'`.
10. `actor_stamped`: `created_by` is the inserting admin's profile id.
11. `title_required`: blank title raises `'%wins_title_check%'`.

#### TypeScript types (`src/types/database.ts`, exact)

```ts
export type WinSourceType = "manual";
export const WIN_SOURCE_LABELS: Record<WinSourceType, string> = { manual: "Manual" };
export interface Win {
  id: string; company_id: string; title: string; description: string | null; won_on: string;
  project_id: string | null; source_type: WinSourceType; source_ref: Record<string, unknown> | null;
  archived_at: string | null; created_by: string | null; updated_by: string | null;
  created_at: string; updated_at: string;
}
```

#### `src/services/wins.ts` (exact signatures) and mock

```ts
export async function listWins(companyId: string, opts?: { includeArchived?: boolean; limit?: number }): Promise<Win[]>; // won_on desc, created_at desc
export async function createWin(input: { company_id: string; title: string; won_on: string; description?: string | null; project_id?: string | null }): Promise<Win>;
export type WinPatch = Partial<Pick<Win, "title" | "description" | "won_on" | "project_id">>;
export async function updateWin(id: string, patch: WinPatch): Promise<Win>;
export async function archiveWin(id: string): Promise<Win>;
```
`COLUMNS = "id, company_id, title, description, won_on, project_id, source_type, source_ref, archived_at, created_by, updated_by, created_at, updated_at"`.
`listWins`: `.eq("company_id")`, `.is("archived_at", null)` unless `includeArchived`, order `won_on`
desc then `created_at` desc, `.limit(limit)` when given. `archiveWin` sets `archived_at` to now. The
service never sends `source_type` or `source_ref`. Header comment: manual wins, members read and
admins write (0027); the database forces browser writes to manual.

`src/test/mocks/wins.ts` (opening why-comment): identical exports over
`fromAll((b) => b.wins).map((x) => ({ ...x }))`, same filter, sort and limit; `createWin` sets
`source_type: "manual"`, `source_ref: null`, id `win-new-<n>`; missing id throws `"Win not found."`.

#### Fixtures (Kingdom only)

Seven wins, ids `p("win-1")` .. `p("win-7")` (`kingdom-win-1` ..), `source_type: "manual"`,
`source_ref: null`, `description: null` except win 1 ("Illustrative sample win."),
`created_by: profiles[0].id`, timestamps `EARLIER`:
"Sample win 1" `2026-09-12`; "Sample win 2" `2026-09-05`; "Sample win 3" `2026-08-28`; "Sample win 4"
`2026-08-20` with `project: 0` (`kingdom-project-1`); "Sample win 5" `2026-08-11` archived
(`archived_at: EARLIER`); "Sample win 6" `2026-07-30`; "Sample win 7" `2026-07-15`.
The five most recent non-archived are wins 1, 2, 3, 4, 6. Klasik and RBA get `wins: []`.

#### `src/lib/attention.ts` (pure) and tests first

```ts
export type AttentionKind = "not_signed_in" | "cycle_overdue" | "campaign_no_budget" | "connection_error" | "sync_failed" | "sync_stale";
export interface AttentionItem { kind: AttentionKind; title: string; detail: string; to: string; severity: "warning" | "danger" }
export interface AttentionInput {
  people: Profile[]; cycles: ReviewCycle[]; campaigns: MarketingCampaign[]; connections: CompanyConnection[];
  today: string; // YYYY-MM-DD
}
export function attentionItems(input: AttentionInput): AttentionItem[];
```
(`AttentionKind` already names the two sync kinds; Task 8 adds `sources?` and `now?` to the input and
produces them. This task never produces them.)

Rules, no invented thresholds:
- `not_signed_in`: one item when any `is_active` person has `!hasAccount(person)`
  (`src/lib/people.ts`); title "People not signed in"; detail `"1 person has not signed in yet."` or
  `"<n> people have not signed in yet."`; to `/people`; severity `warning`.
- `cycle_overdue`: each cycle with `status === "open"` and `period_end < today` (string compare of
  `YYYY-MM-DD`); title `"<cycle name> is still open"`; detail
  `"Its period ended <formatDate(period_end)>. Close it when the reviews are done."`; to
  `cyclePath(cycle)` (`src/lib/gsr/cycles.ts`); severity `warning`.
- `campaign_no_budget`: each campaign with status `active` or `paused` and `budget === null`; title
  `"<name> has no budget"`; detail "Set a budget so spend can be read against it."; to `/marketing`;
  severity `warning`.
- `connection_error`: each connection with `status === "error"`; title
  `"<CONNECTION_PROVIDER_LABELS[provider]> needs reconnecting"`; detail `last_error` or "The
  connection reported an error. Reconnect it in Settings."; to `/settings`; severity `danger`.
- Order: all `danger` items first, then `warning`; within a severity, the order above (people,
  cycles in input order, campaigns in input order, connections in input order).

`src/lib/attention.test.ts` (small factories; `today: "2026-09-15"`):
1. Nothing wrong gives `[]`.
2. Two active people without accounts and one inactive without gives one item with detail
   `"2 people have not signed in yet."`; one gives `"1 person has not signed in yet."`.
3. An open cycle ending `2026-09-14` gives `"<name> is still open"`, detail
   `"Its period ended Sep 14, 2026. Close it when the reviews are done."`, `to` from `cyclePath`
   (a monthly cycle's path starts `/gsr/cycles/`, a quarterly one's `/reviews/cycles/`); an open
   cycle ending `2026-09-15` and a closed cycle ending in the past give nothing.
4. Active and paused campaigns with `budget: null` each give an item; a planned one with null budget
   and an active one with `budget: 0` give nothing.
5. A connection in `error` with `last_error: "Token expired"` gives detail "Token expired"; without
   `last_error` the fallback line; a `connected` one gives nothing.
6. Mixed input: the connection item comes first, then people, cycle, campaign.
7. No title or detail contains an em dash.

#### Components

`AttentionCard` (`src/components/home/AttentionCard.tsx`, props `{ company: Company }`): `useAsync`
over `Promise.all([listCompanyProfiles(company.id), listCycles(company.id), listCampaigns(company.id), listConnections(company.id)])`,
then `attentionItems({ ..., today: todayIso() })`. `Section` eyebrow "Attention", title "Needs
attention". Loading `SkeletonRows rows={3}`; error `Notice tone="error"`. Each item: a row with
`<Badge tone={severity}>` reading "Check" for warning and "Fix" for danger, the title (medium), the
detail (`text-ink-2`), and a `Link` to `item.to` reading "Open" with `aria-label` `Open: <title>`.
Empty: "Nothing needs attention right now."

`WinsCard` (`src/components/home/WinsCard.tsx`, props `{ companyId: string }`): `listWins(companyId, { limit: 5 })`
(non-archived by default). `Section` eyebrow "Wins", title "Recent wins", actions a `Link` "All
wins" to `/wins`. Rows: title, `formatDate(won_on)`, `<Badge tone="neutral">{WIN_SOURCE_LABELS[source_type]}</Badge>`.
Empty: "No wins recorded yet." Loading `SkeletonRows rows={3}`.

`ShortcutsCard` (`src/components/home/ShortcutsCard.tsx`, props
`{ company: Company; isAdmin: boolean; isRococo: boolean }`): `sectionShortcuts(navFor(company, isAdmin, isRococo))`;
returns null when empty. `Section` eyebrow "Shortcuts", title "Sections"; each entry a `Link` to
`to` reading the heading with an `ArrowRight` icon. No data loading. (Task 9 adds external links.)

#### `src/pages/WinsPage.tsx` (default export, no props, `/wins`)

`PageHeader` eyebrow company name, title "Wins", description "Wins the team records by hand, newest
first."; admins get the primary action "New win". Data: `useAsync` over `listWins(companyId)` and,
only when `hasModule(company, "production")`, `listProjects(companyId)` (otherwise `[]`); deps
`[companyId]`. Loading `SkeletonRows rows={6}`; error `Notice`.
A `Section padded={false}` list, hairline-divided. Admin rows: `BlurInput` `Title of <title>`
(required), `BlurInput type="date"` `Won on for <title>` (required: an empty draft restores),
`BlurInput multiline rows={2}` `Description of <title>` (empty saves null), and, when projects are
loaded, a select `Project for <title>` with "No project" plus the projects; each save calls
`updateWin` and replaces the row. A `Badge tone="neutral"` "Manual" on every row. `IconButton`
`Archive <title>` opens `ConfirmDialog` (title "Archive this win?", body "It leaves this list and
the Home card. It is kept, not deleted.", confirm "Archive", `tone="primary"`), then `archiveWin`
and drop the row. Member rows: title, date, project name if any, description, "Manual" badge; no
controls. Empty: `EmptyState` eyebrow "Wins", title "No wins yet", body for admins "Record a win by
hand. It shows here and on Home." and for members "Wins your team records show here."
New win: `Modal` (`labelledBy="new-win-title"`, heading "New win") with `Field`s Title (required),
Won on (`type="date"`, default `todayIso()`), Description (textarea), Project (select, only when
projects are loaded); buttons "Cancel" and "Add win"; validation `Notice`s "Give the win a title." and
"Pick the date it was won."; success inserts the row in `won_on` desc order and closes.

#### DashboardPage placement

- `AdminDashboard`: directly after the Stat row `<div>` (the one starting at line 227 today) and
  before the existing `mt-6` grid, when `hasModule(company, "switchboard") || hasModule(company, "wins")`,
  render `<div className="mt-6 grid gap-6 lg:grid-cols-3">`: under `switchboard`,
  `<div className="lg:col-span-2"><AttentionCard company={company!} /></div>`; then a right column
  `<div className="space-y-6">` holding `ShortcutsCard` (under `switchboard`, with `isAdmin` and
  `isRococo` from `useHub()`) and `WinsCard` (under `wins`). With neither module on, nothing renders
  and none of the three cards mounts, so no extra service call is made.
- `EmployeeDashboard`: directly after its `PageHeader` (line 480 today), when `wins` or `switchboard`
  is on, `<div className="mb-6 grid gap-6 lg:grid-cols-2">` with `WinsCard` (wins) and
  `ShortcutsCard` (switchboard). Employees never get AttentionCard.
- Nothing else on the page changes (the Task 2 "Home" title stays).

#### Page tests (`src/pages/pages.test.tsx`; read-only first, mutations after)

`describe("home cards")`:
1. Kingdom admin `DashboardPage`: heading "Home"; "Needs attention" with "People not signed in" and
   "1 person has not signed in yet."; a link "Production" to `/production` and a link "People / HR"
   to `/gsr` in the Shortcuts card (and "Sales & Finance" to `/financials`); "Recent wins" with
   "Sample win 1" and "Sample win 6", and no "Sample win 5" or "Sample win 7"; at least one "Manual".
2. Kingdom employee `DashboardPage`: "Recent wins" and "Sections" present; "Needs attention" absent;
   Shortcuts has "Production" to `/production` and "People / HR" to `/my/gsr`, no "Sales & Finance".
3. Klasik admin and Klasik employee `DashboardPage`: "Needs attention", "Recent wins" and "Sections"
   are all absent (the existing dashboard tests stay green unchanged).

`describe("wins")`:
4. WinsPage, Kingdom employee: heading "Wins"; text "Sample win 1"; "Sample job 101" shown on Sample
   win 4; no "New win" button, no textbox, no "Archive" buttons; "Sample win 5" absent.
5. WinsPage, Kingdom admin: input with value "Sample win 1"; "Manual" badges; select "Project for
   Sample win 4" shows "Sample job 101".
6. Create (Kingdom admin): "New win", Title "Sample win 8", Won on `2026-06-01` (older than the
   Home card's five, so card tests are unaffected), "Add win": an input with value "Sample win 8"
   appears with a "Manual" badge.
7. Edit (Kingdom admin): type in "Description of Sample win 2" and blur; the value persists after the
   update.
8. Archive (Kingdom admin): "Archive Sample win 7", confirm "Archive": "Sample win 7" is gone.

In `src/App.rococo.test.tsx`'s "module routes" table: admin and employee `/wins` land on `/wins` for
`kingdom` and on `/` for `klasik`.

#### Copy strings

"Wins"; "Wins the team records by hand, newest first."; "New win"; "Title"; "Won on";
"Description"; "Project"; "No project"; "Add win"; "Give the win a title."; "Pick the date it was
won."; "Manual"; "Archive this win?"; "It leaves this list and the Home card. It is kept, not
deleted."; "Archive"; "No wins yet"; "Record a win by hand. It shows here and on Home."; "Wins your
team records show here."; "Attention"; "Needs attention"; "Nothing needs attention right now.";
"Check"; "Fix"; "Open"; "People not signed in"; "1 person has not signed in yet."; "<n> people have
not signed in yet."; "<cycle> is still open"; "Its period ended <date>. Close it when the reviews
are done."; "<campaign> has no budget"; "Set a budget so spend can be read against it.";
"<provider> needs reconnecting"; "The connection reported an error. Reconnect it in Settings.";
"Recent wins"; "All wins"; "No wins recorded yet."; "Shortcuts"; "Sections"; database message "That
project belongs to another company.". No em dashes.

#### Design notes

Cards are `Section`s on theme tokens; badges use `Badge` tones (`warning`, `danger`, `neutral`);
skeletons while loading; the accent only on links and the active state; `BlurInput` for every
save-on-blur field; no hex colors.

#### Verification

- `npm run lint`, `npx vitest run`, `npm run build`, `npm run test:sql` (0027 applied twice, all
  files pass).
- `grep -rnP "\x{2014}"` (the em dash character) over the new and changed files prints nothing.
- Visual check: `npm run demo`; Playwright (desktop 1280x900 and phone 390x844,
  `deviceScaleFactor: 1`): `?persona=admin&company=kingdom` (Home) then `/wins`;
  `?persona=employee&company=kingdom` (Home) then `/wins`; `?persona=admin&company=klasik` (Home
  must look exactly as before this task) then `/wins` (lands on Home). PNGs to
  `<scratch>/shots/task-5/`;
  look at each and fix card balance, row wrapping and phone stacking.

#### Must NOT do

- Add a `team` column or field (R6), pull wins from reviews, milestones, Slack or anywhere else, or
  let the browser set `source_type` or `source_ref`.
- Decide a display duration or archival rule: the Home card shows the five most recent non-archived
  wins and nothing else (R16).
- Show external links on ShortcutsCard (Task 9) or sync items in Attention (Task 8).
- Add Attention signals beyond the four listed, or any threshold (age, amount, count) not stated.
- Mount any card, or call any new service, for a company without the module.
- Edit migrations 0001 to 0026 or redefine `stamp_actor`.
- Global Constraint 7: apply anything live or deploy; Supabase MCP read-only.
- Global Constraint 8: only plainly fictional sample wins ("Sample win 1") with illustrative dates.
- Global Constraint 9: no undefined business logic; nothing beyond "the five most recent".
- Global Constraint 10: no write path to imported values.

#### Commits

1. `Wins are recorded by hand, read by members and forced to manual in the database` (0027 and its
   SQL test, types, service, mock, WinsPage, nav, route, fixtures, demo alias, tests).
2. `Home gains Attention, Shortcuts and recent Wins cards under the company's modules`
   (`lib/attention.ts` and test, the three cards, DashboardPage, tests).

Each message ends with the session's standard attribution trailer lines.


### Task 6: Scaffolds and the Sales & Finance pages

#### Goal and fit

Give Kingdom honest "Not configured" places for everything whose definition is still pending: five Production cards (client score, cleanliness, job health, warranty, PM capacity) and two new admin-only pages, Sales & Finance reporting (`/sales-finance`) and Controls (`/sales-finance/controls`). No figure, scale or calculation appears anywhere; each card says what it is waiting on. Klasik and RBA see no change.

Builds on:
- Task 2: `hasModule(company, key)` in `src/lib/modules.ts` (the only reader of `companies.modules`); the exported `ModuleOnly({ module, children })` route guard and the existing `AdminOnly` in `src/App.tsx`; the `NAV_ITEMS` registry, `navFor(company, isAdmin, isRococo)` and `sectionShortcuts(layout)` in `src/lib/navigation.ts` with `src/lib/navigation.test.ts`; the `KINGDOM` fixture bundle (all five modules on) exported from `src/test/fixtures.ts`.
- Task 4: `src/pages/production/ProductionPage.tsx` at `/production` (route behind `ModuleOnly module="production"`, members read) and the `projects` nav item.
- Task 5: ShortcutsCard on Home, which points each grouped section at its first item through `sectionShortcuts`.

#### Files

Create:
- `src/components/scaffold/ScaffoldCard.tsx`: the one "Not configured" card. Default export `ScaffoldCard`, props exactly `{ eyebrow: string; title: string; pending: string[]; children?: ReactNode }`.
- `src/pages/salesFinance/salesFinanceTabs.ts`: `export const SALES_FINANCE_TABS: TabItem[] = [{ to: "/sales-finance", label: "Reporting", end: true }, { to: "/sales-finance/controls", label: "Controls" }];` (import `type TabItem` from `../../components/ui/Tabs.tsx`). Opens with a why-comment in the style of `src/pages/gsr/myTabs.ts` (kept out of the page files so each exports only its component, which Fast Refresh relies on).
- `src/pages/salesFinance/SalesFinancePage.tsx`: default export `SalesFinancePage`, no props.
- `src/pages/salesFinance/ControlsPage.tsx`: default export `ControlsPage`, no props.

Modify:
- `src/App.tsx`: import both pages; add two routes next to the `financials` and `marketing` routes (lines 318-319 today; later tasks shift them):
  ```tsx
  <Route path="sales-finance" element={<AdminOnly><ModuleOnly module="data_sources"><SalesFinancePage /></ModuleOnly></AdminOnly>} />
  <Route path="sales-finance/controls" element={<AdminOnly><ModuleOnly module="data_sources"><ControlsPage /></ModuleOnly></AdminOnly>} />
  ```
  `AdminOnly` sits outside, so an employee is sent to `/` before the module check; a company without `data_sources` is sent to `/` by `ModuleOnly`. No existing route moves or is renamed.
- `src/lib/navigation.ts`: insert two items into `NAV_ITEMS` immediately after the `projects` item (Task 4) and before `sops`, so the registry order stays: dashboard, wins, gsr, reviews, goals, my-gsr-employee, my-reviews, my-goals, people, projects, sales-reporting, controls, sops, resources, financials, marketing, my-gsr-admin, settings.
  ```ts
  { id: "sales-reporting", to: "/sales-finance", label: "Reporting", icon: ChartColumn, end: true, audience: "admin", group: "sales_finance", requires: "data_sources" },
  { id: "controls", to: "/sales-finance/controls", label: "Controls", icon: ShieldCheck, audience: "admin", group: "sales_finance", requires: "data_sources" },
  ```
  (`ChartColumn`, `ShieldCheck` from `lucide-react`; both exist in the installed 0.545.) `end: true` on Reporting keeps it from lighting up on `/sales-finance/controls`.
- `src/lib/navigation.test.ts`: update the grouped expectations (see Tests).
- `src/pages/production/ProductionPage.tsx`: below the project list that Task 4 renders, add the five Production scaffold cards (see Behaviour). Define the PM capacity card as its own element (`const pmCapacity = <ScaffoldCard ... />`) because Task 8 wraps it in a source panel for admins.
- `src/pages/pages.test.tsx`: new `describe("scaffolds")` block; add `SalesFinancePage`, `ControlsPage` (and `ProductionPage` if not already imported by Task 4) imports, and `KINGDOM` to the fixtures import if Task 2 did not.
- `src/App.rococo.test.tsx`: add cases 5 to 7 next to the "module routes" table Task 2 created (inside the same describe); add no second describe of that name (this file is the one that renders the real router with every service mocked). Update its opening why-comment to say it also proves module routes redirect. Add no `vi.mock` line (no new service).
- If a Task 5 assertion expects the Sales & Finance shortcut on ShortcutsCard to point at `/financials`, change it to `/sales-finance`: with this task Reporting is the section's first item for admins. The existing assertions this task may change are that one, the Sales & Finance items and shortcut `to` in navigation.test.ts's grouped cases, and nothing else.

#### Behaviour

ScaffoldCard:
- Root element `<section aria-label={title}>` (so tests find it with `getByRole("region", { name: title })`), containing `EmptyState` (`src/components/ui/EmptyState.tsx`, props `eyebrow`, `title`, `body`, `action`) with `eyebrow={eyebrow}`, `title={title}`, `body="Not configured yet."`, and `action` = a vertical stack (`flex flex-col items-center gap-3`) of `<Badge tone="neutral">Not configured</Badge>` and the pending list, then `{children}` below the EmptyState.
- Pending list: a `<p className="eyebrow">Waiting on</p>` and a `<ul className="mx-auto max-w-sm space-y-1 text-left text-[12.5px] text-ink-2">`, one `<li>` per `pending` string. No icons, no `ScoreRing`, `ScoreBar`, `Stat`, `RatingInput`, number, colour band or chart. No digits in any string it renders (the caller's strings included).
- Why-comment: the honest placeholder for a module whose definition is pending; it never shows a number, so nobody reads a fake score as real.

Production scaffold cards (ProductionPage, after the project list, in a `mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3`), in this order, each with `eyebrow="Production"`:
| title | pending |
| --- | --- |
| Client score | "How a client score is defined, and its scale", "Who enters it, and for which job or period", "Who may see and edit it" |
| Cleanliness | "How cleanliness is scored, and its scale", "Who records it, and for which job or visit", "Who may see and edit it" |
| Job health | "Which signals make a job healthy or at risk", "Where those signals come from" |
| Warranty | "Where warranty items are tracked today", "What the hub should show about them" |
| PM capacity | "The capacity sheet and the tab to read", "How each project manager is matched to a person on the roster", "How capacity is calculated" |

Members (employees) see the cards too; they are read-only text.

SalesFinancePage (`/sales-finance`):
- `PageHeader eyebrow={company!.name} title="Sales & Finance" description="Sales and financial reporting read from the company's own sources. Nothing here is typed in by hand."`
- `<Tabs items={SALES_FINANCE_TABS} />`
- Two cards in a `grid gap-4 lg:grid-cols-2`, each a separate element constant (Task 8 passes each to a source panel as its fallback):
  - `eyebrow="Sales & Finance" title="Sales reporting"` pending "The spreadsheet and tab that hold sales reporting", "The fields to show, their types and the reporting period".
  - `eyebrow="Sales & Finance" title="Financial reporting"` pending "The spreadsheet, tab or QuickBooks report that holds it", "What each figure means, such as revenue and gross profit", "The reporting period convention".
- A quiet line under the grid: `The manual <Link to="/financials">Financials</Link> and <Link to="/marketing">Marketing</Link> pages sit in this section too.` (links `text-accent hover:underline`).

ControlsPage (`/sales-finance/controls`):
- `PageHeader eyebrow={company!.name} title="Controls" description="Invoice, payment and balance checks from QuickBooks, read-only."`
- `<Tabs items={SALES_FINANCE_TABS} />`
- One element constant: `eyebrow="Sales & Finance" title="QuickBooks controls"` pending "Which controls to show: cash in and out, invoices, payments and collections, outstanding balances", "The fields for each, and what they mean", "Rules such as aging and follow-up, once agreed".

Both pages read `company` from `useHub()`; they load nothing in this task.

#### Navigation results to expect

With Kingdom (all five modules): admin grouped layout Home (Home, Wins), Sales & Finance (Reporting, Controls, Financials, Marketing), Production (Projects), People / HR (GSRs, Reviews, Goals, People, My GSR), then the unlabeled utility group (SOPs, Resources, Settings). Employee: Home (Home, Wins), Production (Projects), People / HR (My GSR, My Reviews, My Goals), utility (SOPs, Resources); no Sales & Finance section. Rococo inside Kingdom: the admin layout minus My GSR. A company with `data_sources` on and `switchboard` off: flat list with Reporting and Controls after People (and after Projects when `production` is on). Klasik (`modules = []`): unchanged item for item.

#### Tests to write first

`src/lib/navigation.test.ts` (extend; keep the flat Klasik equals-today cases untouched):
- Kingdom admin grouped: the `sales_finance` section's item ids are `["sales-reporting", "controls", "financials", "marketing"]`.
- Kingdom employee grouped: no section with group `sales_finance`.
- Rococo inside Kingdom: same sections as the admin, with `my-gsr-admin` absent.
- `{ ...KLASIK.company, modules: ["data_sources"] }`, admin, flat: ids `dashboard, gsr, reviews, goals, people, sales-reporting, controls, sops, resources, financials, marketing, my-gsr-admin, settings`; employee flat: unchanged from today.
- `sectionShortcuts(navFor(KINGDOM.company, true, false))` gives Sales & Finance `to: "/sales-finance"`; for the employee there is no Sales & Finance entry.

`src/pages/pages.test.tsx`, `describe("scaffolds")`. Use a company with the modules on and nothing configured, so later tasks that add sources to Kingdom do not move these assertions:
`const freshAdmin = makeHub("admin", { ...RBA.company, modules: ["production", "data_sources"] });` and `const freshEmployee = makeHub("employee", { ...RBA.company, modules: ["production", "data_sources"] });`. Helper in the test: `async function expectScaffold(name: string) { const region = await screen.findByRole("region", { name }); within(region).getByText("Not configured"); expect(region.textContent).not.toMatch(/\d/); expect(region.querySelector("svg")).toBeNull(); }` and every case awaits it.
1. "shows Sales & Finance reporting as not configured, with no figures": render `<SalesFinancePage />` with `freshAdmin`, `{ path: "/sales-finance", pattern: "/sales-finance" }`. Heading "Sales & Finance"; links "Reporting" and "Controls" inside `getByRole("navigation", { name: "Sections" })` (the Tabs nav) with hrefs `/sales-finance` and `/sales-finance/controls`; `expectScaffold("Sales reporting")`, `expectScaffold("Financial reporting")`; `container.querySelectorAll("input, select, textarea")` has length 0; links "Financials" and "Marketing" present.
2. "shows Controls as not configured": `<ControlsPage />` with `freshAdmin`, path `/sales-finance/controls`; heading "Controls"; `expectScaffold("QuickBooks controls")`.
3. "keeps the Production cards unscored": `<ProductionPage />` with `freshAdmin`, path `/production`: `expectScaffold` for "Client score", "Cleanliness", "Job health", "Warranty", "PM capacity".
4. "shows an employee the same Production cards, read-only": same with `freshEmployee`; the five regions exist (found with `await screen.findByRole("region", { name })` before checking for buttons) and no `button` sits inside any of them.

`src/App.rococo.test.tsx`, next to the "module routes" table Task 2 created, inside the same describe (render `<App />` after `window.history.pushState({}, "", url)`; every case sets `persona` and `company` explicitly):
5. "keeps a company without data sources out of Sales & Finance": `/sales-finance?persona=admin&company=klasik` lands on heading "Dashboard" and `queryByRole("heading", { name: "Sales & Finance" })` is null; same for `/sales-finance/controls?persona=admin&company=klasik`.
6. "sends an employee who types the address back home": `/sales-finance?persona=employee&company=kingdom` lands on a heading matching `/Welcome back/` with no "Sales & Finance" heading; same for `/sales-finance/controls?persona=employee&company=kingdom`.
7. "opens both pages for a Kingdom admin": `/sales-finance?persona=admin&company=kingdom` shows heading "Sales & Finance"; clicking "Controls" inside the "Sections" navigation shows heading "Controls".

Run them red first (the pages and routes do not exist), then implement.

#### Design notes

Theme tokens only (`border-line`, `text-ink-2`, `bg-surface`; never a hex). EmptyState already carries the dashed hairline. Badge `tone="neutral"`. The grid keeps cards dense; do not add icons or colour to scaffolds. Copy has no em dashes and no digits.

#### Verification

- `npm run lint`
- `npx vitest run`
- `npm run build`
- No SQL and no `supabase/functions` change, so no `npm run test:sql` and no Deno check.
- Visual check: `npm run demo` (port 4173), then a Playwright script saved in the plan workspace (`<scratch>/shots/`), never in the repo. Use a fresh browser context per URL (the demo remembers persona in sessionStorage), `deviceScaleFactor: 1`, viewport 1440x900, and repeat the first two at 390x844:
  ```js
  const { chromium } = require("playwright");
  const out = "<scratch>/shots/task6";
  const shots = [
    ["sf-admin-kingdom", "/sales-finance?persona=admin&company=kingdom"],
    ["controls-admin-kingdom", "/sales-finance/controls?persona=admin&company=kingdom"],
    ["production-admin-kingdom", "/production?persona=admin&company=kingdom"],
    ["production-employee-kingdom", "/production?persona=employee&company=kingdom"],
    ["sf-employee-kingdom-redirect", "/sales-finance?persona=employee&company=kingdom"],
    ["home-admin-klasik", "/?persona=admin&company=klasik"],
    ["sf-admin-klasik-redirect", "/sales-finance?persona=admin&company=klasik"],
  ];
  (async () => {
    require("node:fs").mkdirSync(out, { recursive: true });
    const browser = await chromium.launch();
    for (const [name, url] of shots) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      await page.goto("http://localhost:4173" + url);
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
      await context.close();
    }
    await browser.close();
  })();
  ```
  Look at every PNG: the sidebar shows Reporting and Controls under Sales & Finance for the Kingdom admin and not for the employee or Klasik; the two redirect shots show Home and Dashboard; the scaffold grid wraps cleanly at 390 px with no horizontal page scroll. Fix layout defects before committing.

#### Must NOT do

- No table, migration, service, number, scale, average, ranking, colour band, chart or digit in any scaffold; no `ScoreRing`, `ScoreBar`, `Stat` or `RatingInput` in them.
- No sync or source UI (Task 8), no external links (Task 9), no edit controls on any scaffold.
- Do not move, rename or re-point `/financials` or `/marketing`, and do not change anything a company without the modules sees (Global Constraint 2). No branch on a company name, slug or theme key; gate only with `hasModule` and the route guards.
- Global Constraint 7: nothing is applied to the live Supabase project and no function is deployed; Supabase MCP, if used at all, is read-only.
- Global Constraint 8: no live-looking sample data; any fixture text is plainly fictional.
- Global Constraint 9: undefined business logic is never implemented; no financial formulas, capacity math, score math, aging thresholds, escalation rules, milestone statuses or win display rules. Show "Not configured" instead.
- Global Constraint 10: imported values are read-only in the database; nothing here writes or edits imported data, and there is no writeback to Google, QuickBooks or Monday.

#### Commits

1. `Show honest Not configured cards for the pending Production modules`
2. `Add the Sales & Finance reporting and Controls pages for companies with data sources`

Each message ends with the session's standard attribution trailer lines.

---

### Task 7: Sync engine core (database and pure logic)

#### Goal and fit

Build everything a live data source needs except the screens and the Edge Function wiring: migration `0030_sync_engine.sql` (sources, runs, read-only records, the overlap lock, the separate Sync now predicate), the pure shared modules under `supabase/functions/_shared/sync/` that parse, key, schedule and run a sync against injected store and adapter interfaces, and `src/lib/sync/state.ts`, which turns a source into one of six honest UI states. Everything is test-first and hermetic.

Builds on:
- Task 1: the SQL harness (`npm run test:sql` runs `bash supabase/tests/run.sh`; helpers in `supabase/tests/helpers.sql`: `tests.company(slug)`, `tests.create_person(name, company, role default 'employee', rococo default false)`, `tests.id(name)`, `tests.act_as(profile_id)`, `tests.assert(ok, message)`, `tests.assert_raises(sql, like)`, the `tests.fixture(name, id)` table; return to system with `reset role; select set_config('request.jwt.claims', '', true);`; each test file runs in its own transaction that is rolled back).
- Task 3: `private.audit_change()` (0025), an AFTER row trigger function that takes the watched column names as trigger arguments and writes one `public.audit_events` row only when a watched column changes; audit rows are readable by Rococo admins only.
- Task 4: `public.stamp_actor()` (0026): BEFORE INSERT OR UPDATE trigger function that stamps `created_by`/`updated_by` from `private.auth_profile_id()`.
- Existing helpers relied on, never rebuilt: `private.can_manage_company(cid)` and `private.is_company_member(cid)` (0009), `private.auth_profile_id()`, `private.is_rococo_admin()` (0013), `public.set_updated_at()` (0001). `company_connections_provider_check` was created by 0019 as `check (provider in ('gohighlevel', 'quickbooks'))`; 0019 is never edited.

#### Files

Create:
- `supabase/migrations/0030_sync_engine.sql`
- `supabase/tests/0030_sync_engine.test.sql`
- `supabase/functions/_shared/sync/types.ts`, `parse.ts`, `keys.ts`, `schedule.ts`, `runner.ts`, `links.ts`
- `src/lib/sync/state.ts`
- Tests: `src/lib/sync/parse.test.ts`, `src/lib/sync/keys.test.ts`, `src/lib/sync/schedule.test.ts`, `src/lib/sync/runner.test.ts`, `src/lib/sync/links.test.ts`, `src/lib/sync/state.test.ts` (they import the `_shared` modules with paths like `../../../supabase/functions/_shared/sync/parse.ts`).

Modify:
- `src/lib/csv.ts`: delete `normalizeHeader` and its comment (lines 47-56: comment 47-48, function 49-56) and add at the top, after the why-comment: `import { normalizeHeader } from "../../supabase/functions/_shared/sync/parse.ts";` and, below it, `export { normalizeHeader };`. `csvToObjects` keeps calling it. `src/lib/csv.test.ts` and every other caller stay untouched.
- `src/types/database.ts`:
  - near the top (beside the existing `import type { ScoringType }` on line 6): `import type { FieldMapEntry, FieldType, SourceConfig, SyncProvider, TargetModule } from "../../supabase/functions/_shared/sync/types.ts";` and `export type { FieldType, FieldMapEntry, SourceConfig, SheetsSourceConfig, QuickBooksSourceConfig, SyncProvider, TargetModule } from "../../supabase/functions/_shared/sync/types.ts";`
  - line 603: `export type ConnectionProvider = "gohighlevel" | "quickbooks" | "google_sheets";` and `CONNECTION_PROVIDER_LABELS` (lines 604-607, keep its `Record<ConnectionProvider, string>` type) gains `google_sheets: "Google Sheets"`.
  - after `CompanyConnection` (end of file, line 624 today), a new "Data sources" block with exactly:
    ```ts
    export const TARGET_MODULE_LABELS: Record<TargetModule, string> = {
      sales_reporting: "Sales reporting", financial_reporting: "Financial reporting", controls: "Controls", pm_capacity: "PM capacity",
    };
    export const FIELD_TYPE_LABELS: Record<FieldType, string> = { text: "Text", number: "Number", currency: "Currency", percent: "Percent", date: "Date" };
    export type SyncRunStatus = "running" | "succeeded" | "failed" | "abandoned";
    export type SyncTrigger = "schedule" | "manual";
    export interface SyncSource {
      id: string; company_id: string; connection_id: string; provider: SyncProvider; name: string;
      target_module: TargetModule; config: SourceConfig; field_map: FieldMapEntry[]; record_key: string[];
      sync_weekday: number | null; sync_time: string | null; sync_timezone: string | null;
      stale_after_hours: number | null; enabled: boolean; current_run_id: string | null;
      last_attempt_at: string | null; last_success_at: string | null; last_status: SyncRunStatus | null;
      last_error: string | null; sync_requested_at: string | null;
      created_by: string | null; updated_by: string | null; created_at: string; updated_at: string;
    }
    export interface SyncRun {
      id: string; company_id: string; source_id: string; connection_id: string; trigger_kind: SyncTrigger;
      requested_by: string | null; status: SyncRunStatus; started_at: string; finished_at: string | null;
      rows_read: number; rows_applied: number; rows_blank: number; error_detail: unknown | null;
    }
    export interface SyncRecord {
      id: string; company_id: string; source_id: string; run_id: string; record_key: string;
      data: Record<string, string | number | null>; source_ref: Record<string, unknown>; created_at: string;
    }
    ```
    (Format it one field per line like the rest of the file.) `SyncSource` must stay structurally assignable to `SyncSourceSpec` (types.ts); a test proves it.
- `src/components/settings/ConnectionsPanel.tsx`: props become `{ companyId: string; providers?: ConnectionProvider[] }` with default `DEFAULT_PROVIDERS` (a module-level, non-exported `const DEFAULT_PROVIDERS: ConnectionProvider[] = ["gohighlevel", "quickbooks"];`); line 72 maps `providers` instead of `keysOf(CONNECTION_PROVIDER_LABELS)` (drop `keysOf` from the line 16 import if unused); `PROVIDER_BLURBS` (lines 20-23) gains `google_sheets: "Reporting tabs from the company's own spreadsheets, read-only, refreshed on a schedule."`. With the default, no Google row appears anywhere yet; Task 10 passes the list from the Settings page under `data_sources`.
- `src/pages/pages.test.tsx`: one new case in `describe("connections")` (below).

#### Migration `0030_sync_engine.sql`

Header comment: what it adds and why imported values are read-only; "Paste after 0027; idempotent." Object list, in file order:

1. Provider check: `alter table public.company_connections drop constraint if exists company_connections_provider_check;` then `alter table public.company_connections add constraint company_connections_provider_check check (provider in ('gohighlevel', 'quickbooks', 'google_sheets'));`.
2. `private.can_sync_source(cid uuid) returns boolean language sql stable security definer set search_path = public as $$ select private.can_manage_company(cid) $$;` then `revoke all on function private.can_sync_source(uuid) from public, anon;` and `grant execute on function private.can_sync_source(uuid) to authenticated, service_role;`. Comment: it is the only predicate behind Sync now, kept apart from the view policy so the capability matrix can change who syncs without changing who views.
3. `create table if not exists public.sync_sources`:
   - `id uuid primary key default gen_random_uuid()`
   - `company_id uuid not null references public.companies (id) on delete cascade`
   - `connection_id uuid not null references public.company_connections (id) on delete cascade`
   - `provider text not null`, `name text not null`, `target_module text not null`
   - `config jsonb not null default '{}'::jsonb`, `field_map jsonb not null default '[]'::jsonb`, `record_key text[] not null default '{}'`
   - `sync_weekday smallint`, `sync_time time`, `sync_timezone text`, `stale_after_hours integer`
   - `enabled boolean not null default false`
   - `current_run_id uuid` (FK added in step 5)
   - `last_attempt_at timestamptz`, `last_success_at timestamptz`, `last_status text`, `last_error text`, `sync_requested_at timestamptz`
   - `created_by uuid references public.profiles (id) on delete set null`, `updated_by uuid references public.profiles (id) on delete set null`
   - `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`
   - constraints: `sync_sources_provider_check check (provider in ('google_sheets', 'quickbooks'))`, `sync_sources_target_module_check check (target_module in ('sales_reporting', 'financial_reporting', 'controls', 'pm_capacity'))`, `sync_sources_name_check check (btrim(name) <> '')`, `sync_sources_config_check check (jsonb_typeof(config) = 'object')`, `sync_sources_field_map_check check (jsonb_typeof(field_map) = 'array')`, `sync_sources_weekday_check check (sync_weekday between 0 and 6)`, `sync_sources_schedule_check check ((sync_weekday is null) = (sync_time is null) and (sync_time is null) = (sync_timezone is null))`, `sync_sources_stale_check check (stale_after_hours is null or stale_after_hours > 0)`, `sync_sources_last_status_check check (last_status is null or last_status in ('running', 'succeeded', 'failed', 'abandoned'))`.
4. `create table if not exists public.sync_runs`: `id uuid primary key default gen_random_uuid()`, `company_id uuid not null references public.companies (id) on delete cascade`, `source_id uuid not null references public.sync_sources (id) on delete cascade`, `connection_id uuid not null references public.company_connections (id) on delete cascade`, `trigger_kind text not null`, `requested_by uuid references public.profiles (id) on delete set null`, `status text not null default 'running'`, `started_at timestamptz not null default now()`, `finished_at timestamptz`, `rows_read integer not null default 0`, `rows_applied integer not null default 0`, `rows_blank integer not null default 0`, `error_detail jsonb`; constraints `sync_runs_trigger_kind_check check (trigger_kind in ('schedule', 'manual'))`, `sync_runs_status_check check (status in ('running', 'succeeded', 'failed', 'abandoned'))`.
5. Pointer FK, idempotent: `do $$ begin if not exists (select 1 from pg_constraint where conname = 'sync_sources_current_run_id_fkey') then alter table public.sync_sources add constraint sync_sources_current_run_id_fkey foreign key (current_run_id) references public.sync_runs (id) on delete set null; end if; end $$;`
6. `create table if not exists public.sync_records`: `id uuid primary key default gen_random_uuid()`, `company_id uuid not null references public.companies (id) on delete cascade`, `source_id uuid not null references public.sync_sources (id) on delete cascade`, `run_id uuid not null references public.sync_runs (id) on delete cascade`, `record_key text not null`, `data jsonb not null`, `source_ref jsonb not null default '{}'::jsonb`, `created_at timestamptz not null default now()`; constraint `sync_records_run_key_key unique (run_id, record_key)`.
7. Indexes (all `create index if not exists`): `sync_sources_company_id_idx (company_id)`, `sync_sources_connection_id_idx (connection_id)`, `sync_sources_current_run_id_idx (current_run_id)`, `sync_sources_created_by_idx (created_by)`, `sync_sources_updated_by_idx (updated_by)`; `sync_runs_company_id_idx (company_id)`, `sync_runs_source_started_idx (source_id, started_at desc)`, `sync_runs_connection_id_idx (connection_id)`, `sync_runs_requested_by_idx (requested_by)`; the lock `create unique index if not exists sync_runs_one_running_per_connection on public.sync_runs (connection_id) where status = 'running';` (per connection, so a token refresh never runs twice at once); `sync_records_source_run_idx (source_id, run_id)`, `sync_records_company_id_idx (company_id)`. (`sync_records.run_id` is covered by the unique `(run_id, record_key)` index.)
8. `public.inherit_from_sync_source()` (plpgsql, `security definer`, `set search_path = ''`, pattern of `public.inherit_from_job_role()` in 0018 lines 157-171):
   ```sql
   declare src record;
   begin
     select s.company_id, s.connection_id into src from public.sync_sources s where s.id = new.source_id;
     if not found then raise exception 'That source does not exist.'; end if;
     new.company_id := src.company_id;
     if tg_table_name = 'sync_runs' then
       new.connection_id := src.connection_id;
     elsif not exists (select 1 from public.sync_runs r where r.id = new.run_id and r.source_id = new.source_id) then
       raise exception 'That run belongs to another source.';
     end if;
     return new;
   end;
   ```
   `revoke execute on function public.inherit_from_sync_source() from public, anon, authenticated;`. Triggers (drop if exists, then create): `sync_runs_inherit` BEFORE INSERT ON `public.sync_runs`, `sync_records_inherit` BEFORE INSERT ON `public.sync_records`.
9. `public.guard_sync_source()` (plpgsql, `security definer`, `set search_path = ''`), trigger `sync_sources_guard` BEFORE INSERT OR UPDATE ON `public.sync_sources`:
   ```sql
   declare conn record;
   begin
     if tg_op = 'UPDATE' then new.company_id := old.company_id; end if;
     select c.company_id, c.provider into conn from public.company_connections c where c.id = new.connection_id;
     if not found or conn.company_id is distinct from new.company_id or conn.provider is distinct from new.provider then
       raise exception 'That connection belongs to another company or provider.';
     end if;
     if new.sync_timezone is not null then
       begin
         perform now() at time zone new.sync_timezone;
       exception when others then
         raise exception 'That time zone is not recognized.';
       end;
     end if;
     if auth.uid() is not null then
       if tg_op = 'INSERT' then
         if new.current_run_id is not null or new.last_attempt_at is not null or new.last_success_at is not null
            or new.last_status is not null or new.last_error is not null then
           raise exception 'Sync results are written by the sync, not edited here.';
         end if;
       else
         if new.current_run_id is distinct from old.current_run_id or new.last_attempt_at is distinct from old.last_attempt_at
            or new.last_success_at is distinct from old.last_success_at or new.last_status is distinct from old.last_status
            or new.last_error is distinct from old.last_error then
           raise exception 'Sync results are written by the sync, not edited here.';
         end if;
         if not private.can_manage_company(old.company_id)
            and (to_jsonb(new) - '{sync_requested_at,updated_at,updated_by}'::text[])
                is distinct from (to_jsonb(old) - '{sync_requested_at,updated_at,updated_by}'::text[]) then
           raise exception 'You can request a sync but not change the source.';
         end if;
       end if;
     end if;
     return new;
   end;
   ```
   It is correct whichever order `sync_sources_set_updated_at` and `sync_sources_stamp_actor` fire in (BEFORE triggers fire in name order; the excluded keys cover what they change). The service role (no `auth.uid()`) writes the result columns. Revoke execute from public, anon, authenticated.
10. Triggers on `public.sync_sources` (drop if exists, then create): `sync_sources_guard` (above); `sync_sources_stamp_actor` BEFORE INSERT OR UPDATE -> `public.stamp_actor()`; `sync_sources_set_updated_at` BEFORE UPDATE -> `public.set_updated_at()`; `sync_sources_audit` AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW -> `private.audit_change('provider', 'connection_id', 'name', 'target_module', 'config', 'field_map', 'record_key', 'sync_weekday', 'sync_time', 'sync_timezone', 'stale_after_hours', 'enabled')` (configuration only; `sync_requested_at` and the result columns are not watched).
11. RLS, grants and policies:
    - `alter table public.sync_sources enable row level security;` (same for `sync_runs`, `sync_records`; explicit, never relying on any auto-enable trigger).
    - `revoke all on public.sync_sources, public.sync_runs, public.sync_records from anon, authenticated;` then `grant select, insert, update on public.sync_sources to authenticated;` and `grant select on public.sync_runs, public.sync_records to authenticated;` and `grant select, insert, update, delete on public.sync_sources, public.sync_runs, public.sync_records to service_role;` (the `connections` function's service role is the only writer of runs and records).
    - Policies (each `drop policy if exists` then `create policy`):
      - `"Admins read sync sources"` on `sync_sources` for select to authenticated using `(private.can_manage_company(company_id))`.
      - `"Admins create sync sources"` for insert to authenticated with check `(private.can_manage_company(company_id))`.
      - `"Admins and syncers update sync sources"` for update to authenticated using `(private.can_manage_company(company_id) or private.can_sync_source(company_id))` with check the same expression.
      - No delete policy and no delete grant on `sync_sources` (a source is disabled, never deleted from the browser).
      - `"Admins read sync runs"` on `sync_runs` for select to authenticated using `(private.can_manage_company(company_id))`.
      - `"Admins read sync records"` on `sync_records` for select to authenticated using `(private.can_manage_company(company_id))`.
      - No insert, update or delete policy on `sync_runs` or `sync_records` (Global Constraint 10).
- No `external_people` table (R4). No seed rows, no row naming a company.
- Idempotency: `if not exists` on tables and indexes, `create or replace` on functions, `drop ... if exists` before every trigger, policy and the provider constraint, the `pg_constraint` check around the pointer FK, re-runnable grants. The harness applies every file from 0024 up twice.

#### SQL tests to write first: `supabase/tests/0030_sync_engine.test.sql`

Setup as system: `tests.create_person('k_admin', tests.company('kingdom'), 'admin')`, `('k_emp', kingdom)`, `('l_admin', tests.company('klasik'), 'admin')`, `('rococo', null, 'employee', true)`; insert `company_connections` rows (system) for Kingdom `google_sheets` (status `connected`), Kingdom `quickbooks` (`not_connected`) and Klasik `google_sheets` (`connected`), recording their ids in `tests.fixture` as `k_sheets`, `k_qbo`, `l_sheets`. A minimal valid source body for inserts: provider `google_sheets`, name `Sample sales tab`, target_module `sales_reporting`, config `'{"spreadsheet_id":"sample-sheet","sheet_gid":0,"range":null,"header_row":1}'`, field_map `'[{"header":"Job","key":"job","label":"Job","type":"text","unit":null,"required":true}]'`, record_key `'{job}'`. Each case is a commented block (`-- case: <name>`) of DO blocks calling `tests.assert` / `tests.assert_raises`, acting through `tests.act_as(tests.id(...))` and returning to system between cases.
1. `provider_check_accepts_google_sheets`: the setup inserts succeed; inserting provider `dropbox` raises like `%company_connections_provider_check%`; `pg_constraint` holds exactly one `company_connections_provider_check` and its definition mentions `google_sheets`.
2. `can_sync_source_matches_can_manage`: as k_admin, `private.can_sync_source(kingdom)` is true and `(klasik)` false; as k_emp false; as l_admin false for Kingdom; as rococo true.
3. `admin_creates_source`: as k_admin the insert succeeds; `created_by` equals k_admin's profile id; `enabled` is false; `company_id` is Kingdom.
4. `employee_cannot_create_source`: as k_emp the insert raises like `%row-level security%`.
5. `other_company_admin_sees_nothing`: as l_admin, `select count(*)` of Kingdom sources is 0; inserting a Kingdom source raises like `%row-level security%`.
6. `connection_must_match_company_and_provider`: as k_admin, a Kingdom source on `l_sheets` raises `That connection belongs to another company or provider.`; a `quickbooks` source on `k_sheets` raises the same.
7. `invalid_timezone_rejected`: schedule `(1, '07:00', 'Mars/Olympus')` raises `That time zone is not recognized.`; `(1, '07:00', 'America/Chicago')` succeeds.
8. `schedule_all_or_nothing`: `sync_weekday = 1` with null time raises like `%sync_sources_schedule_check%`; `stale_after_hours = 0` raises like `%sync_sources_stale_check%`.
9. `browser_cannot_write_results`: as k_admin, insert with `last_success_at = now()` raises `Sync results are written by the sync, not edited here.`; update `set last_status = 'succeeded'` raises the same; update `set current_run_id = <a run id>` raises the same; update `set sync_requested_at = now()` affects one row (`get diagnostics ... row_count`).
10. `company_id_pinned`: as k_admin, `update ... set company_id = klasik` leaves `company_id` Kingdom.
11. `no_delete_from_browser`: as k_admin, `delete from public.sync_sources` raises like `%permission denied%`.
12. `inherit_sets_company_and_connection`: as system, insert a `sync_runs` row for the Kingdom source with `company_id = klasik` and `connection_id = l_sheets`: it lands with Kingdom and `k_sheets`; a `sync_records` row with `company_id = klasik` lands with Kingdom; a record whose `run_id` belongs to another source raises `That run belongs to another source.`; a run for a missing source raises `That source does not exist.`.
13. `one_running_run_per_connection`: as system, a second `running` run on `k_sheets` (for a second Kingdom sheets source) raises like `%sync_runs_one_running_per_connection%`; after the first is set to `succeeded`, the insert succeeds.
14. `runs_and_records_are_read_only`: as k_admin, reading the run and record returns one row each; `insert into public.sync_runs`, `update public.sync_records set data = '{}'` and `delete from public.sync_records` each raise like `%permission denied%`. As k_emp, `sync_sources`, `sync_runs` and `sync_records` each count 0 rows. As l_admin, 0 Kingdom rows in each.
15. `system_writes_results`: as system, `update ... set last_status = 'failed', last_error = 'Sample error', last_attempt_at = now()` succeeds.
16. `pointer_cleared_when_run_deleted`: as system, set `current_run_id` to a run, delete that run: `current_run_id` is null.
17. `audit_on_config_change`: as k_admin update `name`; as system, exactly one new `audit_events` row with `table_name = 'sync_sources'`, `action = 'update'` and `changed ? 'name'`; as k_admin update only `sync_requested_at`; no further row.
18. `syncer_only_may_request` (last in the file; it redefines objects inside the rolled-back transaction to simulate the later capability split): as system, `create or replace function private.can_sync_source(cid uuid) ... select private.is_company_member(cid)` and `create policy "tests syncers read" on public.sync_sources for select to authenticated using (private.can_sync_source(company_id));`. As k_emp: `update ... set sync_requested_at = now()` affects one row; `update ... set name = 'Changed'` raises `You can request a sync but not change the source.`; `update ... set last_status = 'failed'` raises `Sync results are written by the sync, not edited here.`.

#### Shared modules (`supabase/functions/_shared/sync/`)

Rules for every file: opens with a why-comment; no Deno, npm or `jsr:` imports; `import type` for types; explicit `.ts` import extensions; must pass the app's strict `tsc -b` (they are pulled in through `src`), `eslint .`, and Deno's type check.

`types.ts`, exactly:
```ts
export type FieldType = "text" | "number" | "currency" | "percent" | "date";
export const FIELD_TYPES: readonly FieldType[] = ["text", "number", "currency", "percent", "date"];
export type SyncProvider = "google_sheets" | "quickbooks";
export type TargetModule = "sales_reporting" | "financial_reporting" | "controls" | "pm_capacity";
export interface FieldMapEntry { header: string; key: string; label: string; type: FieldType; unit: string | null; required: boolean }
export interface SheetsSourceConfig { spreadsheet_id: string; sheet_gid: number; range: string | null; header_row: number } // header_row 1-based
export interface QuickBooksSourceConfig { entity: "Invoice" | "Payment" }
export type SourceConfig = SheetsSourceConfig | QuickBooksSourceConfig;
export interface SyncSourceSpec {
  id: string; company_id: string; connection_id: string; provider: SyncProvider; config: SourceConfig;
  field_map: FieldMapEntry[]; record_key: string[]; enabled: boolean;
  sync_weekday: number | null; sync_time: string | null; sync_timezone: string | null;
  current_run_id: string | null; last_attempt_at: string | null; last_success_at: string | null;
}
export type CellValue = string | number | boolean | null;
export type ParsedValue = string | number | null;            // dates are "YYYY-MM-DD" strings
export interface RawRow { cells: CellValue[]; ref: Record<string, unknown> }
export interface RawTable { headers: CellValue[]; rows: RawRow[] }
export interface ParsedRow { key: string; data: Record<string, ParsedValue>; source_ref: Record<string, unknown> }
export type ValidationCode = "missing_header" | "wrong_type" | "required_blank" | "duplicate_key" | "bad_config";
export interface ValidationError { code: ValidationCode; message: string; row: number | null; field: string | null }
export type MapResult =
  | { ok: true; rows: ParsedRow[]; rowsRead: number; rowsBlank: number }
  | { ok: false; errors: ValidationError[]; rowsRead: number; rowsBlank: number };
export interface ProviderTokens { accessToken: string; refreshToken: string | null; accessExpiresAt: string | null; refreshExpiresAt: string | null }
export interface TokenStore { load(connectionId: string): Promise<ProviderTokens>; save(connectionId: string, tokens: ProviderTokens): Promise<void> }
export interface ConnectionRef { id: string; external_account_id: string | null }
export interface ProviderAdapter { provider: SyncProvider; read(source: SyncSourceSpec, connection: ConnectionRef): Promise<RawTable> }
export type AdapterRegistry = Partial<Record<SyncProvider, ProviderAdapter>>;
```

`parse.ts`:
- `export function normalizeHeader(header: string): string` moved verbatim from `src/lib/csv.ts` lines 47-56 (comment 47-48, function 49-56) (lowercase, drop parenthesised text, non-alphanumerics to `_`, trim underscores), comment included.
- `export const SHEETS_SERIAL_EPOCH = 25569;`
- `export function serialToIsoDate(serial: number): string`: `new Date((serial - SHEETS_SERIAL_EPOCH) * 86400000).toISOString().slice(0, 10)` (UTC; a fractional time of day never moves the date).
- `export function isBlankCell(cell: CellValue | undefined): boolean`: true for `undefined`, `null`, `""` or a whitespace-only string; false for `0`, `false` and any other value.
- `export type CellParse = { ok: true; value: ParsedValue } | { ok: false; message: string };`
- `export function parseCell(cell: CellValue | undefined, type: FieldType): CellParse`: blank is `{ ok: true, value: null }` for every type. `text`: trimmed string; numbers and booleans become `String(cell)`. `number`, `currency`, `percent`: only a finite JS number passes (percent stays a fraction, 0.25 is 25%); any string or boolean fails with `Expected a number but found "<cell>".` `date`: a finite number is a serial (`serialToIsoDate`); a string must match `^\d{4}-\d{2}-\d{2}$` after trimming and is returned trimmed; anything else fails with `Expected a date but found "<cell>".` Never coerce text to a number and never turn blank into 0 (R11).
- `export function mapRows(table: RawTable, fieldMap: FieldMapEntry[], recordKey: string[]): MapResult`:
  - Config first, `bad_config` errors (row and field null where not applicable): empty `fieldMap` "No fields are mapped."; two entries with the same `key` "Two fields share the key <key>."; a `recordKey` entry that is not a mapped key "The record key names a field that is not mapped: <key>." Any `bad_config` returns at once with `rowsRead: table.rows.length, rowsBlank: 0`.
  - Headers: `normalizeHeader(String(cell ?? ""))` on both sides; the first matching column wins. A missing header for a `required` entry is `missing_header` (`row: null`, `field: entry.key`, message `The column "<entry.header>" is missing.`); a missing optional header reads blank. Any `missing_header` returns at once with `rowsRead: table.rows.length, rowsBlank: 0`.
  - Rows: `rowsRead` counts every row in `table.rows`. Row number for messages and keys: `typeof ref.row === "number" ? ref.row : index + 1`. Short rows read blank. A row whose mapped cells are all blank is skipped and counted in `rowsBlank` (unmapped cells do not matter). Otherwise each mapped cell goes through `parseCell`; a failure is `wrong_type` (`row`, `field: key`, message `Row <n>, <label>: <parse message>`); a null value in a `required` field is `required_blank` (message `Row <n>: <label> is blank.`). The key is `buildRecordKey(data, recordKey, rowNumber)`; null (a blank key field not already reported) is `required_blank` with message `Row <n>: <label> is part of the record key and is blank.`; a key already seen is `duplicate_key` (`field: null`, message `Row <n> repeats the record key of row <m>.`).
  - `data` holds mapped keys only (projection, nothing else ever reaches `sync_records`); `source_ref` is the row's `ref`.
  - Errors stop being collected after 50 (an unexported `const MAX_ERRORS = 50`), but any error fails the whole table (R12).

`keys.ts`:
```ts
// Empty recordKey -> `row:${rowNumber}`. Otherwise JSON.stringify of the key fields' values in
// recordKey order; null when any key field is blank (mapRows reports required_blank).
export function buildRecordKey(data: Record<string, ParsedValue>, recordKey: string[], rowNumber: number): string | null;
```
Blank means `null`, `undefined` or `""`.

`schedule.ts`:
```ts
export interface WeeklySchedule { weekday: number; time: string; timezone: string } // weekday 0 = Sunday .. 6 (JS getDay, PG dow); time "HH:MM" or "HH:MM:SS"; IANA zone
export function scheduleOf(source: Pick<SyncSourceSpec, "sync_weekday" | "sync_time" | "sync_timezone">): WeeklySchedule | null; // null unless all three are set
export function latestSlot(schedule: WeeklySchedule, now: Date): Date;  // latest instant <= now at that local weekday and time
export function isDue(source: Pick<SyncSourceSpec, "enabled" | "sync_weekday" | "sync_time" | "sync_timezone" | "last_attempt_at">, now: Date): boolean;
```
`Intl.DateTimeFormat` only (with `timeZone`, `hourCycle: "h23"`); no date library. Method: read now's local calendar date and weekday in the zone; step back `(localWeekday - weekday + 7) % 7` days (date arithmetic on UTC y/m/d); resolve that local date and time to an instant; if it is after `now`, step back seven more days and resolve again. Resolving a wall time W: take the zone offsets a day before and a day after W; each gives a candidate instant; a candidate is valid when its wall clock in the zone equals W. Two valid candidates (fall-back overlap): the earlier. None valid (spring-forward gap): the first valid instant after the gap, which is the transition instant (find it by binary search between the two candidates to the minute). `isDue` per R13: `enabled`, a schedule, and `last_attempt_at` null or before `latestSlot(schedule, now)`.

`runner.ts`, exactly these exports:
```ts
export const STALE_RUN_MINUTES = 15;
export interface SyncStore {
  abandonStaleRuns(connectionId: string, olderThan: Date): Promise<number>;
  startRun(input: { source: SyncSourceSpec; trigger: "schedule" | "manual"; requestedBy: string | null; now: Date }): Promise<{ runId: string } | { locked: true }>;
  insertRecords(runId: string, source: SyncSourceSpec, rows: ParsedRow[]): Promise<void>;
  markSource(sourceId: string, patch: { current_run_id?: string; last_success_at?: string; last_status: "succeeded" | "failed"; last_error: string | null }): Promise<void>;
  finishRun(runId: string, result: { status: "succeeded" | "failed"; rowsRead: number; rowsApplied: number; rowsBlank: number; errorDetail: unknown | null; finishedAt: Date }): Promise<void>;
  pruneRecords(sourceId: string, keepRunIds: string[]): Promise<void>;
}
export interface RunOutcome {
  status: "succeeded" | "failed" | "locked"; runId: string | null;
  rowsRead: number; rowsApplied: number; rowsBlank: number; errors: ValidationError[]; message: string | null;
}
export async function runSync(args: {
  source: SyncSourceSpec; connection: ConnectionRef; trigger: "schedule" | "manual"; requestedBy: string | null;
  store: SyncStore; adapters: AdapterRegistry; now?: () => Date;
}): Promise<RunOutcome>;
```
Document the store contract in comments: `abandonStaleRuns` marks running runs of the connection started before `olderThan` as abandoned and sets their sources' `last_status` to `failed` with `last_error` "The sync stopped before finishing."; `startRun` inserts a running `sync_runs` row, sets the source's `last_status` to `running` and `last_attempt_at`, and turns a unique-index violation on the running lock into `{ locked: true }`.
Order: `abandonStaleRuns(connection.id, now - 15 minutes)`; `startRun` (locked: return `{ status: "locked", runId: null, rowsRead: 0, rowsApplied: 0, rowsBlank: 0, errors: [], message: "A sync is already running for this connection." }` and touch nothing else); no adapter for `source.provider`: fail with "Provider not supported yet"; `adapter.read` (a throw fails with the error's message, or "The source could not be read." when it has none); `mapRows` (errors fail with `errorDetail = errors` and message = the first error's message, plus ` (and <n> more)` when there are more); `insertRecords`; `markSource(source.id, { current_run_id: runId, last_success_at: now().toISOString(), last_status: "succeeded", last_error: null })`; `finishRun(succeeded, errorDetail null)`; `pruneRecords(source.id, [runId, source.current_run_id].filter(Boolean))` (a prune throw is swallowed; the next success prunes). A throw from `insertRecords` or anything else between `startRun` and the success `markSource` goes to the failure path. Failure path: `finishRun(runId, { status: "failed", rowsApplied: 0, errorDetail: errors.length ? errors : { message }, ... })` then `markSource(source.id, { last_status: "failed", last_error: message })`; the pointer and `last_success_at` are never in a failure patch, so the last good data stays (Global Constraint 11).

`links.ts` (Task 11 adds the QuickBooks branch later):
```ts
export function parseSpreadsheetUrl(url: string): { spreadsheetId: string; gid: number | null } | null;
export function sheetsUrl(spreadsheetId: string, gid: number | null, row?: number | null): string;
export function recordLink(ref: Record<string, unknown>): { href: string; label: string; note: string | null } | null;
```
`parseSpreadsheetUrl`: `new URL(url)` inside try; host must be `docs.google.com`; id from `/spreadsheets/d/([A-Za-z0-9_-]+)`; gid from `gid=(\d+)` in the hash or query, else null; anything else null. `sheetsUrl`: `https://docs.google.com/spreadsheets/d/<id>/edit`, plus `#gid=<gid>` when gid is not null, plus `&range=A<row>` when a row is also given. `recordLink`: a ref with string `spreadsheet_id` and number `sheet_gid` gives `{ href: sheetsUrl(id, gid, numeric row or null), label: "Open in Google Sheets", note: null }`; anything else null.

#### `src/lib/sync/state.ts`

```ts
export type SyncState = "not_connected" | "awaiting_first_sync" | "syncing" | "failed" | "stale" | "synced";
export const SYNC_STATE_LABELS: Record<SyncState, string> = {
  not_connected: "Not connected", awaiting_first_sync: "Awaiting first sync", syncing: "Syncing",
  failed: "Sync failed", stale: "Stale data", synced: "Synced",
};
export function ageHours(lastSuccessAt: string | null, now: Date): number | null;
export function syncState(
  source: Pick<SyncSource, "last_status" | "last_success_at" | "stale_after_hours">,
  connection: Pick<CompanyConnection, "status"> | null,
  now?: Date,
): SyncState;
```
Precedence, first match wins: `not_connected` (connection null or status `not_connected`); `syncing` (`last_status === "running"`); `failed` (`last_status` is `failed` or `abandoned`, or connection status `error`); `awaiting_first_sync` (`last_success_at` null); `stale` (`stale_after_hours` set and `ageHours > stale_after_hours`, strictly); `synced`. `now` defaults to `new Date()`. With a null threshold the state is never stale.

#### TypeScript tests to write first

`src/lib/sync/parse.test.ts`:
- `normalizeHeader("Net Profit ($)")` is `"net_profit"`; `"  Period Start "` is `"period_start"`.
- `serialToIsoDate`: 45658 -> "2025-01-01"; 45658.75 -> "2025-01-01"; 25569 -> "1970-01-01"; 46022 -> "2025-12-31".
- `isBlankCell`: undefined, null, "", "   " true; 0, false, "x" false.
- `parseCell`: (null, "currency"), ("", "number"), (undefined, "date"), ("  ", "text") all `{ ok: true, value: null }`; (" Sample ", "text") -> "Sample"; (101, "text") -> "101"; (true, "text") -> "true"; (1250.5, "currency") -> 1250.5; (0, "number") -> 0; (0.25, "percent") -> 0.25; ("1,250", "currency"), ("$5", "currency"), ("25%", "percent"), (true, "number"), (Infinity, "number") fail; (45658, "date") -> "2025-01-01"; ("2026-08-14", "date") -> "2026-08-14"; ("08/14/2026", "date") and (true, "date") fail.
- `mapRows`, with field map FM = job (text, required), amount (currency, required, header "Contract amount"), margin (percent, optional), signed (date, optional, header "Signed on") and record key `["job"]`, rows carrying `ref: { row: n }`:
  1. headers `["Job ", "Contract Amount ($)", "MARGIN", "Signed on"]` match; ok with two rows.
  2. no "Contract amount" header: `ok: false`, one error `{ code: "missing_header", field: "amount", row: null }`, `rowsBlank: 0`.
  3. no "MARGIN" header: ok, `margin` null in every row.
  4. a short row: missing trailing cells are null.
  5. a row with every mapped cell blank but an unmapped cell filled: skipped, `rowsRead` 3, `rowsBlank` 1, two rows returned.
  6. amount "abc" in row 3: `wrong_type`, row 3, field "amount".
  7. amount blank with job set: `required_blank`.
  8. two rows with job "Sample job 101": `duplicate_key`; `ok: false` and no rows.
  9. empty record key: keys `row:2`, `row:3` from `ref.row`; without `ref.row` the index fallback gives `row:1`, `row:2`.
  10. an unmapped column never appears in `data`.
  11. `source_ref` equals the row's ref.
  12. `bad_config`: empty field map; two entries with key "job"; record key `["phase"]`.
  13. 60 rows of text in a currency field: 50 errors, `ok: false`.
  14. a numeric header cell `2026` normalizes to "2026"; a null header cell reads as "".

`src/lib/sync/keys.test.ts`: `({ job: "101" }, ["job"], 2)` -> `'["101"]'`; `({ job: "101", phase: 2 }, ["job", "phase"], 2)` -> `'["101",2]'`; `({ job: "101", phase: 2 }, ["phase", "job"], 2)` -> `'[2,"101"]'`; `({ job: null }, ["job"], 2)` and `({ job: "" }, ["job"], 2)` -> null; `({}, [], 7)` -> `"row:7"`.

`src/lib/sync/schedule.test.ts` (Monday 07:00 America/Chicago is S):
- `scheduleOf` returns null when any of the three is null; `{ weekday: 1, time: "07:00:00", timezone: "America/Chicago" }` otherwise.
- S, now 2026-11-09T14:00:00Z -> 2026-11-09T13:00:00Z; now exactly 2026-11-09T13:00:00Z -> the same instant; now 2026-11-09T12:59:00Z -> 2026-11-02T13:00:00Z.
- Across the fall-back change: S, now 2026-10-27T00:00:00Z -> 2026-10-26T12:00:00Z (CDT); now 2026-11-03T00:00:00Z -> 2026-11-02T13:00:00Z (CST).
- Spring-forward gap: Sunday 02:30 America/Chicago, now 2027-03-14T12:00:00Z -> 2027-03-14T08:00:00Z (03:00 CDT, the first valid instant after the gap).
- Fall-back overlap: Sunday 01:30 America/Chicago, now 2026-11-01T12:00:00Z -> 2026-11-01T06:30:00Z (the earlier 01:30); now 2026-11-01T07:00:00Z -> 2026-11-01T06:30:00Z.
- UTC: Wednesday "09:15:00" "UTC", now 2026-11-11T09:15:00Z -> the same instant.
- `isDue`: disabled false; no schedule false; `last_attempt_at` null true; attempt before the latest slot true; attempt after it false.

`src/lib/sync/runner.test.ts` (fixed `now = () => new Date("2026-11-09T14:00:00Z")`; a fake store in the test file records every call in order and keeps runs and records in memory; a fake adapter returns a given `RawTable` or throws; build the source as a `SyncSource` and pass it through `function asSpec(s: SyncSource): SyncSourceSpec { return s; }` so `tsc -b` proves assignability):
1. success: call order `abandonStaleRuns, startRun, insertRecords, markSource, finishRun, pruneRecords`; the `markSource` patch is `{ current_run_id: runId, last_success_at: "2026-11-09T14:00:00.000Z", last_status: "succeeded", last_error: null }`; prune keeps `[runId, "run-prev"]`; outcome `succeeded` with `rowsApplied` 2.
2. validation failure keeps last good: a missing required header gives `failed`; `insertRecords` never runs; one `markSource` call with exactly the keys `last_status` ("failed") and `last_error`; `finishRun` gets `status: "failed"` and `errorDetail` equal to the errors array; no prune.
3. lock held: `startRun` returns `{ locked: true }`; outcome `locked`, `runId` null; only `abandonStaleRuns` and `startRun` were called.
4. stale runs abandoned first: `abandonStaleRuns` got the connection id and `2026-11-09T13:45:00.000Z`.
5. blank rows counted: three rows, one all blank: `rowsRead` 3, `rowsBlank` 1, `rowsApplied` 2, and the same counts reach `finishRun`.
6. duplicate key fails: `errors[0].code` is `duplicate_key`, nothing inserted.
7. no adapter: `adapters = {}` gives `failed` with message "Provider not supported yet".
8. adapter throws `new Error("Sample provider refused")`: `failed` with that message; the pointer untouched.
9. first success with no previous pointer: prune keeps `[runId]` only.
10. `insertRecords` throws: failure path; `markSource` failed; no `current_run_id` in any patch.

`src/lib/sync/links.test.ts`:
- `parseSpreadsheetUrl("https://docs.google.com/spreadsheets/d/AbC-123_x/edit#gid=42")` -> `{ spreadsheetId: "AbC-123_x", gid: 42 }`; `".../d/AbC/edit?gid=0#gid=0"` -> gid 0; `".../d/AbC/edit"` -> gid null; `"https://example.com/spreadsheets/d/AbC"` -> null; `"not a url"` -> null.
- `sheetsUrl("AbC", 42)` -> `https://docs.google.com/spreadsheets/d/AbC/edit#gid=42`; `sheetsUrl("AbC", 42, 5)` -> `...#gid=42&range=A5`; `sheetsUrl("AbC", null)` -> `https://docs.google.com/spreadsheets/d/AbC/edit`.
- `recordLink({ spreadsheet_id: "AbC", sheet_gid: 42, row: 5 })` -> `{ href: ".../edit#gid=42&range=A5", label: "Open in Google Sheets", note: null }`; `recordLink({ entity: "Invoice", Id: "1" })` -> null; `recordLink({})` -> null.

`src/lib/sync/state.test.ts` (fixed `now`):
- connection null -> `not_connected` even with `last_status: "failed"`; connection `not_connected` -> `not_connected`.
- `last_status: "running"` with a connection in `error` -> `syncing`.
- `failed` -> `failed`; `abandoned` -> `failed`; `succeeded` with connection `error` -> `failed`; `failed` with no success ever -> `failed`.
- connected, no status, no success -> `awaiting_first_sync`.
- threshold 24: success 25 hours ago -> `stale`; 23 hours ago -> `synced`; exactly 24 hours -> `synced`; threshold null and success 1000 hours ago -> `synced`.
- `ageHours(null, now)` null; 90 minutes ago -> 1.5.
- `SYNC_STATE_LABELS` values exactly as above.

`src/pages/pages.test.tsx`, `describe("connections")`, new case "keeps Google Sheets off the Connections card until a page asks for it": `renderWithHub(<ConnectionsPanel companyId={KLASIK.company.id} />, admin)` shows no "Google Sheets"; `renderWithHub(<ConnectionsPanel companyId={KLASIK.company.id} providers={["gohighlevel", "quickbooks", "google_sheets"]} />, admin)` shows "Google Sheets", its blurb and a button "Connect Google Sheets". The existing connections test stays unchanged.

#### Verification

- `npm run lint`
- `npx vitest run` (includes the unchanged `src/lib/csv.test.ts`)
- `npm run build`
- `npm run test:sql` (needs a local PostgreSQL 16; every migration applied, 0024 and up applied twice, then every test file)
- Deno type-check (this task adds files under `supabase/functions`):
  ```
  S=<scratch>
  mkdir -p $S/denocheck/functions && cp -r /home/user/client-dashboard/supabase/functions/. $S/denocheck/functions/
  cd $S/denocheck/functions/connections && DENO_DIR=$S/denocache $S/denotry/node_modules/.bin/deno check --node-modules-dir=auto index.ts ../_shared/sync/types.ts ../_shared/sync/parse.ts ../_shared/sync/keys.ts ../_shared/sync/schedule.ts ../_shared/sync/runner.ts ../_shared/sync/links.ts
  ```
- No visual check (no screen changes; the Connections card is unchanged by default).

#### Must NOT do

- No services, pages, panels or badges beyond the ConnectionsPanel `providers` prop; no Edge Function code or route; no `external_people` table (R4); no fixtures for sync (Task 8).
- Do not edit 0001 to 0027; do not seed any source, connection or module for a named company.
- No `period` or `person` field type (R11); no formula field; no guessing a number from text; blank is never 0.
- Global Constraint 7: nothing is applied to the live Supabase project and no function is deployed; Supabase MCP use is read-only (SELECT and catalog queries).
- Global Constraint 8: test and fixture data is plainly fictional ("Sample sales tab", "Sample job 101").
- Global Constraint 9: no financial formulas, capacity math, score math, aging thresholds or escalation rules.
- Global Constraint 10: `sync_runs` and `sync_records` get no INSERT, UPDATE or DELETE policy or grant for `authenticated`; only the service role writes them; nothing writes back to Google, QuickBooks or Monday.

#### Commits

1. `Add sync sources, runs and read-only records with their own Sync now predicate`
2. `Parse, key, schedule and run syncs in shared modules with no provider attached`
3. `Keep Google Sheets off the Connections card until a page asks for it`

Each message ends with the session's standard attribution trailer lines.

---

### Task 8: Sync UI

#### Goal and fit

Put the sync engine on screen, honestly: admins configure sources in Settings, press Sync now, and see each source's state, last success time and read-only mapped values on Sales & Finance, Controls, the Production PM capacity card and Home. A failed sync keeps showing the last good values with their time and never a 0; a blank shows "-". No figure is computed from imported records.

Builds on:
- Task 2: `hasModule(company, key)`; `Company.modules`; `KINGDOM` fixture bundle; `makeHub(persona, company)`.
- Task 5: `src/lib/attention.ts` (`attentionItems(input)` with kinds `not_signed_in`, `cycle_overdue`, `campaign_no_budget`, `connection_error`), `src/components/home/AttentionCard.tsx` (`{ company: Company }`, loads profiles, cycles, campaigns, connections), the Home card area in `src/pages/DashboardPage.tsx` (AttentionCard and ShortcutsCard under `switchboard`, WinsCard under `wins`).
- Task 6: `ScaffoldCard` (`src/components/scaffold/ScaffoldCard.tsx`), `SalesFinancePage` and `ControlsPage` with their scaffold element constants, ProductionPage's `pmCapacity` scaffold constant.
- Task 7: `src/lib/sync/state.ts` (`SyncState`, `SYNC_STATE_LABELS`, `ageHours`, `syncState`), `supabase/functions/_shared/sync/{types,keys,links,parse}.ts` (`FieldType`, `FieldMapEntry`, `SyncProvider`, `TargetModule`, `SourceConfig`, `ParsedValue`, `buildRecordKey`, `parseSpreadsheetUrl`, `sheetsUrl`, `recordLink`, `normalizeHeader`), the row types `SyncSource`, `SyncRun`, `SyncRecord`, `TARGET_MODULE_LABELS`, `FIELD_TYPE_LABELS`, `ConnectionProvider` including `google_sheets` and `CONNECTION_PROVIDER_LABELS` in `src/types/database.ts`; RLS that lets admins read sources, runs and records and nobody in the browser write runs or records.

#### Files

Create:
- `src/services/invoke.ts`: `export async function invokeFunction<T>(path: string, body: Record<string, unknown>): Promise<T>`, the body moved verbatim from the private `invoke` in `src/services/connections.ts` (lines 16-30, with its comment: surface the function's JSON `error` line, else "The connection service did not answer. Try again in a moment."). An internal helper: no mock, not in the demo alias, never imported by a page.
- `src/services/sync.ts` and `src/test/mocks/sync.ts` (identical exports).
- `src/lib/sync/format.ts` and `src/lib/sync/format.test.ts`.
- `src/lib/sync/draft.ts` and `src/lib/sync/draft.test.ts` (the source editor's pure form logic).
- `src/components/sync/SyncStateBadge.tsx`, `src/components/sync/FreshnessLine.tsx`, `src/components/sync/MappedTable.tsx`, `src/components/sync/SourcePanel.tsx`.
- `src/components/home/FreshnessCard.tsx`.
- `src/components/settings/DataSourcesPanel.tsx`.

Modify:
- `src/services/connections.ts`: delete the private `invoke` (lines 16-30), `import { invokeFunction } from "./invoke.ts";`, and call `invokeFunction` at lines 36 and 42. Its exports are unchanged.
- `src/components/status.ts` (49 lines): `import type { SyncState } from "../lib/sync/state.ts";` and append
  ```ts
  export const SYNC_STATE_TONE: Record<SyncState, BadgeTone> = {
    not_connected: "neutral", awaiting_first_sync: "info", syncing: "info", failed: "danger", stale: "warning", synced: "success",
  };
  ```
  No other tone map is added anywhere.
- `src/lib/attention.ts` (+ `attention.test.ts`): `AttentionKind` gains `"sync_failed" | "sync_stale"`; `AttentionInput` gains `sources?: SyncSource[]` and `now?: Date`. For each source with `enabled` whose `syncState(source, connections.find((c) => c.id === source.connection_id) ?? null, now)` is `failed`: `{ kind: "sync_failed", severity: "danger", title: "<name>: sync failed", detail: source.last_error ?? "The last attempt did not finish.", to: "/settings" }`; is `stale`: `{ kind: "sync_stale", severity: "warning", title: "<name>: stale data", detail: "Last synced <formatDateTime(last_success_at)>.", to: "/settings" }`. Ordering stays danger first, then input order.
- `src/components/home/AttentionCard.tsx`: when `hasModule(company, "data_sources")`, also load `listSyncSources(company.id)` in the same `useAsync` and pass `sources` and `now: new Date()`; otherwise make no sync call.
- `src/pages/DashboardPage.tsx` (AdminDashboard only): `{hasModule(company!, "switchboard") && hasModule(company!, "data_sources") ? <FreshnessCard companyId={companyId} /> : null}` in the right column of the Task 5 card grid (after the WinsCard element).
- `src/pages/salesFinance/SalesFinancePage.tsx`: replace the two scaffold cards with `<SourcePanel companyId={company!.id} targetModule="sales_reporting" scaffold={salesScaffold} />` and `<SourcePanel ... targetModule="financial_reporting" scaffold={financialScaffold} />` (stack them full width, `space-y-6`, since tables need the room).
- `src/pages/salesFinance/ControlsPage.tsx`: `<SourcePanel companyId={company!.id} targetModule="controls" scaffold={controlsScaffold} />`.
- `src/pages/production/ProductionPage.tsx`: the PM capacity slot renders `isAdmin && hasModule(company!, "data_sources") ? <SourcePanel companyId={company!.id} targetModule="pm_capacity" scaffold={pmCapacity} showRecords={false} /> : pmCapacity` (members cannot read sources under RLS, so they get the scaffold without a pointless call), with the note "PM capacity shows its source's state only until the PM mapping slice (S11)."
- `src/pages/CompanySettingsPage.tsx`: in the left column after `<JobRolesPanel companyId={company!.id} />` (line 70), `{hasModule(company!, "data_sources") ? <DataSourcesPanel companyId={company!.id} /> : null}`.
- `src/test/fixtures.ts`: sync data for Kingdom (see Fixtures).
- `src/pages/pages.test.tsx`: `vi.mock("../services/sync.ts", () => import("../test/mocks/sync.ts"));` beside the other mocks (lines 8-22 today) and the `describe("data sources")` cases.
- `src/App.rococo.test.tsx`: `vi.mock("./services/sync.ts", () => import("./test/mocks/sync.ts"));` (Kingdom Home now loads sources).
- `demo/vite.config.ts` line 19 (the `find:` regex): add `sync` to the alias alternation (`...|connections|...|sync)\.ts$/`), keeping the names already there.

#### Service `src/services/sync.ts`

Why-comment: sources are configuration an admin edits; runs and records are written only by the `connections` function and read here, never edited; Sync now goes through the function, which writes `sync_requested_at` as the user under `private.can_sync_source`.
```ts
export interface SyncSourceInput {
  company_id: string; connection_id: string; provider: SyncProvider; name: string; target_module: TargetModule;
  config: SourceConfig; field_map: FieldMapEntry[]; record_key: string[];
  sync_weekday: number | null; sync_time: string | null; sync_timezone: string | null;
  stale_after_hours: number | null; enabled: boolean;
}
export type SyncSourcePatch = Partial<Omit<SyncSourceInput, "company_id" | "provider">>;
export async function listSyncSources(companyId: string): Promise<SyncSource[]>;            // name asc
export async function createSyncSource(input: SyncSourceInput): Promise<SyncSource>;
export async function updateSyncSource(id: string, patch: SyncSourcePatch): Promise<SyncSource>;
export async function setSyncSourceEnabled(id: string, enabled: boolean): Promise<SyncSource>;
export async function listSyncRuns(sourceId: string, limit?: number): Promise<SyncRun[]>;  // started_at desc, default 10
export async function listCurrentRecords(source: Pick<SyncSource, "id" | "current_run_id">): Promise<SyncRecord[]>; // [] when current_run_id null
export interface SyncRunResult { status: "succeeded" | "failed" | "locked"; message: string | null; rows_applied: number }
export async function requestSync(sourceId: string): Promise<SyncRunResult>;               // invokeFunction("connections/sync/run", { source_id })
```
- Explicit column lists (the `companies.ts` COLUMNS trap: a column left out is silently invisible): sources `id, company_id, connection_id, provider, name, target_module, config, field_map, record_key, sync_weekday, sync_time, sync_timezone, stale_after_hours, enabled, current_run_id, last_attempt_at, last_success_at, last_status, last_error, sync_requested_at, created_by, updated_by, created_at, updated_at`; runs `id, company_id, source_id, connection_id, trigger_kind, requested_by, status, started_at, finished_at, rows_read, rows_applied, rows_blank, error_detail`; records `id, company_id, source_id, run_id, record_key, data, source_ref, created_at`.
- Every query filters by its id or `company_id` explicitly; every function throws the Supabase error.
- `listCurrentRecords`: filter `source_id` and `run_id = current_run_id`, order `record_key`, and page with `.range(from, from + 999)` until a page comes back short, so a tab over the API row cap is never cut off silently.
- `setSyncSourceEnabled(id, enabled)` is `updateSyncSource(id, { enabled })`.
- `requestSync` returns the function's JSON as is.

Mock `src/test/mocks/sync.ts`: same exported names and types (declare the types in the mock, as the other mocks do); arrays seeded with `fromAll((b) => b.syncSources).map((x) => ({ ...x }))` and the same for `syncRuns`, `syncRecords`; `createSyncSource` adds `{ id: "sync-source-<n>", ...input, current_run_id: null, last_attempt_at: null, last_success_at: null, last_status: null, last_error: null, sync_requested_at: null, created_by: null, updated_by: null, created_at: now, updated_at: now }`; updates stamp `updated_at`; a missing id throws `new Error("Sync source not found.")`; `requestSync` stamps `sync_requested_at` and returns `{ status: "succeeded", message: null, rows_applied: <records of the source's current run> }` without changing state.

#### Pure helpers

`src/lib/sync/format.ts`:
- `export function formatMappedValue(value: string | number | null, type: FieldType): string`: null or "" -> "-"; `currency` -> `formatMoney(v)`; `percent` -> `formatPercent(v, 1)`; `number` -> `formatNumber(v)`; `date` -> `formatDate(v)`; `text` -> as is (numbers stringified). A non-number in a numeric type renders its raw text, never 0.
- `export function formatAge(hours: number): string`: below 1 "less than an hour"; below 48 `pluralize(Math.floor(hours), "hour")`; else `pluralize(Math.floor(hours / 24), "day")`.

`src/lib/sync/draft.ts`:
```ts
export interface FieldDraft { header: string; key: string; label: string; type: FieldType; unit: string; required: boolean }
export interface SourceDraft {
  name: string; provider: SyncProvider; target_module: TargetModule;
  spreadsheet_url: string; header_row: string; range: string;   // Google Sheets
  entity: "Invoice" | "Payment";                                  // QuickBooks
  fields: FieldDraft[]; record_key: string[];
  weekday: string; time: string; timezone: string;                // weekday "" = not scheduled, else "0".."6"
  stale_after_hours: string; enabled: boolean;
}
export function emptyDraft(provider: SyncProvider, timezone: string): SourceDraft;   // target sales_reporting, header_row "1", entity "Invoice", one empty field, not scheduled, disabled
export function draftFromSource(source: SyncSource): SourceDraft;                    // sheets URL via sheetsUrl(id, gid); time "HH:MM" from sync_time
export function fieldFromHeader(header: string): FieldDraft;                         // key normalizeHeader(header), label header.trim(), type "text", unit "", required false
export type DraftResult = { ok: true; value: Omit<SyncSourceInput, "company_id" | "connection_id"> } | { ok: false; message: string };
export function draftToInput(draft: SourceDraft): DraftResult;
```
`draftToInput` rules, first failure wins, with these messages:
- blank name: "The source needs a name."
- Google Sheets: `parseSpreadsheetUrl` null: "That does not look like a Google Sheets link."; gid null: "Copy the link with the tab open, so it includes the tab."; header row not a whole number of one or more: "The header row is a whole number, one or more." Config `{ spreadsheet_id, sheet_gid, range: range.trim() || null, header_row }`.
- QuickBooks: config `{ entity }`.
- no fields: "Map at least one field."; a blank header: "Every field needs its column header."; key (trimmed, lowercased) not matching `^[a-z0-9_]+$`: "Field keys use lowercase letters, numbers and underscores."; duplicate keys: "Two fields share the key <key>." Blank label falls back to the header; blank unit becomes null.
- `record_key` keeps only keys still mapped, in field order.
- schedule: weekday "" gives all three null; otherwise time must match `^\d{2}:\d{2}$` ("Pick a time for the weekly sync.") and the zone must construct `new Intl.DateTimeFormat("en-US", { timeZone })` ("That time zone is not recognized.").
- stale: "" -> null; else a whole number of one or more ("Stale after is a whole number of hours, one or more.").

#### Components

All open with a why-comment, are PascalCase default exports, style only through `ui/*` primitives and theme tokens, and load data with `useAsync` (rendering `<Notice tone="error">` from the hook's error, and `SkeletonRows` while loading).
- `SyncStateBadge` `{ state: SyncState }`: `<Badge tone={SYNC_STATE_TONE[state]}>`, label `SYNC_STATE_LABELS[state]`; `syncing` prefixes `<RefreshCw size={11} className="animate-spin" aria-hidden />`.
- `FreshnessLine` `{ source: SyncSource; connection: CompanyConnection | null; now?: Date }`: one `text-[12.5px] text-ink-2` line from `syncState`:
  - not_connected: "Not connected. Connect <CONNECTION_PROVIDER_LABELS[provider]> in Settings." with "Settings" a `Link` to `/settings`.
  - awaiting_first_sync: "Connected. No data yet."
  - syncing: "Syncing now." plus " Showing data from <formatDateTime(last_success_at)>." when there is one.
  - failed: "Sync failed. <reason>" where reason is `source.last_error ?? connection?.last_error ?? "The last attempt did not finish."`, plus " Showing data from <time>." or " No data yet.".
  - stale: "Stale: last synced <time>, <formatAge> ago."
  - synced: "Synced <time>, <formatAge> ago." (the age always shows; with no threshold nothing is ever called stale).
- `MappedTable` `{ source: SyncSource; records: SyncRecord[] }`: caption line "Read-only, from <CONNECTION_PROVIDER_LABELS[provider]>." then, in an `overflow-x-auto` wrapper, a `tableClass` table: one `thClass` header per `field_map` entry (`label`, plus ` (<unit>)` when set), then a "Source" column. Rows sorted by numeric `source_ref.row` ascending, else `record_key` (a private helper in the file). Cells `formatMappedValue(record.data[entry.key] ?? null, entry.type)`, numeric types `tnum text-right`. Source cell: `recordLink(record.source_ref)` as `<a target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">` with its label (and its note in `text-ink-3` when not null), else "-". No inputs of any kind. Zero records: "No rows in the last sync."
- `SourcePanel` `{ companyId: string; targetModule: TargetModule; scaffold: ReactNode; showRecords?: boolean }` (`showRecords` defaults to true; MappedTable renders only when it is true): loads `listSyncSources(companyId)`, `listConnections(companyId)` and, for each enabled source of `targetModule`, `listCurrentRecords(source)`, in one `useAsync`. No such source renders `scaffold` unchanged. Otherwise one `Section` per source: `eyebrow={TARGET_MODULE_LABELS[targetModule]}`, `title={source.name}`, `actions={<SyncStateBadge state=... />}`, then `FreshnessLine`, then `MappedTable` when the source has a `current_run_id` (last good data stays visible while syncing and after a failure).
- `FreshnessCard` `{ companyId: string }`: `Section eyebrow="Data sources" title="Freshness" description="When each source last synced. Imported values are read-only."`; one row per enabled source: the name as a `Link` to its module (`sales_reporting` and `financial_reporting` -> `/sales-finance`, `controls` -> `/sales-finance/controls`, `pm_capacity` -> `/production`; a private const map), `TARGET_MODULE_LABELS` text, `SyncStateBadge`, `FreshnessLine`. None: "No data sources yet. Add one in Settings." with a link.
- `DataSourcesPanel` `{ companyId: string }`: `Section eyebrow="Integrations" title="Data sources" description="Spreadsheet tabs and QuickBooks records this company reads into the hub. Imported values are read-only here; change them at the source." actions={<Button size="sm">Add source</Button>}`.
  - List every source (disabled ones too): name, `TARGET_MODULE_LABELS`, provider label, `SyncStateBadge`, `FreshnessLine`; an "Enabled" checkbox (`checkboxClass`, `aria-label="Enable <name>"`, calls `setSyncSourceEnabled`); "Sync now" (`aria-label="Sync <name> now"`, available when the source's connection is `connected`, shows "Syncing..." while waiting); "Edit"; "Recent runs" toggle (`aria-label="Show runs for <name>"`) that loads `listSyncRuns(id)` and lists started time (`formatDateTime`), "Scheduled" or "Manual", a status Badge (succeeded success, failed danger, running info, abandoned warning, through an inline expression, no new tone map; abandoned reads "Stopped"), "<rows_read> read, <rows_applied> applied, <rows_blank> blank", and for a failed run the first message in `error_detail` (an array of `{ message }` or an object with `message`).
  - Sync now results, as a `Notice` above the list: succeeded "<name> synced: <pluralize(rows_applied, "row")>." (success); failed `result.message ?? "The sync did not finish."` (error); locked "A sync is already running for this connection. Try again in a few minutes." (info). Then reload the list.
  - Editor in a `Modal` (`size="xl"`, `labelledBy` its heading "New data source" or "Edit data source"), plain controlled inputs and one Save (the field map is validated as a whole, so this is not a save-on-blur form): Name; Feeds (select of `TARGET_MODULE_LABELS`); Source (select Google Sheets or QuickBooks Online, disabled when editing); for Google Sheets "Google Sheets link" (hint "Open the tab in Google Sheets and copy the address, so the link includes the tab.") with a readout "Spreadsheet <id>, tab <gid>" from `parseSpreadsheetUrl`, "Header row", "Range" (hint "Leave blank to read the whole tab."); for QuickBooks "QuickBooks records" (Invoice or Payment); "Fields": a table of rows (Column header, Key, Label, Type from `FIELD_TYPE_LABELS`, Unit, Required) with a remove `IconButton label="Remove field"` and an "Add field" button (a typed header fills Key from `normalizeHeader` until Key is edited); "Record key": one checkbox per mapped key, hint "Tick the fields that identify a row. Leave all unticked to replace the whole tab on each sync."; "Weekly sync": day select with "Not scheduled" plus Sunday to Saturday, "Time" (`type="time"`), "Time zone" (text input with a `datalist` from `Intl.supportedValuesOf("timeZone")`, defaulting to the browser's zone), hint "Without a schedule the source syncs only when someone presses Sync now."; "Stale after (hours)", hint "Leave blank to show the age without ever marking it stale."; "Enabled". Errors from `draftToInput` or the service show in a `Notice tone="error"`.
  - The connection is the company's `company_connections` row for the chosen provider (`listConnections(companyId)`); with no row, Save is disabled and the editor says "Connect <provider label> in Connections first." Create calls `createSyncSource({ company_id: companyId, connection_id, ...value })`; edit calls `updateSyncSource(id, patch)` without `provider`.
  - Nothing here shows or asks for a token.

#### Fixtures (`src/test/fixtures.ts`)

All Kingdom-only, plainly fictional, built inside `build()` from a new optional `CompanySpec` field set only on `"co-kingdom"`; Klasik and RBA get empty arrays. Append, never reorder existing generation.
- `CompanyBundle` gains `syncSources: SyncSource[]`, `syncRuns: SyncRun[]`, `syncRecords: SyncRecord[]` (and the return object at line 924 today gains them).
- `CompanySpec` gains `sync?: Array<{ name: string; provider: SyncProvider; target_module: TargetModule; outcome: "never" | "running" | "failed" | "succeeded"; stale_after_hours: number | null; last_error?: string; field_map: FieldMapEntry[]; record_key: string[]; records: Array<Record<string, ParsedValue>> }>`.
- When `spec.sync` is set, push two rows onto the existing `connections` array (built at lines 422-425 today, after `conn-ghl`): `p("conn-sheets")` (`kingdom-conn-sheets`, provider `google_sheets`, status `connected`, `external_account_name: "sample-reports@example.com"`) and `p("conn-qbo")` (`kingdom-conn-qbo`, provider `quickbooks`, status `not_connected`, account fields null).
- Source i (1-based): id `p("source-<i>")`, connection `conn-sheets` for Google Sheets and `conn-qbo` for QuickBooks, `enabled: true`, Sheets config `{ spreadsheet_id: "sample-sheet-<i>", sheet_gid: 0, range: null, header_row: 1 }` with schedule `1`, `"07:00:00"`, `"America/Chicago"`; QuickBooks config `{ entity: "Invoice" }` with no schedule. Outcomes: `never` all result columns null; `succeeded` run `p("run-<i>-1")` succeeded at `EARLIER`, pointer to it, `last_attempt_at` and `last_success_at` `EARLIER`, `last_status` `succeeded`; `failed` run-1 succeeded at `EARLIER` (pointer) plus run-2 failed at `NOW` with `error_detail` `[{ code: "missing_header", message: <last_error>, row: null, field: null }]`, `last_status` `failed`; `running` run-1 succeeded at `EARLIER` (pointer) plus run-2 `running` started `NOW`, `last_status` `running`. Records `p("record-<i>-<j>")` under the pointer run, `record_key` from `buildRecordKey(data, record_key, j + 1)`, `source_ref` `{ spreadsheet_id: "sample-sheet-<i>", sheet_gid: 0, row: j + 1 }`.
- Kingdom's six, one per `SyncState`:
  1. "Sample sales tab": google_sheets, `sales_reporting`, succeeded, threshold null (synced). Field map: Job (text, required, key `job`), Contract amount (currency, unit "USD", key `contract_amount`), Margin (percent, `margin`), Units (number, `units`), Signed on (date, `signed_on`), Notes (text, `notes`); record key `["job"]`. Records: `{ job: "Sample job 101", contract_amount: 250000, margin: 0.25, units: 3, signed_on: "2026-08-14", notes: "Sample note" }` and `{ job: "Sample job 102", contract_amount: null, margin: null, units: null, signed_on: null, notes: null }` (one blank per type).
  2. "Sample financial tab": google_sheets, `financial_reporting`, failed, threshold null, `last_error: "The column \"Gross profit\" is missing."`; field map Month (text, required, `month`), Revenue (currency, `revenue`); record key `["month"]`; record `{ month: "Sample month A", revenue: 120000 }`.
  3. "Sample stale tab": google_sheets, `sales_reporting`, succeeded, `stale_after_hours: 24` (stale); field map Job (text, required), Contract amount (currency); record `{ job: "Sample job 103", contract_amount: 90000 }`.
  4. "Sample syncing tab": google_sheets, `financial_reporting`, running, threshold null; field map Month, Revenue as in 2; record `{ month: "Sample month B", revenue: 80000 }`.
  5. "Sample capacity tab": google_sheets, `pm_capacity`, never (awaiting first sync); field map PM (text, required, `pm`); no records.
  6. "Sample invoices": quickbooks, `controls`, never (not connected, its connection is `not_connected`); field map Invoice number (text, `doc_number`); no records.

#### Tests to write first

`src/lib/sync/format.test.ts`: `(250000, "currency")` -> "$250,000"; `(-1200.4, "currency")` -> "-$1,200"; `(0, "currency")` -> "$0" (a real zero stays zero); `null` -> "-" for each of the five types; `("", "text")` -> "-"; `(0.256, "percent")` -> "25.6%"; `(1234.5678, "number")` -> "1,234.57"; `("2026-08-14", "date")` -> "Aug 14, 2026"; `("Sample job 101", "text")` unchanged; `(42, "text")` -> "42"; `("n/a", "currency")` -> "n/a". `formatAge`: 0.5 -> "less than an hour"; 1 -> "1 hour"; 47.9 -> "47 hours"; 50 -> "2 days".

`src/lib/sync/draft.test.ts`: `emptyDraft("google_sheets", "America/Chicago")` shape; `fieldFromHeader("Contract Amount ($)")` -> key "contract_amount", label "Contract Amount ($)"; `draftFromSource` round-trips the fixture "Sample sales tab" through `draftToInput` to the same config, field map, record key and schedule (time "07:00"); each failure message above for its input; record key drops a removed field; weekday "" nulls all three schedule columns; stale "" -> null and "0" fails; QuickBooks draft gives `{ entity: "Invoice" }`.

`src/lib/attention.test.ts` (add): a failed enabled source gives one `sync_failed` danger item with its `last_error`; a stale enabled source (threshold 24, success 30 hours before `now`) gives `sync_stale` warning; a disabled failed source gives nothing; danger items come before warning items; with no `sources` the existing results are unchanged.

`src/pages/pages.test.tsx`, `describe("data sources")` with `const kingdomAdmin = makeHub("admin", KINGDOM.company); const kingdomEmployee = makeHub("employee", KINGDOM.company);` and `const source = (name: string) => KINGDOM.syncSources.find((s) => s.name === name)!`:
1. "carries one Kingdom source in each sync state": mapping `syncState(s, KINGDOM.connections.find((c) => c.id === s.connection_id) ?? null)` over `KINGDOM.syncSources` gives all six states exactly once.
2. "shows synced values read-only, with blanks as a hyphen": `<SalesFinancePage />` as `kingdomAdmin` at `/sales-finance`: Section "Sample sales tab" with badge "Synced"; headers "Job", "Contract amount (USD)", "Margin", "Units", "Signed on", "Notes"; "Sample job 101", "$250,000", "25.0%", "Aug 14, 2026"; within the "Sample job 102" row, exactly five cells read "-" (Contract amount, Margin, Units, Signed on, Notes); "Open in Google Sheets" links whose href contains `docs.google.com/spreadsheets/d/sample-sheet-1` and `range=A2`, with `target="_blank"` and `rel` containing `noopener`; `screen.queryAllByRole("textbox")` and `queryAllByRole("spinbutton")` are empty; no cell reads "$0" or "0%".
3. "keeps the last good values and their time when a sync fails, never a 0": Section "Sample financial tab" has badge "Sync failed", text containing `Showing data from ${formatDateTime(source("Sample financial tab").last_success_at)}`, the line with the missing-column error, "$120,000"; no "$0" anywhere in that Section.
4. "keeps the last good values visible while a sync runs": "Sample syncing tab" shows "Syncing" and "$80,000".
5. "marks stale data with its age": "Sample stale tab" shows "Stale data" and a line starting "Stale: last synced".
6. "shows a QuickBooks source that is not connected yet": `<ControlsPage />` at `/sales-finance/controls`: "Sample invoices" with badge "Not connected", a "Settings" link, and no table.
7. "shows the PM capacity source's state to admins only": `<ProductionPage />` as `kingdomAdmin` shows "Sample capacity tab" with "Awaiting first sync" and "Connected. No data yet."; as `kingdomEmployee` the "PM capacity" scaffold region with "Not configured" and no "Sample capacity tab".
8. "lists every source's freshness on Kingdom Home": `<DashboardPage />` as `kingdomAdmin`: heading "Freshness"; the six names as links; "Sample financial tab" row shows its `formatDateTime(last_success_at)`; the attention card shows "Sample financial tab: sync failed" and "Sample stale tab: stale data".
9. "adds nothing to a company without data sources": `<DashboardPage />` as the Klasik `admin` has no "Freshness" heading; `<CompanySettingsPage />` as `admin` has no "Data sources" heading.
10. "configures sources and syncs one now from Settings": `<CompanySettingsPage />` as `kingdomAdmin`: "Data sources" lists the six names; clicking "Sync Sample sales tab now" shows "Sample sales tab synced: 2 rows."; "Add source" opens "New data source"; Save with no name shows "The source needs a name."; typing name "Sample new tab" and link `https://docs.google.com/spreadsheets/d/sample-new-sheet/edit#gid=42` shows "Spreadsheet sample-new-sheet, tab 42"; typing header "Job" fills Key "job"; Save closes the modal and "Sample new tab" appears in the list.
11. The Task 6 scaffold tests (which use RBA with the modules on and no sources) stay green unchanged, proving the scaffold fallback.

#### Design notes

Theme tokens only; badges carry state colour through `SYNC_STATE_TONE` (the only new tone map). Tables use `tableClass`, `thClass`, `tdClass`; numerals `tnum`. Skeletons (`SkeletonRows`) while loading, never a blank. Hairlines and dense rows; the accent only on links and the primary button. A "-" is the only blank rendering. Copy has no em dashes.

#### Verification

- `npm run lint`
- `npx vitest run`
- `npm run build`
- No SQL change and no `supabase/functions` change: no `npm run test:sql`, no Deno check.
- Visual check: `npm run demo`, then the Playwright script from Task 6's pattern (fresh context per URL, `deviceScaleFactor: 1`, 1440x900, screenshots to `<scratch>/shots/task8/`, never the repo) for: `/?persona=admin&company=kingdom`, `/?persona=employee&company=kingdom`, `/sales-finance?persona=admin&company=kingdom` (also at 390x844 for the table's horizontal scroll inside its wrapper, with no page-level horizontal scroll), `/sales-finance/controls?persona=admin&company=kingdom`, `/production?persona=admin&company=kingdom`, `/production?persona=employee&company=kingdom`, `/settings?persona=admin&company=kingdom` (plus one shot after clicking "Add source"), `/?persona=admin&company=klasik`, `/settings?persona=admin&company=klasik`. Check every PNG: badges readable, the failed source shows its last good values and time, no "0" stands in for a blank, Klasik shows nothing new.

#### Must NOT do

- No figure computed from records: no totals, averages, margins, variances, trends or charts; MappedTable shows mapped values only.
- Never render a blank, missing or failed value as 0; a failed sync keeps the last good data with its time (Global Constraint 11).
- No provider call from the browser; no Google row in ConnectionsPanel and no `describeSpreadsheet` (both Task 10); no Edge Function code; no migration.
- No change for a company without `data_sources` (no card, panel, call or nav item).
- Global Constraint 7: nothing applied to the live Supabase project, nothing deployed; Supabase MCP read-only.
- Global Constraint 8: fixtures plainly fictional ("Sample sales tab", "Sample job 101", example.com addresses).
- Global Constraint 9: no financial formulas, capacity math, score math, aging thresholds or escalation rules; PM capacity shows the source and its state, no calculation.
- Global Constraint 10: runs and records stay read-only; the UI has no control that edits them; no writeback to Google, QuickBooks or Monday.

#### Commits

1. `Move the Edge Function call into one shared helper`
2. `Show each data source's sync state, freshness and read-only values`
3. `Configure data sources and sync them now from Settings`

Each message ends with the session's standard attribution trailer lines.

---

### Task 9: External links and Monday entry points

#### Goal and fit

A per-company registry of links to the company's own outside tools (Monday boards first), shown where people work: on Home's Shortcuts card and in the Sales & Finance and Production sections. Links open in a new tab and say where they go; an embed appears only for a view the company has flagged as a public share view, always with the direct link beside it. Audience (admins only or everyone) is enforced by RLS, never by the UI.

Builds on:
- Task 2: `hasModule(company, key)`; `LinkNavGroup = "home" | "sales_finance" | "production" | "people_hr"` in `src/types/database.ts`; `NAV_GROUP_LABELS` (`home: "Home"`, `sales_finance: "Sales & Finance"`, `production: "Production"`, `people_hr: "People / HR"`, `utility: null`) in `src/lib/navigation.ts`; `KINGDOM` fixture bundle; `makeHub`.
- Task 3: `private.audit_change()` (0025; AFTER row trigger, watched columns as trigger args, writes only when one changes).
- Task 4: `public.stamp_actor()` and `public.pin_company_id()` (0026); ProductionPage.
- Task 5: `src/components/home/ShortcutsCard.tsx` (`{ company: Company; isAdmin: boolean; isRococo: boolean }`, section shortcuts from `sectionShortcuts(navFor(...))`), shown on Home under `switchboard` for admins and employees.
- Task 6 and Task 8: SalesFinancePage and ProductionPage as they stand; CompanySettingsPage with DataSourcesPanel under `data_sources`.
- Task 1: SQL harness and helpers (`tests.company`, `tests.create_person`, `tests.id`, `tests.act_as`, `tests.assert`, `tests.assert_raises`, `tests.fixture`; reset with `reset role; select set_config('request.jwt.claims', '', true);`; each file rolled back).

#### Files

Create:
- `supabase/migrations/0031_external_links.sql`
- `supabase/tests/0031_external_links.test.sql`
- `src/services/externalLinks.ts` and `src/test/mocks/externalLinks.ts` (identical exports)
- `src/components/links/ExternalLinkButton.tsx`, `src/components/links/EmbedFrame.tsx`, `src/components/links/ExternalLinksList.tsx`
- `src/components/settings/ExternalLinksPanel.tsx`

Modify:
- `src/types/database.ts` (after the Task 2 `LinkNavGroup`):
  ```ts
  export type LinkProvider = "monday" | "quickbooks" | "google_sheets" | "other";
  export type LinkAudience = "admins" | "everyone";
  export const LINK_PROVIDER_LABELS: Record<LinkProvider, string> = { monday: "Monday", quickbooks: "QuickBooks", google_sheets: "Google Sheets", other: "Other" };
  export const LINK_AUDIENCE_LABELS: Record<LinkAudience, string> = { admins: "Admins only", everyone: "Everyone" };
  export interface ExternalLink {
    id: string; company_id: string; nav_group: LinkNavGroup; label: string; destination_note: string | null;
    url: string; provider: LinkProvider; embed_url: string | null; embed_is_public: boolean;
    audience: LinkAudience; sort_order: number;
    created_by: string | null; updated_by: string | null; created_at: string; updated_at: string;
  }
  ```
- `src/components/home/ShortcutsCard.tsx`: below the section shortcuts, when `hasModule(company, "external_links")`, a private sub-component (above the default export) that loads `listExternalLinks(company.id)` and lists every returned link as an `ExternalLinkButton`, grouped under `NAV_GROUP_LABELS[group]` headings in the order home, sales_finance, production, people_hr, omitting empty groups. No embeds on the card.
- `src/pages/salesFinance/SalesFinancePage.tsx`: after the source panels, `{hasModule(company!, "external_links") ? <ExternalLinksList companyId={company!.id} navGroup="sales_finance" /> : null}`.
- `src/pages/production/ProductionPage.tsx`: after the project list, `{hasModule(company!, "external_links") ? <ExternalLinksList companyId={company!.id} navGroup="production" /> : null}`.
- `src/pages/CompanySettingsPage.tsx`: in the left column after the DataSourcesPanel line, `{hasModule(company!, "external_links") ? <ExternalLinksPanel companyId={company!.id} /> : null}`.
- `src/test/fixtures.ts`: `CompanyBundle.externalLinks: ExternalLink[]`, a `CompanySpec` field `links?: Array<Omit<ExternalLink, "id" | "company_id" | "created_by" | "updated_by" | "created_at" | "updated_at">>` set only on `"co-kingdom"`, ids `p("link-<i>")`, empty for Klasik and RBA.
- `src/pages/pages.test.tsx`: `vi.mock("../services/externalLinks.ts", () => import("../test/mocks/externalLinks.ts"));` and `describe("external links")`.
- `src/App.rococo.test.tsx`: `vi.mock("./services/externalLinks.ts", () => import("./test/mocks/externalLinks.ts"));`.
- `demo/vite.config.ts` line 19 (the `find:` regex): add `externalLinks` to the alias alternation.

#### Migration `0031_external_links.sql`

Header comment: links and approved public embeds only, no copied records, Monday's own sign-in applies; "Paste after 0030; idempotent."
- `create table if not exists public.external_links`: `id uuid primary key default gen_random_uuid()`, `company_id uuid not null references public.companies (id) on delete cascade`, `nav_group text not null`, `label text not null`, `destination_note text`, `url text not null`, `provider text not null default 'other'`, `embed_url text`, `embed_is_public boolean not null default false`, `audience text not null default 'everyone'`, `sort_order integer not null default 0`, `created_by uuid references public.profiles (id) on delete set null`, `updated_by uuid references public.profiles (id) on delete set null`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`.
- Constraints: `external_links_nav_group_check check (nav_group in ('home', 'sales_finance', 'production', 'people_hr'))`, `external_links_label_check check (btrim(label) <> '')`, `external_links_url_check check (url ~ '^https://')`, `external_links_embed_url_check check (embed_url is null or embed_url ~ '^https://')`, `external_links_embed_public_check check (not embed_is_public or embed_url is not null)`, `external_links_provider_check check (provider in ('monday', 'quickbooks', 'google_sheets', 'other'))`, `external_links_audience_check check (audience in ('admins', 'everyone'))`.
- Indexes: `external_links_company_group_idx (company_id, nav_group, sort_order)` (covers the company FK), `external_links_created_by_idx (created_by)`, `external_links_updated_by_idx (updated_by)`.
- Triggers (drop if exists, then create): `external_links_pin_company` BEFORE UPDATE -> `public.pin_company_id()`; `external_links_stamp_actor` BEFORE INSERT OR UPDATE -> `public.stamp_actor()`; `external_links_set_updated_at` BEFORE UPDATE -> `public.set_updated_at()`; `external_links_audit` AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW -> `private.audit_change('nav_group', 'label', 'url', 'provider', 'embed_url', 'embed_is_public', 'audience')`.
- RLS: `alter table public.external_links enable row level security;` `revoke all on public.external_links from anon, authenticated;` `grant select, insert, update, delete on public.external_links to authenticated;`. Policies (drop if exists, then create):
  - `"Members read external links"` for select to authenticated using `(private.is_company_member(company_id) and (audience = 'everyone' or private.can_manage_company(company_id)))`.
  - `"Admins create external links"` for insert with check `(private.can_manage_company(company_id))`.
  - `"Admins update external links"` for update using and with check `(private.can_manage_company(company_id))`.
  - `"Admins delete external links"` for delete using `(private.can_manage_company(company_id))`.
- Idempotency: `if not exists`, drop-then-create for triggers and policies, re-runnable grants; no seed rows.

#### SQL tests to write first: `supabase/tests/0031_external_links.test.sql`

Setup as system: `k_admin` (Kingdom admin), `k_emp` (Kingdom employee), `l_admin` (Klasik admin), `rococo` (Rococo admin, no company). Link body: nav_group `sales_finance`, label `Sample sales board`, url `https://example.com/monday/sample-sales-board`, provider `monday`.
1. `admin_creates_link`: as k_admin, insert an `everyone` link and an `admins` link (nav_group `home`); `created_by` is k_admin's profile id.
2. `employee_reads_everyone_links_only`: as k_emp, `count(*)` is 1 and the visible label is the `everyone` link.
3. `admin_reads_both`: as k_admin, 2 rows; as rococo, 2 rows.
4. `other_company_sees_nothing`: as l_admin, 0 Kingdom rows; inserting with Kingdom's `company_id` raises like `%row-level security%`.
5. `employee_cannot_write`: as k_emp, insert raises like `%row-level security%`; `update ... set label = 'Changed'` affects 0 rows; `delete` affects 0 rows; as system the label is unchanged and both rows still exist.
6. `https_only`: `url = 'http://example.com'` raises like `%external_links_url_check%`; `url = 'javascript:alert(1)'` raises the same; `embed_url = 'http://example.com'` raises like `%external_links_embed_url_check%`.
7. `public_embed_needs_embed_url`: `embed_is_public = true` with null `embed_url` raises like `%external_links_embed_public_check%`.
8. `nav_group_and_values_checked`: nav_group `utility` raises like `%external_links_nav_group_check%`; provider `slack` and audience `managers` raise on their checks; a blank label raises like `%external_links_label_check%`.
9. `company_pinned`: as k_admin, `update ... set company_id = klasik` keeps Kingdom.
10. `admin_deletes`: as k_admin, delete of the `admins` link removes it.
11. `audit_on_watched_change`: as k_admin update `label`; as system one new `audit_events` row with `table_name = 'external_links'` and `changed ? 'label'`; update only `sort_order`; no further row.

#### Service `src/services/externalLinks.ts`

Why-comment: links are rows a company admin keeps; who sees each one is decided by RLS on `audience`, so this module never filters by audience.
```ts
export interface ExternalLinkInput {
  company_id: string; nav_group: LinkNavGroup; label: string; url: string; provider: LinkProvider;
  destination_note?: string | null; embed_url?: string | null; embed_is_public?: boolean;
  audience: LinkAudience; sort_order: number;
}
export type ExternalLinkPatch = Partial<Omit<ExternalLinkInput, "company_id">>;
export async function listExternalLinks(companyId: string, opts?: { navGroup?: LinkNavGroup }): Promise<ExternalLink[]>; // nav_group, sort_order, label
export async function createExternalLink(input: ExternalLinkInput): Promise<ExternalLink>;
export async function updateExternalLink(id: string, patch: ExternalLinkPatch): Promise<ExternalLink>;
export async function deleteExternalLink(id: string): Promise<void>;
```
Explicit column list: `id, company_id, nav_group, label, destination_note, url, provider, embed_url, embed_is_public, audience, sort_order, created_by, updated_by, created_at, updated_at`. Filter by `company_id` (and `nav_group` when given); throw on error.

Mock `src/test/mocks/externalLinks.ts`: same names and types; seeded with `fromAll((b) => b.externalLinks).map((x) => ({ ...x }))`; returns every row of the company (it cannot know the caller; audience filtering is proven by the SQL test, never by UI code), filtered by `navGroup` when given and sorted by nav_group, sort_order, label; create assigns `link-new-<n>`; updates stamp `updated_at`; a missing id throws `new Error("Link not found.")`.

#### Components

- `ExternalLinkButton` `{ link: ExternalLink }`: an `<a href={link.url} target="_blank" rel="noopener noreferrer" aria-label="<label>, opens in a new tab">` styled as a quiet bordered row (`border border-line rounded-md px-3 py-2 hover:border-line-strong`), showing the label (`text-sm text-ink`), a `Badge tone="neutral"` with `LINK_PROVIDER_LABELS[provider]`, the host (`new URL(link.url).host`, in try, falling back to the raw URL) and "Opens in a new tab" (`text-[12px] text-ink-3`), the `destination_note` when set (`text-[12.5px] text-ink-2`), and an `ExternalLink` icon (`aria-hidden`). Import the icon as `ExternalLink as ExternalLinkIcon` from `lucide-react` so it does not shadow the `ExternalLink` type.
- `EmbedFrame` `{ link: ExternalLink }`: returns null unless `link.embed_is_public && link.embed_url`; otherwise a `figure`: `<iframe src={link.embed_url} sandbox="allow-scripts allow-same-origin allow-popups allow-forms" referrerPolicy="no-referrer" loading="lazy" title={link.label} className="h-[420px] w-full rounded-md border border-line bg-surface" />`, a `figcaption` "Public share view", and `ExternalLinkButton` for the same link beside it. Never an iframe for a link not flagged public.
- `ExternalLinksList` `{ companyId: string; navGroup: LinkNavGroup }`: `useAsync(() => listExternalLinks(companyId, { navGroup }))`; renders nothing while loading and nothing when empty; error renders `Notice tone="error"`; otherwise `Section eyebrow={NAV_GROUP_LABELS[navGroup] ?? ""} title="Outside tools"` with each link as an `ExternalLinkButton`, followed by its `EmbedFrame` when it has one.
- `ExternalLinksPanel` `{ companyId: string }`: `Section eyebrow="Shortcuts" title="External links" description="Links to the company's own outside tools, such as Monday boards, shown in the section you choose. People still sign in to those tools themselves."`.
  - Rows grouped by section (headings `NAV_GROUP_LABELS`), each with `BlurInput` fields (save on blur through `updateExternalLink`): Label (`ariaLabel="Label for <label>"`, `required`), Link (`ariaLabel="Link for <label>"`), What it is for (`destination_note`), Embed link (`embed_url`), Order (`type="number"`, `sort_order`); selects for Section (`nav_group`), Who sees it (`LINK_AUDIENCE_LABELS`), Tool (`LINK_PROVIDER_LABELS`); a checkbox "Show as a public embed" (disabled until an embed link is saved) with the hint "Only for a view the board owner has shared publicly. Anyone with that link can see what it shows, including data hidden from the view."; a delete `IconButton label="Remove <label>"` that opens `ConfirmDialog` (title "Remove this link?", body "People will no longer see it in the hub. The page it points to is not affected.", confirmLabel "Remove", `tone="danger"`).
  - An add row at the bottom: Label, Link (placeholder `https://`), Section (default Home), Who sees it (default Everyone), Tool (default Other), and an "Add link" button; `sort_order` = the group's highest plus one.
  - Client-side checks before any write, shown in a `Notice tone="error"`: blank label "The link needs a label."; a link or embed link not starting with `https://` "Links must start with https://."; turning on the embed with no embed link "Add the share view's embed link first.". The database checks are the real guard.

#### Fixtures

Kingdom `links` (all plainly fictional, `example.com` hosts):
1. `kingdom-link-1`: `sales_finance`, "Sample sales board", `https://example.com/monday/sample-sales-board`, provider `monday`, audience `everyone`, note "The sales CRM board. Monday asks you to sign in.", sort 1.
2. `kingdom-link-2`: `production`, "Sample production board", `https://example.com/monday/sample-production-board`, `monday`, `everyone`, note "Open tasks for active jobs.", sort 1.
3. `kingdom-link-3`: `home`, "Sample owner report", `https://example.com/reports/sample-owner`, `other`, audience `admins`, note "For admins only.", sort 1.
4. `kingdom-link-4`: `production`, "Sample schedule view", `https://example.com/monday/sample-schedule`, `monday`, `everyone`, `embed_url: "https://example.com/embed/sample-schedule"`, `embed_is_public: true`, sort 2.
All other fields default (`embed_url` null, `embed_is_public` false, `destination_note` as given).

#### Tests to write first (`src/pages/pages.test.tsx`, `describe("external links")`)

With `kingdomAdmin = makeHub("admin", KINGDOM.company)` and `kingdomEmployee = makeHub("employee", KINGDOM.company)`:
1. "lists Sales & Finance links with where they go": `<SalesFinancePage />` at `/sales-finance`: link named "Sample sales board, opens in a new tab" with href `https://example.com/monday/sample-sales-board`, `target="_blank"`, `rel` containing `noopener` and `noreferrer`; "example.com", "Opens in a new tab" and "The sales CRM board. Monday asks you to sign in." visible; no "Sample production board".
2. "embeds only a view flagged as public, with the direct link beside it": `<ProductionPage />` as `kingdomEmployee` at `/production`: exactly one `iframe`; it has `title="Sample schedule view"`, `src` the embed URL, `sandbox="allow-scripts allow-same-origin allow-popups allow-forms"`, `referrerpolicy="no-referrer"`, `loading="lazy"`; caption "Public share view"; a link "Sample schedule view, opens in a new tab" to `https://example.com/monday/sample-schedule`; "Sample production board" listed with no iframe of its own. (jsdom loads no frame, so nothing touches the network.)
3. "groups every readable link under its section on Home": `<DashboardPage />` as `kingdomAdmin`: within the Shortcuts card, "Sample owner report" under "Home", "Sample sales board" under "Sales & Finance", "Sample production board" and "Sample schedule view" under "Production"; no iframe on Home.
4. "shows no links to a company without the module": Klasik `admin` on `<DashboardPage />` has no "Outside tools" and no "Sample sales board"; `<CompanySettingsPage />` has no "External links" heading.
5. "keeps the links in Settings": `<CompanySettingsPage />` as `kingdomAdmin`: "External links" lists the four labels; adding with link `http://example.com/x` shows "Links must start with https://." and adds nothing; adding label "Sample estimating board" with `https://example.com/monday/sample-estimating` shows it in the list; changing the label of "Sample sales board" in its BlurInput and blurring shows the new label; ticking "Show as a public embed" on a link with no embed link shows "Add the share view's embed link first."; removing "Sample owner report" through the confirm dialog takes it off the list.

#### Design notes

Quiet bordered rows, hairlines, the tenant accent only on hover and focus; theme tokens only. The embed is framed by a hairline and always captioned "Public share view". No em dashes in copy. `BlurInput` for every save-on-blur field; `ConfirmDialog` for the one destructive action.

#### Verification

- `npm run lint`
- `npx vitest run`
- `npm run build`
- `npm run test:sql`
- No `supabase/functions` change, so no Deno check.
- Visual check: `npm run demo`, Playwright as in Task 6's script (fresh context per URL, `deviceScaleFactor: 1`, 1440x900, output `<scratch>/shots/task9/`, never the repo) for `/?persona=admin&company=kingdom`, `/?persona=employee&company=kingdom`, `/sales-finance?persona=admin&company=kingdom`, `/production?persona=employee&company=kingdom` (also at 390x844: the embed must fit the column), `/settings?persona=admin&company=kingdom`, `/?persona=admin&company=klasik`, `/settings?persona=admin&company=klasik`. The demo iframe may try to load example.com; that is a local visual check only and no test depends on it. Fix layout defects before committing.

#### Must NOT do

- No Monday API call, no copied CRM or task record, no Monday table.
- No iframe for a link not flagged `embed_is_public`; never a logged-in embed; never drop the direct link beside an embed.
- No audience filtering in UI code or in the service (RLS decides); `home` and `people_hr` links appear only on ShortcutsCard (R19).
- Do not add `frame-src` or `default-src` to `vercel.json`; do not touch any migration before 0031.
- Global Constraint 7: nothing applied to the live Supabase project, nothing deployed; Supabase MCP read-only.
- Global Constraint 8: fixtures plainly fictional, `example.com` hosts only.
- Global Constraint 9: no undefined business logic (no signal routing to Monday destinations, no rules on which link shows when).
- Global Constraint 10: nothing writes to `sync_runs` or `sync_records`; no writeback to Google, QuickBooks or Monday.

#### Commits

1. `Add the external links registry with audience enforced in the database`
2. `Show outside tools and approved public embeds in each section and on Home`
3. `Keep each company's external links in Settings`

Each message ends with the session's standard attribution trailer lines.

---


### Task 10: Edge Function sync routes and the Google Sheets provider

#### Goal and fit

Make a data source live: the `connections` Edge Function gains three sync routes (`/sync/run` for Sync now, `/sync/tick` for the hourly schedule, `/sync/describe` for reading a sheet's tabs and headers), a supabase-js implementation of the runner's store, a token store over `connection_tokens`, and a real Google Sheets provider (OAuth connect and disconnect, plus a read-only adapter). Migration `0032_sync_schedule.sql` schedules the hourly tick with pg_cron and pg_net, reading its URL and secret from Vault. The function stays the only reader of `connection_tokens` (rule 6) and nothing is deployed or applied in this run.

Builds on (restated so this section stands alone):
- Task 1: the SQL harness. `npm run test:sql` runs `bash supabase/tests/run.sh`, which starts a throwaway PostgreSQL 16, loads `supabase/tests/stubs.sql` (Supabase stand-ins including schemas `vault` with `create_secret` and `decrypted_secrets`, `cron` with `schedule`, `unschedule` and `job`, and `net` with `http_post`), applies every migration in order after stripping exactly the `create extension ... pg_cron` and `create extension ... pg_net` lines, applies every file from 0024 up a second time, loads `supabase/tests/helpers.sql`, then runs each `supabase/tests/*.test.sql` in its own transaction that is rolled back. Helpers (schema `tests`): `tests.company(slug) returns uuid`, `tests.create_person(name, company uuid, role text default 'employee', rococo boolean default false) returns uuid`, `tests.id(name) returns uuid`, `tests.act_as(profile uuid)`, `tests.assert(ok boolean, message text)`, `tests.assert_raises(sql text, like text)`; return to system with `reset role; select set_config('request.jwt.claims', '', true);`.
- Task 7 (`supabase/functions/_shared/sync/`, pure, no Deno or npm imports):
  - `types.ts`: `FieldType`, `SyncProvider = "google_sheets" | "quickbooks"`, `SheetsSourceConfig { spreadsheet_id: string; sheet_gid: number; range: string | null; header_row: number }` (header_row 1-based), `QuickBooksSourceConfig { entity: "Invoice" | "Payment" }`, `SourceConfig`, `SyncSourceSpec { id; company_id; connection_id; provider; config; field_map; record_key; enabled; sync_weekday; sync_time; sync_timezone; current_run_id; last_attempt_at; last_success_at }`, `CellValue = string | number | boolean | null`, `RawRow { cells: CellValue[]; ref: Record<string, unknown> }`, `RawTable { headers: CellValue[]; rows: RawRow[] }`, `ParsedRow { key; data; source_ref }`, `ProviderTokens { accessToken: string; refreshToken: string | null; accessExpiresAt: string | null; refreshExpiresAt: string | null }`, `TokenStore { load(connectionId): Promise<ProviderTokens>; save(connectionId, tokens): Promise<void> }`, `ConnectionRef { id: string; external_account_id: string | null }`, `ProviderAdapter { provider: SyncProvider; read(source: SyncSourceSpec, connection: ConnectionRef): Promise<RawTable> }`, `AdapterRegistry = Partial<Record<SyncProvider, ProviderAdapter>>`.
  - `runner.ts`: `STALE_RUN_MINUTES = 15`; `interface SyncStore { abandonStaleRuns(connectionId: string, olderThan: Date): Promise<number>; startRun(input: { source: SyncSourceSpec; trigger: "schedule" | "manual"; requestedBy: string | null; now: Date }): Promise<{ runId: string } | { locked: true }>; insertRecords(runId: string, source: SyncSourceSpec, rows: ParsedRow[]): Promise<void>; markSource(sourceId: string, patch: { current_run_id?: string; last_success_at?: string; last_status: "succeeded" | "failed"; last_error: string | null }): Promise<void>; finishRun(runId: string, result: { status: "succeeded" | "failed"; rowsRead: number; rowsApplied: number; rowsBlank: number; errorDetail: unknown | null; finishedAt: Date }): Promise<void>; pruneRecords(sourceId: string, keepRunIds: string[]): Promise<void> }`; `RunOutcome { status: "succeeded" | "failed" | "locked"; runId: string | null; rowsRead; rowsApplied; rowsBlank; errors; message: string | null }`; `runSync({ source, connection, trigger, requestedBy, store, adapters, now? }): Promise<RunOutcome>`, which calls `abandonStaleRuns(now - 15 min)`, then `startRun` (locked returns at once), then the adapter's `read` (no adapter fails with "Provider not supported yet"; a throw fails with the error's message), then `mapRows`, `insertRecords`, `markSource(succeeded, pointer)`, `finishRun`, `pruneRecords`; on failure the pointer and `last_success_at` are never touched.
  - `schedule.ts`: `isDue(source: Pick<SyncSourceSpec, "enabled" | "sync_weekday" | "sync_time" | "sync_timezone" | "last_attempt_at">, now: Date): boolean` (enabled, scheduled, and last attempt null or before the latest weekly slot; R13).
  - `links.ts`: `parseSpreadsheetUrl(url): { spreadsheetId: string; gid: number | null } | null`.
  - `parse.ts`: `normalizeHeader(header: string): string`.
- Task 7 database (0030): `company_connections_provider_check` allows `('gohighlevel','quickbooks','google_sheets')`; `public.sync_sources` (columns `id, company_id, connection_id, provider, name, target_module, config, field_map, record_key, sync_weekday, sync_time, sync_timezone, stale_after_hours, enabled, current_run_id, last_attempt_at, last_success_at, last_status, last_error, sync_requested_at, created_by, updated_by, created_at, updated_at`), `public.sync_runs` (`id, company_id, source_id, connection_id, trigger_kind, requested_by, status, started_at, finished_at, rows_read, rows_applied, rows_blank, error_detail`), `public.sync_records` (`id, company_id, source_id, run_id, record_key, data, source_ref, created_at`), the lock `sync_runs_one_running_per_connection` (unique on `connection_id` where `status = 'running'`), `private.can_sync_source(cid)`, and the policy `"Admins and syncers update sync sources"` (update using and with check `private.can_manage_company(company_id) or private.can_sync_source(company_id)`), with a guard that lets a sync-only caller change `sync_requested_at` and nothing else. `sync_runs` and `sync_records` have no write policy for `authenticated`; the service role writes them.
- Task 7 UI: `ConnectionsPanel` takes `{ companyId: string; providers?: ConnectionProvider[] }` (default `["gohighlevel", "quickbooks"]`) and already carries the blurb `google_sheets: "Reporting tabs from the company's own spreadsheets, read-only, refreshed on a schedule."`; `ConnectionProvider` and `CONNECTION_PROVIDER_LABELS` already include `google_sheets: "Google Sheets"`.
- Task 8: `src/services/invoke.ts` (`invokeFunction<T>(path, body)`, surfaces the function's JSON `error` line), `src/services/sync.ts` and its mock `src/test/mocks/sync.ts` (with `requestSync(sourceId)` calling `invokeFunction("connections/sync/run", { source_id })` and returning `SyncRunResult { status: "succeeded" | "failed" | "locked"; message: string | null; rows_applied: number }`), `src/lib/sync/draft.ts` (`FieldDraft { header; key; label; type; unit; required }`, `SourceDraft`, `fieldFromHeader(header)`), and `DataSourcesPanel` (`src/components/settings/DataSourcesPanel.tsx`), whose Google Sheets editor has the "Google Sheets link" input with the readout "Spreadsheet <id>, tab <gid>". `CompanySettingsPage` already imports `hasModule` and renders `DataSourcesPanel` under `data_sources`. The `vi.mock("../services/sync.ts", ...)` line and the demo alias entry for `sync` already exist. Fixtures: Kingdom has `kingdom-conn-sheets` (google_sheets, connected, `external_account_name: "sample-reports@example.com"`) and `kingdom-conn-qbo` (quickbooks, `not_connected`).
- Task 2: `hasModule(company, key)` from `src/lib/modules.ts` is the only reader of `companies.modules`; module key `data_sources` gates the Google row. `KINGDOM` fixture bundle; `makeHub(persona, company)`.

#### Files

Create:
- `supabase/functions/_shared/providers.ts`: `export const PROVIDER_KEYS = ["gohighlevel", "quickbooks", "google_sheets"] as const; export type ProviderKey = (typeof PROVIDER_KEYS)[number];` with a why-comment: the one list of provider keys the function, the 0030 check and `CONNECTION_PROVIDER_LABELS` must agree on.
- `supabase/functions/_shared/sync/googleSheets.ts`: Google's OAuth URL, id_token email, Sheets reads and the adapter (pure; `fetch` injected).
- `supabase/functions/connections/http.ts`: the request helpers `index.ts` and `sync.ts` share (moved out of `index.ts`, see below), so `sync.ts` never imports `index.ts` (which calls `Deno.serve` at load).
- `supabase/functions/connections/sync.ts`: `handleSyncRun(req)`, `handleSyncTick(req)`, `handleSyncDescribe(req)`, `createSyncStore(service)`, `createTokenStore(service)`, `adaptersFor(tokens)`.
- `supabase/migrations/0032_sync_schedule.sql`.
- `supabase/tests/0032_sync_schedule.test.sql`.
- `src/lib/sync/googleSheets.test.ts` (fake fetch).
- `src/lib/sync/providers.test.ts`.

Modify:
- `supabase/functions/connections/index.ts` (366 lines at commit 6d9bfc5):
  - Header comment (lines 1-18): list the new routes (`POST /sync/run { source_id }` with the user's JWT, `POST /sync/tick` with the `x-sync-secret` header, `POST /sync/describe { connection_id, spreadsheet_id, gid }` with an admin's JWT) and the new secrets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SYNC_CRON_SECRET`; say the sync routes live here so this stays the only reader of `connection_tokens`.
  - Line 22: `type Provider = ProviderKey;` with `import { PROVIDER_KEYS, type ProviderKey } from "../_shared/providers.ts";`.
  - Move to `http.ts` and import back: `HttpError` (lines 47-53), `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SERVICE_ROLE_KEY` (lines 55-57), `CORS` (63-67), `readJson` (72-83), `sameBytes` (209-214), `requireAdmin` (244-256, rewritten below), `service` (258), `json` (260). `STATE_SECRET`, `APP_ORIGINS`, `REDIRECT_URI`, the providers, state signing, `checkReturnTo`, `redirect`, `backTo` and the three OAuth handlers stay in `index.ts`.
  - New `google_sheets: ProviderDef` beside `gohighlevel` and `quickbooks` (below); `PROVIDERS` (line 174) becomes `{ gohighlevel, quickbooks, google_sheets }`; `providerFor` (176-179) accepts any value in `PROVIDER_KEYS`: `if (typeof value === "string" && (PROVIDER_KEYS as readonly string[]).includes(value)) { const key = value as Provider; return { ...PROVIDERS[key], key }; }`.
  - `Deno.serve` (353-366): before the existing routes, `if (req.method === "POST" && path.endsWith("/sync/run")) return await handleSyncRun(req);`, the same for `/sync/tick` and `/sync/describe`.
- `src/services/sync.ts`: add `SpreadsheetDescription` and `describeSpreadsheet` (below).
- `src/test/mocks/sync.ts`: the same two exports.
- `src/lib/sync/draft.ts` and `src/lib/sync/draft.test.ts`: add `withHeaders` (below).
- `src/components/settings/DataSourcesPanel.tsx`: the "Read headers" button in the Google Sheets part of the editor (below).
- `src/pages/CompanySettingsPage.tsx`: the `<ConnectionsPanel companyId={company!.id} />` element (line 94 at commit 6d9bfc5; earlier tasks shift it) becomes `<ConnectionsPanel companyId={company!.id} providers={hasModule(company!, "data_sources") ? GOOGLE_ROW_PROVIDERS : undefined} />` with a module-level `const GOOGLE_ROW_PROVIDERS: ConnectionProvider[] = ["gohighlevel", "quickbooks", "google_sheets"];` (import `type ConnectionProvider`). With the module off, nothing changes.
- `src/pages/pages.test.tsx`: new cases in `describe("data sources")` (below).

#### `connections/http.ts`

Why-comment: helpers both the OAuth routes and the sync routes use; nothing here reads a token.
- `export class HttpError` (verbatim), `export const SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SERVICE_ROLE_KEY` (verbatim `Deno.env.get(...) ?? ""`), `export const CORS` (verbatim), `export async function readJson<T>` (verbatim), `export function sameBytes` (verbatim), `export const service = () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })`, `export const json` (verbatim).
- `export async function signedInUser(req: Request): Promise<{ jwt: string; userId: string; asUser: SupabaseClient }>`: the first four lines of today's `requireAdmin` (Bearer token, `createClient` with the anon key and the caller's `Authorization` header, `auth.getUser(jwt)`); throws `HttpError(401, "Sign in first.")`.
- `export async function requireAdmin(req: Request, companyId: string): Promise<string>`: uses `signedInUser`, selects `id, role, company_id, is_rococo_admin, is_active` from `profiles` where `user_id` is the caller, and allows only `profile.is_active && (profile.is_rococo_admin || ((profile.role === "owner" || profile.role === "admin") && profile.company_id === companyId))`; otherwise `HttpError(403, "Only a company admin can manage connections.")`. Returns the profile id. (Owner and admin both carry today's admin meaning; `manager` is employee-level; an inactive person is refused, which fixes the side finding that the function never checked `is_active`.)
- `import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";` here; `index.ts` keeps its own `import "jsr:@supabase/functions-js/edge-runtime.d.ts";`.

#### Google Sheets ProviderDef (in `index.ts`)

```ts
const google_sheets: ProviderDef = {
  label: "Google Sheets",
  env: { id: "GOOGLE_CLIENT_ID", secret: "GOOGLE_CLIENT_SECRET" },
  authorizeUrl: ({ clientId, redirectUri, state }) => googleAuthorizeUrl({ clientId, redirectUri, state }),
  exchange: async ({ clientId, clientSecret, code, redirectUri }) => { ... },
  revoke: async ({ accessToken, refreshToken }) => { ... },
};
```
- `exchange`: `POST https://oauth2.googleapis.com/token`, `Content-Type: application/x-www-form-urlencoded`, body `code, client_id, client_secret, redirect_uri, grant_type=authorization_code`; `readJson<{ access_token: string; refresh_token?: string; expires_in?: number; scope?: string; id_token?: string }>(response, "The Google sign-in")`; `const email = token.id_token ? emailFromIdToken(token.id_token) : null;` and when null throw `new HttpError(400, "Google did not say which account was connected. Try again from Settings.")`. Return `{ accessToken, refreshToken: token.refresh_token ?? null, accessExpiresAt: secondsFromNow(token.expires_in), refreshExpiresAt: null, externalAccountId: email, externalAccountName: email, scopes: token.scope ?? GOOGLE_SCOPES }`. The id_token comes straight from Google's token endpoint over TLS, so its payload is read, not verified (Google documents this as safe for tokens received directly).
- `revoke`: `POST https://oauth2.googleapis.com/revoke` with form body `token=<refreshToken ?? accessToken>` (best effort; `handleDisconnect` already catches and logs).
- The callback path is unchanged: it upserts `company_connections` with `provider: "google_sheets"` and the tokens into `connection_tokens`, then sends the browser to `/settings?connected=google_sheets`, which `ConnectionsPanel` already turns into "Google Sheets is connected.".

#### `_shared/sync/googleSheets.ts`

Why-comment: everything the function needs to read a company's own Google Sheets, read-only, with `fetch` injected so it is unit-tested without the network; no Deno, npm or `jsr:` import; `import type` from `./types.ts`. Exports:
```ts
export const GOOGLE_SCOPES = "openid email https://www.googleapis.com/auth/spreadsheets.readonly";
export function googleAuthorizeUrl(args: { clientId: string; redirectUri: string; state: string }): string;
export function emailFromIdToken(idToken: string): string | null;
export function sheetRange(title: string, range: string | null): string;
export function valuesToRawTable(values: CellValue[][], config: SheetsSourceConfig, sheetTitle: string): RawTable;
export function sheetTitleForGid(meta: unknown, gid: number): string | null;
export interface GoogleDeps { clientId: string; clientSecret: string; tokens: TokenStore; fetch: typeof fetch; now: () => Date }
export interface SheetDescription { title: string; tabs: Array<{ gid: number; title: string }>; headers: string[] }
export function describeSheet(deps: GoogleDeps, connection: ConnectionRef, spreadsheetId: string, gid: number | null): Promise<SheetDescription>;
export function createGoogleSheetsAdapter(deps: GoogleDeps): ProviderAdapter;
```
Behaviour:
- `googleAuthorizeUrl`: `https://accounts.google.com/o/oauth2/v2/auth?` plus `URLSearchParams({ client_id, redirect_uri, response_type: "code", scope: GOOGLE_SCOPES, access_type: "offline", prompt: "consent", include_granted_scopes: "true", state })`. `access_type=offline` and `prompt=consent` make Google return a refresh token on every connect.
- `emailFromIdToken`: split on "."; not three parts: null; base64url-decode the middle part (`-` to `+`, `_` to `/`, pad with `=`, `atob`, then `TextDecoder` over the bytes); `JSON.parse` inside try (any throw: null); return `payload.email` when it is a non-empty string and `payload.email_verified !== false`, else null.
- `sheetRange(title, range)`: `'<title with every ' doubled>'`, plus `!<range>` when `range` is non-blank (trimmed; a range that already contains `!` keeps only the part after the last `!`, since the tab is chosen by gid).
- `valuesToRawTable(values, config, sheetTitle)`: rows in `values` are the sheet's rows from the range's first row down (Sheets omits trailing empty rows and cells; a short row reads blank in `mapRows`). `startRow` is the row number at the start of `config.range` (digits after the column letters of its first cell, for example `B5:H` gives 5; no range or a column-only range such as `A:F` gives 1). `header_row` is the sheet's own row number, as the person sees it in Google Sheets. `const index = config.header_row - startRow;` `index < 0` throws `new Error("The header row is above the range. Check the header row and range for this source.")`; `index >= values.length` throws `` new Error(`The tab "${sheetTitle}" has no row ${config.header_row} to read headers from.`) ``. Headers are `values[index]`; every later row becomes `{ cells: row, ref: { spreadsheet_id: config.spreadsheet_id, sheet_gid: config.sheet_gid, row: startRow + i } }` where `i` is its index in `values`.
- `sheetTitleForGid(meta, gid)`: reads `meta.sheets[].properties.{ sheetId, title }` defensively (any other shape: null); the title whose `sheetId === gid`, else null.
- Access token (a private `accessToken(deps, connectionId)`): `tokens.load(connectionId)`; when `accessExpiresAt` is null or within 5 minutes of `deps.now()` (`Date.parse(accessExpiresAt) - now <= 300000`), refresh: no `refreshToken` throws `new Error("Google did not leave a way to stay signed in. Disconnect Google Sheets in Settings and connect it again.")`; `POST https://oauth2.googleapis.com/token` (form: `client_id, client_secret, refresh_token, grant_type=refresh_token`); a non-2xx answer throws `new Error("Google sign-in has expired or was removed. Connect Google Sheets again in Settings.")` and saves nothing; on success `await tokens.save(connectionId, { accessToken: body.access_token, refreshToken: body.refresh_token ?? old.refreshToken, accessExpiresAt: new Date(now + body.expires_in * 1000).toISOString(), refreshExpiresAt: old.refreshExpiresAt })` before any Sheets call.
- Sheets calls (a private `sheetsGet(deps, token, url)`), always `method: "GET"`, headers `Authorization: Bearer <token>` and `Accept: application/json`. Status mapping, with no token or response body ever in a message: 401 or 403 `"Google refused access to that spreadsheet. Check that the connected Google account can open it."`; 404 `"That spreadsheet was not found. Check the link."`; 429 `"Google asked us to slow down. Try again in a few minutes."`; any other non-2xx or unparseable JSON `"Google Sheets did not answer. Try again later."`.
- The spreadsheet id must match `^[A-Za-z0-9_-]+$` before it goes into a URL, else `new Error("That spreadsheet id is not valid. Paste the Google Sheets link again.")`.
- Metadata: `GET https://sheets.googleapis.com/v4/spreadsheets/<id>?fields=properties.title,sheets.properties(sheetId,title,index)` (the `fields` value passed through `encodeURIComponent`).
- Values: `GET https://sheets.googleapis.com/v4/spreadsheets/<id>/values:batchGet?` with `URLSearchParams({ ranges: sheetRange(title, range), valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "SERIAL_NUMBER", majorDimension: "ROWS" })`; `valueRanges[0].values ?? []`. Never `FORMATTED_VALUE`: numbers stay numbers and dates stay serials for `parseCell`.
- `createGoogleSheetsAdapter(deps)`: `{ provider: "google_sheets", read }`. `read(source, connection)`: a config without a string `spreadsheet_id` and an integer `sheet_gid` throws `new Error("This source is not set up for Google Sheets.")`; token; metadata; `sheetTitleForGid` null throws `new Error("That tab was not found in the spreadsheet. It may have been deleted.")`; values; `valuesToRawTable(values, config, title)`. The tab is found by its numeric gid on every run, so a renamed tab keeps working.
- `describeSheet(deps, connection, spreadsheetId, gid)`: token; metadata; `tabs` = sheets in `index` order as `{ gid: sheetId, title }`; the chosen tab is the one with `gid`, or the first tab when `gid` is null (none: the "That tab was not found..." error); values for `sheetRange(tab.title, "1:1")`; `headers` = the first row's cells as trimmed strings (numbers and booleans through `String`), trailing blanks dropped; `title` = `properties.title`.

#### `connections/sync.ts`

Why-comment: the sync routes run inside the `connections` function so it stays the only reader of `connection_tokens` (rule 6); Sync now is authorised by the caller's own write under RLS (`private.can_sync_source`), never by a role check in TypeScript; the cron tick is authorised by a shared secret that can only start a sync.
Imports: `./http.ts`, `../_shared/sync/runner.ts` (`runSync`, `type SyncStore`), `../_shared/sync/schedule.ts` (`isDue`), `../_shared/sync/googleSheets.ts`, `type`s from `../_shared/sync/types.ts`, and `type SupabaseClient` from `npm:@supabase/supabase-js@2`.
- Private `const SOURCE_COLUMNS = "id, company_id, connection_id, provider, name, config, field_map, record_key, enabled, sync_weekday, sync_time, sync_timezone, current_run_id, last_attempt_at, last_success_at";` and `const CONNECTION_COLUMNS = "id, company_id, provider, status, external_account_id";`.
- `export function createTokenStore(service: SupabaseClient): TokenStore`: `load` selects `access_token, refresh_token, access_expires_at, refresh_expires_at` from `connection_tokens` by `connection_id` (`maybeSingle`); no row throws `new Error("This connection has no sign-in on file. Connect it again in Settings.")`. `save` updates the same four columns plus `updated_at` for that `connection_id`; any error throws `new Error("The new sign-in could not be saved.")` (log the database error with `console.error`, never the tokens).
- `export function createSyncStore(service: SupabaseClient): SyncStore`:
  - `abandonStaleRuns(connectionId, olderThan)`: `update sync_runs set status = 'abandoned', finished_at = now where connection_id = $1 and status = 'running' and started_at < olderThan` returning `source_id`; for those sources `update sync_sources set last_status = 'failed', last_error = 'The sync stopped before finishing.' where id in (...) and last_status = 'running'`; returns the number of runs.
  - `startRun({ source, trigger, requestedBy, now })`: insert into `sync_runs` `{ company_id: source.company_id, source_id: source.id, connection_id: source.connection_id, trigger_kind: trigger, requested_by: requestedBy, status: "running", started_at: now.toISOString() }` selecting `id`; error code `23505` returns `{ locked: true }`; any other error throws `new Error("The sync could not start.")`. Then `update sync_sources set last_status = 'running', last_attempt_at = now where id = source.id`. Returns `{ runId }`.
  - `insertRecords(runId, source, rows)`: inserts `{ company_id: source.company_id, source_id: source.id, run_id: runId, record_key: row.key, data: row.data, source_ref: row.source_ref }` in chunks of 500; any error throws `new Error("The rows could not be saved.")`.
  - `markSource(sourceId, patch)`: `update sync_sources set <patch> where id = sourceId`.
  - `finishRun(runId, result)`: `update sync_runs set status, rows_read, rows_applied, rows_blank, error_detail, finished_at`.
  - `pruneRecords(sourceId, keepRunIds)`: `delete from sync_records where source_id = $1 and run_id not in (keepRunIds)` (`.not("run_id", "in", \`(${keepRunIds.join(",")})\`)`).
  - Every method throws on a database error (the runner turns a throw into a failed run).
- `export function adaptersFor(tokens: TokenStore): AdapterRegistry`: `{ google_sheets: <adapter> }`, where the adapter is `createGoogleSheetsAdapter({ clientId, clientSecret, tokens, fetch, now: () => new Date() })` when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set, else a private `unconfigured("google_sheets", "Google Sheets")` adapter whose `read` throws `new Error("Google Sheets is not set up yet. Ask Rococo Creative to add the app keys.")`. QuickBooks is registered here by Task 11; until then a QuickBooks source fails with the runner's "Provider not supported yet".
- Private `async function runOne(service, source, connection, trigger, requestedBy)`: `runSync({ source, connection: { id, external_account_id }, trigger, requestedBy, store: createSyncStore(service), adapters: adaptersFor(createTokenStore(service)), now: () => new Date() })`; on `succeeded` also `update company_connections set last_synced_at = now where id = connection.id` (the Connections card's "last sync" line). Returns the outcome.
- `export async function handleSyncRun(req)`: body `{ source_id }` (not a non-empty string: `HttpError(400, "Missing source.")`). `const { asUser, userId } = await signedInUser(req);` then, acting as the user, `asUser.from("sync_sources").update({ sync_requested_at: new Date().toISOString() }, { count: "exact" }).eq("id", sourceId)`; an error or `count !== 1` throws `HttpError(403, "That source was not found, or you cannot sync it.")`. Only that one-row write, allowed by `private.can_sync_source` under RLS, authorises the run. Then with `service()`: load the source (`SOURCE_COLUMNS`) and its connection (`CONNECTION_COLUMNS`); a connection whose `status` is not `connected` throws `HttpError(409, \`Connect ${label} in Settings first.\`)` with `label` "Google Sheets" or "QuickBooks Online". `requestedBy` is the caller's profile id (`asUser.from("profiles").select("id").eq("user_id", userId).maybeSingle()`, null when none). A disabled source may still be synced by hand (so an admin can test it before enabling it). Respond `json(200, { status: outcome.status, message: outcome.message, rows_applied: outcome.rowsApplied })`, which is `SyncRunResult`.
- `export async function handleSyncTick(req)`: `const secret = Deno.env.get("SYNC_CRON_SECRET") ?? "";` empty: `HttpError(503, "Scheduled syncs are not set up yet.")`. Compare in constant time: SHA-256 both the header `x-sync-secret` (missing reads as "") and the secret with `crypto.subtle.digest`, then `sameBytes`; a mismatch throws `HttpError(401, "Not allowed.")`. With `service()`: enabled sources with a schedule (`.eq("enabled", true).not("sync_weekday", "is", null)`), their connections (`.in("id", ids)`), keep `isDue(source, now)`, drop sources whose connection is not `connected` (nothing is written for them), group by `connection_id`, and run one connection at a time and, within it, one source at a time (`runOne(..., "schedule", null)`), so sources sharing a connection never meet on the lock and a QuickBooks refresh token never rotates twice at once. Stop starting new sources after a private `TICK_BUDGET_MS = 100_000` of wall time; the rest stay due and run on the next hourly tick. One source's failure never stops the loop. Respond `json(200, { due: <count>, ran: [{ source_id, status }] })`. Log only ids and statuses.
- `export async function handleSyncDescribe(req)`: body `{ connection_id, spreadsheet_id, gid }`; `connection_id` missing: `HttpError(400, "Missing connection.")`; `spreadsheet_id` not matching `^[A-Za-z0-9_-]+$`: `HttpError(400, "That does not look like a Google Sheets link.")`; `gid` must be null or a non-negative integer (else the same 400). Load the connection with `service()`; none: `HttpError(404, "That connection was not found.")`; `await requireAdmin(req, connection.company_id)`; not `google_sheets` or not `connected`: `HttpError(409, "Connect Google Sheets in Settings first.")`. Then `describeSheet({ clientId, clientSecret, tokens: createTokenStore(service), fetch, now }, connection, spreadsheetId, gid)` (Google keys missing: `HttpError(503, "Google Sheets is not set up yet. Ask Rococo Creative to add the app keys.")`); an `Error` thrown by it becomes `HttpError(502, error.message)`. Respond `json(200, description)`.

#### Migration `0032_sync_schedule.sql`

Header comment: what it schedules and why (an hourly tick at minute 7 calls the `connections` function's `/sync/tick`; the function works out which sources are due from each source's own weekday, time and zone); "Paste after 0031 and after the two Vault entries exist; idempotent."; the URL and secret live in Vault by name and never in this file; neither extension is installed on the live project today. Exactly:
```sql
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'hub-sync-tick') then
    perform cron.unschedule('hub-sync-tick');
  end if;
end $$;

select cron.schedule(
  'hub-sync-tick',
  '7 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'sync_function_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  )
  $job$
);
```
Idempotency: unschedule first, so a second run leaves exactly one job. The harness strips exactly the two `create extension` lines and supplies stub `cron`, `net` and `vault` schemas. Accepted trade-off (state it in the comment): pg_net keeps the decrypted header in its request queue until it is sent; the cron secret can only start a sync.

#### SQL tests to write first: `supabase/tests/0032_sync_schedule.test.sql`

Each case a `-- case: <name>` block of DO blocks calling `tests.assert`:
1. `job_scheduled_once`: `select count(*) from cron.job where jobname = 'hub-sync-tick'` is 1 (the harness applied 0032 twice, so this proves the unschedule).
2. `hourly_at_minute_seven`: that job's `schedule` is `'7 * * * *'`.
3. `secrets_read_from_vault_by_name`: its `command` contains `vault.decrypted_secrets`, `'sync_function_url'`, `'sync_cron_secret'` and `x-sync-secret`.
4. `no_url_or_secret_in_job`: its `command` does not contain `https://` and does not contain `supabase.co`.
5. `command_runs`: as system, `select vault.create_secret('sample-cron-secret', 'sync_cron_secret')` and `select vault.create_secret('https://example.supabase.co/functions/v1/connections/sync/tick', 'sync_function_url')`, then `execute (select command from cron.job where jobname = 'hub-sync-tick')` raises nothing. Then assert the newest `net.requests` row has `url` equal to the sample URL and `headers ->> 'x-sync-secret'` equal to `sample-cron-secret` (Task 1's stub records both). Read `supabase/tests/stubs.sql` first: the test is written against the stubs as they are (pg_cron's `cron.job (jobid, schedule, command, jobname)` and pg_net's named arguments `url, headers, body, timeout_milliseconds`).

#### TypeScript tests to write first

`src/lib/sync/providers.test.ts`:
- every key in `PROVIDER_KEYS` appears inside the `company_connections_provider_check` list of `supabase/migrations/0030_sync_engine.sql`, read with `node:fs`. The app's `tsc -b` has no `@types/node`, so a static `import ... from "node:fs"` fails the build; load it dynamically through a non-literal specifier inside the test: `const fsModule = "node:fs"; const { readFileSync } = (await import(/* @vite-ignore */ fsModule)) as { readFileSync(path: URL, encoding: "utf8"): string };` and `readFileSync(new URL("../../../supabase/migrations/0030_sync_engine.sql", import.meta.url), "utf8")`; extract the list with `/company_connections_provider_check\s+check\s*\(\s*provider\s+in\s*\(([^)]*)\)/i` and compare the quoted values as a set to `PROVIDER_KEYS`.
- `[...PROVIDER_KEYS].sort()` equals `keysOf(CONNECTION_PROVIDER_LABELS).sort()`.

`src/lib/sync/googleSheets.test.ts` (imports `../../../supabase/functions/_shared/sync/googleSheets.ts`; a fake fetch built with `vi.fn` that records `{ url, method, headers, body }` for every call and answers from a queue with `new Response(JSON.stringify(body), { status })`; a fake `TokenStore` that records `save` calls into the same ordered log; fixed `now = () => new Date("2026-11-09T14:00:00Z")`):
1. `GOOGLE_SCOPES` is exactly `"openid email https://www.googleapis.com/auth/spreadsheets.readonly"`.
2. `googleAuthorizeUrl({ clientId: "sample-client", redirectUri: "https://example.supabase.co/functions/v1/connections/callback", state: "sample-state" })`: origin `https://accounts.google.com`, path `/o/oauth2/v2/auth`, and search params `client_id`, `redirect_uri`, `response_type=code`, `scope` equal to `GOOGLE_SCOPES`, `access_type=offline`, `prompt=consent`, `include_granted_scopes=true`, `state=sample-state`.
3. `emailFromIdToken`: a token built in the test as `header.<base64url of {"email":"sample-reports@example.com","email_verified":true}>.sig` gives `"sample-reports@example.com"`; with `email_verified: false` null; with no email null; `"not-a-token"` null; `"a.%%%.c"` null.
4. `sheetRange`: `("Sample sales", null)` -> `'Sample sales'`; `("Sam's tab", null)` -> `'Sam''s tab'`; `("Sample sales", "A1:F")` -> `'Sample sales'!A1:F`; `("Sample sales", "Other!B2:C")` -> `'Sample sales'!B2:C`; `("Sample sales", "  ")` -> `'Sample sales'`.
5. `valuesToRawTable`, config `{ spreadsheet_id: "sample-sheet", sheet_gid: 42, range: null, header_row: 1 }`, values `[["Job", "Amount"], ["Sample job 101", 250000], [], ["Sample job 102"]]`: headers `["Job", "Amount"]`; three rows with refs `{ spreadsheet_id: "sample-sheet", sheet_gid: 42, row: 2 }`, rows 3 and 4; the empty row keeps `cells: []`. `header_row: 2` with a title row first: headers from `values[1]`, first data ref row 3. Range `"B5:D"` with `header_row: 5`: headers from `values[0]`, first data ref row 6. Range `"A5:D"` with `header_row: 3` throws "The header row is above the range. Check the header row and range for this source.". `values = []` throws `The tab "Sample sales" has no row 1 to read headers from.`.
6. `sheetTitleForGid`: meta `{ sheets: [{ properties: { sheetId: 0, title: "Sample sales", index: 0 } }, { properties: { sheetId: 42, title: "Sample finance", index: 1 } }] }` with 42 -> "Sample finance"; 7 -> null; `null` -> null; `{ sheets: "x" }` -> null.
7. Adapter, fresh token (`accessExpiresAt` one hour after `now`): exactly two calls, both `GET`; the first URL starts `https://sheets.googleapis.com/v4/spreadsheets/sample-sheet?fields=`; the second is `.../sample-sheet/values:batchGet?` whose search params carry `ranges='Sample finance'`, `valueRenderOption=UNFORMATTED_VALUE`, `dateTimeRenderOption=SERIAL_NUMBER`; both carry `Authorization: Bearer sample-access`; `save` never called; the returned table has the refs of case 5.
8. Adapter, token expiring in two minutes: the first call is `POST https://oauth2.googleapis.com/token` whose form body has `grant_type=refresh_token`, `refresh_token=sample-refresh`, `client_id=sample-client`; then `save` with `{ accessToken: "sample-access-2", refreshToken: "sample-refresh", accessExpiresAt: "2026-11-09T15:00:00.000Z", refreshExpiresAt: null }` (answer `{ access_token: "sample-access-2", expires_in: 3600 }`); the log shows `save` before the first Sheets call; both Sheets calls use `Bearer sample-access-2`.
9. Adapter, `accessExpiresAt: null`: refreshes first.
10. Adapter, expired with `refreshToken: null`: rejects with "Google did not leave a way to stay signed in. Disconnect Google Sheets in Settings and connect it again."; no fetch call.
11. Adapter, refresh answered 400 `{ error: "invalid_grant" }`: rejects with "Google sign-in has expired or was removed. Connect Google Sheets again in Settings."; `save` never called.
12. Adapter, gid 7 not in the metadata: rejects with "That tab was not found in the spreadsheet. It may have been deleted.".
13. Adapter, metadata answered 403, 404, 429, 500 in turn: the four messages from the status mapping; no message contains "sample-access" or "sample-refresh".
14. Adapter, a QuickBooks config `{ entity: "Invoice" }`: rejects with "This source is not set up for Google Sheets."; spreadsheet id `"bad/id"`: rejects with "That spreadsheet id is not valid. Paste the Google Sheets link again.".
15. Read-only: across cases 7 and 8, every call to `sheets.googleapis.com` is `GET`; the only `POST` is to `oauth2.googleapis.com/token`.
16. `describeSheet` with gid 42: `{ title: "Sample reporting workbook", tabs: [{ gid: 0, title: "Sample sales" }, { gid: 42, title: "Sample finance" }], headers: ["Job", "Contract amount", "2026"] }` from a first row `[" Job ", "Contract amount", 2026, "", null]`; the values call's `ranges` is `'Sample finance'!1:1`. With gid null it reads `'Sample sales'!1:1`.

`src/lib/sync/draft.test.ts` (add) for `export function withHeaders(fields: FieldDraft[], headers: string[]): { fields: FieldDraft[]; added: number }` in `src/lib/sync/draft.ts`: rows whose header is blank are dropped first; each trimmed non-blank header whose `normalizeHeader` matches no remaining field's normalized header is appended as `fieldFromHeader(header)`, in header order, without duplicates:
- `([emptyField], ["Job", "Contract amount"])` -> two fields keyed `job`, `contract_amount`, `added` 2.
- `([fieldFromHeader("Job")], ["JOB ", "Margin"])` -> `Job` kept as is plus `Margin`, `added` 1.
- `([fieldFromHeader("Job")], ["Job"])` -> unchanged, `added` 0.
- `([], ["", "  ", "Job", "Job"])` -> one field, `added` 1.

`src/pages/pages.test.tsx`, in `describe("data sources")` (with `const kingdomAdmin = makeHub("admin", KINGDOM.company);`):
1. "shows the Google Sheets connection only to a company with data sources": `<CompanySettingsPage />` as `kingdomAdmin` at `/settings`: inside the "Connections" Section, "Google Sheets" with the badge "Connected", the account line containing "sample-reports@example.com", and a button "Disconnect Google Sheets"; as the Klasik `admin`, no "Google Sheets" text anywhere.
2. "confirms a Google Sheets connection on the way back": at path `/settings?connected=google_sheets` (pattern `/settings`) as `kingdomAdmin`: "Google Sheets is connected.".
3. "reads a sheet's headers into the field map": as `kingdomAdmin`, click "Add source", type the link `https://docs.google.com/spreadsheets/d/sample-new-sheet/edit#gid=42`, click "Read headers": the line "Sample reporting workbook, tab Sample finance" and the line "Added 4 fields." appear; header inputs show "Job", "Contract amount", "Margin", "Signed on" (`getByDisplayValue`), and key inputs show "job" and "contract_amount"; the empty starter row is gone.
4. "keeps Read headers off until the link names a tab": in the same editor, before typing a link, the "Read headers" button is disabled; after typing `https://docs.google.com/spreadsheets/d/sample-new-sheet/edit` (no gid) it is still disabled.
Every existing test stays green unchanged.

#### Service and mock

`src/services/sync.ts` (add):
```ts
export interface SpreadsheetDescription { title: string; tabs: Array<{ gid: number; title: string }>; headers: string[] }
// Reads the tab list and the first row of one tab through the connections function, which holds the Google token.
export async function describeSpreadsheet(connectionId: string, spreadsheetId: string, gid: number | null): Promise<SpreadsheetDescription> {
  return invokeFunction<SpreadsheetDescription>("connections/sync/describe", { connection_id: connectionId, spreadsheet_id: spreadsheetId, gid });
}
```
`src/test/mocks/sync.ts` (add, identical names and types): returns `{ title: "Sample reporting workbook", tabs: [{ gid: 0, title: "Sample sales" }, { gid: 42, title: "Sample finance" }], headers: ["Job", "Contract amount", "Margin", "Signed on"] }` (a fresh copy each call), ignoring its arguments. No other mock or alias change: `sync` is already in the demo alias and in both `vi.mock` lists.

#### DataSourcesPanel change

In the Google Sheets part of the editor, beside the "Spreadsheet <id>, tab <gid>" readout:
- `<Button variant="secondary" size="sm">Read headers</Button>`, disabled unless `parseSpreadsheetUrl(link)` gives a non-null gid, the company has a `google_sheets` connection with `status === "connected"`, and no read is in flight; while waiting it reads "Reading...".
- On click: `describeSpreadsheet(connection.id, spreadsheetId, gid)`; on success show one `text-[12.5px] text-ink-2` line `<title>, tab <tab title>` (or `<title>. That tab is not in the spreadsheet.` when no tab has that gid), then `withHeaders(draft.fields, description.headers)`; set the fields and show "Added <pluralize(added, "field")>." or "Every column is already mapped." when `added` is 0. A failure shows `<Notice tone="error">` with `errorMessage(err)`.
- Hint under the button: "Reads row 1 of the tab and adds a field for each column header not mapped yet." (the describe route reads row 1; with a different header row the person types the headers.)

#### Design notes

Settings keeps its quiet layout: the Google row is the same `ConnectionsPanel` row as the other providers, nothing new is styled. The Read headers control is a secondary small button and one line of `text-ink-2` text; no new colour, only theme tokens and `ui/*` primitives. Copy is plain with no em dashes.

#### Verification

- `npm run lint` (eslint also lints `supabase/functions/**`).
- `npx vitest run`.
- `npm run build`.
- `npm run test:sql` (0032 is applied twice by the harness, then `0032_sync_schedule.test.sql` runs with every earlier test file).
- Deno type-check of the function:
  ```
  S=<scratch>
  rm -rf $S/denocheck/functions && mkdir -p $S/denocheck/functions && cp -r /home/user/client-dashboard/supabase/functions/. $S/denocheck/functions/
  cd $S/denocheck/functions/connections && DENO_DIR=$S/denocache $S/denotry/node_modules/.bin/deno check --node-modules-dir=auto index.ts
  ```
  `index.ts` pulls in `http.ts`, `sync.ts` and every `_shared` module it uses; it must pass with no errors.
- Visual check: `npm run demo`, then a Playwright script (`const { chromium } = require('playwright')`, `chromium.launch()`, a fresh context per URL with `deviceScaleFactor: 1` at 1440x900, screenshots to `<scratch>/shots/task10/`, never the repo) for `/settings?persona=admin&company=kingdom` (the Connections card with its three rows), the same page after clicking "Add source", typing the sample link and clicking "Read headers", `/settings?persona=employee&company=kingdom` (redirected away; no Settings), and `/settings?persona=admin&company=klasik` (two connection rows, unchanged). Look at each PNG and fix any layout defect.

#### Must NOT do

- Do not deploy the function, set secrets, create Vault entries or apply 0032 or any migration (Global Constraint 7). Supabase MCP use is read-only (SELECT and catalog queries on project `jjdcejevdqpwuastsmpq`).
- Never write to Google: no Sheets method but `spreadsheets.get` and `values:batchGet`, no Drive scope, no Picker in the browser, no browser call to any provider (Global Constraint 10, rule 6).
- No second reader of `connection_tokens`: no new Edge Function, no Vercel cron, no service-role key in the app or Vercel.
- No role check in TypeScript for Sync now; RLS (`private.can_sync_source`) decides.
- No `period` or `person` field type, no figure computed from records, no guessing a header row (Global Constraint 9).
- No live-looking data: fictional names only ("Sample reporting workbook", "sample-reports@example.com") (Global Constraint 8).
- Do not edit 0001 to 0031, the harness files other than adding `0032_sync_schedule.test.sql`, or the QuickBooks provider (Task 11).

#### Commits

1. `Share the connections function's request helpers and accept owners as admins`
2. `Connect Google Sheets and read a tab through the connections function`
3. `Run, schedule and describe syncs inside the connections function`
4. `Schedule the hourly sync tick with Supabase Cron`
5. `Read a sheet's headers into a new data source from Settings`

Each message ends with the session's standard attribution trailer lines.

---

### Task 11: QuickBooks read-only adapter

#### Goal and fit

Give the sync engine a QuickBooks Online reader that can only read: a GET-only query client, Invoice and Payment queries paged to the end, every entity projected through the source's field map before anything is stored, a refresh-token rotation that is saved before any data call, and an "Open in QuickBooks" link on invoice rows. It is built and unconfigured (R8): no reports, no rules, and nothing about aging, escalation, "not sent", partial payments or cash basis.

Builds on (restated):
- Task 7 shared modules in `supabase/functions/_shared/sync/` (pure; no Deno, npm or `jsr:` imports; `import type` for types; explicit `.ts` extensions; type-checked by the app's strict `tsc -b` with `noUnusedLocals` and `noUnusedParameters`, by eslint, and by Deno):
  - `types.ts`: `FieldMapEntry { header: string; key: string; label: string; type: FieldType; unit: string | null; required: boolean }`, `QuickBooksSourceConfig { entity: "Invoice" | "Payment" }`, `SyncSourceSpec` (with `config: SourceConfig`), `CellValue = string | number | boolean | null`, `RawTable { headers: CellValue[]; rows: Array<{ cells: CellValue[]; ref: Record<string, unknown> }> }`, `ProviderTokens { accessToken: string; refreshToken: string | null; accessExpiresAt: string | null; refreshExpiresAt: string | null }`, `TokenStore { load(connectionId): Promise<ProviderTokens>; save(connectionId, tokens): Promise<void> }`, `ConnectionRef { id: string; external_account_id: string | null }`, `ProviderAdapter { provider: SyncProvider; read(source, connection): Promise<RawTable> }`, `AdapterRegistry`.
  - `parse.ts`: `mapRows(table, fieldMap, recordKey)` matches headers through `normalizeHeader` on both sides, so a header such as `CustomerRef.name` matches itself; it parses cells by type (blank is null, never 0), fails the whole table on any error (R12) and keeps only mapped keys in `data`.
  - `runner.ts`: `runSync({ source, connection, trigger, requestedBy, store, adapters, now? })`, which takes the per-connection lock (`startRun`) before calling `adapter.read`, so anything the adapter does, token refresh included, happens inside the lock; and `interface SyncStore` (`abandonStaleRuns`, `startRun`, `insertRecords`, `markSource`, `finishRun`, `pruneRecords`).
  - `links.ts`: `recordLink(ref: Record<string, unknown>): { href: string; label: string; note: string | null } | null`, which today handles Sheets refs `{ spreadsheet_id, sheet_gid, row }` ("Open in Google Sheets", note null) and returns null for anything else; `MappedTable` (Task 8) already renders its `href`, `label` and, when not null, `note` in each row's Source cell.
- Task 10: `supabase/functions/connections/sync.ts` with `adaptersFor(tokens: TokenStore): AdapterRegistry`, which registers Google Sheets (or an unconfigured adapter whose `read` throws "... is not set up yet. Ask Rococo Creative to add the app keys." when the keys are missing) and `createTokenStore(service)` over `connection_tokens`. The existing QuickBooks OAuth provider in `supabase/functions/connections/index.ts` stores `external_account_id = realmId` on `company_connections`; secrets `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_ENVIRONMENT` (`sandbox` or `production`).
- Fixtures (Task 8): Kingdom's "Sample invoices" source (quickbooks, `controls`, field map Invoice number, text, key `doc_number`) on `kingdom-conn-qbo` (`not_connected`).

#### Files

Create:
- `supabase/functions/_shared/sync/quickbooks.ts`.
- `src/lib/sync/quickbooks.test.ts`.

Modify:
- `supabase/functions/_shared/sync/links.ts`: the QuickBooks Invoice branch of `recordLink`.
- `src/lib/sync/links.test.ts`: the new cases.
- `supabase/functions/connections/sync.ts`: register QuickBooks in `adaptersFor`.
- `src/pages/pages.test.tsx`: one case in `describe("data sources")`.

#### `_shared/sync/quickbooks.ts`

Why-comment: a company's own QuickBooks books, read and never written. The client has one method, `query`, which is a GET; every entity is projected through the field map before it leaves this file, so only mapped fields can reach `sync_records`; QuickBooks rotates refresh tokens, so a new one is saved before any data call, and the runner holds the connection's lock while this runs. Exports:
```ts
export const QBO_PAGE_SIZE = 1000;
export const QBO_MAX_PAGES = 50;
export const QBO_MINOR_VERSION = 75;
export function qboApiBase(environment: "sandbox" | "production"): string;   // https://sandbox-quickbooks.api.intuit.com | https://quickbooks.api.intuit.com
export function getPath(obj: unknown, path: string): CellValue;
export function projectEntities(entities: Record<string, unknown>[], fieldMap: FieldMapEntry[], realmId: string, entity: "Invoice" | "Payment", sandbox: boolean): RawTable;
export interface QboClientDeps { fetch: typeof fetch; environment: "sandbox" | "production"; realmId: string; accessToken: string }
export function createQboClient(deps: QboClientDeps): { query(sql: string, start: number, max: number): Promise<Record<string, unknown>[]> };
export interface QuickBooksDeps { clientId: string; clientSecret: string; tokens: TokenStore; fetch: typeof fetch; environment: "sandbox" | "production"; now: () => Date }
export function createQuickBooksAdapter(deps: QuickBooksDeps): ProviderAdapter;
```
Behaviour:
- `getPath(obj, path)`: split `path` on "."; walk objects by key and arrays by a numeric segment (`Line.0.Amount`); a blank path, a missing step, `undefined` or `null` gives null; a final string, number or boolean is returned as is; a final object or array gives null (map a leaf, such as `CustomerRef.name`, not an object).
- `projectEntities`: `headers = fieldMap.map((f) => f.header)`; each entity becomes `{ cells: fieldMap.map((f) => getPath(entity, f.header)), ref: { entity, Id: String(entity.Id ?? ""), realmId, sandbox } }`. Nothing outside the field map is kept.
- `createQboClient(deps)` returns an object with exactly one key, `query`. `query(sql, start, max)`: `start` a whole number of one or more and `max` a whole number from 1 to 1000, else throws `new Error("The QuickBooks page is out of range.")`. One request: `GET ${qboApiBase(environment)}/v3/company/${encodeURIComponent(realmId)}/query?query=${encodeURIComponent(`${sql} startposition ${start} maxresults ${max}`)}&minorversion=75`, headers `Authorization: Bearer <accessToken>` and `Accept: application/json`, `method: "GET"` stated explicitly. Status mapping (no token or body in any message): 401 `"QuickBooks refused the sign-in. Connect QuickBooks again in Settings."`; 403 `"QuickBooks refused access to these records."`; 429 `"QuickBooks asked us to slow down. Try again in a few minutes."`; other non-2xx or unparseable JSON `"QuickBooks did not answer. Try again later."`. A 2xx body with a `Fault` key throws `"QuickBooks could not run the query."`. Otherwise it returns the first array value inside `QueryResponse` (an empty `QueryResponse` gives `[]`).
- `createQuickBooksAdapter(deps)`: `{ provider: "quickbooks", read }`. `read(source, connection)`:
  1. `source.config.entity` must be `"Invoice"` or `"Payment"`, else `new Error("This source is not set up for QuickBooks.")`.
  2. `connection.external_account_id` (the realm id) must be a non-blank string, else `new Error("QuickBooks did not say which company is connected. Connect QuickBooks again in Settings.")`.
  3. `tokens.load(connection.id)`. When `accessExpiresAt` is null or within five minutes of `deps.now()`: when `refreshToken` is null, or `refreshExpiresAt` is set and not after `now`, throw `new Error("QuickBooks sign-in has expired. Connect QuickBooks again in Settings.")` without calling anything; else `POST https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer` with `Authorization: Basic base64(clientId:clientSecret)` (`btoa`), `Accept: application/json`, `Content-Type: application/x-www-form-urlencoded`, body `grant_type=refresh_token&refresh_token=<token>`; a non-2xx answer throws the same expired message and saves nothing; on success build `{ accessToken: access_token, refreshToken: refresh_token ?? old.refreshToken, accessExpiresAt: now + expires_in seconds, refreshExpiresAt: x_refresh_token_expires_in ? now + that : old.refreshExpiresAt }` and `await tokens.save(connection.id, next)` before the first query; if `save` throws, throw `new Error("The new QuickBooks sign-in could not be saved. Connect QuickBooks again in Settings.")` and make no query (the old refresh token is already spent).
  4. Page: `const sql = \`select * from ${entity} orderby Id\`` (the entity is one of the two literals, never free text). Loop `start = 1, 1 + 1000, ...` calling `client.query(sql, start, QBO_PAGE_SIZE)`, appending, until a page returns fewer than `QBO_PAGE_SIZE`; reaching `QBO_MAX_PAGES` full pages throws `new Error("QuickBooks returned more records than one sync reads (50,000).")`.
  5. Return `projectEntities(all, source.field_map, realmId, entity, deps.environment === "sandbox")`.
- No other request exists in this file: no POST except the token refresh, no `report`, no create, update, delete, send or void call, and no endpoint other than `/query` under `/v3/company/`.

#### `links.ts`: the Invoice branch of `recordLink`

Add before the final `return null`: a ref whose `entity === "Invoice"`, with a non-blank string `Id` and a string `realmId`, gives `{ href: \`${ref.sandbox === true ? "https://app.sandbox.qbo.intuit.com" : "https://app.qbo.intuit.com"}/app/invoice?txnId=${encodeURIComponent(Id)}\`, label: "Open in QuickBooks", note: "Opens QuickBooks, sign-in required" }`. A Payment ref, or an Invoice ref without an `Id`, gives null (the invoice deep link is community-documented, hence the note; no other QuickBooks link is built). The Sheets branch is unchanged.

#### `connections/sync.ts`: registration

In `adaptersFor(tokens)` add `quickbooks: <adapter>` beside `google_sheets`: `createQuickBooksAdapter({ clientId, clientSecret, tokens, fetch, environment: Deno.env.get("QBO_ENVIRONMENT") === "production" ? "production" : "sandbox", now: () => new Date() })` when `QBO_CLIENT_ID` and `QBO_CLIENT_SECRET` are set, else the same private `unconfigured(...)` adapter Task 10 uses, throwing "QuickBooks Online is not set up yet. Ask Rococo Creative to add the app keys.". Update the file's why-comment to name both providers.

#### Tests to write first

`src/lib/sync/quickbooks.test.ts` (fake fetch recording `{ url, method, headers, body }` and answering from a queue with `new Response(JSON.stringify(body), { status })`; a fake `TokenStore` writing `save` into the same ordered log; `now = () => new Date("2026-11-09T14:00:00Z")`; `connection = { id: "sample-conn", external_account_id: "sample-realm" }`; a field map FM of `DocNumber` (text, required, key `doc_number`), `CustomerRef.name` (text, key `customer`), `TxnDate` (date, key `txn_date`), `DueDate` (date, key `due_date`), `TotalAmt` (currency, key `total`), `Balance` (currency, key `balance`); entities with fictional values such as `{ Id: "101", DocNumber: "1001", CustomerRef: { value: "5", name: "Sample customer" }, TxnDate: "2026-08-14", TotalAmt: 1250.5, Balance: 0, PrivateNote: "Sample note" }`):
1. `getPath`: `CustomerRef.name` -> "Sample customer"; `TotalAmt` -> 1250.5; `Balance` -> 0; `{ Line: [{ Amount: 5 }] }` with `Line.0.Amount` -> 5; `{ Paid: true }` with `Paid` -> true; a missing `DueDate` -> null; `CustomerRef` (an object) -> null; `Line` (an array) -> null; `getPath(null, "Id")` -> null; `getPath({ Id: "1" }, "")` -> null.
2. `projectEntities(entities, FM, "sample-realm", "Invoice", true)`: `headers` equal the six FM headers; each row has six cells in FM order; refs `{ entity: "Invoice", Id: "101", realmId: "sample-realm", sandbox: true }`; a numeric `Id: 102` becomes "102"; `PrivateNote` appears in no cell.
3. Through `mapRows(projectEntities(...), FM, ["doc_number"])`: ok; `data` has exactly the six FM keys; `balance` stays 0; `due_date` is null; `txn_date` is "2026-08-14".
4. `createQboClient({ environment: "sandbox", realmId: "sample-realm", accessToken: "sample-access", fetch })`: `Object.keys(client)` equals `["query"]`; `query("select * from Invoice orderby Id", 1, 1000)` makes one `GET` to origin `https://sandbox-quickbooks.api.intuit.com`, path `/v3/company/sample-realm/query`, with `searchParams.get("query")` equal to `"select * from Invoice orderby Id startposition 1 maxresults 1000"` and `minorversion=75`, header `Authorization: Bearer sample-access`; returns `QueryResponse.Invoice`; `{ QueryResponse: {} }` gives `[]`; `environment: "production"` uses `https://quickbooks.api.intuit.com`; `(…, 0, 10)` and `(…, 1, 1001)` reject with "The QuickBooks page is out of range."; a 200 body `{ Fault: { Error: [] } }` rejects with "QuickBooks could not run the query."; statuses 401, 403, 429, 500 reject with their four messages, none containing "sample-access".
5. Adapter, fresh token (expires one hour after `now`): no `POST` at all; first page of 1000 entities then a page of 3 gives two GETs whose `query` params end `startposition 1 maxresults 1000` and `startposition 1001 maxresults 1000`, and a table of 1003 rows.
6. Adapter, token expiring in two minutes: the first call is `POST https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer` with `Authorization: Basic ` + `btoa("sample-client:sample-secret")` and form `grant_type=refresh_token`, `refresh_token=sample-refresh`; answered `{ access_token: "sample-access-2", refresh_token: "sample-refresh-2", expires_in: 3600, x_refresh_token_expires_in: 8726400 }`, `save` receives `{ accessToken: "sample-access-2", refreshToken: "sample-refresh-2", accessExpiresAt: "2026-11-09T15:00:00.000Z", refreshExpiresAt: new Date(now + 8726400 s).toISOString() }`; the log shows `save` before the first GET; the GET uses `Bearer sample-access-2`.
7. Adapter, `save` throws: rejects with "The new QuickBooks sign-in could not be saved. Connect QuickBooks again in Settings."; no GET was made.
8. Adapter, refresh answered 400: rejects with "QuickBooks sign-in has expired. Connect QuickBooks again in Settings."; `save` never called; no GET.
9. Adapter, `refreshToken: null` and expired, or `refreshExpiresAt` before `now`: the same message; no fetch call at all.
10. Adapter, `external_account_id: null`: rejects with "QuickBooks did not say which company is connected. Connect QuickBooks again in Settings.".
11. Adapter, `{ entity: "Payment" }`: the query is `select * from Payment orderby Id ...`; refs carry `entity: "Payment"`. A Sheets config: rejects with "This source is not set up for QuickBooks.".
12. Adapter, 50 full pages: rejects with "QuickBooks returned more records than one sync reads (50,000)." (answer each call with 1000 tiny entities).
13. Read-only: across cases 5, 6 and 11, every call to an `intuit.com` API host is `GET` and its path contains `/query`; the only `POST` is to `oauth.platform.intuit.com`.
14. Through the shared runner: `runSync` with `adapters: { quickbooks: createQuickBooksAdapter(...) }`, a source spec for "Sample invoices" (provider `quickbooks`, config `{ entity: "Invoice" }`, field map FM, record key `["doc_number"]`, `current_run_id: null`) and a minimal in-file fake `SyncStore` that keeps inserted rows: outcome `succeeded`, `rowsApplied` equals the entity count, every inserted row's `source_ref` is `{ entity: "Invoice", Id, realmId: "sample-realm", sandbox: true }`, and its `data` has only FM keys.

`src/lib/sync/links.test.ts` (add):
- `recordLink({ entity: "Invoice", Id: "101", realmId: "sample-realm", sandbox: true })` -> `{ href: "https://app.sandbox.qbo.intuit.com/app/invoice?txnId=101", label: "Open in QuickBooks", note: "Opens QuickBooks, sign-in required" }`.
- `sandbox: false` -> `href` `https://app.qbo.intuit.com/app/invoice?txnId=101`.
- `{ entity: "Payment", Id: "7", realmId: "sample-realm", sandbox: true }` -> null; `{ entity: "Invoice", realmId: "sample-realm" }` -> null; the existing Sheets cases unchanged.

`src/pages/pages.test.tsx`, `describe("data sources")`, new case "links a QuickBooks invoice row to QuickBooks with a sign-in note": `render(<MappedTable source={{ ...invoices, current_run_id: "sample-run" }} records={[record]} />)` where `invoices = KINGDOM.syncSources.find((s) => s.name === "Sample invoices")!` and `record = { id: "sample-record", company_id: KINGDOM.company.id, source_id: invoices.id, run_id: "sample-run", record_key: '["1001"]', data: { doc_number: "1001" }, source_ref: { entity: "Invoice", Id: "101", realmId: "sample-realm", sandbox: true }, created_at: "2026-11-09T14:00:00.000Z" }`: a link named "Open in QuickBooks" with `href` `https://app.sandbox.qbo.intuit.com/app/invoice?txnId=101`, `target="_blank"` and `rel` containing `noopener`; the text "Opens QuickBooks, sign-in required"; the cell "1001"; the caption "Read-only, from QuickBooks Online.". No fixture changes.

#### Design notes

No new screen or component. The only visible change is a link label and its note in `MappedTable`'s existing Source column, styled by that component (accent link, `text-ink-3` note). Copy is plain with no em dashes.

#### Verification

- `npm run lint`.
- `npx vitest run`.
- `npm run build`.
- No SQL change: no `npm run test:sql`.
- Deno type-check (this task touches `supabase/functions`):
  ```
  S=<scratch>
  rm -rf $S/denocheck/functions && mkdir -p $S/denocheck/functions && cp -r /home/user/client-dashboard/supabase/functions/. $S/denocheck/functions/
  cd $S/denocheck/functions/connections && DENO_DIR=$S/denocache $S/denotry/node_modules/.bin/deno check --node-modules-dir=auto index.ts ../_shared/sync/quickbooks.ts ../_shared/sync/links.ts
  ```
- No visual check: no screen changes beyond the link label, which the render test covers. (Optional: the Task 8 demo screens still render at `/sales-finance/controls?persona=admin&company=kingdom`.)

#### Must NOT do

- No QuickBooks write of any kind: no POST, PUT or DELETE to the accounting API, no `report` or `reports/...` call, no send, void or update (Global Constraint 10, R8).
- No aging buckets, escalation, overdue rules, "not sent" logic from `EmailStatus`, partial-payment treatment, cash-basis or cash-flow figures, totals or sums (Global Constraint 9, R8).
- No change to the QuickBooks OAuth provider in `index.ts`, no new secret, no fixture change, no migration.
- Do not store anything outside the field map; never put a token in an error message or a log.
- Do not deploy the function or apply anything (Global Constraint 7); Supabase MCP read-only.
- Test data plainly fictional ("Sample customer", "sample-realm", "1001") (Global Constraint 8).

#### Commits

1. `Read QuickBooks invoices and payments through a GET-only client that saves each new sign-in first`
2. `Link QuickBooks invoice rows back to QuickBooks with a sign-in note`

Each message ends with the session's standard attribution trailer lines.

---

### Task 12: Role hierarchy foundation

#### Goal and fit

Add Owner and Manager as role values with a ranked grant guard, without reinterpreting anyone: `owner` and `admin` both keep today's admin meaning everywhere, `manager` is employee-level until Kingdom's capability matrix arrives, only an owner or Rococo grants owner, nobody grants above their own rank or changes someone ranked above them, and `reports_to` can no longer point at oneself, another company or round in a loop. The app's role type, labels, admin test, counts, hints and role selects follow. No existing row is rewritten; Maddie Cothran and marvin waters are set to Owner by hand after 0033 is applied (R10).

Builds on (restated):
- Task 1 SQL harness (`npm run test:sql` -> `bash supabase/tests/run.sh`; every migration applied, 0024 and up applied twice; each `supabase/tests/*.test.sql` runs in its own rolled-back transaction; helpers `tests.company(slug)`, `tests.create_person(name, company uuid, role default 'employee', rococo default false)` (inserts `auth.users` so `handle_new_user` runs, then sets company, role and the Rococo flag as system), `tests.id(name)`, `tests.act_as(profile uuid)`, `tests.assert(ok, message)`, `tests.assert_raises(sql, like)`, back to system with `reset role; select set_config('request.jwt.claims', '', true);`). 0006 seeds companies `kingdom`, `klasik`, `rba`; look them up by slug.
- Task 3: `private.audit_change()` already watches `profiles (role, is_active, is_rococo_admin, company_id, reports_to, job_role_id)` and `invitations (role, email)`; no audit change here.
- Task 10: `requireAdmin` in `supabase/functions/connections/http.ts` already accepts `owner` and `admin` and checks `is_active`; this task only verifies it.
- Task 2 and later: `KINGDOM` fixture bundle; `makeHub(persona, company)`; Kingdom's admin Home reads "Home".
- Existing objects relied on, never rebuilt here: `private.can_manage_company(cid)` and `private.is_company_member(cid)` (0009), `private.auth_profile_id()`, `private.auth_company_id()`, `private.is_rococo_admin()` (0013), `public.handle_new_user()` (0014), `public.move_employee_company()` (0014, latest body 0017, trigger `profiles_move_company`), and the profiles policies of 0013 ("Users update own, admins update company profiles", "Admins add staff").

#### Files

Create:
- `supabase/migrations/0033_role_hierarchy.sql`.
- `supabase/tests/0033_role_hierarchy.test.sql`.

Modify:
- `src/types/database.ts`: line 9 `export type Role = "owner" | "admin" | "manager" | "employee";`; lines 461-464 `export const ROLE_LABELS: Record<Role, string> = { owner: "Owner", admin: "Admin", manager: "Manager", employee: "Employee" };` (this key order is the order every select shows).
- `src/lib/people.ts` and `src/lib/people.test.ts`: the three role helpers.
- `src/App.tsx` line 273: `const isAdmin = isRococo || (isCompanyAdminRole(profile.role) && profile.company_id !== null && profile.company_id === company?.id);` (import from `./lib/people.ts`).
- `src/pages/DashboardPage.tsx` line 228 (at commit 6d9bfc5; earlier tasks shift it): the People stat hint counts `activePeople.filter((p) => isCompanyAdminRole(p.role)).length`.
- `src/pages/rococo/PortfolioPage.tsx` line 70: `const admins = active.filter((p) => isCompanyAdminRole(p.role));` (so a company whose only admin is an Owner never shows "No admin yet").
- `src/pages/people/PeoplePage.tsx`: the role hint (line 86), the Add staff role select (lines 87-91) and the roster role select (lines 273-277).
- `src/pages/people/PersonPage.tsx`: the role select (lines 222-228).
- `src/pages/rococo/UsersPage.tsx`: the role select (lines 103-107).
- `src/test/fixtures.ts`: Kingdom people, the department rule, personas, `makeHub`.
- `demo/vite.config.ts` line 4 (comment only): `/?persona=admin|employee|owner|manager|rococo&company=klasik|kingdom|rba`.
- `src/pages/pages.test.tsx`: `describe("roles")`.

#### Migration `0033_role_hierarchy.sql`

Header comment: what it adds (two role values, ranked grants, `reports_to` integrity), that `owner` and `admin` both keep today's admin meaning and `manager` is employee-level until the capability matrix, that no row is rewritten and owners are set by hand, that every rebuilt body is copied from its latest version (0013, 0018); "Paste after 0032; idempotent." Object list, in file order:

1. Pre-check (reports only, fixes nothing): a `do` block that raises `NOTICE` for each profile whose `reports_to` points at a profile in another company (`'Cross-company reports_to: % reports to %'`), and for each profile that can reach itself by walking `reports_to` (recursive CTE, depth cap 50) (`'Reporting loop through %'`).
2. Role values: `alter table public.profiles drop constraint if exists profiles_role_check;` `alter table public.profiles add constraint profiles_role_check check (role in ('owner', 'admin', 'manager', 'employee'));` and the same for `public.invitations` / `invitations_role_check`. (Live today both read `('admin','employee')`.)
3. `private.is_company_admin()` rebuilt from the **0013** body (sql, stable, security definer, `set search_path = public`), only the test widened:
   ```sql
   select coalesce(
     (select role in ('owner', 'admin') from public.profiles where user_id = auth.uid() and is_active),
     false
   )
   ```
   Never the 0001 body (it compares `profiles.id = auth.uid()` and would strip admin from every roster-first admin). Grants unchanged (re-run `revoke all ... from public, anon; grant execute ... to authenticated;` to stay idempotent). Through it, `private.can_manage_company`, the profiles update policy and both guards that read the helper treat an owner as an admin.
4. New helpers (each `revoke all on function ... from public, anon;` then `grant execute ... to authenticated;`):
   - `private.role_rank(r text) returns integer language sql immutable set search_path = ''`: `select case r when 'employee' then 1 when 'manager' then 2 when 'admin' then 3 when 'owner' then 4 else 0 end`.
   - `private.is_company_owner() returns boolean language sql stable security definer set search_path = public`: `select coalesce((select role = 'owner' from public.profiles where user_id = auth.uid() and is_active), false)`.
   - `private.auth_role_rank() returns integer language sql stable security definer set search_path = public`: `select coalesce((select private.role_rank(role) from public.profiles where user_id = auth.uid() and is_active), 0)`.
5. `public.guard_profile_fields()` rebuilt from the **0018** body (`supabase/migrations/0018_job_roles.sql` lines 93-138: plpgsql, security definer, `set search_path = public`), byte for byte except one insertion inside the company-admin branch, after the existing self check and before its `return new;`:
   ```sql
       if new.role is distinct from old.role then
         if new.role = 'owner' and not private.is_company_owner() then
           raise exception 'Only an owner or Rococo can make someone an owner.';
         end if;
         if private.role_rank(new.role) > private.auth_role_rank() then
           raise exception 'You cannot grant a role above your own.';
         end if;
       end if;
       if (new.role is distinct from old.role or new.is_active is distinct from old.is_active)
          and private.role_rank(old.role) > private.auth_role_rank() then
         raise exception 'You cannot change the role or access of someone ranked above you.';
       end if;
   ```
   The opening bypass (`if auth.uid() is null or private.is_rococo_admin() then return new; end if;`) stays, so Rococo and `handle_new_user` are unaffected. Trigger `profiles_guard_fields` (0001, BEFORE UPDATE) is unchanged. An admin can still make another admin (today's behaviour); an owner can change another owner.
6. `public.guard_profile_insert()` (plpgsql, security definer, `set search_path = public`), trigger `profiles_guard_insert` BEFORE INSERT ON `public.profiles` (drop if exists, then create):
   ```sql
   begin
     if auth.uid() is null or private.is_rococo_admin() then
       return new;
     end if;
     if new.role = 'owner' and not private.is_company_owner() then
       raise exception 'Only an owner or Rococo can make someone an owner.';
     end if;
     if private.role_rank(new.role) > private.auth_role_rank() then
       raise exception 'You cannot grant a role above your own.';
     end if;
     return new;
   end;
   ```
   The bypass line is what keeps `handle_new_user` (which inserts from the auth trigger with no `auth.uid()`) and first sign-in working.
7. `public.guard_invitation_role()` (same body as 6), trigger `invitations_guard_role` BEFORE INSERT OR UPDATE OF role ON `public.invitations`.
8. `public.guard_reports_to()` (plpgsql, security definer, `set search_path = ''`), trigger `profiles_guard_reports_to` BEFORE INSERT OR UPDATE OF reports_to, company_id ON `public.profiles`, no auth bypass:
   ```sql
   declare
     v_manager_company uuid;
     v_loop boolean;
   begin
     if tg_op = 'UPDATE' and new.company_id is distinct from old.company_id and new.reports_to is not null
        and not exists (select 1 from public.profiles m where m.id = new.reports_to and m.company_id = new.company_id) then
       new.reports_to := null;
     end if;
     if new.reports_to is null then
       return new;
     end if;
     if new.reports_to = new.id then
       raise exception 'A person cannot report to themselves.';
     end if;
     select m.company_id into v_manager_company from public.profiles m where m.id = new.reports_to;
     if v_manager_company is distinct from new.company_id then
       raise exception 'That person is in another company.';
     end if;
     with recursive chain (id, depth) as (
       select new.reports_to, 1
       union
       select p.reports_to, c.depth + 1
         from public.profiles p join chain c on p.id = c.id
        where p.reports_to is not null and c.depth < 50
     )
     select exists (select 1 from chain where id = new.id) into v_loop;
     if v_loop then
       raise exception 'That would make a reporting loop.';
     end if;
     return new;
   end;
   ```
9. `public.clear_reports_to_on_move()` (plpgsql, security definer, `set search_path = ''`), trigger `profiles_move_clears_reports_to` AFTER UPDATE OF company_id ON `public.profiles` FOR EACH ROW WHEN `(old.company_id is distinct from new.company_id)`: `update public.profiles set reports_to = null where reports_to = new.id and company_id is distinct from new.company_id; return null;`. Separate from `move_employee_company` (0014, latest body 0017), which is left alone.
10. `revoke execute on function public.guard_profile_insert(), public.guard_invitation_role(), public.guard_reports_to(), public.clear_reports_to_on_move() from public, anon, authenticated;` and re-run the 0018 revoke for `public.guard_profile_fields()`.
- Not in this file: `private.my_team_ids()` (R5), any capability table, any policy change, any audit trigger change, any row naming a company or person.
- Idempotency: drop-if-exists before each constraint and trigger, `create or replace` for functions, re-runnable grants; the harness applies the file twice.

#### SQL tests to write first: `supabase/tests/0033_role_hierarchy.test.sql`

Setup as system: `tests.create_person('k_owner', tests.company('kingdom'), 'owner')`, `('k_admin', kingdom, 'admin')`, `('k_admin2', kingdom, 'admin')`, `('k_manager', kingdom, 'manager')`, `('k_emp', kingdom)`, `('k_emp2', kingdom)`, `('l_admin', tests.company('klasik'), 'admin')`, `('l_emp', klasik)`, `('rococo', null, 'employee', true)`. Each case a `-- case: <name>` block, acting through `tests.act_as(tests.id(...))` and returning to system between cases. The whole file is one transaction, so state carries from case to case: each case restores, as system, any role, `is_active` or `reports_to` it changed. An UPDATE that RLS filters out raises nothing and changes no row, so "changes no row" cases check `get diagnostics v_rows = row_count` is 0.
1. `role_values_widened`: as system, `update profiles set role = 'manager'` on k_emp2 succeeds and back; `role = 'boss'` raises like `%profiles_role_check%`; an invitation with role `'boss'` raises like `%invitations_role_check%`; `pg_constraint` has exactly one `profiles_role_check` and one `invitations_role_check`.
2. `owner_is_admin_everywhere`: as k_owner, `private.is_company_admin()` and `private.can_manage_company(kingdom)` are true, `private.can_manage_company(klasik)` false; as k_admin both true for Kingdom.
3. `manager_is_employee_level`: as k_manager, `private.is_company_admin()` and `private.can_manage_company(kingdom)` are false; updating k_emp's title changes no row (RLS, as for any employee).
4. `rank_helpers`: `private.role_rank` gives 1, 2, 3, 4, 0 for employee, manager, admin, owner, 'boss'; `private.auth_role_rank()` is 4 as k_owner, 3 as k_admin, 2 as k_manager, 0 as system; `private.is_company_owner()` true only as k_owner.
5. `admin_cannot_grant_owner`: as k_admin, setting k_emp's role to owner raises `Only an owner or Rococo can make someone an owner.`.
6. `owner_and_rococo_grant_owner`: as k_owner, k_emp to owner succeeds (then back to employee as system); as rococo, k_emp2 to owner succeeds.
7. `admin_keeps_todays_grants`: as k_admin, k_emp to admin succeeds, then to manager succeeds, then to employee succeeds.
8. `manager_cannot_grant`: as k_manager, `update ... set role = 'manager'` on k_emp changes no row (RLS); on their own row, `set role = 'admin'` raises `Only admins can change roles or deactivate accounts.` (the 0018 own-profile branch). The rank rule itself is exercised by cases 9 and 12.
9. `no_change_to_someone_ranked_above`: as k_admin, setting k_owner's role to admin raises `You cannot change the role or access of someone ranked above you.`; setting k_owner's `is_active = false` raises the same; changing k_owner's `title` succeeds.
10. `owner_changes_owner`: as system add a second owner `k_owner2`; as k_owner, k_owner2 to admin succeeds.
11. `nobody_changes_own_role`: as k_owner, own role to admin raises `You cannot change your own role or deactivate your own account.`.
12. `insert_guard`: as k_admin, `insert into public.profiles (id, email, full_name, company_id, role) values (gen_random_uuid(), 'sample.owner1@example.com', 'Sample Owner', kingdom, 'owner')` raises `Only an owner or Rococo can make someone an owner.`; as k_admin with `sample.admin1@example.com` and role `admin` succeeds; as k_owner with `sample.owner2@example.com` and role `owner` succeeds; as rococo with `sample.owner3@example.com` and role `owner` succeeds. Every insert in a case uses its own address; profiles and invitations are unique by email.
13. `invitation_guard`: as k_admin, `insert into public.invitations (company_id, email, role) values (kingdom, 'sample.invite1@example.com', 'owner')` raises `Only an owner or Rococo can make someone an owner.`; the same address with role `admin` succeeds; updating that invitation's role to `owner` as k_admin raises the same; as k_owner the insert of `sample.invite2@example.com` with `owner` succeeds; as rococo the insert of `sample.invite3@example.com` with `owner` succeeds. Every insert in a case uses its own address; profiles and invitations are unique by email.
14. `signup_still_creates_profiles`: as system (no claims), insert a pending invitation `(kingdom, 'sample.newowner@example.com', 'owner')`, then `insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), 'sample.newowner@example.com', '{}'::jsonb)`: one profile with that email, `company_id` Kingdom, `role` `owner`, and the invitation's `accepted_at` set. Then insert an auth user `sample.staff@rocococreative.io`: its profile exists with `is_rococo_admin` true. (Use the columns `tests.create_person` already inserts into `auth.users`.)
15. `reports_to_not_self`: as k_admin, `update profiles set reports_to = id where id = k_emp` raises `A person cannot report to themselves.`.
16. `reports_to_same_company`: as rococo, k_emp `reports_to = l_admin` raises `That person is in another company.`.
17. `reports_to_no_loop`: as k_admin, k_emp reports to k_emp2 (succeeds), then k_emp2 reports to k_emp raises `That would make a reporting loop.`; a three-step loop (k_manager -> k_emp, then k_emp2 -> k_manager with k_emp -> k_emp2 in place) raises the same; a plain chain k_admin2 -> k_owner succeeds; setting `reports_to = null` succeeds; finally, as system, every `reports_to` set in this case goes back to null.
18. `move_clears_reporting_lines`: as system set k_emp `reports_to = k_admin` and k_emp2 `reports_to = k_emp`; as rococo move k_emp to Klasik (`update profiles set company_id = klasik`): k_emp's `reports_to` is null (set by the guard, no error) and k_emp2's `reports_to` is null (cleared by `profiles_move_clears_reports_to`); k_emp2 is still in Kingdom.
19. `audit_still_records_roles`: as k_owner change k_emp to manager; as system, the newest `audit_events` row for `profiles` and k_emp's id has `changed -> 'role'` equal to `{"old": "employee", "new": "manager"}`.
Every earlier test file (0001, 0024 to 0032) must stay green.

#### TypeScript helpers and tests to write first

`src/lib/people.ts` (add, with a why-comment: the app's reading of the same ranking the database enforces; the database is the wall, these only decide what a select offers):
```ts
export function isCompanyAdminRole(role: Role): boolean;                                 // owner or admin
export function canGrantRole(granter: Pick<Profile, "role" | "is_rococo_admin">, role: Role): boolean;
export function grantableRoles(granter: Pick<Profile, "role" | "is_rococo_admin">): Role[]; // ROLE_LABELS order
```
Rules: a private `const ROLE_RANK: Record<Role, number> = { employee: 1, manager: 2, admin: 3, owner: 4 };`. `canGrantRole`: a Rococo admin may grant anything; `owner` only by an owner; otherwise `ROLE_RANK[role] <= ROLE_RANK[granter.role]`. `grantableRoles = keysOf(ROLE_LABELS).filter((r) => canGrantRole(granter, r))`.

`src/lib/people.test.ts` (add):
- `isCompanyAdminRole`: owner true, admin true, manager false, employee false.
- `canGrantRole` with `{ role: "employee", is_rococo_admin: true }`: owner true. With owner: owner, admin, manager, employee all true. With admin: owner false, admin true, manager true, employee true. With manager: admin false, manager true, employee true. With employee: manager false, employee true.
- `grantableRoles`: owner -> `["owner", "admin", "manager", "employee"]`; admin -> `["admin", "manager", "employee"]`; Rococo -> all four; employee -> `["employee"]`.

#### UI changes

- PeoplePage:
  - `AddStaffDialog` gains a prop `granter: Profile` (PeoplePage passes `profile` from `useHub()`); its Role select maps `grantableRoles(granter)`.
  - The hint (line 86) reads from a private `const ROLE_HINTS: Record<Role, string>`:
    - owner: "Owners see everything for this company. Only an owner or Rococo can make someone an owner."
    - admin: "Admins see everything for this company."
    - manager: "Managers see what employees see for now. Team access comes later."
    - employee: "Employees see their own GSR plus the libraries."
  - The roster select (lines 273-277): `const canChange = canGrantRole(profile, person.role);` `disabled={self || !canChange}`, options `(canChange ? grantableRoles(profile) : [person.role])`, and `title="Only an owner or Rococo can change this person's role."` when `!canChange && !self`.
- PersonPage (lines 222-228): the same rule with `me`; when `!canChange && !self`, a `text-[12px] text-ink-3` line under the select: "Only an owner or Rococo can change this person's role.".
- UsersPage (lines 103-107): options `grantableRoles(me)` (a Rococo admin, so all four); `disabled` unchanged.
- `AppLayout` already shows `ROLE_LABELS[profile.role]`, so Owner and Manager label themselves; no change.
- Sending an invitation for an Owner row as an Admin is refused by `invitations_guard_role`; the page shows the database's line through `errorMessage`. No extra UI rule.

#### Fixtures (`src/test/fixtures.ts`) and personas

- Kingdom spec people (line 73 on): Marcus Lee's role becomes `"owner"`; append `{ name: "Avery Stone", title: "Office Manager", role: "admin" }` and `{ name: "Jules Carter", title: "Field Manager", role: "manager" }` at the end, so every existing id (`kingdom-user-1` to `kingdom-user-4`, reviews, goals) is unchanged; the new people are `kingdom-user-5` and `kingdom-user-6`.
- Line 201: `department: isCompanyAdminRole(person.role) ? "Leadership" : ...` (import from `../lib/people.ts`), so Marcus keeps "Leadership".
- Line 288 stays `x.role === "employee"`, so no review, goal or KPI is generated for the new people and existing generation does not move.
- Line 980: `export type Persona = "admin" | "employee" | "rococo" | "owner" | "manager";`.
- `personaProfile` (lines 982-985): rococo -> `ROCOCO`; owner -> first profile with role `owner`, else `bundle.profiles[0]`; manager -> first with role `manager`, else `bundle.profiles[1]`; admin -> first with role `admin` (Klasik and RBA: `profiles[0]`, unchanged; Kingdom: Avery Stone); employee -> `bundle.profiles[1]` (unchanged).
- `makeHub` (line 998): `isAdmin: isRococo || isCompanyAdminRole(profile.role)`.
- Note for this task (R21): Kingdom's `admin` persona is now Avery Stone, not Marcus Lee, and the `owner` persona is Marcus Lee. Task 12 may update any earlier Kingdom test assertion that depends on who the signed-in Kingdom admin is or on Marcus Lee's role, and must list each such change in its report; Global Constraint 2 permits these. Run the whole suite; none such exists at commit 6d9bfc5. The Rococo People tab test ("lists every user across companies") still finds "Marcus Lee" and counts RBA only, so it stays green.

#### Page tests to write first (`src/pages/pages.test.tsx`, `describe("roles")`)

With `const kingdomOwner = makeHub("owner", KINGDOM.company); const kingdomAdmin = makeHub("admin", KINGDOM.company); const kingdomManager = makeHub("manager", KINGDOM.company);`:
1. "gives an owner what an admin gets": `kingdomOwner.isAdmin` is true and `kingdomOwner.profile.full_name` is "Marcus Lee"; `<DashboardPage />` as `kingdomOwner` shows the heading "Home" and the "People" stat (its hint reads "1 not signed in yet", unchanged precedence).
1b. If PortfolioPage shows an alert for a company with no admin (see its alerts near `src/pages/rococo/PortfolioPage.tsx:98` and the admin count at `:70`), assert that a company whose only admin-ranked person is an Owner shows no such alert; otherwise rely on the `isCompanyAdminRole` unit tests in `src/lib/people.test.ts`.
2. "gives a manager the employee dashboard": `kingdomManager.isAdmin` is false; `<DashboardPage />` as `kingdomManager` shows `/Welcome back, Jules/` and no "People" stat.
3. "offers Owner only to an owner": `<PeoplePage />` as `kingdomAdmin`: the select "Role for Dana Whitfield" has options exactly Admin, Manager, Employee; the select "Role for Marcus Lee" is disabled and shows Owner; as `kingdomOwner`, "Role for Dana Whitfield" has Owner, Admin, Manager, Employee.
4. "explains each role when adding staff": as `kingdomAdmin`, open "Add staff": the "Role" select has no Owner option; choosing Manager shows "Managers see what employees see for now. Team access comes later.".
5. "keeps an owner's role out of an admin's hands on the person page": `<PersonPage />` as `kingdomAdmin` at `/people/kingdom-user-1` (pattern `/people/:profileId`): the "Role" select is disabled with value `owner`, and "Only an owner or Rococo can change this person's role." shows.
6. "lets Rococo grant any role": `<UsersPage />` as `rococo` at `/rococo/people`: the select labelled `` `Role for ${KINGDOM.profiles[0].email}` `` (Marcus Lee) has all four options and shows Owner.
7. "leaves Klasik's roster as it was, plus the Manager value": `<PeoplePage />` as the Klasik `admin`: "Role for Sam Ortega" has Admin, Manager, Employee and no Owner.
All existing tests stay green unchanged, except Kingdom assertions R21 permits this task to update (each listed in its report).

#### Design notes

No new component. Selects stay the existing `selectClass` controls; a locked select uses the native disabled state plus one `text-ink-3` line on the person page. Labels come from `ROLE_LABELS`. Copy is plain with no em dashes.

#### Verification

- `npm run lint`.
- `npx vitest run`.
- `npm run build`.
- `npm run test:sql` (0033 applied twice; every test file from 0001 to 0033 green).
- `grep -n "role === \"admin\"\|role === 'admin'" -r src supabase/functions` shows no remaining admin test outside `isCompanyAdminRole` and `http.ts`'s owner-or-admin check (fixtures and tests that build data excepted).
- Read `supabase/functions/connections/http.ts` `requireAdmin` and confirm it accepts `owner` and `admin` and checks `is_active` (Task 10 wrote it; change nothing unless it does not). If it does need a change, run the Deno check: copy `supabase/functions` to `<scratch>/denocheck/functions` and run `DENO_DIR=<scratch>/denocache <scratch>/denotry/node_modules/.bin/deno check --node-modules-dir=auto index.ts` from the copied `functions/connections`.
- Visual check: `npm run demo`, then Playwright (`require('playwright')`, `chromium.launch()`, fresh context per URL, `deviceScaleFactor: 1`, 1440x900, screenshots to `<scratch>/shots/task12/`, never the repo) for `/?persona=owner&company=kingdom`, `/people?persona=owner&company=kingdom`, `/people?persona=admin&company=kingdom` (Marcus's role locked), `/people/kingdom-user-1?persona=admin&company=kingdom`, `/?persona=manager&company=kingdom` (employee dashboard), `/?persona=employee&company=kingdom`, `/people?persona=admin&company=klasik`, `/rococo/people?persona=rococo`. Check the sidebar shows "Owner" or the title, the role column fits, and Klasik looks as before apart from the Manager option.

#### Must NOT do

- No `private.my_team_ids()`, no team policies, no team access of any kind for managers, no capability table, no restriction on admins (R5).
- No rewrite of any existing row: no migration sets anyone to owner, and no seed names a company or person (R10).
- Do not rebuild `is_company_admin` from 0001 or `guard_profile_fields` from anything older than 0018; do not touch `handle_new_user`, `move_employee_company`, any policy, or any audit trigger.
- No new INSERT guard without the `auth.uid() is null or private.is_rococo_admin()` bypass.
- No branch on a company name, slug or theme key; role rules are the same for all three companies.
- Global Constraint 7: nothing applied to the live project; Supabase MCP read-only. Global Constraint 8: fictional data only ("Avery Stone", "Jules Carter", example.com addresses). Global Constraint 9: no new business rules beyond the ranking. Global Constraint 10: untouched (no sync or import code here).

#### Commits

1. `Add Owner and Manager roles with ranked grants and sound reporting lines`
2. `Treat owners as admins in the app and offer Owner only to owners and Rococo`
3. `Add owner and manager personas to the fixtures and the demo`

Each message ends with the session's standard attribution trailer lines.

---

### Task 13: Docs and handoff

#### Goal and fit

Make the written record match what was built: the README gains the module table rows, the modules, the full migration order (0001 to 0033), Data sources and Google setup, the SQL harness and an "Applying this release" checklist; the proposed CLAUDE.md wording (including a verification gate line naming `npm run test:sql`) goes into the task report for approval (R1); `docs/kingdom-revamp-plan.md` marks which slices are built and records the rulings. No code or migration changes. It closes the run started by Tasks 1 to 12, whose results it describes (restated below so this section stands alone).

What was built, for the docs (read the code to confirm each line before writing it):
- Module gate: `companies.modules text[] not null default '{}'` (0024), read only through `hasModule()` in `src/lib/modules.ts`, changed only by a Rococo admin on Rococo > Companies. Keys and labels: `switchboard` "Switchboard" (four-section navigation, the Home heading, the Attention and Shortcuts cards), `production` "Production" (projects, milestones and letters, the Production cards), `wins` "Wins" (the wins page and the Home wins card), `data_sources` "Data sources" (connected Google Sheets and QuickBooks sources, Sales & Finance, and data freshness), `external_links` "External links" (shortcuts to outside tools, including Monday, in each section). Sections: "Home", "Sales & Finance", "Production", "People / HR", plus an unlabeled utility group (SOPs, Resources, Settings). Klasik and RBA have no modules and see no change.
- Migrations: `0024_company_modules.sql`, `0025_audit_log.sql`, `0026_projects_milestones.sql`, `0027_wins.sql`, `0030_sync_engine.sql`, `0031_external_links.sql`, `0032_sync_schedule.sql`, `0033_role_hierarchy.sql`.
- Routes: `/production`, `/production/projects/:projectId` (production; members read, admins edit), `/wins` (wins; members read), `/sales-finance` and `/sales-finance/controls` (admin only, data_sources), `/rococo/activity` (Rococo only, the audit log).
- Sync: sources in `sync_sources`, runs in `sync_runs`, read-only values in `sync_records` (no browser write; only the `connections` function's service role writes), six states (Not connected, Awaiting first sync, Syncing, Sync failed, Stale data, Synced), last good data kept on failure, blanks shown as "-". Routes on the `connections` function: `POST /sync/run` (user JWT; Sync now, allowed by `private.can_sync_source`), `POST /sync/tick` (header `x-sync-secret`, checked against `SYNC_CRON_SECRET`), `POST /sync/describe` (admin; a sheet's tabs and first row). Google Sheets connects through the same OAuth flow with scopes `openid email https://www.googleapis.com/auth/spreadsheets.readonly`; QuickBooks reads Invoice and Payment records through a GET-only client. 0032 schedules `hub-sync-tick` at `7 * * * *` with pg_cron and pg_net, reading `sync_function_url` and `sync_cron_secret` from Vault.
- Roles: `owner`, `admin`, `manager`, `employee`; owner and admin both carry admin access; manager is employee-level until the capability matrix; only an owner or Rococo makes someone an owner.
- SQL harness: `npm run test:sql` runs `bash supabase/tests/run.sh`; it needs a local PostgreSQL 16 (`/usr/lib/postgresql/16/bin`, run as the `postgres` OS user via `runuser` when invoked as root), loads `supabase/tests/stubs.sql` (stand-ins for Supabase's roles and the `auth`, `storage`, `vault`, `cron` and `net` schemas), applies every migration in order (stripping only the pg_cron and pg_net `create extension` lines), applies 0024 and up a second time to prove idempotency, loads `supabase/tests/helpers.sql`, then runs each `supabase/tests/*.test.sql` in a transaction that is rolled back. It is not part of CI (R9).
- Rulings R1 to R21 (record in the revamp plan): R1 `companies.modules` approved, the CLAUDE.md wording is proposed and applied only on Austin's explicit approval, README documents the modules meanwhile; R2 the utility group is unlabeled; R3 five module keys, not seven (`sectioned_nav` and `home_snapshot` became `switchboard`, `qbo_controls` folded into `data_sources`); R4 `external_people` deferred to the PM capacity slice; R5 `private.my_team_ids()` deferred to the capability-matrix slice; R6 `wins.team` deferred, wins carry an optional project; R7 members read Production and Wins, Sales & Finance stays admin-only; R8 the QuickBooks adapter is read-only and unconfigured, no aging, escalation, "not sent", partial-payment or cash-basis logic; R9 the SQL harness is committed and not in CI; R10 Kingdom's modules are switched on by a Rococo admin after the migrations, no migration seeds modules or roles, Maddie Cothran and marvin waters are set to Owner by hand after 0033; R11 field types `text`, `number`, `currency`, `percent`, `date` only; R12 a sync is all-or-nothing, all-blank rows are skipped and counted; R13 one attempt per weekly slot; R14 `target_module` values `sales_reporting`, `financial_reporting`, `controls`, `pm_capacity`; R15 projects are created by hand (`source = 'manual'`, `reference` holds the job number), the master list will not be Buildertrend; R16 the Home wins card shows the five most recent non-archived wins; R17 `audit_events` has no foreign keys, history outlives the company; R18 projects, milestones and wins are content and carry no audit trigger; R19 `people_hr` and `home` links show only on Home's Shortcuts card; R20 the known limitations accepted as built (a moved profile's audit row filed under its new company, a sync-only select path added with the capability matrix, providers.test.ts reading SQL through a dynamic `node:fs` import, Read headers reading row 1 only); R21 Kingdom's `admin` persona is Avery Stone and its `owner` persona Marcus Lee from Task 12 on.

#### Files

Modify only:
- `README.md` (342 lines at commit 6d9bfc5).
- `docs/kingdom-revamp-plan.md`.

CLAUDE.md is not modified (R1); see "Proposed CLAUDE.md wording" below.

#### README changes

1. Lines 14-17 ("Assessed and planned, not built: the Kingdom dashboard revamp ..."): replace with a paragraph saying the Kingdom revamp is built and waits to be switched on: a company's modules decide what it sees (see Modules), Klasik and RBA have none and see no change; the plan is `docs/kingdom-build-plan.md` and the assessment `docs/kingdom-revamp-plan.md`.
2. "What is inside" table (lines 21-30): add rows, each marked with its module key in the Module cell:
   - "Production (`production`)": Admins "Projects with a job reference, milestones and letters (add, edit, reorder, mark done, archive); cards for client score, cleanliness, job health, warranty and PM capacity that read Not configured until they are defined" / Employees "Read only".
   - "Wins (`wins`)": Admins "Log, edit and archive wins; the five most recent on Home" / Employees "Read; the five most recent on Home".
   - "Sales & Finance (`data_sources`)": Admins "Read-only reporting and controls from connected Google Sheets and QuickBooks sources, each with its sync state and last successful sync" / Employees "(not visible)".
   - "Home cards (`switchboard`, `data_sources`)": Admins "Attention items, section shortcuts, data freshness" / Employees "Shortcuts, wins".
   - "External links (`external_links`)": Admins "Shortcuts to outside tools such as Monday boards, grouped by section; public share views embedded only when flagged public" / Employees "Links shared with everyone".
   - Rococo portfolio row: add "and the Activity log of configuration and permission changes".
   Under the table, replace line 32 ("QuickBooks sync, automated data pulls, and email notifications are the next phase.") with: "Rows marked with a module key appear only for a company whose modules include it. Email notifications are the next phase."
3. Demo mode (lines 49-55): add `/?persona=owner&company=kingdom` and `/?persona=manager&company=kingdom`, and say Kingdom's sample data has every module on while Klasik and RBA have none.
4. Supabase setup step 2 (lines 60-61): "`0001` through `0033`", plus one sentence: "Paste `0032` only after the two Vault entries in Data sources and Google setup exist."
5. Expand the `## Modules` section Task 2 added (move it to directly after `## Supabase setup`) into a table of the five keys with their labels and what each turns on (the wording above) (do not add a second Modules section), then: a module is a key in `companies.modules`, read only through `src/lib/modules.ts` and changed only by Rococo on Rococo > Companies; a company with no modules looks exactly as it did; turning a module off hides its screens and keeps its rows.
6. New section "Roles" after "The roster and accounts": Owner and Admin both see everything for their company; Manager sees what an Employee sees until the capability matrix arrives; only an Owner or Rococo makes someone an Owner; nobody grants a role above their own or changes someone ranked above them; a person cannot report to themselves, to someone in another company, or round in a loop, and moving a person to another company clears the reporting lines that would cross it.
7. "Connections to outside systems" (lines 169-179): add Google Sheets (shown only for a company with `data_sources`), and replace "The figures themselves are not synced yet" with two sentences: imported values land read-only in `sync_records`, written only by the `connections` function; a failed sync keeps the last good values with their time, and a blank shows as "-", never 0.
8. "The connections function" (lines 309-328): list the routes (`start`, `callback`, `disconnect`, `sync/run`, `sync/tick`, `sync/describe`) and who may call each; add secrets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (a Google Cloud OAuth client of type Web application owned by Rococo, scopes `openid email https://www.googleapis.com/auth/spreadsheets.readonly`) and `SYNC_CRON_SECRET` (a long random string, for example from `openssl rand -hex 32`); the Google client lists the same single redirect URL `https://<project-ref>.supabase.co/functions/v1/connections/callback`; deploy with `supabase functions deploy connections --no-verify-jwt`.
9. New section "Data sources and Google setup": the steps, in order, from `docs/kingdom-revamp-plan.md` section 6.6:
   - Google Cloud (Rococo-owned project): enable the Google Sheets API; OAuth consent screen External, app name "Company Hub", authorized domain `rocococreative.io`, homepage `https://companyhub.rocococreative.io`, privacy policy URL, scopes `openid`, `email`, `.../auth/spreadsheets.readonly`; publishing status In production (Testing mode issues refresh tokens that expire after 7 days); a Web application OAuth client with the redirect URI `https://jjdcejevdqpwuastsmpq.supabase.co/functions/v1/connections/callback`; submit sensitive-scope verification.
   - Supabase secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SYNC_CRON_SECRET`; confirm `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_ENVIRONMENT`.
   - Vault, in the SQL editor: `select vault.create_secret('<same value as SYNC_CRON_SECRET>', 'sync_cron_secret');` and `select vault.create_secret('https://jjdcejevdqpwuastsmpq.supabase.co/functions/v1/connections/sync/tick', 'sync_function_url');`.
   - Paste `0032_sync_schedule.sql`; check with `select jobname, schedule from cron.job;` and, after the next hour, `select status, return_message from cron.job_run_details order by start_time desc limit 5;`.
   - Intuit: for real books, complete Intuit's production app assessment and set `QBO_ENVIRONMENT=production`.
   - In the hub: a company admin connects Google Sheets and QuickBooks from Settings > Connections, then adds sources in Settings > Data sources (paste the sheet link with the tab open, Read headers, map fields, pick the record key, the weekly day, time and zone, and the stale threshold if one is agreed), and presses Sync now once.
   - Say what is still pending from Kingdom: the sheet links and field mappings, the sync day, time, zone and stale threshold, the QuickBooks fields, and the capability matrix.
10. New section "SQL harness": what `npm run test:sql` does (the paragraph above), that it needs a local PostgreSQL 16 and is not in CI, and that every migration task adds `supabase/tests/<number>_<name>.test.sql`.
11. New section "Applying this release", a numbered checklist:
    1. Back up, then paste `0024` to `0031` and `0033` in order in the SQL editor, once each (each is idempotent; go forwards only).
    2. Set the function secrets (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SYNC_CRON_SECRET`) and deploy: `supabase functions deploy connections --no-verify-jwt`.
    3. Create the Vault entries `sync_cron_secret` and `sync_function_url`, then paste `0032`.
    4. Open Rococo > Companies and turn on Kingdom's modules (all five, or the ones Kingdom has agreed).
    5. On Kingdom's People page, set Maddie Cothran and marvin waters to Owner by hand.
    6. Check: Klasik and RBA look unchanged; Kingdom Home shows the four sections; Rococo > Activity shows the module change and the role changes; `select jobname, schedule from cron.job;` lists `hub-sync-tick`.
    (Order note: 0033 may go before or after 0032; 0032 must follow the Vault entries.)
12. "Layout" (lines 297-307): add `supabase/functions/`: the `connections` Edge Function and `_shared/` (provider keys and the pure sync modules: parse, keys, schedule, runner, links, Google Sheets, QuickBooks); and `supabase/tests/`: the SQL harness and one test file per migration.
13. README "Quick start" (lines 34-43): add `npm run test:sql   # migrations against a local PostgreSQL 16 (not in CI)`.

#### Proposed CLAUDE.md wording (report only)

This task does not edit CLAUDE.md (R1). Write the exact proposed CLAUDE.md wording (rule 1, rule 12's list and module sentence, the `npm run test:sql` gate line, 'What this is', rule 6's provider list) into the task report under a heading 'Proposed CLAUDE.md wording'; the controller shows it to the user and applies it only on the user's explicit approval. The proposal covers:

- Rule 1 and rule 12 (the module gate), as Task 2 proposed: rule 1's last sentence becomes "A new tenant is a new theme block plus a `theme_key`, and the modules it has on (`companies.modules`), nothing else."; rule 12's "Configured per company already" list gains "the app modules it has on (`companies.modules`), " right after "theme, "; after the list's closing "systems." add "A module is a key in `companies.modules`, read only through `src/lib/modules.ts` (`hasModule`), and changed only by Rococo; with no modules on, a company sees exactly what Klasik and RBA see."
- Verification gates (line 138): after the first sentence add: "A change that adds or edits a migration also passes `npm run test:sql` (a local PostgreSQL 16 harness in `supabase/tests/`; it is not part of CI)."
- "What this is" (line 10): "Admins (owners and managers) get the whole hub" now misreads the new role values. Change to "Admins (the Owner and Admin roles) get the whole hub" and add after the Employees sentence: "A Manager sees what an Employee sees until the capability matrix arrives." Nothing else in "What this is" changes.
- Rule 6 (line 66): "a company connects its own GoHighLevel or QuickBooks account" becomes "its own GoHighLevel, QuickBooks or Google account", and add "The same function runs every sync (`/sync/*`), so it stays the only reader of `connection_tokens`."
- No other rule text is proposed.

#### `docs/kingdom-revamp-plan.md` changes

- Status line (line 3): "Status: S1 to S9 built and verified on branch `claude/elegant-cray-bnb85m`, not yet applied to the live project or deployed. S10 to S14 wait on Kingdom's inputs (section 7). The build plan is `docs/kingdom-build-plan.md`; where the two differ on scope, the rulings below and the build plan win."
- After section 1, a new "## Rulings" section listing R1 to R21 exactly as above, each with its cost if wrong (R1 reword two lines, plus a pending guardrails update; R2 one label later; R3 split a key later; R4 one small migration later; R5 none; R6 one column later; R7 one policy and route guard each; R8 none if never configured; R9 remove a folder and a script; R10 none; R11 add a type later; R12 a stricter-than-needed first run; R13 a transient failure waits a week unless someone presses Sync now; R15 an import path later; R17 none; R18 one trigger each later; R19 one ExternalLinksList on PeoplePage later; R20 none now; R21 a few assertion edits; R14 and R16 have no cost recorded, so write "None recorded").
- Section 4: keep every heading unchanged (for example `#### S1. Module gate and four-group nav`); under each S1 to S9 heading insert a first bullet `- **Status.** Built.`, and an `- **As built.**` bullet where the build differs: S1 module keys are five (R3) and the Home heading follows `switchboard`; S5 `ScaffoldCard` lives at `src/components/scaffold/ScaffoldCard.tsx` and both Sales & Finance pages sit behind `data_sources`; S6 the sync routes live in `supabase/functions/connections/sync.ts` with pure modules in `supabase/functions/_shared/sync/`, and `external_people` is deferred (R4); S8 `requireAdmin` checks `is_active` and accepts owner and admin; S9 `my_team_ids` is deferred (R5). The table under "Slices that need mappings or definitions" gains a "Status" column reading "Waiting on inputs" for S10 to S14, and S12 notes that the read-only adapter is built (R8).
- Section 10 "Side findings": mark "`App.rococo.test.tsx` is missing three mocks" and "The `connections` function does not check `is_active`" as fixed.
- Do not change sections 2, 3, 5, 6, 7, 8, 9 or the Review notes beyond what is listed.

#### Copy rules

Plain, calm, confident; no em dashes; no AI model identifiers; industry neutral except where a company's own configuration says otherwise. Real names appear only where the docs already name them (Maddie Cothran, marvin waters, Austin). Every path, route, secret and command must match the code: check each against the repo before writing it (for example `ls supabase/migrations`, `grep -n "path=" src/App.tsx`, `grep -rn "Deno.env.get" supabase/functions`).

#### Verification

- `npm run lint`, `npx vitest run`, `npm run build` (no code changed; they must still pass).
- `ls supabase/migrations` lists exactly 0001 to 0033 and the README names that range.
- `grep -rnP "\x{2014}" README.md docs/kingdom-revamp-plan.md` (the em dash) finds nothing, and the proposed CLAUDE.md wording in the report has none either.
- `grep -rn "GOOGLE_CLIENT_ID\|SYNC_CRON_SECRET\|sync_function_url\|hub-sync-tick" README.md supabase` shows the README naming the same secrets, Vault names and job name as the code.
- No visual check (docs only).

#### Must NOT do

- No change to code, tests, fixtures, migrations, the Edge Function or `package.json`.
- Edit CLAUDE.md (R1: the proposed wording goes into the task report only).
- Do not apply anything, deploy, set secrets or create Vault entries (Global Constraint 7); Supabase MCP read-only.
- Do not describe anything as built that is not (S10 to S14, the capability matrix, PM capacity mapping, client score, cleanliness, warranty) or invent business rules for them (Global Constraint 9).
- No live-looking sample data in examples (Global Constraint 8); Global Constraint 10 is described, not changed.

#### Commits

1. `Document modules, data sources, roles and how to apply the Kingdom release`
2. `Mark the built Kingdom slices and record the rulings`

Each message ends with the session's standard attribution trailer lines.


## Open contract issues

- ~~Contracts 1.3 makes `ModuleOnly` a private component added in Task 2, but no route uses it until Task 4, and `tsconfig.app.json` has `noUnusedLocals`, so an unused private function fails `npm run build`. Task 2 above exports it as a named export from `src/App.tsx` (still a component, so the react-refresh lint rule is satisfied) and tests it directly.~~ Resolved: 1.3 now names it an exported component (F12).
- ~~Contracts section 5 says Task 2 adds "modules" to README's configured-per-company list, but README has no such list (only CLAUDE.md rule 12 does). Task 2 above adds a short `## Modules` section after `## Branding` instead.~~ Resolved: the ownership map now matches (F13).
- ~~The harness contract's `tests.act_as(p_profile)` must read the profile's `user_id` to build `{sub}`, which RLS hides when the caller is already acting as another user, and `act_as` cannot be SECURITY DEFINER because Postgres refuses a role change inside one. Task 1 above adds one extra helper, `tests.user_of(uuid)` (SECURITY DEFINER), that `act_as` calls; `tests.fixture` keeps the contract's `(name, id)` shape. Also, the harness work directory must be created under `/tmp` literally (socket path limit of 107 bytes, and the `postgres` OS user cannot traverse `/tmp/claude-0`); both were verified on this machine.~~ Resolved: section 2 lists `tests.user_of` (F21).
- Ruled: R20. `private.audit_change()` takes `company_id` from `coalesce(new, old)`, so a profile moved out of a company (or left with no company when its company is deleted) is logged under the new company or under null, not the company it left; a Rococo filtering Activity by the old company will not see that move. Followed as written.
- Ruled: R20. The "Admins and syncers update sync sources" policy alone is not enough for a user who passes `private.can_sync_source` but not `can_manage_company`: Postgres also applies SELECT policies to the rows an `UPDATE ... WHERE id = $1` reads, and `sync_sources` select is `can_manage_company` only. Today the two predicates are identical, so nothing breaks; when the capability matrix splits them, add a select path for syncers (or have `/sync/run` call a SECURITY DEFINER function) or Sync now will update zero rows. Task 7's last SQL test simulates the split by adding a temporary select policy for this reason.
- ~~Section 1.7 has SourcePanel render MappedTable for every enabled source, and section 5 routes the Production PM capacity card through SourcePanel, so an admin will see a `pm_capacity` source's raw mapped rows once one syncs, while the assessment plan defers PM capacity display until PMs are mapped to the roster (S11). No math is shown, so Task 8 follows the contract; the PM mapping slice should revisit what that card shows.~~ Resolved: SourcePanel takes `showRecords` and PM capacity passes false (F19).
- Ruled: R20. Section 1.9 says `src/lib/sync/providers.test.ts` "reads the SQL file with `node:fs`", but the repo has no `@types/node` and `tsc -b` type-checks `src` tests, so a static `import ... from "node:fs"` fails `npm run build`. Task 10 keeps `node:fs` through a dynamic import with a non-literal specifier; Vite's `?raw` import (typed by `vite/client`) would be the cleaner choice if the contract allows it.
- Ruled: R20. `describeSpreadsheet(connectionId, spreadsheetId, gid)` carries no header row, so `/sync/describe` can only read row 1 of a tab; Task 10 says so in the panel hint. A `headerRow` argument would be needed for tabs whose headers are not on row 1.
- ~~`connections/sync.ts` needs `HttpError`, `json`, `service` and `requireAdmin`, which live in `index.ts`; importing `index.ts` would run `Deno.serve`, so Task 10 adds `supabase/functions/connections/http.ts` (helpers moved out of `index.ts`), a file the contract's ownership map does not list. Task 12 verifies `requireAdmin` there.~~ Resolved: the ownership map lists `http.ts` (F13).
- Ruled: R21. Section 4's Task 12 persona rule ("admin -> first admin") makes Kingdom's `admin` persona Avery Stone instead of Marcus Lee, for every earlier Kingdom page test and for `?persona=admin&company=kingdom`; harmless at commit 6d9bfc5, but any Task 2 to 9 assertion on the Kingdom admin's own name would break.
- ~~The 0032 SQL test depends on Task 1's stub shapes (`cron.job` columns, `net.http_post` named arguments), which the harness contract does not fix ("cron (schedule, unschedule, job)", "net (http_post)"); Task 10 may only add test files, so its execute case is conditional.~~ Resolved: the execute case asserts the newest `net.requests` row (F18).
- Ruled: R1 (CLAUDE.md wording is proposed in the task report only, F6). The ownership map gives Task 13 only the CLAUDE.md verification-gate line, but CLAUDE.md "What this is" says "Admins (owners and managers)", which 0033's `manager` value makes wrong, and rule 6 names only GoHighLevel and QuickBooks; Task 13 writes corrected wording for those two lines into its proposed CLAUDE.md wording (report only); no task edits CLAUDE.md.
