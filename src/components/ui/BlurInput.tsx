// A text control that keeps its own draft and saves on blur, so typing never round-trips to
// the database and a slow connection never fights the cursor. Adopts a new server value when
// the prop changes without clobbering in-progress typing.
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
}) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }
  const commit = () => {
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
