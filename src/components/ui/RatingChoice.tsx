// The four-step rating a deliverable task carries: Miss, Partial, Hit, Exceeded. A row of
// buttons rather than a select, because in the meeting this gets set at a glance and a select
// costs two clicks. Clicking the step already chosen clears it back to unrated, the same way
// RatingInput behaves. Read-only when onChange is omitted.
import { DELIVERABLE_RATINGS, RATING_LABELS, isDeliverableRating, type DeliverableRating } from "../../lib/gsr/deliverables.ts";

const TONE: Record<DeliverableRating, string> = {
  0: "border-danger bg-danger text-on-accent",
  1: "border-warning bg-warning text-on-accent",
  2: "border-success bg-success text-on-accent",
  3: "border-accent bg-accent text-on-accent",
};

export default function RatingChoice({
  value,
  onChange,
  label,
  disabled = false,
}: {
  value: number | null;
  onChange?: (next: DeliverableRating | null) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-1"
      role={onChange ? "radiogroup" : "img"}
      aria-label={onChange ? label : `${label}: ${isDeliverableRating(value) ? RATING_LABELS[value] : "Not rated"}`}
    >
      {DELIVERABLE_RATINGS.map((step) => {
        const chosen = value === step;
        const base = "rounded-full border px-2 py-0.5 text-[11px] transition-colors duration-150";
        const look = chosen ? TONE[step] : "border-line-strong bg-surface text-ink-3";
        if (!onChange) {
          // Read-only: the chips are decoration and the group carries the answer in one line
          // below, so an unrated task says "Not rated" rather than announcing nothing at all.
          return (
            <span key={step} className={`${base} ${look}`} aria-hidden>
              {RATING_LABELS[step]}
            </span>
          );
        }
        return (
          <button
            key={step}
            type="button"
            role="radio"
            aria-checked={chosen}
            aria-label={`${RATING_LABELS[step]} (${step})`}
            disabled={disabled}
            onClick={() => onChange(chosen ? null : step)}
            className={`${base} ${look} hover:border-accent disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {RATING_LABELS[step]}
          </button>
        );
      })}
    </div>
  );
}
