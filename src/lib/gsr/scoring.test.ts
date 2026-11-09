import { describe, expect, it } from "vitest";
import {
  averageScore,
  computeReviewScore,
  lineItemAchievement,
  lineItemPercent,
  pillarScore,
  pillarsForReview,
  scoreBand,
  signedOffBarDetail,
  weightTotal,
  type PillarConfig,
} from "./scoring.ts";

// Klasik's live configuration, exactly as seeded by 0006_seed_companies.sql.
const KLASIK: PillarConfig[] = [
  { id: "deliv", name: "Deliverables", weight: 50, scoring_type: "deliverables", rating_scale_max: 5 },
  { id: "brand", name: "Brand Impact", weight: 25, scoring_type: "rating", rating_scale_max: 5 },
  { id: "values", name: "Character & Values", weight: 25, scoring_type: "rating", rating_scale_max: 5 },
];

describe("pillarScore", () => {
  it("averages deliverable achievement with each item capped at 100%", () => {
    const score = pillarScore(KLASIK[0], [
      { pillar_id: "deliv", target: 10, actual: 8 },
      { pillar_id: "deliv", target: 20, actual: 25 },
    ]);
    expect(score).toBeCloseTo(90);
  });

  it("ignores deliverable items with no target", () => {
    const score = pillarScore(KLASIK[0], [
      { pillar_id: "deliv", target: 0, actual: 8 },
      { pillar_id: "deliv", target: null, actual: 8 },
      { pillar_id: "deliv", target: 4, actual: 2 },
    ]);
    expect(score).toBe(50);
  });

  it("scales ratings by the pillar's scale", () => {
    expect(pillarScore(KLASIK[1], [{ pillar_id: "brand", rating: 3 }, { pillar_id: "brand", rating: 4 }])).toBe(70);
    const tenPoint: PillarConfig = { ...KLASIK[1], rating_scale_max: 10 };
    expect(pillarScore(tenPoint, [{ pillar_id: "brand", rating: 7 }])).toBe(70);
  });

  it("holds each rating to the scale, so one over-scale rating cannot hide a low one", () => {
    // Rated 8 and 2 on a 1 to 10 scale, then the pillar moved to 1 to 5: the 8 counts as a 5.
    expect(pillarScore(KLASIK[1], [{ pillar_id: "brand", rating: 8 }, { pillar_id: "brand", rating: 2 }])).toBe(70);
  });

  it("returns null when nothing is scored", () => {
    expect(pillarScore(KLASIK[1], [])).toBeNull();
    expect(pillarScore(KLASIK[1], [{ pillar_id: "brand", rating: null }])).toBeNull();
    expect(pillarScore(KLASIK[0], [{ pillar_id: "other", target: 1, actual: 1 }])).toBeNull();
  });
});

describe("computeReviewScore", () => {
  it("reproduces the Klasik impact score formula", () => {
    // Deliverables 90, Brand avg 3.6/5 = 72, Values avg 4/5 = 80
    // 90*0.5 + 72*0.25 + 80*0.25 = 45 + 18 + 20 = 83
    const result = computeReviewScore(KLASIK, [
      { pillar_id: "deliv", target: 10, actual: 8 },
      { pillar_id: "deliv", target: 20, actual: 25 },
      { pillar_id: "brand", rating: 3 },
      { pillar_id: "brand", rating: 4 },
      { pillar_id: "brand", rating: 4 },
      { pillar_id: "brand", rating: 3 },
      { pillar_id: "brand", rating: 4 },
      { pillar_id: "values", rating: 4 },
      { pillar_id: "values", rating: 4 },
    ]);
    expect(result.overall).toBe(83);
    expect(result.complete).toBe(true);
    expect(result.weightTotal).toBe(100);
  });

  it("counts an unscored pillar as zero and flags the review incomplete", () => {
    const result = computeReviewScore(KLASIK, [{ pillar_id: "brand", rating: 5 }]);
    expect(result.overall).toBe(25);
    expect(result.complete).toBe(false);
    expect(result.pillars.find((p) => p.pillarId === "deliv")?.score).toBeNull();
  });

  it("normalizes by the total weight when weights do not sum to 100", () => {
    const pillars: PillarConfig[] = [
      { id: "a", name: "A", weight: 30, scoring_type: "rating", rating_scale_max: 5 },
      { id: "b", name: "B", weight: 30, scoring_type: "rating", rating_scale_max: 5 },
    ];
    const result = computeReviewScore(pillars, [
      { pillar_id: "a", rating: 5 },
      { pillar_id: "b", rating: 2.5 },
    ]);
    expect(result.overall).toBe(75);
    expect(result.weightTotal).toBe(60);
  });

  it("skips inactive pillars entirely", () => {
    const pillars: PillarConfig[] = [
      ...KLASIK,
      { id: "old", name: "Retired", weight: 40, scoring_type: "rating", rating_scale_max: 5, is_active: false },
    ];
    const result = computeReviewScore(pillars, [{ pillar_id: "old", rating: 1 }]);
    expect(result.pillars.map((p) => p.pillarId)).toEqual(["deliv", "brand", "values"]);
    expect(weightTotal(pillars)).toBe(100);
  });

  it("reports rating progress against the known criteria count", () => {
    const result = computeReviewScore(KLASIK, [{ pillar_id: "brand", rating: 4 }], { brand: 5, values: 5 });
    const brand = result.pillars.find((p) => p.pillarId === "brand");
    expect(brand?.scoredItems).toBe(1);
    expect(brand?.totalItems).toBe(5);
  });

  it("handles a company with no pillars", () => {
    const result = computeReviewScore([], []);
    expect(result.overall).toBe(0);
    expect(result.complete).toBe(false);
  });
});

