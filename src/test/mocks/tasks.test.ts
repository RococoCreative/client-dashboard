// Pins that the tasks mock behaves as the database does (0036): steps complete and reopen their
// task, a repeating task opens one next copy dated forward from its due date, a completed copy
// with its next one open stays shut, and nothing crosses a company. Page tests and the demo rely
// on the mock telling the same story the triggers would.
import { describe, expect, it } from "vitest";
import { KINGDOM, RBA } from "../fixtures.ts";
import { addStep, completeTask, countOpenTasks, createTask, deleteTask, getTask, listTasks, moveStep, reopenTask, setStepDone } from "./tasks.ts";

const rba = RBA.company.id;
const jamie = RBA.profiles[1].id;
const noor = RBA.profiles[2].id;
const avery = RBA.profiles.find((p) => p.user_id === null)!.id;

describe("fixture tasks", () => {
  it("countOpenTasks counts only that person's open tasks in that company", async () => {
    const open = (await listTasks(rba, { status: "all" })).filter((t) => t.assignee_id === jamie && t.completed_at === null);
    expect(open.length).toBeGreaterThan(0);
    expect(await countOpenTasks(rba, jamie)).toBe(open.length);
    // The same person asked about under another company has nothing there.
    expect(await countOpenTasks(KINGDOM.company.id, jamie)).toBe(0);

    const before = await countOpenTasks(rba, avery);
    const mine = await createTask({ company_id: rba, title: "Read the welcome pack", assignee_id: avery });
    await createTask({ company_id: rba, title: "Someone else's", assignee_id: noor });
    expect(await countOpenTasks(rba, avery)).toBe(before + 1);
    await completeTask(mine.id);
    expect(await countOpenTasks(rba, avery)).toBe(before);
  });

  it("listTasks(companyId) never returns another company's task", async () => {
    for (const status of ["open", "done", "all"] as const) {
      const rows = await listTasks(rba, { status });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((t) => t.company_id === rba && t.steps.every((s) => s.company_id === rba))).toBe(true);
    }
    expect((await listTasks(KINGDOM.company.id, { status: "all" })).every((t) => t.company_id === KINGDOM.company.id)).toBe(true);
  });

  it("lists open tasks by default, earliest due first and undated last", async () => {
    const rows = await listTasks(rba);
    expect(rows.every((t) => t.completed_at === null)).toBe(true);
    const dates = rows.map((t) => t.due_date);
    const dated = dates.filter((d): d is string => d !== null);
    expect(dated).toEqual([...dated].sort());
    expect(dates.indexOf(null)).toBeGreaterThanOrEqual(dated.length);
  });
});

describe("steps and completion", () => {
  it("ticking the last step completes the task", async () => {
    const task = await createTask({ company_id: rba, title: "Two steps", assignee_id: jamie, steps: ["First", "Second"] });
    const [first, second] = task.steps;
    const half = await setStepDone(first.id, true);
    expect(half.completed_at).toBeNull();
    const done = await setStepDone(second.id, true);
    expect(done.completed_at).not.toBeNull();
    expect(done.completed_by).not.toBeNull();
  });

  it("unticking a step on a completed task reopens it", async () => {
    const task = await createTask({ company_id: rba, title: "One step", assignee_id: jamie, steps: ["Only"] });
    expect((await setStepDone(task.steps[0].id, true)).completed_at).not.toBeNull();
    const reopened = await setStepDone(task.steps[0].id, false);
    expect(reopened.completed_at).toBeNull();
    expect(reopened.completed_by).toBeNull();
  });

  it("adds a step at the end and moves it up", async () => {
    const task = await createTask({ company_id: rba, title: "Ordered", assignee_id: jamie, steps: ["A", "B"] });
    const added = await addStep(task.id, "C");
    expect(added.steps.map((s) => s.title)).toEqual(["A", "B", "C"]);
    const moved = await moveStep(added.steps[2].id, "up");
    expect(moved.steps.map((s) => s.title)).toEqual(["A", "C", "B"]);
    expect((await moveStep(moved.steps[0].id, "up")).steps.map((s) => s.title)).toEqual(["A", "C", "B"]);
  });
});

