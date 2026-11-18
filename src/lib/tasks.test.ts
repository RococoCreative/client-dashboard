// Pins the task display rules: labels, step percent, done and overdue, the order a list is read in,
// the lock on a task that has spawned its next one, who may edit, a campaign's done-of-total, and
// when a save asks for the assignment email.
import { describe, expect, it } from "vitest";
import type { Task } from "../types/database.ts";
import {
  PRIORITY_LABELS,
  RECURRENCE_LABELS,
  campaignProgress,
  canDeleteTask,
  canEditTask,
  canWorkTask,
  isDone,
  isLocked,
  isOverdue,
  percentComplete,
  readingOrder,
  shouldNotifyAssignee,
  sortTasks,
} from "./tasks.ts";

type Sortable = Pick<Task, "due_date" | "priority" | "created_at"> & { id: string };
function row(id: string, overrides: Partial<Sortable> = {}): Sortable {
  return { id, due_date: null, priority: "medium", created_at: "2026-01-01T00:00:00Z", ...overrides };
}

describe("labels", () => {
  it("names every priority and recurrence", () => {
    expect(PRIORITY_LABELS).toEqual({ low: "Low", medium: "Medium", high: "High" });
    expect(RECURRENCE_LABELS).toEqual({
      daily: "Daily",
      weekly: "Weekly",
      biweekly: "Every two weeks",
      monthly: "Monthly",
      quarterly: "Quarterly",
      yearly: "Yearly",
    });
  });
});

describe("percentComplete", () => {
  it("is null with no steps", () => {
    expect(percentComplete([])).toBeNull();
  });

  it("rounds done over total to a whole number", () => {
    expect(percentComplete([{ done_at: "x" }, { done_at: null }, { done_at: null }])).toBe(33);
    expect(percentComplete([{ done_at: "x" }, { done_at: "y" }])).toBe(100);
  });
});

describe("isDone", () => {
  it("is true only with a completed_at", () => {
    expect(isDone({ completed_at: null })).toBe(false);
    expect(isDone({ completed_at: "2026-09-01T00:00:00Z" })).toBe(true);
  });
});

describe("isOverdue", () => {
  it("is true only for an open task due before today", () => {
    expect(isOverdue({ due_date: "2026-09-14", completed_at: null }, "2026-09-15")).toBe(true);
    expect(isOverdue({ due_date: "2026-09-15", completed_at: null }, "2026-09-15")).toBe(false);
    expect(isOverdue({ due_date: "2026-09-01", completed_at: "x" }, "2026-09-15")).toBe(false);
    expect(isOverdue({ due_date: null, completed_at: null }, "2026-09-15")).toBe(false);
  });
});

describe("sortTasks", () => {
  it("puts the earliest due date first", () => {
    const rows = [row("late", { due_date: "2026-10-01" }), row("early", { due_date: "2026-09-01" })];
    expect(sortTasks(rows).map((t) => t.id)).toEqual(["early", "late"]);
  });

  it("puts undated tasks last", () => {
    const rows = [row("none"), row("dated", { due_date: "2026-12-31" })];
    expect(sortTasks(rows).map((t) => t.id)).toEqual(["dated", "none"]);
  });

  it("orders high, then medium, then low on the same due date", () => {
    const d = "2026-09-20";
    const rows = [
      row("low", { due_date: d, priority: "low" }),
      row("high", { due_date: d, priority: "high" }),
      row("medium", { due_date: d, priority: "medium" }),
    ];
    expect(sortTasks(rows).map((t) => t.id)).toEqual(["high", "medium", "low"]);
  });

  it("orders undated tasks by priority too", () => {
    const rows = [row("low", { priority: "low" }), row("high", { priority: "high" })];
    expect(sortTasks(rows).map((t) => t.id)).toEqual(["high", "low"]);
  });

  it("falls back to oldest created first", () => {
    const rows = [
      row("new", { created_at: "2026-03-01T00:00:00Z" }),
      row("old", { created_at: "2026-02-01T00:00:00Z" }),
    ];
    expect(sortTasks(rows).map((t) => t.id)).toEqual(["old", "new"]);
  });

  it("does not mutate its input", () => {
    const rows = [row("b", { due_date: "2026-10-01" }), row("a", { due_date: "2026-09-01" })];
    const sorted = sortTasks(rows);
    expect(rows.map((t) => t.id)).toEqual(["b", "a"]);
    expect(sorted).not.toBe(rows);
  });
});

describe("isLocked", () => {
  it("is true once the next task exists", () => {
    expect(isLocked({ next_task_id: null })).toBe(false);
    expect(isLocked({ next_task_id: "t-2" })).toBe(true);
  });
});

