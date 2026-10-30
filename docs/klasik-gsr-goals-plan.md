# Klasik GSR and Goals changes: implementation plan

October 30, 2026. Source: Justin Fara's list of eight items, walked against the code at
`6070f93` and the live Klasik data (read only, counts only).

**Status: Phases 1 and 2 are built** on `claude/sharp-meitner-7tpnez`, with migration
`0021_goal_notes_and_privacy.sql` to apply at deploy (see Rollout). **Phase 3 is built to the
recommended answers** (D1, D2, D3, D5, D6) with migration `0022_gsr_scoring.sql`, and is inert
until a company adds a Monthly GSRs pillar. Still open: D4, which is a Settings change and no code.
"If Justin answers differently" below says what each other answer changes.

## What the code says today

Read these four first. Each one changes the shape of the work.

1. **GSR progress does not feed any score.** The impact score is the rated pillars only (Brand
   Impact, Character & Values), and a monthly GSR is unscored by design (`ReviewPage.tsx`,
   `scoreProfile` in `scoring.ts`). Justin's items 2 and 5 describe how GSRs should count. That is
   a new scoring feature (Phase 3), not a fix.
2. **Pillar weights are not frozen at sign-off.** A completed review is re-scored with today's
   pillars, so adding a GSR pillar lowers every signed-off Klasik review the moment it is saved.
   Chance's Q2 review reads 42 today; with Deliverables 40, GSRs 20, Brand 20, Values 20 it would
   read 34. Phase 3 freezes the pillar set into each review at sign-off before anything else.
3. **Privacy cannot be done in the UI.** Row level security works on rows, and admins can read the
   whole goal row, steps and notes included. Private content has to leave the row (Phase 2).
4. **"Other team members" are admins today.** Employees cannot read each other's goals (RLS since
   0013). Nothing is shown to peers now.

## Justin's list, mapped

| # | Item | Change | Phase |
| --- | --- | --- | --- |
| 1 | GSR notes become a dated log | One-line field and Add on each GSR goal, dated entries, pencil to edit. Information only | 2 |
| 2 | Steps are checkpoints, the slider counts | Copy now; the slider becomes the scored input | 1 and 3 |
| 3 | "n of n steps done" beside Action steps | Move the count to the Action steps heading | 1 |
| 4 | Banner off, focus topic on the right, new button | Focus card always visible with its explanation; button sets the person's own GSR from the topic | 1 |
| 5 | Two non-personal GSRs, extras never count against, Role then Professional then Personal | Order now; required and stretch scoring in Phase 3 | 1 and 3 |
| 6 | Goal and Description placeholders | Swap the two prompts | 1 |
| 7 | Period: This year, Next year, BHAG | Three options; BHAG is a new period | 2 |
| 8 | Steps and progress notes private; say what is shared | Private content moves off the goal row; a notice on My Goals | 2 |

Phases 1 and 2 can start now. Phase 3 waits on Justin's answers to D1 to D4 below.

## Phase 1: copy and layout

No database change.

### 1.1 Goal dialog (`src/components/gsr/GoalsPanel.tsx`, GoalDialog)

- Goal field placeholder: "What is a goal you want to achieve?"
- Description field placeholder: "What does success look like?" The label stays "Description (optional)".
- Kind options: Role, Professional, Personal. "Focus topic" leaves this dialog; it is the month's
  topic and is filed from a GSR only.

### 1.2 Steps count and the slider (`GoalSettingPanel.tsx` GoalEditor, `GoalsPanel.tsx` GoalCard)

- The "2/3 steps done" text leaves the line under the title.
- The Action steps heading reads "ACTION STEPS · 2 of 3 done", with the hint "Checkpoints for
  getting there. They do not count toward the score."
- The slider gets a label, "Agreed completion", with the hint "Agreed together in the review."
  Phase 3 adds "This is what counts toward the impact score" for a company that scores GSRs.

### 1.3 Banner and focus card (`ReviewPage.tsx`, `GoalSettingPanel.tsx`)

- Monthly cycles drop the "Theme for this cycle" banner. Quarterly, annual and custom cycles keep
  it, because a scored review has no focus card to carry the theme.
- The focus card at the top of "Goals for this month" shows whenever the month has a theme: topic
  and explanation, for everyone, open or closed, whether or not a focus GSR exists yet.
- The button reads "Set your monthly GSR based on this focus topic". It opens a one-line field in
  the card ("Your GSR for Competency this month") with Add. The goal is the person's own words, kind
  Focus topic, with no copied description; the explanation stays on the card. Once a focus GSR
  exists the card names it and the button goes.
- No theme on the month: admins see "No focus topic for October 2026 yet" with a link to the month
  to set one. Employees see nothing.

### 1.4 Priority order (`src/lib/gsr/goals.ts`)

