// A data source's state as a badge, so every screen that names a source's freshness shows the
// same words in the same tone (lib/sync/state.ts owns the words, status.ts the tones).
import { RefreshCw } from "lucide-react";
import Badge from "../ui/Badge.tsx";
import { SYNC_STATE_TONE } from "../status.ts";
import { SYNC_STATE_LABELS, type SyncState } from "../../lib/sync/state.ts";

export default function SyncStateBadge({ state }: { state: SyncState }) {
  return (
    <Badge tone={SYNC_STATE_TONE[state]}>
      {state === "syncing" ? <RefreshCw size={11} className="animate-spin" aria-hidden /> : null}
      {SYNC_STATE_LABELS[state]}
    </Badge>
  );
}
