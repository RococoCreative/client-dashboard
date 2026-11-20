// The places that used to count GSR months, for a company on demand: a scored review's Monthly GSRs
// pillar reads the GSRs done inside its period (and keeps its number once signed off), the division
// comparison counts the GSRs done in its month, the Rococo portfolio shows this week's, and Rococo,
// Companies says which format each company is on, as text. Each test reads the in-memory data layer
// the way the page does, acting as the person the hub was rendered for.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, onTestFinished, vi } from "vitest";

vi.mock("../services/supabase.ts", () => import("../test/mocks/supabase.ts"));
vi.mock("../services/auth.ts", () => import("../test/mocks/auth.ts"));
vi.mock("../services/profiles.ts", () => import("../test/mocks/profiles.ts"));
vi.mock("../services/companies.ts", () => import("../test/mocks/companies.ts"));
vi.mock("../services/invitations.ts", () => import("../test/mocks/invitations.ts"));
vi.mock("../services/gsr.ts", () => import("../test/mocks/gsr.ts"));
vi.mock("../services/gsrOnDemand.ts", () => import("../test/mocks/gsrOnDemand.ts"));
vi.mock("../services/sops.ts", () => import("../test/mocks/sops.ts"));
vi.mock("../services/resources.ts", () => import("../test/mocks/resources.ts"));
vi.mock("../services/storage.ts", () => import("../test/mocks/storage.ts"));
vi.mock("../services/financials.ts", () => import("../test/mocks/financials.ts"));
vi.mock("../services/marketing.ts", () => import("../test/mocks/marketing.ts"));
vi.mock("../services/employees.ts", () => import("../test/mocks/employees.ts"));
vi.mock("../services/deliverables.ts", () => import("../test/mocks/deliverables.ts"));
vi.mock("../services/jobRoles.ts", () => import("../test/mocks/jobRoles.ts"));
vi.mock("../services/connections.ts", () => import("../test/mocks/connections.ts"));
vi.mock("../services/audit.ts", () => import("../test/mocks/audit.ts"));
vi.mock("../services/projects.ts", () => import("../test/mocks/projects.ts"));
vi.mock("../services/wins.ts", () => import("../test/mocks/wins.ts"));
vi.mock("../services/sync.ts", () => import("../test/mocks/sync.ts"));
vi.mock("../services/externalLinks.ts", () => import("../test/mocks/externalLinks.ts"));
vi.mock("../services/focusTopics.ts", () => import("../test/mocks/focusTopics.ts"));
vi.mock("../services/scorecards.ts", () => import("../test/mocks/scorecards.ts"));
vi.mock("../services/divisions.ts", () => import("../test/mocks/divisions.ts"));
vi.mock("../services/directory.ts", () => import("../test/mocks/directory.ts"));
vi.mock("../services/projectAssignments.ts", () => import("../test/mocks/projectAssignments.ts"));
vi.mock("../services/reviewProjectNotes.ts", () => import("../test/mocks/reviewProjectNotes.ts"));
vi.mock("../services/tasks.ts", () => import("../test/mocks/tasks.ts"));
vi.mock("../services/capabilities.ts", () => import("../test/mocks/capabilities.ts"));

import { createPillar, deletePillar, deleteScore, ensureReview, listReviewScores, updateReview } from "../services/gsr.ts";
import { markGsrDone, reopenGsr, seedMockGsr, setMockGsrMode } from "../test/mocks/gsrOnDemand.ts";
import { COMPANIES, RBA, makeHub } from "../test/fixtures.ts";
import { renderWithHub } from "../test/renderWithHub.tsx";
import type { Gsr } from "../types/database.ts";
import MyReviewsPage from "./gsr/MyReviewsPage.tsx";
import PersonPage from "./people/PersonPage.tsx";
import ReviewPage from "./gsr/ReviewPage.tsx";
import ScorecardsPage from "./gsr/ScorecardsPage.tsx";
import CompaniesPage from "./rococo/CompaniesPage.tsx";
import PortfolioPage from "./rococo/PortfolioPage.tsx";

const onDemand = { ...RBA.company, gsr_mode: "on_demand" as const };
const admin = makeHub("admin", onDemand);
const alex = admin.profile;
const [, jamie, noor] = RBA.profiles;
// Q3 2026, July 1 to September 30, open; Jamie's review in it is open.
const q3 = RBA.cycles[0];
const jamieReview = RBA.reviews.find((r) => r.cycle_id === q3.id && r.employee_id === jamie.id)!;

