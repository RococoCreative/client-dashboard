This file exists to turn Kingdom's intake answers (received 2026-11-10) into a build structure: what the answers settle, where they collide with what is built, what is still open, and the order to build in.

# Kingdom intake: gaps and build structure

Sources: Kingdom's answers ("Kingdom Dashboard, KCC Answers for Rococo", Nov 10, written by Marv), the intake
questionnaire ("Kingdom Dashboard: What We Need From You", Nov 4), `docs/kingdom-revamp-plan.md`,
`docs/kingdom-build-plan.md`, migrations 0024 to 0039, and the code as of `2758dae`.

This is a structure, not a task list. Each phase below gets its own short design and task plan before it is
built. Nothing here has been built yet.

## 1. Where the build stands

The Kingdom revamp shipped the plumbing: module gating, audit log, projects, milestones, wins, the sync
engine, the Google Sheets and QuickBooks adapters, external links, four roles, team and division access.
What it deliberately left out is everything that needed Kingdom's answers: there is no metric model, no
project import, no invoice rules, no capacity, no milestone statuses, no per-role permission differences
beyond admin or not.

Not live yet, and blocking any real sync:

- `0032_sync_schedule` is not applied. It waits on Vault entries.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `SYNC_CRON_SECRET` are not set, so Google and the
  scheduler answer "not set up yet".
- QuickBooks production keys: status not recorded in the repo. Confirm.

## 2. What the answers settle

| Area | Answer | Effect |
|---|---|---|
| Owners | Eli Cothran and Davis Nix only. Marv is Admin. Maddie is an Employee. | The questionnaire named Maddie and Marv as Owners. Any live row that says so is wrong. |
| Roster | 10 people, all on the company domain | Seed now. Reports-to is "Confirm" for 8 of 10. |
| Team | Direct reports | Today a manager's team is the whole chain (0038). |
| Project identity | Job name. QuickBooks "Customer:Job", match on the part after the colon. | No job number exists. Name is the key. |
| Master list | MBPL 2026, Project Map tab. No manual add in the hub. | Projects become sheet-driven. |
| PM per project | MBPL 2026, Production Capacity Planning tab | A second tab feeds the same project. |
| Dates | Start is first day on site, complete is final invoice sent. Neither is recorded yet. | Planned months only until KCC adds the columns. |
| Feed | Weekly report, Financials tab. No new feed tab. | See collision C2. |
| Numbers on Home | Revenue, Goal, Plan, Forecast, Gross profit | Deposits, Production revenue, Variance sit on Sales and Finance. Carryover is undefined. |
| Basis | Accrual, year starts January, invoice date decides the month | |
| Financials page | Retire once sheet numbers are live | Needs a per-company switch. |
| QuickBooks | Online, one company, Marv connects. All four views. | |
| Invoice rules | Overdue 7 days past due date. Flag never emailed after 2 days. Partial payments show amount owed. | Three rules handed back to Rococo to propose. |
| Flags on Home | Owners and the Admin | |
| Capacity | $4,000,000 per PM, dollars | Time frame unconfirmed. |
| Milestones | Six fixed phases on every job. Not started, in progress, complete. | "Letters" handed back to Rococo to explain. |
| Wins | Anyone posts. Owners and Admin edit or remove. 14 days on Home, then an archive. No tags. | |
| Monday | Maddie owns the boards. Board list to come. | Data entry once she sends it. |
| Refresh | Weekdays 8 AM America/New_York. Production stale after 2 days, finance and QuickBooks after 8. | Engine supports one weekly slot per source. |
| Margin flag | Any job under 25% gross margin (target 30%) | Needs per-job revenue and cost. |

## 3. Collisions between the answers and what is built

**C1. Admin and Owner are the same thing in the database.** Every policy treats owner or admin as "admin".
Kingdom wants two lines drawn between them: an Admin never sees pay and never changes company settings.
Today any admin reads compensation and edits the company row. This is an RLS change, not a UI change
(rule 4).

**C2. The Financials tab is not a feed the adapter can read as it stands.** The adapter reads flat tabs: one
header row, one record per row, strict types, and a whole run fails if a number cell holds text. Kingdom's
Financials tab is a laid-out summary with several blocks (Financial Summary, Monthly plan vs actual, Gross
profit). It can be read block by block with range-scoped sources, but there is no layer that turns "the
Revenue row, the YTD Actual column" into a named number. That layer is the main new piece of this build.
Their own answer shows the risk: the Plan cell currently displays "-", which would fail a run today.

**C3. The permission table is Kingdom's, and the code has one shared shape.** Managers at Kingdom edit
milestones, press Sync now and open Production. Employees post wins. Admins read the change log. None of
that is true today, and rule 12 says a company's shape is data. Changing the shared defaults would move
Klasik and RBA too.

**C4. Daily refresh against a weekly engine.** One weekly slot per source exists. Weekdays at 8 AM needs a
set of weekdays. Separately, "stale after 2 days" with no weekend sync flags production data every Monday
morning before 8 AM. Count business days, or the flag cries wolf weekly.

