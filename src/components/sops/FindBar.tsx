// Find in this SOP: a search box with the match count and previous and next. Enter steps forward,
// Shift and Enter back, Escape clears.
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import IconButton from "../ui/IconButton.tsx";
import { compactInputClass } from "../ui/forms.ts";
import { metaClass } from "../ui/type.ts";

export default function FindBar({ query, count, current, onQuery, onStep }: { query: string; count: number; current: number; onQuery: (q: string) => void; onStep: (delta: number) => void }) {
  const searching = query.trim().length > 0;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-line pb-3">
      <div className="relative min-w-[200px] max-w-xs flex-1">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
        <input
          type="search"
          aria-label="Find in this SOP"
          placeholder="Find in this SOP"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onStep(e.shiftKey ? -1 : 1);
            } else if (e.key === "Escape") {
              onQuery("");
            }
          }}
          className={`${compactInputClass} pl-8`}
        />
      </div>
      {searching ? (
        <>
          <span className={`tnum ${metaClass}`} aria-live="polite">{count ? `${current + 1} of ${count}` : "No matches"}</span>
          <IconButton label="Previous match" disabled={!count} onClick={() => onStep(-1)}><ChevronUp size={15} aria-hidden /></IconButton>
          <IconButton label="Next match" disabled={!count} onClick={() => onStep(1)}><ChevronDown size={15} aria-hidden /></IconButton>
        </>
      ) : null}
    </div>
  );
}
