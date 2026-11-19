// A text control that keeps its own draft and saves on blur, so typing never round-trips to
// the database and a slow connection never fights the cursor. Adopts a new server value when
// the prop changes without clobbering in-progress typing.
//
// `required` is for a field that cannot be emptied, like a name. Without it the caller has to
// decline the empty draft itself, and because declining leaves the value prop untouched the
// box then sits there blank for the rest of the session while the database still holds the old
// text. Here an empty draft simply restores what is stored, and onSave is never called.
//
// A field with a rule of its own (a weight from 0 to 100) declines a draft by returning false
// from onSave, for the same reason: the box goes back to the stored value instead of showing a
// number the database never took. The caller says why.
//
// A save that goes to the database returns its promise. While it runs the field reads as saving;
// when it lands the field flashes saved; when it fails (the promise rejects or resolves false)
// the field keeps the typed text, is marked "Not saved" in the danger colour, and the next blur
// tries again. A failed save never looks like a saved one. The state is announced to screen
// readers through a visually hidden live region that sits outside the layout.
import { useEffect, useRef, useState } from "react";
import { inputClass, textareaClass } from "./forms.ts";

export type SaveState = "idle" | "saving" | "saved" | "failed";

// What a caller's onSave may return: nothing (fire and forget, no status), false (declined),
// or a promise of either, where false or a rejection means the save did not land.
export type SaveResult = void | boolean | Promise<void | boolean>;

const STATE_RING: Record<SaveState, string> = {
  idle: "",
  saving: " opacity-80",
  saved: " ring-1 ring-success/60",
  failed: " ring-1 ring-danger",
};

const STATE_TEXT: Record<SaveState, string> = {
  idle: "",
  saving: "Saving",
  saved: "Saved",
  failed: "Not saved. Edit the field or leave it again to retry.",
};

// How long the saved mark stays before the field goes quiet again.
const SAVED_MS = 1500;

export default function BlurInput({
  id,
  value,
  onSave,
  disabled,
  multiline = false,
  placeholder,
  className,
  type = "text",
  inputMode,
  rows = 3,
  ariaLabel,
  required = false,
}: {
  id?: string;
  value: string;
  onSave: (next: string) => SaveResult | false;
  disabled?: boolean;
  multiline?: boolean;
  placeholder?: string;
  className?: string;
  type?: string;
  inputMode?: "numeric" | "decimal" | "text";
  rows?: number;
  ariaLabel?: string;
  required?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  const [state, setState] = useState<SaveState>("idle");
  // Only the latest save may settle the status, so a slow first save that fails after a
  // quicker second one succeeded never marks the field as failed.
  const attempt = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (state !== "saved") return;
    const timer = setTimeout(() => {
      if (mounted.current) setState("idle");
    }, SAVED_MS);
    return () => clearTimeout(timer);
  }, [state]);

  if (value !== seen) {
    setSeen(value);
    setDraft(value);
    if (state === "failed") setState("idle");
  }

  const commit = () => {
    if (required && draft.trim() === "") {
      setDraft(value);
      if (state === "failed") setState("idle");
      return;
    }
    if (draft === value) {
      if (state === "failed") setState("idle");
      return;
    }
    const result = onSave(draft);
    if (result === false) {
      setDraft(value);
      return;
    }
    if (!(result instanceof Promise)) return;
    const mine = ++attempt.current;
    setState("saving");
    result.then(
      (ok) => {
        if (!mounted.current || attempt.current !== mine) return;
        setState(ok === false ? "failed" : "saved");
      },
      () => {
        if (!mounted.current || attempt.current !== mine) return;
        setState("failed");
      },
    );
  };

  const classes = (className ?? (multiline ? textareaClass : inputClass)) + STATE_RING[state];
  const status = (
    <span aria-live="polite" className="sr-only">
      {STATE_TEXT[state]}
    </span>
  );
  const invalid = state === "failed" ? true : undefined;
  const title = state === "failed" ? "Not saved" : undefined;

  if (multiline) {
    return (
      <>
        <textarea
          id={id}
          aria-label={ariaLabel}
          aria-invalid={invalid}
          title={title}
          data-save-state={state}
          value={draft}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          className={classes}
          rows={rows}
        />
        {status}
      </>
    );
  }
  return (
    <>
      <input
        id={id}
        aria-label={ariaLabel}
        aria-invalid={invalid}
        title={title}
        data-save-state={state}
        type={type}
        inputMode={inputMode}
        value={draft}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className={classes}
      />
      {status}
    </>
  );
}
