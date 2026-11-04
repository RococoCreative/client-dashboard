# Kingdom dashboard revamp: assessment and plan

**Status: assessed and planned, not built.** Prepared for Austin, Rococo Creative, on 2026-11-04, in answer to the Kingdom Dashboard Revamp specification. This is the developer handoff the spec asks for in section 18: it maps what exists, classifies every ask, and sets the build order. Nothing here is implemented, and no migration in it has been applied. Read `CLAUDE.md` and `README.md` first; this document does not override them.

---

## 1. Summary

- **What exists.** One Vite, React and Supabase app runs three companies, kept apart by RLS. Kingdom already has the Dashboard, GSRs, Reviews, Goals, People, SOPs, Resources, Financial snapshots, Marketing and Settings. The nav is three hardcoded flat lists. Roles are `admin` or `employee`, plus a Rococo flag. The `connections` Edge Function handles OAuth sign-in for GoHighLevel and QuickBooks and nothing else. No company has a live connection. There is no scheduler.
- **What does not exist.** There are no tables for projects, milestones, letters, wins, client score, cleanliness, warranties, sync sources or sync logs, and no audit log. Live Kingdom is almost empty: 2 admins, 4 rating pillars, 1 open monthly cycle, 1 draft SOP, and no financials, goals, job roles or connections.
- **What the revamp adds, all inside the current architecture:**
  - a per-company module gate and a four-group nav
  - projects, with milestones under them (a letter is a kind of milestone)
  - manual wins
  - Home cards for attention items, shortcuts and freshness
  - honest scaffolds for the modules nobody has defined yet
  - a sync engine (source config, run log, overlap lock, last-good pointer, six UI states, weekly schedule)
  - a links registry for Monday and other outside tools
  - a role foundation and an audit log
- **Decision 1: Kingdom's shape is data.** A new `companies.modules text[]` column, default empty, is read only through `hasModule()`. Klasik and RBA get the default and see nothing new. No code branches on a slug or theme key (rule 12).
- **Decision 2: Google Sheets uses Google sign-in through the existing `connections` function**, with the `spreadsheets.readonly` scope, the consent screen published In production, and verification submitted. This keeps rule 6 as written: tokens stay on the server and the browser never calls Google. The narrower `drive.file` scope plus Google's file Picker is possible only if you amend rule 6.
- **Decision 3: imported data never goes into the existing financial tables.** Synced values go into a new `sync_records` table that the browser cannot write. Each source points at its last successful run, so a failed sync leaves the last good data showing and never shows zeros. `financial_snapshots` and `employee_financials` stay manual, so Klasik and RBA behave as they do today.
- **Decision 4: the scheduler is Supabase Cron with pg_net, and the sync runs inside the `connections` function.** An hourly tick calls new `/sync/*` routes on the existing `connections` Edge Function, so that function stays the only reader of `connection_tokens` (rule 6). Each source stores its own weekday, time and timezone. Supabase Cron is the only scheduler that needs no service key in the app or in Vercel.
- **Decision 5: roles extend, never reinterpret.** Two values are added: `owner` and `manager`. `owner` and `admin` both keep today's full admin meaning. `manager` gets employee-level access until you supply the capability matrix. Manager team scope and restricted-Admin rules wait for that matrix.
- **Top blockers on your side or Kingdom's:**
  - who Kingdom's Owner is (neither live admin has an owner title)
  - what a "project" is and where its identity comes from
  - the sheet links and field mappings
  - the sync day, time, timezone and stale threshold
  - the capability matrix, including how a Manager's team is defined

---

## 2. Existing-app assessment

### 2.1 Routes and navigation

| Route | Guard | Renders | File |
| --- | --- | --- | --- |
| `/` | company active, else `/rococo` | DashboardPage (Admin or Employee by `isAdmin`) | `src/App.tsx:292` |
| `/gsr`, `/reviews`, `/goals` | WithCompany. Employees are redirected to `/my/*` | CyclesPage (gsr or reviews), GoalsPage | `App.tsx:296-298` |
| `/reviews/settings`, `/reviews/company-goals` | AdminOnly | GsrSettingsPage, CompanyGoalsPage | `App.tsx:299-300` |
| `/gsr/cycles/:id`, `/reviews/cycles/:id` | AdminOnly | CyclePage | `App.tsx:303-304` |
| `/gsr/reviews/:id`, `/reviews/:id` | WithCompany | ReviewPage | `App.tsx:305-306` |
| `/my`, `/my/gsr`, `/my/reviews`, `/my/goals` | WithCompany. Rococo is sent to `/` | My pages | `App.tsx:307-310` |
| `/people`, `/people/:profileId` | AdminOnly | PeoplePage, PersonPage | `App.tsx:311-312` |
| `/sops`, `/sops/:id` and `/sops/new`, `/sops/:id/edit` | members; AdminOnly for new and edit | SOP pages | `App.tsx:313-316` |
| `/resources` | WithCompany | ResourcesPage | `App.tsx:317` |
| `/financials`, `/marketing`, `/settings` | AdminOnly | FinancialsPage, MarketingPage, CompanySettingsPage | `App.tsx:318-320` |
| `/rococo`, `/rococo/companies`, `/rococo/people` | RococoOnly | Portfolio, Companies, Users | `App.tsx:321-323` |
| `*` | | redirect to `/` | `App.tsx:324` |

- **Redirects already in place.** `gsr/settings` goes to `/reviews/settings` and `gsr/company-goals` goes to `/reviews/company-goals`. `RedirectTo` keeps the query string (`App.tsx:85-89`).
- **Nav.** `ADMIN_NAV` has 11 items, `EMPLOYEE_NAV` 6 and `PORTFOLIO_NAV` 3 (`src/components/AppLayout.tsx:25-52`). The list is picked by portfolio, then `isAdmin`, then employee (`:79`). It renders flat, with no grouping (`:133-137`). AppLayout fetches nothing and reads only `useHub()`.
- **Deep links that must keep working.**
  - `/settings` is the OAuth `return_to` (`ConnectionsPanel.tsx:41`).
  - `cyclePath` and `reviewPath` build URLs in code (`src/lib/gsr/cycles.ts:141-146`).
  - The Portfolio quick-entry list links to sections (`PortfolioPage.tsx:206-213`).
  - The dashboard links to `/gsr`, `/financials`, `/marketing`, `/sops`, `/resources` and `/my/*`.
- **Name collision.** `HubSection` already means `'gsr' | 'reviews'` (`cycles.ts:134`). Nav groups need a different name: `NavGroup`.
- **Route collisions to avoid.** A word placed after `/people/`, `/reviews/` or `/sops/` would be caught by the `:id` routes. The new prefixes `/sales-finance`, `/production` and `/wins` are unused today.

### 2.2 Dashboard modules and reusable components

- **Admin dashboard** (`DashboardPage.tsx:132-394`):
  - Stat tiles: People ("N not signed in yet"), GSRs complete, Reviews complete, Team score, Library.
  - Cards: one CycleProgress card per live cycle, Company goals, Financials (latest snapshot through `deriveSnapshot`), Marketing (live campaigns, spend against budget, unbudgeted note), Recent SOPs, Resources.
  - There is no attention list. The signals that exist are inline hints: not signed in, "Period ended, still open", campaigns with no budget, net profit shown in red or green.
- **Employee dashboard** (`:401-662`): Impact score, GSR month, Latest scored review, Goals, Your figures (gated by job role), Company goals, SOPs.
- **The only existing per-company module gate** is `job_roles.dashboard_modules text[]` (`0018_job_roles.sql:25`). It has one value, `financials`, and only shows or hides the employee "Your figures" card (`DashboardPage.tsx:447,609`).
- **The nearest thing to an attention list** is the Rococo PortfolioPage `alerts[]`, shown as warning badges (`PortfolioPage.tsx:98-106,193-200`).
- **UI primitives** in `src/components/ui/*`:
  - Section, Stat, Badge (6 tones), EmptyState, Notice, Skeleton, Tabs, BlurInput, Modal, ConfirmDialog
  - RatingInput (neutral 1 to N)
  - ScoreRing, ScoreBar, bandClass (fixed 80/60/40 colour bands)
  - RatingChoice (red, amber and green deliverable tones)
- **Status tone maps** cover review, previous-review, goal, goal-outcome, SOP, cycle and campaign status. None covers sync or connection state (`src/components/status.ts:6-48`).
- **The only freshness display today** is inline in ConnectionsPanel: "last sync <date>" or "no sync yet" (`ConnectionsPanel.tsx:81-93`).

### 2.3 People, team, GSR and review structures

- **`profiles`.**
  - `id` is the person and `user_id` is null until first sign-in (0013).
  - `role` must be `admin` or `employee` (`0001:156`). `is_rococo_admin` and `is_active` sit on the same row.
  - `hire_date`, `phone`, free-text `department` and `reports_to` came in 0012. `job_role_id` came in 0018.
  - There is no teams table. `reports_to` is display-only: no policy reads it, and nothing checks for same company or cycles.
- **Person-scoped tables.** `employee_kpis`, `compensation_items`, `employee_financials`, `employee_deliverables` with `deliverable_tasks`, `impact_scores`, `goals`, `goal_notes` (owner-only for yearly and BHAG goals) and `goal_private` (owner-only).
- **GSR configuration.**
  - `gsr_pillars` has 4 scoring types and `required_goals`. `gsr_criteria`, `review_cycles`, `reviews` (with `pillar_snapshot` and `gsr_score`) and `review_scores` complete the set.
  - `job_roles` and `job_role_goals` hold role setup. `company_goals` holds company targets.
- **Company inheritance.** `company_id` always comes from the parent, by trigger: `inherit_company_from_employee`, `_cycle`, `_pillar`, `_review`, `inherit_company_from_sop` (0004), `inherit_from_deliverable`, `inherit_from_job_role`, `inherit_impact_score` (0017), `stamp_goal_private`, `stamp_goal_note` (0021).
- **Company moves.** `move_employee_company` (latest version in 0021) re-stamps a person's rows when they change company.
- **Kingdom live.**
  - Roster: Maddie Cothran (admin, Design Lead, no account) and marvin waters (admin, Controller, signed in). Neither has a job role, `reports_to` or hire date. One admin invitation is pending.
  - GSR: 4 rating pillars at 25% each, and one open September 2026 monthly cycle with 1 review in progress.

### 2.4 Projects and milestones

**None of these exist anywhere in the hub:** project, job, lot, milestone, letter, win, warranty, client score, cleanliness, NPS, capacity, sync or sheet. That holds across migrations, types, services and the live database.

- The words appear only incidentally: a test deliverable name, an RBA GoHighLevel stage name, and fixture text.
- The shelved Project assistant (`docs/project-assistant.md`) is a to-do module that deliberately rejected a projects table.
- The separate Kingdom Estimating Tool project has `estimates` (8 rows: 5 draft, 3 archived), `shared_documents`, and its own `profiles` table tied to its own auth users. `estimates` has no company, client, address, job number or external id column, and the `state` jsonb keys hold none of these either. It cannot serve as a project identity source as it stands.

### 2.5 Authentication and authorization

