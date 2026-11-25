// The SOP library upgrade (0053) on its screens: the editor (a Markdown version opens as a
// document, a change saves as an editor version), categories each company owns, tags, search,
// version history with compare and restore, sign-off, and assigning an SOP as a task.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("../services/supabase.ts", () => import("../test/mocks/supabase.ts"));
vi.mock("../services/auth.ts", () => import("../test/mocks/auth.ts"));
vi.mock("../services/profiles.ts", () => import("../test/mocks/profiles.ts"));
vi.mock("../services/companies.ts", () => import("../test/mocks/companies.ts"));
vi.mock("../services/sops.ts", () => import("../test/mocks/sops.ts"));
vi.mock("../services/sopCategories.ts", () => import("../test/mocks/sopCategories.ts"));
vi.mock("../services/sopSignoffs.ts", () => import("../test/mocks/sopSignoffs.ts"));
vi.mock("../services/storage.ts", () => import("../test/mocks/storage.ts"));
vi.mock("../services/resources.ts", () => import("../test/mocks/resources.ts"));
vi.mock("../services/tasks.ts", () => import("../test/mocks/tasks.ts"));
vi.mock("../services/directory.ts", () => import("../test/mocks/directory.ts"));
vi.mock("../services/externalLinks.ts", () => import("../test/mocks/externalLinks.ts"));
vi.mock("../services/capabilities.ts", () => import("../test/mocks/capabilities.ts"));

import { renderWithHub } from "../test/renderWithHub.tsx";
import { KLASIK, makeHub } from "../test/fixtures.ts";
import * as sopsService from "../services/sops.ts";
import * as categoriesService from "../services/sopCategories.ts";
import SopEditPage from "./sops/SopEditPage.tsx";

const admin = makeHub("admin");

describe("the SOP editor", () => {
  it("opens a Markdown version as an editable document", async () => {
    const sop = KLASIK.sops[1];
    renderWithHub(<SopEditPage />, admin, { path: `/sops/${sop.id}/edit`, pattern: "/sops/:sopId/edit" });
    const body = await screen.findByRole("textbox", { name: "Body" });
    expect(within(body).getByRole("heading", { name: "Purpose" })).toBeInTheDocument();
    expect(body.textContent).toContain("Walk the site with the superintendent");
    expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeInTheDocument();
  });

  it("saves a change to the body as an editor version", async () => {
    const user = userEvent.setup();
    const sop = KLASIK.sops[1];
    const addVersion = vi.spyOn(sopsService, "addSopVersion");
    renderWithHub(<SopEditPage />, admin, { path: `/sops/${sop.id}/edit`, pattern: "/sops/:sopId/edit" });
    await screen.findByRole("textbox", { name: "Body" });
    await user.click(screen.getByRole("button", { name: "Insert table" }));
    await user.click(screen.getByRole("button", { name: "Save version" }));
    await waitFor(() => expect(addVersion).toHaveBeenCalled());
    const [, , body] = addVersion.mock.calls[0];
    expect("json" in body && JSON.stringify(body.json)).toContain('"table"');
  });

  it("files a new SOP under a starter category, creating it, with its tags", async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(sopsService, "createSop");
    const createCategory = vi.spyOn(categoriesService, "createSopCategory");
    renderWithHub(<SopEditPage />, admin, { path: "/sops/new", pattern: "/sops/new" });
    await user.type(await screen.findByLabelText("Title"), "Forklift checks");
    await user.selectOptions(screen.getByLabelText("Category"), "Field (new)");
    await user.type(screen.getByLabelText("Tags"), "Equipment{Enter}yard,");
    await user.click(screen.getByRole("button", { name: "Create SOP" }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(createCategory).toHaveBeenCalledWith(KLASIK.company.id, "Field", expect.any(Number));
    const input = create.mock.calls[0][0];
    expect(input.category_id).toBe((await createCategory.mock.results[0].value).id);
    expect(input.tags).toEqual(["Equipment", "yard"]);
    expect("json" in input.body).toBe(true);
  });
});
