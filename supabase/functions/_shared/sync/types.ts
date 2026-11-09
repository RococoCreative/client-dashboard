// The shapes every part of a sync shares: a source's column map and config, a provider's raw
// table, the parsed rows, and the store, token and adapter interfaces the runner is handed. Pure
// types, so the app (through src/types/database.ts) and the Edge Function read one definition.
export type FieldType = "text" | "number" | "currency" | "percent" | "date";
export const FIELD_TYPES: readonly FieldType[] = ["text", "number", "currency", "percent", "date"];
export type SyncProvider = "google_sheets" | "quickbooks";
export type TargetModule = "sales_reporting" | "financial_reporting" | "controls" | "pm_capacity";
export interface FieldMapEntry { header: string; key: string; label: string; type: FieldType; unit: string | null; required: boolean }
export interface SheetsSourceConfig { spreadsheet_id: string; sheet_gid: number; range: string | null; header_row: number } // header_row 1-based
export interface QuickBooksSourceConfig { entity: "Invoice" | "Payment" }
export type SourceConfig = SheetsSourceConfig | QuickBooksSourceConfig;
export interface SyncSourceSpec {
  id: string; company_id: string; connection_id: string; provider: SyncProvider; config: SourceConfig;
  field_map: FieldMapEntry[]; record_key: string[]; enabled: boolean;
  sync_weekday: number | null; sync_time: string | null; sync_timezone: string | null;
  current_run_id: string | null; last_attempt_at: string | null; last_success_at: string | null;
}
export type CellValue = string | number | boolean | null;
export type ParsedValue = string | number | null;            // dates are "YYYY-MM-DD" strings
export interface RawRow { cells: CellValue[]; ref: Record<string, unknown> }
export interface RawTable { headers: CellValue[]; rows: RawRow[] }
export interface ParsedRow { key: string; data: Record<string, ParsedValue>; source_ref: Record<string, unknown> }
export type ValidationCode = "missing_header" | "wrong_type" | "required_blank" | "duplicate_key" | "bad_config";
export interface ValidationError { code: ValidationCode; message: string; row: number | null; field: string | null }
export type MapResult =
  | { ok: true; rows: ParsedRow[]; rowsRead: number; rowsBlank: number }
  | { ok: false; errors: ValidationError[]; rowsRead: number; rowsBlank: number };
export interface ProviderTokens { accessToken: string; refreshToken: string | null; accessExpiresAt: string | null; refreshExpiresAt: string | null }
export interface TokenStore { load(connectionId: string): Promise<ProviderTokens>; save(connectionId: string, tokens: ProviderTokens): Promise<void> }
export interface ConnectionRef { id: string; external_account_id: string | null }
export interface ProviderAdapter { provider: SyncProvider; read(source: SyncSourceSpec, connection: ConnectionRef): Promise<RawTable> }
export type AdapterRegistry = Partial<Record<SyncProvider, ProviderAdapter>>;
