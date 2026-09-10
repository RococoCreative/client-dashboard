// Progress for one goal: a range slider from 0 to 100 in steps of five with the number beside
// it, where 100 reads as complete. Keeps a draft while the thumb moves and commits when it is
// released (pointer, key, or focus leaving), so a save never fights the drag.
import { useState } from "react";
import { Check } from "lucide-react";

export default function ProgressSlider({
  value,
  onCommit,
  disabled = false,
  label,
  className = "",
}: {
  value: number;
  onCommit: (next: number) => void;
  disabled?: boolean;
  label: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  const complete = draft >= 100;
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={draft}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={complete ? "Complete" : `${draft}%`}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={commit}
        onMouseUp={commit}
        onTouchEnd={commit}
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
  );
}
