// QA batch b4: the libraries, the People page and the app shell. Each test here pins a defect a
// QA pass confirmed: files deleted before the rows that point at them, a delete dialog opening
// on a failure it did not cause, a roster row nobody could switch off, a Rococo admin a client
// company could demote, and a holding screen promising a way in that does not exist.
//
// The mocks are the usual in-memory data layer, with a switch to make one named call fail once
// and a log of the storage calls, because what these defects get wrong is order and failure.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Profile } from "../types/database.ts";

const ctl = vi.hoisted(() => {
  // name -> what the next call to it throws
  const failures = new Map<string, unknown>();
  // "removeFile:path" and "uploadFile:path", in the order they happened
  const storage: string[] = [];
  const state = { me: null as Profile | null, extraProfiles: [] as Profile[] };
  function wrap<T extends object>(mod: T, names: string[]): T {
    const out: Record<string, unknown> = { ...(mod as Record<string, unknown>) };
    for (const name of names) {
      const fn = (mod as Record<string, (...args: unknown[]) => Promise<unknown>>)[name];
      out[name] = async (...args: unknown[]) => {
        if (failures.has(name)) {
          const err = failures.get(name);
          failures.delete(name);
          throw err;
        }
        return fn(...args);
      };
    }
    return out as T;
  }
  return { failures, storage, state, wrap };
});

vi.mock("../services/supabase.ts", () => import("../test/mocks/supabase.ts"));
vi.mock("../services/auth.ts", () => import("../test/mocks/auth.ts"));
vi.mock("../services/profiles.ts", async () => {
  const mock = await import("../test/mocks/profiles.ts");
  return {
    ...ctl.wrap(mock, ["updateProfile"]),
    getMyProfile: async () => ctl.state.me ?? mock.getMyProfile(),
    listCompanyProfiles: async (companyId: string) => [
      ...(await mock.listCompanyProfiles(companyId)),
      ...ctl.state.extraProfiles.filter((p) => p.company_id === companyId),
    ],
  };
});
vi.mock("../services/companies.ts", () => import("../test/mocks/companies.ts"));
vi.mock("../services/invitations.ts", async () => ctl.wrap(await import("../test/mocks/invitations.ts"), ["deleteInvitation"]));
vi.mock("../services/gsr.ts", async () =>
  ctl.wrap(await import("../test/mocks/gsr.ts"), ["updateGoal", "deleteGoal", "updateCompanyGoal", "deleteCompanyGoal"]),
);
vi.mock("../services/sops.ts", async () => ctl.wrap(await import("../test/mocks/sops.ts"), ["deleteSop"]));
vi.mock("../services/resources.ts", async () => ctl.wrap(await import("../test/mocks/resources.ts"), ["updateResource", "createResource"]));
vi.mock("../services/storage.ts", async () => {
  const mock = await import("../test/mocks/storage.ts");
  return {
    ...mock,
    uploadFile: async (path: string) => {
      ctl.storage.push(`uploadFile:${path}`);
    },
    removeFile: async (path: string) => {
      ctl.storage.push(`removeFile:${path}`);
    },
  };
});
vi.mock("../services/financials.ts", () => import("../test/mocks/financials.ts"));
vi.mock("../services/marketing.ts", () => import("../test/mocks/marketing.ts"));
vi.mock("../services/employees.ts", () => import("../test/mocks/employees.ts"));
vi.mock("../services/deliverables.ts", () => import("../test/mocks/deliverables.ts"));
vi.mock("../services/jobRoles.ts", () => import("../test/mocks/jobRoles.ts"));
vi.mock("../services/connections.ts", () => import("../test/mocks/connections.ts"));
vi.mock("../services/projects.ts", () => import("../test/mocks/projects.ts"));
vi.mock("../services/externalLinks.ts", () => import("../test/mocks/externalLinks.ts"));
vi.mock("../services/focusTopics.ts", () => import("../test/mocks/focusTopics.ts"));
vi.mock("../services/scorecards.ts", () => import("../test/mocks/scorecards.ts"));
vi.mock("../services/divisions.ts", () => import("../test/mocks/divisions.ts"));
vi.mock("../services/projectAssignments.ts", () => import("../test/mocks/projectAssignments.ts"));
vi.mock("../services/reviewProjectNotes.ts", () => import("../test/mocks/reviewProjectNotes.ts"));

