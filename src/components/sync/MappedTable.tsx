// The values a source's last good sync brought in, as its own column map lays them out, each row
// linked back to where it came from. Read-only by design: a figure is changed at its source, and
// nothing here adds, averages or compares one.
import { tableClass, tdClass, thClass } from "../ui/forms.ts";
import { formatMappedValue } from "../../lib/sync/format.ts";
import { recordLink } from "../../../supabase/functions/_shared/sync/links.ts";
import { CONNECTION_PROVIDER_LABELS, type FieldType, type SyncRecord, type SyncSource } from "../../types/database.ts";

const NUMERIC: ReadonlySet<FieldType> = new Set(["number", "currency", "percent"]);

// The order the rows sit in at the source: by spreadsheet row when there is one, else by key.
function sourceOrder(records: SyncRecord[]): SyncRecord[] {
  const row = (record: SyncRecord) => (typeof record.source_ref.row === "number" ? record.source_ref.row : null);
  return [...records].sort((a, b) => {
    const ra = row(a);
    const rb = row(b);
    if (ra !== null && rb !== null && ra !== rb) return ra - rb;
    return a.record_key.localeCompare(b.record_key);
  });
}

export default function MappedTable({ source, records }: { source: SyncSource; records: SyncRecord[] }) {
  return (
    <div>
      <p className="text-[12px] text-ink-3">Read-only, from {CONNECTION_PROVIDER_LABELS[source.provider]}.</p>
      {records.length === 0 ? (
        <p className="mt-2 text-sm text-ink-2">No rows in the last sync.</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className={tableClass}>
            <thead>
              <tr>
                {source.field_map.map((entry) => (
                  <th key={entry.key} className={`${thClass} whitespace-nowrap ${NUMERIC.has(entry.type) ? "text-right" : ""}`}>
                    {entry.unit ? `${entry.label} (${entry.unit})` : entry.label}
                  </th>
                ))}
                <th className={thClass}>Source</th>
              </tr>
            </thead>
            <tbody>
              {sourceOrder(records).map((record) => {
                const link = recordLink(record.source_ref);
                return (
                  <tr key={record.id}>
                    {source.field_map.map((entry) => (
                      <td key={entry.key} className={`${tdClass} whitespace-nowrap ${NUMERIC.has(entry.type) ? "tnum text-right" : ""}`}>
                        {formatMappedValue(record.data[entry.key] ?? null, entry.type)}
                      </td>
                    ))}
                    <td className={`${tdClass} whitespace-nowrap`}>
                      {link ? (
                        <>
                          <a href={link.href} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{link.label}</a>
                          {link.note !== null ? <span className="ml-1 text-ink-3">{link.note}</span> : null}
                        </>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
