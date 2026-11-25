// The reader's own sign-off on an SOP: a box to confirm they have read and completed it, and a
// button that records it (0053). The database stamps the version, their name and the time, and
// closes their open tasks on the SOP; this card says which version they signed and when, offers a
// fresh sign-off once the SOP has changed, and names the task a sign-off will finish.
import { useState } from "react";
import { ClipboardCheck } from "lucide-react";
import Button from "../ui/Button.tsx";
import Notice from "../ui/Notice.tsx";
import Section from "../ui/Section.tsx";
import { checkboxClass } from "../ui/forms.ts";
import { metaClass, secondaryClass } from "../ui/type.ts";
import { errorMessage } from "../../lib/errors.ts";
import { formatDate } from "../../lib/format.ts";
import { signOffSop } from "../../services/sopSignoffs.ts";
import type { Sop, SopSignoff, TaskWithSteps } from "../../types/database.ts";

export default function SignoffCard({
  sop,
  profileId,
  signoffs,
  openTasks,
  onSigned,
}: {
  sop: Sop;
  profileId: string;
  // This person's sign-offs on this SOP, newest first.
  signoffs: SopSignoff[];
  // This person's open tasks on this SOP.
  openTasks: TaskWithSteps[];
  onSigned: (signoff: SopSignoff) => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const latest = signoffs[0] ?? null;
  const current = latest !== null && latest.version >= sop.current_version;
  // A task assigned since the last sign-off asks for a new one, even on the same version.
  const askedAgain = openTasks.some((t) => !latest || t.created_at > latest.signed_at);
  const canSign = !current || askedAgain;

  async function sign() {
    setBusy(true);
    setError("");
    try {
      const signoff = await signOffSop(sop.id, profileId);
      setConfirmed(false);
      onSigned(signoff);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section eyebrow="Sign-off" title={current && !askedAgain ? "Signed off" : "Sign off this SOP"}>
      {latest ? (
        <p className={`flex items-start gap-2 ${secondaryClass}`}>
          <ClipboardCheck size={15} className="mt-0.5 shrink-0 text-success" aria-hidden />
          <span>
            You signed off version {latest.version} on {formatDate(latest.signed_at, "long")}.
            {!current ? ` It has changed since; version ${sop.current_version} is current.` : ""}
          </span>
        </p>
      ) : (
        <p className={secondaryClass}>Read it through, do what it asks, then sign it off here. Your admins see who has signed which version.</p>
      )}
      {canSign ? (
        <div className="mt-4 space-y-3">
          {openTasks.length ? (
            <p className={metaClass}>
              Signing off finishes your task{openTasks.length > 1 ? "s" : ""}: {openTasks.map((t) => t.title).join(", ")}.
            </p>
          ) : null}
          <label className="flex items-start gap-2 text-sm text-ink">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className={`${checkboxClass} mt-0.5`} />
            <span>I have read this SOP and completed it</span>
          </label>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button size="sm" disabled={!confirmed || busy} onClick={() => void sign()}>{busy ? "Signing..." : "Sign off"}</Button>
        </div>
      ) : null}
    </Section>
  );
}
