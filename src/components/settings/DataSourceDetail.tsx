// One data source in its own view, once a company holds enough sources that Settings, Connections
// lists them: its name as the heading, its state and freshness, the two everyday controls (Enabled
// and Sync now), what it reads, and its recent runs. What it reads is set once, so it reads as text
// first and its pencil opens the same editor the rows use; the editor checks the column map as a
// whole, which is why it stays one form with one Save. Nothing here shows or asks for a token: Sync
// now goes through the connections Edge Function, as it does from a row.
import { Pencil } from "lucide-react";
import type { ReactNode } from "react";
import FreshnessLine from "../sync/FreshnessLine.tsx";
import SyncStateBadge from "../sync/SyncStateBadge.tsx";
import Button from "../ui/Button.tsx";
import IconButton from "../ui/IconButton.tsx";
import { checkboxClass } from "../ui/forms.ts";
import { bodyClass, eyebrowLabelClass, metaClass, secondaryClass, sectionTitleClass } from "../ui/type.ts";
import { draftFromSource } from "../../lib/sync/draft.ts";
import { syncState } from "../../lib/sync/state.ts";
import { CONNECTION_PROVIDER_LABELS, FIELD_TYPE_LABELS, TARGET_MODULE_LABELS, type CompanyConnection, type SyncSource } from "../../types/database.ts";
import SourceRuns from "./SourceRuns.tsx";

// Monday first, as the editor ticks them; the number is the day in the database (0 = Sunday).
const DAY_LABELS: Array<[number, string]> = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [0, "Sun"]];

function Value({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="py-2.5">
      <dt className={eyebrowLabelClass}>{label}</dt>
      <dd className={`mt-1 ${bodyClass} [overflow-wrap:anywhere]`}>{children}</dd>
    </div>
  );
}

function schedule(days: number[], time: string, zone: string): string {
  if (days.length === 0) return "Only when someone presses Sync now.";
  const named = DAY_LABELS.filter(([day]) => days.includes(day)).map(([, label]) => label).join(", ");
  return `${named}${time ? ` at ${time}` : ""}${zone ? `, ${zone}` : ""}`;
}

export default function DataSourceDetail({
  source,
  connection,
  now,
  companyTimeZone,
  syncing,
  syncBusy,
  runsKey,
  onToggle,
  onSync,
  onEdit,
}: {
  source: SyncSource;
  connection: CompanyConnection | null;
  now: Date;
  companyTimeZone: string;
  syncing: boolean;
  syncBusy: boolean;
  runsKey: number;
  onToggle: (enabled: boolean) => void;
  onSync: () => void;
  onEdit: () => void;
}) {
  const draft = draftFromSource(source);
  const sheets = "spreadsheet_id" in source.config ? source.config : null;
  const headingId = `data-source-${source.id}`;
  const stale = draft.stale_after_hours
    ? `After ${draft.stale_after_hours} hours${draft.stale_business_days ? ", counting weekdays only" : ""}.`
    : "Never marked stale. The age still shows.";

  return (
    <article aria-labelledby={headingId}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={headingId} className={`${sectionTitleClass} min-w-0 [overflow-wrap:anywhere]`}>{source.name}</h2>
        <SyncStateBadge state={syncState(source, connection, now, companyTimeZone)} />
      </div>
      <div className="mt-1">
        <FreshnessLine source={source} connection={connection} now={now} companyTimeZone={companyTimeZone} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className={`inline-flex min-h-9 items-center gap-2 ${secondaryClass}`}>
          <input type="checkbox" aria-label={`Enable ${source.name}`} checked={source.enabled} onChange={(e) => onToggle(e.target.checked)} className={checkboxClass} />
          Enabled
        </label>
        <Button variant="secondary" size="sm" aria-label={`Sync ${source.name} now`} disabled={connection?.status !== "connected" || syncBusy} onClick={onSync}>
          {syncing ? "Syncing..." : "Sync now"}
        </Button>
      </div>

      <div className="mt-6 border-t border-line pt-4">
        <div className="flex items-center justify-between gap-3">
          <p className={eyebrowLabelClass}>What it reads</p>
          <IconButton label={`Edit ${source.name}`} onClick={onEdit} className="!h-11 !w-11 sm:!h-9 sm:!w-9">
            <Pencil size={15} aria-hidden="true" />
          </IconButton>
        </div>
        <dl className="divide-y divide-line">
          <div className="grid gap-x-6 sm:grid-cols-2">
            <Value label="Feeds">{TARGET_MODULE_LABELS[source.target_module]}</Value>
            <Value label="Source">{CONNECTION_PROVIDER_LABELS[source.provider]}</Value>
          </div>
          {sheets ? (
            <div className="grid gap-x-6 sm:grid-cols-3">
              <Value label="Spreadsheet">{`${sheets.spreadsheet_id}, tab ${sheets.sheet_gid}`}</Value>
              <Value label="Header row">{draft.header_row}</Value>
              <Value label="Range">{draft.range || "The whole tab"}</Value>
            </div>
          ) : (
            <Value label="QuickBooks records">{draft.entity}</Value>
          )}
          <Value label="Fields">
            {draft.fields.length === 0 ? (
              "No fields mapped yet."
            ) : (
              <ul className="space-y-1.5">
                {draft.fields.map((field) => (
                  <li key={field.key || field.header}>
                    <span className="block">{field.header}</span>
                    <span className={`block ${metaClass}`}>
                      {[field.key, FIELD_TYPE_LABELS[field.type], field.unit, field.required ? "Required" : ""].filter(Boolean).join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Value>
          <Value label="Record key">{draft.record_key.length > 0 ? draft.record_key.join(", ") : "None. Each sync replaces the whole tab."}</Value>
          <div className="grid gap-x-6 sm:grid-cols-2">
            <Value label="Syncs">{schedule(draft.weekdays, draft.time, draft.timezone)}</Value>
            <Value label="Stale">{stale}</Value>
          </div>
        </dl>
      </div>

      <div className="mt-6 border-t border-line pt-4">
        <p className={`${eyebrowLabelClass} mb-3`}>Recent runs</p>
        <SourceRuns key={runsKey} sourceId={source.id} />
      </div>
    </article>
  );
}