- **Sign-in.** Magic link, gated by the signup hook (`0002`). `handle_new_user` claims the roster row, and the roster's role wins (`0014:89-172`).
- **Private helpers** (latest versions):
  - `auth_profile_id`, `auth_company_id`, `is_rococo_admin`, and `is_company_admin` (`role = 'admin'`, matched on `user_id = auth.uid() and is_active`) are in 0013.
  - `is_company_member` and `can_manage_company` are in 0009.
- **Policies.** About 107 live policies. 82 call `can_manage_company`, which is one predicate for both read and write on every admin surface. The profiles UPDATE policy "Users update own, admins update company profiles" calls `private.is_company_admin()` directly. No policy writes `role = 'admin'` inline.
- **Guards.**
  - `guard_profile_fields` (0018:93-136, BEFORE UPDATE only) stops self-elevation. An admin can still change any other person's role.
  - `guard_review_employee_fields` reads `can_manage_company`.
  - INSERT on `profiles` and on `invitations` has no role guard.
  - `guard_company_fields` protects only `slug` and `theme_key` (0009:101-115).
- **In the UI.** `isRococo` and `isAdmin` are the only permissions (`App.tsx:272-273`, `HubContext.tsx:10-23`). `isAdmin` appears 52 times across 10 non-test files.
- **The `connections` function** repeats the admin check in TypeScript as `role === 'admin'` and does not check `is_active` (`supabase/functions/connections/index.ts:246-256`).
- **There is no audit or log table.** The only provenance is `created_by`, `updated_by`, `invited_by`, `connected_by` and `author_id`.
- **"God mode" today is `is_rococo_admin`.** It is granted to every fresh `@rocococreative.io` profile (`0014:147`), not to Austin alone.

### 2.6 Integrations and scheduled jobs

- **`connections` Edge Function** (live v2, `verify_jwt=false`):
  - Routes: `/start`, `/callback`, `/disconnect`. Providers: `gohighlevel` and `quickbooks` (`type Provider`, `index.ts:22`; `PROVIDERS`, `:174`; `providerFor()` accepts exact keys only, `:176-179`). The callback writes the key as `company_connections.provider` (`:293`).
  - State is HMAC-signed with a 10 minute lifetime. Tokens are kept in `connection_tokens`, which has RLS on and no policies. Only this function reads it.
  - There is no refresh logic and no data pull.
- **`company_connections`.** One row per company and provider. `status` is one of `not_connected`, `connected`, `error`. Also holds `last_synced_at`, `last_error` and `settings jsonb` (`0019:19-40`). The provider check is `('gohighlevel', 'quickbooks')`. Live: 0 rows, and 0 rows in `connection_tokens`.
- **Scheduling.** None exists. `vercel.json` has no crons. The only GitHub workflow is CI. pg_cron and pg_net are available but not installed. `supabase_vault` is installed and holds 0 secrets.
- **QuickBooks scope.** `com.intuit.quickbooks.accounting` allows writes, so read-only has to be enforced in code.

### 2.7 Financial, sales and capacity data, and every existing calculation

| Store | Shape | Provenance | Notes |
| --- | --- | --- | --- |
| `financial_snapshots` (0007) | per company and period type: revenue, cogs, opex, net_profit override, cash_on_hand | `source` is manual, csv or quickbooks | revenue, cogs and opex are NOT NULL DEFAULT 0. CSV upsert overwrites hand rows. Admin-only FOR ALL. Kingdom: 0 rows |
| `employee_financials` (0018) | per person, year and metric: target, current | `source` is manual, quickbooks or ghl | a hand edit resets the source to manual |
| `employee_kpis` (0012), `company_goals` (0003) | display text, numeric columns, `is_hit` toggled by hand | none | nothing computes hit |
| `marketing_campaigns` (0008) | budget, actual_spend, key metric | none | entered by hand |

There are no capacity, pipeline, deposit, invoice or forecast structures.

**Every existing calculation (identified, none to be silently replaced):**

| Calculation | Rule | File |
| --- | --- | --- |
| Gross profit | revenue minus cogs | `src/lib/financials.ts:36` |
| Net | `net_profit` override, else revenue minus cogs minus opex | `financials.ts:37` |
| Gross margin, net margin | divided by revenue. Null when revenue is 0 or less | `financials.ts:40,42` |
| Period snapping and labels | calendar month, quarter or year | `financials.ts:9-26` |
| `parsePeriod` | many formats. Ignores a `year` hint for month-name input | `financials.ts:58-90` |
| CSV import | matched by header alias. A blank cogs or opex becomes 0. A missing revenue rejects the row | `financials.ts:109-159`, `csv.ts` |
| `parseMoney` | `$`, commas, `(500)` as negative. Percent strings return null | `src/lib/format.ts:29-46` |
| `formatMoney`, `formatPercent` | null shows as "-" | `format.ts:20-57` |
| `financialProgress` | current divided by target. Null if either is missing or the target is 0 | `src/lib/people.ts:9-12` |
| Marketing spend ratio | spend divided by budget when budget is above 0. A null spend counts as 0 | `MarketingPage.tsx:133-136` |
| Marketing totals | Dashboard and Marketing exclude unbudgeted campaigns. **Portfolio includes them** (inconsistent) | `PortfolioPage.tsx:130-131` vs `DashboardPage.tsx:214-217` |
| Review scoring | pillar weights. Rating average divided by scale, or capped actual over target. Unscored counts as 0 | `src/lib/gsr/scoring.ts:94-148` |
| Score bands | 80/60/40 thresholds (`scoreBand`) that drive ScoreRing, ScoreBar and bandClass | `scoring.ts:218-224` |
| Deliverables | 0 to 3 scale, two points a task | `src/lib/gsr/deliverables.ts` |
| Month GSR totals | `requiredAndStretch`, `monthTotal`, `scoreMonth` | `src/lib/gsr/goals.ts:134-186` |

Known defects, recorded only:
- The revenue tile says "Entered by hand" for QuickBooks rows (`FinancialsPage.tsx:303`).
- Editing a CSV row keeps its CSV badge (`:52-63`).

### 2.8 Screen-to-data dependencies

| Screen | Services or tables |
| --- | --- |
| Admin Dashboard | profiles, gsr (cycles, pillars, company goals, reviews, scores), sops, resources, financials (snapshots), marketing |
| Employee Dashboard | gsr (reviews, pillars, criteria, impact scores, goals, cycles, company goals), sops, jobRoles, employees (financials) |
| PeoplePage, PersonPage | profiles, invitations, and on PersonPage also gsr, employees, jobRoles. PersonPage checks tenancy through `listCompanyProfiles`, not `assertInCompany` |
| CyclesPage, CyclePage, ReviewPage, GoalsPage | gsr, profiles, employees (KPIs), jobRoles. ReviewPage and CyclePage call `assertInCompany` |
| FinancialsPage, MarketingPage | financial_snapshots, marketing_campaigns |
| CompanySettingsPage | companies, company_domains, connections, job roles, deliverable categories |
| PortfolioPage | every company's profiles, cycles, pillars, invitations, SOPs, snapshots, campaigns |

**Test and demo layer.**
- There is one mock per service in `src/test/mocks/`. A new service has to be added in four places: the mock, the demo alias regex (`demo/vite.config.ts:19`), `vi.mock` in `pages.test.tsx`, and `vi.mock` in `App.rococo.test.tsx`.
- `App.rococo.test.tsx` already lacks mocks for `deliverables`, `jobRoles` and `connections`.
- No `KINGDOM` fixture bundle is exported.
- Baseline: lint passes, 160 of 160 tests pass, build passes.

---

## 3. Classification map