**C5. Projects are manual, the answer says never manual.** The hub has an admin "new project" dialog and
no importer. Kingdom wants the reverse. Manual add stays the default for the other two companies and
becomes a setting.

**C6. Team means the whole chain today.** Kingdom said direct reports. With ten people and two project
managers the two are almost certainly identical. Do not build a setting until the reports-to column shows
a three-level chain.

**C7. "Sync now" lives in Settings, which managers cannot open.** Managers need the button on Production,
with the last-updated stamp beside it.

## 4. Gaps in Kingdom's answers

Things the answers leave open or get wrong. Grouped by who closes them.

### Rococo owes Kingdom (they asked)

1. **What "letters" means.** Their own list is the answer: lien waivers, the closeout letter and the
   one-year warranty letter. Proposal: three closeout checkpoints of kind "letter" on every job, each
   recording the date sent. The warranty letter date later gives each job a warranty end date for free.
2. **Money collected.** Proposal: every customer payment received, counted on the payment date. Payments
   not yet applied to an invoice are shown on their own line so they are never lost or double counted.
3. **Outstanding balance.** Proposal: the open balance on unpaid invoices, totalled per job, since the job
   is their unit everywhere else.
4. **Other flags.** Proposal: a payment sitting unapplied for more than 7 days, a PM over capacity, and
   the under 25% margin flag they already asked for.

### Found in the answers, Kingdom has not noticed

5. **Revenue does not equal deposits plus production.** YTD revenue is $6,644,483. Deposits ($1,463,499)
   plus production ($4,584,596) is $6,048,095. The $596,388 difference needs a name before both sets of
   numbers share a screen.
6. **A fixed file name does not fix the link.** The hub holds a spreadsheet's ID. If each weekly report
   version (v30, v31) is a copy, the ID changes every week no matter what the file is called. They need to
   keep editing one file.
7. **MBPL rolls to a new file in about six weeks.** "MBPL 2027" is a new spreadsheet ID, a new Goal and a
   new Plan. The year swap has to be a planned step in Settings, and it lands right as this build does.
8. **MBPL 2026 is owned by an outside account** (info@btacademy.com). View access for the shared office
   account depends on a third party, every year.
9. **"Never emailed" assumes invoices are emailed from QuickBooks.** If invoices go out through
   Buildertrend, by hand or as a PDF, every one of them is flagged. Ask how invoices are sent.
10. **Per-job gross profit has no named source.** The Project Map holds estimated revenue and cost, which
    gives estimated margin only. "Tracked per job in MBPL" does not say which tab. The 25% flag waits on this.
11. **Capacity: which dollars.** $4M per PM against what: estimated contract value, or planned production
    in the year? Two PMs at $4M is $8M and the annual Plan is $8.08M, which suggests "production per
    year". That is an inference to confirm, not an answer.
12. **PM names.** The answer says "by full name", the table shows "Christian" and "Neo". Either way the
    match is done by hand once, and an unmatched name is flagged, never guessed.
13. **Pay.** Employee and Admin are "No" for pay. Does a person still see their own? Today they do.
14. **In-progress month variance.** November reads minus $840,069 because the month is not over. Show
    variance for closed months, and label the current month as in progress.
15. **Maddie.** She runs the Monday boards but is an Employee, so Marv enters the links. Fine if intended.

### Kingdom already knows (their own list)

Reports-to for eight people, capacity time frame, carryover, sheet access for the shared account,
connecting before Google's review, the broken Plan cell, Actual Start and Actual Complete columns.

## 5. Approaches

Three decisions shape the build. Recommendation first in each.

### A. Permissions (C1, C3)

1. **A per-company capability table (recommended).** One row per capability and company, naming the
   lowest role allowed: see pay, change company settings, edit milestones, post wins, sync now, read the
   change log, see financial numbers. A `private` helper answers "can this person do X here" and policies
   call it. Defaults reproduce today's behaviour, so Klasik and RBA do not move. Kingdom's table becomes
   rows. Cost: one migration that touches several policies, and it needs the SQL test harness run hard.
2. **Change the shared defaults.** Smaller, but it changes all three companies, and the next company with
   a different table reopens it.
3. **Owner-only pay and settings as two fixed rules, the rest as a table.** A middle path if owner-only
   pay should be true everywhere. Worth it only if Klasik and RBA want the same.

### B. Reading the numbers (C2)

1. **Read their Financials tab as it is, through a metric map (recommended).** Each block of the tab is a
   range-scoped source. A new per-company metric definition names a number, its unit and period, and
   points at a source, a row label and a column header. Values resolve from the latest synced records, so
   there is no second copy. A cell that fails to read shows "Not configured" for that one number rather
   than failing the page. Kingdom changes nothing. Cost: the block ranges are tied to their layout, so a
   moved block breaks a number until the range is edited. The staleness stamp and a per-number check
   against their example values catch it.
