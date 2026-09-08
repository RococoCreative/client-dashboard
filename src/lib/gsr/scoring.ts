// The GSR scoring engine, ported from the Klasik Executive Dashboard's computeImpactScore
// and made configurable. Pure functions, no React, no Supabase, fully unit tested.
//
// Klasik's fixed formula was: Deliverables 50% (average of actual/target per group, each
// capped at 100%), Brand 25% (average rating / 5), Values 25% (average rating / 5). Here
// every company defines its own pillars, weights, scoring type, and rating scale, and the
// arithmetic is the same:
//   pillar score  = rating pillars:       average(rating) / scale_max * 100
//                   deliverable pillars:  average(min(actual / target, 1)) * 100
//   overall       = sum(pillar score * weight) / sum(weights of active pillars)
// An unscored pillar contributes 0 (faithful to the original tool: an incomplete review
// reads low, never high); `complete` and per-pillar item counts let the UI say so.
export type ScoringType = "rating" | "deliverables";

export interface PillarConfig {
  id: string;
  name: string;
  weight: number;
  scoring_type: ScoringType;
  rating_scale_max: number;
  is_active?: boolean;
}

export interface ScoreInput {
  pillar_id: string;
  criterion_id?: string | null;
  rating?: number | null;
  target?: number | null;
  actual?: number | null;
}

interface PillarResult {
  pillarId: string;
  name: string;
  weight: number;
  scoringType: ScoringType;
  // 0..100, or null when nothing in the pillar has been scored yet.
  score: number | null;
  scoredItems: number;
  // For rating pillars: how many criteria exist (when the caller knows); for deliverable
  // pillars: the number of line items entered.
  totalItems: number;
}

export interface ReviewScoreResult {
  overall: number;
  weightTotal: number;
  pillars: PillarResult[];
  // True when every active pillar has at least one scored item.
  complete: boolean;
}

export type ScoreBand = "strong" | "solid" | "developing" | "needs_attention";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function activePillars<T extends PillarConfig>(pillars: T[]): T[] {
  return pillars.filter((p) => p.is_active !== false);
}

export function weightTotal(pillars: PillarConfig[]): number {
  return activePillars(pillars).reduce((sum, p) => sum + (isFiniteNumber(p.weight) ? p.weight : 0), 0);
}

// Score one pillar from the score rows that belong to it. Null when nothing is scored.
export function pillarScore(pillar: PillarConfig, scores: ScoreInput[]): number | null {
  const own = scores.filter((s) => s.pillar_id === pillar.id);
  if (pillar.scoring_type === "deliverables") {
    const items = own.filter((s) => isFiniteNumber(s.target) && s.target > 0 && isFiniteNumber(s.actual));
    if (items.length === 0) return null;
    const achievement =
      items.reduce((sum, s) => sum + Math.min((s.actual as number) / (s.target as number), 1), 0) /
      items.length;
    return clamp(achievement * 100, 0, 100);
  }
  const scale = isFiniteNumber(pillar.rating_scale_max) && pillar.rating_scale_max > 0 ? pillar.rating_scale_max : 5;
  const rated = own.filter((s) => isFiniteNumber(s.rating));
  if (rated.length === 0) return null;
  const average = rated.reduce((sum, s) => sum + (s.rating as number), 0) / rated.length;
  return clamp((average / scale) * 100, 0, 100);
}

export function computeReviewScore(
  pillars: PillarConfig[],
  scores: ScoreInput[],
  criteriaCount: Record<string, number> = {},
): ReviewScoreResult {
  const active = activePillars(pillars);
  const total = weightTotal(active);
  const results: PillarResult[] = active.map((pillar) => {
    const own = scores.filter((s) => s.pillar_id === pillar.id);
    const score = pillarScore(pillar, own);
    const scoredItems =
      pillar.scoring_type === "deliverables"
        ? own.filter((s) => isFiniteNumber(s.target) && s.target > 0 && isFiniteNumber(s.actual)).length
        : own.filter((s) => isFiniteNumber(s.rating)).length;
    const totalItems =
      pillar.scoring_type === "deliverables" ? own.length : (criteriaCount[pillar.id] ?? own.length);
    return {
      pillarId: pillar.id,
      name: pillar.name,
      weight: pillar.weight,
      scoringType: pillar.scoring_type,
      score,
      scoredItems,
      totalItems,
    };
  });

  const weighted = results.reduce((sum, r) => sum + (r.score ?? 0) * r.weight, 0);
  const overall = total > 0 ? Math.round(weighted / total) : 0;
  return {
    overall,
    weightTotal: total,
    pillars: results,
    complete: results.length > 0 && results.every((r) => r.score !== null),
  };
}

// Team average over reviews that have any score at all; null for an unscored team.
export function averageScore(values: Array<number | null | undefined>): number | null {
  const present = values.filter(isFiniteNumber);
  if (present.length === 0) return null;
  return Math.round(present.reduce((sum, v) => sum + v, 0) / present.length);
}

// Bands match the color breaks of the original impact ring (80 / 60 / 40).
export function scoreBand(score: number): ScoreBand {
  if (score >= 80) return "strong";
  if (score >= 60) return "solid";
  if (score >= 40) return "developing";
  return "needs_attention";
}
