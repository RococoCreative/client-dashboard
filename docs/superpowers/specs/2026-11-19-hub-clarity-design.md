# Hub clarity: design

This file is the agreed design for reorganising the hub so each thing is set up where it is used
and no page is a wall of open forms. It exists so the plan and the build are checked against one
written record of what was decided and why.

## Intent

The hub has the right modules, but at a real company's load the screens are too much to take in.
With RBA's data (22 people, 17 job roles, 54 scorecard metrics, 35 role goals) Settings, Roles is
14.7 screens of scrolling with 529 input fields, a person page is 5.9 screens with 13 sections, and
Scorecards is 5.3 screens. Setup is also scattered: one job role is configured in three places.
The owner wants each thing presented where it is relevant, in a clear order, with a clear sense of
which item is on screen.

The owner's rule: anything that manages a person lives under People.

## Goals

- Setup lives with the module it configures. Settings holds only company-level items.
- One item on screen at a time where a page holds many alike (roles, pillars).
- Read first, edit on demand: a page shows what is set, and editing is a deliberate step.
- A person page that is a set of short tabs, not one scroll.
- Text that passes contrast, and type sizes that separate a title from a label.
- Every old address still lands somewhere sensible.

## Non-goals

No change to who can see or do what. No database change. No scoring change. No new features. The
GSR rhythm work stays on hold on its own branch.

## Anti-goals

- Weekly work moving further away. GSRs and Reviews stay one click from the sidebar.
- A layout that differs by company. All three companies get the same screens (rule 12).
- Losing a half-typed edit, or a save that looks done when it is not.
- Hiding setup so well that an admin cannot find it: every moved item leaves a signpost.

## Constraints

- Built on live (`main`), which now carries per-company capabilities (`can()` on the hub), the
  Rococo Permissions page, and the Production and Activity tabs in Settings. Every existing gate
  (`isAdmin`, `isLead`, `can(...)`, `hasModule(...)`, RLS) is kept exactly as it is: a screen that
  moves takes its gate with it.
- Theme tokens only (rule 1). New tokens are added to every theme.
- No migration. Tests stay hermetic; the demo and mocks keep working.
- Shipped in three releases to `main`, each after lint, tests, the type-checked build, and a
  screenshot pass at RBA's load.
- After each release `main` is merged into the GSR rhythm branch so Friday's release stays clean.

## Approaches

1. **Keep Settings as the one place, tidy it up.** Least movement, but it keeps the root problem:
   an admin setting up roles is nowhere near the people who hold them.
2. **One People page with seven tabs** (Roster, Roles, Divisions, Goals, GSRs, Reviews,
   Scorecards). Shortest sidebar, but weekly work becomes two clicks and one page carries too much.
3. **The People section, with setup moved into each module.** Chosen by the owner: weekly work
   stays one click away, each page stays short, and setup sits beside what it configures.

## Where everything lives

Sidebar, People group (admin view):

```
PEOPLE
  People      Roster | Roles | Divisions
  Goals       Company | People
  GSRs        Periods | Setup
  Reviews     Cycles | Setup
  Scorecards
```

| Item today | New home | Old address redirects |
|---|---|---|
| Job roles: name, description, dashboard modules, scorecard metrics (Settings, Roles) | People, Roles | `/settings/roles` to `/people/roles` |
| Role goals (Goals, By role) | People, Roles, inside each role | `/goals/roles` to `/people/roles` |
| Divisions (Settings, Roles) | People, Divisions | |
| Pillars, weights, criteria, deliverable categories (Settings, Reviews) | Reviews, Setup | `/settings/reviews` to `/reviews/setup` |
| Focus topics (Goals, Monthly focus) | GSRs, Setup | `/goals/focus` to `/gsr/setup` |
| Goals a GSR requires (a field on the Monthly GSRs pillar) | GSRs, Setup. The pillar card shows it read only with a link. | |
| Standard milestones (Settings, Production) | Projects, Setup | `/settings/production` to `/production/setup` |
| Company identity, time zone, display switches, theme and sign-in | Settings, Company | |
| Connections, data sources | Settings, Connections | |
| Activity | Settings, Activity | |

