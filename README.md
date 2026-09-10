# Company Hub

One web application that serves as the operational hub for Rococo Creative's construction
clients. One app, three companies (Klasik, RBA, Kingdom), each with their own branding,
their own people, and their own way of doing things, all in a single Supabase project and
walled off from each other by row-level security.

> Working on this repo with Claude? Start with `CLAUDE.md` (the standing guardrails).

## What is inside

| Module | Admins | Employees |
| --- | --- | --- |
| Dashboard | State of every module at a glance | Own score, goals, recent SOPs |
| Goal Setting and Review | Configurable pillars and weights, review cycles, scoring, feedback, team scores; monthly cycles run as Goal Setting Reviews | Own reviews, scores, feedback, goals with action steps and progress |
| People | Invite, roles, deactivate | (not visible) |
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
   `supabase/migrations/` in numeric order (`0001` through `0011`). Every file is
   idempotent and safe to re-run. `0006` seeds the three companies, their sign-in domains
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
   domain and add `http://localhost:5173/**` plus the Vercel preview wildcard.
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

## Monthly Goal Setting Reviews

A monthly cycle's review leads with goals, not scores. In the meeting the manager sets the
month's goals with the person, each with action steps and a progress slider from 0 to 100;
100 marks a goal complete. Last month's goals read back at the top as hit or miss with the
steps that were taken, and a missed goal carries into this month in one click (only the
steps not yet taken come along, linked to the goal it came from). The person's yearly goals
sit alongside with the same slider, and the review names the month's focus topics. Closing
a cycle freezes its goals (a database trigger, not just the UI), so what a month recorded
stays as recorded. Quarterly, annual, and custom cycles keep the scoring-first layout for
now. The rules are in `src/lib/gsr/goals.ts`.

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

## Deploy

Live: Vercel project `company-hub` in the Rococo Creative team, production branch `main`,
at https://company-hub-rocococreative.vercel.app. The Supabase project is "Rococo - Company
Hub" (`https://jjdcejevdqpwuastsmpq.supabase.co`); its keys live in Vercel's environment
variables and are never committed.

Vercel with framework preset Vite. `vercel.json` carries the SPA rewrite and security
headers. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for Production, Preview, and
Development. CI (`.github/workflows/ci.yml`) runs the tests and the type-checked build on
every push and pull request.
