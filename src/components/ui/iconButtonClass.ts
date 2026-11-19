// The icon button's look and size in one place, shared by IconButton (an action) and IconLink (a
// place to go), so a pencil that is a link and a pencil that is a button can never drift apart.
// 36px with a mouse, 44px on a phone or under a finger (the tap variant in index.css). The small
// size draws a 24px pill for a control inside a badge and stretches only its hit area to 44px
// under a finger, so the badge keeps its height.
export const ICON_BUTTON_SIZES = {
  md: "h-9 w-9 rounded-md tap:h-11 tap:w-11",
  sm: "relative h-6 w-6 rounded-full tap:after:absolute tap:after:-inset-2.5",
} as const;

export type IconButtonSize = keyof typeof ICON_BUTTON_SIZES;

export function iconButtonClass(size: IconButtonSize = "md"): string {
  return `inline-flex ${ICON_BUTTON_SIZES[size]} shrink-0 items-center justify-center text-ink-2 transition-colors duration-150 hover:bg-surface-2 hover:text-ink disabled:pointer-events-none disabled:opacity-40`;
}
