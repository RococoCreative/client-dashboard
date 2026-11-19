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
// the field keeps the typed text, is outlined in the danger colour, and says "Not saved" in words
// under the field, so the failure does not depend on seeing a colour. The next blur tries again.
// A failed save never looks like a saved one. The words clear on the next landed save or when the
// stored value is back in the box. One live region carries every state: visible for a failure,
// visually hidden for saving and saved, and the field points at it while a failure stands.
//
// The field sits in a column wrapper, which makes it a block-level child with no baseline gap
// under it, so the words can sit under it and the wrapper adds no height at rest. The wrapper
// takes over the sizing classes a caller put on the field (flex-1, min-w-0, a width) and its
// margins so a field in a flex row or a table cell keeps the width it had, and the words add
// height only, never width.
import { useEffect, useId, useRef, useState } from "react";
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
  failed: "Not saved",
};

// The classes that decide how wide a field is or how it behaves as a flex or grid child. Plain
// widths, responsive widths and w-full are matched; fractions and percentages stay on the field
// alone, where they keep resolving against the wrapper.
const SIZING = /^(?:[a-z0-9]+:)*(?:flex-(?:1|auto|initial|none)|grow(?:-\d+)?|shrink(?:-\d+)?|basis-\S+|min-w-\S+|max-w-\S+|w-(?!\d+\/|\[\d+%\])\S+|self-\S+|col-span-\S+)$/;
// Margins move to the wrapper, so they stay outside the field and the wrapper adds nothing to them.
const MARGIN = /^(?:[a-z0-9]+:)*-?m[trblxyse]?-\S+$/;
function splitClasses(className: string | undefined) {
  const all = (className ?? "").split(/\s+/).filter(Boolean);
  return {
    wrapper: all.filter((c) => SIZING.test(c) || MARGIN.test(c)).join(" "),
    field: all.filter((c) => !MARGIN.test(c)).join(" "),
  };
}

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

  const noteId = useId();
  const split = splitClasses(className ?? (multiline ? textareaClass : inputClass));
  const classes = split.field + STATE_RING[state];
  const failed = state === "failed";
  const status = (
    <span
      id={noteId}
      aria-live="polite"
      className={failed ? "mt-1 block text-[12px] leading-snug text-danger" : "sr-only"}
    >
      {STATE_TEXT[state]}
    </span>
  );
  const invalid = failed ? true : undefined;
  const describedBy = failed ? noteId : undefined;
  const title = failed ? "Not saved" : undefined;
  const wrap = `flex flex-col${split.wrapper ? " " + split.wrapper : ""}`;
  // Typing the stored text back in leaves nothing pending, so a standing failure goes with it.
  const edit = (next: string) => {
    setDraft(next);
    if (failed && next === value) setState("idle");
  };

  if (multiline) {
    return (
      <span className={wrap}>
        <textarea
          id={id}
          aria-label={ariaLabel}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          title={title}
          data-save-state={state}
          value={draft}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => edit(e.target.value)}
          onBlur={commit}
          className={classes}
          rows={rows}
        />
        {status}
      </span>
    );
  }
  return (
    <span className={wrap}>
      <input
        id={id}
        aria-label={ariaLabel}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        title={title}
        data-save-state={state}
        type={type}
        inputMode={inputMode}
        value={draft}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => edit(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className={classes}
      />
      {status}
    </span>
  );
}
