// The hub's type scale in one place, so a title is the same size on every screen. New code reads
// its sizes from here rather than choosing a pixel value inline. Weights and colors come from the
// theme tokens; nothing here names a tenant.
export const pageTitleClass = "font-display text-[30px] leading-tight tracking-display text-heading";
export const sectionTitleClass = "font-display text-[18px] leading-snug text-heading";
export const itemTitleClass = "text-[15px] font-medium leading-snug text-ink";
export const bodyClass = "text-[14px] leading-relaxed text-ink";
export const secondaryClass = "text-[13px] leading-relaxed text-ink-2";
export const metaClass = "text-[12.5px] leading-relaxed text-ink-3";
// The small uppercase eyebrow over a section or a field. forms.ts has its own labelClass (a block
// label for form controls), so this one is named apart.
export const eyebrowLabelClass = "text-[11px] font-medium uppercase tracking-label text-ink-3";
