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
| Home | State of every module at a glance | Own score, goals, recent SOPs |
| Goal Setting and Review | Configurable pillars and weights, review cycles, scoring, feedback, team scores; monthly cycles run as Goal Setting Reviews | Own reviews, scores, feedback; goals with action steps and progress notes that stay private to them |
| People | Add staff before inviting them, invite when ready, roles, deactivate; hire date, department, reports to; compensation and yearly KPIs (the person and admins only) | (not visible) |
| Resources: SOPs | Write in a rich editor, import Word, PDF, text and Markdown files, file under the company's own categories and tags, version history with who saved each version, compare and restore, publish, attach files, assign as tasks and see who signed off; categories on Resources > Setup | Read, search inside, find in a page, and sign off published documents; see which are assigned to them. Managers see the sign-offs of the people they lead on each person's Overview |
| Resources: Files & media | Add files, templates, videos and saved links with tags | Browse and open |
| Financial snapshots | Revenue, direct costs, overhead, margins, net, cash by month, quarter, or year; manual entry or CSV import | (not visible) |
| Marketing tracker | Board of planned, active, paused, and complete campaigns with budget vs spend and the key result | (not visible) |
| Production (`production`) | Projects with a job reference, milestones and letters (add, edit, reorder, set each one Not started, In progress or Complete, archive); cards for client score, cleanliness, job health, warranty and PM capacity that read Not configured until they are defined | Read only |
| Wins (`wins`) | Log, edit and remove wins; the five most recent on Home, or those of the last few days when the company sets a number; older wins in an Archive view | Read; the same Home list and the Archive view |
| Tasks (`tasks`) | Assign tasks to anyone with a due date, a priority, ordered steps and a repeat; see every task, filter by person, priority, campaign or state; attach a task to a marketing campaign; the assignee gets an email | Own assigned tasks: tick steps, complete and reopen; create tasks for themselves |
| Sales & Finance (`data_sources`) | Read-only reporting and controls from connected Google Sheets and QuickBooks sources, each with its sync state and last successful sync | (not visible) |
| Home cards (`switchboard`, `data_sources`) | Attention items, section shortcuts, data freshness | Shortcuts, wins |
| Resources: Links (`external_links`) | Links to the programs where the work lives (name, link, what it is for, category, order, who sees it), managed on Resources > Links and shown there, on the Home card Where the work lives, and on the section page their category names; public share views embedded on section pages only when flagged public | Read on Resources > Links and on Home |
| Rococo portfolio | Rococo admins only: every company with its health signals, plus companies, themes, sign-in domains, and every user, and the Activity log of configuration and permission changes | |

Rows marked with a module key appear only for a company whose modules include it. The task
assignment email is the only email the hub sends; other notifications are the next phase.

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
   `supabase/migrations/` in numeric order (`0001` through the highest number present; a gap
   in the numbers is not a missing file), once each, on a fresh
   project. Paste `0032` only after the two Vault entries in Data sources and Google setup
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
7. **Sign in.** An `@rocococreative.io` address is a Rococo admin only once it is on the Rococo
   admins list (Rococo > Permissions), and only with a confirmed email; `0051` seeds the first
   entry from the existing Rococo admin. A Rococo admin lands on the portfolio: every company with
   its signals, and the tabs where companies, themes, domains, and users are managed. Opening a company switches the hub to that
   company's branding and nav, for that session only.

### What is applied live

Kept current by whoever pastes a migration, so the next session knows where it stands. Live
project `jjdcejevdqpwuastsmpq`, as of 2026-11-25:

- **Applied, in the order they went in:** `0001` to `0023`, `0024_company_modules`,
  `0025_audit_log`, `0028_claim_and_wall_hardening`, `0029_integrity_guards`,
  `0026_projects_milestones`, then `0027_wins`, `0030_sync_engine`, `0031_external_links`,
  `0033_role_hierarchy` and `0034_cycle_omissions` together in one transaction (2026-11-10),
  then `0035_scorecards_divisions_focus_calendar` (2026-11-10, after `0034`), then `0036_tasks`
  (2026-11-11), then `0037_company_time_zone`, then `0038_team_and_division_access` and
  `0039_gsr_guards_and_task_goal_links` (2026-11-18, the app and `notify` deployed the same day).
  `0038` puts every person's records behind the reporting chain and division view access; both
  live admins kept every division. `0039` froze the monthly GSRs that were already complete.
  `0026` and `0027` went in after `0029` even though their numbers are lower, because they
  were written before `0028` existed.
- **Not applied yet:** `0032_sync_schedule`, which waits on its two Vault entries
  (`sync_cron_secret` and `sync_function_url`) and the Google keys. It does not depend on `0035`.
  So `0001` to `0052` are not all live; `0032` is the gap. `0053` is written and not applied
  yet (see The SOP library). The next free number is `0054`.
- **Applied 2026-11-24 (pasted in the SQL editor, checked live):** `0051_rococo_admins` and
  `0052_connection_secrets` (see Applying security hardening). The one Rococo admin is on the
  list and active; `connection_pending` is not readable by signed-in users; no provider
  account id is left on a browser-readable row.
- **Applied 2026-11-18:** `0040_capabilities` and `0041_capability_policies` (see Roles, Who
  may do what), with no override rows for any company yet. For a fresh database the order is:
  paste `0040`, then `0041`, confirm the API serves the new tables, and only then
  merge and deploy the app (see Applying capabilities and the Kingdom roster for why). With no
  override rows nothing changes for any company. Once `0041` is in, pasting `0001`, `0026`, `0027`, `0030` or
  `0038` again puts back their old policy and function bodies for pay, the company row,
  milestones, wins and Sync now, and those stay in force until `0041` is pasted again. Go
  forwards only; if one of those is ever re-pasted, paste `0041` straight after it.
- **Seeds run live:** `supabase/seeds/rba_scorecards.sql` (2026-11-10): RBA's two divisions
  (RBA South, RBA North), the 8 named roles and 33 metrics across 6 roles. Safe to run again.
- **Seeds written, not run:** `supabase/seeds/kingdom_permissions.sql`: Kingdom's seven capability
  levels and nothing else. This is the one to run, after `0040`, `0041` and the app deploy.
- **Seeds on hold:** `supabase/seeds/kingdom_intake.sql`: Kingdom's seven capability
  levels, eight job roles and ten people (see Applying capabilities and the Kingdom roster). Runs
  after `0040`, `0041` and the app deploy, and refuses to run without both migrations. Safe to run
  again.
- **The `connections` Edge Function** live is version 11 (version 9 was deployed 2026-11-24 through
  the Supabase connection, JWT check off, checked byte for byte against this repo; 11 is reported live and
  checked as of 2026-11-25, with QuickBooks on production keys and connected for Klasik): owners and
  admins manage connections, Google Sheets and the sync routes, the Phase 2 multi-day schedule
  (`sync_weekdays`), the catalog's `POST /status` route, and the security hardening (sealed
  tokens, connect then confirm, no-store). `TOKEN_ENCRYPTION_KEY` and `CONNECTIONS_STATE_SECRET`
  are set. Google Sheets and the hourly sync answer "not set up yet" until `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET` and `SYNC_CRON_SECRET` are set and `0032` is applied.
- **The `notify` Edge Function** is deployed with the gateway's JWT check on. It reads the
  secrets `RESEND_API_KEY`, `TASKS_FROM_EMAIL` and `APP_URL`, and answers "Task emails are not
  set up yet." until all three are set. Live is version 10 (version 8 was deployed 2026-11-24 with
  `connections`, checked byte for byte; 10 is live and checked as of 2026-11-25): the task email, sent only for the task's creator, an
  owner or admin, or Rococo (the same confirmed-email list rule as the database), and the
  invitation email.
- **Configuration set live:** Kingdom has five of the six modules on (every one but `tasks`);
  Klasik has `external_links` and `tasks`; RBA has `external_links`, `tasks` and `production`
  (read from the live database 2026-11-18). Kingdom's owners are Maddie Cothran and marvin waters. Running
  `kingdom_intake.sql` changes that if their live addresses are the listed ones
  (`marvin@kingdomcustomconstruction.com`, `maddie@kingdomcustomconstruction.com`): Eli Cothran and
  Davis Nix become the owners, Marvin Waters an admin and Maddie Cothran an employee. Confirm the
  two owners' addresses before running it (see Applying capabilities and the Kingdom roster).
- **Applied 2026-11-19, through the Supabase connection, with the schema reloaded:**
  `0042_company_display_settings`, `0043_milestone_status`,
  `0044_milestone_templates` and `0045_sync_weekdays` (Phase 2, see Applying Phase 2). Every
  company is on the defaults, so nothing visible changed. The app and `connections` function that
  read them are live (the function since 2026-11-23). With
  them in, these re-pastes undo part of them (go forwards only; if one happens, paste the
  named Phase 2 file straight after it):
  - `0001`, `0009` or `0024` puts back an older `guard_company_fields`, and `0025` or `0037` an
    older `companies_audit`; neither older one protects or watches `wins_home_days` and
    `manual_financials`. Paste `0042` after it.
  - `0030` puts back the old `sync_sources_audit`, which does not watch `sync_weekdays` or
    `stale_business_days`. That is all it restores: its schedule check sits inside
    `create table if not exists`, so the check `0045` rebuilt stays. Paste `0045` after it.
  - `0026` and `0030` touch nothing `0043` or `0044` creates (the milestone status column, its
    check and trigger, `milestone_templates` and the trigger that copies it onto new projects).