import { renderWithHub } from "../test/renderWithHub.tsx";
import { KLASIK, makeHub } from "../test/fixtures.ts";
import App from "../App.tsx";
import PeoplePage from "./people/PeoplePage.tsx";
import MyGoalsPage from "./gsr/MyGoalsPage.tsx";
import GoalsPage from "./gsr/GoalsPage.tsx";
import SopPage from "./sops/SopPage.tsx";
import ResourcesPage from "./resources/ResourcesPage.tsx";

const admin = makeHub("admin");
const employee = makeHub("employee");

// What PostgREST hands back when the database refuses a write: the request arrived, nothing
// changed. A dropped connection comes back with an empty code, because nobody can say.
const refused = (message: string) => ({ message, code: "23514", details: "", hint: "" });
const dropped = () => ({ message: "TypeError: Failed to fetch", code: "", details: "", hint: "" });

function dialog(): HTMLElement {
  return screen.getByRole("dialog");
}

describe("holding screen for an account with no company", () => {
  it("says a Rococo admin places the account, not that an invitation will", async () => {
    // Invitations are read only when an account is created. Someone whose company was deleted, or
    // who was set to No company, already has one, so another invitation never reaches them.
    ctl.state.me = { ...KLASIK.profiles[1], id: "unplaced-1", email: "left.over@example.com", company_id: null };
    window.history.pushState({}, "", "/");
    try {
      render(<App />);
      expect(await screen.findByRole("heading", { name: "Your account is ready" })).toBeInTheDocument();
      expect(screen.getByText(/left\.over@example\.com/)).toHaveTextContent(/Rococo Creative/);
      expect(screen.queryByText(/send you an invitation/)).not.toBeInTheDocument();
    } finally {
      ctl.state.me = null;
    }
  });
});

describe("people", () => {
  it("lets an admin deactivate someone who has never signed in, and not themselves", async () => {
    const user = userEvent.setup();
    renderWithHub(<PeoplePage />, admin);
    // Taylor Reed is on the roster with no account and no invitation, on a company domain: the
    // domain alone lets them sign in, so switching them off is the only way to keep them out.
    const deactivate = await screen.findByRole("button", { name: "Deactivate Taylor Reed" });
    expect(screen.getByRole("button", { name: "Deactivate Avery Cole" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Deactivate Jordan Vale/ })).not.toBeInTheDocument();

    await user.click(deactivate);
    const reactivate = await screen.findByRole("button", { name: "Reactivate Taylor Reed" });
    const row = reactivate.closest("tr") as HTMLElement;
    expect(within(row).getByText("Inactive")).toBeInTheDocument();
    // Inviting someone who is switched off would only land them on the inactive screen.
    expect(within(row).queryByRole("button", { name: /Send the invitation/ })).not.toBeInTheDocument();

    await user.click(reactivate);
    expect(await screen.findByRole("button", { name: "Deactivate Taylor Reed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send the invitation to Taylor Reed" })).toBeInTheDocument();
  });

  it("leaves a Rococo admin's role and access alone", async () => {
    ctl.state.extraProfiles = [
      {
        ...KLASIK.profiles[1],
        id: "rococo-on-klasik",
        user_id: "rococo-on-klasik-auth",
        email: "am@rocococreative.io",
        full_name: "Robin Account",
        is_rococo_admin: true,
      },
    ];
    try {
      renderWithHub(<PeoplePage />, admin);
      const name = await screen.findByText("Robin Account");
      const row = name.closest("tr") as HTMLElement;
      expect(within(row).queryByRole("combobox")).not.toBeInTheDocument();
      expect(within(row).queryByRole("button", { name: /Deactivate|Reactivate/ })).not.toBeInTheDocument();
      expect(within(row).getByText("Rococo Creative")).toBeInTheDocument();
      // Everyone else keeps their controls.
      expect(screen.getByRole("combobox", { name: "Role for Taylor Reed" })).toBeInTheDocument();
    } finally {
      ctl.state.extraProfiles = [];
    }
  });

  it("says what cancelling an invitation and removing someone really do", async () => {
    const user = userEvent.setup();
    renderWithHub(<PeoplePage />, admin);
    await user.click(await screen.findByRole("button", { name: "Cancel the invitation for Avery Cole" }));
    // The address is on a company domain, so the domain still lets them in after a cancel.
    expect(dialog()).toHaveTextContent(/sign-in domains/);
    expect(dialog()).toHaveTextContent(/deactivate/i);
    expect(dialog()).not.toHaveTextContent(/link stops working/);
    await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: "Remove Taylor Reed" }));
    // Removing deletes the reviews, goals, KPIs and pay set up for them.
    expect(dialog()).toHaveTextContent(/reviews/);
    expect(dialog()).toHaveTextContent(/goals/);
    expect(dialog()).not.toHaveTextContent(/nothing they did is lost/);
    await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));
  });

  it("opens a confirm dialog clean after an unrelated failure, and shows its own", async () => {
    const user = userEvent.setup();
    renderWithHub(<PeoplePage />, admin);
    ctl.failures.set("updateProfile", new Error("The role did not save."));
    await user.selectOptions(await screen.findByRole("combobox", { name: "Role for Taylor Reed" }), "admin");
    expect(await screen.findByText("The role did not save.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel the invitation for Avery Cole" }));
    expect(within(dialog()).queryByText("The role did not save.")).not.toBeInTheDocument();

    ctl.failures.set("deleteInvitation", new Error("The invitation could not be cancelled."));
    await user.click(within(dialog()).getByRole("button", { name: "Cancel invitation" }));
    expect(await within(dialog()).findByText("The invitation could not be cancelled.")).toBeInTheDocument();
    await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: "Remove Taylor Reed" }));
    expect(within(dialog()).queryByText("The invitation could not be cancelled.")).not.toBeInTheDocument();
    await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));
  });
});

