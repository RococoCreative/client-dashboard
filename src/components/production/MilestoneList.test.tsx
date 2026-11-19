// Pins that archiving the open item lets go of it: the same item read back later (a reload that
// still finds it) reads closed, as text, rather than reopening on its own. The projects service is
// stubbed; nothing reaches a database.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ProjectMilestone } from "../../types/database.ts";

const svc = vi.hoisted(() => ({
  archiveMilestone: vi.fn(),
  listMilestones: vi.fn(),
  reorderMilestones: vi.fn(),
  updateMilestone: vi.fn(),
}));
vi.mock("../../services/projects.ts", () => svc);

import MilestoneList from "./MilestoneList.tsx";

const MILESTONE: ProjectMilestone = {
  id: "ms-1",
  company_id: "co-1",
  project_id: "proj-1",
  title: "Foundation inspection",
  description: null,
  kind: "milestone",
  sort_order: 1,
  target_date: null,
  status: "not_started",
  responsible_profile_id: null,
  completed_on: null,
  archived_at: null,
  created_by: null,
  updated_by: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  for (const fn of Object.values(svc)) fn.mockReset();
  svc.archiveMilestone.mockResolvedValue(undefined);
});

describe("MilestoneList after an archive", () => {
  it("lets go of the archived item, so it never comes back already open", async () => {
    const user = userEvent.setup();
    const list = (milestones: ProjectMilestone[]) => (
      <MilestoneList milestones={milestones} people={[]} directory={new Map()} canEdit onChanged={() => undefined} />
    );
    const { rerender } = render(list([MILESTONE]));
    await user.click(screen.getByRole("button", { name: "Edit Foundation inspection" }));
    await user.click(screen.getByRole("button", { name: "Archive Foundation inspection" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    expect(svc.archiveMilestone).toHaveBeenCalledWith("ms-1");
    rerender(list([]));
    rerender(list([MILESTONE]));
    expect(screen.queryByLabelText("Title of Foundation inspection")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Foundation inspection" })).toBeInTheDocument();
  });
});
