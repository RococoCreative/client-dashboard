# Company Hub

One web application that serves as the operational hub for Rococo Creative's construction
clients. One app, three companies (Klasik, RBA, Kingdom), each with their own branding,
their own people, and their own way of doing things, all in a single Supabase project and
walled off from each other by row-level security.

> Working on this repo with Claude? Start with `CLAUDE.md` (the standing guardrails).

Designed but not built: the Project assistant module for Kingdom, a per-company to-do list
that orders itself by importance and location. The full specification is in
`docs/project-assistant.md`.

Built and waiting to be switched on: the Kingdom dashboard revamp (a four-section switchboard,
projects with milestones and letters, manual wins, Google Sheets and QuickBooks sources, a role
hierarchy). A company's modules decide what it sees (see Modules); Klasik and RBA have none and
see no change. The build plan is `docs/kingdom-build-plan.md` and the assessment, with the
rulings and the inputs still open, is `docs/kingdom-revamp-plan.md`.

## What is inside

| Module | Admins | Employees |
| --- | --- | --- |
| Dashboard | State of every module at a glance | Own score, goals, recent SOPs |
| Goal Setting and Review | Configurable pillars and weights, review cycles, scoring, feedback, team scores; monthly cycles run as Goal Setting Reviews | Own reviews, scores, feedback; goals with action steps and progress notes that stay private to them |
| People | Add staff before inviting them, invite when ready, roles, deactivate; hire date, department, reports to; compensation and yearly KPIs (the person and admins only) | (not visible) |
| SOP library | Create, edit (versioned), publish, attach files | Read published documents |
| Resource library | Add links, files, templates, videos with tags | Browse and open |
| Financial snapshots | Revenue, direct costs, overhead, margins, net, cash by month, quarter, or year; manual entry or CSV import | (not visible) |
| Marketing tracker | Board of planned, active, paused, and complete campaigns with budget vs spend and the key result | (not visible) |
| Production (`production`) | Projects with a job reference, milestones and letters (add, edit, reorder, mark done, archive); cards for client score, cleanliness, job health, warranty and PM capacity that read Not configured until they are defined | Read only |
| Wins (`wins`) | Log, edit and archive wins; the five most recent on Home | Read; the five most recent on Home |
| Sales & Finance (`data_sources`) | Read-only reporting and controls from connected Google Sheets and QuickBooks sources, each with its sync state and last successful sync | (not visible) |
| Home cards (`switchboard`, `data_sources`) | Attention items, section shortcuts, data freshness | Shortcuts, wins |
| External links (`external_links`) | Shortcuts to outside tools such as Monday boards, grouped by section; public share views embedded only when flagged public | Links shared with everyone |
| Rococo portfolio | Rococo admins only: every company with its health signals, plus companies, themes, sign-in domains, and every user, and the Activity log of configuration and permission changes | |

Rows marked with a module key appear only for a company whose modules include it. Email
notifications are the next phase.

## Quick start

```bash
npm install
cp .env.example .env    # fill in the Supabase URL and anon key (see below)
npm run dev             # http://localhost:5173
npm run lint            # ESLint: TypeScript, React hooks, Fast Refresh rules
npx vitest run          # unit and page tests, no network
npm run build           # type-check plus production build
npm run test:sql        # migrations against a local PostgreSQL 16 (not in CI)
```

With an empty `.env` the app still runs: it renders a setup notice instead of the login
gate (the nullable-client pattern in `src/services/supabase.ts`). Tests and CI rely on
this; they never touch the network.

## Demo mode (no Supabase)

`npm run demo` runs the app against an in-memory sample data set for all three companies
(the same mocks the page tests use) at http://localhost:4173. Pick who you are with the URL:
`/?persona=admin&company=klasik`, `/?persona=employee&company=kingdom`,
`/?persona=owner&company=kingdom`, `/?persona=manager&company=kingdom`,
`/?persona=rococo` for the portfolio, or `/?signedout=1` for the sign-in screen. Kingdom's
sample data has every module on, while Klasik and RBA have none, so the two side by side show
what the modules add. Nothing is written anywhere; a reload resets the data.

## Supabase setup

