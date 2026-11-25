// Pins that the sign-off and task mocks tell the story 0053's triggers do, so page tests and the
// demo show what the database would decide: a sign-off closes the person's open task on the SOP,
// ticking every step does not, an assignee cannot close it by hand, an admin can, and nobody signs
// a draft or signs twice without a new assignment.
import { describe, expect, it } from "vitest";
import { RBA } from "../fixtures.ts";
import { setActingPerson } from "../actingPerson.ts";
import { completeTask, createTask, getTask, setStepDone } from "./tasks.ts";
import { signOffSop } from "./sopSignoffs.ts";
import { createSop, updateSop } from "./sops.ts";
import { emptyDoc } from "../../lib/sops/doc.ts";

const rba = RBA.company.id;
const admin = RBA.profiles[0];
const employee = RBA.profiles[1];

async function publishedSop(title: string) {
  setActingPerson(admin);
  const sop = await createSop({ company_id: rba, title, category_id: null, status: "published", body: { json: emptyDoc() } });
  return sop.id;
}

describe("signing off an SOP", () => {
  it("closes the signer's open task on it, stamped as theirs", async () => {
    const sopId = await publishedSop("Lockout tagout");
    const task = await createTask({ company_id: rba, title: "Read lockout tagout", assignee_id: employee.id, sop_id: sopId });
    setActingPerson(employee);
    const signoff = await signOffSop(sopId, employee.id);
    expect(signoff.version).toBe(1);
    expect(signoff.signer_name).toBe(employee.full_name);
    const after = await getTask(task.id);
    expect(after.completed_at).not.toBeNull();
    expect(after.completed_by).toBe(employee.id);
  });

  it("leaves the task open when its steps are all ticked, and refuses the assignee closing it", async () => {
    const sopId = await publishedSop("Hot work permit");
    const task = await createTask({ company_id: rba, title: "Read hot work", assignee_id: employee.id, sop_id: sopId, steps: ["Read it"] });
    setActingPerson(employee);
    await setStepDone(task.steps[0].id, true);
    expect((await getTask(task.id)).completed_at).toBeNull();
    await expect(completeTask(task.id)).rejects.toThrow("This task finishes when the SOP is signed off.");
    setActingPerson(admin);
    expect((await completeTask(task.id)).completed_at).not.toBeNull();
  });

  it("refuses a draft, someone else's sign-off, and a second one with nothing asking for it", async () => {
    const sopId = await publishedSop("Confined space");
    await updateSop(sopId, { status: "draft" });
    setActingPerson(employee);
    await expect(signOffSop(sopId, employee.id)).rejects.toThrow("Only a published SOP can be signed off.");
    setActingPerson(admin);
    await updateSop(sopId, { status: "published" });
    setActingPerson(employee);
    await expect(signOffSop(sopId, admin.id)).rejects.toThrow("your own");
    await signOffSop(sopId, employee.id);
    await expect(signOffSop(sopId, employee.id)).rejects.toThrow("already signed off this version");
  });

  it("refuses a task on a draft SOP", async () => {
    const sopId = await publishedSop("Scaffold inspection");
    await updateSop(sopId, { status: "draft" });
    await expect(createTask({ company_id: rba, title: "Read it", assignee_id: employee.id, sop_id: sopId })).rejects.toThrow("Only a published SOP can be assigned.");
  });
});