describe("averageScore and scoreBand", () => {
  it("averages present scores and rounds", () => {
    expect(averageScore([80, null, 71, undefined])).toBe(76);
    expect(averageScore([null, undefined])).toBeNull();
  });

  it("bands on the original ring thresholds", () => {
    expect(scoreBand(80)).toBe("strong");
    expect(scoreBand(79)).toBe("solid");
    expect(scoreBand(60)).toBe("solid");
    expect(scoreBand(59)).toBe("developing");
    expect(scoreBand(39)).toBe("needs_attention");
  });
});

describe("pillarsForReview", () => {
  const live: PillarConfig[] = [
    { id: "brand", name: "Brand Impact", weight: 40, scoring_type: "rating", rating_scale_max: 5 },
    { id: "gsr", name: "Monthly GSRs", weight: 60, scoring_type: "gsr_goals", rating_scale_max: 5 },
  ];
  const signedOffWith: PillarConfig[] = [{ id: "brand", name: "Brand Impact", weight: 100, scoring_type: "rating", rating_scale_max: 5 }];
  const rows = [{ pillar_id: "brand", criterion_id: "c", rating: 4 }];

  it("scores a completed review with the pillars it was signed off with, whatever changed since", () => {
    expect(pillarsForReview({ status: "complete", pillar_snapshot: signedOffWith }, live)).toBe(signedOffWith);
    expect(computeReviewScore(pillarsForReview({ status: "complete", pillar_snapshot: signedOffWith }, live), rows).overall).toBe(80);
    // Read against today's pillars, the same frozen ratings would have dropped to 32.
    expect(computeReviewScore(live, rows).overall).toBe(32);
  });

  it("reads today's pillars for an open review, and for one completed before reviews kept them", () => {
    expect(pillarsForReview({ status: "in_progress", pillar_snapshot: null }, live)).toBe(live);
    expect(pillarsForReview({ status: "complete", pillar_snapshot: null }, live)).toBe(live);
  });

  it("scores a Monthly GSRs pillar from its one line item: the months' average", () => {
    const gsrOnly: PillarConfig[] = [{ id: "gsr", name: "Monthly GSRs", weight: 100, scoring_type: "gsr_goals", rating_scale_max: 5 }];
    expect(computeReviewScore(gsrOnly, [{ pillar_id: "gsr", target: 300, actual: 255 }]).overall).toBe(85);
  });
});

describe("lineItemAchievement and lineItemPercent", () => {
  it("reads one line item the way its pillar averages it: actual over target, held at 100%", () => {
    expect(lineItemAchievement({ target: 10, actual: 8 })).toBeCloseTo(0.8);
    expect(lineItemAchievement({ target: 20, actual: 25 })).toBe(1);
    expect(lineItemPercent({ target: 10, actual: 8 })).toBe(80);
    expect(lineItemPercent({ target: 20, actual: 25 })).toBe(100);
    // Two thirds rounds the way a screen shows it.
    expect(lineItemPercent({ target: 6, actual: 4 })).toBe(67);
  });

  it("leaves an item with no target or no actual unscored", () => {
    for (const item of [{ target: 0, actual: 8 }, { target: null, actual: 8 }, { target: 10, actual: null }, {}]) {
      expect(lineItemAchievement(item)).toBeNull();
      expect(lineItemPercent(item)).toBeNull();
    }
  });

  it("agrees with the pillar score for a pillar of one line item", () => {
    const gsr: PillarConfig = { id: "gsr", name: "Monthly GSRs", weight: 20, scoring_type: "gsr_goals", rating_scale_max: 5 };
    const item = { pillar_id: "gsr", target: 300, actual: 255 };
    expect(lineItemPercent(item)).toBe(Math.round(pillarScore(gsr, [item]) as number));
  });
});

describe("signedOffBarDetail", () => {
  const gsr: PillarConfig = { id: "gsr", name: "Monthly GSRs", weight: 20, scoring_type: "gsr_goals", rating_scale_max: 5 };

  it("says zero for a Monthly GSRs pillar signed off with no month locked in, the zero it counted as", () => {
    const result = computeReviewScore([...KLASIK, gsr], [{ pillar_id: "deliv", target: 10, actual: 10 }]);
    const pillar = result.pillars.find((p) => p.pillarId === "gsr")!;
    expect(pillar.score).toBeNull();
    expect(signedOffBarDetail({ status: "complete" }, pillar)).toBe("0%, no month locked in");
  });

  it("leaves every other bar to show its own figure", () => {
    // Open: the month may still be locked in before sign-off, so nothing is final yet.
    expect(signedOffBarDetail({ status: "in_progress" }, { scoringType: "gsr_goals", score: null })).toBeUndefined();
    // Signed off with a month locked in: the bar's own percent is the truth.
    expect(signedOffBarDetail({ status: "complete" }, { scoringType: "gsr_goals", score: 80 })).toBeUndefined();
    // Another kind of pillar, or a bar drawn with no scoring type at all.
    expect(signedOffBarDetail({ status: "complete" }, { scoringType: "rating", score: null })).toBeUndefined();
    expect(signedOffBarDetail({ status: "complete" }, { score: null })).toBeUndefined();
  });
});
