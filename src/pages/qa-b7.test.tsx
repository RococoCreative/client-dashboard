// QA batch b7: company settings, GSR settings and the Rococo Companies tab. Each test pins a
// defect a QA pass confirmed: name boxes left blank while the record kept the old name, a pillar
// weight refused without a word, delete dialogs that promised the wrong thing or hid their own
// failure, a company delete that left files and provider grants behind, deliverable categories
// nobody could correct, a remove control built by hand, and a Retire button that never said what
// it does. Round two adds the races a reviewer found: a delete dialog cancelled while its delete
// was still running, and a second company delete that wiped the first one's stranded-files notice.
// Round three: a Delete button behind the scrim, reached from the keyboard while a delete ran,
// opened a second dialog that then showed the running delete's failure as its own.
//
// The mocks are the usual in-memory data layer, with the calls these defects get wrong watched so
// a test can make one fail or read the order they ran in. The company deletes run last, because
// the companies mock keeps what they remove for the rest of the file.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("../services/supabase.ts", () => import("../test/mocks/supabase.ts"));
vi.mock("../services/auth.ts", () => import("../test/mocks/auth.ts"));
vi.mock("../services/profiles.ts", () => import("../test/mocks/profiles.ts"));
vi.mock("../services/companies.ts", async () => {
  const mock = await import("../test/mocks/companies.ts");
  return { ...mock, deleteCompany: vi.fn(mock.deleteCompany) };
});
vi.mock("../services/invitations.ts", () => import("../test/mocks/invitations.ts"));
vi.mock("../services/gsr.ts", async () => {
  const mock = await import("../test/mocks/gsr.ts");
  return { ...mock, updatePillar: vi.fn(mock.updatePillar), deletePillar: vi.fn(mock.deletePillar), deleteCriterion: vi.fn(mock.deleteCriterion) };
});
vi.mock("../services/sops.ts", () => import("../test/mocks/sops.ts"));
vi.mock("../services/resources.ts", () => import("../test/mocks/resources.ts"));
vi.mock("../services/storage.ts", async () => {
  const mock = await import("../test/mocks/storage.ts");
  return { ...mock, removeCompanyFiles: vi.fn(mock.removeCompanyFiles) };
});
vi.mock("../services/financials.ts", () => import("../test/mocks/financials.ts"));
vi.mock("../services/marketing.ts", () => import("../test/mocks/marketing.ts"));
vi.mock("../services/employees.ts", () => import("../test/mocks/employees.ts"));
vi.mock("../services/deliverables.ts", async () => {
  const mock = await import("../test/mocks/deliverables.ts");
  return { ...mock, deleteDeliverableCategory: vi.fn(mock.deleteDeliverableCategory) };
});
vi.mock("../services/jobRoles.ts", () => import("../test/mocks/jobRoles.ts"));
vi.mock("../services/connections.ts", async () => {
  const mock = await import("../test/mocks/connections.ts");
  return { ...mock, disconnectConnection: vi.fn(mock.disconnectConnection) };
});

import { renderWithHub } from "../test/renderWithHub.tsx";
import { createCompany, deleteCompany } from "../services/companies.ts";
import { createDeliverableCategory, deleteDeliverableCategory } from "../services/deliverables.ts";
import { deleteCriterion, deletePillar, updatePillar } from "../services/gsr.ts";
import { removeCompanyFiles } from "../services/storage.ts";
import { disconnectConnection } from "../services/connections.ts";
import { KLASIK, makeHub } from "../test/fixtures.ts";
import GsrSettingsPage from "./gsr/GsrSettingsPage.tsx";
import ReviewPage from "./gsr/ReviewPage.tsx";
import PersonPage from "./people/PersonPage.tsx";
import CompanySettingsPage from "./CompanySettingsPage.tsx";
import CompaniesPage from "./rococo/CompaniesPage.tsx";

