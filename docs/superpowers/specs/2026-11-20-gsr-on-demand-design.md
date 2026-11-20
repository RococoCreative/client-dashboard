# GSRs on demand: design

This file is the agreed design for Goal Setting Reviews that stand on their own, with no cycle
behind them. It exists so the migration and the screens are built against one written record of
what the owner decided on November 20, 2026. It replaces the GSR rhythms design of November 18
(`claude/laughing-cannon-50onn9`), which stays unmerged.

## Why

The owner, after the review of the rhythms branch: "The cycles is what's broken. It's a constraint
that's unneeded. A company should be able to have a GSR daily if they want for 3 employees without
opening a daily cycle and it brings all people in. Some people don't ever have a GSR, some monthly,
some weekly. The score should just be an aggregate. If RBA has 20 GSRs in one week and 3 the next
and 50 the next day, it should just score them appropriately. The periods are what's making this
hard. Let's try this fix in RBA only before rolling it out to anyone else."

Today a GSR is a row in `reviews` that must belong to a monthly row in `review_cycles`, one per
person per cycle, and everyone active is in every cycle. Goals, notes, task links, locking, the
team table and every count on Home hang off that cycle. The rhythms branch tried to keep periods
and add more of them (weekly, every two weeks, quarterly); its review found five problems a user
would hit, and every one of them came from periods.

## What a GSR is now

One person's goal setting review, started when someone decides to hold one.

- It belongs to one person. Nobody else is in it and nothing about it depends on anyone else's.
- It is started on demand: someone clicks "New GSR". Nothing opens GSRs on a schedule.
- It stays open while the work happens. The person sets goals when it starts, progress is updated
  as they work, and at the next check-in it is marked done, which locks its score.