- **Applied 2026-11-20:** `0046_gsr_rhythms`. It adds `review_cycles.kind` (a Goal Setting
  Review period or a scored review) and `profiles.gsr_cadence` (the rhythm a person's Goal
  Setting Review runs at, monthly by default), with the guards and function bodies that read
  them. Every company is on the defaults, so nothing visible changed. No live screen reads either
  column; the app that ships with `0047` reads both.
- **Applied (found in the live database 2026-11-21; RBA is on demand, Kingdom and Klasik on periods):** `0047_gsr_on_demand` (see GSRs on demand, and its release order
  there). It adds `companies.gsr_mode`, GSRs with no cycle and their goals, the wall that keeps all
  of it out of a company on periods, the move of one company over, and takes back what `0046` put
  on every company. Every company stays on periods when it goes in, so nothing visible changes. It
  redefines functions, triggers, policies and checks that these earlier migrations define:
  `0001`, `0003`, `0009`, `0011`, `0012`, `0013`, `0014`, `0018`, `0021`, `0023`, `0024`,
  `0025`, `0028`, `0029`, `0033`, `0034`, `0035`, `0036`, `0037`, `0038`, `0039`, `0042` and
  `0046`. If any of them is ever pasted again after `0047`, paste `0047` straight after it.
  `0046` matters most: pasted again on its own it puts members opening cycles, the rhythm
  trigger and whole-month dates back on every company.
- **Applied (found in the live database 2026-11-21):** `0048_invitation_emails`. It holds `invitations.email` to one
  plain address and adds `invitations.last_emailed_at`, the invitation email's 10 minute pace,
  which no signed-in writer can set or change. Every live invitation row already matches the
  address check. It does not depend on `0047`. The order: apply `0048`, then deploy `notify`, then
  merge the app (the app and the function both read `last_emailed_at`).
- **Rococo Permissions page** (Rococo, Permissions): merged and deployed 2026-11-18.
- **Applied (found in the live database 2026-11-21):** `0049_delete_people`. An owner or admin deletes a person who has
  signed in (see The roster and accounts): a delete policy, the ranked guard rebuilt with the
  refusals for a signed-in person, the private block list `private.blocked_signups`, a trigger that
  blocks the address and deletes the person's `auth.users` row, the signup gate refusing a blocked
  address without a pending invitation, and `handle_new_user` lifting the block at an invited
  sign-in through an invitation made after the block. It also lets the cascade and the account
  delete through guards and stamps that refused or undid them (goals and notes in a closed or
  locked month, a note's author, who created a project, who reviewed a review, who entered a
  figure, who sent an invitation, who created a review cycle). It redefines functions that these
  earlier migrations also define: `0001`, `0002`, `0003`, `0009`, `0011`, `0012`, `0013`, `0014`,
  `0021`, `0023`, `0026`, `0028`, `0029`, `0033`, `0034`, `0035`, `0038`, `0039`, `0046` and
  `0047`. If any of them is pasted again after `0049`, paste `0049` straight after it. Before
  applying, run two checks. `select conrelid::regclass, confdeltype from pg_constraint where
  confrelid = 'auth.users'::regclass` must show nothing outside Supabase's own auth tables without
  `on delete cascade` or `set null`, and `select has_table_privilege('postgres', 'auth.users',
  'DELETE')` must be true (paste the migration as `postgres`, the SQL editor's role, so it owns the
  trigger function). Either one failing makes every delete of a signed-in person refuse and roll
  back. The hook needs no change in the dashboard: it is the same function. Apply it before merging
  the app, which offers Delete person.
- **Applied (pasted in the SQL editor, checked live 2026-11-23):** `0050_connector_requests`. It adds `connector_requests`, one row
  per company per tool a company has asked for from the Connections catalog: members and Rococo
  read, the company's admins (or a Rococo admin acting for it) ask and withdraw, the database
  stamps who asked, and every ask and withdrawal is audited. Deleting a person who asked keeps the
  request and clears who asked. It redefines nothing earlier and depends on nothing after `0049`.
  Nothing visible changes when it goes in. Apply it before merging the app that reads it.
- **Written, not applied:** `0053_sop_library` (see The SOP library, and its release order there).
  It redefines `set_sop_version` and `stamp_sop_updated_by` (`0004`) and `recur_task` (`0036`,
  `0037`). If any of `0004`, `0036` or `0037` is pasted again after it, paste `0053` straight after.
- **Next free number:** `0054`.

Two sessions working at once is how numbers collide. Before writing a migration, check this
list and the open branches, take the next free number, and add it here in the same change.

## Modules

Some parts of the hub are modules a company has on or off. The keys:

| Key | Label | What it turns on |
| --- | --- | --- |
| `switchboard` | Switchboard | The Attention and Shortcuts cards on Home, and Freshness with data sources. |
| `production` | Production | Projects, milestones and letters, and the Production cards. |
| `wins` | Wins | The wins page and the Home wins card. |
| `data_sources` | Data sources | Connected Google Sheets and QuickBooks sources, Sales & Finance, and data freshness. |
| `external_links` | External links | Links to outside tools, such as Monday: Resources, Links, the Home card, and each section's page. |
| `tasks` | Tasks | Tasks assigned to people, with due dates, steps, and repeats, the Tasks page with its open count in the sidebar, and the tasks behind each marketing campaign. |

Every company's sidebar reads in the same sections (see Where things live); a module adds or
hides whole items in it, never a company name. `external_links` is the one that puts Links in
Resources and the Where the work lives card on Home, so it has to be on for a company to see them.

A module is a key in `companies.modules`, read only through `src/lib/modules.ts` (`hasModule`)
and changed only by a Rococo admin on Rococo > Companies. A company with no modules on looks
exactly as it did before modules existed. Turning a module off hides its screens and keeps its
rows, so turning it back on brings everything back as it was. Turning `data_sources` off also
stops its syncs: the hourly tick skips that company's sources and Sync now refuses, so nothing is
read from Google Sheets or QuickBooks while it is off.

### Display settings (not modules)

Two settings sit beside the modules on Rococo > Companies, set by Rococo only (0042). Both are
columns on the company, and each defaults to what every company has today.

- **Days a win stays on Home** (`companies.wins_home_days`, 1 to 3650). Empty means the five
  newest wins with no age limit. With a number, a win stays on Home that many days counting the day it was won,
  judged in the company's own time zone. Older wins move to an Archive view on the Wins page that
  everyone can browse. A win an admin removed stays hidden everywhere.
- **Manual Financials** (`companies.manual_financials`, default on). Off removes the Financials
  nav item and route, the Home section and shortcut, the Sales & Finance pointer, and the
  portfolio figure, alert and button. "Your figures" on a person is a different feature and is
  unaffected. The switch hides screens only: the financial snapshots and the rules on who may
  read and write them are untouched. This is a company setting and not a module because modules
  are opt-in: a module would have switched Financials off for every new company, while a setting
  defaults to on.

## How people get in

- **Company email:** the login screen recognizes the domain, switches to that company's
  theme, and sends a one-time link. The signup gate admits the address and the profile is
  placed in the company automatically.
- **Personal email:** an admin presses Send invite on the People page. That creates the
  invitation, which the gate needs to admit the address, and the `notify` function emails it:
  a link to the sign-in screen with the address filled in. If the email does not go out, the
  invitation still stands and its link is copied for the admin to pass on; Email again on the
  row tries once more. The gate admits the invited address. On first sign-in a person
  who is not on any roster yet gets the invitation's company, role, and title; a person
  already on a roster keeps that roster row's role, and its title unless the row has none.
- **Invited by more than one company:** a person already on a company's roster takes that
  company's invitation; otherwise the invitation naming them comes first, then the one from
  the company that owns the email domain, then the newest. The rest are withdrawn at that
  sign-in, since a person is in one company at a time and nothing can accept an invitation
  once the account exists (0028).
- **First sign-in:** the person gives their name and is in. Roles are `owner` and
  `admin` (the whole hub for their company), `manager` and `employee` (own GSR data plus the
  libraries); see Roles.
- **Deactivating** a person on the People page removes all access immediately, including
  editing their own profile; their account can be reactivated later. A Rococo admin's profile
  is Rococo's to change, even when it sits on a company's roster.
- **Deleted, then invited again:** a person deleted after signing in is on a private block list,
  and the signup gate refuses their address, even on a company domain, with "This address was
  removed from the hub. Ask an owner or admin to invite you again." A pending invitation opens the
  gate as it does for any personal address, and signing in through it lifts the block (0049). An
  invitation made before the delete does not count. A deleted Rococo admin cannot come back this
  way (an invitation would place them in a company with its role), and the block outranks the
  Rococo admins list, so first make sure the address is on the list (Rococo > Permissions), then
  clear that one row in the SQL editor: check it with the read-only
  `select email, blocked_at from private.blocked_signups where email = lower(trim('name@rocococreative.io'));`
  (one row expected), then delete only it with
  `delete from private.blocked_signups where email = lower(trim('name@rocococreative.io'));`, using
  their address in place of `name@rocococreative.io` in both. They then sign in again as a Rococo
  admin.