1. **Create a Supabase project** (one project for all companies).
2. **Apply the migrations.** Open the SQL editor and run each file in
   `supabase/migrations/` in numeric order (`0001` through `0031`), once each, on a fresh
   project. Paste `0030` only after the two Vault entries in Data sources and Google setup
   exist. Each file is idempotent in the sense that it can be applied to a project that
   already has part of it, but the set is a history, not a menu: later files move helpers into
   the `private` schema and rewrite policies, so re-running an earlier file on an
   already-migrated project either errors or reinstates a superseded rule. Go forwards only,
   and write a new numbered file rather than re-running an old one. `0006` seeds the three
   companies, their sign-in domains
   (`beklasik.com`, `rbaprojects.com`, `kingdomcustomconstruction.com`), and a starting
   GSR configuration for each. Check the domains in the Rococo section before inviting
   anyone; a domain decides who can self-serve a sign-in.
3. **Wire the signup gate.** Authentication, Hooks, "Before User Created": enable it and
   select `public.restrict_signups`. This is the real door; the function is inert until
   selected here.
4. **Turn sign-ups on.** Authentication, Sign In / Providers, Email: make sure Email is
   enabled and turn on "Allow new users to sign up". Do step 3 before step 4: while
   sign-ups are on and the hook is off, anyone on the internet can create an account.
   Quick check: try a throwaway @gmail.com address on the login screen and confirm it is
   rejected.
5. **Redirect URLs.** Authentication, URL Configuration: set Site URL to the production
   domain (`https://companyhub.rocococreative.io`) and add `https://companyhub.rocococreative.io/**`,
   `http://localhost:5173/**` and the Vercel preview wildcard to Redirect URLs.
6. **Keys.** Project Settings, API: copy the Project URL and the anon (publishable) key
   into `.env` locally and into Vercel's environment variables. Never put the service_role
   key or database password in `.env`, in Vercel, or in any `VITE_` variable.
7. **Sign in.** Any `@rocococreative.io` address is a Rococo admin on first sign-in and
   lands on the portfolio: every company with its signals, and the tabs where companies,
   themes, domains, and users are managed. Opening a company switches the hub to that
   company's branding and nav, for that session only.

## Modules

Some parts of the hub are modules a company has on or off. The keys:

| Key | Label | What it turns on |
| --- | --- | --- |
| `switchboard` | Switchboard | Four-section navigation, the Home heading, and the Attention and Shortcuts cards. |
| `production` | Production | Projects, milestones and letters, and the Production cards. |
| `wins` | Wins | The wins page and the Home wins card. |
| `data_sources` | Data sources | Connected Google Sheets and QuickBooks sources, Sales & Finance, and data freshness. |
| `external_links` | External links | Shortcuts to outside tools, including Monday, in each section. |

With `switchboard` on, the sidebar reads in four sections, Home, Sales & Finance, Production and
People / HR, plus an unlabeled group for SOPs, Resources and Settings.

A module is a key in `companies.modules`, read only through `src/lib/modules.ts` (`hasModule`)
and changed only by a Rococo admin on Rococo > Companies. A company with no modules on looks
exactly as it did before modules existed. Turning a module off hides its screens and keeps its
rows, so turning it back on brings everything back as it was. Turning `data_sources` off also
stops its syncs: the hourly tick skips that company's sources and Sync now refuses, so nothing is
read from Google Sheets or QuickBooks while it is off.

## How people get in

- **Company email:** the login screen recognizes the domain, switches to that company's
  theme, and sends a one-time link. The signup gate admits the address and the profile is
  placed in the company automatically.
- **Personal email:** an admin creates an invitation on the People page and sends the
  sign-in link it produces. The gate admits the invited address; on first sign-in the
  profile inherits the invitation's company, role, and title.
- **First sign-in:** the person gives their name and is in. Roles are `owner` and
  `admin` (the whole hub for their company), `manager` and `employee` (own GSR data plus the
  libraries); see Roles.
- **Deactivating** a person on the People page removes all access immediately; their
  account can be reactivated later.

## The roster and accounts

A person on a company's roster is not the same thing as an account. An admin adds someone in
People and fills in their whole profile (title, department, hire date, who they report to,
compensation, KPIs) before anybody sends them anything. `profiles.user_id` is null until they
first sign in, and every row shows which of three states it is in: Not invited, Invited, or
Active. Sending an invitation creates the invitation row, points it at that profile, and copies
a sign-in link to the clipboard; the hub sends no email.

Signing in claims the profile that is already there rather than creating a second one, whether
the person arrives through an invitation or through a company sign-in domain. Policies find the
signed-in person with `private.auth_profile_id()`, so "this row is mine" keeps working now that
a person and an account are two different things.

