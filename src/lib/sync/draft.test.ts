// Proves the data source editor's form logic: a new draft's shape, a source read back into a
// draft and out again unchanged, every message a bad draft is refused with, first failure first,
// and a sheet's headers merged into the field map.
import { describe, expect, it } from "vitest";
import { KINGDOM } from "../../test/fixtures.ts";
import { draftFromSource, draftToInput, emptyDraft, fieldFromHeader, withHeaders, type SourceDraft } from "./draft.ts";

const salesTab = KINGDOM.syncSources.find((s) => s.name === "Sample sales tab")!;

function sheetsDraft(overrides: Partial<SourceDraft> = {}): SourceDraft {
  return {
    ...emptyDraft("google_sheets", "America/Chicago"),
    name: "Sample tab",
    spreadsheet_url: "https://docs.google.com/spreadsheets/d/sample-sheet/edit#gid=7",
    fields: [fieldFromHeader("Job"), fieldFromHeader("Amount")],
    ...overrides,
  };
}

function message(draft: SourceDraft): string | null {
  const result = draftToInput(draft);
  return result.ok ? null : result.message;
}

describe("emptyDraft", () => {
  it("starts a disabled, unscheduled draft with one empty field", () => {
    expect(emptyDraft("google_sheets", "America/Chicago")).toEqual({
      name: "",
      provider: "google_sheets",
      target_module: "sales_reporting",
      spreadsheet_url: "",
      header_row: "1",
      range: "",
      entity: "Invoice",
      fields: [{ header: "", key: "", label: "", type: "text", unit: "", required: false }],
      record_key: [],
      weekdays: [],
      time: "",
      timezone: "America/Chicago",
      stale_after_hours: "",
      enabled: false,
    });
  });
});

describe("fieldFromHeader", () => {
  it("keys a field by its normalized header and labels it as typed", () => {
    expect(fieldFromHeader("Contract Amount ($)")).toEqual({ header: "Contract Amount ($)", key: "contract_amount", label: "Contract Amount ($)", type: "text", unit: "", required: false });
  });
});

