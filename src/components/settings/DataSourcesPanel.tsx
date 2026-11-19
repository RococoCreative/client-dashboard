// The company's data sources, for an admin in Company Settings: each spreadsheet tab or
// QuickBooks record set the hub reads, with its state and freshness, a switch to turn it on or
// off, Sync now, its recent runs, and an editor for what it reads, which can read a tab's column
// headers into the field map. Runs and records are only ever shown, never edited, and nothing here
// shows or asks for a token: syncing and reading headers go through the connections Edge
// Function, which alone holds one.
// Up to three sources read as rows. Past three they become a list with each source at its own
// address, /settings/connections/sources/:sourceId, and the chosen one open beside it
// (DataSourceDetail). On a wide screen the bare address shows the first source without changing the
// address, so a connection's way back from the provider still lands on /settings/connections with
// its outcome; on a phone the list is the page.
import { useState, type FormEvent } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { Pencil, Plus } from "lucide-react";
import FreshnessLine from "../sync/FreshnessLine.tsx";
import SyncStateBadge from "../sync/SyncStateBadge.tsx";
import Button from "../ui/Button.tsx";
import Field from "../ui/Field.tsx";
import IconButton from "../ui/IconButton.tsx";
import ListDetail, { type ListDetailItem } from "../ui/ListDetail.tsx";
import Modal from "../ui/Modal.tsx";
import Notice from "../ui/Notice.tsx";
import Section from "../ui/Section.tsx";
import SkeletonRows from "../ui/SkeletonRows.tsx";
import useIsWide from "../ui/useIsWide.ts";
import { checkboxClass, checkboxHitClass, helpClass, inputClass, labelClass, selectClass, tableClass, tdClass, thClass } from "../ui/forms.ts";
import { itemTitleClass, metaClass, secondaryClass, sectionEyebrowClass, sectionTitleClass } from "../ui/type.ts";
import DataSourceDetail from "./DataSourceDetail.tsx";
import SourceRuns from "./SourceRuns.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { errorMessage } from "../../lib/errors.ts";
import { pluralize } from "../../lib/format.ts";
import { draftFromSource, draftToInput, emptyDraft, fieldFromHeader, withHeaders, type FieldDraft, type SourceDraft } from "../../lib/sync/draft.ts";
import { syncState } from "../../lib/sync/state.ts";
import { listConnections } from "../../services/connections.ts";
import { createSyncSource, describeSpreadsheet, listSyncSources, requestSync, setSyncSourceEnabled, updateSyncSource } from "../../services/sync.ts";
import { parseSpreadsheetUrl } from "../../../supabase/functions/_shared/sync/links.ts";
import { normalizeHeader } from "../../../supabase/functions/_shared/sync/parse.ts";
import {
  CONNECTION_PROVIDER_LABELS,
  FIELD_TYPE_LABELS,
  TARGET_MODULE_LABELS,
  type CompanyConnection,
  type FieldType,
  type SyncProvider,
  type SyncSource,
  type TargetModule,
} from "../../types/database.ts";

const PROVIDERS: SyncProvider[] = ["google_sheets", "quickbooks"];
// The sync day checkboxes, Monday first; each value is the day's number in the database (0 = Sunday).
const WEEKDAYS: Array<{ value: number; label: string }> = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];
const BASE = "/settings/connections";
// More sources than this and the rows become a list, each source at its own address.
const MOST_AS_ROWS = 3;
const DESCRIPTION = "Spreadsheet tabs and QuickBooks records this company reads into the hub. Imported values are read-only here; change them at the source.";

const cellInput = `${inputClass} mt-0 py-1.5 text-[13px]`;
const cellSelect = `${selectClass} mt-0 py-1.5 text-[13px]`;

function browserZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function timeZones(): string[] {
  return typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
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

  function toggleDay(day: number, on: boolean) {
    set("weekdays", on ? [...draft.weekdays.filter((d) => d !== day), day].sort((a, b) => a - b) : draft.weekdays.filter((d) => d !== day));
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
            sync_weekdays: value.sync_weekdays,
            sync_time: value.sync_time,
            sync_timezone: value.sync_timezone,
            stale_after_hours: value.stale_after_hours,
            stale_business_days: value.stale_business_days,
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
            <div className="relative mt-1.5 overflow-x-auto">
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
                        <label className={checkboxHitClass}><input type="checkbox" aria-label={`Required ${i + 1}`} checked={field.required} onChange={(e) => setField(field.uid, { required: e.target.checked })} className={checkboxClass} /></label>
                      </td>
                      <td className={`${tdClass} w-10`}>
                        <Button variant="danger" size="sm" aria-label="Remove field" onClick={() => setFields((prev) => prev.filter((f) => f.uid !== field.uid))}>
                          Remove
                        </Button>
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
                  <label key={key} className="inline-flex items-center gap-2 font-mono text-[12.5px] text-ink tap:min-h-11 tap:min-w-11">
                    <input type="checkbox" checked={draft.record_key.includes(key)} onChange={(e) => toggleKey(key, e.target.checked)} className={checkboxClass} />
                    {key}
                  </label>
                ))}
              </div>
            )}
            <p className={helpClass}>Tick the fields that identify a row. Leave all unticked to replace the whole tab on each sync.</p>
          </div>

          <div>
            <fieldset>
              <legend className={labelClass}>Sync days</legend>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-2">
                {WEEKDAYS.map((day) => (
                  <label key={day.value} className="inline-flex items-center gap-2 text-[12.5px] text-ink tap:min-h-11 tap:min-w-11">
                    <input type="checkbox" checked={draft.weekdays.includes(day.value)} onChange={(e) => toggleDay(day.value, e.target.checked)} className={checkboxClass} />
                    {day.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
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
            <p className={helpClass}>The source syncs at this time on each day ticked, in this time zone. With no day ticked it syncs only when someone presses Sync now.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Stale after (hours)" htmlFor="source-stale" hint="Leave blank to show the age without ever marking it stale.">
              <input id="source-stale" type="text" inputMode="numeric" value={draft.stale_after_hours} onChange={(e) => set("stale_after_hours", e.target.value)} className={inputClass} />
            </Field>
            <div className="self-start pt-7">
              <label className="inline-flex items-center gap-2 text-sm text-ink tap:min-h-11">
                <input type="checkbox" checked={draft.stale_business_days} onChange={(e) => set("stale_business_days", e.target.checked)} className={checkboxClass} />
                Count weekdays only
              </label>
              <p className={helpClass}>Weekends do not count toward the limit.</p>
            </div>
            <label className="inline-flex items-center gap-2 self-start pt-7 text-sm text-ink tap:min-h-11">
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

export default function DataSourcesPanel({ companyId, companyTimeZone }: { companyId: string; companyTimeZone: string }) {
  const { sourceId } = useParams();
  const navigate = useNavigate();
  // The list and the open source sit side by side from lg up (ListDetail); only there does the bare address show a source.
  const wide = useIsWide();
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
  const asList = (data?.sources.length ?? 0) > MOST_AS_ROWS;

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

  // A source's address only means something once the sources are a list; with three or fewer it
  // goes back to the rows, where every source already shows.
  if (data && !asList && sourceId) return <Navigate to={BASE} replace />;

  const connectionOf = (source: SyncSource) => data?.connections.find((c) => c.id === source.connection_id) ?? null;
  const addSource = <Button size="sm" onClick={() => setEditing("new")} disabled={!data}>Add source</Button>;
  const notices = (
    <>
      {notice ? <Notice tone={notice.tone} className="mb-4">{notice.text}</Notice> : null}
      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
    </>
  );
  const editor =
    editing && data ? (
      <SourceEditor
        companyId={companyId}
        source={editing === "new" ? null : editing}
        connections={data.connections}
        onClose={() => setEditing(null)}
        onSaved={(saved) => {
          const added = editing === "new";
          replace(saved);
          setEditing(null);
          // A new source opens at its own address once the sources are a list.
          if (added && data.sources.length + 1 > MOST_AS_ROWS) navigate(`${BASE}/sources/${saved.id}`);
        }}
      />
    ) : null;

  if (data && asList) {
    const items: ListDetailItem[] = data.sources.map((source) => ({
      id: source.id,
      title: source.name,
      meta: `${TARGET_MODULE_LABELS[source.target_module]} · ${CONNECTION_PROVIDER_LABELS[source.provider]}`,
    }));
    const selectedId = sourceId ?? (wide ? data.sources[0].id : null);
    const selected = selectedId ? (data.sources.find((s) => s.id === selectedId) ?? null) : null;
    return (
      <section>
        <div className="mb-4">
          <p className={sectionEyebrowClass}>Integrations</p>
          <h2 className={`${sectionTitleClass} mt-1`}>Data sources</h2>
          <p className={`${secondaryClass} mt-1`}>{DESCRIPTION}</p>
        </div>
        {notices}
        <ListDetail
          label="Data sources"
          items={items}
          selectedId={selectedId}
          hrefFor={(id) => `${BASE}/sources/${id}`}
          backHref={BASE}
          backLabel="Data sources"
          countLabel={pluralize(data.sources.length, "data source")}
          searchLabel="Search data sources"
          actions={addSource}
        >
          {selected ? (
            <DataSourceDetail
              key={selected.id}
              source={selected}
              connection={connectionOf(selected)}
              now={now}
              companyTimeZone={companyTimeZone}
              syncing={syncing === selected.id}
              syncBusy={syncing !== null}
              runsKey={syncCount}
              onToggle={(enabled) => void toggle(selected, enabled)}
              onSync={() => void syncNow(selected)}
              onEdit={() => setEditing(selected)}
            />
          ) : (
            <p className={secondaryClass}>That data source is not in this company.</p>
          )}
        </ListDetail>
        {editor}
      </section>
    );
  }

  return (
    <Section eyebrow="Integrations" title="Data sources" description={DESCRIPTION} actions={addSource}>
      {notices}
      {state.error && !data ? <Notice tone="error">{state.error}</Notice> : null}
      {!data && !state.error ? <SkeletonRows rows={3} /> : null}
      {data && data.sources.length === 0 ? <p className={secondaryClass}>No data sources yet.</p> : null}
      {data && data.sources.length > 0 ? (
        <ul className="divide-y divide-line">
          {data.sources.map((source) => {
            const connection = connectionOf(source);
            return (
              <li key={source.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={itemTitleClass}>{source.name}</p>
                      <SyncStateBadge state={syncState(source, connection, now, companyTimeZone)} />
                    </div>
                    <p className={`mt-0.5 ${metaClass}`}>{`${TARGET_MODULE_LABELS[source.target_module]} · ${CONNECTION_PROVIDER_LABELS[source.provider]}`}</p>
                    <div className="mt-1">
                      <FreshnessLine source={source} connection={connection} now={now} companyTimeZone={companyTimeZone} />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-2 tap:min-h-11">
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
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Show runs for ${source.name}`}
                      aria-expanded={runsOpen === source.id}
                      onClick={() => setRunsOpen((open) => (open === source.id ? null : source.id))}
                    >
                      Recent runs
                    </Button>
                    <IconButton label={`Edit ${source.name}`} onClick={() => setEditing(source)}>
                      <Pencil size={15} aria-hidden="true" />
                    </IconButton>
                  </div>
                </div>
                {runsOpen === source.id ? (
                  <div className="mt-3">
                    <SourceRuns key={syncCount} sourceId={source.id} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {editor}
    </Section>
  );
}
