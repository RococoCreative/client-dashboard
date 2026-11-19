// A setup row that reads as text until its pencil is clicked. Setup fields are read first, so a
// page of them is calm to scan and nothing changes by accident. While editing, the row swaps to
// the form the caller passes in and offers Done; the caller owns the state and what saving means.
//
// Focus follows the row (useEditRowFocus): opening moves it to the first field, and Done or Escape
// closes the row and puts it back on the pencil. Escape blurs the field first, so a field that
// saves on blur still saves. Closing on blur is deliberately not a way out: it would shut a row
// with several fields while a person tabs between them.
//
// A list row can carry more than the text and the pencil: `leading` sits before the text in both
// states (a step's tick), `actions` sit beside the pencil in both states (the arrows that reorder a
// list), `after` runs full width under the row in both states (live controls, or the rest of a
// long form the caller shows only while open), and `footer` is the worded danger action (Remove,
// Archive, Delete) that sits beside Done in the open row, away from everyday controls.
import { Pencil } from "lucide-react";
import type { ReactNode } from "react";
import Button from "./Button.tsx";
import IconButton from "./IconButton.tsx";
import useEditRowFocus from "./useEditRowFocus.ts";

export default function EditRow({
  display,
  editLabel,
  editing,
  onEdit,
  onDone,
  children,
  footer,
  actions,
  leading,
  after,
  as: Tag = "div",
  className = "border-b border-line py-3",
}: {
  display: ReactNode;
  editLabel: string;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
  children: ReactNode;
  footer?: ReactNode;
  actions?: ReactNode;
  leading?: ReactNode;
  after?: ReactNode;
  as?: "div" | "li";
  className?: string;
}) {
  const { formRef, pencilRef, doneRef, rowRef, done, onKeyDown } = useEditRowFocus(editing, onDone);
  const side = actions || !editing ? (
    <div className="flex shrink-0 items-center">
      {actions}
      {editing ? null : (
        <IconButton ref={pencilRef} label={editLabel} onClick={onEdit}>
          <Pencil size={15} aria-hidden="true" />
        </IconButton>
      )}
    </div>
  ) : null;
  return (
    <Tag ref={(el: HTMLElement | null) => { rowRef.current = el; }} className={className} onKeyDown={onKeyDown}>
      <div className="flex items-start justify-between gap-3">
        {leading ? <div className="flex min-h-9 shrink-0 items-center tap:min-h-11">{leading}</div> : null}
        {editing ? (
          <div ref={(el) => { formRef.current = el; }} className="min-w-0 flex-1">{children}</div>
        ) : (
          // At least the pencil's height with its content centred, so a one-line display lines up
          // with the pencil beside it instead of sitting above it.
          <div className="flex min-h-9 min-w-0 flex-1 items-center tap:min-h-11">
            <div className="w-full min-w-0">{display}</div>
          </div>
        )}
        {side}
      </div>
      {after}
      {editing ? (
        <div className={`mt-3 flex flex-wrap gap-2 ${footer ? "justify-between" : "justify-end"}`}>
          {footer}
          <Button ref={doneRef} variant="secondary" size="sm" onClick={done}>
            Done
          </Button>
        </div>
      ) : null}
    </Tag>
  );
}