| Spec ref | Requirement | Classification | What it reuses or touches | Notes |
| --- | --- | --- | --- | --- |
| 3 | Four top-level sections: Home, Sales & Finance, Production, People / HR | Modify existing | `AppLayout.tsx:25-52` becomes a registry in `src/lib/navigation.ts`. Module `sectioned_nav` | Flat layout stays the default and stays identical for Klasik and RBA. The utility group is input 34 |
| 3 | Reorganize existing functionality into the sections | Modify existing | Existing routes grouped, not moved | Marketing goes under Sales & Finance. SOPs, Resources and Settings go in a utility group, pending input 34 |
| 3 | Preserve deep links or redirect | Reuse as-is | Every route in `App.tsx:292-324`. `RedirectTo` for any alias | No existing route moves |
| 3 | Filter nav by permission | Modify existing | The same predicates as the route guards (`isAdmin`, `hasModule`) | Capabilities plug in once the matrix exists. Guards and RLS remain the control |
| 3 | Retain branding and design | Reuse as-is | Theme tokens, `ui/*` | |
| 3 | Home: company snapshot | Reuse as-is | AdminDashboard stat tiles and cards | The label becomes "Home" only when `sectioned_nav` is on. Scope is input 33 |
| 3 | Home: exceptions and attention items | Add missing | PortfolioPage `alerts[]` pattern, Badge | Built only from signals that already exist, plus sync states |
| 3 | Home: wins | Add missing | New `wins` table, Section | |
| 3 | Home: shortcuts to sections and external tools | Add missing | PortfolioPage quick-entry pattern, `external_links` | |
| 3 | Home: source freshness | Add missing | FreshnessCard built on FreshnessLine and SyncStateBadge (S6) | Generalizes the ConnectionsPanel "last sync" line |
| 3, 7 | Sales & Finance: existing Financials and Marketing pages | Reuse as-is | `/financials`, `/marketing` | Not re-pointed at imported data |
| 3, 7 | Sales & Finance: read-only reporting page | Add missing | `/sales-finance`, MappedTable | Content waits for mappings |
| 3, 8 | Sales & Finance: QuickBooks controls | Add missing (placeholder now) | `/sales-finance/controls`, ScaffoldCard, module `qbo_controls` | Content waits on S12 |
| 3, 15 | Sales & Finance: Monday sales CRM access | Add missing | `external_links` with `nav_group = 'sales_finance'` | A link, not an integration |
| 3, 9 | Production: PM capacity | Defer pending input | Sync engine, `external_people` | The infrastructure ships earlier |
| 3 | Production: project snapshots | Add missing | `projects`, milestone counts | No health or status calculations |
| 3, 10 | Production: milestones including letters | Add missing | `project_milestones.kind` | |
| 3, 11 | Production: client score and cleanliness scaffolds | Add missing | EmptyState, Badge | UI only |
| 3, 13 | Production: job health and warranty | Defer pending input | Placeholder card | |
| 3 | People / HR: people and team information | Reuse as-is | PeoplePage, PersonPage | |
| 3 | People / HR: GSRs and employee functions | Reuse as-is | GSR, Reviews, Goals and My pages | |
| 3, 14 | People / HR: role-appropriate team management | Defer pending input | `reports_to`, `my_team_ids()` | The helper is built. Policies wait for the matrix and input 30a |
| 4 | Sales reporting from Sheets, read-only | Add missing | `sync_records` (no browser write policy) | |
| 4 | Financial reporting from Sheets or QuickBooks, read-only | Add missing | `sync_records` | `financial_snapshots` is left manual |
| 4 | Controls from QuickBooks, read-only | Add missing | Sync engine QuickBooks adapter | |
| 4 | Tasks and CRM stay in Monday | Reuse as-is | Project assistant stays shelved | No task tables |
| 4 | Project start and completion source | Defer pending input | | No date columns invented |
| 4 | No writeback | Add missing | GET-only QuickBooks client, read-only Google scope | QuickBooks scope allows writes, so code enforces read-only |
| 4 | Local editing of milestones, letters, wins | Add missing | New tables, BlurInput | |
| 4 | Local editing of future client-score and cleanliness inputs | Defer pending input | | Waits on input 28 (S14) |
| 4 | Reuse existing local structures for dashboard-owned data | Reuse as-is (none apply) | Assessment 2.4 | No milestone, letter or win structure exists. The shelved Project assistant is not reused |
| 4 | Imported values never overwritten; source shown | Add missing | Separate tables, source badge pattern (`FINANCIAL_SOURCE_LABELS`) | |
| 5 | Live authenticated read-only Sheets access | Modify existing | `connections` registry gains a `google_sheets` ProviderDef | One key everywhere: function, types, 0028 check, 0029 check |
| 5 | Configure spreadsheet, tabs and ranges | Add missing | `sync_sources.config` | Several sources per connection |
| 5 | Map source fields to dashboard fields | Add missing | `sync_sources.field_map` | The actual mappings come from Kingdom |
| 5 | Multiple tabs or spreadsheets | Add missing | `sync_sources` rows | |
| 5 | Validate required headers and types | Add missing | Pure parser in `supabase/functions/_shared/sync/parse.ts` | Covered by vitest |
| 5 | Blank rows, missing values, dates, currency, percent | Add missing | Parser, `UNFORMATTED_VALUE` | Blank stays null |
| 5 | Header mapping, not positional | Modify existing | `normalizeHeader` from `src/lib/csv.ts` moved to the shared module | |
| 5 | Do not guess formulas from spreadsheet labels | Add missing (constraint) | `field_map` has no formula type. MappedTable shows mapped values only | |
| 5 | Credentials server-side only | Reuse as-is | `connection_tokens`, read only by the `connections` function | |
| 5 | Store only required data; keep source identifiers | Add missing | Only mapped fields stored. `source_ref` holds spreadsheet, gid and row | |
| 5 | Source configuration fields (name through error details) | Add missing | `sync_sources`, `sync_runs` | |
| 6 | Automatic weekly refresh | Add missing | pg_cron, pg_net, Vault, `connections` `/sync/tick` route | Day, time and timezone pending |
| 6 | Use the existing scheduling mechanism where available | Add missing (none exists) | Assessment 2.6. Supabase Cron with pg_net calling the `connections` function | Decision 4 |
| 6 | Retrieve current source data on each sync | Add missing | `values.batchGet` live read every run, never cached | |
| 6 | Permission-controlled Sync now | Add missing | `sync_requested_at` write as the user, under its own predicate `private.can_sync_source()` | Allowed roles pending. Default is admins |
| 6 | No overlapping syncs | Add missing | Unique partial index on running runs | |
| 6 | Apply consistently; keep last good | Add missing | `current_run_id` pointer | |
| 6 | No zeros for missing or failed data | Add missing | Null-preserving parser, `formatMoney` "-" | |
| 6 | Six UI states, stale visible, last success time | Add missing | `src/lib/sync/state.ts`, Badge, `SYNC_STATE_TONE` | Stale needs a threshold |
| 6 | Stale data visible | Add missing | `stale_after_hours`, SyncStateBadge "Stale data", age always shown | Threshold is input 15 |
| 6 | Log attempts and failures | Add missing | `sync_runs` | |
| 6 | Higher-frequency refresh | Defer pending input | Hourly tick already supports it | |
| 7 | Render mapped sales and financial data | Defer pending input | MappedTable | Code ready. Mapping pending |
| 7 | Keep source-owned sales and financial values read-only | Add missing | `sync_records` with no write policy. MappedTable has no inputs | |
| 7 | Show reporting periods and freshness | Add missing | Period field type, FreshnessLine | |
| 7 | Route to the source | Add missing | Sheet URL built from `source_ref` | |
| 7 | Reuse charts and cards | Reuse as-is | Stat, Section, EmptyState | |
| 7 | Financial definitions | Defer pending input | | No formulas built |
| 7 | Identify and review existing calculations | Reuse as-is | Section 2.7 list | Left unchanged for Klasik and RBA. Not applied to imported values |
| 8 | Reuse the QuickBooks connection | Reuse as-is | `connections` QuickBooks provider | |
| 8 | Read-only, record ids, source navigation | Add missing | QuickBooks adapter, `source_ref`, invoice deep link | |
| 8 | Same freshness and sync-state conventions as Sheets | Add missing | QuickBooks sources are `sync_sources` rows. `syncState()`, SyncStateBadge, FreshnessLine, `current_run_id` | No QuickBooks-specific state logic |
| 8 | Invoice and payment pulls | Add missing | Invoice and Payment query, GET only, projected through `field_map` | Display waits for field confirmation |
| 8 | Reporting areas: invoices, payments and collections, outstanding balances | Add missing (pull) / Defer (display) | Invoice and Payment queries, `Balance` | Fields and definitions wait on input 22 |
| 8 | Reporting area: cash in/out | Defer pending input | `CashFlow` report pull | Basis is input 23 |
| 8 | Do not create, edit, send or reconcile invoices | Add missing (constraint) | Adapter exposes only GET `query` and `report` | |
| 8 | Aging, escalation, partial payments, "not sent", cash basis | Defer pending input | | Not hard-coded |
| 9 | Map source PMs to app users explicitly | Add missing | `external_people` to `profiles.id` | No name matching alone |
| 9 | Show approved fields with periods and units | Add missing | `field_map.unit`, MappedTable | |
| 9 | Unavailable, not zero; read-only | Add missing | Parser, RLS | |
| 9 | Do not infer production start from deposits, contract signing, project creation or milestone completion | Add missing (constraint) | `projects` has no start column. `created_at` and `completed_on` are never labelled a start | Source is input 29 |
| 9 | Capacity formula, targets, overlap, job health | Defer pending input | | |
| 10 | Project reference | Add missing | `projects` registry | Identity source pending |
| 10 | Milestone record fields | Add missing | `project_milestones` | Status set waits on input 8. Completion is `completed_on` |
| 10 | Add, edit, reorder, update | Add missing | MilestoneList, `sort_order` | |
| 10 | Scoped to project; history kept | Add missing | Inherit trigger, archive instead of delete, audit | |
| 10 | Letters as milestone items; no fixed count | Add missing | `kind = 'letter'` | |
| 10 | Completion not equal to physical completion or invoicing | Add missing (constraint) | No triggers off completion | |
| 11 | Separate client score and cleanliness scaffolds | Add missing | ScaffoldCard | |
| 11 | Future association | Defer pending input | | Table shape waits for definitions |
| 11 | Use existing scoring components where appropriate | Reuse as-is (limited) | EmptyState, Stat, later RatingInput | `scoring.ts`, ScoreRing and bands are not reused |
| 11 | No fake scores, averages, thresholds, NPS | Add missing (constraint) | "Not configured" state | |
| 12 | Manual wins with fields and provenance | Add missing | `wins.source_type` | |
| 12 | Wins on the company snapshot | Add missing | Home WinsCard | |
| 12 | No speculative review, Slack or milestone win automations | Defer pending input | `source_type` check allows only `'manual'` | Future sources wait on input 27 |
| 12 | Edit permissions, display duration, archival | Defer pending input | | Default: admins edit, most recent shown |
| 13 | Warranty: keep existing, add placeholder | Add missing (placeholder) | | Nothing exists in the hub to preserve. Outside tracking is asked in input 29 |
| 14 | Owner and Manager roles in the hierarchy | Modify existing | CHECK constraints, `is_company_admin`, `guard_profile_fields` | |
| 14 | Extend the existing authorization system, no parallel one | Modify existing | `profiles.role`, private helpers, `can_manage_company`. Later `role_capabilities` read by `private.can()` | |
| 14 | Admin: most functionality with selected restrictions | Defer pending input | `role = 'admin'` keeps today's full meaning | Restrictions wait on input 30. "Most functionality" is not treated as a spec |
| 14 | Backend enforcement, not hidden buttons | Reuse as-is | RLS, private helpers | |
| 14 | Manager record-level scope | Defer pending input | `my_team_ids()` built, unused | Team definition is input 30a |
| 14 | Separate view, edit, integration and user admin | Defer pending input | Capability table later. Sync already has its own predicate | |
| 14 | Log privileged changes | Add missing | `audit_events` | |
| 14 | Preserve users during role migration | Modify existing | Widen, never rewrite rows | |
| 14 | Austin / God mode | Reuse as-is | `is_rococo_admin` | Austin-only tier pending |
| 15 | Configurable entry points with direct links | Add missing | `external_links` | |
| 15 | Direct-link fallbacks | Add missing | ExternalLinkButton beside every EmbedFrame | |
| 15 | Embeds where available and approved | Add missing | EmbedFrame, `embed_is_public` | Only public share views |
| 15 | Do not assume an iframe bypasses source permissions | Add missing (constraint) | `embed_is_public` only. Logged-in iframes never used | |
| 15 | Destination clear; source authentication kept | Add missing | ExternalLinkButton | |
| 15 | Board, view and signal routing inputs | Defer pending input | | |
| 16 | Archie | Defer pending input | | Nothing built, no empty assistant |
| 16 | No dependency on Archie; integration point possible later | Defer pending input | No module key, route or table reserved | Nothing references it |

---

## 4. Proposed change set (build slices)

Every slice ends on `npm run lint`, `npx vitest run` and `npm run build`, plus a demo walk at `?persona=admin&company=klasik` (proves nothing changed) and `?persona=admin&company=kingdom`. Every slice that adds a service adds it in four places: the mock, the demo alias, `pages.test.tsx` and `App.rococo.test.tsx`.

**Order and dependencies.**
- S1 first. Every later page uses `ModuleOnly` and `navigation.ts`.
- S2 before any slice that attaches audit triggers (S3, S6, S7, S9), because they call `private.audit_change()` from 0025.
- S3 before S4, because `wins.project_id` references `projects`.
- S4 before S6 and S7, because they edit `attention.ts` and ShortcutsCard.
- S5 before S6 and S7, because they mount panels and links on the S5 pages.
- S6 before S8, S9 (both edit the `connections` sync routes) and S10 to S12.
- Each slice passes the three gates and the Klasik demo walk when applied in this order.

### Infrastructure that needs no business input

#### S1. Module gate and four-group nav
- **Purpose.** A per-company switch for Kingdom's shape, and grouped nav, with Klasik and RBA unchanged item for item.
- **Migration.** `0024_company_modules.sql`.
- **New files.**
  - `src/lib/modules.ts`: `ModuleKey`, `MODULE_KEYS`, `MODULE_LABELS`, and `hasModule(company, key)` as the only reader.
  - `src/lib/navigation.ts`: `NavGroup` (`home`, `sales_finance`, `production`, `people_hr`, `utility`), one `NAV_ITEMS` registry with `{to, label, icon, end, audience, group, requires?}`, and `navFor(company, isAdmin, isRococo)`.
