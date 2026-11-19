// Pins that removing the open link lets go of it: a link that comes back with the same id (here,
// added again and handed the old id) reads closed, as text, rather than reopening on its own. The
// links service is stubbed; nothing reaches a database.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ExternalLink } from "../../types/database.ts";

const svc = vi.hoisted(() => ({
  listExternalLinks: vi.fn(),
  createExternalLink: vi.fn(),
  updateExternalLink: vi.fn(),
  deleteExternalLink: vi.fn(),
}));
vi.mock("../../services/externalLinks.ts", () => svc);

import ExternalLinksPanel from "./ExternalLinksPanel.tsx";

const LINK: ExternalLink = {
  id: "link-1",
  company_id: "co-1",
  nav_group: "home",
  label: "Sales board",
  destination_note: null,
  url: "https://example.com/board",
  provider: "other",
  embed_url: null,
  embed_is_public: false,
  audience: "everyone",
  sort_order: 1,
  created_by: null,
  updated_by: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  for (const fn of Object.values(svc)) fn.mockReset();
  svc.listExternalLinks.mockResolvedValue([LINK]);
  svc.deleteExternalLink.mockResolvedValue(undefined);
  svc.createExternalLink.mockResolvedValue(LINK);
});

describe("ExternalLinksPanel after a remove", () => {
  it("lets go of the removed link, so it never comes back already open", async () => {
    const user = userEvent.setup();
    render(<ExternalLinksPanel companyId="co-1" />);
    await user.click(await screen.findByRole("button", { name: "Edit Sales board" }));
    await user.click(screen.getByRole("button", { name: "Remove Sales board" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove" }));
    expect(await screen.findByText(/No links yet/)).toBeInTheDocument();

    await user.type(screen.getByLabelText("Label"), "Sales board");
    await user.type(screen.getByLabelText("Link"), "https://example.com/board");
    await user.click(screen.getByRole("button", { name: "Add link" }));
    expect(await screen.findByRole("button", { name: "Edit Sales board" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Label for Sales board")).not.toBeInTheDocument();
  });
});