- New pure `rankGoals`: Role, then Focus topic, then Professional, then Personal; within a kind,
  the order they were added. Used by the GSR panel and the employee dashboard's GSR block,
  replacing the "focus first" sort in both.
- Shared in code, so RBA and Kingdom get the same order. CLAUDE.md Rule 12 lists what a monthly
  cycle shows as shared.

### 1.5 Tests

- `goals.test.ts`: `rankGoals`.
- `pages.test.tsx`: the focus-first test moves to the new order; the focus card shows with its
  explanation and the new button; no banner on a monthly review, banner kept on a themed quarterly;
  the steps count sits on the Action steps heading; dialog placeholders and kind list.

## Phase 2: notes log, BHAG, private yearly goals

Migration `0021_goal_notes_and_privacy.sql`, append-only and idempotent.

### 2.1 `goal_notes` (new table)

- Columns: `id`, `goal_id` (cascade with the goal), `company_id` and `employee_id` stamped from the
  goal by trigger, `author_id` (stamped with `private.auth_profile_id()` on insert, kept on
  update), `body` (not blank), `created_at`, `updated_at`. Index on `(goal_id, created_at)`.
- Read: the goal's owner, and an admin of the company only when the goal is a monthly GSR goal
  (`scope = 'cycle'`). A yearly or BHAG goal's notes are the owner's alone.
- Add: anyone who can read, as themselves.
- Edit and delete: the author. A note carried over from the old field has no author and is the
  owner's to edit.
- A closed month freezes its notes, the same rule `guard_goal_frozen` applies to goals.

### 2.2 `goal_private` (new table)

- `goal_id` (primary key, cascade), `company_id` and `employee_id` stamped from the goal,
  `action_steps` jsonb array, timestamps.
- Every operation: the owner only. Yearly and BHAG goals only; the trigger refuses a monthly goal.

### 2.3 `goals`

- `scope` accepts `'bhag'`, with `year` left null. A BHAG never settles: it reads open until it
  reaches 100.
- Guard trigger: a yearly or BHAG goal's row carries no action steps, no goal carries
  `progress_notes`, and no goal crosses between the months and the years (which side a goal is on
  decides who reads its notes). A write that tries is refused with a plain message, so private
  content can never land where an admin can read it.
- `progress_notes` stays as a column for now, emptied and unused, so a tab left open across the
  deploy does not break. A later migration drops it.

### 2.4 Backfill

Production today: 15 yearly goals, 14 of them with steps; 8 goals with notes.

- Yearly goal steps move to `goal_private`.
- Every non-empty `progress_notes` becomes the first entry in that goal's log, dated the goal's last
  update, with no author.
- Both columns are then cleared on the goal rows. The freeze trigger is switched off for that one
  statement, so a closed month is cleaned too, and switched straight back on.
- Every insert is guarded with `not exists`, so a re-run never duplicates.

### 2.5 `move_employee_company`

A person's yearly goals already travel with them. Their notes and private steps travel too.
Monthly goals and their notes stay with the company they were set in, as today. The function is
redefined from its latest version in `0018`.

### 2.6 App

- `src/types/database.ts`: `GoalScope` adds `"bhag"`; new `GoalNote` and `GoalPrivate`; period labels.
- `src/services/gsr.ts`: `listGoalNotes`, `createGoalNote`, `updateGoalNote`, `deleteGoalNote`,
  `listGoalPrivate`, `saveGoalSteps` (upsert). `normalizeGoal` keeps `'bhag'`; today it turns any
  scope that is not `'year'` into `'cycle'`.
- `src/test/mocks/gsr.ts` mirrors every new export. Fixtures gain notes and private steps so the
  demo shows the log.
- New `src/components/gsr/GoalNotes.tsx`: the log. Each entry shows the date ("Oct 27"), the
  author's first name, the text, and "edited" once changed. One-line field and Add. A pencil on your
  own entries edits in place; delete sits in edit mode behind a confirm.
- GSR panel: the Notes box becomes `GoalNotes`. Last month at a glance lists that month's notes,
  read only.
- `ReviewPage.tsx`: loads the person's notes once, with the goals, and hands them to the panel.
- Goals panel: the owner gets steps (from `goal_private`) and progress notes (`GoalNotes`). Anyone
  else gets title, description, kind, period and completion, plus one line at the top of the
  panel: "Action steps and progress notes are private to Chance."
- Period select: "This year (2026)", "Next year (2027)", "BHAG (3 to 5 years)". A goal stamped with
  any other year keeps that year as an extra option, so editing never moves it.
- My Goals: a notice under the tabs, "Shared with your manager: each goal's title, description,
  kind, period and completion. Private to you: action steps and progress notes." Header copy
  updated to match.
