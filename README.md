# Company Hub

One web application that serves as the operational hub for Rococo Creative's construction
clients. One app, three companies (Klasik, RBA, Kingdom), each with their own branding,
their own people, and their own way of doing things, all in a single Supabase project and
walled off from each other by row-level security.

> Working on this repo with Claude? Start with `CLAUDE.md` (the standing guardrails).

Designed but not built: the Project assistant module for Kingdom, a per-company to-do list
that orders itself by importance and location. The full specification is in
`docs/project-assistant.md`.

## What is inside

| Module | Admins | Employees |
| --- | --- | --- |
| Dashboard | State of every module at a glance | Own score, goals, recent SOPs |
| Goal Setting and Review | Configurable pillars and weights, review cycles, scoring, feedback, team scores; monthly cycles run as Goal Setting Reviews | Own reviews, scores, feedback, goals with action steps and progress |
| People | Add staff before inviting them, invite when ready, roles, deactivate; hire date, department, reports to; compensation and yearly KPIs (the person and admins only) | (not visible) |
| SOP library | Create, edit (versioned), publish, attach files | Read published documents |
| Resource library | Add links, files, templates, videos with tags | Browse and open |
| Financial snapshots | Revenue, direct costs, overhead, margins, net, cash by month, quarter, or year; manual entry or CSV import | (not visible) |
| Marketing tracker | Board of planned, active, paused, and complete campaigns with budget vs spend and the key result | (not visible) |
| Rococo portfolio | Rococo admins only: every company with its health signals, plus companies, themes, sign-in domains, and every user | |

QuickBooks sync, automated data pulls, and email notifications are the next phase.

## Quick start

```bash
npm install
cp .env.example .env    # fill in the Supabase URL and anon key (see below)
npm run dev             # http://localhost:5173
npm run lint            # ESLint: TypeScript, React hooks, Fast Refresh rules
npx vitest run          # unit and page tests, no network
npm run build           # type-check plus production build
```

With an empty `.env` the app still runs: it renders a setup notice instead of the login
gate (the nullable-client pattern in `src/services/supabase.ts`). Tests and CI rely on
this; they never touch the network.

## Demo mode (no Supabase)

`npm run demo` runs the app against an in-memory sample data set for all three companies
(the same mocks the page tests use) at http://localhost:4173. Pick who you are with the URL:
`/?persona=admin&company=klasik`, `/?persona=employee&company=kingdom`,
`/?persona=rococo` for the portfolio, or `/?signedout=1` for the sign-in screen. Nothing is written anywhere;
a reload resets the data.

## Supabase setup

1. **Create a Supabase project** (one project for all companies).
2. **Apply the migrations.** Open the SQL editor and run each file in
   `supabase/migrations/` in numeric order (`0001` through `0015`), once each, on a fresh
   project. Each file is idempotent in the sense that it can be applied to a project that
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

## How people get in

- **Company email:** the login screen recognizes the domain, switches to that company's
  theme, and sends a one-time link. The signup gate admits the address and the profile is
  placed in the company automatically.
- **Personal email:** an admin creates an invitation on the People page and sends the
  sign-in link it produces. The gate admits the invited address; on first sign-in the
  profile inherits the invitation's company, role, and title.
- **First sign-in:** the person gives their name and is in. Roles are `admin` (the whole
  hub for their company) or `employee` (own GSR data plus the libraries).
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
Connections. Connect sends the admin to the provider's own sign-in page; the provider sends
the browser back to the `connections` Edge Function, which exchanges the code for tokens,
records the connection on `company_connections` (the status row admins see: which account,
since when, last sync) and keeps the tokens in `connection_tokens`, a table with row level
security on and no policies, so only the function's service role can read it. Nothing in the
browser holds a provider secret or token, and nothing is shared between companies. Disconnect
revokes at the provider where it can and drops the tokens either way. The figures themselves
are not synced yet; `docs/integrations.md` maps where each one will come from.

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
glance, this month's goals and action steps, the focus topic, no scoring), Reviews (quarterly,
annual and custom cycles: the scored review with the employee snapshot, deliverables, yearly goals
and feedback) and Goals (the year's personal, professional and role goals across the roster).
Employees see the same three as My GSR, My Reviews and My Goals.

## Monthly Goal Setting Reviews

Every review opens with the employee snapshot: position, hire date and tenure, department,
who they report to, this year's personal KPIs (current against target, hit or not, editable
by admins in the meeting), and the company goals. A monthly cycle's review then leads with
goals, not scores. The month's focus topic is a goal seeded from the cycle theme, with its
own action steps; the manager sets the rest of the month's goals with the person, each with
action steps and a progress slider from 0 to 100, where 100 marks a goal complete. Last
month's goals read back as hit or miss with the steps that were taken and a "why" the
manager writes now, and a missed goal carries into this month in one click (only the steps
not yet taken come along, linked to the goal it came from). The person's yearly goals sit
alongside with the same slider. Closing a cycle freezes its goals (a database trigger, not
just the UI; only the why stays writable), so what a month recorded stays as recorded.
Quarterly, annual, and custom cycles keep the scoring-first layout for now. The rules are in
`src/lib/gsr/goals.ts`.

## GSR scoring

Ported from the Klasik Executive Dashboard and made configurable per company. A company
defines pillars, each with a weight and a scoring type:

- **Rated criteria:** the reviewer rates each criterion 1 to N; pillar score is the average
  divided by N.
- **Target vs actual:** the reviewer enters deliverable line items; pillar score is the
  average achievement with each item capped at 100%.

Overall = sum(pillar score x weight) / sum(weights). An unscored pillar counts as zero, so
an incomplete review reads low, never high. The math is in `src/lib/gsr/scoring.ts` and
is fully unit tested. Klasik's live configuration (Deliverables 50, Brand Impact 25,
Character & Values 25) is seeded as-is.

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
- `docs/`: designs for work that is specified but not built.

## The connections function

`supabase/functions/connections` is deployed with the gateway's JWT check off, because the
provider's callback arrives with no session; the function checks the admin's own JWT on
`start` and `disconnect` and its own signed state on `callback`. It needs these secrets
(Dashboard, Edge Functions, Secrets):

- `CONNECTIONS_STATE_SECRET`: any long random string; signs the state that ties a callback to
  the company and admin who started it.
- `APP_ORIGINS`: comma separated origins the browser may be returned to, such as the
  production domain (`https://companyhub.rocococreative.io`) and the Vercel preview domain.
  Localhost is always allowed.
- `GHL_CLIENT_ID` and `GHL_CLIENT_SECRET`: from a HighLevel Marketplace app owned by Rococo
  with the scopes `opportunities.readonly users.readonly locations.readonly`.
- `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET` and `QBO_ENVIRONMENT` (`sandbox` or `production`): from
  an Intuit developer app owned by Rococo with the `com.intuit.quickbooks.accounting` scope.

Both provider apps must list exactly one redirect URL:
`https://<project-ref>.supabase.co/functions/v1/connections/callback`. Until the keys are in
place, Connect answers with a plain "not set up yet" line and nothing else changes.

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