function seed(employeeId: string, row: Partial<Gsr> = {}): Gsr {
  return seedMockGsr({ company_id: RBA.company.id, employee_id: employeeId, started_on: "2026-08-03", status: "in_progress", ...row });
}
function done(employeeId: string, doneOn: string, score: number | null): Gsr {
  return seed(employeeId, { started_on: doneOn, status: "complete", done_on: doneOn, completed_at: `${doneOn}T15:00:00.000Z`, gsr_score: score, reviewer_id: alex.id });
}
// A Monthly GSRs pillar, gone after the test with any line item it left on Jamie's review.
async function scoresGsrs() {
  const pillar = await createPillar({ company_id: RBA.company.id, name: "Monthly GSRs", weight: 20, scoring_type: "gsr_goals", required_goals: 2, sort_order: 4 });
  onTestFinished(async () => {
    for (const s of (await listReviewScores(jamieReview.id)).filter((x) => x.pillar_id === pillar.id)) await deleteScore(s.id);
    await deletePillar(pillar.id);
  });
  return pillar;
}
const renderReview = () => renderWithHub(<ReviewPage />, admin, { path: `/reviews/${jamieReview.id}`, pattern: "/reviews/:reviewId" });
const pillarSection = async () => (await screen.findByRole("heading", { name: "Monthly GSRs" })).closest("section") as HTMLElement;

describe("a scored review in a company on demand", () => {
  it("scores a review's GSR pillar from the GSRs done inside its period", async () => {
    setMockGsrMode(RBA.company.id, "on_demand");
    await scoresGsrs();
    done(jamie.id, "2026-08-10", 70);
    done(jamie.id, "2026-09-03", 90);
    // The day after the period, and one still open: neither counts.
    done(jamie.id, "2026-10-01", 10);
    seed(jamie.id, { started_on: "2026-09-14" });
    renderReview();
    const section = await pillarSection();
    await waitFor(() => expect(within(section).getByText("80")).toBeInTheDocument());
    expect(within(section).getByText("70%")).toBeInTheDocument();
    expect(within(section).getByText("90%")).toBeInTheDocument();
    expect(within(section).queryByText("10%")).not.toBeInTheDocument();
    expect(within(section).getByText("Not counted yet")).toBeInTheDocument();
    expect(within(section).getAllByRole("link")).toHaveLength(3);
    // Nothing in the pillar's body speaks of months; its name is the company's own.
    const body = within(section).getByText(/across 2 GSRs/);
    expect(body.textContent).not.toMatch(/month/i);
    expect(screen.queryByText("The months in this period")).not.toBeInTheDocument();
  });

  it("leaves the pillar out when no GSR was done", async () => {
    setMockGsrMode(RBA.company.id, "on_demand");
    await scoresGsrs();
    seed(jamie.id, { started_on: "2026-09-14" });
    renderReview();
    const section = await pillarSection();
    expect(await within(section).findByText("Left out of this review")).toBeInTheDocument();
    expect(within(section).getByText("-")).toBeInTheDocument();
    expect(within(section).getByText("Not counted yet")).toBeInTheDocument();
  });

  it("keeps a signed-off review's number when a GSR is reopened afterwards, and recalculates a review still open", async () => {
    setMockGsrMode(RBA.company.id, "on_demand");
    const pillar = await scoresGsrs();
    onTestFinished(async () => {
      await updateReview(jamieReview.id, { status: "in_progress", completed_at: null });
    });
    done(jamie.id, "2026-08-10", 70);
    const ninety = done(jamie.id, "2026-09-03", 90);

    // Open: a GSR reopened leaves the count at once.
    await reopenGsr(ninety.id);
    const first = renderReview();
    await waitFor(async () => expect(within(await pillarSection()).getByText("70")).toBeInTheDocument());
    first.unmount();
    // Marked done again, today, inside the period.
    await markGsrDone(ninety.id, 90, alex.id);
    const second = renderReview();
    await waitFor(async () => expect(within(await pillarSection()).getByText("80")).toBeInTheDocument());

    // Signed off: one line item, 100 a GSR as the target and their scores as the actual.
    await userEvent.click(screen.getByRole("button", { name: "Mark complete" }));
    expect(await screen.findByRole("button", { name: "Reopen" })).toBeInTheDocument();
    expect(await within(await pillarSection()).findByText("80% across 2 GSRs, as signed off.")).toBeInTheDocument();
    const lines = (await listReviewScores(jamieReview.id)).filter((s) => s.pillar_id === pillar.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ target: 200, actual: 160 });
    second.unmount();

    // A GSR reopened after sign-off moves nothing on the signed-off review.
    await reopenGsr(ninety.id);
    renderReview();
    const later = await pillarSection();
    expect(await within(later).findByText("80% across 2 GSRs, as signed off.")).toBeInTheDocument();
    expect(within(later).getByText("80")).toBeInTheDocument();
  });
});