Having an account is never a precondition for being set up. A review cycle covers the whole
active roster, and anyone on it can be given goals, KPIs and compensation, whether or not they
have ever signed in. That is the state every new company is in on its first day, so the hub
works that way by default; the cycle's team table simply marks who cannot open theirs yet.
Because all of it hangs off a profile id that survives the sign-in claim, nothing has to be
redone when they finally arrive.

## Roles

A person in a company is an Owner, an Admin, a Manager or an Employee (0031).

- **Owner and Admin** both see everything for their company: the whole hub, as an admin always
  has.
- **Manager** sees what an Employee sees until the capability matrix arrives.
- **Employee** sees their own GSR data plus the libraries.

Grants are ranked, and the database enforces the ranking. Only an Owner or a Rococo admin makes
someone an Owner. Nobody grants a role above their own. Nobody changes the role or access of
someone ranked above them, invites them or removes them, whether or not they have signed in yet,
and the People page offers none of those actions on their row. Signing in with an invitation that
names a person claims their profile, so an invitation only ever names someone on that company's
roster who has not signed in yet. A person cannot report to themselves, to someone in another
company, or round in a loop, and moving a person to another company clears the reporting lines
that would cross it. A reporting line is checked when it changes, so one saved before 0031 never
stops anyone signing in.

## Personal KPIs and deliverables

A person is measured on two separate things, and they stay separate.

**Personal KPIs** are the numeric ones: a name, a target as people say it ("$2M in newly closed
sales"), where it stands, and whether it is hit. Unchanged.

**Deliverables** are the standing brief. A company defines the categories it thinks in
("BD & Sales", "Production"); each person carries headings under those categories for the
year; and each heading has the support tasks it is actually judged by. The rating lives on the
task, on the client's own four-step scale: Miss 0, Partial 1, Hit 2, Exceeded 3. A heading's
target is two points for every task on it, so a Hit on every task lands exactly on target and an
Exceeded puts the person over. Unrated tasks count toward the target but not the score, so a
half-reviewed heading reads low rather than flattering. Categories roll up the same way. The
arithmetic is in `src/lib/gsr/deliverables.ts`, pure and tested.

Filing a heading is one step. The add form sits at the top of the module and its category
pulldown offers the company's own categories alongside the starters it has not named yet: BD &
Sales, Production, Financial, Operations & Systems, Leadership, plus an option to type any other
name. A starter
becomes a real category row the first moment a heading is filed under it, so nothing is created
speculatively and a company can still name its categories anything. Every heading carries the
same pulldown, which is how one is refiled and the only way out of Uncategorized.

The same panel appears on the person page and inside the quarterly review. A pillar of type
"Deliverables module" is scored from it: the app writes the year's target and actual into the
review as one line item when the review is marked complete, so a task re-rated mid-review moves
nothing until sign-off.

## Job roles, role goals, and a person's own figures

A job role is a row a company adds in Settings (Site Supervisor, Project Manager, Salesperson),
and a person is placed in one from their profile. The role carries two things. First, the
dashboard modules its people get: today that is one module, their own financial figures, and a
new module is a new entry in the list every company sees, never a branch on who the company is.
Second, the goals the role brings into every month's Goal Setting Review: an admin writes them
once on the role, and the review offers them to file for the month in one click, as goals of
kind Role that the meeting then owns like any other. The template is never edited from a review.

A person's financial figures live on their profile: what they own for the year (closed sales,
revenue managed), the target, where it stands, and where the number came from. Entered by hand
today; QuickBooks and GoHighLevel will write the same rows under their own source, and a figure
an admin corrects by hand is marked as a hand entry again. Only the person and their admins can
read them, and they appear on the person's dashboard when their job role carries the module.

## Connections to outside systems

Each company connects its own GoHighLevel and QuickBooks Online accounts from Settings,
Connections, and its own Google account for Google Sheets (the Google row shows only for a
company with `data_sources` on). Connect sends the admin to the provider's own sign-in page;
the provider sends the browser back to the `connections` Edge Function, which exchanges the code for tokens,
records the connection on `company_connections` (the status row admins see: which account,
since when, last sync) and keeps the tokens in `connection_tokens`, a table with row level
security on and no policies, so only the function's service role can read it. Nothing in the
browser holds a provider secret or token, and nothing is shared between companies. Disconnect
revokes at the provider where it can and drops the tokens either way. Imported values land
read-only in `sync_records`, written only by the `connections` function. A failed sync keeps the
last good values with their time, and a blank shows as "-", never 0. `docs/integrations.md`
maps where each figure will come from.

