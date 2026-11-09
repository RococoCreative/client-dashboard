// The company's data sources, for an admin in Company Settings: each spreadsheet tab or
// QuickBooks record set the hub reads, with its state and freshness, a switch to turn it on or
// off, Sync now, its recent runs, and an editor for what it reads, which can read a tab's column
// headers into the field map. Runs and records are only ever shown, never edited, and nothing here
// shows or asks for a token: syncing and reading headers go through the connections Edge
// Function, which alone holds one.
import { useState, type FormEvent } from "react";
import { Plus, X } from "lucide-react";
import FreshnessLine from "../sync/FreshnessLine.tsx";
import SyncStateBadge from "../sync/SyncStateBadge.tsx";
import Badge, { type BadgeTone } from "../ui/Badge.tsx";
import Button from "../ui/Button.tsx";
import Field from "../ui/Field.tsx";
import IconButton from "../ui/IconButton.tsx";
import Modal from "../ui/Modal.tsx";
import Notice from "../ui/Notice.tsx";
import Section from "../ui/Section.tsx";
import { SkeletonRows } from "../ui/Skeleton.tsx";
import { checkboxClass, helpClass, inputClass, labelClass, selectClass, tableClass, tdClass, thClass } from "../ui/forms.ts";
import { useAsync } from "../../hooks/useAsync.ts";
import { errorMessage } from "../../lib/errors.ts";
import { formatDateTime, pluralize } from "../../lib/format.ts";
import { draftFromSource, draftToInput, emptyDraft, fieldFromHeader, withHeaders, type FieldDraft, type SourceDraft } from "../../lib/sync/draft.ts";
import { syncState } from "../../lib/sync/state.ts";
import { listConnections } from "../../services/connections.ts";
import { createSyncSource, describeSpreadsheet, listSyncRuns, listSyncSources, requestSync, setSyncSourceEnabled, updateSyncSource } from "../../services/sync.ts";
import { parseSpreadsheetUrl } from "../../../supabase/functions/_shared/sync/links.ts";
import { normalizeHeader } from "../../../supabase/functions/_shared/sync/parse.ts";
import {
  CONNECTION_PROVIDER_LABELS,
  FIELD_TYPE_LABELS,
  TARGET_MODULE_LABELS,
  type CompanyConnection,
  type FieldType,
  type SyncProvider,
  type SyncRun,
  type SyncSource,
  type TargetModule,
} from "../../types/database.ts";

