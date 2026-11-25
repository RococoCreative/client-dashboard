// An SOP's version history: every saved version with who saved it, when and why. Any version can
// be read and compared with the current one; an admin can restore an older one, which saves its
// text again as the newest version. Nothing here ever rewrites a version.
import { useState } from "react";
import { GitCompare, RotateCcw } from "lucide-react";
import Button from "../ui/Button.tsx";
import ConfirmDialog from "../ui/ConfirmDialog.tsx";
import IconButton from "../ui/IconButton.tsx";
import Modal from "../ui/Modal.tsx";
import Section from "../ui/Section.tsx";
import { metaClass } from "../ui/type.ts";
import { diffLines } from "../../lib/sops/diff.ts";
import { docToLines, versionDoc } from "../../lib/sops/doc.ts";
import { formatDateTime, pluralize } from "../../lib/format.ts";
import { errorMessage } from "../../lib/errors.ts";
import type { SopVersion } from "../../types/database.ts";

const DIFF_LOOK = {
  same: "text-ink-2",
  added: "bg-success/10 text-ink border-l-2 border-success",
  removed: "bg-danger/10 text-ink-2 line-through border-l-2 border-danger",
} as const;

function Compare({ older, current, onClose }: { older: SopVersion; current: SopVersion; onClose: () => void }) {
  const lines = diffLines(docToLines(versionDoc(older)), docToLines(versionDoc(current)));
  const titleId = "sop-compare-title";
  const changed = lines.filter((l) => l.kind !== "same").length;
  return (
    <Modal onClose={onClose} labelledBy={titleId} size="lg">
      <div className="px-5 py-4 sm:px-6">
        <h2 id={titleId} className="text-base font-semibold text-heading">Version {older.version} against version {current.version}</h2>
        <p className={`mt-1 ${metaClass}`}>{changed ? `${pluralize(changed, "line")} changed. Added lines are marked green, removed ones red and struck through.` : "The two versions read the same."}</p>
        <ol className="mt-4 max-h-[60vh] space-y-0.5 overflow-y-auto text-[13px] leading-relaxed">
          {lines.map((line, i) => (
            <li key={i} data-diff={line.kind} className={`rounded-sm px-2 py-0.5 ${DIFF_LOOK[line.kind]}`}>
              <span className="sr-only">{line.kind === "same" ? "" : `${line.kind}: `}</span>
              {line.text}
            </li>
          ))}
        </ol>
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}

export default function VersionHistory({
  versions,
  currentVersion,
  shownVersion,
  canRestore,
  onShow,
  onRestore,
}: {
  versions: SopVersion[];
  currentVersion: number;
  shownVersion: number | null;
  canRestore: boolean;
  onShow: (version: number | null) => void;
  onRestore: (version: SopVersion) => Promise<void>;
}) {
  const [comparing, setComparing] = useState<SopVersion | null>(null);
  const [restoring, setRestoring] = useState<SopVersion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = versions.find((v) => v.version === currentVersion) ?? versions[0];
  const next = Math.max(0, ...versions.map((v) => v.version)) + 1;

  async function restore() {
    if (!restoring) return;
    setBusy(true);
    setError("");
    try {
      await onRestore(restoring);
      setRestoring(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section eyebrow="History" title={pluralize(versions.length, "version")} padded={false}>
      <ul className="divide-y divide-line">
        {versions.map((v) => {
          const isCurrent = v.version === currentVersion;
          return (
            <li key={v.id} className="flex items-start gap-1 px-4 py-3 sm:px-6">
              <Button
                variant="row"
                aria-pressed={(shownVersion ?? currentVersion) === v.version}
                onClick={() => onShow(isCurrent ? null : v.version)}
                className="min-w-0 flex-1 justify-start text-left"
              >
                <span className="min-w-0">
                  <span className="tnum block">Version {v.version}{isCurrent ? " (current)" : ""}</span>
                  <span className={`block truncate ${metaClass}`}>{v.change_note ?? "No change note"}</span>
                  <span className={`block ${metaClass}`}>{formatDateTime(v.created_at)}{v.author_name ? ` by ${v.author_name}` : ""}</span>
                </span>
              </Button>
              {!isCurrent && current ? (
                <div className="flex shrink-0 items-center">
                  <IconButton label={`Compare version ${v.version} with current`} onClick={() => setComparing(v)}><GitCompare size={15} aria-hidden /></IconButton>
                  {canRestore ? (
                    <IconButton label={`Restore version ${v.version}`} onClick={() => setRestoring(v)}><RotateCcw size={15} aria-hidden /></IconButton>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {comparing && current ? <Compare older={comparing} current={current} onClose={() => setComparing(null)} /> : null}
      {restoring ? (
        <ConfirmDialog
          title={`Restore version ${restoring.version}?`}
          body={`Its text is saved again as version ${next}. Every version stays in history, so this can be undone the same way.`}
          confirmLabel={`Restore as version ${next}`}
          tone="primary"
          busy={busy}
          error={error}
          onConfirm={() => void restore()}
          onCancel={() => {
            setRestoring(null);
            setError("");
          }}
        />
      ) : null}
    </Section>
  );
}
