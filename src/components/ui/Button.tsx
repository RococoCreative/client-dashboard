// The one button. Quiet, compact, 150ms color transitions, a single focus ring, and every
// color a theme token so the same component reads right on all four tenant palettes.
//
// Two text-only variants cover the controls that read as words rather than boxes, so no page
// invents its own: `link` is an action written as text in the accent ("Start review", "Use a
// different email"), and `row` is a row or a title that opens what it names (a file, a version,
// a resource), ink until hovered. Neither carries padding, a fill or a radius, so their size
// sets the type alone.
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-solid" | "link" | "row";
type Size = "sm" | "md";

const MOTION = "transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50";

const BOXED = "inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap";

const SIZES: Record<Size, string> = {
  sm: "px-2.5 py-1.5 text-[12.5px]",
  md: "px-3.5 py-2 text-[13px]",
};

const TEXT_SIZES: Record<"link" | "row", Record<Size, string>> = {
  link: { sm: "text-[12px]", md: "text-[13px]" },
  row: { sm: "text-[13px]", md: "text-sm" },
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover",
  secondary: "border border-line bg-surface text-ink hover:border-line-strong hover:bg-surface-2",
  ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
  danger: "border border-line bg-surface text-danger hover:border-danger hover:bg-danger/5",
  // The one loud destructive treatment, reserved for the final confirm step.
  "danger-solid": "bg-danger text-bg hover:bg-danger/90",
  link: "inline-flex items-center gap-1.5 text-accent hover:underline",
  // Full width and left aligned, free to wrap or truncate. aria-pressed marks the one on screen.
  row: "flex w-full min-w-0 items-center gap-2 text-left text-ink hover:text-accent aria-pressed:bg-surface-2/60",
};

export default function Button({
  variant = "primary",
  size = "md",
  children,
  className = "",
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: Size;
  children: ReactNode;
}) {
  const shape = variant === "link" || variant === "row" ? TEXT_SIZES[variant][size] : `${BOXED} ${SIZES[size]}`;
  return (
    <button type={type} className={`${shape} ${MOTION} ${VARIANTS[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}
