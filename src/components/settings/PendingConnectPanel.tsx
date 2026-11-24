// The step a provider's sign-in comes back to: nothing is connected until the admin who started it
// says so here. It reads the waiting sign-in from the connections Edge Function and asks
// "Connect {Tool} account {name} to {company}?", with Connect and Cancel. Someone else who opens a
// forwarded link, or anyone with an expired or used one, is told so and can only Close. The tool,
// the account name and the company come from the function; the account name is the provider's
// text, so it is only ever shown as text. What happened goes back to the catalog through onDone.
import { useId, useState } from "react";
import Button from "../ui/Button.tsx";
import Modal from "../ui/Modal.tsx";
import Notice from "../ui/Notice.tsx";
import Skeleton from "../ui/Skeleton.tsx";
import { secondaryClass, sectionTitleClass } from "../ui/type.ts";
import { useAsync } from "../../hooks/useAsync.ts";
import { discardConnection, finishConnection, readPendingConnection } from "../../services/connections.ts";
import { confirmConnectLine, stillListedLine } from "../../lib/connectors.ts";
import { errorMessage } from "../../lib/errors.ts";
import { PENDING_GONE, PENDING_SOMEONE_ELSE } from "../../../supabase/functions/_shared/connectFlow.ts";
import { CONNECTION_PROVIDER_LABELS, type Company, type ConnectionProvider } from "../../types/database.ts";

export type PendingOutcome = { tone: "success" | "info" | "warning"; text: string; provider?: ConnectionProvider } | null;

// A refusal that no second press can change: the sign-in is someone else's, or it is gone.
const isFinal = (err: unknown) => err instanceof Error && (err.message === PENDING_GONE || err.message === PENDING_SOMEONE_ELSE);

export default function PendingConnectPanel({ company, pendingId, onDone }: { company: Company; pendingId: string; onDone: (outcome: PendingOutcome) => void }) {
  const titleId = useId();
  // The company is the catalog's; a Rococo admin switching company starts the catalog afresh.
  const pending = useAsync(() => readPendingConnection(pendingId), [company.id, pendingId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [final, setFinal] = useState(false);

  const answer = pending.data;
  const ready = answer?.status === "ready" && !final ? answer : null;
  const tool = ready ? CONNECTION_PROVIDER_LABELS[ready.provider] : "";

  async function act(kind: "connect" | "cancel") {
    if (busy || !ready) return;
    setBusy(true);
    setError("");
    try {
      if (kind === "connect") {
        const provider = await finishConnection(pendingId);
        onDone({ tone: "success", text: `${CONNECTION_PROVIDER_LABELS[provider]} is connected.`, provider });
      } else {
        const { revoked } = await discardConnection(pendingId);
        onDone(revoked ? { tone: "info", text: "Nothing was connected." } : { tone: "warning", text: `Nothing was connected. ${stillListedLine(tool)}` });
      }
    } catch (err) {
      setError(errorMessage(err));
      setFinal(isFinal(err));
      setBusy(false);
    }
  }

  // While the question is open it needs an answer, Connect or Cancel, so Escape and the backdrop
  // leave it be; everywhere else they close.
  const close = () => {
    if (busy || ready) return;
    onDone(null);
  };

  const line =
    answer?.status === "someone_else" ? PENDING_SOMEONE_ELSE
    : answer?.status === "gone" ? PENDING_GONE
    : null;

  return (
    <Modal onClose={close} labelledBy={titleId}>
      <div className="p-6">
        <h2 id={titleId} className={sectionTitleClass}>Confirm the connection</h2>
        {!answer && !pending.error ? (
          <div className="mt-3 space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : null}
        {pending.error && !answer ? <Notice tone="error" className="mt-3">{pending.error}</Notice> : null}
        {ready ? <p className={`mt-2 ${secondaryClass} [overflow-wrap:anywhere]`}>{confirmConnectLine(tool, ready.account_name, ready.company_name)}</p> : null}
        {line ? <p className={`mt-2 ${secondaryClass}`}>{line}</p> : null}
        {error ? <Notice tone="error" className="mt-4">{error}</Notice> : null}
        <div className="mt-6 flex justify-end gap-2">
          {ready ? (
            <>
              <Button variant="secondary" onClick={() => void act("cancel")} disabled={busy}>Cancel</Button>
              <Button onClick={() => void act("connect")} disabled={busy}>Connect</Button>
            </>
          ) : (
            <>
              {pending.error && !answer ? <Button variant="secondary" onClick={pending.reload} disabled={pending.loading}>Try again</Button> : null}
              {answer || pending.error ? <Button variant="secondary" onClick={() => onDone(null)}>Close</Button> : null}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