describe("goals", () => {
  it("opens the delete dialog clean after a completion save failed", async () => {
    const user = userEvent.setup();
    renderWithHub(<MyGoalsPage />, employee);
    const slider = await screen.findByLabelText("Completion for Get the OSHA 30 certification");
    ctl.failures.set("updateGoal", new Error("The completion did not save."));
    fireEvent.change(slider, { target: { value: "60" } });
    fireEvent.keyUp(slider);
    expect(await screen.findByText("The completion did not save.")).toBeInTheDocument();

    const card = screen.getByText("Get the OSHA 30 certification").closest("li") as HTMLElement;
    await user.click(within(card).getByRole("button", { name: "Delete goal" }));
    expect(within(dialog()).queryByText("The completion did not save.")).not.toBeInTheDocument();

    ctl.failures.set("deleteGoal", new Error("The goal could not be deleted."));
    await user.click(within(dialog()).getByRole("button", { name: "Delete goal" }));
    expect(await within(dialog()).findByText("The goal could not be deleted.")).toBeInTheDocument();
    await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps a company goal's delete dialog to its own failure, and clears a stale one", async () => {
    const user = userEvent.setup();
    renderWithHub(<GoalsPage tab="company" />, admin);
    const hit = await screen.findAllByRole("button", { name: "Mark hit" });
    ctl.failures.set("updateCompanyGoal", new Error("The hit did not save."));
    await user.click(hit[0]);
    expect(await screen.findByText("The hit did not save.")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Delete goal" })[0]);
    expect(within(dialog()).queryByText("The hit did not save.")).not.toBeInTheDocument();
    ctl.failures.set("deleteCompanyGoal", new Error("The goal could not be deleted."));
    await user.click(within(dialog()).getByRole("button", { name: "Delete goal" }));
    expect(await within(dialog()).findByText("The goal could not be deleted.")).toBeInTheDocument();
    await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    await user.click(screen.getAllByRole("button", { name: "Delete goal" })[0]);
    expect(within(dialog()).queryByText("The goal could not be deleted.")).not.toBeInTheDocument();
    await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));

    // The next toggle that saves takes the old failure off the page.
    await user.click(screen.getAllByRole("button", { name: "Mark hit" })[0]);
    await waitFor(() => expect(screen.queryByText("The hit did not save.")).not.toBeInTheDocument());
  });
});