- Goals page (admins): the steps count goes; a BHAG section sits beside the year's goals.
- Person page: the goals panel shows yearly and BHAG goals only. Today it also lists monthly goals,
  and the new period list has no month in it, so editing one there would move it out of its month.
- Quarterly review, Yearly goals: includes BHAGs, in the summary view for admins.
- Employee dashboard: open goals include BHAGs and show completion instead of a steps count.

### 2.7 Tests

- Notes: add, edit, delete, and a closed month refusing all three.
- Privacy: an admin sees no steps or notes on someone's yearly goal and sees the privacy line; the
  owner sees both.
- Period options, BHAG filing, BHAG reading open in `goalSettled`.
- The Goals page shows no steps. Existing "Notes for" assertions move to the log.

## Phase 3: GSR completion scored

Migration `0022_gsr_scoring.sql`. Built to the recommended answers; D4 still open.

### 3.1 Schema

- `gsr_pillars.scoring_type` accepts `'gsr_goals'`, labelled "Monthly GSRs". New column
  `gsr_pillars.required_goals`, integer, default 2, read only by that type, the way
  `rating_scale_max` is read only by rating pillars.
- `reviews.pillar_snapshot` jsonb: the active pillars and weights a review was signed off with.
  Written by a BEFORE trigger when the status becomes complete and cleared on reopen; whatever a
  client sends is ignored. Backfilled for every review already complete, with today's pillars, so
  no score of record moves when Klasik re-weights.

### 3.2 Rules (pure, tested)

- `goals.ts`: `requiredAndStretch(goals, required)` picks the required GSRs (the top N
  non-personal goals in rank order) and the stretch goals (everything else). `scoreMonth` scores
  one month, and `scoreGsrMonths` returns the months a review reads with the target and actual its
  line item carries.
- `scoring.ts`: `ScoringType` adds `'gsr_goals'`, using the existing line-item arithmetic, so the
  pillar math does not change. New `pillarsForReview(review, pillars)` returns the snapshot for a
  completed review.
- Every screen that scores a completed review goes through `pillarsForReview`: `history.ts`, the
  review page, the cycle team table, the admin dashboard's team score.

### 3.3 App

- Scored review: a "Monthly GSRs" pillar section lists each month in the period with its score,
  and the period figure, live. Mark complete writes the figure as one line item, the way the
  deliverables module does, so a slider moved after sign-off changes nothing on the review. "The
  months in this period" gains each month's score.
- GSR page, for a company with a GSR pillar: each goal is badged "Counts" or "Stretch"; the header
  reads "2 of 2 required GSRs set · This month so far 88%"; fewer than required reads as a warning.
  A company without the pillar sees none of it.
- Employee dashboard and person page: this quarter's GSR figure (D6), as a line under the
  ratings (`GsrQuarterLine`).
- GSR settings: the new type in the type list, and a "Required a month" field for it, in the slot
  a rating pillar uses for its scale.

### 3.4 Configuration (company data, set in Settings)

After 0022 is live, Klasik adds the "Monthly GSRs" pillar and re-weights to Justin's numbers. RBA
and Kingdom are untouched.

### 3.5 Docs and tests

- CLAUDE.md Rules 7 and 12: the GSR rule joins the shared rules; required GSRs per month joins the
  per-company list. README: Monthly Goal Setting Reviews and GSR scoring.
- `goals.test.ts`: required and stretch selection, missing slots, caps, focus counting, hire date.
- `scoring.test.ts`, `history.test.ts`: the snapshot wins for completed reviews, live pillars for
  open ones.
- `pages.test.tsx`: the pillar section's live figure, sign-off writing the line item, badges only
  when configured, the settings field.

## Decisions

Recommended default first. D1 to D4 need Justin. The rest have safe defaults.

