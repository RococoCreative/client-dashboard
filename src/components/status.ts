// One vocabulary for status badges across pages: which tone each status takes.
import type { BadgeTone } from "./ui/Badge.tsx";
import type { GoalOutcome } from "../lib/gsr/goals.ts";
import type { CycleStatus, GoalStatus, PreviousStatus, ReviewStatus, SopStatus } from "../types/database.ts";

export const REVIEW_STATUS_TONE: Record<ReviewStatus, BadgeTone> = {
  not_started: "neutral",
  in_progress: "info",
  complete: "success",
};

export const PREVIOUS_STATUS_TONE: Record<PreviousStatus, BadgeTone> = {
  hit: "success",
  partial: "warning",
  miss: "danger",
  pending: "neutral",
};

export const GOAL_STATUS_TONE: Record<GoalStatus, BadgeTone> = {
  not_started: "neutral",
  in_progress: "info",
  on_track: "accent",
  achieved: "success",
  missed: "danger",
};

export const GOAL_OUTCOME_TONE: Record<GoalOutcome, BadgeTone> = {
  hit: "success",
  miss: "danger",
  open: "info",
};

export const SOP_STATUS_TONE: Record<SopStatus, BadgeTone> = {
  draft: "warning",
  published: "success",
  archived: "neutral",
};

export const CYCLE_STATUS_TONE: Record<CycleStatus, BadgeTone> = {
  open: "success",
  closed: "neutral",
};