## Impact scores

The ratings under the rating pillars (Klasik: Brand Impact, Character and Values) live on the
person, not in a review. An admin sets and trues them up on the profile, where each criterion
shows the current rating, a note, and the change since the last signed-off review. An open
quarterly review reads those ratings live and read-only, with the meeting's notes beside them.
Mark complete freezes the ratings into that review in the database, so a completed review is a
dated snapshot and the next one measures against it. Reopening shows the working copy again;
completing again freezes again. A review has no score of record until it is complete.

## Sections

Three sidebar sections, keyed on cadence: GSRs (monthly Goal Setting Reviews: last month at a
glance, this month's goals with their action steps and notes, the focus topic, no scoring),
Reviews (quarterly, annual and custom cycles: the scored review with the employee snapshot,
deliverables, yearly goals and feedback) and Goals (personal, professional and role goals for the
year and each person's BHAG, across the roster). Employees see the same three as My GSR, My
Reviews and My Goals.

## Monthly Goal Setting Reviews

Every review opens with the employee snapshot: position, hire date and tenure, department,
who they report to, this year's personal KPIs (current against target, hit or not, editable
by admins in the meeting), and the company goals. A monthly cycle's review then leads with
goals, not scores. The month's focus topic, from the cycle theme, sits at the top with its
explanation for reference, and the person's #1 GSR comes from it: their own words, set as a role
or professional goal, never a personal one. The manager sets the rest of the month's goals with
the person. Each goal carries an agreed completion from 0 to
100, where 100 marks it complete and which is the one figure that says how it landed; action
steps, which are checkpoints and count toward nothing; and a notes log, one dated line at a time,
that both sides add to between meetings and work from in the review (each person edits their own
entries). Goals read the focus topic's GSR first, then role, then professional, and personal last. Last
month's goals read back as hit or miss with the steps that were taken, their notes, and a "why"
the manager writes now, and a missed goal carries into this month in one click (only the steps
not yet taken come along, linked to the goal it came from). Closing a cycle freezes its goals and
their notes, and so does an admin locking a person's month in (database triggers, not just the
UI; only the why stays writable), so what a month recorded stays as recorded.

The person works their own open month the same way, from My GSR: they add and edit goals,
steps, completion and notes, carry last month's misses forward, and write the why, so the
meeting starts from their draft. Either side moves the completion; the manager has the last word,
because only an admin marks the month complete, which is what locks it in. If nobody has started
their review for the month yet, they
start it themselves (0020 allows exactly that: their own row, in an open monthly cycle, not
started, with no feedback or sign-off). Status, feedback and sign-off stay with the manager.
Quarterly, annual, and custom cycles keep the scoring-first layout for now. The rules are in
`src/lib/gsr/goals.ts`.

## Goals beyond the month

A person's goals outside the GSR belong to this year, next year, or their BHAG, the big goal three
to five years out, which never settles and reads open until it is hit. The goal itself (title,
description, kind, period and completion) is shared with the company's admins, who see it on the
profile, on the Goals page and on every quarterly review. Its action steps and progress notes are
the person's alone, and the database is what keeps them that way: they live in `goal_private`
and `goal_notes`, which only the owner can read for a yearly or BHAG goal (0021), and a trigger
refuses them on the shared goal row. My Goals says so in a line at the top.

## GSR scoring

Ported from the Klasik Executive Dashboard and made configurable per company. A company
defines pillars, each with a weight and a scoring type:

- **Rated criteria:** the reviewer rates each criterion 1 to N; pillar score is the average
  divided by N.
- **Target vs actual:** the reviewer enters deliverable line items; pillar score is the
  average achievement with each item capped at 100%.
- **Deliverables module:** scored from the deliverables module, written into the review as one
  line item when it is marked complete.
