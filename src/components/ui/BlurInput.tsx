// A text control that keeps its own draft and saves on blur, so typing never round-trips to
// the database and a slow connection never fights the cursor. Adopts a new server value when
// the prop changes without clobbering in-progress typing.
//
// `required` is for a field that cannot be emptied, like a name. Without it the caller has to
// decline the empty draft itself, and because declining leaves the value prop untouched the
// box then sits there blank for the rest of the session while the database still holds the old
// text. Here an empty draft simply restores what is stored, and onSave is never called.
import { useState } from "react";
import { inputClass, textareaClass } from "./forms.ts";

export default function BlurInput({
  id,
  value,
  onSave,
  disabled,
  multiline = false,
  placeholder,
  className,
  type = "text",
  rows = 3,
  ariaLabel,
  required = false,
}: {
  id?: string;
  value: string;
  onSave: (next: string) => void;
  disabled?: boolean;
  multiline?: boolean;
  placeholder?: string;
  className?: string;
  type?: string;
  rows?: number;
  ariaLabel?: string;
  required?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }
  const commit = () => {
    if (required && draft.trim() === "") {
      setDraft(value);
      return;
    }
    if (draft !== value) onSave(draft);
  };
  if (multiline) {
    return (
      <textarea
        id={id}
        aria-label={ariaLabel}
        value={draft}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        className={className ?? textareaClass}
        rows={rows}
      />
    );
  }
  return (
    <input
      id={id}
      aria-label={ariaLabel}
      type={type}
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className={className ?? inputClass}
    />
  );
}
