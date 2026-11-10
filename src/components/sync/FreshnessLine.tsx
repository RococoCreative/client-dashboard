// One plain line on how fresh a source's data is: when it last synced and how long ago, or why
// it has nothing to show. A failed or running sync names the time of the last good data still on
// screen, so nobody reads old figures as new ones.
import { Link } from "react-router-dom";
import { formatDateTime } from "../../lib/format.ts";
import { formatAge } from "../../lib/sync/format.ts";
import { ageHours, failureDetail, syncState } from "../../lib/sync/state.ts";
import { CONNECTION_PROVIDER_LABELS, type CompanyConnection, type SyncSource } from "../../types/database.ts";

function lastGood(source: SyncSource): string {
  return source.last_success_at ? ` Showing data from ${formatDateTime(source.last_success_at)}.` : "";
}

export default function FreshnessLine({ source, connection, now = new Date() }: { source: SyncSource; connection: CompanyConnection | null; now?: Date }) {
  const state = syncState(source, connection, now);
  const age = formatAge(ageHours(source.last_success_at, now) ?? 0);
  const when = formatDateTime(source.last_success_at);
  return (
    <p className="text-[12.5px] text-ink-2">
      {state === "not_connected" ? (
        <>
          Not connected. Connect {CONNECTION_PROVIDER_LABELS[source.provider]} in{" "}
          <Link to="/settings/connections" className="text-accent hover:underline">Settings</Link>.
        </>
      ) : state === "awaiting_first_sync" ? (
        "Connected. No data yet."
      ) : state === "syncing" ? (
        `Syncing now.${lastGood(source)}`
      ) : state === "failed" ? (
        `Sync failed. ${failureDetail(source, now, connection)}${lastGood(source) || " No data yet."}`
      ) : state === "stale" ? (
        `Stale: last synced ${when}, ${age} ago.`
      ) : (
        `Synced ${when}, ${age} ago.`
      )}
    </p>
  );
}