- **Monthly GSRs:** scored from the Goal Setting Reviews inside the review's period. The pillar
  says how many mandatory GSRs a month carries (two by default): the focus topic's GSR is #1, then
  role and professional goals, never a personal one. A month adds up the completion of all its
  goals, mandatory and stretch alike, up to 100% for each mandatory GSR, so two make 200% and a
  stretch goal adds to the total without ever lowering it: 50% and 30% on the mandatory two and
  80% on a stretch goal is 160% of 200%, a month score of 80. Either side moves the completion;
  an admin marking the month complete locks the score in (`reviews.gsr_score`, 0023), and only a
  locked month counts. The pillar is the average of the locked months in the period, written into
  the review as one line item on sign-off: a quarter's months are a third of its pillar each, and
  across a year each month is a twelfth. A company without such a pillar sees none of this. The
  rule is in `src/lib/gsr/goals.ts`.

Overall = sum(pillar score x weight) / sum(weights). An unscored pillar counts as zero, so
an incomplete review reads low, never high. The math is in `src/lib/gsr/scoring.ts` and
is fully unit tested. Klasik's live configuration (Deliverables 50, Brand Impact 25,
Character & Values 25) is seeded as-is.

A completed review keeps the pillars and weights it was signed off with (0022), alongside its
frozen ratings and line items, so re-weighting or adding a pillar later never moves a score of
record. Reopening a review lets them go; completing it again freezes today's.

## Financial CSV import

The Financials page accepts a spreadsheet export with one row per period. Header names
are flexible; these all work: `period` (or `period_start`, `month`, `date`), `revenue`,
`cogs` (or `cost_of_goods_sold`, `direct_costs`, `job_costs`), `opex` (or
`operating_expenses`, `overhead`), and optionally `period_type`, `net_profit`,
`cash_on_hand`, `notes`. Periods read as `2026-09`, `Sep 2026`, `9/2026`, `Q3 2026`, or
`2026`. Money may carry `$` and commas; parentheses mean negative. Re-importing the same
period overwrites it.

## Branding

Each company has a `theme_key` (`klasik`, `kingdom`, `rba`, or the default `rococo`). The
CSS for each lives in `src/index.css`; Tailwind utilities resolve to the active theme's
tokens, so the whole app restyles from one attribute on `<html>`. The login screen applies
a company's theme the moment its domain is recognized. Logos are a URL per company, set in
Settings or the Rococo section.

Brand type comes from Adobe Fonts. The Rococo Creative web project stylesheet linked in
`index.html` serves Goldenbook and Halcom on any domain (Adobe no longer keeps a domain
list for web projects), so no font files live in this repository. The Rococo theme names the
families the way Adobe declares them, `goldenbook` and `halcom`, with Cormorant Garamond and
Instrument Sans from Google Fonts as the design system's approved fallbacks. RBA's Proxima
Nova and Helvetica Neue LT Pro are Adobe families as well: add them to the same web project
and the RBA theme picks them up without a code change.

## Layout

- `src/App.tsx`: auth gate and router.
- `src/components/`: login, onboarding, app shell, and the `ui/` primitives.
- `src/pages/`: one folder per module.
- `src/services/`: the data layer, one module per table group; plain async functions.
- `src/lib/`: pure logic (scoring, cycle periods, CSV, formatting, theme registry).
- `src/test/`: fixtures and the mocked services the page tests render against.
- `demo/`: the demo-mode entry that runs the app on those mocks (`npm run demo`).
- `supabase/migrations/`: the schema, RLS, triggers, storage policies, and seed.
- `supabase/functions/`: the `connections` Edge Function and `_shared/` (provider keys and the
  pure sync modules: parse, keys, schedule, runner, tick, links, Google Sheets, QuickBooks).
- `supabase/tests/`: the SQL harness and one test file per migration.
- `docs/`: designs for work that is specified but not built.

## The connections function

`supabase/functions/connections` is deployed with the gateway's JWT check off, because the
provider's callback arrives with no session. Its routes, all under
`/functions/v1/connections`, and who may call each:

- `POST /start` and `POST /disconnect`: an active Owner or Admin of the company, or a Rococo
  admin, checked on their own JWT.
- `GET /callback`: the provider, with no JWT; the function checks its own signed state instead.
- `POST /sync/run`: Sync now, on the JWT of someone allowed to sync the source
  (`private.can_sync_source`, decided by row level security), for a company with `data_sources`
  on.
- `POST /sync/tick`: the hourly cron, with the `x-sync-secret` header checked against
  `SYNC_CRON_SECRET`. It starts due sources only in companies with `data_sources` on. First it
  closes any run on the connections it reads that is still marked running past the stale window
  (`STALE_RUN_MINUTES` in `_shared/sync/runner.ts`), since the platform cut that run off. The app
  already shows such a source as failed ("The last sync did not finish."), never Syncing forever.
