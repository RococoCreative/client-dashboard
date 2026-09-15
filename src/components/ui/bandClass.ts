// Maps a score band to the theme's semantic colors, shared by the score ring, the bars, and
// the pages that print a bare score. Its own module so ScoreRing exports only the component.
// The band breaks themselves belong to scoreBand() in lib/gsr/scoring.ts and are not repeated
// here: move them there and every ring, bar and figure moves with them.
import { scoreBand, type ScoreBand } from "../../lib/gsr/scoring.ts";

const BAND_CLASS: Record<ScoreBand, string> = {
  strong: "text-success",
  solid: "text-accent",
  developing: "text-warning",
  needs_attention: "text-danger",
};

const BAND_BG: Record<ScoreBand, string> = {
  strong: "bg-success",
  solid: "bg-accent",
  developing: "bg-warning",
  needs_attention: "bg-danger",
};

export function bandClass(score: number | null): string {
  return score === null ? "text-ink-3" : BAND_CLASS[scoreBand(score)];
}

// The same bands as a fill, for the bars.
export function bandBgClass(score: number | null): string {
  return score === null ? "bg-line-strong" : BAND_BG[scoreBand(score)];
}