- **Moving** a person to another company (Rococo, Users) takes their yearly goals, KPIs,
  compensation and deliverables with them and leaves their months with the old company. Their
  ratings start over in the new company, since criteria are each company's own, and their
  deliverable headings land in Uncategorized there, keeping their tasks. A
  pending invitation moves with them while they still need it to sign in, and manager links
  across the two companies are cleared (0029). Setting someone to No company withdraws their
  pending invitations, since there is no company for one to wait in; the company that places
  them later invites them from its People page. A parked person whose address is on a company's
  sign-in domain can still sign in, and lands in No company: placement follows the roster row,
  never the domain.

## The roster and accounts

A person on a company's roster is not the same thing as an account. An admin adds someone in
People and fills in their whole profile (title, department, hire date, who they report to,
compensation, KPIs) before anybody sends them anything. `profiles.user_id` is null until they
first sign in, and every row shows which of three states it is in: Not invited, Invited, or
Active. Any row except your own, a Rococo admin's, and one ranked above you (see Roles) can
also be deactivated, signed in or not, and then reads Inactive. An inactive person drops out of review cycles until reactivated, except
where their review was already signed off: a cycle keeps that row, so its counts and team score
never change after the fact. Sending an invitation creates the invitation row, points it at that
profile, and emails the person through the `notify` function. If the email does not go out, the
invitation stands anyway and its sign-in link is copied to the clipboard instead. A waiting
invitation keeps Copy link and Email again on its row until the person signs in.

Deleting goes further than deactivating. Someone who never signed in is removed with Remove on
their Setup tab; when the page has loaded reviews, GSRs or goals for them, Remove asks for their
full name typed first, since it deletes those too, closed and locked months included. Someone who
has signed in gets Delete person there instead, offered to an owner or admin who manages them and
to Rococo, never on yourself, on someone ranked above you or on a Rococo admin's profile, and to an
admin who sees only some divisions only for people ranked below them (0049). It deletes everything on their profile: reviews and scores,
GSRs, goals and their notes, ratings, KPIs, compensation and deliverables. Tasks, goals, notes and
reviews they assigned, set, wrote, completed or signed off for other people stay, without their
name. Their sign-in is deleted with them and their address is blocked until an owner or admin
invites it again. The dialog says all of that, offers Deactivate as the way to keep their history,
and holds its button until the person's full name is typed exactly. The database refuses the same
cases the screen does not offer, and also the company's only active owner ("Make someone else an
owner first").

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

A person in a company is an Owner, an Admin, a Manager or an Employee (0033).

- **Owner and Admin** both see everything for their company: the whole hub, as an admin always
  has.
- **Manager** sees what an Employee sees, plus the people below them in the reporting chain
  (0038) and whatever their company's capabilities give a manager (below).
- **Employee** sees their own GSR data plus the libraries.

Grants are ranked, and the database enforces the ranking. Only an Owner or a Rococo admin makes
someone an Owner. Nobody grants a role above their own. Nobody changes the role or access of
someone ranked above them, invites them or removes them, whether or not they have signed in yet,
and the People page offers none of those actions on their row. Signing in with an invitation that
names a person claims their profile, so an invitation only ever names someone on that company's
roster who has not signed in yet. A person cannot report to themselves, to someone in another
company, or round in a loop, and moving a person to another company clears the reporting lines
that would cross it. A reporting line is checked when it changes, so one saved before 0033 never
stops anyone signing in.

### Who may do what (capabilities)

A handful of powers are set per company as the lowest role that holds each one (0040, 0041).
`public.capabilities` is the catalog with each default; `public.company_capabilities` holds a
company's overrides, one row per capability, and no row means the default. The defaults are what
every company had before, so a company with no rows sees no change. A Rococo admin holds every
capability. The level `rococo` means no company role holds it.

| Capability | Default | What it decides |
|---|---|---|
| `pay` | admin | Who reads and writes a person's compensation |
| `company_settings` | admin | Who edits the company row (Settings, Company); slug, theme and modules stay with Rococo |
| `audit_log` | rococo | Who reads the company's own change log (Settings, Activity) |
| `milestones_edit` | admin | Who adds and edits a project's milestones |
| `wins_post` | admin | Who records a win |
| `sync_run` | admin | Who presses Sync now on a data source |
| `production_view` | employee | Who sees the Production pages and project links in the app |

Members read their own company's rows and only Rococo writes them. A Rococo admin sets a
company's levels on Rococo, Permissions: one grid with a row per capability and a column per
company, each change stored, read back and shown from what the database returned. Every change
is in the change log. `supabase/seeds/kingdom_permissions.sql` stays as a record of what Kingdom
asked for and is not needed. `production_view` is a screen rule only: the
project rows themselves stay readable by every member, as before.

Known limits, as built:

- Setting `sync_run` above admin does not take Sync now away from admins. An admin's edit path
  on a data source is separate (it still follows who manages the company), and it can set the
  same request.
- Setting `pay` below admin gives managers nothing. Pay also follows whom a person manages
  (0038), and a manager manages nobody.
- The company Activity tab shows every change in the company, whatever divisions the reader
  sees.
- A person who holds `sync_run` and is not an admin gets Sync now on the Production page: a
  button and a last-updated stamp for each Production source. The screen does not show them the
  raw error, the sheet or the field map; those stay in Settings > Connections for admins.
- Keep `audit_log` at admin or above. There is no screen for it below admin, and the log includes
  invitation addresses and connection details.
- Capabilities load when a company opens and again when the tab returns to the front (at most once
  every 30 seconds), so a change reaches a person who has the hub open on their next return to the
  tab.

## Production milestones

A milestone is Not started, In progress or Complete, the same three for every company (0043). A
trigger keeps the status in step with the completed date: a date completes it, and when a write
sends both, the date wins; marking complete with no date takes today in the company's time zone;
reopening clears the date. The badge reads Not started, In progress, or Complete with its date.

A company's standard milestones are its own list, set by its admins in Projects > Setup (the
Setup tab shows only with the `production` module on; 0044). Each project created afterwards, including
projects the system creates, gets a copy of the list in order. Projects that already exist are
untouched, and later edits to the list do not reach back into a project. With no list, new
projects start with no milestones, as before.

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
same pulldown, which is how one is refiled and the only way out of Uncategorized. An admin
corrects the categories themselves in Reviews > Setup, Deliverable categories: rename, reorder, retire
(no longer offered for new headings; the ones already filed keep it) or delete (its headings
move to Uncategorized and keep their tasks and ratings).

The same panel appears on the person page and inside the quarterly review. A pillar of type
"Deliverables module" is scored from it: the app writes the year's target and actual into the
review as one line item when the review is marked complete, so a task re-rated mid-review moves
nothing until sign-off.

## Job roles, role goals, and a person's own figures

A job role is a row a company adds in People > Roles (Site Supervisor, Project Manager, Salesperson),
and a person is placed in one from their profile. The role carries two things. First, the
dashboard modules its people get: today that is one module, their own financial figures, and a
new module is a new entry in the list every company sees, never a branch on who the company is.
Second, the goals the role brings into every month's Goal Setting Review: an admin writes them
once on the role's own page in People > Roles (`/people/roles/:roleId`), and the review offers them to file for the month in one click, as goals of
kind Role that the meeting then owns like any other. The template is never edited from a review.

A person's financial figures live on their profile: what they own for the year (closed sales,
revenue managed), the target, where it stands, and where the number came from. Entered by hand
today; QuickBooks and GoHighLevel will write the same rows under their own source, and a figure
an admin corrects by hand is marked as a hand entry again. Only the person and their admins can
read them, and they appear on the person's dashboard when their job role carries the module.

## Connections to outside systems

Each company connects its own GoHighLevel and QuickBooks Online accounts from Settings >
Connections, and its own Google account for Google Sheets (the Google row shows only for a
company with `data_sources` on). Connect sends the admin to the provider's own sign-in page;
the provider sends the browser back to the `connections` Edge Function, which exchanges the code for tokens,
records the connection on `company_connections` (the status row admins see: which account,
since when, last sync) and keeps the tokens in `connection_tokens`, a table with row level
security on and no policies, so only the function's service role can read it. Each sign-in's
state is single use: the function records its nonce in `connection_states` (0029, locked down
the same way) and redeems it once on the way back. Nothing in the
browser holds a provider secret or token, and nothing is shared between companies. Disconnect
revokes at the provider where it can and drops the tokens either way. Deleting a company on the
Rococo Companies tab disconnects each of its connections first, because its tokens go with it,
and then removes its stored files under `{company_id}/` in `hub-files`, which no row cascades to.
Imported values land read-only in `sync_records`, written only by the `connections` function. A
failed sync keeps the last good values with their time, and a blank shows as "-", never 0.
`docs/integrations.md` maps where each figure will come from.

### The Connections catalog

Settings > Connections is a catalog, the same for every company, grouped as Financials,
Production, Marketing & Sales and Productivity. The list of tools lives in code
(`src/lib/connectors.ts`); each company's own rows decide what each card shows. A card reads
Connected, Needs attention, Not connected, Not available yet (Rococo has not added that tool's
keys), Not on for this company (it needs a part of the hub the company does not have), Linked,
Not set up, Coming next or Coming soon, and offers only the one action that will work. A company's
own connection row always wins: a working connection stays visible even if its module was turned
off later, and Disconnect always works.

- **One connection per company per tool.** Any owner or admin connects it and it serves the whole
  company. A connected card's panel names the account, who connected it, since when and what it
  feeds. Someone who is not in the company's directory reads "someone not on the People list";
  when the signed-in person made the connection themselves, their own name shows. The connect
  panel advises signing in with a shared company login, so the connection does not break when one
  person leaves.
