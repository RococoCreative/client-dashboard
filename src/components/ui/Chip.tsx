// The filter pill: one of a row of choices above a list (All, Monthly, a category, a tag), or a
// tag on a card that filters by itself. One primitive so the pill reads the same on every page
// and a density or focus change lands everywhere at once. aria-pressed says which one is on.
// Under a finger or at phone width the pill keeps its drawn height, a little taller, and an
// invisible margin around it (the ::after box) makes the part a thumb can hit 44px tall.
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Size = "sm" | "md";

const SIZES: Record<Size, string> = {
  md: "px-3 py-1 text-[12px] tap:min-h-7 tap:after:-inset-y-2",
  sm: "px-2 py-0.5 text-[11px] tap:min-h-6 tap:after:-inset-y-2.5",
};

const HIT = "relative tap:min-w-11 tap:after:absolute tap:after:inset-x-0";

export default function Chip({
  active = false,
  size = "md",
  children,
  className = "",
  type = "button",
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-pressed"> & {
  active?: boolean;
  size?: Size;
  children: ReactNode;
}) {
  return (
    <button
      type={type}
      aria-pressed={active}
      className={`${HIT} rounded-full border transition-colors duration-150 ${SIZES[size]} ${active ? "border-accent bg-accent/10 text-accent" : "border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink"} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
