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
vi.mock("../services/marketing.ts", () => import("../test/mocks/marketing.ts"));
vi.mock("../services/gsr.ts", () => import("../test/mocks/gsr.ts"));

import { renderWithHub } from "../test/renderWithHub.tsx";
import { KINGDOM, KLASIK, makeHub } from "../test/fixtures.ts";
import * as tasksService from "../services/tasks.ts";
import TaskPage from "./tasks/TaskPage.tsx";
import TaskForm from "../components/tasks/TaskForm.tsx";
import * as sopsService from "../services/sops.ts";
import * as categoriesService from "../services/sopCategories.ts";
import SopEditPage from "./sops/SopEditPage.tsx";
import SopPage from "./sops/SopPage.tsx";
import ResourcesPage from "./resources/ResourcesPage.tsx";
import SopImportPage from "./sops/SopImportPage.tsx";

const admin = makeHub("admin");
const employee = makeHub("employee");

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

describe("the SOP page", () => {
  it("says who created it and who last updated it", async () => {
    const sop = KLASIK.sops[0];
    renderWithHub(<SopPage />, employee, { path: `/sops/${sop.id}`, pattern: "/sops/:sopId" });
    expect(await screen.findByText(`Last updated by ${sop.updated_by_name}`, { exact: false })).toBeInTheDocument();
    expect(screen.getByText(`Created by ${sop.created_by_name}`, { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Safety")).toBeInTheDocument();
  });

  it("finds a word inside the SOP and counts the matches", async () => {
    const user = userEvent.setup();
    const sop = KLASIK.sops[0];
    renderWithHub(<SopPage />, employee, { path: `/sops/${sop.id}`, pattern: "/sops/:sopId" });
    await screen.findByRole("heading", { name: "Purpose" });
    await user.type(screen.getByRole("searchbox", { name: "Find in this SOP" }), "superintendent");
    expect(await screen.findByText("1 of 2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next match" }));
    expect(await screen.findByText("2 of 2")).toBeInTheDocument();
    expect(document.querySelectorAll(".sop-find-match")).toHaveLength(2);
  });

  it("compares an older version with the current one", async () => {
    const user = userEvent.setup();
    const sop = KLASIK.sops[0];
    renderWithHub(<SopPage />, admin, { path: `/sops/${sop.id}`, pattern: "/sops/:sopId" });
    await user.click(await screen.findByRole("button", { name: "Compare version 1 with current" }));
    const dialog = await screen.findByRole("dialog", { name: "Version 1 against version 2" });
    expect(within(dialog).getByText("Post the checklist photo to the client album too.").closest("[data-diff]")).toHaveAttribute("data-diff", "added");
  });

  it("restores an older version as a new one, keeping history", async () => {
    const user = userEvent.setup();
    const sop = KLASIK.sops[0];
    const restore = vi.spyOn(sopsService, "restoreSopVersion");
    renderWithHub(<SopPage />, admin, { path: `/sops/${sop.id}`, pattern: "/sops/:sopId" });
    await user.click(await screen.findByRole("button", { name: "Restore version 1" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Restore as version 3" }));
    await waitFor(() => expect(restore).toHaveBeenCalled());
    expect(await screen.findByText("Restored from v1")).toBeInTheDocument();
    expect(screen.getByText("3 versions")).toBeInTheDocument();
  });

  it("offers no restore to an employee", async () => {
    const sop = KLASIK.sops[0];
    renderWithHub(<SopPage />, employee, { path: `/sops/${sop.id}`, pattern: "/sops/:sopId" });
    await screen.findByRole("heading", { name: "Purpose" });
    expect(screen.queryByRole("button", { name: /Restore version/ })).not.toBeInTheDocument();
  });
});

describe("the SOP library", () => {
  it("filters by the company's own category and by tag", async () => {
    const user = userEvent.setup();
    renderWithHub(<ResourcesPage tab="sops" />, admin, { path: "/resources/sops", pattern: "/resources/sops" });
    expect(await screen.findByText("Jobsite safety walk")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Category"), "Client");
    expect(screen.getByText("Client change order")).toBeInTheDocument();
    expect(screen.queryByText("Jobsite safety walk")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Category"), "All categories");
    await user.click(screen.getByRole("button", { name: "Daily" }));
    expect(screen.getByText("Jobsite safety walk")).toBeInTheDocument();
    expect(screen.queryByText("Client change order")).not.toBeInTheDocument();
  });

  it("searches inside the SOPs and shows the line that matched", async () => {
    const user = userEvent.setup();
    renderWithHub(<ResourcesPage tab="sops" />, employee, { path: "/resources/sops", pattern: "/resources/sops" });
    await screen.findByText("Jobsite safety walk");
    await user.type(screen.getByRole("searchbox", { name: "Search SOPs" }), "hazards");
    expect((await screen.findAllByText(/note hazards/)).length).toBeGreaterThan(0);
    await user.clear(screen.getByRole("searchbox", { name: "Search SOPs" }));
    await user.type(screen.getByRole("searchbox", { name: "Search SOPs" }), "invoicing");
    await waitFor(() => expect(screen.queryByText("Jobsite safety walk")).not.toBeInTheDocument());
  });

  it("opens a match with its first search word in Find, so a multi-word search still highlights", async () => {
    renderWithHub(<ResourcesPage tab="sops" />, employee, { path: "/resources/sops?q=hazards%20superintendent", pattern: "/resources/sops" });
    const link = await screen.findByRole("link", { name: /Jobsite safety walk/ });
    expect(link.getAttribute("href")).toBe(`/sops/${KLASIK.sops[0].id}?q=hazards`);
  });

  it("reads a tag from the address", async () => {
    renderWithHub(<ResourcesPage tab="sops" />, employee, { path: "/resources/sops?tag=Pricing", pattern: "/resources/sops" });
    expect(await screen.findByText("Client change order")).toBeInTheDocument();
    expect(screen.queryByText("Jobsite safety walk")).not.toBeInTheDocument();
  });

  it("offers status only to admins, and Import and New SOP", async () => {
    renderWithHub(<ResourcesPage tab="sops" />, employee, { path: "/resources/sops", pattern: "/resources/sops" });
    await screen.findByText("Jobsite safety walk");
    expect(screen.queryByLabelText("Status")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Import/ })).not.toBeInTheDocument();
  });

  it("gives admins a Setup tab for categories", async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(categoriesService, "createSopCategory");
    renderWithHub(<ResourcesPage tab="setup" />, admin, { path: "/resources/setup", pattern: "/resources/setup" });
    expect(await screen.findByRole("heading", { name: "SOP categories" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("New category"), "Equipment");
    await user.click(screen.getByRole("button", { name: "Add category" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(KLASIK.company.id, "Equipment", expect.any(Number)));
    expect(await screen.findByDisplayValue("Equipment")).toBeInTheDocument();
  });
});

describe("importing SOPs", () => {
  it("reads each file, says what it cannot read, and creates drafts with the original attached", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const create = vi.spyOn(sopsService, "createSop");
    const attach = vi.spyOn(sopsService, "addSopAttachment");
    create.mockClear();
    attach.mockClear();
    renderWithHub(<SopImportPage />, admin, { path: "/sops/import", pattern: "/sops/import" });
    const text = new File(["Site walk\n\n1. Check the gate\n2. Check the fence\n"], "site-walk.txt", { type: "text/plain" });
    const old = new File(["x"], "old.doc", { type: "application/msword" });
    await user.upload(await screen.findByLabelText("Choose files"), [text, old]);
    expect(await screen.findByDisplayValue("Site walk")).toBeInTheDocument();
    expect(screen.getByText(/save it as .docx or PDF/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create 1 draft" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const input = create.mock.calls[0][0];
    expect(input).toMatchObject({ title: "Site walk", status: "draft", change_note: "Imported from site-walk.txt" });
    await waitFor(() => expect(attach).toHaveBeenCalledWith(expect.objectContaining({ file_name: "site-walk.txt" })));
    expect(await screen.findByRole("link", { name: "Open Site walk" })).toBeInTheDocument();
  });

  it("lets a file be left out of the batch", async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderWithHub(<SopImportPage />, admin, { path: "/sops/import", pattern: "/sops/import" });
    const a = new File(["Gate\n\nLock it."], "gate.txt", { type: "text/plain" });
    const b = new File(["Fence\n\nWalk it."], "fence.txt", { type: "text/plain" });
    await user.upload(await screen.findByLabelText("Choose files"), [a, b]);
    expect(await screen.findByRole("button", { name: "Create 2 drafts" })).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Include fence.txt" }));
    expect(screen.getByRole("button", { name: "Create 1 draft" })).toBeInTheDocument();
  });
});

describe("signing off and assigning an SOP", () => {
  const kingdomAdmin = makeHub("admin", KINGDOM.company);
  const kingdomEmployee = makeHub("employee", KINGDOM.company);
  const sop = KINGDOM.sops.find((s) => s.status === "published")!;

  it("lets a member sign off, and says which version they signed", async () => {
    const user = userEvent.setup();
    renderWithHub(<SopPage />, kingdomEmployee, { path: `/sops/${sop.id}`, pattern: "/sops/:sopId" });
    const confirm = await screen.findByRole("checkbox", { name: "I have read this SOP and completed it" });
    const sign = screen.getByRole("button", { name: "Sign off" });
    expect(sign).toBeDisabled();
    await user.click(confirm);
    await user.click(sign);
    expect(await screen.findByText(new RegExp(`You signed off version ${sop.current_version}`))).toBeInTheDocument();
  });

  it("assigns the SOP to people as tasks", async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(tasksService, "createTask");
    create.mockClear();
    const person = KINGDOM.profiles.find((p) => p.role === "employee" && p.id !== kingdomEmployee.profile.id && p.is_active)!;
    renderWithHub(<SopPage />, kingdomAdmin, { path: `/sops/${sop.id}`, pattern: "/sops/:sopId" });
    await user.click(await screen.findByRole("button", { name: "Assign" }));
    const dialog = await screen.findByRole("dialog", { name: "Assign this SOP" });
    await user.click(within(dialog).getByRole("checkbox", { name: new RegExp(person.full_name!) }));
    await user.click(within(dialog).getByRole("button", { name: "Assign to 1 person" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ sop_id: sop.id, assignee_id: person.id, title: `Complete SOP: ${sop.title}` })));
    expect(await screen.findByText(person.full_name!, { selector: "li *" })).toBeInTheDocument();
  });

  it("finishes an employee's SOP task by sign-off, not by marking it complete", async () => {
    const task = await tasksService.createTask({ company_id: KINGDOM.company.id, title: "Read it", assignee_id: kingdomEmployee.profile.id, sop_id: sop.id });
    renderWithHub(<TaskPage />, kingdomEmployee, { path: `/tasks/${task.id}`, pattern: "/tasks/:taskId" });
    expect(await screen.findByRole("link", { name: "Sign off the SOP" })).toHaveAttribute("href", `/sops/${sop.id}`);
    expect(screen.queryByRole("button", { name: "Mark complete" })).not.toBeInTheDocument();
  });
});

describe("a task whose SOP has been taken down to revise", () => {
  it("tells its person the SOP opens again once it is published, with no link to a page they cannot open", async () => {
    const kingdomEmployee = makeHub("employee", KINGDOM.company);
    const sop = await sopsService.createSop({ company_id: KINGDOM.company.id, title: "Trench boxes", category_id: null, status: "published", body: { md: "## Steps\n\nShore it." } });
    const task = await tasksService.createTask({ company_id: KINGDOM.company.id, title: "Read trench boxes", assignee_id: kingdomEmployee.profile.id, sop_id: sop.id });
    await sopsService.updateSop(sop.id, { status: "draft" });
    renderWithHub(<TaskPage />, kingdomEmployee, { path: `/tasks/${task.id}`, pattern: "/tasks/:taskId" });
    expect(await screen.findByText(/being revised/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign off the SOP" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark complete" })).not.toBeInTheDocument();
  });
});

describe("a task on an SOP from the task form", () => {
  it("offers the company's published SOPs and saves the one picked", async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(tasksService, "createTask");
    create.mockClear();
    const published = KINGDOM.sops.find((s) => s.status === "published")!;
    const draft = KINGDOM.sops.find((s) => s.status === "draft");
    renderWithHub(
      <TaskForm companyId={KINGDOM.company.id} people={KINGDOM.profiles} campaigns={[]} canSetCampaign={false} onSaved={() => undefined} onClose={() => undefined} />,
      makeHub("admin", KINGDOM.company),
    );
    await user.type(screen.getByLabelText("Title"), "Read the safety walk");
    const picker = await screen.findByLabelText("SOP to complete");
    if (draft) expect(within(picker).queryByRole("option", { name: draft.title })).not.toBeInTheDocument();
    await user.selectOptions(picker, published.title);
    await user.click(screen.getByRole("button", { name: "Add task" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ sop_id: published.id })));
  });
});

describe("an older SOP with pictures in its Markdown", () => {
  it("shows each picture as a link to it, and keeps it a link when edited", async () => {
    const sop = await sopsService.createSop({ company_id: KLASIK.company.id, title: "Old with photo", category_id: null, status: "published", body: { md: "## Setup\n\n![Ladder angle](https://example.com/angle.png)\n\nSet the angle." } });
    renderWithHub(<SopPage />, employee, { path: `/sops/${sop.id}`, pattern: "/sops/:sopId" });
    expect(await screen.findByRole("link", { name: "Ladder angle" })).toHaveAttribute("href", "https://example.com/angle.png");
  });
});