A person's role in the hub (owner, admin, manager, employee) is changed on their profile, not from
a dropdown on every roster row.

Sidebar naming: "Monthly GSRs" becomes "GSRs". Scorecards carries the People label on its page.

## Patterns (built once, used everywhere)

- **List and detail.** A list on the left (name plus two facts, searchable, the open item marked),
  the chosen item on the right with its name as a heading. Each item has its own address, so a
  link can land on one role. On a phone the list is the page and an item opens over it with a
  back link.
- **Read first.** Rows show values as text. A pencil or clicking the value turns that one row into
  its form; saving or leaving returns it to text. Fields that already save on blur keep doing so
  inside the open row.
- **One add form.** An "Add" button opens one form, instead of an add row under every card.
- **Section tabs.** A page with more than a few sections becomes route tabs, each a short page.
- **Dangerous actions** (delete, retire) sit in the item's own view, away from everyday controls.
- **Empty panels** are one quiet line, never a large block above real content.

## Type and contrast

- Scale: page title 30, section title 18, item title 15 medium, body 14, secondary 13, label 11
  uppercase. Nothing under 12 except labels.
- `ink-3` is raised in all four themes until label and help text reach 4.5 to 1 on a card.
- A `link` token is added per theme for link text, reaching 4.5 to 1 on a card. The accent stays
  as it is for buttons and marks.

## Phase 1: People, and the shared patterns

1. Tokens: the type scale, `ink-3`, `link`.
2. The list and detail and read-first primitives in `components/ui`.
3. People page tabs: Roster (today's list, role shown as text), Roles, Divisions.
4. Roles as list and detail. A role's view holds, in order: about (description, dashboard
   modules), who holds it (names linking to profiles, with a control to put someone in the role),
   role goals, scorecard metrics, and retire or delete at the foot.
5. Person page as tabs. Admins see all; a manager sees what they see today:
   - Overview: who they are, current GSR, who reports to them, open tasks, latest score.
   - GSR and goals: current GSR, this year, next year and the BHAG.
   - Scorecard: role scorecard, projects, personal KPIs, financial figures.
   - Tasks.
   - Reviews: ratings, deliverables, review history, latest scored review.
   - Setup (admins): profile details, hub role, divisions and view access, compensation where
     `can("pay")`.
6. Redirects for the moved addresses, and signposts where roles and divisions used to be.

## Phase 2: Setup in each module, and the reports

1. Reviews, Setup: pillars as collapsed rows (name, weight, type), one open at a time; deliverable
   categories below.
2. GSRs, Setup: focus topics and the required-goals rule.
3. Projects, Setup: standard milestones.
4. Settings reduced to Company, Connections, Activity.
5. Goals reduced to Company and People.
6. Scorecards as one table grouped by role, a role dropdown in place of chips, roles with nobody
   in them left out.
7. Home by audience. Employee: the GSR first with a primary button, then tasks and goals. Manager:
   a team block (each direct report with GSR status and open and overdue tasks) above their own.
   Admin: attention items and open cycles first. An empty links panel is one line.
8. My GSR gets a page title. Its GSR, Reviews, Goals tabs show only for people whose sidebar does
   not already list those three.

## Phase 3: Sweep and phone

1. Apply the patterns to every remaining page: the review page, cycle page, Connections and data
   sources, Marketing, Financials, Projects, Wins, Tasks, SOPs, Files, Links, and the Rococo pages.
2. A failed save shows "Not saved" as text beside the field, not only as a red outline.
3. Phone pass at 390px on every page: no sideways scroll, list and detail collapses, tabs scroll,
   targets at least 44px.

## How we know it worked

Measured at RBA's load on a 1440 by 900 screen:

- No setup page longer than 3 screens. Roles, Reviews setup and a person tab each under 2.
- Every repeated item shows its name as a heading and is reachable by its own address.
- Label, help and link text at 4.5 to 1 or better in all four themes.
- Every old address redirects. No permission, RLS or scoring test changes meaning.

## Left to the builder

Exact component names and file layout, the copy of signposts and empty states (calm, plain, no
em dashes), animation within the 150ms rule, and how each remaining Phase 3 page applies the
patterns, provided the measures above hold.
