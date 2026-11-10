// The review page and the scoring around it, held to what a signed-off review promises: it is
// the record, so it reads as it was signed off (its criteria, its headings, its line items) and
// nothing on it moves until it is reopened. Also the company wall on a person's review history,
// and a retired job role bringing nothing new into a month. Kept apart from pages.test.tsx so
// the mocked data these tests change never reaches the tests there.
import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../services/supabase.ts", () => import("../test/mocks/supabase.ts"));
vi.mock("../services/auth.ts", () => import("../test/mocks/auth.ts"));
vi.mock("../services/profiles.ts", () => import("../test/mocks/profiles.ts"));
vi.mock("../services/companies.ts", () => import("../test/mocks/companies.ts"));
vi.mock("../services/invitations.ts", () => import("../test/mocks/invitations.ts"));
vi.mock("../services/gsr.ts", () => import("../test/mocks/gsr.ts"));
vi.mock("../services/sops.ts", () => import("../test/mocks/sops.ts"));
vi.mock("../services/resources.ts", () => import("../test/mocks/resources.ts"));
vi.mock("../services/storage.ts", () => import("../test/mocks/storage.ts"));
vi.mock("../services/financials.ts", () => import("../test/mocks/financials.ts"));
vi.mock("../services/marketing.ts", () => import("../test/mocks/marketing.ts"));
vi.mock("../services/employees.ts", () => import("../test/mocks/employees.ts"));
vi.mock("../services/deliverables.ts", () => import("../test/mocks/deliverables.ts"));
vi.mock("../services/jobRoles.ts", () => import("../test/mocks/jobRoles.ts"));
vi.mock("../services/connections.ts", () => import("../test/mocks/connections.ts"));

import { renderWithHub } from "../test/renderWithHub.tsx";
import { createCriterion, createPillar, deleteCriterion, ensureReview, updateCriterion, updateReview } from "../services/gsr.ts";
import { updateJobRole } from "../services/jobRoles.ts";
import { KLASIK, RBA, makeHub } from "../test/fixtures.ts";
import ReviewPage from "./gsr/ReviewPage.tsx";
import MyReviewsPage from "./gsr/MyReviewsPage.tsx";

const admin = makeHub("admin");
const rbaAdmin = makeHub("admin", RBA.company);
const rbaEmployee = makeHub("employee", RBA.company);
// RBA runs quarterly, so its reviews are the scored shape. Jamie's Q3 review is open; Noor's
// was signed off with every criterion rated, in a cycle that is still open.
const rbaReview = RBA.reviews.find((r) => r.status === "in_progress")!;
const signedOff = RBA.reviews.find((r) => r.status === "complete" && r.cycle_id === RBA.cycles[0].id)!;
const klasikMonth = KLASIK.reviews.find((r) => r.status === "in_progress")!;
const at = (review: { id: string }) => ({ path: `/gsr/reviews/${review.id}`, pattern: "/gsr/reviews/:reviewId" });
const sectionFor = async (name: string) => (await screen.findByRole("heading", { name })).closest("section") as HTMLElement;

describe("a person's review history", () => {
  it("lists only the reviews of the company they are viewed in", async () => {
    // Jamie once worked at Klasik. A person who moves keeps their old reviews with the old company,
    // and the database still lets them read their own, so the history has to ask for this
    // company's: a Klasik review here has no cycle to name it and an Open link that fails.
    const jamie = RBA.profiles[1];
    await ensureReview(KLASIK.cycles[1].id, KLASIK.company.id, jamie.id);
    renderWithHub(<MyReviewsPage />, rbaEmployee);
    expect(await screen.findByText("All reviews")).toBeInTheDocument();
    expect((await screen.findAllByText(RBA.cycles[0].name)).length).toBeGreaterThan(0);
    expect(screen.queryByText("Review", { exact: true })).not.toBeInTheDocument();
  });
});

