// The keyboard side of a read-first row, built once so every row hands focus over the same way. A
// row that opens moves focus to its first field, so a keyboard or screen reader user lands where
// the work is; Done or Escape closes it and puts focus back on the pencil that opened it, so they
// keep their place in the list. EditRow uses it, and so does a table row that cannot be an EditRow.
import { useEffect, useRef, type KeyboardEvent } from "react";

const FIELDS = "input:not([type=hidden]):not(:disabled), select:not(:disabled), textarea:not(:disabled)";

export default function useEditRowFocus(editing: boolean, onDone: () => void) {
  // The element that holds the open row's fields, the pencil, and Done (the fallback when the row
  // has no field a person can change).
  const formRef = useRef<HTMLElement | null>(null);
  const pencilRef = useRef<HTMLButtonElement | null>(null);
  const doneRef = useRef<HTMLButtonElement | null>(null);
  const rowRef = useRef<HTMLElement | null>(null);
  const wasEditing = useRef(editing);
  // Set by Done and Escape only: a row closed because another one opened leaves focus with that one.
  const returning = useRef(false);

  useEffect(() => {
    if (editing && !wasEditing.current) {
      const first = formRef.current?.querySelector<HTMLElement>(FIELDS) ?? doneRef.current;
      first?.focus();
    }
    if (!editing && wasEditing.current && returning.current) pencilRef.current?.focus();
    returning.current = false;
    wasEditing.current = editing;
  }, [editing]);

  function done() {
    returning.current = true;
    onDone();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!editing || event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    // A field saves on blur, so it is blurred before the row closes and nothing typed is lost.
    const active = document.activeElement;
    if (active instanceof HTMLElement && rowRef.current?.contains(active)) active.blur();
    done();
  }

  return { formRef, pencilRef, doneRef, rowRef, done, onKeyDown };
}
