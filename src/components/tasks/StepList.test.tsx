// Pins a step rename to the inline save contract: a rename the database refuses is marked not
// saved and keeps what was typed, and one that lands reads as saved. The tasks service is stubbed;
// nothing reaches a database.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { TaskWithSteps } from "../../types/database.ts";

const svc = vi.hoisted(() => ({
  addStep: vi.fn(),
  moveStep: vi.fn(),
  removeStep: vi.fn(),
  renameStep: vi.fn(),
  setStepDone: vi.fn(),
}));
vi.mock("../../services/tasks.ts", () => svc);
vi.mock("../../services/capabilities.ts", () => import("../../test/mocks/capabilities.ts"));

import StepList from "./StepList.tsx";

const TASK: TaskWithSteps = {
  id: "task-1",
  company_id: "co-1",
  title: "Close out the punch list",
  description: null,
  assignee_id: "person-1",
  created_by: "person-1",
  due_date: null,
  priority: "medium",
  recurrence: null,
  campaign_id: null,
  goal_id: null,
  completed_at: null,
  completed_by: null,
  next_task_id: null,
  notified_assignee_id: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  steps: [{ id: "step-1", task_id: "task-1", company_id: "co-1", title: "Walk the site", sort_order: 1, done_at: null }],
};

function rename(text: string) {
  const box = screen.getByLabelText("Rename Walk the site");
  fireEvent.change(box, { target: { value: text } });
  fireEvent.blur(box);
  return box;
}

beforeEach(() => {
  for (const fn of Object.values(svc)) fn.mockReset();
});

describe("StepList rename", () => {
  it("marks a refused rename not saved, keeps the typed title, and says why", async () => {
    svc.renameStep.mockRejectedValue(new Error("That is not yours to change."));
    render(<StepList task={TASK} canEdit locked={false} onChange={() => undefined} />);
    const box = rename("Walk the whole site");
    await act(async () => {});
    expect(box).toHaveAttribute("data-save-state", "failed");
    expect(box).toHaveValue("Walk the whole site");
    expect(screen.getByText("That is not yours to change.")).toBeInTheDocument();
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("marks a rename that landed as saved", async () => {
    svc.renameStep.mockImplementation(async (id: string, title: string) => ({ ...TASK, steps: [{ ...TASK.steps[0], id, title }] }));
    const changes: TaskWithSteps[] = [];
    render(<StepList task={TASK} canEdit locked={false} onChange={(next) => changes.push(next)} />);
    const box = rename("Walk the whole site");
    await act(async () => {});
    expect(box).toHaveAttribute("data-save-state", "saved");
    expect(changes[0].steps[0].title).toBe("Walk the whole site");
  });
});
