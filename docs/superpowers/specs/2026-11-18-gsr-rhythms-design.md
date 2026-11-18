# GSR rhythms: design

This file is the agreed design for running Goal Setting Reviews at a rhythm set per person. It
exists so the migration and the screens are built against one written record of what was decided.

## Why

A GSR is a goal setting review, and some people need one every week while others need one a month
or a quarter. Today the hub cannot do that:

- "Monthly" does two jobs: it is the rhythm and it is what makes a cycle a GSR (`sectionOf`, the
  employee and leader insert policies, the 0039 freeze rules, `monthsWithin`, My GSR). A weekly GSR
  cannot exist and a quarterly cycle is always read as a scored review.
- Cycles are company-wide: everyone active is in every cycle unless an admin leaves them out.
- An admin creates every cycle by hand, which does not scale past monthly.

## Decisions made with the owner

| Topic | Decision |
|---|---|
| Rhythms | Weekly, every two weeks, monthly, quarterly. Daily is not a GSR: it is a daily recurring task linked to that period's goal. |
| Whose rhythm | Each person's. Monthly by default, so nothing changes for anyone until it is set. |
| Who sets it | Owners and admins for people they manage; managers for the people they lead. |
| Who locks | A GSR period is locked (marked complete with its score) and reopened by owners, admins, and the person's managers. Ratings, scored reviews and everything else stay admin only. |
| Scoring | A scored review's GSR pillar is the average of the person's locked GSR periods wholly inside its period, whatever their length. Same math as today, so no new weights. Confirm at Friday's review. |
| Ship | Built on the branch now, deployed after Friday's review. |

## Model

- `review_cycles.kind` is `'gsr'` or `'review'`. It decides the section; cadence is only the
  rhythm. Backfill: every monthly cycle is a GSR, everything else a review.
- `review_cycles.cadence` gains `weekly` and `biweekly`. A GSR's cadence is one of weekly,
  biweekly, monthly, quarterly. A review's cadence is quarterly, annual or custom.
- The duplicate guard becomes one cycle per company, kind, cadence and period (a quarterly GSR and
  a quarterly review can share dates).
- GSR periods are canonical, so a period has exactly one row per company:
  - weekly: Monday to Sunday;
  - biweekly: two-week blocks of Mondays counted from Monday 2024-01-01;
  - monthly: the calendar month; quarterly: the calendar quarter.
  A trigger refuses a GSR cycle whose dates are not a canonical period of its cadence.
- `profiles.gsr_cadence` is weekly, biweekly, monthly or quarterly, default monthly.

## Opening a period

- A GSR period opens itself: any member may insert the GSR cycle row for a canonical period of
  their company, open, with the default name. The insert ignores a duplicate, then reads, so two
  people opening the same week never collide. Admins still create cycles by hand as today.
- A person's review in a GSR cycle may be opened (not-started shape) by the person, their leaders
  and admins, only when the cycle's cadence is the person's `gsr_cadence`. A review that already
  exists stays whatever the person's rhythm becomes later.
- The roster of a GSR cycle is the active people whose rhythm is its cadence, minus omissions, plus
  anyone with a signed-off review in it (`cycleRoster` gains the cadence rule for GSR cycles).

## Locking

- Leaders (`led_person_ids`) may update a GSR review of a person they lead, changing only
  `status`, `completed_at`, `gsr_score` and `reviewer_id`: lock and reopen. Everything 0039 guards
  (closed cycles, freeze, signed-off rules) still applies.
- Scored reviews and ratings stay admin only.

## Everywhere "monthly" meant "GSR"

Becomes `kind = 'gsr'`: the employee and leader review insert policies (0020, 0038), the freeze in
`guard_goal_frozen` and `guard_goal_note_frozen` (0039), the task link freeze, `sectionOf`,
`monthsWithin` (renamed `gsrPeriodsWithin`, filtered to the person's periods), `previousCycle` (same
kind and cadence), My GSR, the person page's GSR block, the dashboard, CyclesPage and CyclePage.
Copy says "this week", "these two weeks", "this month", "this quarter" from the rhythm.

## Focus topics

Stay monthly. A GSR period uses the focus topic of the month its start date falls in.

## Out of scope

Daily GSRs, reminders when a period is due, per-period notifications, automatic closing of past
periods (admins close as today).
