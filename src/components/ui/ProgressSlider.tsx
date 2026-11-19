// Progress for one goal: a range slider from 0 to 100 in steps of five with the number beside
// it, where 100 reads as complete. Keeps a draft while the thumb moves and commits when it is
// released (pointer, key, or focus leaving), so a save never fights the drag.
//
// onCommit may return the save's promise. When the save fails (the promise rejects or resolves
// false, or onCommit returns false) the thumb goes back to the stored value, so the slider never
// shows a completion the database did not take, and "Not saved" is said in words under the
// slider, the same words and style a BlurInput uses, and announced through the same live region.
// A caller that returns nothing keeps the old behaviour: the slider waits for the value prop.
import { useEffect, useId, useRef, useState } from "react";
import { Check } from "lucide-react";

export type CommitResult = void | boolean | Promise<void | boolean>;

export default function ProgressSlider({
  value,
  onCommit,
  disabled = false,
  label,
  className = "",
}: {
  value: number;
  onCommit: (next: number) => CommitResult;
  disabled?: boolean;
  label: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  const [failed, setFailed] = useState(false);
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
    if (failed) setFailed(false);
  }
  // The stored value as of now, for a rollback that lands after the prop has moved on.
  const stored = useRef(value);
  useEffect(() => {
    stored.current = value;
  }, [value]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // Only the latest commit may roll the thumb back, so a slow first save that fails after a
  // second drag never yanks the thumb away from where the person has since put it.
  const attempt = useRef(0);
  // The number already sent, so that releasing the thumb and then clicking away does not write
  // it a second time before the value prop catches up. Moving the thumb again is a new
  // intention, so it clears.
  const sent = useRef<number | null>(null);
  const rollBack = (mine: number) => {
    if (!mounted.current || attempt.current !== mine) return;
    sent.current = null;
    setDraft(stored.current);
    setFailed(true);
  };
  const commit = () => {
    if (draft === value || draft === sent.current) return;
    sent.current = draft;
    setFailed(false);
    const mine = ++attempt.current;
    const result = onCommit(draft);
    if (result === false) return rollBack(mine);
    if (!(result instanceof Promise)) return;
    result.then(
      (ok) => {
        if (ok === false) rollBack(mine);
      },
      () => rollBack(mine),
    );
  };
  const complete = draft >= 100;
  const noteId = useId();
  return (
    <div className={className}>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={draft}
          disabled={disabled}
          aria-label={label}
          aria-valuetext={complete ? "Complete" : `${draft}%`}
          aria-invalid={failed ? true : undefined}
          aria-describedby={failed ? noteId : undefined}
          title={failed ? "Not saved" : undefined}
          data-save-state={failed ? "failed" : undefined}
          onChange={(e) => {
            sent.current = null;
            const next = Number(e.target.value);
            setDraft(next);
            // Back on the stored value means nothing is pending, so a standing failure goes.
            if (failed && next === value) setFailed(false);
          }}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
          className="h-1.5 min-w-0 flex-1 cursor-pointer accent-accent disabled:cursor-not-allowed disabled:opacity-60"
        />
        <span className={`tnum w-20 shrink-0 text-right text-[12px] font-medium ${complete ? "text-success" : "text-ink-2"}`}>
          {complete ? (
            <span className="inline-flex items-center gap-1">
              <Check size={12} aria-hidden /> Complete
            </span>
          ) : (
            `${draft}%`
          )}
        </span>
      </div>
      <span id={noteId} aria-live="polite" className={failed ? "mt-1 block text-[12px] leading-snug text-danger" : "sr-only"}>
        {failed ? "Not saved" : ""}
      </span>
    </div>
  );
}
