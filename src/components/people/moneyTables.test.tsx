// The person page's money and KPI tables, pinned where they used to lose data: a figure that does
// not read as money was saved as a zero or a blank nobody typed, two quick edits to one row could
// land out of order and put the older value back on screen, and a double Enter filed a row twice.
// The employees service is stubbed with promises the test settles by hand; nothing reaches a database.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import type { CompensationItem, EmployeeFinancial, EmployeeKpi } from "../../types/database.ts";

const svc = vi.hoisted(() => ({
  updateCompensationItem: vi.fn(),
  createCompensationItem: vi.fn(),
  deleteCompensationItem: vi.fn(),
  updateEmployeeFinancial: vi.fn(),
  createEmployeeFinancial: vi.fn(),
  deleteEmployeeFinancial: vi.fn(),
  updateEmployeeKpi: vi.fn(),
  createEmployeeKpi: vi.fn(),
  deleteEmployeeKpi: vi.fn(),
}));
vi.mock("../../services/employees.ts", () => svc);

import CompensationTable from "./CompensationTable.tsx";
import FinancialsTable from "./FinancialsTable.tsx";
import KpiList from "./KpiList.tsx";

const stamp = { created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
const BASE: CompensationItem = { id: "comp-1", company_id: "co-1", employee_id: "person-1", name: "Base salary", annual_amount: 60000, note: null, sort_order: 1, ...stamp };
const SALES: EmployeeFinancial = { id: "fin-1", company_id: "co-1", employee_id: "person-1", year: 2026, metric: "Closed sales", target: 500000, current: 120000, source: "manual", note: null, sort_order: 1, ...stamp };
const KPI: EmployeeKpi = { id: "kpi-1", company_id: "co-1", employee_id: "person-1", year: 2026, name: "Jobs closed", target_display: "12", current_display: "4", target_numeric: null, current_numeric: null, is_hit: false, sort_order: 1, ...stamp };

// A promise and the hand that settles it.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function edit(label: string, text: string) {
  const box = screen.getByLabelText(label);
  fireEvent.change(box, { target: { value: text } });
  fireEvent.blur(box);
  return box;
}

const errors: string[] = [];

function Compensation() {
  const [items, setItems] = useState<CompensationItem[]>([BASE]);
  return <CompensationTable companyId="co-1" employeeId="person-1" items={items} canEdit onChange={(fn) => setItems(fn)} onError={(m) => errors.push(m)} />;
}

function Financials() {
  const [rows, setRows] = useState<EmployeeFinancial[]>([SALES]);
  return <FinancialsTable employeeId="person-1" year={2026} rows={rows} canEdit onChange={(fn) => setRows(fn)} onError={(m) => errors.push(m)} />;
}

function Kpis() {
  const [kpis, setKpis] = useState<EmployeeKpi[]>([KPI]);
  return <KpiList companyId="co-1" employeeId="person-1" year={2026} kpis={kpis} canEdit onChange={(fn) => setKpis(fn)} onError={(m) => errors.push(m)} />;
}

beforeEach(() => {
  errors.length = 0;
  for (const fn of Object.values(svc)) fn.mockReset();
});

describe("CompensationTable", () => {
  it("refuses an annual amount that is not a number, and saves nothing", () => {
    render(<Compensation />);
    const box = edit("Annual for Base salary", "60k");
    expect(svc.updateCompensationItem).not.toHaveBeenCalled();
    expect(errors).toEqual(["Enter the annual amount as a number, like 65000."]);
    expect(box).toHaveValue("60000");
  });

  it("refuses a blank annual amount rather than saving a zero", () => {
    render(<Compensation />);
    edit("Annual for Base salary", "");
    expect(svc.updateCompensationItem).not.toHaveBeenCalled();
    expect(errors[0]).toMatch(/Use 0 for a line with no set amount/);
  });

  it("refuses a third decimal place instead of rounding it away", () => {
    render(<Compensation />);
    edit("Annual for Base salary", "60000.125");
    expect(svc.updateCompensationItem).not.toHaveBeenCalled();
    expect(errors).toEqual(["Enter the annual amount with at most two decimal places."]);
  });

  it("saves a figure that reads as money", async () => {
    svc.updateCompensationItem.mockImplementation(async (id: string, patch: Partial<CompensationItem>) => ({ ...BASE, id, ...patch }));
    render(<Compensation />);
    edit("Annual for Base salary", "$62,500");
    await act(async () => {});
    expect(svc.updateCompensationItem).toHaveBeenCalledWith("comp-1", { annual_amount: 62500 });
    expect(screen.getByLabelText("Annual for Base salary")).toHaveValue("62500");
  });

  it("refuses the add form's amount when it does not read as money", () => {
    render(<Compensation />);
    fireEvent.change(screen.getByLabelText("Add a compensation line"), { target: { value: "Vehicle stipend" } });
    fireEvent.change(screen.getByLabelText("New line annual amount"), { target: { value: "n/a" } });
    fireEvent.submit(screen.getByLabelText("Add a compensation line").closest("form")!);
    expect(svc.createCompensationItem).not.toHaveBeenCalled();
    expect(errors).toEqual(["Enter the annual amount as a number, like 65000."]);
  });

  it("files one line for a double submit", async () => {
    const created = deferred<CompensationItem>();
    svc.createCompensationItem.mockReturnValue(created.promise);
    render(<Compensation />);
    fireEvent.change(screen.getByLabelText("Add a compensation line"), { target: { value: "Vehicle stipend" } });
    fireEvent.change(screen.getByLabelText("New line annual amount"), { target: { value: "6000" } });
    const form = screen.getByLabelText("Add a compensation line").closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(svc.createCompensationItem).toHaveBeenCalledTimes(1);
    await act(async () => created.resolve({ ...BASE, id: "comp-2", name: "Vehicle stipend", annual_amount: 6000 }));
    expect(screen.getByLabelText("Line Vehicle stipend")).toBeInTheDocument();
  });
});