const PROVIDERS: SyncProvider[] = ["google_sheets", "quickbooks"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const cellInput = `${inputClass} mt-0 py-1.5 text-[13px]`;
const cellSelect = `${selectClass} mt-0 py-1.5 text-[13px]`;

function browserZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function timeZones(): string[] {
  return typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
}

// The first message a failed run recorded: an array of { message } or one { message }.
function firstRunError(detail: unknown): string | null {
  const first = Array.isArray(detail) ? detail[0] : detail;
  if (first && typeof first === "object" && typeof (first as { message?: unknown }).message === "string") return (first as { message: string }).message;
  return null;
}

function RecentRuns({ sourceId }: { sourceId: string }) {
  const state = useAsync(() => listSyncRuns(sourceId), [sourceId]);
  if (state.error && !state.data) return <Notice tone="error">{state.error}</Notice>;
  if (!state.data) return <SkeletonRows rows={2} />;
  if (state.data.length === 0) return <p className="text-[12.5px] text-ink-2">No runs yet.</p>;
  return (
    <ul className="divide-y divide-line rounded-md border border-line">
      {state.data.map((run: SyncRun) => {
        const tone: BadgeTone = run.status === "succeeded" ? "success" : run.status === "failed" ? "danger" : run.status === "running" ? "info" : "warning";
        const label = run.status === "succeeded" ? "Succeeded" : run.status === "failed" ? "Failed" : run.status === "running" ? "Running" : "Stopped";
        const problem = run.status === "failed" ? firstRunError(run.error_detail) : null;
        return (
          <li key={run.id} className="px-3 py-2 text-[12.5px]">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="tnum text-ink">{formatDateTime(run.started_at)}</span>
              <span className="text-ink-3">{run.trigger_kind === "schedule" ? "Scheduled" : "Manual"}</span>
              <Badge tone={tone}>{label}</Badge>
              <span className="tnum text-ink-2">{`${run.rows_read} read, ${run.rows_applied} applied, ${run.rows_blank} blank`}</span>
            </div>
            {problem ? <p className="mt-1 text-danger">{problem}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}

interface EditorField extends FieldDraft {
  uid: number;
  // Until someone edits the key, typing a header fills it.
  keyTouched: boolean;
}

let nextUid = 0;
function editorField(field: FieldDraft, keyTouched: boolean): EditorField {
  return { ...field, uid: ++nextUid, keyTouched };
}

function SourceEditor({
  companyId,
  source,
  connections,
  onClose,
  onSaved,
}: {
  companyId: string;
  source: SyncSource | null;
  connections: CompanyConnection[];
  onClose: () => void;
  onSaved: (source: SyncSource) => void;
}) {
  const [draft, setDraft] = useState<SourceDraft>(() => {
    if (!source) return emptyDraft("google_sheets", browserZone());
    const loaded = draftFromSource(source);
    return { ...loaded, timezone: loaded.timezone || browserZone() };
  });
  const [fields, setFields] = useState<EditorField[]>(() => draft.fields.map((field) => editorField(field, source !== null)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [zones] = useState(timeZones);
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState<{ sheet: string; added: string } | null>(null);
  const [readError, setReadError] = useState("");

  const connection = connections.find((c) => c.provider === draft.provider) ?? null;
  const providerLabel = CONNECTION_PROVIDER_LABELS[draft.provider];
  const link = draft.provider === "google_sheets" && draft.spreadsheet_url.trim() ? parseSpreadsheetUrl(draft.spreadsheet_url.trim()) : null;
  const mappedKeys = [...new Set(fields.map((field) => field.key.trim().toLowerCase()).filter(Boolean))];
  const headingId = "data-source-editor-title";
  const canReadHeaders = link !== null && link.gid !== null && connection?.status === "connected" && !reading;

  function set<K extends keyof SourceDraft>(key: K, value: SourceDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function setField(uid: number, patch: Partial<EditorField>) {
    setFields((prev) => prev.map((field) => (field.uid === uid ? { ...field, ...patch } : field)));
  }

  function setHeader(field: EditorField, header: string) {
    setField(field.uid, field.keyTouched ? { header } : { header, key: normalizeHeader(header) });
  }

  function toggleKey(key: string, on: boolean) {
    set("record_key", on ? [...draft.record_key.filter((k) => k !== key), key] : draft.record_key.filter((k) => k !== key));
  }

  // Reads row 1 of the linked tab through the connections function and adds a field for each
  // column header not mapped yet.
  async function readHeaders() {
    if (!link || link.gid === null || !connection || reading) return;
    const gid = link.gid;
    setReading(true);
    setReadError("");
    setReadNote(null);
    try {
      const description = await describeSpreadsheet(connection.id, link.spreadsheetId, gid);
      const tab = description.tabs.find((t) => t.gid === gid);
      const sheet = tab ? `${description.title}, tab ${tab.title}` : `${description.title}. That tab is not in the spreadsheet.`;
      const merged = withHeaders(fields, description.headers);
      setFields(merged.fields.map((field) => ("uid" in field ? field : editorField(field, false))));
      setReadNote({ sheet, added: merged.added === 0 ? "Every column is already mapped." : `Added ${pluralize(merged.added, "field")}.` });
    } catch (err) {
      setReadError(errorMessage(err));
    } finally {
      setReading(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || !connection) return;
    const result = draftToInput({ ...draft, fields });
    if (!result.ok) return setError(result.message);
    setBusy(true);
    setError("");
    try {
      const value = result.value;
      const saved = source
        ? await updateSyncSource(source.id, {
            connection_id: connection.id,
            name: value.name,
            target_module: value.target_module,
            config: value.config,
            field_map: value.field_map,
            record_key: value.record_key,
            sync_weekday: value.sync_weekday,
            sync_time: value.sync_time,
            sync_timezone: value.sync_timezone,
            stale_after_hours: value.stale_after_hours,
            enabled: value.enabled,
          })
        : await createSyncSource({ company_id: companyId, connection_id: connection.id, ...value });
      onSaved(saved);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} labelledBy={headingId} size="xl">
      <form onSubmit={save} className="p-6">
        <h2 id={headingId} className="font-display text-lg text-heading">{source ? "Edit data source" : "New data source"}</h2>
        <div className="mt-5 space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Name" htmlFor="source-name">
              <input id="source-name" type="text" value={draft.name} onChange={(e) => set("name", e.target.value)} className={inputClass} />
            </Field>
            <Field label="Feeds" htmlFor="source-feeds">
              <select id="source-feeds" value={draft.target_module} onChange={(e) => set("target_module", e.target.value as TargetModule)} className={selectClass}>
                {(Object.keys(TARGET_MODULE_LABELS) as TargetModule[]).map((key) => (
                  <option key={key} value={key}>{TARGET_MODULE_LABELS[key]}</option>
                ))}
              </select>
            </Field>
            <Field label="Source" htmlFor="source-provider">
              <select id="source-provider" value={draft.provider} disabled={source !== null} onChange={(e) => set("provider", e.target.value as SyncProvider)} className={selectClass}>
                {PROVIDERS.map((provider) => (
                  <option key={provider} value={provider}>{CONNECTION_PROVIDER_LABELS[provider]}</option>
                ))}
              </select>
            </Field>
          </div>

          {!connection ? <Notice tone="warning">{`Connect ${providerLabel} in Connections first.`}</Notice> : null}

          {draft.provider === "google_sheets" ? (
            <div className="grid gap-4 sm:grid-cols-4">
              <Field label="Google Sheets link" htmlFor="source-url" hint="Open the tab in Google Sheets and copy the address, so the link includes the tab." className="sm:col-span-2">
                <input id="source-url" type="url" value={draft.spreadsheet_url} onChange={(e) => set("spreadsheet_url", e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." className={inputClass} />
                {link ? (
                  <p className="mt-1.5 text-[12px] text-ink-2">
                    {link.gid !== null ? `Spreadsheet ${link.spreadsheetId}, tab ${link.gid}` : `Spreadsheet ${link.spreadsheetId}. The link has no tab yet.`}
                  </p>
                ) : null}
              </Field>
              <Field label="Header row" htmlFor="source-header-row">
                <input id="source-header-row" type="text" inputMode="numeric" value={draft.header_row} onChange={(e) => set("header_row", e.target.value)} className={inputClass} />
              </Field>
              <Field label="Range" htmlFor="source-range" hint="Leave blank to read the whole tab.">
                <input id="source-range" type="text" value={draft.range} onChange={(e) => set("range", e.target.value)} placeholder="A1:H200" className={inputClass} />
              </Field>
              <div className="sm:col-span-4">
                <Button variant="secondary" size="sm" disabled={!canReadHeaders} onClick={() => void readHeaders()}>
                  {reading ? "Reading..." : "Read headers"}
                </Button>
                <p className={helpClass}>Reads row 1 of the tab and adds a field for each column header not mapped yet.</p>
                {readNote ? (
                  <div className="mt-1.5 space-y-0.5">
                    <p className="text-[12.5px] text-ink-2">{readNote.sheet}</p>
                    <p className="text-[12.5px] text-ink-2">{readNote.added}</p>
                  </div>
                ) : null}
                {readError ? <Notice tone="error" className="mt-2">{readError}</Notice> : null}
              </div>
            </div>
          ) : (
            <Field label="QuickBooks records" htmlFor="source-entity" className="sm:max-w-xs">
              <select id="source-entity" value={draft.entity} onChange={(e) => set("entity", e.target.value as SourceDraft["entity"])} className={selectClass}>
                <option value="Invoice">Invoice</option>
                <option value="Payment">Payment</option>
              </select>
            </Field>
          )}

          <div>
            <p className={labelClass}>Fields</p>
            <div className="mt-1.5 overflow-x-auto">
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th className={thClass}>Column header</th>
                    <th className={thClass}>Key</th>
                    <th className={thClass}>Label</th>
                    <th className={thClass}>Type</th>
                    <th className={thClass}>Unit</th>
                    <th className={thClass}>Required</th>
                    <th className={thClass}><span className="sr-only">Remove</span></th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((field, i) => (
                    <tr key={field.uid}>
                      <td className={`${tdClass} min-w-40`}>
                        <input type="text" aria-label={`Column header ${i + 1}`} value={field.header} onChange={(e) => setHeader(field, e.target.value)} className={cellInput} />
                      </td>
                      <td className={`${tdClass} min-w-32`}>
                        <input type="text" aria-label={`Key ${i + 1}`} value={field.key} onChange={(e) => setField(field.uid, { key: e.target.value, keyTouched: true })} className={`${cellInput} font-mono`} />
                      </td>
                      <td className={`${tdClass} min-w-32`}>
                        <input type="text" aria-label={`Label ${i + 1}`} value={field.label} onChange={(e) => setField(field.uid, { label: e.target.value })} className={cellInput} />
                      </td>
                      <td className={`${tdClass} min-w-28`}>
                        <select aria-label={`Type ${i + 1}`} value={field.type} onChange={(e) => setField(field.uid, { type: e.target.value as FieldType })} className={cellSelect}>
                          {(Object.keys(FIELD_TYPE_LABELS) as FieldType[]).map((type) => (
                            <option key={type} value={type}>{FIELD_TYPE_LABELS[type]}</option>
                          ))}
                        </select>
                      </td>
                      <td className={`${tdClass} min-w-20`}>
                        <input type="text" aria-label={`Unit ${i + 1}`} value={field.unit} onChange={(e) => setField(field.uid, { unit: e.target.value })} className={cellInput} />
                      </td>
                      <td className={`${tdClass} text-center`}>
                        <input type="checkbox" aria-label={`Required ${i + 1}`} checked={field.required} onChange={(e) => setField(field.uid, { required: e.target.checked })} className={checkboxClass} />
                      </td>
                      <td className={`${tdClass} w-10`}>
                        <IconButton label="Remove field" onClick={() => setFields((prev) => prev.filter((f) => f.uid !== field.uid))}>
                          <X size={14} aria-hidden />
                        </IconButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button variant="secondary" size="sm" className="mt-2" onClick={() => setFields((prev) => [...prev, editorField(fieldFromHeader(""), false)])}>
              <Plus size={14} aria-hidden /> Add field
            </Button>
          </div>

          <div>
            <p className={labelClass}>Record key</p>
            {mappedKeys.length === 0 ? (
              <p className="mt-1.5 text-[12.5px] text-ink-2">Map a field to choose it here.</p>
            ) : (
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-2">
                {mappedKeys.map((key) => (
                  <label key={key} className="inline-flex items-center gap-2 font-mono text-[12.5px] text-ink">
                    <input type="checkbox" checked={draft.record_key.includes(key)} onChange={(e) => toggleKey(key, e.target.checked)} className={checkboxClass} />
                    {key}
                  </label>
                ))}
              </div>
            )}
            <p className={helpClass}>Tick the fields that identify a row. Leave all unticked to replace the whole tab on each sync.</p>
          </div>

          <div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Weekly sync" htmlFor="source-weekday">
                <select id="source-weekday" value={draft.weekday} onChange={(e) => set("weekday", e.target.value)} className={selectClass}>
                  <option value="">Not scheduled</option>
                  {WEEKDAYS.map((day, i) => (
                    <option key={day} value={String(i)}>{day}</option>
                  ))}
                </select>
              </Field>
              <Field label="Time" htmlFor="source-time">
                <input id="source-time" type="time" value={draft.time} onChange={(e) => set("time", e.target.value)} className={inputClass} />
              </Field>
              <Field label="Time zone" htmlFor="source-timezone">
                <input id="source-timezone" type="text" list="source-timezones" value={draft.timezone} onChange={(e) => set("timezone", e.target.value)} className={inputClass} />
                <datalist id="source-timezones">
                  {zones.map((zone) => (
                    <option key={zone} value={zone} />
                  ))}
                </datalist>
              </Field>
            </div>
            <p className={helpClass}>Without a schedule the source syncs only when someone presses Sync now.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Stale after (hours)" htmlFor="source-stale" hint="Leave blank to show the age without ever marking it stale.">
              <input id="source-stale" type="text" inputMode="numeric" value={draft.stale_after_hours} onChange={(e) => set("stale_after_hours", e.target.value)} className={inputClass} />
            </Field>
            <label className="inline-flex items-center gap-2 self-start pt-7 text-sm text-ink">
              <input type="checkbox" checked={draft.enabled} onChange={(e) => set("enabled", e.target.checked)} className={checkboxClass} />
              Enabled
            </label>
          </div>

          {error ? <Notice tone="error">{error}</Notice> : null}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy || !connection}>{busy ? "Saving..." : "Save"}</Button>
        </div>
      </form>
    </Modal>
  );
}

type SyncNotice = { tone: "success" | "error" | "info"; text: string };

export default function DataSourcesPanel({ companyId }: { companyId: string }) {
  const state = useAsync(async () => {
    const [sources, connections] = await Promise.all([listSyncSources(companyId), listConnections(companyId)]);
    return { sources, connections };
  }, [companyId]);
  const [editing, setEditing] = useState<SyncSource | "new" | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [runsOpen, setRunsOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<SyncNotice | null>(null);
  const [error, setError] = useState("");
  // Bumped after each Sync now, so an open run list loads again with the new run.
  const [syncCount, setSyncCount] = useState(0);
  const data = state.data;
  const now = new Date();

  function replace(saved: SyncSource) {
    state.setData((prev) =>
      prev ? { ...prev, sources: [...prev.sources.filter((s) => s.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)) } : prev,
    );
  }

  async function toggle(source: SyncSource, enabled: boolean) {
    setError("");
    try {
      replace(await setSyncSourceEnabled(source.id, enabled));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function syncNow(source: SyncSource) {
    if (syncing) return;
    setSyncing(source.id);
    setNotice(null);
    try {
      const result = await requestSync(source.id);
      setNotice(
        result.status === "succeeded"
          ? { tone: "success", text: `${source.name} synced: ${pluralize(result.rows_applied, "row")}.` }
          : result.status === "locked"
            ? { tone: "info", text: "A sync is already running for this connection. Try again in a few minutes." }
            : { tone: "error", text: result.message ?? "The sync did not finish." },
      );
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err) });
    } finally {
      setSyncing(null);
      setSyncCount((n) => n + 1);
      state.reload();
    }
  }

  return (
    <Section
      eyebrow="Integrations"
      title="Data sources"
      description="Spreadsheet tabs and QuickBooks records this company reads into the hub. Imported values are read-only here; change them at the source."
      actions={<Button size="sm" onClick={() => setEditing("new")} disabled={!data}>Add source</Button>}
    >
      {notice ? <Notice tone={notice.tone} className="mb-4">{notice.text}</Notice> : null}
      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
      {state.error && !data ? <Notice tone="error">{state.error}</Notice> : null}
      {!data && !state.error ? <SkeletonRows rows={3} /> : null}
      {data && data.sources.length === 0 ? <p className="text-sm text-ink-2">No data sources yet.</p> : null}
      {data && data.sources.length > 0 ? (
        <ul className="divide-y divide-line">
          {data.sources.map((source) => {
            const connection = data.connections.find((c) => c.id === source.connection_id) ?? null;
            return (
              <li key={source.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-ink">{source.name}</p>
                      <SyncStateBadge state={syncState(source, connection, now)} />
                    </div>
                    <p className="mt-0.5 text-[12px] text-ink-3">{`${TARGET_MODULE_LABELS[source.target_module]} · ${CONNECTION_PROVIDER_LABELS[source.provider]}`}</p>
                    <div className="mt-1">
                      <FreshnessLine source={source} connection={connection} now={now} />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-2">
                      <input type="checkbox" aria-label={`Enable ${source.name}`} checked={source.enabled} onChange={(e) => void toggle(source, e.target.checked)} className={checkboxClass} />
                      Enabled
                    </label>
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-label={`Sync ${source.name} now`}
                      disabled={connection?.status !== "connected" || syncing !== null}
                      onClick={() => void syncNow(source)}
                    >
                      {syncing === source.id ? "Syncing..." : "Sync now"}
                    </Button>
                    <Button variant="ghost" size="sm" aria-label={`Edit ${source.name}`} onClick={() => setEditing(source)}>Edit</Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Show runs for ${source.name}`}
                      aria-expanded={runsOpen === source.id}
                      onClick={() => setRunsOpen((open) => (open === source.id ? null : source.id))}
                    >
                      Recent runs
                    </Button>
                  </div>
                </div>
                {runsOpen === source.id ? (
                  <div className="mt-3">
                    <RecentRuns key={syncCount} sourceId={source.id} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {editing && data ? (
        <SourceEditor
          companyId={companyId}
          source={editing === "new" ? null : editing}
          connections={data.connections}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            replace(saved);
            setEditing(null);
          }}
        />
      ) : null}
    </Section>
  );
}
