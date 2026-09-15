// Confirmation step for destructive actions. The confirm button is the only loud thing in
// the dialog on purpose.
//
// A refused delete (a closed cycle, an RLS denial) has to report itself here. The dialog sits
// over a scrim, so a notice rendered by the page underneath is dimmed and easy to miss, and the
// action reads as having quietly done nothing. Callers pass whatever their save threw.
import Modal from "./Modal.tsx";
import Button from "./Button.tsx";
import Notice from "./Notice.tsx";

export default function ConfirmDialog({
  title,
  body,
  confirmLabel,
  busy = false,
  error = "",
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  busy?: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal onClose={onCancel} labelledBy="confirm-title">
      <div className="p-6">
        <h2 id="confirm-title" className="font-display text-lg text-heading">
          {title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">{body}</p>
        {error ? <Notice tone="error" className="mt-4">{error}</Notice> : null}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger-solid" onClick={onConfirm} disabled={busy}>
            {busy ? "Working..." : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
