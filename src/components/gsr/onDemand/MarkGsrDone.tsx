// Mark done for one GSR on demand, in one place, so the GSR's own page and the last GSR read back on
// the next one close a GSR the same way: the button, the goals read again before the confirm opens,
// the confirm with the score those goals add up to (scoreMonth against the company's number of
// mandatory goals) or none where the company does not score its GSRs, and a refusal said inside the
// dialog. Who may see the button is the caller's to decide (never the person themself); the
// database refuses anyone else as well.
import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import Button from "../../ui/Button.tsx";
import ConfirmDialog from "../../ui/ConfirmDialog.tsx";
import { useHub } from "../../../context/HubContext.tsx";
import { monthTotal, scoreMonth } from "../../../lib/gsr/goals.ts";
import { gsrGoals } from "../../../lib/gsr/onDemand.ts";
import { errorMessage } from "../../../lib/errors.ts";
import { listGoals } from "../../../services/gsr.ts";
import { markGsrDone } from "../../../services/gsrOnDemand.ts";
import type { Goal, Gsr } from "../../../types/database.ts";

// What the dialog shows and writes: the score of the goals as they were read again when it opened,
// or no score where the company does not score its GSRs.
type Closing = { score: number; total: number; cap: number } | { score: null };

export default function MarkGsrDone({
  gsr,
  required,
  variant = "primary",
  disabled = false,
  onBusy,
  onGoals,
  onDone,
  onError,
}: {
  gsr: Gsr;
  // How many goals a GSR requires, from the company's active Monthly GSRs pillar; null where the
  // company does not score its GSRs.
  required: number | null;
  // The page's one primary action is its own GSR's; anywhere else this reads as secondary.
  variant?: "primary" | "secondary";
  disabled?: boolean;
  // Told when a read or a write starts and ends, so the caller can hold its other controls still.
  onBusy?: (busy: boolean) => void;
  // The person's goals as read again, every GSR's, for the caller to take what it shows.
  onGoals: (fresh: Goal[]) => void;
  onDone: (next: Gsr) => void;
  // A failure reading the goals, for the caller's own line; an empty one clears it once done.
  onError: (message: string) => void;
}) {
  const { profile } = useHub();
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState<Closing | null>(null);
  // The dialog's own failure line, so an earlier failure on the page never shows inside it.
  const [dialogError, setDialogError] = useState("");
  const working = (next: boolean) => {
    setBusy(next);
    onBusy?.(next);
  };

  async function start() {
    working(true);
    setDialogError("");
    try {
      const fresh = await listGoals(gsr.company_id, gsr.employee_id);
      onGoals(fresh);
      const own = gsrGoals(fresh, gsr.id);
      setClosing(required ? { ...monthTotal(own, required), score: scoreMonth(own, required) } : { score: null });
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      working(false);
    }
  }

  async function confirm() {
    if (!closing) return;
    working(true);
    setDialogError("");
    try {
      const next = await markGsrDone(gsr.id, closing.score, profile.id);
      onDone(next);
      setClosing(null);
      onError("");
    } catch (err) {
      setDialogError(errorMessage(err));
    } finally {
      working(false);
    }
  }

  return (
    <>
      <Button variant={variant} size="sm" disabled={busy || disabled} onClick={() => void start()}>
        <CheckCircle2 size={14} aria-hidden /> Mark done
      </Button>
      {closing ? (
        <ConfirmDialog
          title={closing.score !== null ? `Mark this GSR done at ${closing.score}%?` : "Mark this GSR done?"}
          body={
            closing.score !== null
              ? `Its goals add up to ${closing.total}% of ${closing.cap}%, as they stand now. Marking it done locks that score in, with its goals and notes. Reopen it to change them.`
              : "Marking it done puts its goals and notes on record as they stand now. Reopen it to change them."
          }
          confirmLabel="Mark done"
          tone="primary"
          busy={busy}
          error={dialogError}
          onConfirm={() => void confirm()}
          onCancel={() => setClosing(null)}
        />
      ) : null}
    </>
  );
}