const admin = makeHub("admin");
const rococo = makeHub("rococo", null);
const sam = KLASIK.profiles[1];
const inProgressReview = KLASIK.reviews.find((r) => r.status === "in_progress")!;

function renderPerson() {
  return renderWithHub(<PersonPage />, admin, { path: `/people/${sam.id}`, pattern: "/people/:profileId" });
}

// A call that stays in flight until the test settles it, so a test can act while it runs.
function pending() {
  let settle: { resolve: () => void; reject: (err: Error) => void } = { resolve: () => undefined, reject: () => undefined };
  const promise = new Promise<void>((resolve, reject) => {
    settle = { resolve, reject };
  });
  return { promise, ...settle };
}

function renderCompanies() {
  return renderWithHub(<CompaniesPage />, rococo, { path: "/rococo/companies", pattern: "/rococo/companies" });
}

// Clearing a name and clicking away puts the stored name back, rather than leaving a blank box
// over a record that still holds the old one.
async function expectClearRestores(user: ReturnType<typeof userEvent.setup>, label: string, stored: string) {
  const box = await screen.findByLabelText(label);
  expect(box).toHaveValue(stored);
  await user.clear(box);
  await user.tab();
  expect(screen.getByLabelText(label)).toHaveValue(stored);
}

describe("name boxes that cannot be emptied", () => {
  it("puts back a cleared figure, KPI or pay line name on the person page", async () => {
    const user = userEvent.setup();
    renderPerson();
    expect(await screen.findByRole("heading", { name: "Sam Ortega" })).toBeInTheDocument();
    await expectClearRestores(user, "Figure Revenue managed", "Revenue managed");
    await expectClearRestores(user, "KPI $2M in newly closed sales", "$2M in newly closed sales");
    await expectClearRestores(user, "Line Base salary", "Base salary");
  });

  it("puts back a cleared job role name or role goal in settings", async () => {
    const user = userEvent.setup();
    renderWithHub(<CompanySettingsPage />, admin);
    await expectClearRestores(user, "Name for Production Manager", "Production Manager");
    await expectClearRestores(user, "Role goal Walk every active site once a week", "Walk every active site once a week");
  });

  it("puts back a cleared goal title in the monthly GSR", async () => {
    const user = userEvent.setup();
    renderWithHub(<ReviewPage />, admin, { path: `/gsr/reviews/${inProgressReview.id}`, pattern: "/gsr/reviews/:reviewId" });
    const title = "Run the weekly client update without prompting";
    await expectClearRestores(user, `Title for ${title}`, title);
  });
});

describe("pillar weights", () => {
  it("refuses a weight outside 0 to 100, says so, and shows the stored weight again", async () => {
    const user = userEvent.setup();
    renderWithHub(<GsrSettingsPage />, admin);
    const section = (await screen.findByDisplayValue("Deliverables")).closest("section") as HTMLElement;
    const weight = within(section).getByLabelText("Weight %");
    expect(weight).toHaveValue(50);
    vi.mocked(updatePillar).mockClear();

    await user.clear(weight);
    await user.type(weight, "120");
    await user.tab();
    expect(within(section).getByRole("alert")).toHaveTextContent("Enter a weight from 0 to 100.");
    expect(weight).toHaveValue(50);

    // A blank box is a refusal too, never a weight of zero.
    await user.clear(weight);
    await user.tab();
    expect(within(section).getByRole("alert")).toHaveTextContent("Enter a weight from 0 to 100.");
    expect(weight).toHaveValue(50);
    expect(updatePillar).not.toHaveBeenCalled();
    expect(screen.getByText("Weights total 100%")).toBeInTheDocument();

    // A weight in range saves, and the message goes.
    await user.clear(weight);
    await user.type(weight, "40");
    await user.tab();
    expect(await screen.findByText("Weights total 90%")).toBeInTheDocument();
    expect(within(section).queryByRole("alert")).not.toBeInTheDocument();
    await user.clear(weight);
    await user.type(weight, "50");
    await user.tab();
    expect(await screen.findByText("Weights total 100%")).toBeInTheDocument();
  });
});

