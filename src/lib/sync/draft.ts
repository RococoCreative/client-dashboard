// The data source editor's form logic, kept pure so every rule is tested here and the editor is
// a view: a blank draft, a source read back into a draft, and a draft checked and turned into
// the row the service saves, plus a sheet's headers merged into the column map. The column map is
// checked as a whole, which is why the editor has one Save rather than saving each field on blur.
import { parseSpreadsheetUrl, sheetsUrl } from "../../../supabase/functions/_shared/sync/links.ts";
import { normalizeHeader } from "../../../supabase/functions/_shared/sync/parse.ts";
import type { SyncSourceInput } from "../../services/sync.ts";
import type { FieldMapEntry, FieldType, SourceConfig, SyncProvider, SyncSource, TargetModule } from "../../types/database.ts";

export interface FieldDraft { header: string; key: string; label: string; type: FieldType; unit: string; required: boolean }
export interface SourceDraft {
  name: string;
  provider: SyncProvider;
  target_module: TargetModule;
  spreadsheet_url: string; // Google Sheets
  header_row: string;
  range: string;
  entity: "Invoice" | "Payment"; // QuickBooks
  fields: FieldDraft[];
  record_key: string[];
  weekday: string; // "" = not scheduled, else "0".."6"
  time: string;
  timezone: string;
  stale_after_hours: string;
  enabled: boolean;
}

export type DraftResult = { ok: true; value: Omit<SyncSourceInput, "company_id" | "connection_id"> } | { ok: false; message: string };

const WHOLE = /^\d+$/;
const KEY = /^[a-z0-9_]+$/;
const TIME = /^\d{2}:\d{2}$/;

export function fieldFromHeader(header: string): FieldDraft {
  return { header, key: normalizeHeader(header), label: header.trim(), type: "text", unit: "", required: false };
}

// A sheet's column headers merged into the field map: rows with no header go first, then each
// header no remaining field maps yet (compared as keys, so case and spacing do not matter) is
// added in the sheet's order. Fields already mapped are kept as they are.
export function withHeaders<F extends FieldDraft>(fields: F[], headers: string[]): { fields: Array<F | FieldDraft>; added: number } {
  const next: Array<F | FieldDraft> = fields.filter((field) => field.header.trim() !== "");
  const mapped = new Set(next.map((field) => normalizeHeader(field.header)));
  let added = 0;
  for (const raw of headers) {
    const header = raw.trim();
    if (!header) continue;
    const key = normalizeHeader(header);
    if (mapped.has(key)) continue;
    mapped.add(key);
    next.push(fieldFromHeader(header));
    added += 1;
  }
  return { fields: next, added };
}

export function emptyDraft(provider: SyncProvider, timezone: string): SourceDraft {
  return {
    name: "",
    provider,
    target_module: "sales_reporting",
    spreadsheet_url: "",
    header_row: "1",
    range: "",
    entity: "Invoice",
    fields: [fieldFromHeader("")],
    record_key: [],
    weekday: "",
    time: "",
    timezone,
    stale_after_hours: "",
    enabled: false,
  };
}

export function draftFromSource(source: SyncSource): SourceDraft {
  const config = source.config;
  const sheets = "spreadsheet_id" in config ? config : null;
  return {
    name: source.name,
    provider: source.provider,
    target_module: source.target_module,
    spreadsheet_url: sheets ? sheetsUrl(sheets.spreadsheet_id, sheets.sheet_gid) : "",
    header_row: String(sheets?.header_row ?? 1),
    range: sheets?.range ?? "",
    entity: "entity" in config ? config.entity : "Invoice",
    fields: source.field_map.map((entry) => ({ header: entry.header, key: entry.key, label: entry.label, type: entry.type, unit: entry.unit ?? "", required: entry.required })),
    record_key: [...source.record_key],
    weekday: source.sync_weekday === null ? "" : String(source.sync_weekday),
    time: source.sync_time ? source.sync_time.slice(0, 5) : "",
    timezone: source.sync_timezone ?? "",
    stale_after_hours: source.stale_after_hours === null ? "" : String(source.stale_after_hours),
    enabled: source.enabled,
  };
}

function wholeNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!WHOLE.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= 1 ? value : null;
}

function knownZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function fail(message: string): DraftResult {
  return { ok: false, message };
}

// First failure wins.
export function draftToInput(draft: SourceDraft): DraftResult {
  const name = draft.name.trim();
  if (!name) return fail("The source needs a name.");

  let config: SourceConfig;
  if (draft.provider === "google_sheets") {
    const link = parseSpreadsheetUrl(draft.spreadsheet_url.trim());
    if (!link) return fail("That does not look like a Google Sheets link.");
    if (link.gid === null) return fail("Copy the link with the tab open, so it includes the tab.");
    const headerRow = wholeNumber(draft.header_row);
    if (headerRow === null) return fail("The header row is a whole number, one or more.");
    config = { spreadsheet_id: link.spreadsheetId, sheet_gid: link.gid, range: draft.range.trim() || null, header_row: headerRow };
  } else {
    config = { entity: draft.entity };
  }

  if (draft.fields.length === 0) return fail("Map at least one field.");
  const fieldMap: FieldMapEntry[] = [];
  for (const field of draft.fields) {
    const header = field.header.trim();
    if (!header) return fail("Every field needs its column header.");
    const key = field.key.trim().toLowerCase();
    if (!KEY.test(key)) return fail("Field keys use lowercase letters, numbers and underscores.");
    if (fieldMap.some((entry) => entry.key === key)) return fail(`Two fields share the key ${key}.`);
    fieldMap.push({ header, key, label: field.label.trim() || header, type: field.type, unit: field.unit.trim() || null, required: field.required });
  }

  const ticked = new Set(draft.record_key.map((key) => key.trim().toLowerCase()));
  const recordKey = fieldMap.map((entry) => entry.key).filter((key) => ticked.has(key));

  let schedule: Pick<SyncSourceInput, "sync_weekday" | "sync_time" | "sync_timezone"> = { sync_weekday: null, sync_time: null, sync_timezone: null };
  if (draft.weekday !== "") {
    if (!TIME.test(draft.time)) return fail("Pick a time for the weekly sync.");
    const zone = draft.timezone.trim();
    if (!knownZone(zone)) return fail("That time zone is not recognized.");
    schedule = { sync_weekday: Number(draft.weekday), sync_time: `${draft.time}:00`, sync_timezone: zone };
  }

  let staleAfter: number | null = null;
  if (draft.stale_after_hours.trim() !== "") {
    staleAfter = wholeNumber(draft.stale_after_hours);
    if (staleAfter === null) return fail("Stale after is a whole number of hours, one or more.");
  }

  return {
    ok: true,
    value: {
      provider: draft.provider,
      name,
      target_module: draft.target_module,
      config,
      field_map: fieldMap,
      record_key: recordKey,
      ...schedule,
      stale_after_hours: staleAfter,
      enabled: draft.enabled,
    },
  };
}
