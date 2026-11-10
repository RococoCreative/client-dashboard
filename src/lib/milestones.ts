// The milestone rules the Production pages share, kept pure so they are tested in one place.
// There is no milestone status: an item is complete when it has a completed-on date (0026).
// Archived items leave the counts and the next target; letters count like milestones.
import type { ProjectMilestone } from "../types/database.ts";

export function isComplete(m: Pick<ProjectMilestone, "completed_on">): boolean {
  return m.completed_on !== null;
}

// The order a project's items are read in: sort_order, then oldest first.
export function sortMilestones(ms: ProjectMilestone[]): ProjectMilestone[] {
  return [...ms].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
}

export function nextSortOrder(ms: Pick<ProjectMilestone, "sort_order">[]): number {
  return ms.reduce((max, m) => Math.max(max, m.sort_order), 0) + 1;
}

export function milestoneCounts(ms: ProjectMilestone[]): { done: number; total: number } {
  const live = ms.filter((m) => m.archived_at === null);
  return { done: live.filter(isComplete).length, total: live.length };
}

// Date-only strings compare correctly as text.
export function nextTargetDate(ms: ProjectMilestone[]): string | null {
  let next: string | null = null;
  for (const m of ms) {
    if (m.archived_at !== null || isComplete(m) || m.target_date === null) continue;
    if (next === null || m.target_date < next) next = m.target_date;
  }
  return next;
}

// The id order after moving one item a place up or down; at an end, or for an unknown id, the
// order is unchanged.
export function moveMilestone(ms: ProjectMilestone[], id: string, direction: "up" | "down"): string[] {
  const ids = sortMilestones(ms).map((m) => m.id);
  const from = ids.indexOf(id);
  const to = direction === "up" ? from - 1 : from + 1;
  if (from === -1 || to < 0 || to >= ids.length) return ids;
  [ids[from], ids[to]] = [ids[to], ids[from]];
  return ids;
}
