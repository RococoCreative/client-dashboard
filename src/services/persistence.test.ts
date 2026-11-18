// Writes that change a known row have to say when nothing changed. A delete that RLS filtered out,
// or that found the row already gone, comes back from PostgREST with no error and no rows, and
// used to read as a success. These pin the services that now ask for the row back, the two-step
// writes that take their first step back when the second fails, and an invitation sent to an
// address whose earlier invitation was already spent. The database is a small fake that records
// what was asked of it and answers from a script; nothing reaches the network.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Answer = { data: unknown; error: unknown };

const fake = vi.hoisted(() => ({
  calls: [] as string[],
  // Answers by "table op", taken in order; a missing one is a plain success with no rows.
  answers: {} as Record<string, Answer[]>,
}));

vi.mock("./supabase.ts", () => {
  function builder(table: string) {
    let op = "select";
    const filters: string[] = [];
    const answer = (): Answer => {
      const key = `${table} ${op}`;
      fake.calls.push(filters.length ? `${key} ${filters.join(" ")}` : key);
      return fake.answers[key]?.shift() ?? { data: [], error: null };
    };
    const chain: Record<string, unknown> = {
      select: () => chain,
      insert: () => ((op = "insert"), chain),
      update: () => ((op = "update"), chain),
      delete: () => ((op = "delete"), chain),
      eq: (column: string, value: unknown) => (filters.push(`${column}=${String(value)}`), chain),
      not: (column: string) => (filters.push(`${column} not null`), chain),
      order: () => chain,
      single: async () => answer(),
      maybeSingle: async () => answer(),
      then: (resolve: (value: Answer) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(answer()).then(resolve, reject),
    };
    return chain;
  }
  const storage = {
    from: () => ({
      remove: async (paths: string[]) => {
        fake.calls.push(`storage remove ${paths.join(",")}`);
        return fake.answers["storage remove"]?.shift() ?? { data: [], error: null };
      },
    }),
  };
  return { db: () => ({ from: builder, storage }) };
});

import { deleteCompensationItem, deleteEmployeeKpi } from "./employees.ts";
import { deleteCampaign } from "./marketing.ts";
import { createInvitation } from "./invitations.ts";
import { createProjectAndAssign } from "./projectAssignments.ts";
import { reorderMilestones } from "./projects.ts";
import { removeFile } from "./storage.ts";

function answer(key: string, ...answers: Answer[]) {
  fake.answers[key] = [...(fake.answers[key] ?? []), ...answers];
}

beforeEach(() => {
  fake.calls = [];
  fake.answers = {};
});

describe("deletes that verify a row went", () => {
  it("resolves when the row came back", async () => {
    answer("employee_kpis delete", { data: [{ id: "kpi-1" }], error: null });
    await expect(deleteEmployeeKpi("kpi-1")).resolves.toBeUndefined();
    expect(fake.calls).toEqual(["employee_kpis delete id=kpi-1"]);
  });

  it("reads a delete that removed nothing as a refusal", async () => {
    await expect(deleteEmployeeKpi("kpi-1")).rejects.toThrow("That is not here any more, or it is not yours to change.");
    await expect(deleteCompensationItem("comp-1")).rejects.toThrow(/not yours to change/);
    await expect(deleteCampaign("campaign-1")).rejects.toThrow(/not yours to change/);
  });

  it("passes a database error through untouched", async () => {
    const refusal = { message: "permission denied for table employee_kpis", code: "42501" };
    answer("employee_kpis delete", { data: null, error: refusal });
    await expect(deleteEmployeeKpi("kpi-1")).rejects.toBe(refusal);
  });

  it("refuses a file removal that storage answered with an empty list", async () => {
    await expect(removeFile("co-1/sops/a.pdf")).rejects.toThrow(/not yours to remove/);
    answer("storage remove", { data: [{ name: "co-1/sops/a.pdf" }], error: null });
    await expect(removeFile("co-1/sops/a.pdf")).resolves.toBeUndefined();
  });
});

describe("reorderMilestones", () => {
  it("stops at a milestone that did not move and says so", async () => {
    answer("project_milestones update", { data: [{ id: "m-1" }], error: null }, { data: [], error: null });
    await expect(reorderMilestones("p-1", ["m-1", "m-2", "m-3"])).rejects.toThrow(/not yours to change/);
    expect(fake.calls.filter((c) => c.startsWith("project_milestones update"))).toHaveLength(2);
  });
});

describe("createProjectAndAssign", () => {
  const input = { company_id: "co-1", name: "Hillside", employee_id: "person-1" };

  it("takes the project back when the assignment is refused, so a retry files no second copy", async () => {
    const refusal = { message: "That person is not on this company's team.", code: "P0001" };
    answer("projects insert", { data: { id: "project-1", company_id: "co-1", name: "Hillside" }, error: null });
    answer("project_assignments insert", { data: null, error: refusal });
    await expect(createProjectAndAssign(input)).rejects.toBe(refusal);
    expect(fake.calls).toEqual(["projects insert", "project_assignments insert", "projects update id=project-1"]);
  });

  it("keeps the assignment's error when taking the project back fails too", async () => {
    const refusal = { message: "TypeError: Failed to fetch", code: "" };
    answer("projects insert", { data: { id: "project-1", company_id: "co-1", name: "Hillside" }, error: null });
    answer("project_assignments insert", { data: null, error: refusal });
    answer("projects update", { data: null, error: { message: "TypeError: Failed to fetch", code: "" } });
    await expect(createProjectAndAssign(input)).rejects.toBe(refusal);
  });

  it("files both when both land", async () => {
    answer("projects insert", { data: { id: "project-1", company_id: "co-1", name: "Hillside" }, error: null });
    answer("project_assignments insert", { data: { id: "assignment-1", project_id: "project-1" }, error: null });
    const result = await createProjectAndAssign(input);
    expect(result.assignment.id).toBe("assignment-1");
    expect(fake.calls).toEqual(["projects insert", "project_assignments insert"]);
  });
});

describe("createInvitation", () => {
  const input = { company_id: "co-1", email: " Sam@Example.com ", role: "employee" as const, profile_id: "person-1" };
  const duplicate = { message: 'duplicate key value violates unique constraint "invitations_company_email_key"', code: "23505" };
  const row = { id: "invite-2", company_id: "co-1", email: "sam@example.com", accepted_at: null };

  it("files a new invitation", async () => {
    answer("invitations insert", { data: row, error: null });
    await expect(createInvitation(input)).resolves.toEqual(row);
  });

  it("clears a spent invitation for the address and files the new one in its place", async () => {
    answer("invitations insert", { data: null, error: duplicate }, { data: row, error: null });
    answer("invitations select", { data: { id: "invite-1", accepted_at: "2026-03-01T00:00:00Z" }, error: null });
    answer("invitations delete", { data: [{ id: "invite-1" }], error: null });
    await expect(createInvitation(input)).resolves.toEqual(row);
    expect(fake.calls).toEqual([
      "invitations insert",
      "invitations select company_id=co-1 email=sam@example.com",
      "invitations delete id=invite-1 accepted_at not null",
      "invitations insert",
    ]);
  });

  it("points at the waiting invitation instead of saying it already exists", async () => {
    answer("invitations insert", { data: null, error: duplicate });
    answer("invitations select", { data: { id: "invite-1", accepted_at: null }, error: null });
    await expect(createInvitation(input)).rejects.toThrow("There is already an invitation waiting for that address. Copy its link from the People page.");
    expect(fake.calls.some((c) => c.startsWith("invitations delete"))).toBe(false);
  });

  it("does not file a second one when clearing the spent one removed nothing", async () => {
    answer("invitations insert", { data: null, error: duplicate });
    answer("invitations select", { data: { id: "invite-1", accepted_at: "2026-03-01T00:00:00Z" }, error: null });
    await expect(createInvitation(input)).rejects.toThrow(/not yours to change/);
    expect(fake.calls.filter((c) => c === "invitations insert")).toHaveLength(1);
  });

  it("passes any other refusal through", async () => {
    const refusal = { message: "You can only invite people in the divisions you can see.", code: "23514" };
    answer("invitations insert", { data: null, error: refusal });
    await expect(createInvitation(input)).rejects.toBe(refusal);
  });
});
