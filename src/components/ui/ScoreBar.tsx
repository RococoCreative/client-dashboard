// A single pillar or deliverable as a bar: label left, figure right, fill banded by
// achievement.
import { bandBgClass } from "./bandClass.ts";
import { formatNumber } from "../../lib/format.ts";

export default function ScoreBar({
  label,
  percent,
  detail,
}: {
  label: string;
  // 0..100 or null when not yet scored.
  percent: number | null;
  detail?: string;
}) {
  const fill = percent === null ? 0 : Math.min(Math.max(percent, 0), 100);
  const tone = bandBgClass(percent === null ? null : fill);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-ink">{label}</span>
        <span className="tnum text-[12px] text-ink-2">
          {detail ?? (percent === null ? "Not scored" : `${formatNumber(Math.round(fill))}%`)}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full rounded-full transition-[width] duration-500 ${tone}`} style={{ width: `${fill}%` }} />
      </div>
    </div>
  );
}
