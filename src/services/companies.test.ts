// Guards the column list the companies service selects. A column missing from it is silently
// absent on every company row, so a module switched on in the database would never reach the app.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCompany, getCompany, listCompanies, updateCompany } from "./companies.ts";

const recorded = vi.hoisted(() => ({ selects: [] as string[] }));
vi.mock("./supabase.ts", () => {
  const builder: Record<string, unknown> = {};
  for (const m of ["eq", "order", "single", "insert", "update", "delete"]) builder[m] = () => builder;
  builder.select = (cols: string) => { recorded.selects.push(cols); return builder; };
  builder.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
  return { db: () => ({ from: () => builder }) };
});

const COLUMNS = "id, slug, name, theme_key, logo_url, modules, time_zone, created_at, updated_at";

describe("companies service columns", () => {
  beforeEach(() => {
    recorded.selects.length = 0;
  });

  it("listCompanies selects modules", async () => {
    await listCompanies();
    expect(recorded.selects).toEqual([COLUMNS]);
  });

  it("getCompany selects modules", async () => {
    await getCompany("co-kingdom");
    expect(recorded.selects).toEqual([COLUMNS]);
  });

  it("createCompany selects modules", async () => {
    await createCompany({ slug: "new", name: "New Co", theme_key: "klasik" });
    expect(recorded.selects).toEqual([COLUMNS]);
  });

  it("updateCompany selects modules", async () => {
    await updateCompany("co-kingdom", { modules: ["wins"] });
    expect(recorded.selects).toEqual([COLUMNS]);
  });
});