- `POST /sync/describe`: an active Owner or Admin of the company, or a Rococo admin; reads a
  sheet's tabs and first row.

The sync routes live in this function so it stays the only reader of `connection_tokens`. It
needs these secrets (Dashboard, Edge Functions, Secrets):

- `CONNECTIONS_STATE_SECRET`: any long random string; signs the state that ties a callback to
  the company and admin who started it.
- `APP_ORIGINS`: comma separated origins the browser may be returned to, such as the
  production domain (`https://companyhub.rocococreative.io`) and the Vercel preview domain.
  Localhost is always allowed.
- `GHL_CLIENT_ID` and `GHL_CLIENT_SECRET`: from a HighLevel Marketplace app owned by Rococo
  with the scopes `opportunities.readonly users.readonly locations.readonly`.
- `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET` and `QBO_ENVIRONMENT` (`sandbox` or `production`): from
  an Intuit developer app owned by Rococo with the `com.intuit.quickbooks.accounting` scope.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: from a Google Cloud OAuth client of type Web
  application owned by Rococo, with the scopes
  `openid email https://www.googleapis.com/auth/spreadsheets.readonly`.
- `SYNC_CRON_SECRET`: a long random string, for example from `openssl rand -hex 32`; the hourly
  tick sends it, and Vault keeps the same value as `sync_cron_secret`.

All three provider apps (HighLevel, Intuit and Google) must list the same single redirect URL:
`https://<project-ref>.supabase.co/functions/v1/connections/callback`. Until the keys are in
place, Connect answers with a plain "not set up yet" line and nothing else changes. Deploy with
`supabase functions deploy connections --no-verify-jwt`.

## Data sources and Google setup

A company with `data_sources` on reads figures from its own Google Sheets and QuickBooks
through sources it configures. The steps, in order:

**Google Cloud (a Rococo-owned project)**

1. Enable the Google Sheets API.
2. OAuth consent screen: user type External, app name "Company Hub", authorized domain
   `rocococreative.io`, homepage `https://companyhub.rocococreative.io`, a privacy policy URL,
   and the scopes `openid`, `email` and `.../auth/spreadsheets.readonly`.
3. Set the publishing status to In production. Testing mode issues refresh tokens that expire
   after 7 days.
4. Create an OAuth client of type Web application with the authorized redirect URI
   `https://jjdcejevdqpwuastsmpq.supabase.co/functions/v1/connections/callback`.
5. Submit sensitive-scope verification.

**Supabase secrets (Dashboard, Edge Functions, Secrets)**

6. Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `SYNC_CRON_SECRET`.
7. Confirm `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET` and `QBO_ENVIRONMENT` are set.

**Vault (SQL editor)**

8. Create the two entries the hourly job reads:

   ```sql
   select vault.create_secret('<same value as SYNC_CRON_SECRET>', 'sync_cron_secret');
   select vault.create_secret('https://jjdcejevdqpwuastsmpq.supabase.co/functions/v1/connections/sync/tick', 'sync_function_url');
   ```

9. Paste `0030_sync_schedule.sql`. It schedules `hub-sync-tick` at minute 7 of every hour
   (`7 * * * *`) with pg_cron and pg_net. Check it with `select jobname, schedule from cron.job;`
   and, after the next hour, with
   `select status, return_message from cron.job_run_details order by start_time desc limit 5;`.

**Intuit**

10. For real books, complete Intuit's production app assessment and set
    `QBO_ENVIRONMENT=production`.

**In the hub**

11. A company admin connects Google Sheets and QuickBooks from Settings > Connections.
12. They add sources in Settings > Data sources: paste the sheet link with the tab open, press
    Read headers, map the fields, pick the record key, set the weekly day, time and zone, and
    the stale threshold if one is agreed.
13. They press Sync now once to see the first run land.

Each source keeps its own weekday, time and time zone; the hourly tick works out which are due
and makes one attempt per weekly slot. A run is all or nothing, and rows that are entirely blank
are skipped and counted. The QuickBooks reader is GET only and reads Invoice and Payment
records.

Still pending from Kingdom: the sheet links and field mappings; the sync day, time, zone and
stale threshold; the QuickBooks fields; and the capability matrix. Until they arrive, the
Sales & Finance and Production cards read Not configured.

