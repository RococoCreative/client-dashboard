// Whether a person is due a GSR by their rhythm, as a small badge, so the log and any later screen
// say it the same way. The state comes from dueFor in lib/gsr/onDemand.ts and nowhere else; a
// person with rhythm None, or one not yet due, shows nothing at all.
import Badge from "../../ui/Badge.tsx";
import type { DueState } from "../../../lib/gsr/onDemand.ts";

export default function DueBadge({ state }: { state: DueState }) {
  if (state === "due") return <Badge tone="warning">Due today</Badge>;
  if (state === "overdue") return <Badge tone="danger">Overdue</Badge>;
  return null;
}
