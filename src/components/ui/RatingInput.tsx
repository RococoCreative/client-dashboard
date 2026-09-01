// A 1..N rating as a row of buttons (stars in the original tool; here plain discs so it
// reads the same on every tenant). Read-only when onChange is omitted.
export default function RatingInput({
  value,
  max = 5,
  onChange,
  label,
}: {
  value: number | null;
  max?: number;
  onChange?: (next: number | null) => void;
  label: string;
}) {
  const steps = Array.from({ length: max }, (_, i) => i + 1);
  return (
    <div className="flex items-center gap-1" role={onChange ? "radiogroup" : undefined} aria-label={label}>
      {steps.map((step) => {
        const filled = value !== null && step <= value;
        const base = "h-6 w-6 rounded-full border text-[11px] tnum transition-colors duration-150";
        const look = filled ? "border-accent bg-accent text-on-accent" : "border-line-strong bg-surface text-ink-3";
        if (!onChange) {
          return <span key={step} className={`inline-flex items-center justify-center ${base} ${look}`} aria-hidden>{step}</span>;
        }
        return (
          <button
            key={step}
            type="button"
            role="radio"
            aria-checked={value === step}
            aria-label={`${step} of ${max}`}
            onClick={() => onChange(value === step ? null : step)}
            className={`${base} ${look} hover:border-accent`}
          >
            {step}
          </button>
        );
      })}
      <span className="tnum ml-2 text-[12px] text-ink-2">{value === null ? "Not rated" : `${value}/${max}`}</span>
    </div>
  );
}
