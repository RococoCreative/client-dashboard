// The icon button's look and size in one place, shared by IconButton (an action) and IconLink (a
// place to go), so a pencil that is a link and a pencil that is a button can never drift apart.
// 36px with a mouse, 44px on a phone or under a finger (the tap variant in index.css). The small
// size is a 24px disc for a control inside a badge with a mouse; under a finger it is a real 44px
// box, never an invisible area reaching past it into a neighbour.
export const ICON_BUTTON_SIZES = {
  md: "h-9 w-9 rounded-md tap:h-11 tap:w-11",
  sm: "h-6 w-6 rounded-full tap:h-11 tap:w-11",
} as const;

export type IconButtonSize = keyof typeof ICON_BUTTON_SIZES;

export function iconButtonClass(size: IconButtonSize = "md"): string {
  return `inline-flex ${ICON_BUTTON_SIZES[size]} shrink-0 items-center justify-center text-ink-2 transition-colors duration-150 hover:bg-surface-2 hover:text-ink disabled:pointer-events-none disabled:opacity-40`;
}
