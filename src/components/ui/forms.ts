// Shared form control classes so every input, select, textarea, and label in the hub
// carries the same quiet look on every tenant theme (one place to tune density and focus).
export const labelClass = "block text-[11px] font-medium uppercase tracking-label text-ink-3";

export const inputClass =
  "mt-1.5 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink " +
  "placeholder:text-ink-3/70 transition-colors duration-150 hover:border-line-strong " +
  "disabled:cursor-not-allowed disabled:opacity-60";

export const selectClass =
  "mt-1.5 w-full rounded-md border border-line bg-surface px-2.5 py-2 text-sm text-ink " +
  "transition-colors duration-150 hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-60";

export const textareaClass = `${inputClass} min-h-[88px] leading-relaxed`;

export const checkboxClass = "h-4 w-4 shrink-0 rounded border-line-strong accent-accent";

export const helpClass = "mt-1.5 text-[12px] leading-relaxed text-ink-3";

// Table classes: hairline rows, quiet uppercase headers, dense but readable.
export const tableClass = "w-full border-collapse text-sm";
export const thClass =
  "border-b border-line px-3 py-2 text-left text-[11px] font-medium uppercase tracking-label text-ink-3";
export const tdClass = "border-b border-line px-3 py-2.5 align-middle text-ink";
