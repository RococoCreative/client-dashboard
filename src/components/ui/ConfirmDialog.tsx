// Confirmation step for destructive actions. The confirm button is the only loud thing in
// the dialog on purpose.
import Modal from "./Modal.tsx";
import Button from "./Button.tsx";

export default function ConfirmDialog({
  title,
  body,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  busy?: boolean;
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