describe("draftFromSource and draftToInput", () => {
  it("round-trips a source unchanged", () => {
    const draft = draftFromSource(salesTab);
    expect(draft.spreadsheet_url).toBe("https://docs.google.com/spreadsheets/d/sample-sheet-1/edit#gid=0");
    expect(draft.time).toBe("07:00");
    expect(draft.weekdays).toEqual([1]);
    const result = draftToInput(draft);
    if (!result.ok) throw new Error(result.message);
    expect(result.value).toEqual({
      provider: salesTab.provider,
      name: salesTab.name,
      target_module: salesTab.target_module,
      config: salesTab.config,
      field_map: salesTab.field_map,
      record_key: salesTab.record_key,
      sync_weekday: salesTab.sync_weekday,
      sync_weekdays: salesTab.sync_weekdays,
      sync_time: salesTab.sync_time,
      sync_timezone: salesTab.sync_timezone,
      stale_after_hours: salesTab.stale_after_hours,
      enabled: salesTab.enabled,
    });
  });

  it("refuses each bad draft with its own message", () => {
    expect(message(sheetsDraft({ name: "  " }))).toBe("The source needs a name.");
    expect(message(sheetsDraft({ spreadsheet_url: "https://example.com/sheet" }))).toBe("That does not look like a Google Sheets link.");
    expect(message(sheetsDraft({ spreadsheet_url: "https://docs.google.com/spreadsheets/d/sample-sheet/edit" }))).toBe("Copy the link with the tab open, so it includes the tab.");
    for (const header_row of ["0", "1.5", "", "two"]) expect(message(sheetsDraft({ header_row }))).toBe("The header row is a whole number, one or more.");
    expect(message(sheetsDraft({ fields: [] }))).toBe("Map at least one field.");
    expect(message(sheetsDraft({ fields: [{ ...fieldFromHeader("Job"), header: " " }] }))).toBe("Every field needs its column header.");
    expect(message(sheetsDraft({ fields: [{ ...fieldFromHeader("Job"), key: "job-no" }] }))).toBe("Field keys use lowercase letters, numbers and underscores.");
    expect(message(sheetsDraft({ fields: [fieldFromHeader("Job"), { ...fieldFromHeader("Job name"), key: "Job" }] }))).toBe("Two fields share the key job.");
    expect(message(sheetsDraft({ weekdays: [1], time: "" }))).toBe("Pick a time for the sync days.");
    expect(message(sheetsDraft({ weekdays: [1], time: "07:00", timezone: "Nowhere/Land" }))).toBe("That time zone is not recognized.");
    expect(message(sheetsDraft({ stale_after_hours: "0" }))).toBe("Stale after is a whole number of hours, one or more.");
  });

  it("reads a Sheets draft into its config, with a blank label and unit filled in", () => {
    const result = draftToInput(sheetsDraft({ range: "  ", header_row: "2", fields: [{ ...fieldFromHeader("Job"), label: " ", unit: " " }] }));
    if (!result.ok) throw new Error(result.message);
    expect(result.value.config).toEqual({ spreadsheet_id: "sample-sheet", sheet_gid: 7, range: null, header_row: 2 });
    expect(result.value.field_map).toEqual([{ header: "Job", key: "job", label: "Job", type: "text", unit: null, required: false }]);
  });

  it("keeps only record key fields still mapped, in field order", () => {
    const result = draftToInput(sheetsDraft({ fields: [fieldFromHeader("Job"), fieldFromHeader("Amount")], record_key: ["amount", "removed", "job"] }));
    if (!result.ok) throw new Error(result.message);
    expect(result.value.record_key).toEqual(["job", "amount"]);
  });

  it("nulls the whole schedule when no weekday is picked", () => {
    const result = draftToInput(sheetsDraft({ weekdays: [], time: "07:00", timezone: "America/Chicago" }));
    if (!result.ok) throw new Error(result.message);
    expect([result.value.sync_weekday, result.value.sync_weekdays, result.value.sync_time, result.value.sync_timezone]).toEqual([null, null, null, null]);
  });

  it("refuses days with no time in a plain line", () => {
    expect(message(sheetsDraft({ weekdays: [1, 2, 3, 4, 5], time: "", timezone: "America/Chicago" }))).toBe("Pick a time for the sync days.");
  });

  it("reads an empty set with no time and zone as no schedule", () => {
    const result = draftToInput(sheetsDraft({ weekdays: [], time: "", timezone: "" }));
    if (!result.ok) throw new Error(result.message);
    expect([result.value.sync_weekday, result.value.sync_weekdays, result.value.sync_time, result.value.sync_timezone]).toEqual([null, null, null, null]);
  });

  it("sends the set sorted, with the lowest day as the single day", () => {
    const result = draftToInput(sheetsDraft({ weekdays: [5, 1, 3, 0], time: "08:00", timezone: "America/New_York" }));
    if (!result.ok) throw new Error(result.message);
    expect(result.value.sync_weekdays).toEqual([0, 1, 3, 5]);
    expect(result.value.sync_weekday).toBe(0);
    expect([result.value.sync_time, result.value.sync_timezone]).toEqual(["08:00:00", "America/New_York"]);
  });

  it("reads a source back into its set, and a source with only the single day into a set of one", () => {
    expect(draftFromSource({ ...salesTab, sync_weekday: 1, sync_weekdays: [1, 2, 3, 4, 5] }).weekdays).toEqual([1, 2, 3, 4, 5]);
    expect(draftFromSource({ ...salesTab, sync_weekday: 4, sync_weekdays: null }).weekdays).toEqual([4]);
    expect(draftFromSource({ ...salesTab, sync_weekday: null, sync_weekdays: null, sync_time: null, sync_timezone: null }).weekdays).toEqual([]);
  });

  it("reads a blank stale threshold as none", () => {
    const result = draftToInput(sheetsDraft({ stale_after_hours: "" }));
    if (!result.ok) throw new Error(result.message);
    expect(result.value.stale_after_hours).toBeNull();
    const set = draftToInput(sheetsDraft({ stale_after_hours: "24" }));
    expect(set.ok && set.value.stale_after_hours).toBe(24);
  });

  it("gives a QuickBooks draft its entity as config", () => {
    const result = draftToInput({ ...emptyDraft("quickbooks", "America/Chicago"), name: "Sample invoices", fields: [fieldFromHeader("DocNumber")] });
    if (!result.ok) throw new Error(result.message);
    expect(result.value.config).toEqual({ entity: "Invoice" });
    expect(result.value.provider).toBe("quickbooks");
  });
});

describe("withHeaders", () => {
  it("replaces the empty starter row with a field for each header", () => {
    const { fields, added } = withHeaders([fieldFromHeader("")], ["Job", "Contract amount"]);
    expect(fields.map((f) => f.key)).toEqual(["job", "contract_amount"]);
    expect(added).toBe(2);
  });

  it("keeps a field already mapped, whatever its header's case or spacing", () => {
    const job = { ...fieldFromHeader("Job"), label: "Sample job label" };
    const { fields, added } = withHeaders([job], ["JOB ", "Margin"]);
    expect(fields).toEqual([job, fieldFromHeader("Margin")]);
    expect(fields[0]).toBe(job);
    expect(added).toBe(1);
  });

  it("changes nothing when every header is mapped", () => {
    const job = fieldFromHeader("Job");
    expect(withHeaders([job], ["Job"])).toEqual({ fields: [job], added: 0 });
  });

  it("skips blank and repeated headers", () => {
    const { fields, added } = withHeaders([], ["", "  ", "Job", "Job"]);
    expect(fields).toEqual([fieldFromHeader("Job")]);
    expect(added).toBe(1);
  });
});