describe("repeating tasks", () => {
  it("completing a weekly task due 2026-09-18 creates one open copy due 2026-09-25 with every step unticked", async () => {
    const task = await createTask({ company_id: rba, title: "Weekly check", assignee_id: jamie, due_date: "2026-09-18", recurrence: "weekly", priority: "high", steps: ["Look", "Log"] });
    await setStepDone(task.steps[0].id, true);
    const done = await completeTask(task.id);
    expect(done.completed_at).not.toBeNull();
    expect(done.next_task_id).not.toBeNull();

    const next = await getTask(done.next_task_id!);
    expect(next.due_date).toBe("2026-09-25");
    expect(next.completed_at).toBeNull();
    expect(next.next_task_id).toBeNull();
    expect(next).toMatchObject({ company_id: rba, title: "Weekly check", assignee_id: jamie, priority: "high", recurrence: "weekly", created_by: task.created_by, notified_assignee_id: jamie });
    expect(next.steps.map((s) => [s.title, s.done_at])).toEqual([["Look", null], ["Log", null]]);
  });

  it("completing an overdue weekly task due 2026-09-01 creates a copy due 2026-09-22", async () => {
    const task = await createTask({ company_id: rba, title: "Late weekly", assignee_id: jamie, due_date: "2026-09-01", recurrence: "weekly" });
    const done = await completeTask(task.id);
    expect((await getTask(done.next_task_id!)).due_date).toBe("2026-09-22");
  });

  it("steps month-based repeats from the due date, keeping the day where the month has it", async () => {
    const monthly = await completeTask((await createTask({ company_id: rba, title: "Month end", assignee_id: jamie, due_date: "2026-08-31", recurrence: "monthly" })).id);
    expect((await getTask(monthly.next_task_id!)).due_date).toBe("2026-09-30");
    const quarterly = await completeTask((await createTask({ company_id: rba, title: "Quarter", assignee_id: jamie, due_date: "2026-03-15", recurrence: "quarterly" })).id);
    expect((await getTask(quarterly.next_task_id!)).due_date).toBe("2026-12-15");
  });

  it("completeTask twice on the same recurring task leaves exactly one open copy", async () => {
    const task = await createTask({ company_id: rba, title: "Twice weekly", assignee_id: noor, due_date: "2026-09-18", recurrence: "weekly" });
    await completeTask(task.id);
    await completeTask(task.id);
    const open = (await listTasks(rba)).filter((t) => t.title === "Twice weekly");
    expect(open).toHaveLength(1);
  });

  it("ticking the last step of a repeating task opens the next copy", async () => {
    const task = await createTask({ company_id: rba, title: "Daily sweep", assignee_id: jamie, due_date: "2026-09-15", recurrence: "daily", steps: ["Sweep"] });
    const done = await setStepDone(task.steps[0].id, true);
    expect((await getTask(done.next_task_id!)).due_date).toBe("2026-09-16");
  });

  it("reopenTask on a completed task with next_task_id rejects with \"The next one is already open.\"", async () => {
    const task = await createTask({ company_id: rba, title: "Locked weekly", assignee_id: jamie, due_date: "2026-09-18", recurrence: "weekly", steps: ["Step"] });
    await completeTask(task.id);
    await expect(reopenTask(task.id)).rejects.toThrow("The next one is already open.");
    await expect(setStepDone(task.steps[0].id, false)).rejects.toThrow("The next one is already open.");
  });

  it("deleting the open copy ends the series on the one before it", async () => {
    const task = await createTask({ company_id: rba, title: "Ended series", assignee_id: jamie, due_date: "2026-09-18", recurrence: "weekly" });
    const done = await completeTask(task.id);
    await deleteTask(done.next_task_id!);
    const before = await getTask(task.id);
    expect(before.next_task_id).toBeNull();
    expect(before.recurrence).toBeNull();
    expect((await reopenTask(task.id)).completed_at).toBeNull();
  });
});
