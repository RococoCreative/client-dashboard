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
is the domain model), then src/lib/gsr/scoring.ts (the ported Klasik scoring engine) and src/lib/gsr/goals.ts
(the Goal Setting Review rules: progress, hit or miss, carry forward).

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
   Pages always pass `company_id` explicitly (a Rococo admin acts on a chosen company).
   Never write a feature that assumes it can see across companies unless it is Rococo-gated.
5. **Sign-in is magic link, gated server-side.** The login screen may create users
   (`shouldCreateUser: true`) only because the "Before User Created" hook in
   `0002_signup_gate.sql` admits company domains, pending invitations, and Rococo staff and
   rejects everyone else. The app-side domain lookup is UX, not security. No service-role
   key anywhere in the app or in Vercel; invitations are rows plus a link, not emails.
6. **Scoring math lives in one place.** `src/lib/gsr/scoring.ts` is pure, tested, and the
   only implementation: pillar weights, rating and deliverable scoring, the unscored-is-zero
   rule. Never duplicate it in SQL or in a component.
7. **Migrations are append-only once applied.** Numbered idempotent SQL in
   `supabase/migrations/`, applied by pasting into the Supabase SQL editor. Never edit an
   applied migration; write the next number. Keep `src/types/database.ts` in step.
8. **SOP history is immutable.** Saving an edit appends a `sop_versions` row; versions are
   never edited or renumbered. Files live in the private `hub-files` bucket under
   `{company_id}/...` and are read through signed URLs only.
9. **Copy voice.** Calm, plain, confident. No em dashes anywhere in copy. No AI model
   identifiers in code, comments, or client-facing text (standard tooling attribution
   trailers in commit messages are fine). Client-facing copy is industry neutral unless a
   company's own configuration says otherwise.
10. **File style.** Every file opens with a comment saying why it exists. Components are
    PascalCase files with `export default function Name()`; private sub-components sit
    above the default export; no barrel files. Shared primitives (`components/ui/*`) are the
    only way to style controls; `BlurInput` is the pattern for save-on-blur fields.
11. **Design execution is quiet.** Hairline borders, dense rhythm, skeleton loading, 150ms
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