- **Monday** is a links tool. Its card opens the company's Monday board links in the panel, where
  an admin adds, edits and removes them; they keep showing in their sidebar section and on Home.
  The old "Links to outside tools" pointer on the Connections tab is gone.
- **Asking for a tool.** On a Coming next or Coming soon card an admin presses Ask for this, which
  records a row in `connector_requests` (0050) and turns the button to Requested; pressing it
  again withdraws the ask. Members of the company and Rococo can read the requests. A Rococo admin
  may ask or withdraw for a company, and the Rococo portfolio lists every company's requests under
  "Tool requests".
- **Rococo's setup line.** A Rococo admin stepped into a company sees a line under each card:
  keys in, keys missing (naming the two secrets), nothing to set up, or not built yet. Company
  admins never see secret names.
- **Until `connections` is redeployed with `/status`,** every live tool reads as available, as it
  did before the catalog, and a Rococo admin's line reads "Setup status unavailable."

What Rococo does for a sign-in tool: register the hub once per tool with the provider (a
Marketplace app, a developer app or an OAuth client, with the redirect URL under The connections
function), then add the two secrets the card names to the Supabase function secrets. Until both
are present the card reads Not available yet. JobTread is not built yet: its card reads Coming next,
and Rococo's line reads "Rococo: not built yet." Once it is built, each company pastes its own
access key, so Rococo will have nothing to set up for it. Links tools such as Monday need nothing
from Rococo today.


## The SOP library

Every company has the same SOP library; what differs is its rows (rule 12). `0053` and the app that
ships with it make it a working library rather than a list of Markdown pages.

- **The editor.** An SOP is written in a word-processor style editor with a toolbar (paragraph
  style, bold, italic, underline, strike, bulleted and numbered lists, quote, divider, link, table
  with rows and columns, undo, redo, clear formatting). A version stores the editor's document
  (`sop_versions.body_json`); a version from before `0053` keeps its Markdown (`body_md`) and opens
  converted. The schema is `src/lib/sops/schema.ts`, shared by the editor, the read-only view and
  the import, so a script, a picture or an unknown tag can never enter a document, and links are
  web, mail and phone only. Pictures and video are links (a shared drive, YouTube, Loom), never
  stored in the hub; a picture in an older Markdown version reads as a link to it.
- **Versions.** Saving appends a version and never edits one (rule 9, now held by the database too:
  a signed-in writer cannot change a saved version). Each version names who saved it, when and why.
  Any version can be read, compared line by line with the current one, and restored by an admin,
  which saves its text again as the newest version.
- **Who and when.** The database stamps who created an SOP and who last changed it, and each
  version's author (`created_by_name`, `updated_by_name`, `author_name`), by name, because an
  employee reads an SOP but not every profile (0038). Deleting a person clears their name with
  their id, as elsewhere (0049).
- **Organization.** Categories are each company's own rows (`sop_categories`): admins add, rename,
  reorder, retire and delete them on Resources > Setup, starting from five starters (Safety,
  Process, Client, Admin, Field) that become rows the first time an SOP is filed under one. The five
  fixed categories SOPs had before become each company's own rows when `0053` goes in; the old
  fixed value stays on an SOP until someone writes it, for the previous app's sake. Tags cut
  across categories (`sops.tags`, tidied by the database: trimmed, no repeats, up to 20 of 40
  characters).
- **Search.** The library searches titles, tags, summaries and the full text of the current version
  (`sops.search`, english, prefix terms), shows the line that matched, and filters by category,
  tag, status (admins), assigned to me and not signed off by me, sorted by recent change or A to Z.
  On an SOP, Find in this SOP highlights every match and steps through them.
- **Import.** Admins drop in Word (.docx), PDF, text or Markdown files, up to 50 at a time and 20
  MB each; a PDF's first 200 pages are read, and a longer one says so. Each is read in the browser, nothing is sent anywhere to be read: Word keeps headings,
  lists, tables, bold and links; a PDF is rebuilt from its lines (larger type is a heading,
  bullets and numbers are lists, running headers, footers and page numbers are dropped); the first
  heading becomes the title, or the file name. Each becomes a draft filed under one category and
  set of tags for the batch, its first version noting the file it came from, with the original
  attached so pictures and anything else are kept. A scanned PDF has no text to read and is
  reported, not imported. Old Word (.doc) files are refused with how to save them as .docx; from
  Google Docs, download as Microsoft Word.
- **Sign-off.** A member ticks "I have read this SOP and completed it" and signs off a published SOP
  for themselves. The database stamps the version, their name and the time (`sop_signoffs`), a
  record on the person: it shows on their Overview under SOPs signed off, read as every person's
  records are (0038): the person, the managers they report to up the chain, the admins over them,
  and Rococo. Nobody changes or removes one. When the SOP changes,
  an earlier sign-off reads as signed for an older version and the person may sign again.
- **Assigning.** With the `tasks` module, an admin assigns a published SOP to people from its page;
  each gets a task on it (`tasks.sop_id`) and the usual assignment email. When a task was assigned
  is `tasks.assigned_at`, stamped by the database from the clock on insert and whenever its person
  or its SOP changes. A sign-off closes every open task of theirs on that SOP assigned at or before
  it, in the database. Until then the assignee cannot close it by hand or by ticking its steps; an
  admin can. A recurring SOP task's next copy keeps the SOP and asks for a fresh sign-off, and a
  task reassigned to someone asks them for one of their own. While its SOP is unpublished to be
  revised, the task says so and waits. A task form can link any published SOP too.

### Releasing the SOP library

`0053` goes in before the app that reads it is deployed. The app selects the new columns on every
SOP read, so until `0053` is in, the library and every SOP page fail to load.

1. Paste `0053` once in the SQL editor, as `postgres`. It backfills: each company's categories
   from the fixed ones its SOPs use, every version's text and its author's name, and each SOP's
   current text, search and who created and last updated it. It is idempotent; go forwards only.
2. Check it: `select count(*) from public.sops where category is not null and category_id is null;`
   is 0, and `select count(*) from public.sops where search is null;` is 0.
3. Merge and deploy the app. Nothing in `connections` or `notify` changes, so neither is
   redeployed.

Rolling the app back after `0053` keeps working for SOPs nobody has written since: they still carry
the fixed category the previous app reads. Any SOP written or created after `0053`, by either app,
has no fixed category and drops out of the previous app's list, though its page still opens by
address. Nothing is lost; roll forward again to see it listed.

## Impact scores

The ratings under the rating pillars (Klasik: Brand Impact, Character and Values) live on the
person, not in a review. An admin sets and trues them up on the profile, where each criterion
shows the current rating, a note, and the change since the last signed-off review. An open
quarterly review reads those ratings live and read-only, with the meeting's notes beside them.
Mark complete freezes the ratings into that review in the database, so a completed review is a
dated snapshot and the next one measures against it. Reopening shows the working copy again;
completing again freezes again. A review has no score of record until it is complete.

## Where things live

The sidebar is the same for every company, in sections named for the job being done
(`src/lib/navigation.ts`). Modules add or hide whole items (marked with their key):

| Section | Admins and owners | Employees |
| --- | --- | --- |
| (top) | Home, Wins (`wins`), Tasks (`tasks`) | Home, Wins (`wins`), Tasks (`tasks`) |
| Sales & Finance | Reporting and Controls (`data_sources`), Financials, Marketing | (not visible) |
| Production | Projects (`production`) | Projects (`production`) |
| People | People, Goals, GSRs, Reviews, Scorecards | My development: My GSR, My Reviews, My Goals |
| Resources | SOPs, Files & media, Links (`external_links`) | the same |
| (bottom) | My GSR, Settings | |

Managers see People as well, as the roster alone with no tabs, beside their own My GSR, My Reviews
and My Goals.

Each section page with more than one part is a set of route tabs, so a link can land on the right
one. Setup sits on a Setup tab beside what it shapes, never in Settings:

- **Tasks** (`/tasks`): Mine, and `/tasks/everyone` for leads (named Team for a manager). A task
  has its own address at `/tasks/:id`.
- **Sales & Finance**: Reporting (`/sales-finance`) and Controls (`/sales-finance/controls`).
- **Projects** (`/production`): Projects, and `/production/setup` for admins, the standard
  milestones and letters every new project starts with. A project has its own address at
  `/production/projects/:id`.
- **People** (`/people`): the Roster; for admins, `/people/roles` the job roles as a list with one
  role open beside it (its dashboard modules, who holds it, its role goals and its scorecard
  metrics), each role at `/people/roles/:roleId`, and `/people/divisions` the company's divisions.
- **A person** (`/people/:id`): Overview at the person's own address, then `/gsr` GSR and goals,
  `/scorecard`, `/tasks` (with the `tasks` module), `/reviews`, and `/setup` for admins (their
  details and job role, hub role, divisions, compensation, and Deactivate or Remove), each one
  segment below it.
- **Goals** (`/goals`, lands on Company): `/goals/company` the year's company goals leadership
  reviews monthly; `/goals/people` each person's goals for the year and their BHAG. A line at its
  foot says where role goals (People > Roles) and focus topics (GSRs > Setup) live.
- **GSRs** (`/gsr`): Periods, and `/gsr/setup` the focus topic calendar and, for a company that
  scores its GSRs, how many goals each GSR requires.