2. **Ask for a flat feed tab anyway.** Sturdier, already declined, and it puts work back on Marv.
3. **Compute from MBPL and QuickBooks directly.** Rebuilds their formulas in our code. Against the
   questionnaire's own promise ("we never guess a formula").

This cannot be finalised blind. Nobody at Rococo has seen the tab. Step zero is view access.

### C. Projects (C5)

1. **Sheet is the source, hub mirrors it (recommended).** A project source type of "sheet" keyed on the
   normalised job name. A sync of the Project Map upserts projects. A job that disappears or is renamed is
   flagged, never deleted, since milestones and wins hang off it. A per-company setting turns the manual
   add dialog off. QuickBooks invoices attach by the name after the colon.
2. **Keep manual, link to the sheet.** No drift protection, and it is exactly what Kingdom said no to.

## 6. Build structure

Seven phases. Each is its own design, plan and merge. Order is by what is unblocked and what unlocks the
next thing.

### Phase 0. Unblock (no code)

- Create the Google OAuth client, set the three secrets, write the Vault entries, apply 0032.
- Confirm QuickBooks production keys.
- Get view access to both spreadsheets for Rococo, and record the real layout of the Financials tab,
  Project Map and Production Capacity Planning.
- Check the live Kingdom roster for anyone already marked Owner in error.
- Send Kingdom the reply: the four proposals in section 4, and questions 5 to 15.

### Phase 1. People and permissions (size M, no dependency on Kingdom)

- Capability table and helper (approach A1), defaults equal to today.
- Kingdom rows: pay and company settings owner-only, change log readable by admins on a company-scoped
  page, managers edit milestones and press Sync now, everyone posts wins, owners and admins edit and
  archive wins.
- Settings tabs split so an Admin reaches Connections and People but not company settings.
- Roster seed for the ten people, idempotent on email, reports-to left empty until confirmed.
- Not in this phase: direct-reports-only teams (C6).

### Phase 2. Confirmed small pieces (size M, no dependency)

- Wins: per-company "days on Home" (Kingdom 14), an archive view.
- Milestones: status column with three states, a per-company template applied to every project, six
  phases plus the three letters once Kingdom agrees.
- Schedule: a set of weekdays per source instead of one, and staleness counted in business days.
- A module switch for the manual Financials page and its Home card. Built now, flipped in phase 4.
- Sync now and last-updated stamp on Production.

### Phase 3. Projects from the sheet (size L, needs phase 0 access)

- Project columns: QuickBooks name, Buildertrend name, revenue type, estimated revenue and cost, planned
  start and end month, actual start and complete (empty until KCC adds them).
- Project Map source and the projector into projects (approach C1). Missing and renamed jobs flagged.
- PM per project from the capacity tab, through a hand-matched name table.
- Per-company setting that turns manual add off.

### Phase 4. Dashboard numbers (size L, needs phase 0 access and phase 1)

- Metric definitions and resolution (approach B1), with each number checked against Kingdom's Nov 9 values.
- Home tiles for Revenue, Goal, Plan, Forecast, Gross profit, shown only to roles with the financial
  capability.
- Sales and Finance: deposits, production revenue, monthly plan against actual, variance for closed months.
- Carryover stays "Not configured".
- Year swap flow for the 2027 files.
- Retire the manual Financials page for Kingdom by flipping the phase 2 switch.

### Phase 5. QuickBooks views and flags (size L, needs phase 3 for job matching)

- Views: invoices, payments collected, outstanding balances per job, profit and loss (a new report read).
- Rules as per-company settings: overdue days (7, from due date), unsent days (2), partial payments show
  the balance.
- Attention items on Home for owners and admins only.
- Waits on Kingdom agreeing the three proposed rules and answering question 9.

### Phase 6. Capacity and job margin (size M, needs phases 3 and 4 and Kingdom's answers)

- Per-PM limit as data, the unit and time frame as Kingdom confirms them, load worked out from matched
  projects. Over-capacity attention item.
- Under 25% margin flag, threshold as a company setting, once question 10 has a source.

### Later, unchanged

Client score, cleanliness, warranty tracking, carryover, Monday board links (data entry when Maddie sends
the list), direct-reports-only teams if the org chart ever needs it.

## 7. Risks

- **Layout drift in a hand-built sheet.** The whole numbers phase reads a tab a person edits weekly. The
  defence is per-number "Not configured" on failure, visible staleness, and a clear note to Kingdom about
  which rows and columns are load-bearing.
- **Name as key.** One rename splits a project. Flag and let an admin merge, never auto-delete.
- **Permissions migration.** The riskiest SQL in the build, on a database three companies share. Defaults
  must be proven identical to today before Kingdom's rows go in.
- **Year rollover** lands mid-build. Phase 4 has to ship the swap, or the hub goes dark on January 1.
- **Google review.** The read-only Sheets scope is a sensitive scope. Until review finishes Kingdom sees
  the unverified warning, and Marv has not yet said they are comfortable with that.