describe("FinancialsTable", () => {
  it("refuses a target that is not a number and keeps the stored one", () => {
    render(<Financials />);
    const box = edit("Target for Closed sales", "half a million");
    expect(svc.updateEmployeeFinancial).not.toHaveBeenCalled();
    expect(errors).toEqual(["Enter the target as a number, like 250000."]);
    expect(box).toHaveValue("500000");
  });

  it("lets a blank clear the current figure, since blank is a real answer there", async () => {
    svc.updateEmployeeFinancial.mockImplementation(async (id: string, patch: Partial<EmployeeFinancial>) => ({ ...SALES, id, ...patch }));
    render(<Financials />);
    edit("Current for Closed sales", "");
    await act(async () => {});
    expect(svc.updateEmployeeFinancial).toHaveBeenCalledWith("fin-1", { current: null, source: "manual" });
  });

  it("refuses the add form's target when it does not read as money", () => {
    render(<Financials />);
    fireEvent.change(screen.getByLabelText("Add a figure for 2026"), { target: { value: "Revenue managed" } });
    fireEvent.change(screen.getByLabelText("New figure target"), { target: { value: "12k" } });
    fireEvent.submit(screen.getByLabelText("Add a figure for 2026").closest("form")!);
    expect(svc.createEmployeeFinancial).not.toHaveBeenCalled();
    expect(errors).toEqual(["Enter the target as a number, like 250000."]);
  });

  it("queues two edits to one figure, so the older answer never lands last", async () => {
    const first = deferred<EmployeeFinancial>();
    const second = deferred<EmployeeFinancial>();
    svc.updateEmployeeFinancial.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<Financials />);
    edit("Target for Closed sales", "600000");
    edit("Current for Closed sales", "150000");
    await act(async () => {});
    // The second write waits for the first to come back.
    expect(svc.updateEmployeeFinancial).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve({ ...SALES, target: 600000 }));
    expect(svc.updateEmployeeFinancial).toHaveBeenCalledTimes(2);
    await act(async () => second.resolve({ ...SALES, target: 600000, current: 150000 }));
    expect(screen.getByLabelText("Target for Closed sales")).toHaveValue("600000");
    expect(screen.getByLabelText("Current for Closed sales")).toHaveValue("150000");
  });

  it("still sends the next edit after one in the queue fails, and marks the failed box", async () => {
    svc.updateEmployeeFinancial
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockImplementationOnce(async (id: string, patch: Partial<EmployeeFinancial>) => ({ ...SALES, id, ...patch }));
    render(<Financials />);
    const target = edit("Target for Closed sales", "600000");
    edit("Current for Closed sales", "150000");
    await act(async () => {});
    expect(svc.updateEmployeeFinancial).toHaveBeenCalledTimes(2);
    expect(errors).toEqual(["The connection dropped. Check your signal and try again."]);
    expect(target).toHaveAttribute("data-save-state", "failed");
    expect(screen.getByLabelText("Current for Closed sales")).toHaveValue("150000");
  });
});

describe("KpiList", () => {
  it("builds each queued write on the row the one before it returned", async () => {
    const first = deferred<EmployeeKpi>();
    svc.updateEmployeeKpi.mockReturnValueOnce(first.promise).mockImplementationOnce(async (id: string, patch: Partial<EmployeeKpi>) => ({ ...KPI, id, ...patch }));
    render(<Kpis />);
    const hit = screen.getByRole("button", { name: "Mark Jobs closed hit" });
    fireEvent.click(hit);
    fireEvent.click(hit);
    await act(async () => first.resolve({ ...KPI, is_hit: true }));
    // Two clicks are an on and an off, not two ons.
    expect(svc.updateEmployeeKpi.mock.calls.map((call) => call[1])).toEqual([{ is_hit: true }, { is_hit: false }]);
    expect(screen.getByRole("button", { name: "Mark Jobs closed hit" })).toBeInTheDocument();
  });

  it("files one KPI for a double submit", async () => {
    const created = deferred<EmployeeKpi>();
    svc.createEmployeeKpi.mockReturnValue(created.promise);
    render(<Kpis />);
    fireEvent.change(screen.getByLabelText("Add a KPI for 2026"), { target: { value: "Reviews collected" } });
    const form = screen.getByLabelText("Add a KPI for 2026").closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(svc.createEmployeeKpi).toHaveBeenCalledTimes(1);
    await act(async () => created.resolve({ ...KPI, id: "kpi-2", name: "Reviews collected" }));
  });
});