describe("a signed-off review", () => {
  it("is read-only until it is reopened: line items, notes, feedback and the period's goals", async () => {
    renderWithHub(<ReviewPage />, rbaAdmin, at(signedOff));
    const performance = await sectionFor("Performance");
    expect(within(performance).getAllByRole("textbox").length).toBeGreaterThan(0);
    for (const box of within(performance).getAllByRole("textbox")) expect(box).toBeDisabled();
    expect(within(performance).queryByRole("button", { name: "Remove deliverable" })).not.toBeInTheDocument();
    expect(within(performance).queryByRole("button", { name: /Add deliverable/ })).not.toBeInTheDocument();
    for (const note of screen.getAllByPlaceholderText("Review notes for this criterion")) expect(note).toBeDisabled();
    expect(screen.getByLabelText("Management feedback")).toBeDisabled();
    expect(screen.getByLabelText("Client feedback")).toBeDisabled();
    expect(screen.getByLabelText("Previous period goals")).toBeDisabled();
    // Reopening is the way back in.
    expect(screen.getByRole("button", { name: /Reopen/ })).toBeEnabled();
  });

  it("keeps an open review in the same cycle editable", async () => {
    renderWithHub(<ReviewPage />, rbaAdmin, at(rbaReview));
    const performance = await sectionFor("Performance");
    expect(within(performance).getAllByRole("button", { name: "Remove deliverable" }).length).toBeGreaterThan(0);
    expect(within(performance).getByRole("button", { name: /Add deliverable/ })).toBeEnabled();
    expect(screen.getByLabelText("Management feedback")).toBeEnabled();
  });

  it("lists the criteria it was rated on, not today's active set", async () => {
    // Retiring a criterion is how a company takes it out of use, and adding one is ordinary
    // upkeep. Neither may change what a signed-off review shows beside the score it still counts.
    const ownership = RBA.criteria.find((c) => c.name === "Ownership")!;
    await updateCriterion(ownership.id, { is_active: false });
    const added = await createCriterion({ pillar_id: ownership.pillar_id, company_id: RBA.company.id, name: "Punctuality", sort_order: 9 });
    try {
      const signed = renderWithHub(<ReviewPage />, rbaAdmin, at(signedOff));
      const values = await sectionFor("Core Values");
      expect(within(values).getByLabelText("Ownership rating")).toBeInTheDocument();
      expect(within(values).getByLabelText("Craftsmanship rating")).toBeInTheDocument();
      expect(within(values).queryByLabelText("Punctuality rating")).not.toBeInTheDocument();
      signed.unmount();

      // An open review reads today's criteria: the retired one is gone, the new one waits.
      renderWithHub(<ReviewPage />, rbaAdmin, at(rbaReview));
      const open = await sectionFor("Core Values");
      expect(within(open).queryByLabelText("Ownership rating")).not.toBeInTheDocument();
      expect(within(open).getByLabelText("Punctuality rating")).toBeInTheDocument();
    } finally {
      await updateCriterion(ownership.id, { is_active: true });
      await deleteCriterion(added.id);
    }
  });
});

describe("a retired job role", () => {
  it("brings its goals into a month only while the role is active", async () => {
    const role = KLASIK.jobRoles[0];
    const live = renderWithHub(<ReviewPage />, admin, at(klasikMonth));
    expect(await screen.findByRole("button", { name: /Add role goals/ })).toBeInTheDocument();
    live.unmount();

    await updateJobRole(role.id, { is_active: false });
    try {
      renderWithHub(<ReviewPage />, admin, at(klasikMonth));
      expect(await screen.findByText("Goals for this month")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Add role goals/ })).not.toBeInTheDocument();
    } finally {
      await updateJobRole(role.id, { is_active: true });
    }
  });
});

// Last, because it adds a pillar to RBA and signs Jamie's review off.
describe("a review signed off with no month locked in", () => {
  it("is headed as a score of record, and its Monthly GSRs bar reads as sitting out like the pillar card", async () => {
    await createPillar({ company_id: RBA.company.id, name: "Monthly GSRs", weight: 20, scoring_type: "gsr_goals", required_goals: 2, sort_order: 4 });
    await updateReview(rbaReview.id, { status: "complete", completed_at: new Date().toISOString(), reviewer_id: RBA.profiles[0].id });
    renderWithHub(<ReviewPage />, rbaAdmin, at(rbaReview));
    const overall = await sectionFor("Score");
    expect(screen.queryByRole("heading", { name: "Score so far" })).not.toBeInTheDocument();
    expect(within(overall).getByText("Monthly GSRs (left out)")).toBeInTheDocument();
    expect(within(overall).getByText("No month locked in")).toBeInTheDocument();
    expect(within(overall).queryByText("Not scored")).not.toBeInTheDocument();
    expect(within(await sectionFor("Monthly GSRs")).getByText(/so this pillar was left out and the other pillars carried its weight/)).toBeInTheDocument();
  });

  it("reads the same on the person's My reviews card that links to it", async () => {
    // Same state as above: the card is the score of record one click away from the review page,
    // so it says the pillar sat out rather than "Not scored".
    renderWithHub(<MyReviewsPage />, rbaEmployee);
    const card = await sectionFor(RBA.cycles[0].name);
    expect(within(card).getByText("Latest scored review")).toBeInTheDocument();
    expect(within(card).getByText("Monthly GSRs (left out)")).toBeInTheDocument();
    expect(within(card).getByText("No month locked in")).toBeInTheDocument();
    expect(within(card).queryByText("Not scored")).not.toBeInTheDocument();
  });
});