- **Reviews** (`/reviews`): Cycles, and `/reviews/setup` pillars and weights, criteria, the Monthly
  GSRs rule and deliverable categories. A cycle opens at `/gsr/cycles/:id` or `/reviews/cycles/:id`
  and a review at `/gsr/reviews/:id` or `/reviews/:id`, under the section that owns its cadence.
- **Resources** (`/resources`, lands on SOPs): `/resources/sops`, `/resources/files`,
  `/resources/links`, and `/resources/setup` for admins (SOP categories). An SOP keeps its own
  address at `/sops/:id`; `/sops/new` writes one and `/sops/import` brings in files (admins). The
  library's filters live in its address (`?q=&cat=&tag=&status=&show=&sort=`).
- **Settings** (`/settings`, lands on the first tab the person may open): `/settings/company` name,
  logo, theme, time zone and sign-in domains, with a card at its foot linking to the setup that
  moved out; `/settings/connections` connections and data sources, each source past three at
  `/settings/connections/sources/:id`; `/settings/activity`. `/settings/connections/:companyId` is
  the OAuth return path, which lands on the Connections tab with the outcome.

Old addresses redirect: `/settings/roles` and `/goals/roles` to `/people/roles`; `/goals/focus` to
`/gsr/setup`; `/settings/reviews`, `/reviews/settings` and `/gsr/settings` to `/reviews/setup`;
`/settings/production` to `/production/setup`; `/reviews/company-goals` and `/gsr/company-goals` to
`/goals/company`; `/goals` to `/goals/company` for admins and `/my/goals` for everyone else; `/gsr`
and `/reviews` to `/my/gsr` and `/my/reviews` for anyone who is not an admin; `/my` to `/my/gsr`;
`/settings` to its first tab; `/sops` and `/resources` to `/resources/sops`.

GSRs (`/gsr`) are the monthly Goal Setting Reviews: last month at a glance, this month's
goals with their action steps and notes, the focus topic, and no pillar scores; where the company
has a Monthly GSRs pillar, the month's score shows as it builds and an admin locks it in. Reviews
(`/reviews`) are the quarterly, annual and custom cycles: the scored review with the employee
snapshot, deliverables, yearly goals and feedback. Both page headers link to Goals, and GSRs links
to review settings (Reviews > Setup). Employees see their own as My GSR, My Reviews and My Goals.

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
UI; only the why stays writable), so what a month recorded stays as recorded. Deleting a cycle
deletes its reviews and the goals filed into it, notes and all (0029); closing it is how to keep
the history.

The person works their own open month the same way, from My GSR: they add and edit goals,
steps, completion and notes, carry last month's misses forward, and write the why, so the
meeting starts from their draft. Either side moves the completion; the manager has the last word,
because only an admin marks the month complete, which is what locks it in. If nobody has started
their review for the month yet, they
start it themselves (0020 allows exactly that: their own row, in an open monthly cycle, not
started, with no feedback or sign-off). Status, feedback and sign-off stay with the manager.
Quarterly, annual, and custom cycles keep the scoring-first layout for now. The rules are in
`src/lib/gsr/goals.ts`.

## GSRs on demand

A company can run its Goal Setting Reviews on demand instead of by month: a GSR is started for a
person whenever it is needed, and marked done when the meeting is over. Which way a company works
is its own setting, `companies.gsr_mode` (`0047`): `periods`, the default, is everything above, and
`on_demand` is this. Every screen that differs reads that setting and nothing else, and a company
on periods sees exactly what it saw before. No screen and no signed-in account can change it, Rococo
admins included: a company is moved by hand in the database, with the owner's say-so (below).
Rococo, Companies shows each company's format as text, By month or On demand.

- **A GSR** is a `reviews` row with no cycle. The database stamps the company's date on it when it
  is started (`started_on`) and when it is marked done (`done_on`); the app never sends either. Its
  goals point at it through `goals.review_id`. One a person a day, and at most two open when one is
  started.
- **Who does what.** The person, anyone who leads them, the admins who manage them and Rococo start
  one. Anyone who leads the person, or an admin who manages them, marks it done (with the score from
  its own goals, where the company scores its GSRs) and reopens it. Nobody marks their own GSR done
  or reopens it, whatever their role, and the database holds that, not only the screen. The
  database records who marked it done as whoever was signed in, whatever the app sent. A done GSR's
  goals and notes are frozen until it is reopened. An admin who manages the person, or anyone who
  leads them, deletes one, open or done, and nobody deletes their own once it is done. A review in a
  cycle is still deleted by an admin alone. A person with nobody above them
  in the company and no other admin (an owner who is the only admin) has their GSRs closed by
  Rococo, and until Rococo closes one, their open ones count toward the limit of two.
- **Counting.** A GSR counts on the day it was marked done, in the company's time zone. One done with
  no score (a company that does not score its GSRs) is counted as done and adds nothing to an
  average. One still open is shown, never counted. A done GSR counts whether or not its person is
  still active, so the record does not change when someone leaves: an admin's GSRs log and Home's
  week card count every GSR in the window (and say how many are from people no longer active), the
  division comparison and the Rococo portfolio count the same way, and a manager's count stays the
  people they lead. In progress, last GSR, due and overdue always read as of today. A person's
  rhythm (`profiles.gsr_cadence`) only says when their next one is due.
- **Where a month used to be counted.** A scored review's Monthly GSRs pillar reads the person's GSRs
  done inside the review cycle's period, lists them with their dates and scores (an open one as not
  counted yet), and is their average: 100 for each one counted as the target and their scores as the
  actual, written into the review as one line item on sign-off, as before. With none done the pillar
  sits out of that review. A signed-off review keeps the number it was signed off with, whatever
  happens to a GSR afterwards. A person's Reviews tab reads the same figure, the division comparison
  counts the GSRs done in its month, and the Rococo portfolio shows the GSRs done this week and their
  average.

The window figures, the due rule and the score a scored review reads are in
`src/lib/gsr/onDemand.ts`, the one place they live.

### Releasing GSRs on demand

`0047` goes in before the app that needs it is deployed, never after. The app selects
`companies.gsr_mode` every time it loads a company, `reviews.started_on` and `reviews.done_on` with
every review, and `goals.review_id` with every goal; until `0047` adds them, those reads fail, and
the company row fails to load for every company, on periods or not.

1. Before pasting `0047`, run this in the SQL editor. It must return 0: `0047` checks every goal
   has one home as it goes in, and a monthly goal with no month stops the paste with a bare
   constraint error.

   ```sql
   select count(*) from public.goals where scope = 'cycle' and cycle_id is null;
   ```

2. Paste `0047` once, in the SQL editor. It is idempotent; go forwards only.
3. Merge and deploy the app only after that.

Keep the project's API "Max rows" setting (Supabase, Settings, API) at 1,000 or above. The GSR
reads page through a long list 1,000 rows at a time and take a short page as the end, so a lower
cap would cut a busy company's GSRs short without a word.

Rolling the app back stays a plain redeploy for every company on periods: their screens and rules
are what they were. A company that has moved over is different. The previous release expects every
review to have a cycle and every GSR goal a month, so it cannot serve that company: it would show
GSRs with no cycle in histories, fail to open them, and offer no way to start one. Rolling the app
back after a move therefore means putting that company back first (below), or accepting that its
GSR screens are down until the app comes forward again.

### Moving a company to GSRs on demand

Only once `0047` is applied and the app that reads it is live, and only with the owner's say-so,
one company at a time. After a move, rolling the app back means putting that company back first
(above).

Before the move:

1. Run `supabase/tests/fingerprint.sql` in the SQL editor and keep the result. It reads out only
   slugs, table names, counts and hashes.
2. Pick a quiet moment, when nobody at the company is working a GSR.
3. Check who closes the owner's GSRs. Nobody closes their own, so a person with nobody above them
   and no other admin in the company (often the owner) has their GSRs closed by Rococo, and their
   open ones count toward the limit of two. Agree that with the owner, or set that person's rhythm
   to None if they have no GSRs.
4. Know the one refusal the move can give: if someone at the company already has a GSR dated the
   first day of a month being converted, it stops with a plain message and changes nothing.

The move is one transaction in the SQL editor, with the company's slug in place of `<slug>` in both
places:

```sql
begin;
select set_config('hub.gsr_on_demand_for', '<slug>', true);
update public.companies set gsr_mode = 'on_demand' where slug = '<slug>';
commit;
```

The database refuses the change for any company not named in the same transaction, so a statement
that would reach two companies, or all of them, changes nothing. The same write converts the
company's past monthly GSRs: each review in one of its GSR months becomes a GSR of its own, dated
from its month, done on the day it was marked complete and never outside its month; that person's
goals in the month move onto it; and the company's GSR months and their left-out rows are removed.
Scored review cycles, their reviews and their line items are not touched. A private copy of every
row it removes or re-points is kept in `private.gsr_conversion_backup`, which no signed-in account
can read. If someone at the company already has a GSR dated the first day of a month being
converted, the move stops with a plain message and nothing is changed.

After the move:

1. Run the fingerprint again and compare: only the moved company's rows differ.
2. Confirm the company has no GSR month left (no `review_cycles` row of kind `gsr` for it).