- Its score is for its own goals, by the rule every company shares today (`scoreMonth` in
  `src/lib/gsr/goals.ts`: completion of all its goals against 100 for each mandatory goal, the
  focus topic's goal first). The number of mandatory goals is the company's one number, the same
  for every GSR whatever the gap between them.
- It carries what a monthly GSR carries today: the opening discussion, ranked goals with action
  steps and notes, tasks linked to its goals, the role's goals offered in one click, the role
  scorecard and project notes.

Cycles stay exactly as they are for scored reviews (quarterly, yearly, custom dates).

## Decisions made with the owner

| Topic | Decision |
|---|---|
| Periods | GSRs have none. Cycles belong to quarterly and annual reviews only. |
| Starting | On demand, by a click. No schedule creates GSRs. |
| Rhythm | Optional per person: none, daily, weekly and longer. It only flags a person as due or overdue. Some people never have a GSR. |
| Life of a GSR | Open while the work happens; marked done at the next check-in (option A of the two the owner was shown). |
| Who marks it done | Anyone in it: the person, their managers, admins, owners. |
| Who reopens | Managers, admins and owners. Not the person. |
| The last GSR | A new GSR always pulls in the person's last one, whatever the gap, so the meeting goes from the last GSR to the new one. Unfinished goals carry forward in one click. |
| Closing the last one | The last GSR can be marked done from its own page or from the pulled-in module inside the new one. |
| History | A person sees all their own past GSRs, read only. |
| Scoring | An aggregate: the average of the done GSRs in whatever window is being looked at, however many there were. |
| Focus topic | A GSR reads the focus topic of the month it was started in. |
| Mandatory goals | The company's required number, the same for every GSR. |
| Left out of a cycle | Has no meaning for a GSR and disappears from GSRs. |
| The GSRs screen | A log with a window picker, a headline (done, average, in progress) and a people table (last GSR, rhythm, done, average, overdue). Approved from a text sketch. |
| Trial | RBA only first, through a setting every company carries. |
| Existing GSRs | When a company moves over, each past monthly GSR becomes a standalone GSR dated at the start of its month. |

## Goals, non-goals, anti-goals

**Goals**

- A GSR needs no cycle, for a company whose setting says so.
- Any window (this week, this month, this quarter, custom dates) gives a count and an average for
  the company, a division, a team or a person, and the same aggregate feeds a scored review's GSR
  pillar.
- The move is one setting per company, enforced by the database, off by default.
- A company with the setting off sees and does exactly what it does today.

**Non-goals**

- Scheduling GSRs, reminders, notifications, or closing them automatically. Due and overdue are
  flags on screens that already exist.
- Changing how one GSR is scored, how goals are ranked, or how many goals are mandatory.
- Changing scored reviews, ratings, pillar weights or the deliverables module.
- Moving Klasik and Kingdom over. That is a later flip of the same setting.
- Editing a GSR's dates by hand.
- Shipping the weekly, two-week and quarterly period screens from the rhythms branch.

**Anti-goals (a failure even if it works)**

- A GSR that pulls in people who are not in it, or any company-wide container behind a GSR.
- Code that asks which company it is by name, slug or theme (rule 12). The difference is the
  setting.
- Anyone seeing a person's GSR who cannot see that person's reviews today.
- A done GSR whose score moves.
- Scoring math anywhere but `src/lib/gsr` (rule 7).
- A second person's click creating a second GSR for the same person in the same moment.

## Approaches considered

1. **Each GSR is its own record (chosen).** A GSR is a `reviews` row with no cycle. Its goals
   point at it directly. Visibility is the reviews wall that exists today, so privacy needs no new
   idea. A standalone GSR can only exist in a company whose setting allows it, so the other
   companies are walled off in the database. Cost: the most database work. The functions that
   freeze goals, notes and task links by cycle each gain a branch keyed on the GSR, and a company's
   past GSRs are converted when it moves over.
2. **Hidden one-person cycles.** Every "New GSR" creates a one-person, one-day cycle nobody sees,
   and today's machinery runs unchanged on top. Fastest to build. Rejected: cycles stay underneath,
   one per GSR; every list of cycles must filter them out; "Members read cycles" would show every
   member when each one was created unless more rules are added; and rolling out to all companies
   means either living with thousands of hidden cycles or doing approach 1's work later.
3. **A new `gsrs` table.** Rejected: it duplicates what a review row already carries for a GSR
   (the opening discussion, project notes, completion, the score, the visibility rules), and the
   GSR page is built on that row.
4. **Keep periods and repair them.** What the owner ruled out.

The owner handed over the how; approach 1 is the builder's pick, stated to the owner before this
document was written. RBA's history is one closed month with two GSRs and two goals, so conversion
is small.

## Model

Everything below is added by one new migration, `0047`. Migration `0046_gsr_rhythms.sql` is
already applied in production and is never edited (rule 8).

### The setting

- `companies.gsr_mode`: `'periods'` (the default, today's behaviour) or `'on_demand'`.
- Only Rococo changes it, the way only Rococo changes modules and display settings
  (`guard_company_fields`), and the change is audited. It is edited on Rococo, Companies beside the
  other Rococo-only settings.
- In the app it is the only thing screens branch on: `company.gsr_mode`.
- It moves one way in the app: from periods to on demand. Moving back is refused once the company
  has moved, because a standalone GSR has no period to go back to. Undoing a trial is a job done by
  hand in the database. (Builder's call; cost if wrong: a reverse conversion has to be written.)

### A standalone GSR

- `reviews.cycle_id` becomes optional. A review with no cycle is a standalone GSR. A review with a
  cycle is what it is today.
- Two new dates on `reviews`, both stamped by the database in the company's own time zone, never
  sent by the app:
  - `started_on`: the company's date when the GSR was started.
  - `done_on`: the company's date when it was marked done. Empty while it is open, and cleared when
    it is reopened, the way `gsr_score` is released today.
- A standalone GSR's company comes from its person (today it comes from the cycle).
- A standalone GSR can be created only in a company whose `gsr_mode` is `'on_demand'`, whoever the
  signed-in writer is. A company on periods can never hold one.
- One per person per day: starting a GSR for someone who already has one started today lands on
  that one. This is also what makes two people clicking at once end on the same GSR: the start is
  one write that cannot produce a second row, then a read.
- At most two open per person: the newest and the one before it. This is what lets the last GSR be
  closed from inside the new one without letting open GSRs pile up. A third is refused with a
  plain message naming the one to close first.
- That limit is judged only when a GSR is started. Reopening a done GSR is always allowed, so a
  manager can put right one that was closed by mistake, and a conversion may leave a person with
  more than two open. Whatever the count, "Last GSR" is the one before the current one by start
  date, and "New GSR" on a person at or over the limit opens their newest and names the others to
  close. (Builder's call.)
- Nothing about `cycle_omissions` applies to a standalone GSR.

### Its goals

- `goals.review_id` points a GSR goal at its standalone GSR. A GSR goal belongs to a cycle (a
  company on periods) or to a GSR (a company on demand), never both and never neither.
- The scope value stays `'cycle'` in the database. Every policy that decides who reads a GSR goal
  and its notes is keyed on that value for all three companies, and renaming it buys nothing. In
  code and copy these are "GSR goals". (Builder's call.)
- The goal's person is the GSR's person, and one focus goal per GSR, as one per month today.
- Who reads and writes goals does not change: those policies are keyed on the person, not the
  cycle.

### Frozen when done

For a standalone GSR the freeze reads the GSR itself, where today it reads the cycle:

- A done GSR's goals and notes cannot change until it is reopened.
- A task links only to a goal of an open GSR, and the goal's person is the task's assignee, as
  today.
- The messages people see say "GSR", not "month": for example "This GSR is done. Reopen it to
  change its goals." `src/lib/errors.ts` shows each as a friendly line.

### Who does what

| Action | Who | Notes |
|---|---|---|
| Start a GSR for a person | The person, anyone who leads them, admins who manage them, Rococo | A blank GSR, as the open policies require today |
| Work its goals, notes, tasks | As today | Unchanged policies |
| Mark it done | The person, anyone who leads them, admins who manage them | Sets status, completion time, score, and who marked it done |
| Reopen it | Anyone who leads them, admins who manage them | Not the person |
| Delete it | Admins who manage the person, as today | Removes its goals with it |
| See it | The person and those who can see them, as today | The existing reviews wall |
| Set a person's rhythm | Admins who manage them; managers for the people they lead | Already live in 0046. Nobody below admin sets their own |

"Leads" is `private.led_person_ids()`, the whole chain below a person, as everywhere else.

The score a person locks on their own GSR is whatever their own progress entries add up to. The
database holds it to 0 to 100 and does not recompute it, because the math lives only in the app
(rule 7). The checks on it are that the page always shows the goals beside the locked score, that
the GSR records who marked it done and when, and that managers and admins can reopen.

### Rhythm

- `profiles.gsr_cadence` (live since 0046) gains `'none'` and `'daily'` beside weekly, every two
  weeks, monthly and quarterly. The default stays monthly, which is what RBA does today; an admin
  sets None for people who never have one. (Builder's call.)
- It decides nothing about who may have a GSR. It only feeds the due flag.

### What 0047 removes from 0046

0046 was written for self-opening periods. Two of its pieces have no use now and are removed:

- The policy "Members open a GSR period" on `review_cycles`. No screen uses it, and it lets any
  member add a GSR cycle to their own company.
- The trigger `reviews_guard_rhythm` and its function. A person's rhythm no longer decides whose
  GSR a cycle holds.

What stays from 0046: `review_cycles.kind`, the rule that a monthly GSR cycle is a whole calendar
month, `profiles.gsr_cadence` with its policy and guard branch, the leaders' lock and reopen branch,
and the audit of rhythm changes.

### Moving a company over

Flipping a company's `gsr_mode` to `'on_demand'` converts its past GSRs in the same write:

- Every review in one of its GSR cycles becomes a standalone GSR: `started_on` is the cycle's first
  day; status, score and completion time stay as they are.
- A review that is complete gets `done_on`: the cycle's last day, or the day it was actually
  marked complete if that came earlier. So a month locked after it ended stays in its month, a
  GSR marked done inside a month still running counts on the day it was done, and no converted GSR
  is ever dated in the future. A review that is not complete converts as an open GSR, whatever the
  state of its cycle.
- That person's goals in that cycle move to the GSR. A goal in a GSR cycle for a person with no
  review there gets an open GSR to hold it, so no goal is left without a home.
- The company's GSR cycles and their omission rows are then removed. Scored review cycles are not
  touched.
- An unfinished GSR from a closed month becomes an open GSR. An admin finishes or deletes it.
- A scored review that is already signed off keeps the GSR line item it was signed off with.

The conversion passes the freeze guards the way internal writes already do in this schema: a
transaction-local flag that only the converting function sets (`hub.task_internal` and
`hub.division_cleanup` are the existing pattern).

## Counting and scoring

All of this is pure code in `src/lib/gsr`, shared by every company and tested there.

- **What counts.** A GSR counts once it is done and has a score. An open GSR is shown, never
  counted.
- **When it counts.** On its `done_on` date. A GSR started September 29 and marked done October 2
  counts in the week, month and quarter that hold October 2. (Builder's call. A converted GSR
  counts on the last day of its month, so history stays in the month it belonged to.)
- **A window's figures.** For any date range and any set of people: how many GSRs were done in it
  and their average score. Every done GSR counts once, so a person with five done GSRs in the
  window weighs five times a person with one. A person's own average is the average of their own
  done GSRs in the window.
- **What the window does not change.** In progress, last GSR, due and overdue are always as of
  today: a GSR is in progress if it is open now, whatever window is showing. A past window answers
  "what was done then", never "what was open then", so nothing needs a history of when a GSR was
  open. (Builder's call.)
- **A scored review's GSR pillar.** For a company on demand, the pillar reads the person's GSRs
  done inside the review cycle's period. The line item is what it is today: 100 for each counted
  GSR as the target, their scores as the actual, so the pillar is their average. With none done
  the pillar sits out of the review, by the existing rule (`pillarLeftOut`). The line item is
  still written once, at sign-off.
- **A company that does not score GSRs** (no active Monthly GSRs pillar): done still freezes a GSR
  and it shows as done with no score, as a complete month does today. Counts work; averages read
  as a dash.
- **Due and overdue.** A person with a rhythm is due on the date their last GSR was started plus
  the rhythm: the next working day (Monday to Friday) for daily, 7 days, 14 days, one calendar
  month, three calendar months. With no GSR yet they are due now. "Due" on the day, "Overdue"
  after it. A person with rhythm None is never flagged.
- **Today.** Every "today" in GSR code is the company's today (`companyToday(company.time_zone)`,
  which exists in `src/lib/wins.ts`), never the browser's.

Rule 7 in `CLAUDE.md` says only an admin writes `gsr_score`; it is updated to say who marks a GSR
done in a company on demand. Rule 12's lists gain `gsr_mode` (configured per company) and the due
rule and window figures (shared in code).

## Screens, for a company on demand

A company on periods keeps every screen as it is today. The address of one GSR stays
`/gsr/reviews/:id`, and it still calls `assertInCompany()` on what it loads.

**GSRs (the sidebar item).** The log the owner approved:

```
GSRs                                    [This week v] [All divisions v]
----------------------------------------------------------------------
  23 GSRs done . Average 81 . 4 in progress
----------------------------------------------------------------------
  PEOPLE                  LAST GSR      RHYTHM     DONE   AVG
  Jamie Fox               Today         Daily        5     84
  Noor Haddad             Mon           Weekly       1     78
  Avery Cole              Oct 2         Monthly      0      -    Overdue
  Dev Rao                 Never         None         0      -
----------------------------------------------------------------------
  Each name opens that person's GSRs, newest first.
```

- The window sets Done and Average, in the headline and on every row: this week (the default),
  this month, this quarter, or custom dates. Weeks run Monday to Sunday. In progress, Last GSR and
  Overdue always read as of today.
- "New GSR" is the page's one primary action and asks for a person; each row also starts or opens
  that person's GSR.
- Admins see the people they can see. Managers get this page too, for the people they lead. Today
  it is admin only; in a company on demand managers start and close GSRs all week and need the
  list. (Builder's call.)
- The Setup tab stays for admins: focus topics and the number of mandatory goals.

**One GSR.** Today's GSR page, with:

- A title that says when it was started, and a status that reads "In progress" or "Done" with the
  date, the score, and who marked it done.
- "Mark done" as the page's primary action for anyone allowed, with today's confirm showing the
  score before it locks. "Reopen" for managers and admins.
- **Last GSR**, where "Last month at a glance" is today: the person's previous GSR by start date,
  whatever the gap. It shows its dates, its goals with their completion, its notes and its score.
  If it is still open, its goals' completion can be settled right there and it can be marked done
  from the module, by anyone who could mark it done on its own page. Unfinished goals carry forward
  into this GSR in one click, as today.
- The focus topic of the month it was started in, read from the focus topic calendar.

**New GSR.** Creates the GSR and opens it. If the person's newest GSR was started today, it opens
that one. If the person already has two open, it opens the newest and says the earlier one needs
closing, which can be done right there in Last GSR.

**My GSR.** The person's current GSR (their newest open one) or "Start a GSR", then every GSR they
have had, newest first. A done one opens read only.

**A person's page, GSR and goals tab.** The same list for that person, "New GSR", and their rhythm
as a read-first row that admins and the person's managers can change. One place for both, since
managers have no Setup tab. (Builder's call.)

**Home.**

- Employee and manager: the GSR card shows the current GSR with its progress and "Open my GSR", or
  "Start a GSR", and says when one is due.
- Manager's team block: each report's last GSR date and whether one is in progress, due or
  overdue, with a way to start or open it.
- Admin: the monthly GSR cycle card and the "GSRs complete" tile give way to one "GSRs this week"
  card with the log's headline and who is overdue, linking to GSRs. The scored review's card stays.
  "Still open" reminders for GSR months go away.

**Everywhere else a monthly GSR cycle is counted** (the division comparison, the Rococo portfolio,
the months list inside a scored review's GSR pillar): the screen shows the same figures from done
GSRs in its window instead. Inside a scored review, the pillar lists the GSRs done in the period
with their dates and scores, and any still open as not counted.

**Rococo, Companies.** The setting, with a line saying it moves the company's past GSRs and cannot
be switched back from here.

All of it follows the hub clarity rules already in force: setup reads first, one primary action a
page, 44px tap targets that never overlap, no sideways scroll from 390px, theme tokens only.

## The rhythms branch

- `claude/laughing-cannon-50onn9` is not merged and is left on the remote until the owner says to
  delete it.
- `main` must carry every applied migration, so `0046_gsr_rhythms.sql`, its SQL tests and the
  types for `kind` and `gsr_cadence` come over with this work, unchanged.
- Its code is reference only. The rhythm select and the manager's lock control are the two pieces
  worth porting.

## Rollout

1. `0047` is applied to production with the owner's say-so. Nothing changes for anyone, because
   every company is on periods. It is verified the way 0046 was: production compared with a local
   database built from the files, object by object.
2. The app ships with every company on periods. The other companies' tests pass unchanged, which is
   the proof nothing moved for them.
3. Rococo sets RBA to on demand. Its two past GSRs convert and RBA sees the new screens.
4. Later: the same flip for the others, then a cleanup that removes the period code for GSRs.

## Constraints

- Every hard rule in `CLAUDE.md`. Migrations are append-only; `src/types/database.ts`, the README
  and the two rule texts named above stay in step.
- Tests stay hermetic: every new service function has its mock (`src/test/mocks/`), and `npm run
  demo` can show a company on demand.
- SQL tests (`npm run test:sql`) cover every new policy and trigger with its denial paths, the
  conversion, and that a company on periods is refused a standalone GSR and behaves as before.
- No service-role key, no new public database function: the conversion runs inside the write that
  flips the setting.
- Copy is calm and plain, with no em dashes and no "month" where a GSR has none.

## Left to the builder

- The exact SQL: names, whether a limit is an index or a trigger, how the conversion sets its flag.
- Whether the GSR page for a company on demand stays inside `ReviewPage.tsx` or becomes its own
  page that shares its parts.
- How the log loads its window (one query for the company's GSRs in range, never one per person).
- Component and file layout, the mock layer, test structure, and exact copy within the voice
  rules.
- The order of work, as long as each step leaves companies on periods untouched and green.