describe("library files", () => {
  it("keeps an SOP's files when the SOP itself could not be deleted", async () => {
    const user = userEvent.setup();
    const sop = KLASIK.sops[0];
    renderWithHub(<SopPage />, admin, { path: `/sops/${sop.id}`, pattern: "/sops/:sopId" });
    await user.click(await screen.findByRole("button", { name: /Delete/ }));
    ctl.storage.length = 0;
    ctl.failures.set("deleteSop", refused("permission denied for table sops"));
    await user.click(within(dialog()).getByRole("button", { name: "Delete SOP" }));
    // The refusal shows where the person is looking, and the attachment's file is untouched.
    expect(await within(dialog()).findByText("permission denied for table sops")).toBeInTheDocument();
    expect(ctl.storage.filter((call) => call.startsWith("removeFile:"))).toEqual([]);
    expect(screen.getByText("Safety-walk-checklist.pdf")).toBeInTheDocument();
  });

  it("removes an SOP's files only after the SOP is gone", async () => {
    const user = userEvent.setup();
    const sop = KLASIK.sops[0];
    renderWithHub(<SopPage />, admin, { path: `/sops/${sop.id}`, pattern: "/sops/:sopId" });
    await user.click(await screen.findByRole("button", { name: /Delete/ }));
    ctl.storage.length = 0;
    await user.click(within(dialog()).getByRole("button", { name: "Delete SOP" }));
    expect(await screen.findByText("elsewhere")).toBeInTheDocument();
    expect(ctl.storage).toEqual([`removeFile:${KLASIK.attachments[0].file_path}`]);
  });

  it("replaces a resource's file only once the row points at the new one", async () => {
    const user = userEvent.setup();
    renderWithHub(<ResourcesPage tab="files" />, admin);
    const companyId = KLASIK.company.id;
    const first = new File(["one"], "First.pdf", { type: "application/pdf" });
    const second = new File(["two"], "Second.pdf", { type: "application/pdf" });
    const third = new File(["three"], "Third.pdf", { type: "application/pdf" });
    const firstPath = `${companyId}/resources/mock-First.pdf`;
    const secondPath = `${companyId}/resources/mock-Second.pdf`;
    const thirdPath = `${companyId}/resources/mock-Third.pdf`;

    // A template with a file and no link.
    await user.click(await screen.findByRole("button", { name: /Add resource/ }));
    await user.type(screen.getByLabelText("Title"), "Punch list form");
    await user.selectOptions(screen.getByLabelText("Kind"), "template");
    await user.upload(screen.getByLabelText("File"), first);
    await user.click(within(dialog()).getByRole("button", { name: "Add resource" }));
    const card = (await screen.findByText("Punch list form")).closest("li") as HTMLElement;

    // The database refuses the edit: the row still names the first file, so it stays, and the
    // upload nobody points at goes.
    ctl.storage.length = 0;
    await user.click(within(card).getByRole("button", { name: "Edit resource" }));
    await user.upload(screen.getByLabelText("File"), second);
    ctl.failures.set("updateResource", refused("new row violates check constraint"));
    await user.click(within(dialog()).getByRole("button", { name: "Save" }));
    expect(await within(dialog()).findByText(/will not save as entered/)).toBeInTheDocument();
    expect(ctl.storage).toEqual([`uploadFile:${secondPath}`, `removeFile:${secondPath}`]);

    // The connection drops: the row may have saved, so neither file is touched.
    ctl.storage.length = 0;
    ctl.failures.set("updateResource", dropped());
    await user.click(within(dialog()).getByRole("button", { name: "Save" }));
    expect(await within(dialog()).findByText(/connection dropped/)).toBeInTheDocument();
    expect(ctl.storage).toEqual([`uploadFile:${secondPath}`]);

    // It saves: only now does the old file go.
    ctl.storage.length = 0;
    await user.upload(screen.getByLabelText("File"), third);
    await user.click(within(dialog()).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(ctl.storage).toEqual([`uploadFile:${thirdPath}`, `removeFile:${firstPath}`]);
  });
});