## SQL harness

`npm run test:sql` runs `bash supabase/tests/run.sh`. It starts a throwaway local PostgreSQL 16
cluster (from `/usr/lib/postgresql/16/bin`, or `PG_BIN`; when run as root the server runs as
the `postgres` OS user via `runuser`), loads `supabase/tests/stubs.sql` (stand-ins for
Supabase's roles and the `auth`, `storage`, `vault`, `cron` and `net` schemas), applies every
migration in order (stripping only the pg_cron and pg_net `create extension` lines), applies
`0024` and later a second time to prove they are idempotent, loads
`supabase/tests/helpers.sql`, then runs each `supabase/tests/*.test.sql` in a transaction that
is rolled back.

It needs a local PostgreSQL 16 and is not part of CI, which has no PostgreSQL; run it by hand for
any change under `supabase/`. Every migration task adds `supabase/tests/<number>_<name>.test.sql`.

## Applying this release

The Kingdom release is `0024` to `0031` plus the `connections` function. Nothing here is
applied until someone does it by hand:

1. Back up, then paste `0024` to `0029` and `0031` in order in the SQL editor, once each. Each
   is idempotent; go forwards only.
2. Merge to `main` (Vercel deploys the app) only after `0024` to `0029` and `0031` are applied.
   The new app selects `companies.modules` every time it loads a company, so until `0024` is in
   it cannot load any company, Klasik and RBA included.
3. Set the function secrets (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SYNC_CRON_SECRET`) and
   deploy: `supabase functions deploy connections --no-verify-jwt`.
4. Create the Vault entries `sync_cron_secret` and `sync_function_url`, then paste `0030`.

Steps 5 and 6 happen only once the new app (step 2) and the `connections` function (step 3) are
live.

5. Open Rococo > Companies and turn on Kingdom's modules (all five, or the ones Kingdom has
   agreed).
6. As a Rococo admin, on Kingdom's People page (or Rococo > People), set Maddie Cothran and
   marvin waters to Owner by hand. A Kingdom admin's role select does not offer Owner, and the
   old app counts only `admin` as an admin, so an owner set while it is still live loses every
   admin screen.
7. Run the reporting-line check below. It lists anyone whose Reports to crosses companies or
   runs in a loop, the same lines `0031`'s pre-check prints as notices. `0031` judges a line
   only when it changes, so these never stop anyone signing in, but clear each one: on that
   person's page, set Reports to to someone in their own company, or to nobody. No rows means
   nothing to do.

   ```sql
   with recursive up (start_id, id, depth) as (
     select id, reports_to, 1 from public.profiles where reports_to is not null
     union
     select up.start_id, p.reports_to, up.depth + 1
       from up join public.profiles p on p.id = up.id
      where p.reports_to is not null and up.depth < 50
   )
   select p.full_name, p.email, 'crosses companies' as problem
     from public.profiles p join public.profiles m on m.id = p.reports_to
    where m.company_id is distinct from p.company_id
   union all
   select p.full_name, p.email, 'loops'
     from public.profiles p
    where p.id in (select start_id from up where id = start_id);
   ```

8. Check: Klasik and RBA look unchanged; Kingdom Home shows the four sections; Rococo >
   Activity shows the module change and the role changes; `select jobname, schedule from
   cron.job;` lists `hub-sync-tick`.

`0031` does not depend on `0030`, so either order works; its header says the same, and step 1
pastes it first. `0030` must follow the Vault entries. No migration seeds modules or roles.

## Deploy

Live: Vercel project `company-hub` in the Rococo Creative team, production branch `main`,
at https://companyhub.rocococreative.io. The old https://company-hub-rocococreative.vercel.app
address redirects there (`vercel.json`), so no link or bookmark lands on it. The Supabase project is "Rococo - Company
Hub" (`https://jjdcejevdqpwuastsmpq.supabase.co`); its keys live in Vercel's environment
variables and are never committed.

Vercel with framework preset Vite. `vercel.json` carries the SPA rewrite and security
headers. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for Production, Preview, and
Development, and `VITE_APP_URL=https://companyhub.rocococreative.io` for Production and Preview so
every invitation link carries the production domain, whichever build an admin copied it from. CI (`.github/workflows/ci.yml`) runs the tests and the type-checked build on
every push and pull request.