- **Edited files.**
  - `src/components/AppLayout.tsx`: renders flat or grouped and hides empty groups.
  - `src/App.tsx`: adds a `ModuleOnly` guard.
  - `src/types/database.ts`: adds `Company.modules`.
  - `src/services/companies.ts`: adds `modules` to `COLUMNS` and `CompanyPatch`.
  - `src/test/mocks/companies.ts`.
  - `src/test/fixtures.ts`: `modules` on every company, Kingdom with its modules on, and a `KINGDOM` bundle export.
  - `src/pages/rococo/CompaniesPage.tsx`: Rococo-only module checkboxes.
  - `src/pages/DashboardPage.tsx`: the heading reads "Home" only under `sectioned_nav`.
  - `src/App.rococo.test.tsx`: adds the three missing `vi.mock` lines, and changes its Kingdom heading assertion to "Home".
  - `CLAUDE.md` rule 12 list and `README.md`: add "modules".
- **Module keys.** `sectioned_nav`, `home_snapshot`, `production`, `wins`, `data_sources`, `qbo_controls`, `external_links`.
- **Tests.**
  - `modules.test.ts`.
  - `navigation.test.ts`: the flat layout equals today's three arrays item for item, and grouping holds.
  - Page test: Kingdom admin sees four group headings, Kingdom employee sees no Sales & Finance.
  - Route test with `sectioned_nav` on: every route in `App.tsx:292-324`, plus `/gsr/settings` and `/gsr/company-goals`, renders or redirects exactly as with it off, and `/settings?connected=...` still lands on Settings.
  - The existing Klasik tests stay unchanged, as the proof that nothing moved.
- **Does not:** move any route, rename "Dashboard" for Klasik or RBA, or touch roles.

#### S2. Audit log
- **Purpose.** Record privileged configuration and permission changes from here on.
- **Migration.** `0025_audit_log.sql`.
- **Files.**
  - `src/services/audit.ts` and its mock.
  - `src/pages/rococo/ActivityPage.tsx` at `/rococo/activity` (RococoOnly), plus a `PORTFOLIO_NAV` entry.
  - `src/types/database.ts`.
- **Tests.**
  - Page test: renders events from fixtures.
  - SQL editor check: apply twice, change a role inside a transaction, read the event, roll back. A company admin session reads 0 rows.
- **Does not:** add company-admin read access, in RLS or in the UI (pending the capability matrix), or log ordinary content edits.

#### S3. Projects, milestones and letters
- **Purpose.** Dashboard-owned project checkpoints.
- **Migration.** `0026_projects_milestones.sql`.
- **New files.**
  - `src/services/projects.ts`: `listProjects`, `getProject`, `createProject`, `updateProject`, `archiveProject`, `listMilestones`, `createMilestone`, `updateMilestone`, `reorderMilestones`, `archiveMilestone`.
  - `src/test/mocks/projects.ts`.
  - `src/lib/milestones.ts`: ordering, next `sort_order`, counts (complete when `completed_on` is set).
  - `src/pages/production/ProductionPage.tsx` (`/production`).
  - `src/pages/production/ProjectPage.tsx` (`/production/projects/:projectId`, calls `assertInCompany`).
  - `src/components/production/MilestoneList.tsx`: BlurInput fields, a completed-on date, up and down reorder, letter filter.
  - `src/pages/production/productionTabs.ts`.
- **Edited files.** `App.tsx` (routes behind `ModuleOnly('production')`), `navigation.ts`, types, fixtures (Kingdom projects with obviously fictional names, used in tests and demo only), demo alias, both `vi.mock` lists.
- **Tests.**
  - `milestones.test.ts`.
  - Page tests: add, edit and reorder a milestone. A letter milestone shows its badge. A record from another company is refused.
  - Page test: an employee typing `/production/projects/:id` directly is redirected if the route is admin-only, and sees no edit controls otherwise.
  - Klasik tests stay unchanged.
- **Does not:** add a milestone status column (waits on input 8), project status, start or completion dates, health, a milestone template or a fixed count, deletes, or automation from milestone completion.

#### S4. Manual wins and Home cards
- **Purpose.** Wins, attention items and shortcuts on Home.
- **Migration.** `0027_wins.sql`.
- **New files.**
  - `src/services/wins.ts` and its mock.
  - `src/lib/attention.ts`: pure. Builds items only from existing signals: people not signed in, cycle period ended but still open, campaigns with no budget, connection status `error`.
  - `src/components/home/AttentionCard.tsx`, `WinsCard.tsx`, `ShortcutsCard.tsx`.
  - `src/pages/WinsPage.tsx` (`/wins`).
- **Edited files.** DashboardPage: cards added under `home_snapshot` and `wins`. Navigation, types, fixtures, mocks.
- **Tests.** `attention.test.ts`, plus a page test that creates and edits a win and shows the "Manual" source badge.
- **Does not:** pull wins from reviews, Slack or milestones, or decide display duration or archival rules.

#### S5. Scaffolds and placeholders
- **Purpose.** Show honest "Not configured" states for client score, cleanliness, job health, warranty, PM capacity, Sales & Finance reporting and Controls.
- **Migration.** None.
- **New files.**
  - `src/components/production/ScaffoldCard.tsx`, built on EmptyState with a neutral Badge and a short list of what is pending.
  - `src/pages/salesFinance/SalesFinancePage.tsx` (`/sales-finance`) and `ControlsPage.tsx` (`/sales-finance/controls`).
  - `src/pages/salesFinance/salesFinanceTabs.ts`.
- **Edited files.**
  - `src/App.tsx`: routes `/sales-finance` behind `ModuleOnly('data_sources')` and `/sales-finance/controls` behind `ModuleOnly('qbo_controls')`, both AdminOnly until the capability matrix.
  - `src/lib/navigation.ts`: both items in group `sales_finance`.
  - `src/pages/production/ProductionPage.tsx`: ScaffoldCards for client score, cleanliness, job health, warranty and PM capacity.
- **Tests.**
  - A page test asserts the "Not configured" copy and no digits in scaffold cards.
  - A Klasik admin gets a redirect from `/sales-finance`.
  - A Kingdom employee typing `/sales-finance` directly is redirected, not just missing a nav item.
- **Does not:** create score tables, scales, averages, rankings, colour bands or NPS.

#### S6. Sync engine and honest UI states
- **Purpose.** Everything a live source needs except the provider adapters.
- **Migration.** `0028_sync_engine.sql`.
- **New files.**
  - `supabase/functions/connections/sync/run.ts`: the sync routes the `connections` function serves:
    - `/sync/run` (user JWT), `/sync/tick` (cron secret) and `/sync/describe`
    - a provider adapter interface; no adapter yet, so a run fails with "Provider not supported yet"
    - keeping the routes inside `connections` keeps it the only reader of `connection_tokens` (rule 6)
  - `supabase/functions/_shared/sync/parse.ts`, `schedule.ts` and `keys.ts`: pure, with no Deno or npm imports and no token access.
  - `src/lib/sync/state.ts`: `syncState()`.
  - Tests: `src/lib/sync/parse.test.ts`, `schedule.test.ts` and `state.test.ts` (the parse and schedule tests import the `_shared` modules).
  - `src/services/sync.ts` and `src/test/mocks/sync.ts`.
  - `src/components/sync/SyncStateBadge.tsx`, `FreshnessLine.tsx`, `MappedTable.tsx`.
  - `src/components/settings/DataSourcesPanel.tsx`: source editor, field-map rows, record key, schedule, stale threshold, Sync now, run history.
  - `src/components/home/FreshnessCard.tsx`: one FreshnessLine and SyncStateBadge per enabled `sync_sources` row, with its last successful sync time and a link to the module it feeds.
- **Edited files.**
  - `supabase/functions/connections/index.ts`: dispatches `/sync/*` paths to `sync/run.ts`.
  - `src/types/database.ts`: row types for `sync_sources`, `sync_runs`, `sync_records` and `external_people`, plus `ConnectionProvider` and `CONNECTION_PROVIDER_LABELS` gaining `google_sheets`, in step with 0028.
  - `src/components/status.ts`: `SYNC_STATE_TONE`.
  - `src/lib/attention.ts`: adds Sync failed and Stale.
  - `src/lib/csv.ts`: imports `normalizeHeader` from the shared module.
  - `src/pages/DashboardPage.tsx`: FreshnessCard under `home_snapshot` and `data_sources`.
  - `src/pages/CompanySettingsPage.tsx`: DataSourcesPanel under `data_sources`.
  - Fixtures: one source in each of the six states (not connected, connected awaiting first sync, running, failed with last good data, stale, synced).
- **Tests.**
  - Parser: headers, blanks, serial dates, currency, percent fractions, text in a number field, duplicate keys.
  - State precedence.
  - Page test: a failed sync shows the last good values with their time and never a 0.
  - Page test: Kingdom Home shows one freshness line per source, and a failed source shows its last success time.
- **Does not:** connect Google, pull QuickBooks, or schedule anything.

#### S7. External links registry and Monday entry points
- **Purpose.** Configurable shortcuts and approved embeds.
- **Migration.** `0029_external_links.sql`.
- **Files.**
  - `src/services/externalLinks.ts` and its mock.
  - `src/components/links/ExternalLinkButton.tsx`: shows the label, the host, "Opens in a new tab" and what the link is for; opens with `noopener`.
  - `src/components/links/EmbedFrame.tsx`: sandboxed iframe, only when `embed_is_public`, captioned "Public share view", always with the direct link beside it.
  - `src/components/settings/ExternalLinksPanel.tsx`.
  - `src/types/database.ts`: `ExternalLink`, in step with 0029.
  - ShortcutsCard reads the registry.
  - `src/pages/CompanySettingsPage.tsx`: ExternalLinksPanel under `external_links`.
  - SalesFinancePage, ProductionPage and the People section list the links whose `nav_group` matches, so Monday CRM links appear under Sales & Finance.
- **Tests.** Page test: the link shows its destination, links appear in the section named by `nav_group`, and the embed renders only when it is flagged public (no network in CI, so the test asserts the attributes and the fallback).
- **Does not:** call the Monday API, copy any CRM or task record, or assume a logged-in iframe works.

#### S8. Google Sheets provider and weekly schedule
- **Purpose.** A real, live connection.
- **Migration.** `0030_sync_schedule.sql`. It runs after your setup steps in 6.6.
- **Edited files.**
  - `supabase/functions/connections/index.ts`: `google_sheets` added to the `Provider` union, the `PROVIDERS` map and `providerFor()`, and `requireAdmin` fixed to check `is_active`.
  - `supabase/functions/connections/sync/`: the Google adapter and `/sync/describe`.
  - `ConnectionsPanel.tsx`: the Google row shows only under `data_sources`.
- **Tests.**
  - Parser tests on stored `batchGet` JSON, and schedule tests across a DST change.
  - A unit test that every ProviderDef key appears in the 0028 provider check list.
- **Does not:** populate any module. That needs the mappings.