describe("signing off with no scored GSR in the period", () => {
  // Signs off through the dialog that warns the pillar will sit out, then checks what was frozen.
  async function signOffLeftOut(pillarId: string, dialogLine: RegExp) {
    renderReview();
    await screen.findByRole("heading", { name: "Monthly GSRs" });
    await userEvent.click(await screen.findByRole("button", { name: "Mark complete" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Sign off without GSRs?" })).toBeInTheDocument();
    expect(within(dialog).getByText(dialogLine)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Mark complete" }));
    expect(await screen.findByRole("button", { name: "Reopen" })).toBeInTheDocument();
    // No Monthly GSRs line item is written, so the pillar sat out of the score of record.
    expect((await listReviewScores(jamieReview.id)).filter((s) => s.pillar_id === pillarId)).toHaveLength(0);
    const section = await pillarSection();
    expect(within(section).getByText("Left out of this review")).toBeInTheDocument();
    expect(within(section).getByText("-")).toBeInTheDocument();
    expect(within(section).getByText("No GSR inside this period was done when it was signed off, so this pillar was left out and the other pillars carried its weight.")).toBeInTheDocument();
    // The overall card's bar says why it is empty, without a month.
    const bar = screen.getByText("Monthly GSRs (left out)").parentElement as HTMLElement;
    expect(within(bar).getByText("No GSR done")).toBeInTheDocument();
    expect(screen.queryByText("No month locked in")).not.toBeInTheDocument();
  }

  it("writes no line item when no GSR was done, and reads No GSR done", async () => {
    setMockGsrMode(RBA.company.id, "on_demand");
    const pillar = await scoresGsrs();
    onTestFinished(async () => {
      await updateReview(jamieReview.id, { status: "in_progress", completed_at: null });
    });
    seed(jamie.id, { started_on: "2026-09-14" });
    await signOffLeftOut(pillar.id, /^No scored GSR was done in Q3 2026, so Monthly GSRs is left out/);
  });

  it("treats a GSR done with no score the same, and lists it as done with no score", async () => {
    setMockGsrMode(RBA.company.id, "on_demand");
    const pillar = await scoresGsrs();
    onTestFinished(async () => {
      await updateReview(jamieReview.id, { status: "in_progress", completed_at: null });
    });
    done(jamie.id, "2026-09-03", null);
    const open = renderReview();
    const section = await pillarSection();
    expect(await within(section).findByText("Done Sep 3, 2026, with no score")).toBeInTheDocument();
    expect(within(section).getByText("Left out of this review")).toBeInTheDocument();
    open.unmount();
    await signOffLeftOut(pillar.id, /^No scored GSR was done in Q3 2026/);
  });
});

describe("My reviews for a review signed off with the GSR pillar left out", () => {
  async function signedOffFresh(hub: ReturnType<typeof makeHub>) {
    const pillar = await scoresGsrs();
    const fresh = { ...hub.profile, id: "rba-fresh-person", full_name: "Robin Fresh" };
    const review = await ensureReview(q3.id, RBA.company.id, fresh.id);
    await updateReview(review.id, { status: "complete", completed_at: new Date().toISOString(), reviewer_id: alex.id });
    onTestFinished(async () => {
      await updateReview(review.id, { status: "in_progress", completed_at: null });
    });
    renderWithHub(<MyReviewsPage />, { ...hub, profile: fresh });
    const card = (await screen.findByRole("heading", { name: q3.name })).closest("section") as HTMLElement;
    return { pillar, bar: within(card).getByText("Monthly GSRs (left out)").parentElement as HTMLElement };
  }

  it("shows No GSR done in a company on demand", async () => {
    setMockGsrMode(RBA.company.id, "on_demand");
    const { bar } = await signedOffFresh(makeHub("employee", onDemand));
    expect(within(bar).getByText("No GSR done")).toBeInTheDocument();
    // The bar's label is the pillar's own name; what it says about the pillar has no month.
    expect(within(bar).queryByText("No month locked in")).not.toBeInTheDocument();
  });

  it("keeps today's text for a company on periods", async () => {
    const { bar } = await signedOffFresh(makeHub("employee", RBA.company));
    expect(within(bar).getByText("No month locked in")).toBeInTheDocument();
    expect(within(bar).queryByText("No GSR done")).not.toBeInTheDocument();
  });
});

describe("a person's Reviews tab in a company on demand", () => {
  it("reads the same figure as the open scored review", async () => {
    setMockGsrMode(RBA.company.id, "on_demand");
    await scoresGsrs();
    done(jamie.id, "2026-08-10", 70);
    done(jamie.id, "2026-09-03", 90);
    seed(jamie.id, { started_on: "2026-09-14" });
    renderWithHub(<PersonPage />, admin, { path: `/people/${jamie.id}/reviews`, pattern: "/people/:profileId/:tab?" });
    const line = (await screen.findByText(`GSRs, ${q3.name}`)).parentElement!.parentElement as HTMLElement;
    expect(within(line).getByText("80%")).toBeInTheDocument();
    expect(within(line).getByText("2 GSRs done so far; written into the review when it is signed off.")).toBeInTheDocument();
    expect(screen.queryByText(`Monthly GSRs, ${q3.name}`)).not.toBeInTheDocument();
  });
});

describe("the division comparison in a company on demand", () => {
  it("shows GSRs done this month in the division comparison", async () => {
    setMockGsrMode(RBA.company.id, "on_demand");
    done(jamie.id, "2026-09-03", 80);
    done(jamie.id, "2026-09-10", 60);
    done(noor.id, "2026-09-08", 90);
    // Last month, and one open: neither is done this month.
    done(noor.id, "2026-08-28", 70);
    seed(noor.id, { started_on: "2026-09-14" });
    renderWithHub(<ScorecardsPage />, admin);
    const strip = await screen.findByRole("region", { name: "Division compare" });
    const doneIn = (label: string) => within(within(strip).getByRole("listitem", { name: label })).getByText("GSRs done").nextElementSibling;
    await waitFor(() => expect(doneIn("Combined")).toHaveTextContent("3"));
    expect(doneIn("RBA South")).toHaveTextContent("2");
    expect(doneIn("RBA North")).toHaveTextContent("1");
    expect(within(strip).queryByText("Reviews complete")).not.toBeInTheDocument();
  });

  it("keeps Reviews complete for a company on periods", async () => {
    renderWithHub(<ScorecardsPage />, makeHub("admin", RBA.company));
    const strip = await screen.findByRole("region", { name: "Division compare" });
    expect(within(strip).getAllByText("Reviews complete").length).toBeGreaterThan(0);
    expect(within(strip).queryByText("GSRs done")).not.toBeInTheDocument();
  });
});

describe("Rococo", () => {
  const rococo = makeHub("rococo", null);

  it("shows the GSR format on Rococo, Companies as text with no control", async () => {
    setMockGsrMode(RBA.company.id, "on_demand");
    renderWithHub(<CompaniesPage />, rococo, { path: "/rococo/companies", pattern: "/rococo/companies" });
    const rba = (await screen.findByRole("heading", { name: "RBA Projects" })).closest("section") as HTMLElement;
    const klasik = screen.getByRole("heading", { name: "Klasik Construction" }).closest("section") as HTMLElement;
    expect(within(rba).getByText("GSR format").nextElementSibling).toHaveTextContent("On demand");
    expect(within(klasik).getByText("GSR format").nextElementSibling).toHaveTextContent("By month");
    expect(screen.queryByRole("button", { name: /GSR format/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/GSR format/i)).not.toBeInTheDocument();
  });

  it("shows this week's GSRs on the portfolio for a company on demand", async () => {
    setMockGsrMode(RBA.company.id, "on_demand");
    // Monday September 14 to Sunday September 20, 2026.
    done(jamie.id, "2026-09-14", 70);
    done(noor.id, "2026-09-15", 90);
    done(noor.id, "2026-09-11", 10);
    const hub = { ...rococo, companies: COMPANIES.map((c) => (c.id === RBA.company.id ? onDemand : c)) };
    renderWithHub(<PortfolioPage />, hub, { path: "/rococo", pattern: "/rococo" });
    const card = (await screen.findByRole("heading", { name: "RBA Projects" })).closest("li") as HTMLElement;
    const signal = (await within(card).findByText("GSRs this week")).parentElement as HTMLElement;
    expect(within(signal).getByText("2 done")).toBeInTheDocument();
    expect(within(signal).getByText("Average 80")).toBeInTheDocument();
    for (const other of COMPANIES.filter((c) => c.id !== RBA.company.id)) {
      const otherCard = screen.getByRole("heading", { name: other.name }).closest("li") as HTMLElement;
      expect(within(otherCard).queryByText("GSRs this week")).not.toBeInTheDocument();
    }
  });
});
