// The hub's type scale in one place, so a title is the same size on every screen. New code reads
// its sizes from here rather than choosing a pixel value inline. Weights and colors come from the
// theme tokens; nothing here names a tenant.
export const pageTitleClass = "font-display text-[30px] leading-tight tracking-display text-heading";
export const sectionTitleClass = "font-display text-[18px] leading-snug text-heading";
// The item title, secondary and meta sizes come with no colour as well, for a line that brings its
// own (a muted title, a done task, an error in text-danger): the colour is added, never edited in.
export const itemTitleSizeClass = "text-[15px] font-medium leading-snug";
export const itemTitleClass = `${itemTitleSizeClass} text-ink`;
export const bodyClass = "text-[14px] leading-relaxed text-ink";
export const secondarySizeClass = "text-[13px] leading-relaxed";
export const secondaryClass = `${secondarySizeClass} text-ink-2`;
export const metaSizeClass = "text-[12.5px] leading-relaxed";
export const metaClass = `${metaSizeClass} text-ink-3`;
// The small uppercase eyebrow over a section or a field. forms.ts has its own labelClass (a block
// label for form controls), so this one is named apart.
export const eyebrowLabelClass = "text-[11px] font-medium uppercase tracking-label text-ink-3";