#### S9. Role hierarchy foundation
- **Purpose.** Owner and Manager as values, a ranked grant guard, `reports_to` integrity, and the team helper.
- **Migration.** `0031_role_hierarchy.sql`.
- **Edited files.**
  - `src/types/database.ts`: `Role`, `ROLE_LABELS`.
  - `src/lib/people.ts`: `isCompanyAdminRole()`.
  - `App.tsx:273`, `DashboardPage.tsx:228`, `PortfolioPage.tsx:70`, `PeoplePage.tsx:86`.
  - The role selects in PeoplePage, PersonPage and UsersPage: Owner is offered only to an owner or a Rococo admin.
  - The `connections` function, including its sync routes, uses the same admin-role rule.
  - Fixtures and demo personas gain `owner` and `manager`.
- **Tests.**
  - Role helper.
  - Page tests: an owner sees what an admin sees; a manager sees the employee dashboard.
  - SQL checks: a cycle, a cross-company `reports_to`, and an admin granting owner are all rejected. A simulated new `@rocococreative.io` auth user insert still succeeds after 0031.
- **Does not:** give managers any team access, restrict admins, or create the capability table.

### Slices that need mappings or definitions

| Slice | Purpose | Needs | Migration |
| --- | --- | --- | --- |
| S10 Sales & Finance reporting | Configure sources for sales and financial reporting, render them in MappedTable, check the figures against the sheet | Sheet links, tabs, fields, period conventions | none |
| S11 PM capacity | Map PMs to `profiles.id` in `external_people`, show the capacity card; unmapped PMs flagged, never dropped | Capacity sheet, PM key, PMs on the roster | none |
| S12 QuickBooks controls | Refresh with token rotation inside the lock, GET-only Invoice and Payment queries, deep links, mapped fields only (the confirmed subset from input 22) plus `source_ref` {entity, Id, realmId}. QuickBooks runs go through the same sync engine, so all six UI states, the last-good pointer and the run log apply unchanged | Kingdom connects QuickBooks, confirmed fields and definitions, production Intuit keys | none |
| S13 Capability matrix and Manager scope | `role_capabilities` seeded to today's behavior, `private.can(cid, cap)`, view and edit policy split, `can_sync_source` body changed to the sync capability, team policies via `my_team_ids()`, company-admin audit read if the matrix grants it | The completed matrix, team definition (input 30a) | 0032 onward |
| S14 Client score and cleanliness inputs | Tables and entry UI | Definitions, scale, subject, thresholds decision, permissions | later |

---

## 5. Data migrations and access-control changes

General rules for every new migration:
- Idempotent (`if not exists`, `create or replace`, drop then create a policy).
- Explicit `enable row level security`, without relying on the unmanaged `rls_auto_enable` trigger.
- Grants to `authenticated`, nothing to `anon`.
- An index on every foreign key.
- `set_updated_at` triggers.
- `created_by` and `updated_by` reference `profiles` and are stamped with `private.auth_profile_id()`.
- Every child table gets `company_id` from its parent by trigger. Every top-level table declares `company_id uuid not null references companies(id) on delete cascade` with an index.
- Every function body is copied from its latest version (`guard_company_fields` 0009, `is_company_admin` 0013, `guard_profile_fields` 0018, `move_employee_company` 0021) before extending it. Applied files are never edited.

### 0024_company_modules
- `alter table companies add column if not exists modules text[] not null default '{}'`. There is no CHECK constraint; the app registry ignores unknown keys.
- Re-create `guard_company_fields` from the **0009** body and add `or new.modules is distinct from old.modules`. Only Rococo can change modules.
- The policies are unchanged, and `list_companies_public` does not expose the column.
- **Existing companies:** `'{}'`, which is today's behavior. Kingdom is switched on by a Rococo admin in Rococo > Companies, not seeded by slug.

### 0025_audit_log
- `audit_events`:
  - `id`, `company_id` (nullable, set null on company delete), `table_name`, `row_id`
  - `action` (insert, update or delete), `changed jsonb` (watched column to old and new value)
  - `actor_user_id`, `actor_profile_id`, `actor_kind` (`user`, `rococo` or `system` when `auth.uid()` is null), `created_at`
- `private.audit_change()` is SECURITY DEFINER with `search_path=''`. It receives the watched columns as trigger arguments and writes a row only when one of them differs. Execute is revoked from public.
- Watched tables:
  - `companies` (modules, slug, theme_key, name)
  - `profiles` (role, is_active, is_rococo_admin, company_id, reports_to, job_role_id)
  - `invitations` (role, email)
  - `company_domains`
  - `company_connections` (status, provider, external account)
  - `gsr_pillars` (weight, scoring_type, required_goals)
  - `job_roles` (dashboard_modules)
  - Each later migration attaches the trigger to its own config tables.
- RLS: select when `private.is_rococo_admin()` only. Company-admin read waits for the capability matrix (S13). No insert, update or delete policies, and insert, update and delete are revoked from `authenticated`.
- **Existing companies:** nothing visible. Events start accumulating.

