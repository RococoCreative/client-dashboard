// A setup row that reads as text until its pencil is clicked. Setup fields are read first, so a
// page of them is calm to scan and nothing changes by accident. While editing, the row swaps to
// the form the caller passes in and offers Done; the caller owns the state and what saving means.
import { Pencil } from "lucide-react";
import type { ReactNode } from "react";
import Button from "./Button.tsx";
import IconButton from "./IconButton.tsx";

export default function EditRow({
  display,
  editLabel,
  editing,
  onEdit,
  onDone,
  children,
}: {
  display: ReactNode;
  editLabel: string;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
  children: ReactNode;
}) {
  if (editing) {
    return (
      <div className="border-b border-line py-3">
        <div>{children}</div>
        <div className="mt-3 flex justify-end">
          <Button variant="secondary" size="sm" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line py-3">
      <div className="min-w-0 flex-1">{display}</div>
      <IconButton label={editLabel} onClick={onEdit}>
        <Pencil size={15} aria-hidden="true" />
      </IconButton>
    </div>
  );
}