| # | Decision | Recommended | Alternative |
| --- | --- | --- | --- |
| D1 | How a month scores | Required two: the average agreed completion of the required GSRs; a missing one counts as 0; stretch goals never move the score | Extras add: stretch completion is added on top of the required total, capped at 100%, so a stretch goal can make up for a short required one |
| D2 | The focus-topic GSR | Counts as non-personal and ranks right after Role | Counts as Professional, or as its own kind outside the minimum |
| D3 | Who sets agreed completion once it counts | Admins only, where the company scores GSRs, enforced in the database the way impact scores are; the person preps goals, steps and notes | Both, as today; the meeting trues it up |
| D4 | The GSR pillar's weight | Justin's call. Today: Deliverables 50, Brand Impact 25, Character & Values 25. Example: 40, 20, 20, 20 | |
| D5 | Months counted | Every monthly GSR wholly inside the quarter; a month with no goals is 0; months before the hire date are skipped; an open month counts as it stands at sign-off | Settled months only |
| D6 | The live impact score card | Keeps its ratings number and gains a "Monthly GSRs, this quarter" line; the review score of record includes GSRs | Fold GSRs into the card's number, and deliverables with them so the number means one thing |
| D7 | Who "other team members" are | Admins, as today | A team view of everyone's shared goal fields, safe to add after Phase 2 |
| D8 | Description | Shared (Justin's first sentence) | Private |
| D9 | Notes rights | The author edits and deletes their own; a closed month freezes notes | Admins may also edit |
| D10 | Housekeeping | Delete the one orphaned monthly goal on Justin's profile from September 15 (its month was deleted); it disappears from every view after Phase 2 | Convert it to a 2026 goal |

### If Justin answers differently

| # | Other answer | What changes |
| --- | --- | --- |
| D1 | Extras add | `scoreMonth` in `goals.ts` adds stretch completion to the required total, capped at 100, plus its tests. Nothing else. |
| D2 | Focus counts as Professional | Nothing: it already ranks inside the working goals. As its own kind outside the minimum: one filter in `requiredAndStretch`. |
| D3 | Both, as today | Drop section 3 of 0022 (the agreed-completion guard) before it is applied, and `canAgree` in the GSR panel. Under an hour. |
| D4 | Any split | Nothing in code. Set in Settings, Pillars and weights, after 0022 is applied. |
| D5 | Settled months only | One filter in `scoreGsrMonths`. |
| D6 | Fold into the card's number | `scoreProfile` takes the live GSR and deliverables figures; the two impact cards change. Half a day. |

### D1 worked through

| Month | Required two | Extras add |
| --- | --- | --- |
| Justin's October: Role 100, Professional 75, Personal 50 | 88% | 100% |
| One non-personal GSR at 50, one personal at 40 | 25%, flagged 1 of 2 set | 45% |
| A focus GSR at 100 and a Professional at 100 | 100% if focus counts (D2), 50% if not | Same |

## Rollout

1. **Phase 1.** Deploy. No migration.
2. **Phase 2.** Apply 0021 in the SQL editor, then deploy the same hour. In between, an open tab
   shows empty notes and refuses an edit to a yearly goal's steps with a plain message; nothing is
   lost. Check live: 14 step lists and 8 notes moved, and an admin session reads no yearly steps.
3. **Phase 3.** Apply 0022 and deploy; it can go with 0021. Confirm the two completed Klasik
   reviews read the same numbers as before (their weights are backfilled as signed off), then add
   the Monthly GSRs pillar and re-weight in Settings. Nothing scores from the GSRs until that
   pillar exists, so 0022 is safe to ship before Justin answers D4.

## Verification

- Every phase: `npm run lint`, `npx vitest run`, `npm run build`. Baseline at `6070f93`: lint
  clean, 127 tests passing in 16 files. After Phases 1 and 2: lint clean, 142 tests passing,
  build clean.
- 0022 was proven the same way: a review signed off before it keeps its 50/25/25 weights through
  a re-weight and a new Monthly GSRs pillar, a client cannot rewrite the snapshot, reopening clears
  it and completing again freezes all four pillars, the new type's bounds hold, a second run
  changes nothing, and 0021's access tests still pass. The agreed-completion guard refuses the
  person's own monthly completion or status where GSRs are scored, including a goal filed already
  complete under another company's name, while titles, steps, new goals and yearly completion stay
  theirs, an admin sets it, and a company without the pillar keeps today's rule. After Phase 3:
  160 tests passing.
- 0021 was proven on a scratch PostgreSQL 16 database that replays `0001` to `0021` with
  Supabase-style stubs: the backfill moves notes and yearly steps with their dates, a second run
  changes nothing, and access tests pass as an admin (shared fields and GSR notes only), a
  teammate (nothing), and the owner (everything), including payloads that try to fake an author
  or a date, a closed month refusing notes, and every route back onto the shared row.
- `npm run demo` for a visual pass: `/?persona=admin&company=klasik` and
  `/?persona=employee&company=klasik`.
- Supabase advisors (security and performance) after each migration.

## Risks and how the plan handles them

- **History moving when pillars change.** Snapshot at sign-off, backfilled for completed reviews.
- **Private content readable through the API while the UI hides it.** Moved off the row; a trigger
  keeps it off.
- **The backfill tripping the closed-month freeze.** Trigger off for that one statement.
- **`normalizeGoal` turning a BHAG into a monthly goal.** Fixed alongside the type.
- **The person page editing a monthly goal through a year-only dialog.** Panel limited to yearly
  and BHAG goals.
- **Shared code reaching RBA and Kingdom.** The order, focus card, notes log, BHAG and privacy are
  shared by design. GSR scoring reaches only a company that adds the pillar.

## Size

- Phase 1: small. About 6 files, no schema.
- Phase 2: medium. One migration, one new component, about 12 files.
- Phase 3: medium to large. One migration, the scoring rules, about 12 files.