describe("deleting a pillar or criterion", () => {
  it("says a pillar on a signed-off review cannot go, and shows the refusal inside the dialog", async () => {
    const user = userEvent.setup();
    renderWithHub(<GsrSettingsPage />, admin);
    const section = (await screen.findByDisplayValue("Brand Impact")).closest("section") as HTMLElement;
    await user.click(within(section).getByRole("button", { name: "Delete pillar" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("A pillar that is part of a signed-off review cannot be deleted");
    expect(dialog).toHaveTextContent("untick Active");

    const refusal = "This pillar is part of a signed-off review, so it cannot be deleted. Untick Active to retire it instead.";
    vi.mocked(deletePillar).mockRejectedValueOnce(new Error(refusal));
    await user.click(within(dialog).getByRole("button", { name: "Delete pillar" }));
    expect(await within(dialog).findByText(refusal)).toBeInTheDocument();
    // Said once, where the admin is looking, and the pillar is still there.
    expect(screen.getAllByText(refusal)).toHaveLength(1);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByDisplayValue("Brand Impact")).toBeInTheDocument();
  });

  it("says the same of a criterion, and shows its refusal inside the dialog", async () => {
    const user = userEvent.setup();
    renderWithHub(<GsrSettingsPage />, admin);
    const row = (await screen.findByDisplayValue("Curiosity")).closest("li") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Delete criterion" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("A criterion that is part of a signed-off review cannot be deleted");
    expect(dialog).not.toHaveTextContent("changes the scores on reviews already finished");

    const refusal = "This criterion is part of a signed-off review, so it cannot be deleted. Untick Active to retire it instead.";
    vi.mocked(deleteCriterion).mockRejectedValueOnce(new Error(refusal));
    await user.click(within(dialog).getByRole("button", { name: "Delete criterion" }));
    expect(await within(dialog).findByText(refusal)).toBeInTheDocument();
    expect(screen.getAllByText(refusal)).toHaveLength(1);
  });

  it("waits for a delete already sent, and the next dialog opens without its refusal", async () => {
    const user = userEvent.setup();
    renderWithHub(<GsrSettingsPage />, admin);
    const section = (await screen.findByDisplayValue("Brand Impact")).closest("section") as HTMLElement;
    await user.click(within(section).getByRole("button", { name: "Delete pillar" }));
    const dialog = screen.getByRole("dialog");
    const call = pending();
    vi.mocked(deletePillar).mockImplementationOnce(() => call.promise);
    await user.click(within(dialog).getByRole("button", { name: "Delete pillar" }));
    expect(within(dialog).getByRole("button", { name: "Working..." })).toBeDisabled();

    // The delete is on its way, so Cancel, Escape and the backdrop wait for its answer.
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await user.keyboard("{Escape}");
    fireEvent.mouseDown(dialog);
    expect(screen.getByRole("dialog")).toBe(dialog);

    const refusal = "This pillar is part of a signed-off review, so it cannot be deleted. Untick Active to retire it instead.";
    call.reject(new Error(refusal));
    expect(await within(dialog).findByText(refusal)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const row = screen.getByDisplayValue("Curiosity").closest("li") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Delete criterion" }));
    expect(screen.getByRole("dialog")).toHaveTextContent('Delete "Curiosity"?');
    expect(screen.queryByText(refusal)).not.toBeInTheDocument();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.getByDisplayValue("Brand Impact")).toBeInTheDocument();
  });

  it("opens no second dialog from the page behind, so a refusal shows only in its own dialog", async () => {
    const user = userEvent.setup();
    renderWithHub(<GsrSettingsPage />, admin);
    const section = (await screen.findByDisplayValue("Brand Impact")).closest("section") as HTMLElement;
    await user.click(within(section).getByRole("button", { name: "Delete pillar" }));
    const dialog = screen.getByRole("dialog");
    const behind = within(screen.getByDisplayValue("Curiosity").closest("li") as HTMLElement).getByRole("button", { name: "Delete criterion" });

    // The dialog has no focus trap, so a key press can reach a Delete button under the scrim.
    // It opens nothing, before the delete is sent or while it runs.
    behind.focus();
    await user.keyboard("{Enter}");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    const call = pending();
    vi.mocked(deletePillar).mockImplementationOnce(() => call.promise);
    await user.click(within(dialog).getByRole("button", { name: "Delete pillar" }));
    behind.focus();
    await user.keyboard("{Enter}");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(dialog).toHaveTextContent('Delete "Brand Impact"?');

    const refusal = "This pillar is part of a signed-off review, so it cannot be deleted. Untick Active to retire it instead.";
    call.reject(new Error(refusal));
    expect(await within(dialog).findByText(refusal)).toBeInTheDocument();
    expect(screen.getAllByText(refusal)).toHaveLength(1);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(dialog).toHaveTextContent('Delete "Brand Impact"?');
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("retiring a job role", () => {
  it("says what retiring does, on the panel and on a retired role", async () => {
    const user = userEvent.setup();
    renderWithHub(<CompanySettingsPage />, admin);
    expect(await screen.findByText(/Retiring a role keeps it on record/)).toBeInTheDocument();
    const card = (await screen.findByLabelText("Name for Production Manager")).closest("li") as HTMLElement;
    await user.click(within(card).getByRole("button", { name: "Retire" }));
    expect(await within(card).findByText("Retired")).toBeInTheDocument();
    expect(card).toHaveTextContent("no longer adds its dashboard modules or its role goals");
    await user.click(within(card).getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(within(card).queryByText("Retired")).not.toBeInTheDocument());
  });
});

describe("deliverable categories", () => {
  const sales = KLASIK.deliverableCategories.find((c) => c.name === "BD & Sales")!;

  it("lists the company's categories in settings, renames one, and never to blank", async () => {
    const user = userEvent.setup();
    renderWithHub(<CompanySettingsPage />, admin);
    expect(await screen.findByRole("heading", { name: "Deliverable categories" })).toBeInTheDocument();
    await expectClearRestores(user, "Category name BD & Sales", "BD & Sales");
    const production = screen.getByLabelText("Category name Production");
    await user.clear(production);
    await user.type(production, "Producton");
    await user.tab();
    expect(await screen.findByLabelText("Category name Producton")).toHaveValue("Producton");
    const fixed = screen.getByLabelText("Category name Producton");
    await user.clear(fixed);
    await user.type(fixed, "Production & QA");
    await user.tab();
    expect(await screen.findByLabelText("Category name Production & QA")).toHaveValue("Production & QA");
  });

  it("reorders categories", async () => {
    const user = userEvent.setup();
    renderWithHub(<CompanySettingsPage />, admin);
    await screen.findByLabelText("Category name Production & QA");
    const order = () => screen.getAllByLabelText(/^Category name /).map((el) => (el as HTMLInputElement).value);
    expect(order()).toEqual(["BD & Sales", "Production & QA"]);
    expect(screen.getByRole("button", { name: "Move BD & Sales up" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Move Production & QA up" }));
    await waitFor(() => expect(order()).toEqual(["Production & QA", "BD & Sales"]));
  });

  it("retires a category: settings mark it, and the person page stops offering it", async () => {
    const user = userEvent.setup();
    const settings = renderWithHub(<CompanySettingsPage />, admin);
    const row = (await screen.findByLabelText("Category name BD & Sales")).closest("li") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Retire" }));
    expect(await within(row).findByText("Retired")).toBeInTheDocument();
    settings.unmount();

    renderPerson();
    await screen.findByDisplayValue("Customer Lifecycle & Retention Strategy");
    // Not offered for a new heading, as itself or as a starter to create again.
    const pulldown = screen.getByLabelText("Category") as HTMLSelectElement;
    const offered = [...pulldown.options].map((o) => o.textContent);
    expect(offered).not.toContain("BD & Sales");
    expect(offered).toContain("Production & QA");
    // A heading already filed under it keeps it, and says it is retired.
    const filed = screen.getByLabelText("Category for Customer Lifecycle & Retention Strategy") as HTMLSelectElement;
    expect(filed).toHaveValue(sales.id);
    expect(filed.selectedOptions[0].textContent).toBe("BD & Sales (retired)");
    // Typing the retired name does not quietly file under it.
    await user.type(screen.getByLabelText("New deliverable"), "Referral program");
    await user.selectOptions(pulldown, "new:");
    await user.type(screen.getByLabelText("Category name"), "BD & Sales");
    const form = screen.getByLabelText("New deliverable").closest("form") as HTMLElement;
    await user.click(within(form).getByRole("button", { name: /Add deliverable/ }));
    expect(await screen.findByText("BD & Sales is retired. Restore it in Settings to file under it.")).toBeInTheDocument();
    expect(screen.getByLabelText("New deliverable")).toHaveValue("Referral program");
  });

  it("deletes a category: its headings move to Uncategorized and keep their tasks", async () => {
    const user = userEvent.setup();
    const settings = renderWithHub(<CompanySettingsPage />, admin);
    await screen.findByLabelText("Category name Production & QA");
    await user.click(screen.getByRole("button", { name: "Delete Production & QA" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("move to Uncategorized");
    expect(dialog).toHaveTextContent("retire it instead");
    await user.click(within(dialog).getByRole("button", { name: "Delete category" }));
    await waitFor(() => expect(screen.queryByLabelText("Category name Production & QA")).not.toBeInTheDocument());
    settings.unmount();

    renderPerson();
    const heading = await screen.findByDisplayValue("Quality Assurance & Communication Standards");
    const group = heading.closest("section") as HTMLElement;
    expect(within(group).getByText("Uncategorized", { selector: "p" })).toBeInTheDocument();
    expect(within(group).getByDisplayValue("Monthly jobsite inspections")).toBeInTheDocument();
  });

  it("waits for a category delete already sent, and opens the next dialog without its failure", async () => {
    const user = userEvent.setup();
    renderWithHub(<CompanySettingsPage />, admin);
    await screen.findByLabelText("Category name BD & Sales");
    await user.click(screen.getByRole("button", { name: "Delete BD & Sales" }));
    const dialog = screen.getByRole("dialog");
    const call = pending();
    vi.mocked(deleteDeliverableCategory).mockImplementationOnce(() => call.promise);
    await user.click(within(dialog).getByRole("button", { name: "Delete category" }));
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBe(dialog);

    call.reject(new Error("Failed to fetch"));
    expect(await within(dialog).findByText("The connection dropped. Check your signal and try again.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Category name BD & Sales")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete BD & Sales" }));
    expect(screen.getByRole("dialog")).not.toHaveTextContent("The connection dropped");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
  });

  it("opens no other category's dialog while a delete runs, so its failure stays in its own dialog", async () => {
    const user = userEvent.setup();
    await createDeliverableCategory({ company_id: KLASIK.company.id, name: "Estimating", sort_order: 9 });
    renderWithHub(<CompanySettingsPage />, admin);
    await screen.findByLabelText("Category name Estimating");
    await user.click(screen.getByRole("button", { name: "Delete BD & Sales" }));
    const dialog = screen.getByRole("dialog");
    const call = pending();
    vi.mocked(deleteDeliverableCategory).mockImplementationOnce(() => call.promise);
    await user.click(within(dialog).getByRole("button", { name: "Delete category" }));

    // The dialog has no focus trap, so a key press can reach a Delete button under the scrim.
    screen.getByRole("button", { name: "Delete Estimating" }).focus();
    await user.keyboard("{Enter}");
    expect(dialog).toHaveTextContent('Delete "BD & Sales"?');

    call.reject(new Error("Failed to fetch"));
    expect(await within(dialog).findByText("The connection dropped. Check your signal and try again.")).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Delete "BD & Sales"?');
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Once that dialog is closed, the other category's opens and deletes as usual.
    await user.click(screen.getByRole("button", { name: "Delete Estimating" }));
    const next = screen.getByRole("dialog");
    expect(next).toHaveTextContent('Delete "Estimating"?');
    expect(next).not.toHaveTextContent("The connection dropped");
    await user.click(within(next).getByRole("button", { name: "Delete category" }));
    await waitFor(() => expect(screen.queryByLabelText("Category name Estimating")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Category name BD & Sales")).toBeInTheDocument();
  });
});

describe("deleting a company", () => {
  it("says what the delete removes and what it leaves, and removes a domain with the shared icon button", async () => {
    const user = userEvent.setup();
    renderCompanies();
    const remove = await screen.findByRole("button", { name: "Remove beklasik.com" });
    expect(remove).toHaveAttribute("title", "Remove beklasik.com");

    await user.click(screen.getByRole("button", { name: "Delete Kingdom Custom Construction" }));
    const dialog = screen.getByRole("dialog");
    for (const words of ["KPIs", "compensation", "deliverables", "ratings", "job roles", "pillars", "stored files", "disconnected", "not signed in", "No company"]) {
      expect(dialog).toHaveTextContent(words);
    }
    expect(dialog).not.toHaveTextContent("Its people stay as accounts");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  });

  it("cannot be cancelled once the delete starts, and the next dialog opens clean", async () => {
    const user = userEvent.setup();
    vi.mocked(deleteCompany).mockClear();
    renderCompanies();
    await user.click(await screen.findByRole("button", { name: "Delete Klasik Construction" }));
    const dialog = screen.getByRole("dialog");
    const call = pending();
    vi.mocked(disconnectConnection).mockImplementationOnce(() => call.promise);
    await user.type(within(dialog).getByLabelText("Type the identifier to confirm"), "klasik");
    await user.click(within(dialog).getByRole("button", { name: "Delete company" }));

    // A provider may already be disconnected, so nothing offers to call the delete back.
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Deleting..." })).toBeDisabled();
    await user.keyboard("{Escape}");
    fireEvent.mouseDown(dialog);
    expect(screen.getByRole("dialog")).toBe(dialog);

    call.reject(new Error("Failed to fetch"));
    expect(await within(dialog).findByText("The connection dropped. Check your signal and try again.")).toBeInTheDocument();
    expect(deleteCompany).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).not.toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Klasik Construction" })).toBeInTheDocument();

    // The next dialog says nothing about the last one's failure, and its confirm box is empty.
    await user.click(screen.getByRole("button", { name: "Delete RBA Projects" }));
    const next = screen.getByRole("dialog");
    expect(next).not.toHaveTextContent("The connection dropped");
    expect(within(next).getByLabelText("Type the identifier to confirm")).toHaveValue("");
    await user.click(within(next).getByRole("button", { name: "Cancel" }));
  });

  it("stops before deleting anything when a connection cannot be revoked, and says why in the dialog", async () => {
    const user = userEvent.setup();
    renderCompanies();
    await user.click(await screen.findByRole("button", { name: "Delete Klasik Construction" }));
    const dialog = screen.getByRole("dialog");
    vi.mocked(disconnectConnection).mockRejectedValueOnce(new Error("The connection service did not answer. Try again in a moment."));
    vi.mocked(deleteCompany).mockClear();
    await user.type(within(dialog).getByLabelText("Type the identifier to confirm"), "klasik");
    await user.click(within(dialog).getByRole("button", { name: "Delete company" }));
    expect(await within(dialog).findByText("The connection service did not answer. Try again in a moment.")).toBeInTheDocument();
    expect(deleteCompany).not.toHaveBeenCalled();
  });

  it("shows a failed delete inside the dialog", async () => {
    const user = userEvent.setup();
    renderCompanies();
    await user.click(await screen.findByRole("button", { name: "Delete RBA Projects" }));
    const dialog = screen.getByRole("dialog");
    vi.mocked(deleteCompany).mockRejectedValueOnce(new Error("Failed to fetch"));
    await user.type(within(dialog).getByLabelText("Type the identifier to confirm"), "rba");
    await user.click(within(dialog).getByRole("button", { name: "Delete company" }));
    expect(await within(dialog).findByText("The connection dropped. Check your signal and try again.")).toBeInTheDocument();
    expect(screen.getAllByText("The connection dropped. Check your signal and try again.")).toHaveLength(1);
    expect(within(dialog).getByRole("button", { name: "Delete company" })).not.toBeDisabled();
  });

  it("opens no other company's dialog while a delete runs, so its failure stays in its own dialog", async () => {
    const user = userEvent.setup();
    await createCompany({ slug: "kb1", name: "Keyboard One", theme_key: "kingdom" });
    await createCompany({ slug: "kb2", name: "Keyboard Two", theme_key: "kingdom" });
    renderCompanies();
    await user.click(await screen.findByRole("button", { name: "Delete Keyboard One" }));
    const dialog = screen.getByRole("dialog");
    const call = pending();
    vi.mocked(deleteCompany).mockImplementationOnce(() => call.promise);
    await user.type(within(dialog).getByLabelText("Type the identifier to confirm"), "kb1");
    await user.click(within(dialog).getByRole("button", { name: "Delete company" }));

    // The dialog has no focus trap, so a key press can reach a Delete button under the scrim.
    screen.getByRole("button", { name: "Delete Keyboard Two" }).focus();
    await user.keyboard("{Enter}");
    expect(dialog).toHaveTextContent("Delete Keyboard One?");
    expect(within(dialog).getByRole("button", { name: "Deleting..." })).toBeDisabled();

    call.reject(new Error("Failed to fetch"));
    expect(await within(dialog).findByText("The connection dropped. Check your signal and try again.")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Delete Keyboard One?");
    expect(within(dialog).getByLabelText("Type the identifier to confirm")).toHaveValue("kb1");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Keyboard One" })).toBeInTheDocument();

    // Once that dialog is closed, the other company's opens clean.
    await user.click(screen.getByRole("button", { name: "Delete Keyboard Two" }));
    const next = screen.getByRole("dialog");
    expect(next).toHaveTextContent("Delete Keyboard Two?");
    expect(next).not.toHaveTextContent("The connection dropped");
    await user.click(within(next).getByRole("button", { name: "Cancel" }));
  });

  it("revokes the company's connections, deletes it, then clears its stored files", async () => {
    const user = userEvent.setup();
    vi.mocked(disconnectConnection).mockClear();
    vi.mocked(deleteCompany).mockClear();
    vi.mocked(removeCompanyFiles).mockClear();
    renderCompanies();
    await user.click(await screen.findByRole("button", { name: "Delete Kingdom Custom Construction" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Type the identifier to confirm"), "kingdom");
    await user.click(within(dialog).getByRole("button", { name: "Delete company" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "Kingdom Custom Construction" })).not.toBeInTheDocument();

    // Only the connected provider is revoked; the tokens go with the company, so it comes first.
    expect(disconnectConnection).toHaveBeenCalledTimes(1);
    expect(disconnectConnection).toHaveBeenCalledWith("co-kingdom", "gohighlevel");
    expect(deleteCompany).toHaveBeenCalledWith("co-kingdom");
    expect(removeCompanyFiles).toHaveBeenCalledWith("co-kingdom");
    const revoked = vi.mocked(disconnectConnection).mock.invocationCallOrder[0];
    const deleted = vi.mocked(deleteCompany).mock.invocationCallOrder[0];
    const cleared = vi.mocked(removeCompanyFiles).mock.invocationCallOrder[0];
    expect(revoked).toBeLessThan(deleted);
    expect(deleted).toBeLessThan(cleared);
  });

  it("says so when the company is gone but its stored files could not all be cleared", async () => {
    const user = userEvent.setup();
    renderCompanies();
    await user.click(await screen.findByRole("button", { name: "Delete RBA Projects" }));
    const dialog = screen.getByRole("dialog");
    vi.mocked(removeCompanyFiles).mockRejectedValueOnce(new Error("Failed to fetch"));
    await user.type(within(dialog).getByLabelText("Type the identifier to confirm"), "rba");
    await user.click(within(dialog).getByRole("button", { name: "Delete company" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText(/RBA Projects is deleted, but some of its stored files were not removed/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "RBA Projects" })).not.toBeInTheDocument();
    // The removal can be run again from the notice, and goes once it works.
    vi.mocked(removeCompanyFiles).mockClear();
    await user.click(screen.getByRole("button", { name: "Remove the files for RBA Projects" }));
    await waitFor(() => expect(screen.queryByText(/some of its stored files were not removed/)).not.toBeInTheDocument());
    expect(removeCompanyFiles).toHaveBeenCalledWith("co-rba");
  });

  it("keeps a notice for each company whose files did not all go, whatever is deleted after", async () => {
    const user = userEvent.setup();
    for (const [slug, name] of [["north", "North Yard"], ["south", "South Yard"], ["east", "East Yard"]]) {
      await createCompany({ slug, name, theme_key: "kingdom" });
    }
    renderCompanies();

    async function remove(name: string, slug: string) {
      await user.click(await screen.findByRole("button", { name: `Delete ${name}` }));
      const dialog = screen.getByRole("dialog");
      await user.type(within(dialog).getByLabelText("Type the identifier to confirm"), slug);
      await user.click(within(dialog).getByRole("button", { name: "Delete company" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    }
    const stranded = (name: string) => screen.queryByText(new RegExp(`${name} is deleted, but some of its stored files were not removed`));

    vi.mocked(removeCompanyFiles).mockRejectedValueOnce(new Error("Failed to fetch"));
    await remove("North Yard", "north");
    expect(await screen.findByText(/North Yard is deleted, but some of its stored files were not removed/)).toBeInTheDocument();

    // A later delete whose files all go leaves the earlier notice where it is.
    vi.mocked(removeCompanyFiles).mockClear();
    await remove("South Yard", "south");
    await waitFor(() => expect(removeCompanyFiles).toHaveBeenCalledWith("co-south"));
    expect(stranded("North Yard")).toBeInTheDocument();
    expect(stranded("South Yard")).not.toBeInTheDocument();

    // A second failure adds its own notice beside the first.
    vi.mocked(removeCompanyFiles).mockRejectedValueOnce(new Error("Failed to fetch"));
    await remove("East Yard", "east");
    expect(await screen.findByText(/East Yard is deleted, but some of its stored files were not removed/)).toBeInTheDocument();
    expect(stranded("North Yard")).toBeInTheDocument();

    // Each notice retries its own company, and only its own notice goes.
    vi.mocked(removeCompanyFiles).mockClear();
    await user.click(screen.getByRole("button", { name: "Remove the files for North Yard" }));
    await waitFor(() => expect(stranded("North Yard")).not.toBeInTheDocument());
    expect(removeCompanyFiles).toHaveBeenCalledTimes(1);
    expect(removeCompanyFiles).toHaveBeenCalledWith("co-north");
    expect(stranded("East Yard")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove the files for East Yard" })).toBeInTheDocument();
  });
});
