// The overall score as a ring, banded on the original impact-ring thresholds (80/60/40)
// through the theme's semantic colors. Null renders an empty ring with a hyphen.
import { bandClass } from "./bandClass.ts";

export default function ScoreRing({
  score,
  size = 96,
  stroke = 8,
  label,
}: {
  score: number | null;
  size?: number;
  stroke?: number;
  label?: string;
}) {
  const radius = (size - stroke) / 2;
  const circumference = radius * 2 * Math.PI;
  const progress = score === null ? 0 : Math.min(Math.max(score, 0), 100);
  const offset = circumference - (progress / 100) * circumference;
  const color = bandClass(score);

  return (
    <div className="inline-flex flex-col items-center gap-1.5">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" aria-hidden>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            className="text-line"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className={`${color} transition-[stroke-dashoffset] duration-700`}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`tnum font-medium ${color}`} style={{ fontSize: Math.round(size * 0.28) }}>
            {score === null ? "-" : Math.round(score)}
          </span>
        </div>
      </div>
      {label ? <span className="text-[11px] font-medium uppercase tracking-label text-ink-3">{label}</span> : null}
    </div>
  );
}
