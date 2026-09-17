# CLAUDE.md, Company Hub

This file is the standing guardrails. Obey them on every turn.

## What this is

Company Hub is the operational hub Rococo Creative runs for its construction clients:
one web app, one Supabase project, three companies (Klasik, RBA, Kingdom) each with its
own branding, people, and review process, walled off from each other at the database
level. Admins (owners and managers) get the whole hub for their company: Goal Setting and
Review (GSR), People, the SOP library, the resource library, financial snapshots, the
marketing tracker. Employees get their own GSR data plus the two libraries. Rococo admins
(austin@rocococreative.io and other @rocococreative.io accounts) sign in to the portfolio,
Rococo-branded, with no company active, and step into a company for the session; nothing
about the chosen company is persisted. Vite + React 19 + TypeScript, Tailwind v4, Supabase (auth, db,
storage), deployed on Vercel.

Read order for context: this file, then README.md, then supabase/migrations/ (the schema
is the domain model), then src/lib/gsr/scoring.ts (the ported Klasik scoring engine), src/lib/gsr/goals.ts
(the Goal Setting Review rules: progress, hit or miss, carry forward), and src/lib/gsr/deliverables.ts
(the two-points-a-task rule behind the deliverables module).

## Hard rules

1. **Theme tokens only.** Every color, font, radius, and shadow comes from the semantic
   tokens in the `@theme inline` block in `src/index.css`, which resolve to the `--t-*`
   variables each tenant theme sets under `[data-theme="..."]`. Never hardcode a hex in a
   component; never reference a tenant palette directly. A new tenant is a new theme block
   plus a `theme_key`, nothing else.
2. **The app must render with no backend.** `src/services/supabase.ts` exports a nullable
   client plus `isSupabaseConfigured`; missing env vars mean a setup notice, not a crash.
   This is what keeps the test suite hermetic. Never add a test or feature that needs the
   network in CI.
3. **Services throw, callers message.** Modules in `src/services/` are plain async
   functions that throw on error; pages catch and render a friendly line (`lib/errors.ts`).
   No data libraries (react-query, SWR) and no global stores beyond `HubContext`.
4. **The company wall is RLS, never UI.** Every policy resolves through the helpers in the
   `private` schema (`auth_company_id()`, `is_company_member(cid)`, `can_manage_company(cid)`),
   which PostgREST never exposes; the only public functions are the two login lookups. Child rows
   inherit `company_id` from their parent by trigger; guard triggers stop self-elevation.
   Pages always pass `company_id` explicitly (a Rococo admin acts on a chosen company) and
   query by it rather than fetching widely and filtering in the UI.
   Any page that loads a record by an id from the URL calls `assertInCompany()` on what comes
   back: a Rococo admin can read all three companies and the sidebar switcher changes company
   without navigating, so a stale id otherwise keeps another tenant's record on screen, live.
   Never write a feature that assumes it can see across companies unless it is Rococo-gated.
5. **A profile is a person, not an account.** `profiles.id` is the person and is stable
   forever; `profiles.user_id` is null until they first sign in. Never assume a profile has an
   account, and find the signed-in person with `private.auth_profile_id()`, never by comparing
   a person to `auth.uid()`. Only `handle_new_user` ever sets `user_id`, and signing in claims
   the existing profile.
   **An account is never a precondition for being set up.** A company builds its whole roster,
   its review cycles, goals, KPIs and compensation before a single person has signed in, which
   is precisely the state every new company starts in. So no feature filters people by whether
   they have an account: `hasAccount()` marks a row ("not signed in yet"), it never removes one.
   Everything attaches to `profiles.id`, so it is all waiting for them the moment they arrive.
6. **Sign-in is magic link, gated server-side.** The login screen may create users
   (`shouldCreateUser: true`) only because the "Before User Created" hook in
   `0002_signup_gate.sql` admits company domains, pending invitations, and Rococo staff and
   rejects everyone else. The app-side domain lookup is UX, not security. No service-role
   key anywhere in the app or in Vercel; invitations are rows plus a link, not emails.
7. **Scoring math lives in one place.** `src/lib/gsr/scoring.ts` is pure, tested, and the
   only implementation of review scoring: pillar weights, rating and deliverable line items, the
   unscored-is-zero rule. `src/lib/gsr/deliverables.ts` is the same deal for the deliverables
   module: two points a task, so a Hit on every task lands exactly on target. Never duplicate
   either in SQL or in a component.
   Careful with the word "deliverable": it names a `gsr_pillars.scoring_type`, where a review
   line item carries a target and an actual, and it names the standing module a person is
   measured on for the year (category, heading, tasks). They are different things.
   A person is measured on two modules that stay separate: **personal KPIs**, which are numeric
   (target, current, hit), and **deliverables**, which are a heading rated by the tasks under it.
   Neither is weighted against the other yet.
8. **Migrations are append-only once applied.** Numbered idempotent SQL in
   `supabase/migrations/`, applied by pasting into the Supabase SQL editor. Never edit an
   applied migration; write the next number. Keep `src/types/database.ts` in step.
9. **SOP history is immutable.** Saving an edit appends a `sop_versions` row; versions are
   never edited or renumbered. Files live in the private `hub-files` bucket under
   `{company_id}/...` and are read through signed URLs only.
10. **Copy voice.** Calm, plain, confident. No em dashes anywhere in copy. No AI model
   identifiers in code, comments, or client-facing text (standard tooling attribution
   trailers in commit messages are fine). Client-facing copy is industry neutral unless a
   company's own configuration says otherwise.
11. **File style.** Every file opens with a comment saying why it exists. Components are
    PascalCase files with `export default function Name()`; private sub-components sit
    above the default export; no barrel files. Shared primitives (`components/ui/*`) are the
    only way to style controls; `BlurInput` is the pattern for save-on-blur fields.
12. **A company's shape is its data, never a branch in code.** The three companies share one
    codebase and one schema; what differs between them is rows. Never branch on a company name,
    slug, or theme key to change behavior, and never let one company's setup reach another's
    screen. When a company needs a different shape, the difference becomes a column, a row, or a
    setting every company carries, with the behavior the others have today as its default.
    Configured per company already: theme, pillars, criteria and weights, cycles and cadence,
    deliverable categories, people and roles, KPIs, compensation, goals, SOPs, resources,
    financial snapshots, marketing, email domains.
    Shared in code, so a change to any of it changes all three: the deliverable rule (two points a
    task) and its four-step scale, the pillar weighting math, what a monthly cycle shows, the
    module set on a person page and a review, and `SUGGESTED_CATEGORIES`. Changing one of those
    for one company means making it configurable first, not editing the shared value.
13. **Design execution is quiet.** Hairline borders, dense rhythm, skeleton loading, 150ms
    motion, the tenant's accent as punctuation. It should feel like a command center, not a
    marketing site.

## Verification gates

Every substantive change: `npm run lint`, `npx vitest run`, and `npm run build`
(type-checked) must pass before commit. CI runs the same three gates with no network. Page tests render against the
mocked data layer in `src/test/mocks/` (one module per service, same exports); when a
service gains a function, the mock gains it too. `npm run demo` runs the app on the same
mocks for a visual check of any screen without a Supabase project.

## Deploy

Vercel (framework: vite), SPA fallback in `vercel.json`. Supabase Auth needs the production
domain as Site URL plus localhost and preview-domain redirect URLs for magic links, and the
signup hook enabled before sign-ups are turned on (see README).
