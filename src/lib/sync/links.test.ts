// Proves the links back to a record's source: reading a spreadsheet URL, building one, and a
// record's link from where it came from.
import { describe, expect, it } from "vitest";
import { parseSpreadsheetUrl, recordLink, sheetsUrl } from "../../../supabase/functions/_shared/sync/links.ts";

describe("parseSpreadsheetUrl", () => {
  it("reads the spreadsheet id and tab from a Google Sheets URL", () => {
    expect(parseSpreadsheetUrl("https://docs.google.com/spreadsheets/d/AbC-123_x/edit#gid=42")).toEqual({ spreadsheetId: "AbC-123_x", gid: 42 });
    expect(parseSpreadsheetUrl("https://docs.google.com/spreadsheets/d/AbC/edit?gid=0#gid=0")).toEqual({ spreadsheetId: "AbC", gid: 0 });
    expect(parseSpreadsheetUrl("https://docs.google.com/spreadsheets/d/AbC/edit")).toEqual({ spreadsheetId: "AbC", gid: null });
  });

  it("rejects anything else", () => {
    expect(parseSpreadsheetUrl("https://example.com/spreadsheets/d/AbC")).toBeNull();
    expect(parseSpreadsheetUrl("not a url")).toBeNull();
  });
});

describe("sheetsUrl", () => {
  it("builds a link to the tab and row", () => {
    expect(sheetsUrl("AbC", 42)).toBe("https://docs.google.com/spreadsheets/d/AbC/edit#gid=42");
    expect(sheetsUrl("AbC", 42, 5)).toBe("https://docs.google.com/spreadsheets/d/AbC/edit#gid=42&range=A5");
    expect(sheetsUrl("AbC", null)).toBe("https://docs.google.com/spreadsheets/d/AbC/edit");
  });
});

describe("recordLink", () => {
  it("links a spreadsheet row back to its sheet", () => {
    expect(recordLink({ spreadsheet_id: "AbC", sheet_gid: 42, row: 5 })).toEqual({
      href: "https://docs.google.com/spreadsheets/d/AbC/edit#gid=42&range=A5",
      label: "Open in Google Sheets",
      note: null,
    });
  });

  it("has no link for anything else yet", () => {
    expect(recordLink({ entity: "Invoice", Id: "1" })).toBeNull();
    expect(recordLink({})).toBeNull();
  });
});