### 0026_projects_milestones
- `projects`:
  - `id`, `company_id uuid not null references companies(id) on delete cascade` (indexed), `name`, `reference` (Kingdom's job number, nullable), `notes`
  - `source text not null default 'manual' check (source in ('manual'))`, `source_key` (nullable, reserved for the identity source once decided)
  - `archived_at`, `created_by`, `updated_by`, timestamps
  - unique `(company_id, source, source_key)` where `source_key` is not null
- `project_milestones`:
  - `id`, `company_id` (inherited), `project_id` (FK, on delete restrict), `title`, `description`
  - `kind check ('milestone','letter')`
  - `sort_order`, `target_date`, `responsible_profile_id` (FK to profiles, on delete set null), `completed_on` (nullable; a milestone is complete when it is set)
  - No `status` column yet. Kingdom's status set is input 8, and a later migration adds the column with the confirmed values.
  - `archived_at`, `created_by`, `updated_by`, timestamps
- Triggers:
  - `inherit_from_project` (pattern: `inherit_from_job_role`, 0018:157-171). The client never sets `company_id`.
  - A responsible-person check: same company, on the `inherit_impact_score` pattern.
  - `profiles_move_clears_milestone_owner`, AFTER UPDATE OF company_id on profiles. A separate small trigger, so `move_employee_company` is left alone.
  - Audit triggers.
- RLS:
  - select: `private.is_company_member(company_id)`.
  - insert and update: `private.can_manage_company(company_id)`, with the same check on the new row.
  - No delete policy. Rows are archived, which keeps history.
- **Pending default:** only admins edit milestones. Kingdom's PMs are employees, so milestone editing is the most urgent capability-matrix answer.

### 0027_wins
- `wins`:
  - `id`, `company_id uuid not null references companies(id) on delete cascade` (indexed), `title`, `description`, `won_on date not null`
  - `project_id` (nullable; same-company check by trigger), `team` (nullable text, picked from existing `profiles.department` values; its meaning is input 27)
  - `source_type not null default 'manual' check ('manual')`, `source_ref jsonb`
  - `archived_at`, `created_by`, `updated_by`, timestamps
- Guard trigger: browser writes always get `source_type='manual'` and a null `source_ref`.
- RLS: select for members, insert and update for `can_manage_company`, no delete.

### 0028_sync_engine
- Widen `company_connections_provider_check` to `('gohighlevel','quickbooks','google_sheets')`. This drops and re-adds the constraint and leaves 0019 untouched. `google_sheets` is the one key used in the function, the types and 0029.
- `private.can_sync_source(cid uuid)`: stable, SECURITY DEFINER, returns `private.can_manage_company(cid)` today. It is the only predicate behind Sync now. S13 changes its body to the sync capability without touching the view policy.
- `sync_sources`:
  - `id`, `company_id uuid not null references companies(id) on delete cascade` (indexed), `connection_id` (FK; same-company check by trigger), `provider`, `name`, `target_module`
  - `config jsonb` (`spreadsheet_id`, `sheet_gid`, `range`, `header_row`, or a QuickBooks entity)
  - `field_map jsonb` (array of `{header, key, label, type: text|number|currency|percent|date|period|person, unit, required}`), `record_key text[]`
  - `sync_weekday`, `sync_time`, `sync_timezone` (all nullable; null means manual only), `stale_after_hours` (nullable; pending)
  - `enabled`, `current_run_id`, `last_attempt_at`, `last_success_at`, `last_status`, `last_error`, `sync_requested_at timestamptz`, audit columns
- `sync_runs`:
  - `id`, `company_id` (inherited from the source), `source_id`, `connection_id`
  - `trigger check ('schedule','manual')`, `requested_by` (profile)
  - `status check ('running','succeeded','failed','abandoned')`
  - `started_at`, `finished_at`, `rows_read`, `rows_applied`, `rows_blank`, `error_detail jsonb`
  - **Overlap lock:** `create unique index on sync_runs (connection_id) where status = 'running'`. It is per connection, so a token refresh never runs twice at once.
- `sync_records`: `id`, `company_id` (inherited from the source), `source_id`, `run_id`, `record_key`, `data jsonb` (mapped fields only), `source_ref jsonb` (spreadsheet, gid and row, or the QuickBooks entity, Id and realmId), plus an index on `(source_id, run_id)`.
- `inherit_from_sync_source`: a BEFORE INSERT trigger on `sync_runs` and `sync_records` that sets `company_id` from `sync_sources`.
- `external_people`:
  - `id`, `company_id uuid not null references companies(id) on delete cascade` (indexed), `provider`, `external_key` (normalized), `label`, `profile_id` (FK; same-company check by trigger), unique `(company_id, provider, external_key)`
  - A `profiles_move_clears_external_people` trigger.
- Audit triggers on `sync_sources` (provider, connection_id, config, field_map, record_key, the schedule columns, stale_after_hours, enabled) and on `external_people` (external_key, profile_id).
- RLS:
  - Every table: select via `can_manage_company`. That is today's admin-only financial posture; who may see finance and capacity is pending. Select is the view permission only.
  - `sync_sources` insert: `can_manage_company`. `sync_sources` update: `can_manage_company(company_id) or private.can_sync_source(company_id)`. A guard trigger lets a user who passes only `can_sync_source` change `sync_requested_at` and nothing else, so viewing, configuring and syncing stay three separate predicates even once S13 splits them.
  - `external_people`: insert and update via `can_manage_company`.
  - A guard trigger blocks browser writes to `current_run_id` and every `last_*` column. `sync_requested_at` is exempt.
  - `sync_runs` and `sync_records`: **no write policies at all.** Only the `connections` function's service role writes them, so imported values cannot be edited locally. RLS enforces this, not the UI.
- **Existing companies:** nothing visible. The new rows exist only when a source is configured.

### 0029_external_links
- `external_links`:
  - `id`, `company_id uuid not null references companies(id) on delete cascade` (indexed), `nav_group check (home, sales_finance, production, people_hr)`, `label`, `destination_note`
  - `url check (url ~ '^https://')`, `provider check ('monday','quickbooks','google_sheets','other')`
  - `embed_url` (nullable), `embed_is_public boolean default false` (embed allowed only when true)
  - `audience check ('admins','everyone')`, `sort_order`, audit columns
- RLS:
  - select: `is_company_member(company_id) and (audience = 'everyone' or can_manage_company(company_id))`
  - write: `can_manage_company`
  - audit trigger

### 0030_sync_schedule
- `create extension if not exists pg_cron` and `pg_net`.
- Unschedule `hub-sync-tick` if it exists, then schedule it at `'7 * * * *'`. The job calls `net.http_post` with the URL (the `connections` function's `/sync/tick` route) and an `x-sync-secret` header, both read from `vault.decrypted_secrets` by name. No secret appears in the file.

### 0031_role_hierarchy
- Drop and re-add `profiles_role_check` and `invitations_role_check` as `('owner','admin','manager','employee')`.
- `private.is_company_admin()` is rebuilt from the **0013** body, with only the role test widened: `select coalesce((select role in ('owner','admin') from public.profiles where user_id = auth.uid() and is_active), false)`. The 0001 body compares `profiles.id = auth.uid()` and must not be used.
- What keeps today's meaning for existing admins: `can_manage_company` (82 policies), the profiles UPDATE policy "Users update own, admins update company profiles" (calls `is_company_admin` directly), and the two guards that read the helpers (`guard_profile_fields`, `guard_review_employee_fields`).
- New helpers:
  - `private.role_rank(text)`: employee 1, manager 2, admin 3, owner 4.
  - `private.is_company_owner()`.
  - `private.my_team_ids()`: stable, SECURITY DEFINER, a recursive CTE with `union` and a depth cap of 10, same company only. Built and checked now, used by no policy until S13. Its meaning is confirmed by input 30a.
- Re-create `guard_profile_fields` from the **0018** body and add ranking:
  - no one grants a role above their own
  - no one changes a person ranked above them
  - only an owner or Rococo grants owner
  - no one changes their own role (as today)
- New BEFORE INSERT guards on `profiles` and `invitations` apply the same ranking. Both open with the 0018 bypass, `if auth.uid() is null or private.is_rococo_admin() then return new; end if;`, so `handle_new_user` (which inserts profiles from the auth trigger with no `auth.uid()`) and first sign-in keep working. Today any admin can create another admin, and that stays true.
- A `reports_to` guard (BEFORE INSERT OR UPDATE OF reports_to): not self, same company, no cycle.
- `profiles_move_clears_reports_to`: when a person moves company, clear their `reports_to` and the `reports_to` of everyone who reported to them.
- A pre-check query lists any existing cross-company or cyclic `reports_to` rows so you can review them. The migration does not fix them silently.
- SQL-editor check after applying: simulate a new `@rocococreative.io` auth user insert inside a transaction, confirm the profile is created, roll back.

### Role-hierarchy migration plan

| Spec role | Maps to | Access now | After the capability matrix |
| --- | --- | --- | --- |
| Austin / God mode | `is_rococo_admin = true` (every `@rocococreative.io` fresh profile) | everything, all companies | An Austin-only tier needs a new flag. Pending your answer |
| Owner | `role = 'owner'` (new) | identical to admin today | full company, cannot be restricted |
| Admin | `role = 'admin'` (every existing admin row) | unchanged | restricted by `role_capabilities` rows |
| Manager | `role = 'manager'` (new) | employee-level | team scope through `my_team_ids()` |
| Employee | `role = 'employee'` | unchanged | unchanged unless the matrix says otherwise |

- **No existing row is rewritten.** You assign Kingdom's owner by hand once confirmed. Klasik's owner can stay `admin` with no difference in behavior.
- **Manager scope (S13)** adds policies beside the existing ones, of the form `employee_id in (select private.my_team_ids())`. It never widens `goal_private` or the owner-only `goal_notes`.
- **Built now:** role values, ranking guard, `reports_to` integrity, team helper, audit log, the separate sync predicate.
- **Waits for the matrix:** capability rows, restricted Admin, view and edit splits, Manager policies, sync and integration permissions, company-admin audit read, the Austin-only tier.

### Compatibility risks
- **Rebuilding a function from the wrong body.**
  - Building `guard_company_fields` from 0001 instead of 0009 raises on every company update.
  - Building `guard_profile_fields` from anything older than 0018 drops job-role rules.
  - Building `is_company_admin` from 0001 instead of 0013 compares `profiles.id = auth.uid()`, which silently strips admin from every roster-first admin.
  - Copy the latest body and apply twice on a branch before production.
- **A new INSERT guard without the sign-up bypass.** It would raise inside `handle_new_user` and break first sign-in. The 0018 bypass line opens both guards, and the SQL check above proves it.
- **Silent `COLUMNS` omission.** A missing `modules` in the `companies.ts` `COLUMNS` makes the module silently invisible. A test asserts that the column is selected.
- **Migration tracking is out of step.** 0001 to 0008 and 0014 to 0016 have no tracking rows. Keep pasting numbered files; do not run a tool's "apply pending".
- **A role value the UI does not know.** Owner and Manager must be in `ROLE_LABELS` before 0031 is applied, or the sidebar shows a blank role.
- **A provider key spelled two ways.** The function, `ConnectionProvider`, 0028 and 0029 all use `google_sheets`; the S8 unit test guards it.

---

## 6. Integration setup requirements

### 6.1 Google Sheets: method

**Recommended: Google user OAuth through the existing `connections` function, scopes `openid email https://www.googleapis.com/auth/spreadsheets.readonly`, consent screen External and In production, sensitive-scope verification submitted.**

Why this method:
- **Rule 6.** A company connects its own Google account through the app's own OAuth flow. Tokens live in `connection_tokens`, and only the `connections` function reads them, including when it runs a sync. The browser sees status rows.
- **Not drive.file plus Picker.** That scope is narrower and non-sensitive, but Google's Picker runs in the browser with a Google access token. That breaks "the browser never calls a provider". Use it only if you amend rule 6 on purpose.
- **Not a service account.** A service account Rococo owns, with Kingdom sharing sheets to it, is "through anything of Rococo's" and adds a long-lived private key. Rejected.
- **The sheets already exist.** `spreadsheets.readonly` reaches a sheet from a pasted URL. `drive.file` cannot.
- **Publish In production first.** Testing mode issues refresh tokens that die after 7 days. Reconnect after publishing.
- **Until verification finishes,** a connecting admin sees Google's "unverified app" screen once, and the app is capped at 100 users. Only company admins connect, so the cap is not a constraint.
- The OAuth *client* belongs to Rococo, as the GoHighLevel and QuickBooks apps already do (README). The *account* connected is Kingdom's.

### 6.2 Sync engine design

| Part | Design |
| --- | --- |
| Where it runs | Inside the `connections` Edge Function, as `/sync/run`, `/sync/tick` and `/sync/describe`. No other function reads `connection_tokens` |
| Source config | One `sync_sources` row per tab or range. The tab is stored by numeric `sheet_gid`, which survives renames, and its title is resolved with `spreadsheets.get?fields=sheets.properties` before each read |
| Read | `values.batchGet` with `valueRenderOption=UNFORMATTED_VALUE` and `dateTimeRenderOption=SERIAL_NUMBER`, live on every run, never cached. Never `FORMATTED_STRING` |
| Header mapping | Headers are normalized with the csv.ts rule and matched by name. A missing required header fails the run |
| Typed parsing | Currency and number fields need a numeric cell. Percent arrives as a fraction. A date is a serial: UTC ms = (serial minus 25569) times 86400000. Text in a typed field is a validation error, never a guess. A short row means blank. Blank is null, never 0 |
| Blank rows | A row with every mapped cell blank is skipped and counted in `rows_blank` |
| Record keys | `record_key` names the fields that form the key. A duplicate key fails the run. With no key configured, the tab is replaced as a whole each run and the row number is kept only as provenance |
| Projection | Every provider's response is projected through `field_map` before any insert, so only mapped fields reach `sync_records` |
| Provenance | `source_ref` holds the spreadsheet id, gid and row number, and builds the "Open in Google Sheets" link |
| Overlap lock | Both `/sync/run` and `/sync/tick` first run `update sync_runs set status='abandoned', finished_at=now() where connection_id=$1 and status='running' and started_at < now() - interval '15 minutes'`. Then they insert a `running` run. A unique-index violation answers "A sync is already running" |
| Tick order | `/sync/tick` processes the due sources of one connection one at a time, so sources sharing a Google connection never collide on the lock. Different connections may run in parallel |
| Last good | Records are written under the new `run_id`. Only after every record is in does one UPDATE set `current_run_id`. On failure the pointer stays, and the orphan rows are pruned later. Readers read `current_run_id` only |
| Run log | Every attempt writes a `sync_runs` row, and the source keeps `last_attempt_at`, `last_success_at`, `last_status` and `last_error` |
| Staleness | Stale when `now - last_success_at > stale_after_hours`. With a null threshold the age is always shown and "Stale" is never claimed |
| Pruning | After a success, keep the current and the previous run's records |

**UI states** come from `syncState()`, in this precedence:

| State | When | Shown |
| --- | --- | --- |
| Not connected | no connection row, or `not_connected` | neutral badge, link to Settings |
| Connected, awaiting first sync | connected, no success yet | info badge, "No data yet" |
| Syncing | a run is `running` | info badge with a spinner, last good data still visible |
| Sync failed | the last attempt failed, or the connection is `error` | danger badge, error line, "Showing data from <last success>" |
| Stale data | the threshold is set and exceeded | warning badge, age |
| Synced | the last attempt succeeded and is within the threshold | success badge, "Synced <time>" |

The last successful sync time is shown on every module and on the Home FreshnessCard (S6).

### 6.3 Scheduling

- **Mechanism.** Supabase Cron with pg_net calls `POST /functions/v1/connections/sync/tick` every hour at minute 7. The `x-sync-secret` header is checked in constant time against the `SYNC_CRON_SECRET` function secret.
- **Due rule.** The function works out each source's weekly slot from `sync_weekday`, `sync_time` and the IANA `sync_timezone`, using `Intl`, so DST is handled. A source is due when its last success is before the latest slot. pg_cron itself runs in UTC.
- **Sync now.** `POST /connections/sync/run {source_id}` with the user's JWT. Acting **as that user**, the function runs `update sync_sources set sync_requested_at = now() where id = $1` and proceeds only if one row was affected. That write is allowed only by `private.can_sync_source(company_id)`, a predicate of its own, separate from the select policy that lets a user view the source. No TypeScript role check. When S13 widens who may view finance or capacity sources, nobody gains Sync now unless the sync capability says so.
- **Why not the alternatives.** A Vercel Cron would put a secret and a function into Vercel and would need service-level access to tokens. A GitHub Actions schedule can be delayed or dropped. A second Edge Function would be a second reader of `connection_tokens`, which rule 6 does not allow. All are rejected.
- **Accepted trade-off.** pg_net keeps the decrypted header in `net.http_request_queue` until the request is sent, so any database login role can read it in that window. That is acceptable because the cron secret can only trigger a sync.

### 6.4 QuickBooks controls

- **Connection.** Reuse the existing QuickBooks provider and connection. Kingdom's admin connects from Settings > Connections.
- **Read-only.** The adapter's client exposes only `query` (GET `/v3/company/{realmId}/query`) and `report` (GET `/reports/...`). It has no write method at all.
- **Tokens.** The access token lasts one hour. The refresh token rotates. The adapter runs inside the `connections` function, refreshes inside the connection lock, and saves the new refresh token and expiry before making any data call.
- **First pull.** Invoice and Payment queries, keyed by QuickBooks `Id`. The adapter projects each response through `field_map` before any insert, so only the confirmed fields are stored, plus `source_ref` {entity, Id, realmId}. The stored fields are pending Kingdom's confirmation (input 22); the candidates are DocNumber, CustomerRef name, TxnDate, DueDate, TotalAmt, Balance, EmailStatus, PrintStatus, and LinkedTxn on payments.
- **Deep link.** `https://app.qbo.intuit.com/app/invoice?txnId={Id}`, or the sandbox host. This pattern is community-documented, so it is labelled "Opens QuickBooks, sign-in required".
- **Pending, not coded:** aging thresholds, escalation, partial-payment treatment, the meaning of "not sent" (EmailStatus misses printed and outside deliveries), and the cash in and out basis (CashFlow statement versus a cash-basis P&L). `AgedReceivables` and `CashFlow` report pulls wait for those answers.

### 6.5 Monday

- **Links, not embeds, by default.** Board, view and item URLs are stored as `external_links` rows. Monday's own sign-in and permissions apply.
- **Embeds only for public share views.** These are views the board owner creates and Kingdom approves as public (`embed_is_public = true`). They are labelled public in the UI, because Monday warns that hidden data can still be reached through them. A direct link always sits beside the embed.
- **No Monday API calls and no copied CRM or task records.**
- **CSP.** `vercel.json` already sends `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY`. These stop others from framing the hub and do not block embeds. There is no `frame-src` or `default-src`, so Monday iframes are allowed. If a `frame-src` or `default-src` directive is ever added, include `https://*.monday.com`.

### 6.6 Exact setup steps for Austin

**Google Cloud (Rococo-owned project)**
1. Create or pick the project and enable the **Google Sheets API**.
2. OAuth consent screen:
   - User type **External**, app name "Company Hub", support email.
   - Authorized domain `rocococreative.io`, privacy policy URL, homepage `https://companyhub.rocococreative.io`.
   - Scopes `openid`, `email`, `.../auth/spreadsheets.readonly`.
3. Set the publishing status to **In production**.
4. Credentials: create an OAuth client of type Web application. Authorized redirect URI: `https://jjdcejevdqpwuastsmpq.supabase.co/functions/v1/connections/callback`.
5. Submit sensitive-scope verification: verify the domain in Search Console, write the scope justification, record a short demo video.

**Supabase (Dashboard, Edge Functions, Secrets)**

6. Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
7. Add `SYNC_CRON_SECRET`: a long random string, for example from `openssl rand -hex 32`.
8. Confirm `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET` and `QBO_ENVIRONMENT` are set. SQL cannot show this.
9. Deploy the one function: `supabase functions deploy connections --no-verify-jwt`.
10. In the SQL editor:
    - `select vault.create_secret('<same value as SYNC_CRON_SECRET>', 'sync_cron_secret');`
    - `select vault.create_secret('https://jjdcejevdqpwuastsmpq.supabase.co/functions/v1/connections/sync/tick', 'sync_function_url');`
11. Paste `0030_sync_schedule.sql`. Check it with `select jobname, schedule from cron.job;` and, after the next hour, `select status, return_message from cron.job_run_details order by start_time desc limit 5;`.

**Intuit**

12. For Kingdom's real books, complete Intuit's production app assessment and set `QBO_ENVIRONMENT=production`.

**Kingdom**

13. Choose the Google account with view access to the reporting sheets. A Kingdom admin signed in to the hub connects it from Settings > Connections.
14. A Kingdom admin connects QuickBooks the same way.
15. For any embed: the Monday board owner creates the share view and sends you the link and the embed URL.

---

## 7. Inputs still needed from Austin or Kingdom

**A. Roster and roles**
1. Who is Kingdom's Owner? Live admins are Maddie Cothran (Design Lead, not signed in) and marvin waters (Controller), and one admin invitation is pending. *Blocks: assigning `owner` in S9.*
2. Should Maddie and marvin stay full Admins, or become Managers or Employees once the matrix exists? *Blocks: the role assignment after S13.*
3. Who are Kingdom's PMs, and can they be added to the roster now (no account needed)? *Blocks: PM capacity mapping (S11) and milestone responsible people.*
4. Is God mode for every `@rocococreative.io` account acceptable, or does Austin need a tier above other Rococo staff? *Blocks: the Austin-only capabilities.*

**B. Projects, milestones, letters**

5. What is a "project" at Kingdom (a contract, a job, a lot) and what is its identity source: a sheet tab, a job number, the Estimating Tool? *Blocks: linking `projects.source_key` and importing the project list.*
6. Until that is decided, may admins create projects by hand in the hub? *Blocks: S3 being useful on day one.*
7. What are "letters" (for example client update letters or lien waivers), and do they need their own fields? *Blocks: the letter milestone fields.*
8. Does Kingdom want milestone statuses beyond done or not done (a completed-on date), and if so, which ones? The working assumption is not started, in progress and complete. *Blocks: the milestone status column and its labels.*
9. Who may add and edit milestones? PMs are employees today. *Blocks: the milestone policies.*

**C. Google Sheets**

10. Spreadsheet links, and the tabs or ranges for sales reporting, financial reporting and PM capacity. *Blocks: S10 and S11.*
11. For each tab: the fields to display, required fields, types, units, the record key, and the reporting-period convention. *Blocks: field maps.*
12. Which Google account connects, and does it have view access to every sheet? *Blocks: the first live sync.*
13. Do you accept Google's "unverified app" screen during verification? *Blocks: connecting before verification completes.*

**D. Sync behavior**

14. Weekly sync day, time and timezone. *Blocks: the scheduled weekly acceptance check.*
15. Stale-data threshold for each module. *Blocks: the "Stale data" state.*
16. Which roles may press Sync now? The default is admins. *Blocks: the body of `private.can_sync_source`.*
17. Does any module need refreshes more often than weekly? *Blocks: schedule options.*

**E. Financial definitions**

18. Definitions of revenue, deposits versus production revenue, goal versus plan versus forecast, carryover, cash versus accrual, gross profit and variance. *Blocks: any computed financial figure.*
19. Should the existing `deriveSnapshot` margins stay on Kingdom's manual Financials page as they are? *Blocks: review of the existing calculations.*

**F. PM capacity**

20. The capacity formula, PM targets, the available-capacity calculation, job-overlap logic, gross-profit thresholds. *Blocks: anything beyond the raw source columns.*
21. The stable key for PMs in the sheet (email, initials or a code). *Blocks: `external_people` mapping.*

**G. QuickBooks**

22. Confirm the four controls reporting areas (cash in/out, invoices, payments and collections, outstanding balances), the fields for each, and the accounting definitions behind them (for example what counts as a collection, and whether a balance means open invoice balance or customer balance). *Blocks: the Controls display.*
23. Aging thresholds, escalation conditions, partial-payment treatment, the meaning of "invoice not sent", the cash in and out basis. *Blocks: Controls rules.*

**H. Monday**

24. Board, view and item URLs for the sales CRM and tasks, and which nav group each belongs in. *Blocks: S7 content.*
25. Which views, if any, are approved as public share-view embeds. *Blocks: embeds.*
26. Which dashboard signals route to which Monday destination. *Blocks: attention-item links.*

**I. Wins**

27. Who may create and edit wins, how long they stay on Home, and how archiving works. What a win's "team" means at Kingdom (a department, a crew, a PM's team). Which automated win sources, if any, should come later. *Blocks: wins policies, display rules, the team field and future sources.*

**J. Client score and cleanliness**

28. For client score and cleanliness separately: the scoring definition and scale, the input process, the subject (project, client, PM, period), aggregation rules, whether any thresholds, rankings or red and green rules apply, and who may view and edit. *Blocks: S14.*

**K. Undefined modules**

29. Warranty requirements, job-health rules, and the start and completion source. Does Kingdom track warranties anywhere today (a Monday board, a sheet), and should the placeholder link there? *Blocks: replacing the placeholders.*

**L. Capability matrix**

30. For each of Owner, Admin, Manager and Employee: financial visibility, private HR and GSR access, cross-team access, milestone and win editing, score editing, user and team admin, integration management, manual sync, company settings, audit log access, the restricted-Admin list, employee access (what an Employee sees in Home, Sales & Finance and Production). *Blocks: S13.*

30a. How is a Manager's assigned team defined: everyone who reports to them through `reports_to` (direct only, or the whole chain), a department, or an explicit team list? Who are Kingdom's managers, and who reports to each? *Blocks: `my_team_ids()` semantics and S13 Manager policies.*

**M. Platform decisions**

31. Do you approve `companies.modules` and the matching wording update to CLAUDE.md rule 12? *Blocks: S1.*
32. Should the live drift be cleaned up in a separate change: the unmanaged `rls_auto_enable()` function (executable by anon), the `migration_backup_20261101` schema, and leaked-password protection being off? *Blocks: nothing in this plan. A hygiene decision.*
33. Confirm Home shows Kingdom only, with the Rococo Portfolio remaining the cross-company view. *Blocks: Home scope.*
34. Approve SOPs, Resources and Settings in a utility group below the four sections, or name the section each belongs in. *Blocks: final nav in S1.*

---

## 8. Acceptance-test plan

**Current results: nothing in this plan is implemented.** Baseline at handoff: lint passes, 160 of 160 tests pass, build passes.

| Criterion | How it is verified | Current result |
| --- | --- | --- |
| 17: Existing working functionality remains intact | All 160 existing tests pass unchanged except the one Kingdom heading assertion, plus a Klasik and RBA demo walk per persona and a `navigation.test.ts` flat-equals-today check | Baseline green. Not yet re-run |
| 17: Navigation follows the agreed structure | Page test: Kingdom admin sees four groups and the employee is filtered. Route test with `sectioned_nav` on: every route in `App.tsx:292-324`, plus `/gsr/settings` and `/gsr/company-goals`, renders or redirects exactly as with it off, and `/settings?connected=...` still lands on Settings. Manual demo walk | Not implemented |
| 17: Google Sheets refreshes through a real connection | Manual: connect Kingdom's account, sync, change a cell, sync again, see the change. Parser unit tests on recorded JSON | Not implemented |
| 17: Weekly and authorized on-demand sync work | `schedule.test.ts` (due slots, DST). SQL check of `cron.job_run_details`. Manual Sync now as admin, plus a rejected call from a user who fails `can_sync_source` | Not implemented. Waits on inputs 14 and 16 |
| 17: Source ownership and freshness visible | `state.test.ts` for all six states. Page test of the badges and last-success time. Page test: every MappedTable value shows its source label and an "Open in Google Sheets" or "Opens QuickBooks" link built from `source_ref`; milestones and wins show the "Manual" badge; no screen mixes the two without a label | Not implemented |
| 17: Imported data remains read-only | SQL check: an `authenticated` insert or update on `sync_records` is refused. Page test: no edit controls on mapped values | Not implemented |
| 7: Displayed values reconcile with the approved source mapping | Manual reconciliation of every S10 field against the sheet cell named by its `source_ref`. MappedTable page test on fixture records | Not implemented. Waits on inputs 10, 11 |
| 7: A failed sync does not show misleading zeros | Page test on SalesFinancePage with a failed-with-last-good fixture: last good values, their time, no 0 | Not implemented |
| 7: Users cannot edit imported financial values | SQL check that an `authenticated` write to `sync_records` is refused. Page test: no inputs on SalesFinancePage | Not implemented |
| 7: Undefined metrics clearly pending | Page test: every input-18 metric shows "Not configured", with no digits | Not implemented |
| 17: PM capacity reflects approved mappings | Manual reconciliation against the sheet. Page test: an unmapped PM is flagged and blank shows "-" | Not implemented. Waits on inputs 10, 11, 21 |
| 17: Milestones support user-entered tracking, including letters | Page tests for add, edit, reorder and letter filter. `assertInCompany` test. `milestones.test.ts` | Not implemented |
| 17: Manual wins work | Page test for create and edit with the Manual source badge. SQL check that a browser write is forced to `source_type='manual'` | Not implemented |
| 17: Client score and cleanliness stay unscored scaffolds | Page test: "Not configured", no digits, no ScoreRing | Not implemented |
| 17: QuickBooks controls use confirmed mappings | Manual reconciliation with QuickBooks. Code review that the adapter has no write method and that only `field_map` fields reach `sync_records` | Not implemented. Waits on inputs 22 and 23 |
| 17: Monday remains the task and CRM system | Code review: no task or CRM tables. Page test: links show their destination, embeds appear only when flagged public | Not implemented |
| 17: Access enforced by role and assignment scope | SQL checks for the ranking guard, `reports_to` cycle and cross-company rejects, owner grants, and a new `@rocococreative.io` sign-in still succeeding. SQL checks as a Kingdom employee session: select on `sync_sources`, `sync_runs`, `sync_records`, `external_people` and `audit_events` returns 0 rows, and insert or update on `projects`, `project_milestones`, `wins` and `external_links` is refused. As a Klasik admin session: no Kingdom row is readable from any new table. Page test: an employee typing `/sales-finance` or `/production/projects/:id` directly is redirected, not just missing a nav item. Manager scope policies after the matrix | Not implemented. Manager scope waits on inputs 30 and 30a |
| 17: Undefined logic clearly identified | Page tests on every scaffold and pending label. Review against section 9 of this document | Not implemented |

Every migration also gets an SQL-editor check: apply it twice, show it is idempotent, run the Supabase security and performance advisors, and confirm that a Klasik admin session can still read and write as before.

---

## 9. Deferred requirements

| Requirement | Unblocked by |
| --- | --- |
| Sales and financial reporting content | Sheet links, field maps, period conventions (inputs 10, 11) |
| Any financial calculation (revenue, deposits, plan, forecast, carryover, cash or accrual, gross profit, variance) | Approved definitions (input 18) |
| PM capacity display and any capacity math | Capacity sheet, PM key, definitions (inputs 3, 20, 21) |
| QuickBooks Controls display and rules, plus the aging and cash-flow reports | Kingdom connects, fields, definitions and rules confirmed, production Intuit keys (inputs 22, 23, step 12) |
| Weekly schedule live for Kingdom | Day, time, timezone (input 14) |
| Stale state | Threshold (input 15) |
| Higher-frequency refresh | Input 17 |
| Milestone status column and labels | Input 8 |
| Project identity import, start and completion dates | Inputs 5 and 29 |
| Manager team scope, restricted Admin, view and edit splits, sync and integration permissions | Capability matrix and team definition (inputs 30, 30a) |
| Austin-only tier | Input 4 |
| Client score and cleanliness tables and input | Definitions (input 28) |
| Warranty, job health | Input 29 |
| Wins automation, display duration, archival, team meaning | Input 27 |
| Monday embeds and signal routing | Inputs 24 to 26 |
| Company-admin view of the audit log | Capability matrix (input 30) |
| Home scope and the utility nav group | Inputs 33 and 34 |
| Archie | Not built. Waits for a separate decision; nothing depends on it |

---

## 10. Guardrail notes and interpretations

### How the plan honors the hard rules

| Rule | Where it matters | How the plan honors it |
| --- | --- | --- |
| 1 Theme tokens | Every new card, badge and embed frame | Semantic tokens and `ui/*` only. `SYNC_STATE_TONE` reuses the Badge tones. A new tenant still needs only a theme block and a `theme_key`, because `modules` defaults to empty |
| 2 No-backend render | Five new services, new routes on the `connections` function | Every service goes through the nullable client. Every page renders the setup notice. Tests use mocks and recorded JSON; no Google, QuickBooks or Monday call in CI |
| 3 Services throw | `sync.ts`, `projects.ts`, `wins.ts`, `externalLinks.ts`, `audit.ts` | Plain async functions that throw. Pages catch through `lib/errors.ts`. No data library |
| 4 RLS wall | Every new table | Private helpers only, `company_id` inherited by trigger on every child row (`project_milestones`, `sync_runs`, `sync_records`) and `not null` on every top-level table, pinned policies. `assertInCompany` on ProjectPage. `sync_records` has no write policy. Audit read is Rococo-only in RLS until the matrix decides otherwise. No new public functions |
| 5 Person, not account | Responsible people, PM mapping, creators | Every reference goes to `profiles.id`, stamped with `auth_profile_id()`. No filter on `hasAccount`. `is_company_admin` keeps the 0013 `user_id` match. The new INSERT guards bypass the sign-up path |
| 6 Connections | Google, QuickBooks, cron | Kingdom's own accounts through the app's OAuth flow. Tokens are read only by the `connections` function, which also serves the sync routes. The cron secret is not a service key. Nothing goes into Vercel |
| 7 Scoring in one place | Client score, cleanliness, capacity | No new scoring. `scoring.ts`, `goals.ts`, `deliverables.ts` and the bands are untouched and not reused for scaffolds. Client score is not a pillar `scoring_type` |
| 8 Append-only | Guards, constraints and types | New files 0024 to 0031. Functions rebuilt from their latest bodies (0009, 0013, 0018). `move_employee_company` left alone, with small separate triggers instead. `database.ts` updated in the same slice as each migration (S1, S2, S3, S4, S6, S7, S9) |
| 11 File style | All new files | A header comment on why each file exists, PascalCase default exports, sub-components above the export, no barrels, BlurInput for milestone fields |
| 12 Shape is data | Nav, modules, Google row, data sources | `companies.modules` on every company, Rococo-only to change. No slug or theme branch. Shared registries (nav, modules, sync states) change all three companies equally but appear only when a module is on |

### Interpretations of ambiguous spec wording

- **"Cross-company snapshot" for a single tenant means a company-wide snapshot.** Kingdom's Home shows Kingdom. The Rococo Portfolio stays the cross-company view, and its marketing-total inconsistency is not carried into Home. Confirmation is input 33.
- **"Sales & Finance"** includes the existing Marketing tracker and manual Financials page, left as they are, beside the new read-only reporting and Controls pages.
- **The four sections plus a utility group.** SOPs, Resources and Settings sit in a utility group below the four named sections, pending input 34.
- **"Project snapshots"** means a project list with its reference, milestone counts and next target date. No health, status or percentage.
- **"Use existing review/scoring components where appropriate"** means only the neutral primitives: EmptyState, Stat, and later RatingInput. The scoring math and colour bands encode unapproved thresholds, so they are not used.
- **"Embed where technically available"** means only public share views that Kingdom has approved. Logged-in iframes are unreliable and do not carry permissions.
- **"Letters"** are milestones of kind `letter`. Their meaning is pending (input 7).
- **"Preserve existing useful warranty functionality":** none exists in the hub. The only matches are a GoHighLevel stage name in `docs/integrations.md` and a test deliverable title in `pages.test.tsx`. Whether Kingdom tracks warranties elsewhere is input 29.

### Shelved Project assistant and Monday ownership

- **Keep it shelved.** `docs/project-assistant.md` is a task-management module: assignees, status, due dates, waiting, priority, day planning. The spec makes Monday the owner of tasks and limits milestones to lightweight checkpoints.
- **Reuse only its gate design.** `companies.modules` and `hasModule()` come from it.
- **Its "no projects table" decision is superseded** by spec section 10, which needs per-project milestones.
- **Its SQL breaks rule 5.** It compares a `profiles.id` to `auth.uid()` and keys `created_by` on `auth.users`. If it is ever revived, it has to be rewritten first.
- **Recommendation:** formally retire it, or mark it "superseded by Monday ownership" in the README.

### Side findings

These are outside this scope and are recorded only. None of them is fixed by this plan unless noted.

- Unmanaged `public.rls_auto_enable()` is executable by anon, which contradicts rule 4. Checked: it returns `event_trigger`, so it cannot be called directly through PostgREST. Low risk, worth a revoke.
- The `migration_backup_20261101` schema holds real GSR copies (3 tables) with RLS off. Checked: neither `anon` nor `authenticated` has USAGE on the schema, so the API cannot reach it. Low risk, worth dropping once the backup is no longer needed.
- The migration tracking rows are out of step with the repo files.
- `App.rococo.test.tsx` is missing three mocks (fixed in S1).
- Portfolio marketing totals count unbudgeted campaigns.
- The Financials tile says "Entered by hand" on QuickBooks rows, and a CSV import overwrites hand-entered rows.
- The `connections` function does not check `is_active` (fixed in S8).
- Leaked-password protection is off on both projects.
- Provider tokens are stored in plain text. Vault or pgcrypto can come in a later migration.
- 22 foreign keys have no index. New tables index their own.

---

## Review notes

- **No critic issue was skipped.** I checked the questionable ones against the repo. `vercel.json` does send `frame-ancestors 'none'` and `X-Frame-Options: DENY`. `is_company_admin` was last defined in 0013. `status.ts` has seven maps. The warranty matches are `docs/integrations.md:133` and `pages.test.tsx:279`. The dashboard line numbers are `DashboardPage.tsx:132` and `:401`, and the PortfolioPage alerts are at `:98-106`. All of these match the critics.
- **Choices where a critic offered options:**
  - **Rule 6.** I took option (a): the sync routes live inside the `connections` function, so no rule 6 amendment is needed. Steps 9 and 10, the cron URL, S6, S8 and S9 are updated to match.
  - **Provider key.** The key is `google_sheets` everywhere: the function, the types and both CHECK constraints.
  - **Milestone status.** I took the first option: no status column in 0026, and completion is tracked by `completed_on`.
- **Sync now predicate, a small change from the critic's wording.** RLS policies apply to whole rows, not columns. An UPDATE policy on `sync_requested_at` alone would therefore be the same predicate as the config update. To give Sync now its own predicate, the plan adds `private.can_sync_source(cid)`, an update policy of `can_manage_company or can_sync_source`, and a guard trigger. Together they let a sync-only user change only `sync_requested_at`. This meets the critic's goal. Today the new predicate gives the same answer as `can_manage_company`.
- **Duplicate issues.** The provider-key mismatch was raised three times and is fixed once. Two other changes came out of applying the issues. "Seven new services" is now "five", because the plan lists five. The criteria column in section 8 is now labelled by spec section, so the new section 7 rows fit in the same table.
