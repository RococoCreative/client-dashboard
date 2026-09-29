# Mock Q3 review for Chance Brown: findings

Walked on the live Klasik data on 2026-09-29, against the state of main at that date.

## What changed on the live data

- **Decision B applied.** Klasik's Deliverables pillar now has `scoring_type = deliverables_module`
  (weight 50, unchanged). Its score comes from the deliverables module at sign-off instead of
  typed line items. This is a row change on Klasik's own pillar, so RBA and Kingdom are untouched.
- **A Q3 2026 cycle is open.** Quarterly, October 1 to December 31, 2026, with one review in it:
  Chance Brown, not started. Nothing else was touched: no rating changed, no review completed,
  no goal moved, no task rated.
- Migration 0018 (job roles, role goals, a person's own figures) is applied. Klasik has no job
  roles yet.

## What Justin sees when he opens it

1. **Reviews, Q3 2026, Chance Brown.** The cycle starts on October 1, so the dashboards count
   it as live from that day; the cycle page and the review page work now.
2. **Ratings, read-only, from the profile.** Brand Impact 72: DNA 5, Identity 4, Mission 3,
   Company Vision 3, Culture Vision 3. Character and Values 96: Curiosity 5, Integrity 5,
   Competency 4, Tenacity 5, Community and Entrepreneurship 5. Each criterion links to the
   profile, which is the only place a rating changes.
3. **Deliverables, the module figure.** Chance carries 9 headings and 27 tasks for 2026, 11 of
   them rated, 13 points against a target of 54: 24% of target. The overall so far reads 54.
   Unrated tasks count toward the target and not the score, so rating the remaining 16 moves
   it: a Hit on every one of them lands at 45 of 54 (83%) and an overall of 84.
4. **The months in this period.** Reads "No Goal Setting Review ran inside this period" until
   October's GSR is opened.
5. **Mark complete.** Writes the module's target and actual into the review as one line item,
   freezes the ten ratings into the review, and makes Q3 the score of record. From then on the
   profile's up and down labels measure against Q3.

## Q2 as the baseline

- Q2 2026 (July 1 to September 30) was signed off on September 21 with ten ratings and no
  deliverables line item, so it reads 42 overall: Brand Impact 72, Character and Values 96,
  Deliverables blank and counted as zero. That is the unscored-is-zero rule working as designed
  on a review that predates the module. It is the number on Chance's dashboard until Q3 is
  complete. Recommendation: leave it as the honest record and let Q3 supersede it, rather than
  reopening Q2 to rewrite history.
- The impact scores on Chance's profile equal Q2's frozen ratings (that is where they were
  seeded from), so every "change since Q2 2026" label reads "no change" until an admin trues
  them up on the profile. Doing that before the Q3 meeting is the first step of the real flow.

## Findings to act on

1. **Cycle naming.** Q2 2026 covers July to September. If Klasik's year starts in April, that
   is right and Q3 is October to December, as created. If they mean calendar quarters, rename
   the cycles; the name is free text and nothing in the code depends on it.
2. **Q2 2026 is still open** with three people not started. Close it, or start their reviews.
3. **September 2026 GSR.** Chance's review is not started and the month has no goals. A Goal
   Setting Review is the month and nothing else, so it is empty until the meeting sets goals.
4. **No job roles yet.** Set them up in Settings, Job roles, and place Chance in one: his
   dashboard then carries the financial figures block if the role has it, and October's GSR
   offers the role's goals in one click.
5. **Closed sales appears twice.** Chance's KPI "Min. $2M in closed sales" and a financial
   figure would carry the same number once GoHighLevel feeds it. Keep the KPI as the hand-set
   number until then, and retire one of the two when the feed is live.
6. **Completing a review from the SQL editor is refused** by the review guard (no signed-in
   admin). That is correct; sign-off happens in the app. The freeze was verified on a scratch
   cycle when migration 0017 went live.
7. **A heading dated into 2027** ("Klasik Sales System (KS2)") carries 3 tasks that count toward
   the 2026 target. If it starts in December, file it under 2027 so this year's target is only
   this year's work.

## To remove the mock

Reviews, Q3 2026, Delete the cycle. The review goes with it. The pillar change stays; that is
decision B, not part of the mock.
