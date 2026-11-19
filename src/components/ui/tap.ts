// The 44px tap target for a standalone link a person taps (a section's "All wins", a row's "Open"),
// whose drawn size is set by its text. Under a finger or at phone width (the tap variant in
// index.css) it grows to 44px tall around its text. A link inside a sentence does not take it.
export const tapTargetClass = "tap:inline-flex tap:min-h-11 tap:min-w-11 tap:items-center";

// A link that stands for its whole row (a title with its meta line under it): under a finger or at
// phone width its ::after box covers the nearest positioned ancestor, so the row is the target.
// The caller marks that ancestor `relative` and keeps any other control out of it.
export const tapStretchClass = "tap:after:absolute tap:after:inset-0";
