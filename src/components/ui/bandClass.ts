// Maps a score band to the theme's semantic text color, shared by the score ring and the
// pages that print a bare score. Its own module so ScoreRing exports only the component.
import { scoreBand, type ScoreBand } from "../../lib/gsr/scoring.ts";

const BAND_CLASS: Record<ScoreBand, string> = {
  strong: "text-success",
  solid: "text-accent",
  developing: "text-warning",
  needs_attention: "text-danger",
};

export function bandClass(score: number | null): string {
  return score === null ? "text-ink-3" : BAND_CLASS[scoreBand(score)];
}
