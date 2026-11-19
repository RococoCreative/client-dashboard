// Shared form control classes so every input, select, textarea, and label in the hub
// carries the same quiet look on every tenant theme (one place to tune density and focus). A
// field is 44px tall under a finger or at phone width (the tap variant), so a thumb can hit it.
export const labelClass = "block text-[11px] font-medium uppercase tracking-label text-ink-3";

// A field's and a select's look with no margin, padding or text size, so the regular and compact
// sizes below are each composed once and never edited out of one another.
const FIELD_LOOK =
  "w-full rounded-md border border-line bg-surface text-ink placeholder:text-ink-3/70 " +
  "transition-colors duration-150 hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-60";
const SELECT_LOOK =
  "w-full rounded-md border border-line bg-surface text-ink transition-colors duration-150 " +
  "hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-60 tap:min-h-11";

// The text field's look without its tap height, so a textarea keeps the taller minimum it sets
// for itself (the tap height would otherwise outrank it on a phone).
const fieldClass = `mt-1.5 ${FIELD_LOOK} px-3 py-2 text-sm`;

export const inputClass = `${fieldClass} tap:min-h-11`;

export const selectClass = `mt-1.5 ${SELECT_LOOK} px-2.5 py-2 text-sm`;

// The same controls one step smaller, for a dense row of them (a role's metric settings): no
// stacked-form top margin, shorter, and the secondary text size. Still 44px under a finger.
export const compactInputClass = `${FIELD_LOOK} px-3 py-1.5 text-[13px] tap:min-h-11`;
export const compactSelectClass = `${SELECT_LOOK} px-2.5 py-1.5 text-[13px]`;

export const textareaClass = `${fieldClass} min-h-[88px] leading-relaxed`;

export const checkboxClass = "h-4 w-4 shrink-0 rounded border-line-strong accent-accent";

// A label wrapped round a checkbox that has no visible label of its own (its name is an
// aria-label), so a thumb has 44px to hit. The 44px is real layout under a finger, never a box
// reaching past the label into the control beside it.
export const checkboxHitClass = "inline-flex shrink-0 cursor-pointer items-center justify-center tap:h-11 tap:w-11";

export const helpClass = "mt-1.5 text-[12.5px] leading-relaxed text-ink-3";

// Table classes: hairline rows, quiet uppercase headers, dense but readable.
export const tableClass = "w-full border-collapse text-sm";
export const thClass =
  "border-b border-line px-3 py-2 text-left text-[11px] font-medium uppercase tracking-label text-ink-3";
export const tdClass = "border-b border-line px-3 py-2.5 align-middle text-ink";
// For a row of a table that runs edge to edge in its card: the first and last cells take the card's
// own padding (16px on a phone, 24px from sm) rather than the 12px every cell has, so nothing sits
// closer than that to the card's edge. Put it on each row, the header row included.
export const edgeCellsClass = "[&>*:first-child]:pl-4 [&>*:last-child]:pr-4 sm:[&>*:first-child]:pl-6 sm:[&>*:last-child]:pr-6";
// The same for a table that is a table only from lg up and stacks into its own rows below that.
export const edgeCellsWideClass = "lg:[&>*:first-child]:pl-6 lg:[&>*:last-child]:pr-6";