describe("canEditTask", () => {
  it("lets the creator or an admin edit", () => {
    expect(canEditTask({ created_by: "a", assignee_id: "a" }, { profileId: "a", isAdmin: false })).toBe(true);
    expect(canEditTask({ created_by: "b", assignee_id: "a" }, { profileId: "a", isAdmin: false })).toBe(false);
    expect(canEditTask({ created_by: "b", assignee_id: "c" }, { profileId: "a", isAdmin: true })).toBe(true);
  });

  it("stops an employee editing a task they created once it is reassigned", () => {
    expect(canEditTask({ created_by: "a", assignee_id: "b" }, { profileId: "a", isAdmin: false })).toBe(false);
  });

  it("stops an employee editing an unassigned task", () => {
    expect(canEditTask({ created_by: "a", assignee_id: null }, { profileId: "a", isAdmin: false })).toBe(false);
  });

  it("lets a leader edit the tasks of the people they lead, whoever made them", () => {
    const manager = { profileId: "m", isAdmin: false, ledIds: new Set(["r", "k"]) };
    expect(canEditTask({ created_by: "x", assignee_id: "r" }, manager)).toBe(true);
    expect(canEditTask({ created_by: "k", assignee_id: "k" }, manager)).toBe(true);
    // An array of ids reads the same as a set.
    expect(canEditTask({ created_by: "x", assignee_id: "r" }, { ...manager, ledIds: ["r"] })).toBe(true);
  });

  it("stops a leader editing a task of someone they do not lead, or one with nobody on it", () => {
    const manager = { profileId: "m", isAdmin: false, ledIds: new Set(["r"]) };
    expect(canEditTask({ created_by: "m", assignee_id: "z" }, manager)).toBe(false);
    expect(canEditTask({ created_by: "m", assignee_id: null }, manager)).toBe(false);
    expect(canEditTask({ created_by: "x", assignee_id: "r" }, { ...manager, ledIds: [] })).toBe(false);
  });
});

describe("canWorkTask", () => {
  it("lets the assignee, an admin and the assignee's leader tick and complete", () => {
    expect(canWorkTask({ assignee_id: "a" }, { profileId: "a", isAdmin: false })).toBe(true);
    expect(canWorkTask({ assignee_id: "a" }, { profileId: "b", isAdmin: true })).toBe(true);
    expect(canWorkTask({ assignee_id: "a" }, { profileId: "m", isAdmin: false, ledIds: ["a"] })).toBe(true);
    expect(canWorkTask({ assignee_id: "a" }, { profileId: "m", isAdmin: false, ledIds: ["b"] })).toBe(false);
    expect(canWorkTask({ assignee_id: null }, { profileId: "m", isAdmin: false, ledIds: ["b"] })).toBe(false);
  });
});

describe("canDeleteTask", () => {
  it("lets an admin delete any task and anyone delete one they made for themselves", () => {
    expect(canDeleteTask({ created_by: "x", assignee_id: "y" }, { profileId: "a", isAdmin: true })).toBe(true);
    expect(canDeleteTask({ created_by: "a", assignee_id: "a" }, { profileId: "a", isAdmin: false })).toBe(true);
    expect(canDeleteTask({ created_by: "x", assignee_id: "a" }, { profileId: "a", isAdmin: false })).toBe(false);
  });

  it("lets a leader delete only the tasks they created for the people they lead", () => {
    const manager = { profileId: "m", isAdmin: false, ledIds: new Set(["r"]) };
    expect(canDeleteTask({ created_by: "m", assignee_id: "r" }, manager)).toBe(true);
    expect(canDeleteTask({ created_by: "x", assignee_id: "r" }, manager)).toBe(false);
    expect(canDeleteTask({ created_by: "m", assignee_id: "z" }, manager)).toBe(false);
  });
});

describe("readingOrder", () => {
  it("puts open tasks first in working order, then finished ones, most recently finished first", () => {
    const rows = [
      { ...row("done-early"), completed_at: "2026-09-01T00:00:00Z" },
      { ...row("open-undated"), completed_at: null },
      { ...row("done-late"), completed_at: "2026-09-10T00:00:00Z" },
      { ...row("open-dated", { due_date: "2026-09-20" }), completed_at: null },
    ];
    expect(readingOrder(rows).map((t) => t.id)).toEqual(["open-dated", "open-undated", "done-late", "done-early"]);
  });
});

describe("campaignProgress", () => {
  it("counts done of total", () => {
    expect(campaignProgress([{ completed_at: "x" }, { completed_at: null }])).toEqual({ done: 1, total: 2 });
    expect(campaignProgress([])).toEqual({ done: 0, total: 0 });
  });
});

describe("shouldNotifyAssignee", () => {
  it("asks for the email when a new task is for someone else", () => {
    expect(shouldNotifyAssignee(undefined, "b", "a")).toBe(true);
  });

  it("does not ask when a new task is for the viewer or for no one", () => {
    expect(shouldNotifyAssignee(undefined, "a", "a")).toBe(false);
    expect(shouldNotifyAssignee(undefined, null, "a")).toBe(false);
  });

  it("asks on an edit only when the assignee changed to someone else", () => {
    expect(shouldNotifyAssignee("b", "c", "a")).toBe(true);
    expect(shouldNotifyAssignee(null, "c", "a")).toBe(true);
    expect(shouldNotifyAssignee("b", "b", "a")).toBe(false);
    expect(shouldNotifyAssignee("b", "a", "a")).toBe(false);
    expect(shouldNotifyAssignee("b", null, "a")).toBe(false);
  });

  it("asks for anyone on the roster when the viewer has no profile here", () => {
    expect(shouldNotifyAssignee(undefined, "b", null)).toBe(true);
  });
});
