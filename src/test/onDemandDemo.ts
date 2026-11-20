// RBA on GSRs on demand for visual checks (npm run demo with ?gsr=on_demand, alone or beside
// ?load=dense): the company reads on demand, its monthly cycles and everything in them are gone, and
// its people carry a mix of rhythms with GSRs dated backwards from the company's today, since the
// demo runs on the real clock. Several are done this week, some are in progress, one person has two
// open, one is overdue, and one has the rhythm None. Everything here is made up. Tests never set the
// address flag, so this never runs under them.
import type { CompanyBundle } from "./fixtures.ts";
import type { Goal, GoalKind, GoalStatus, GsrCadence, Gsr, Profile } from "../types/database.ts";
import { companyToday } from "../lib/wins.ts";

function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// One sample GSR: when it began, counted back from today, and, when it is done, when it was marked
// done and its score.
interface SampleGsr {
  startedAgo: number;
  done?: { ago: number; score: number };
  inProgress?: boolean;
}

// A person's story: their rhythm and their GSRs, oldest first.
interface Story {
  cadence: GsrCadence;
  gsrs: SampleGsr[];
}

const STORIES: Story[] = [
  // Done this week, with one before it.
  { cadence: "weekly", gsrs: [{ startedAgo: 9, done: { ago: 8, score: 76 } }, { startedAgo: 2, done: { ago: 0, score: 88 } }] },
  // In progress, the last one done.
  { cadence: "weekly", gsrs: [{ startedAgo: 9, done: { ago: 7, score: 70 } }, { startedAgo: 2, inProgress: true }] },
  // Two open: the earlier one still to be marked done.
  { cadence: "biweekly", gsrs: [{ startedAgo: 15, inProgress: true }, { startedAgo: 1 }] },
  // Overdue: a weekly rhythm with the last one begun almost three weeks ago.
  { cadence: "weekly", gsrs: [{ startedAgo: 20, done: { ago: 18, score: 64 } }] },
  // Rhythm None: never has one.
  { cadence: "none", gsrs: [] },
  // Daily, done today and the next one started.
  { cadence: "daily", gsrs: [{ startedAgo: 1, done: { ago: 0, score: 95 } }, { startedAgo: 0, inProgress: true }] },
  // Monthly, done this week.
  { cadence: "monthly", gsrs: [{ startedAgo: 34, done: { ago: 31, score: 81 } }, { startedAgo: 4, done: { ago: 0, score: 92 } }] },
  // Quarterly, in progress.
  { cadence: "quarterly", gsrs: [{ startedAgo: 6, inProgress: true }] },
];

const GOALS: Array<[GoalKind, string]> = [
  ["role", "Walk every active site once a week"],
  ["professional", "Finish the estimating course"],
  ["role", "Close out the change orders by Friday"],
  ["personal", "Run a 10k with the crew"],
];

export function applyOnDemandDemo(bundle: CompanyBundle): void {
  const company = bundle.company;
  company.gsr_mode = "on_demand";
  const today = companyToday(company.time_zone);

  // The monthly cycles go, and everything held by them.
  const gone = new Set(bundle.cycles.filter((c) => c.kind === "gsr").map((c) => c.id));
  const goneReviews = new Set(bundle.reviews.filter((r) => gone.has(r.cycle_id)).map((r) => r.id));
  const goneGoals = new Set(bundle.goals.filter((g) => g.cycle_id !== null && gone.has(g.cycle_id)).map((g) => g.id));
  const keep = <T>(list: T[], stays: (x: T) => boolean) => list.splice(0, list.length, ...list.filter(stays));
  keep(bundle.cycles, (c) => !gone.has(c.id));
  keep(bundle.reviews, (r) => !goneReviews.has(r.id));
  keep(bundle.scores, (s) => !goneReviews.has(s.review_id));
  keep(bundle.reviewProjectNotes, (n) => !goneReviews.has(n.review_id));
  keep(bundle.cycleOmissions, (o) => !gone.has(o.cycle_id));
  keep(bundle.goals, (g) => !goneGoals.has(g.id));
  keep(bundle.goalNotes, (n) => !goneGoals.has(n.goal_id));

  // Whoever marks a GSR done leads the person, or is an admin; never the person.
  const people = bundle.profiles.filter((p) => p.is_active);
  const admin = people.find((p) => p.role === "owner" || p.role === "admin");
  const closer = (person: Profile) => person.reports_to ?? people.find((p) => p.id !== person.id && (p.role === "owner" || p.role === "admin" || p.role === "manager"))?.id ?? admin?.id ?? null;

  people.forEach((person, i) => {
    const story = STORIES[i % STORIES.length];
    person.gsr_cadence = story.cadence;
    story.gsrs.forEach((sample, n) => {
      const startedOn = addDays(today, -sample.startedAgo);
      const doneOn = sample.done ? addDays(today, -sample.done.ago) : null;
      const id = `${company.slug}-gsr-${i}-${n}`;
      const gsr: Gsr = {
        id,
        cycle_id: null,
        company_id: company.id,
        employee_id: person.id,
        status: doneOn ? "complete" : sample.inProgress ? "in_progress" : "not_started",
        previous_status: null,
        manager_feedback: null,
        peer_feedback: null,
        client_feedback: null,
        employee_reflection: null,
        reviewer_id: doneOn ? closer(person) : null,
        completed_at: doneOn ? `${doneOn}T16:00:00.000Z` : null,
        pillar_snapshot: null,
        gsr_score: sample.done?.score ?? null,
        support_discussion: null,
        started_on: startedOn,
        done_on: doneOn,
        created_at: `${startedOn}T12:00:00.000Z`,
        updated_at: `${doneOn ?? startedOn}T16:00:00.000Z`,
      };
      bundle.gsrs.push(gsr);

      // Two goals on each GSR that has been worked: complete on a done one, partway on an open one.
      if (gsr.status === "not_started") return;
      for (let k = 0; k < 2; k++) {
        const [kind, title] = GOALS[(i + n + k) % GOALS.length];
        const progress = doneOn ? (k === 0 ? 100 : 60) : k === 0 ? 50 : 20;
        const status: GoalStatus = progress === 100 ? "achieved" : doneOn ? "missed" : "in_progress";
        const goal: Goal = {
          id: `${id}-goal-${k}`,
          company_id: company.id,
          employee_id: person.id,
          cycle_id: null,
          review_id: id,
          kind,
          is_focus: k === 0 && kind !== "personal",
          title,
          description: null,
          status,
          action_steps: [],
          progress,
          scope: "cycle",
          year: null,
          outcome_note: null,
          carried_from_goal_id: null,
          sort_order: k,
          created_by: null,
          created_at: gsr.created_at,
          updated_at: gsr.updated_at,
        };
        bundle.goals.push(goal);
      }
    });
  });
}