Putting a move back is a job done by hand, and the steps are in the comment above
`private.gsr_conversion_backup` in `supabase/migrations/0047_gsr_on_demand.sql`: take the lines
between its two marker lines, drop the leading `--   `, put the company's slug in place of `rba`,
and run the result in the SQL editor as one statement. It puts each row back where it lived and
leaves anything changed since as it is now. It deletes nothing made after the move: it stops with
nothing changed, saying what it found and what to do about each, when something would be lost.
A GSR started on demand after the move must be deleted first (an admin's Delete GSR, or Rococo's
for an admin's own done one), so the put-back cannot run while any such GSR exists. A GSR the move
made that holds something put on it since is set back from its `created_gsr` row in the copy, as
the stop's message says. A person who has changed company since blocks it.

The private copy is kept until someone removes it by hand, once the owner has confirmed the move:
`delete from private.gsr_conversion_backup where company_id = (select id from public.companies where slug = '<slug>');`.
The app never reads it, and a company's copy goes with the company.

`0047` redefines what many earlier migrations define (the list is under What is applied live). If
any of them is ever pasted again, paste `0047` straight after it.

## Goals beyond the month

A person's goals outside the GSR belong to this year, next year, or their BHAG, the big goal three
to five years out, which never settles and reads open until it is hit. The goal itself (title,
description, kind, period and completion) is shared with the company's admins, who see it on the
profile, on Goals > People and on every quarterly review. Its action steps and progress notes are
the person's alone, and the database is what keeps them that way: they live in `goal_private`
and `goal_notes`, which only the owner can read for a yearly or BHAG goal (0021), and a trigger
refuses them on the shared goal row. My Goals says so in a line at the top.

## Who is in a cycle

A cycle covers everybody active on the roster, plus anyone deactivated since whose review in it
was signed off, unless an admin omits someone from it, from the cycle page, with an optional
reason (`cycle_omissions`, 0034). Someone omitted stops counting toward that cycle's progress and
team score everywhere (`cycleRoster` in `src/lib/gsr/cycles.ts`), is not asked for that month's
GSR, and sees a line saying so. A signed-off review always counts, so neither deactivating a
person nor an omission ever changes a closed cycle's counts after the fact. Omitting
deletes nothing: a review already started is set aside as it is, and comes back when they are
added back. The database refuses to open or sign off a review for someone omitted, freezes their
goals and notes in that month, and refuses to omit anyone whose review is already signed off or
to change the roster of a closed cycle. Every omission keeps who made it and when, and the
person can see their own.

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
  across a year each month is a twelfth. With no month locked in (none ran, the person was
  omitted from all of them, or none has been marked complete yet), the pillar sits out of that
  review and the other pillars carry its weight, since a GSR score is never applied before it is
  locked in; sign-off says so before it happens. A company without such a pillar sees none of
  this. The rule is in `src/lib/gsr/goals.ts`. In a company whose GSRs are on demand the pillar
  reads the GSRs done inside the period instead (see GSRs on demand).

Overall = sum(pillar score x weight) / sum(weights). An unscored pillar counts as zero, so
an incomplete review reads low, never high; the one exception is the Monthly GSRs pillar
above. The math is in `src/lib/gsr/scoring.ts` and
is fully unit tested. Klasik was seeded at Deliverables 50, Brand Impact 25 and Character &
Values 25; live it now runs Deliverables 40 (scored from the deliverables module), Brand Impact
20, Character & Values 20 and Monthly GSRs 20. RBA was brought level with Klasik's live shape on
2026-11-09 (Deliverables 40, Brand Impact 20, Character & Values 20, Monthly GSRs 20, the same
deliverable categories and job roles), without Klasik's own wording, goals, cycles or people;
`docs/rba-klasik-parity.sql` is the record.

A completed review keeps the pillars and weights it was signed off with (0022), alongside its
frozen ratings and line items, so re-weighting or adding a pillar later never moves a score of
record. Reopening a review lets them go; completing it again freezes today's. Until it is
reopened, a signed-off review is read-only in the database as well as on the page: its line
items, ratings, notes, feedback and score cannot be changed through the API, and a pillar or
criterion it holds cannot be deleted (untick Active to retire it instead). A company also runs
one cycle per cadence and period (0029).

## Financial CSV import

The Financials page accepts a spreadsheet export with one row per period. Header names
are flexible; these all work: `period` (or `period_start`, `month`, `date`), `revenue`,
`cogs` (or `cost_of_goods_sold`, `direct_costs`, `job_costs`), `opex` (or
`operating_expenses`, `overhead`), and optionally `period_type`, `net_profit`,
`cash_on_hand`, `notes`. Periods read as `2026-09`, `Sep 2026`, `9/2026`, `Q3 2026`, or
`2026`. Money may carry `$` and commas; parentheses mean negative. Re-importing the same
period overwrites it.

The import reads strictly, because a guess here is written over a real period. A filled-in
cell that does not read as money (`n/a`, `6O,000`, `5%`), a figure of a trillion or more, a
third decimal place, an impossible date (`2026-04-31`), a year outside 1900 to 2100 (`0000`),
and a `period_type` that is not a month, quarter or year (`qtr`, `yr` and `mo` are fine, a
phrase such as `Year to date` is not) or that the period contradicts (`month` beside
`Q3 2026`) are each reported by line, and that period is left out rather than saved as a zero
or a blank. A column headed just `Type` is left out like any column the import does not read
when none of its cells is about the period (a job type, say), except that a file naming one
period on two lines beside it is refused, since that column may be what tells the lines apart.
When any cell mentions a period (`Quarter-end`, `Year-end`, `Annual maintenance`) or says which
set of figures a line is (`Actual`, `Budget`, `Forecast`, `Plan`), the column is the period type and each cell that is not a month, quarter or year
is reported by line, so a quarterly figure is never filed as a month. A file
separated by semicolons or tabs, a file with two columns that read as the same thing under any
of its names (`Revenue (Actual)` beside `Revenue (Budget)`, or `Income (Actual)` beside
`Revenue (Budget)`), and a file whose quotes are out of place (one that never closes, one that
closes partway through a cell, or a quoted cell that takes in a line reading as a period the
row does not keep, whatever order the columns come in) or with a line holding more cells than
the header row are refused whole, with the reason and the line.

## Branding

Each company has a `theme_key` (`klasik`, `kingdom`, `rba`, or the default `rococo`). The
CSS for each lives in `src/index.css`; Tailwind utilities resolve to the active theme's
tokens, so the whole app restyles from one attribute on `<html>`. The login screen applies
a company's theme the moment its domain is recognized. Logos are a URL per company, set in
Settings > Company or the Rococo section.

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
- `src/pages/`: one folder per module; a page with route tabs has a `*Tabs.ts` beside it naming its
  routes (`gsr/goalsTabs.ts`, `gsr/gsrTabs.ts`, `gsr/reviewsTabs.ts`, `people/peopleTabs.ts`,
  `people/personTabs.ts`, `production/productionTabs.ts`, `settings/settingsTabs.ts` and the rest),
  and the panels those tabs hold live under `src/components/`, one folder per area.
- `src/services/`: the data layer, one module per table group; plain async functions.
- `src/lib/`: pure logic (scoring, cycle periods, CSV, formatting, theme registry).
- `src/test/`: fixtures and the mocked services the page tests render against.
- `demo/`: the demo-mode entry that runs the app on those mocks (`npm run demo`).
- `supabase/migrations/`: the schema, RLS, triggers, storage policies, and seed.
- `supabase/functions/`: the `connections` and `notify` Edge Functions and `_shared/` (provider
  keys and the pure sync modules: parse, keys, schedule, runner, tick, links, Google Sheets,
  QuickBooks).
- `supabase/tests/`: the SQL harness and one test file per migration.
- `docs/`: designs for work that is specified but not built.

## The connections function

`supabase/functions/connections` is deployed with the gateway's JWT check off, because the
provider's callback arrives with no session. Its routes, all under
`/functions/v1/connections`, and who may call each:

- `POST /start` and `POST /disconnect`: an active Owner or Admin of the company, or a Rococo
  admin, checked on their own JWT. Disconnect reports whether the tool confirmed it revoked
  access. GoHighLevel has no revoke, so its answer says access was not revoked there.
- `GET /callback`: the provider, with no JWT; the function checks its own signed state instead.
  It always answers a bare 302 back to the app with `?pending=<id>`. It does not connect
  anything: it exchanges the code, seals the result and parks it for ten minutes in
  `connection_pending`. Expired grants are swept and revoked. A grant that never became a
  connection (swept, discarded, failed at finish, or refused at the callback after the provider
  issued tokens) is revoked only when no live connection, in any company, holds the same outside
  account and both accounts are known. Google treats one client and one user as a single grant,
  and an Intuit revoke disconnects the app from the QuickBooks company, so revoking it otherwise
  would cut off the live connection. A kept grant only leaves the hub listed in that account, and
  Discard then says the tool may still list it.
- `POST /pending`, `POST /finish` and `POST /discard`: a signed-in person. The app reads a
  parked connection with `/pending`, shows which outside account is about to be attached, and the
  admin confirms with `/finish` or drops it with `/discard`. Finish and discard work only for the
  person who started the connection, who must still be an active Owner or Admin of the company, or
  the Rococo admin who started it. Anyone else who opens the link is told so and changes nothing.
- `POST /status`: which providers have their app keys, and whether `CONNECTIONS_STATE_SECRET`
  and `TOKEN_ENCRYPTION_KEY` are set (names only, never a value). An active member
  of the company of any role, or a Rococo admin, checked on their own JWT. The secret names are in
  `_shared/providerSecrets.ts`. The catalog needs it to know a card is available; without it the
  app treats every live tool as available.
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

- `TOKEN_ENCRYPTION_KEY`: 32 random bytes, base64, from `openssl rand -base64 32`. Tokens and the
  provider account id are sealed with AES-256-GCM under it before they are stored. Never share it,
  keep a copy anywhere, or put it in Vercel; it lives only here.
- `TOKEN_ENCRYPTION_KEY_PREVIOUS`: optional, only during a rotation. Move the old value here and
  put a new one in `TOKEN_ENCRYPTION_KEY`. Each saved value moves to the new key on its next
  token refresh. Leave the previous key in place until every connection has saved again under the
  new key. GoHighLevel connections never refresh, so reconnect them after a rotation, before the
  previous key is removed.
- `APP_URL`: already a project secret for `notify`. The callback uses it as its fallback return
  address.
- `CONNECTIONS_STATE_SECRET`: any long random string; signs the state that ties a callback to
  the company and admin who started it. Each state is good for one callback: `start` records its
  nonce in `connection_states` and `callback` deletes it as it redeems it, so migration 0029 has
  to be applied before this version of the function is deployed.
- `APP_ORIGINS`: comma separated origins the browser may be returned to, such as the
  production domain (`https://companyhub.rocococreative.io`) and the Vercel preview domain.
- `ALLOW_LOCALHOST_RETURN`: optional, development only. Exactly `true` lets a localhost address
  be a return address; anything else, or unset, refuses it. Never set it on the production
  project, so production only ever returns to `APP_ORIGINS`.
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
`https://<project-ref>.supabase.co/functions/v1/connections/callback`. Until both of a tool's
keys are in place, its card on Settings > Connections reads Not available yet and offers no
Connect, once the function is deployed with `/status`. Before that redeploy the card treats the
tool as available, and Connect answers with a plain "not set up yet" line. Deploy with
`supabase functions deploy connections --no-verify-jwt`.

Every response from the function is `Cache-Control: no-store`. Its imports are pinned to exact
versions (supabase-js 2.116.0), and its log lines carry ids and codes only, never a token, code,
realm id or account id. `external_account_id` on `company_connections` is cleared and blocked;
the account id lives only sealed in `connection_tokens` and is scrubbed from audit events, sync
records and sync errors (`0052`).

## The notify function

`supabase/functions/notify` sends the hub's two emails: the task assignment email and the
invitation email. A request carries exactly one of `{ task_id }` and `{ invitation_id }`; anything
else is refused with a 400.

**The task email.** The app calls
`POST /functions/v1/notify` with `{ task_id }` after a task is saved with a new assignee, and it
answers `{ sent: true }` or `{ sent: false }`. Any active, signed-in person who can see the task
may call it; the function reads the task on the caller's own JWT, so row level security decides.
It sends only when the assignee is someone other than the caller, has signed in, is active, and
has not already been emailed about this assignment. It claims the send in one update of
`tasks.notified_assignee_id`, which the browser can never write, so one assignment gets at most
one email; if Resend refuses the message, the claim is released and a later save can try again.
Saving a task never depends on the email.

**The invitation email.** The People page calls `POST /functions/v1/notify` with
`{ invitation_id }` right after Send invite creates the invitation, and again whenever an admin
presses Email again on a waiting one. The function reads the invitation on the caller's own JWT,
so row level security decides whether they may see it (404 "That invitation was not found."
otherwise). Only an owner or admin of the invitation's company, or a Rococo admin, can have it
sent; anyone else gets `{ sent: false, reason }`. So does an invitation already accepted ("They
have already signed in."), an address that is not one plain address ("That address cannot be
emailed."), and a person who is inactive ("They are inactive."). It sends at most once in 10
minutes per invitation: it claims the send in one update of `invitations.last_emailed_at` (0048),
which no signed-in writer can change, and a second press inside the pause gets "An invitation
email went to them in the last 10 minutes. Try again later." The email comes from the company's
name at `TASKS_FROM_EMAIL`, says who invited them, the address to sign in with, and links to
`{APP_URL}/?email={address}&company={slug}`, built from `APP_URL` and the invitation row only.
Pressing Email again after the pause resends. If Resend does not accept the message, the claim is
put back (only if it is still this send's) and the answer is a 502; the page keeps the
invitation, copies its link, and says the email did not go out.
Until the three secrets are set it answers "Emails are not set up yet."

It is the only place the Resend key lives. It needs these secrets (Dashboard, Edge Functions,
Secrets):

- `RESEND_API_KEY`: a Resend API key with sending access, restricted to the sending domain.
- `TASKS_FROM_EMAIL`: the sending address, `tasks@companyhub.rocococreative.io`. The sender name
  is the company's name.
- `APP_URL`: the production address, `https://companyhub.rocococreative.io`. The task link and
  the invitation link start from it and from nothing else, so an email can only ever link to the
  app.

`notify` imports its shared helpers from `_shared`, so it is deployed together with `connections`.
Its responses are `Cache-Control: no-store` and its imports are pinned like the connections
function's.

Until all three are set, the task email answers "Task emails are not set up yet." and claims
nothing. A task that is already complete is never announced, and a send that Resend does not
answer within ten seconds counts as a failed send, for either email. The invitation email needs
no new secrets, but it needs `0048` applied and the function redeployed before it goes out: apply
`0048`, then deploy `notify`, then merge the app. Deploy with the gateway's JWT check on:
`supabase functions deploy notify`.

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

9. Paste `0032_sync_schedule.sql`. It schedules `hub-sync-tick` at minute 7 of every hour
   (`7 * * * *`) with pg_cron and pg_net. Check it with `select jobname, schedule from cron.job;`
   and, after the next hour, with
   `select status, return_message from cron.job_run_details order by start_time desc limit 5;`.

**Intuit**

10. For real books, complete Intuit's production app assessment and set
    `QBO_ENVIRONMENT=production`. Before then, during the QuickBooks sandbox test, confirm how
    Intuit's revoke behaves: whether revoking one sign-in's token disconnects the app from the
    whole company, ending another live connection to the same company. The function already
    assumes it does and never revokes a parked or discarded sign-in for a company a live
    connection holds.

**In the hub**

11. A company admin connects Google Sheets and QuickBooks from Settings > Connections.
12. They add sources in Settings > Connections, Data sources: paste the sheet link with the tab open, press
    Read headers, map the fields, pick the record key, set the sync days, time and zone, and
    the stale threshold if one is agreed.
13. They press Sync now once to see the first run land.

Each source keeps its own days, time and time zone; the hourly tick works out which are due and
makes one attempt per slot. A source syncs on a set of weekdays (`sync_weekdays`, 0045), and
`sync_weekday` stays as the lowest day of the set so the function deployed before 0045 keeps
working. Staleness can count Monday to Friday hours only (`stale_business_days`), in the source's
time zone, or the company's when the source has none. The `connections` function must be
redeployed after `0045` for multi-day schedules to run; until then a source runs on its lowest day
only. It must never be deployed before `0045`: its column list names `sync_weekdays`, so against
an earlier database every Sync now fails ("The source could not be read. Try again.") and the
hourly tick, once `0032` schedules it, fails on every run. A run is all or nothing, and rows that are entirely blank
are skipped and counted. The QuickBooks reader is GET only and reads Invoice and Payment
records.

Still pending from Kingdom: the sheet links and field mappings; the sync day, time, zone and
stale threshold; and the QuickBooks fields. Until they arrive, the Sales & Finance and
Production cards read Not configured. Also pending: who each of the eight people below Eli
Cothran and Davis Nix reports to (`kingdom_intake.sql` leaves reporting lines alone), and
whether a person sees their own pay (today everyone reads their own compensation rows).

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

The Kingdom release is `0024` to `0027` and `0030` to `0033`, plus the `connections` function.
`0024` and `0025` are already applied live (2026-11-09); the rest goes in only when someone
pastes it by hand. Main's `0028` and `0029` are live too and sit between them: `0026` and `0027`
were written before those existed and are pasted after them anyway. `0034` came from a separate
change (cycle omissions) and does not depend on this release's migrations, only on `0029`; the
app on `main` reads its table, so it goes in with them, after `0033`. `0033` extends `0029`'s
`guard_profile_fields`, so it must never be pasted on a project without `0029`.

1. Back up, then paste `0026`, `0027`, `0030`, `0031`, `0033` and `0034`, in that order, in the
   SQL editor, once each. Each is idempotent; go forwards only.
2. Merge to `main` (Vercel deploys the app) only after those six are applied. The new app
   selects `companies.modules` every time it loads a company; `0024`, which adds it, is
   already live. It also reads `cycle_omissions` on every cycle screen, which `0034` adds.
3. Set the function secrets (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SYNC_CRON_SECRET`) and
   deploy: `supabase functions deploy connections --no-verify-jwt`.
4. Create the Vault entries `sync_cron_secret` and `sync_function_url`, then paste `0032`.

Steps 5 and 6 happen only once the new app (step 2) and the `connections` function (step 3) are
live.

5. Open Rococo > Companies and turn on Kingdom's modules (all five, or the ones Kingdom has
   agreed).
6. As a Rococo admin, on Kingdom's People page (or Rococo > People), set Maddie Cothran and
   marvin waters to Owner by hand. A Kingdom admin's role select does not offer Owner, and the
   old app counts only `admin` as an admin, so an owner set while it is still live loses every
   admin screen.
7. Run the reporting-line check below. It lists anyone whose Reports to crosses companies or
   runs in a loop, the same lines `0033`'s pre-check prints as notices. `0033` judges a line
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

`0033` does not depend on `0032`, so either order works; its header says the same, and step 1
pastes it first. `0032` must follow the Vault entries. No migration seeds modules or roles.

### Applying capabilities and the Kingdom roster

The order matters. The new app reads `capabilities` and `company_capabilities` whenever it loads a company and shows "Could not load your company" to everyone if either is missing, and `main` deploys to production on merge, so the tables go in first; the old app never reads them, and with no override rows both migrations change nothing. A preview build pointed at the live project fails the same way
until `0040` is pasted.

1. Paste `0040`, then `0041`, in the SQL editor. With no override rows nothing changes for any
   company.
2. Confirm the API serves the new tables: run `notify pgrst, 'reload schema';` in the SQL editor,
   or make one signed-in read of `capabilities`.
3. Only then merge to `main` and let Vercel deploy the app.
4. Confirm Kingdom's owners' live addresses first. The seed matches people by address, so it
   makes Marvin Waters an admin and Maddie Cothran an employee only if their live addresses are
   `marvin@kingdomcustomconstruction.com` and `maddie@kingdomcustomconstruction.com`. If an
   owner's real address is a different one, signing in with it makes a new employee and leaves
   the owner row unclaimed. Correct the address in the seed or on the roster before running it.
5. (On hold: Kingdom adds its own people by hand. Set the owners and roles on the People page, then
   run `supabase/seeds/kingdom_permissions.sql` for the permission levels alone.) Run `supabase/seeds/kingdom_intake.sql`, off hours. It refuses to run, and changes nothing,
   unless both `0040` and `0041` are in. It sets Kingdom's seven capability levels (`pay` and
   `company_settings` owner, `audit_log` admin, `milestones_edit`, `sync_run` and
   `production_view` manager, `wins_post` employee), adds any missing job roles, and puts the ten
   listed people on Kingdom's roster with their listed role and title. The listed role wins in
   both directions, so anyone in the list who is an owner or admin today and listed lower is
   lowered. Nobody outside the list is changed. If a listed address is on file outside Kingdom,
   it stops and changes nothing. Read the check rows before closing the editor: one per listed
   person (role before, role now, signed in), any other active Kingdom person to handle by hand,
   and the seven capability rows. Until Eli or Davis signs in, only Rococo reaches Kingdom's pay
   and company row. If the check rows do not appear, run the script again; it changes nothing the
   second time and ends with them.
6. Ask Kingdom's people to reload the app, since capabilities load once per page load.
7. Sign in as a Rococo admin, step into Kingdom, and confirm the Company tab, a person's
   compensation and the Activity tab.
8. Record `0040`, `0041` and the seed as applied in What is applied live.

### Applying Phase 2 (0042 to 0045)

Company display settings, milestone statuses and templates, and sync days. `0042` to `0045` went
in on 2026-11-19 through the Supabase connection, with the schema reloaded, so steps 1 and 2 are
done. The app is live, and the function went in on 2026-11-23 as `connections` version 6 (with
the Connections catalog). What remains is setting each company's values.

The order mattered. The new app loads the company with `wins_home_days` and `manual_financials`
at sign-in, so deployed before `0042` every user of all three companies would see "Could not
load your company"; it also reads milestone statuses, `milestone_templates` and `sync_weekdays`.
The new `connections` function names `sync_weekdays`, so it only goes in after `0045`. The
migrations are in; the app and function running today never read the new columns.

1. Done 2026-11-19: back up, then paste `0042`, `0043`, `0044` and `0045` in order, once each.
   Each is idempotent; go forwards only. On their own they change nothing visible for any company.
2. Done 2026-11-19: confirm the API serves the new columns and table (`notify pgrst, 'reload
   schema';` in the SQL editor).
3. Merge to `main` and let Vercel deploy the app. These changes reach every company by default
   with this deploy:
   - The milestone badge wording: "Open" becomes "Not started" or "In progress", and
     "Done {date}" becomes "Complete {date}".
   - The admin action on a win is "Remove" instead of "Archive": the button, the dialog title and
     the confirm label. The body reads "It leaves the Wins page and Home for everyone. It is kept
     in the record, not deleted."
   - Open and Done filter chips on a project page.
   - A Status select on each milestone for people who may edit.
   - A Settings > Production tab for companies with the production module (Projects > Setup, at
     `/production/setup`, since the hub clarity work).
   - Day checkboxes replace the single weekday select on a data source.
   - The new-win date defaults to the company's own day.
4. Redeploy the function: `supabase functions deploy connections --no-verify-jwt`. Until then a
   source runs on its lowest day only.
5. In the app, set each company's display settings on Rococo > Companies, add standard milestones
   in Projects > Setup, and set sync days and weekdays-only staleness on each source.
6. Record the app deploy and the `connections` redeploy in What is applied live (`0042` to `0045`
   are already recorded there).

### Applying the Connections catalog

The catalog reads `connector_requests`, so the order matters. The app copes with a `connections`
function that lacks `/status`, but must not ship before `0050`.

1. Apply `0050` and reload the schema (`notify pgrst, 'reload schema';`). Nothing visible changes.
2. Redeploy the function: `supabase functions deploy connections --no-verify-jwt`. This also ships
   the Phase 2 multi-day schedule code.
3. Merge and deploy the app.
4. For each sign-in tool a company should be able to connect, register the hub with the provider
   and add its two secrets (see The connections function). The Rococo setup line shows what is
   still missing.
5. Record `0050` and the redeploy in What is applied live.

Done 2026-11-23: `0050` pasted and checked live, `connections` redeployed as version 6, and the
app merged and deployed. Step 4 waits on Rococo registering each provider.

### Applying security hardening

`0051` makes Rococo admin an explicit list. A Rococo admin is now an active, flagged profile whose
email is on `rococo_admins`, equals the account email, and is confirmed. Removing someone
deactivates their profile and adding them back reactivates it; the last entry cannot be removed.
The list is managed from the Rococo Permissions page. `0052` seals tokens and the provider account
id (`connection_pending` holds a sign-in until the admin confirms it). Order matters:

1. Add `TOKEN_ENCRYPTION_KEY` in Supabase: Dashboard, Edge Functions, Secrets, add a secret named
   `TOKEN_ENCRYPTION_KEY`. Generate the value in a terminal with `openssl rand -base64 32` and
   paste it straight in. Never share it or keep a copy.
2. Before pasting `0051`, run this read-only check. It lists every active Rococo admin whose
   profile email differs from their account email, or whose email is not confirmed. Zero rows
   means it is safe to paste:
   `select p.email as profile_email, u.email as account_email, u.email_confirmed_at from public.profiles p join auth.users u on u.id = p.user_id where p.is_rococo_admin and p.is_active and (lower(p.email) <> lower(u.email) or u.email_confirmed_at is null);`
   On 2026-11-24 two equivalent read-only checks ran on the live project: a mismatch count
   returned 0, and a confirmed-email count returned 1 of 1 active Rococo admins confirmed. The
   combined query above was not itself run.
   Then paste `0051`, then `0052`, then `notify pgrst, 'reload schema';`. Check
   `select r.email, u.email_confirmed_at from public.rococo_admins r join auth.users u on lower(u.email) = r.email;`
   lists the Rococo admin with a confirmation time; without one, Rococo access stops at this step.
   Nothing visible changes.
3. Straight away, deploy both functions together: `supabase functions deploy connections
   --no-verify-jwt` and `supabase functions deploy notify`. Neither function imports the
   edge-runtime type definitions: on 2026-11-24 a pinned `npm:` `.d.ts` import deployed cleanly but
   crashed every request at runtime (the runtime loaded the types file as JavaScript), so after any
   deploy, call `/status` once and check the function logs for a boot error. Between steps 2 and 3 the
   old function cannot save a new connection (`0052` refuses plaintext tokens and account ids);
   that is safe today because no company is connected.
4. Merge and deploy the app. It must not ship before steps 2 and 3, because it calls `/pending`
   and `/finish`. `vercel.json` now sends `Cache-Control: no-store` on app pages.
5. Record `0051`, `0052` and both deploys in What is applied live, and in the Hub Feature Register
   (outside the repo; the owner updates it).

Done 2026-11-24: key added, `0051` and `0052` pasted and checked live, `connections` v9 and
`notify` v8 deployed and byte-checked, and the app merged and deployed. The two checks below are
still to do by hand.

After the deploy, check by hand:

- A response from `/settings/connections` carries `Cache-Control: no-store`.
- In the Supabase logs, the callback's request URL does not expose `code`, `state` or `realmId`.
  If it does, note the risk.

2026-11-25: `connections` v11 and `notify` v10 replaced v9 and v8, which crashed at boot on an
edge-runtime types import (see step 3). QuickBooks went live on production keys, and Klasik passed
connect, confirm, disconnect (QuickBooks accepted the revoke) and reconnect. The stored tokens and
account id read back sealed (`v1:`), with no plain id on any browser-readable row. Known and
accepted: Supabase's own request log (`function_edge_logs`) records the callback URL, including
the single-use `code` and the `realmId`, because Intuit sends both in the query string. The code
expires in minutes and is redeemed at once; the logs are readable only from the Supabase
dashboard, which stays limited to Rococo, and they expire on the plan's retention. The
`Cache-Control` check is still to do by hand.

Go forwards only. Re-pasting `0013`, `0049` or `0025` undoes parts of `0051` and `0052`, so paste
`0051` and `0052` again straight after. Re-pasting `0025` in particular restores
`external_account_id` on the audit trigger.

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
