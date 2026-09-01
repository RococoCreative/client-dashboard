// The one button. Quiet, compact, 150ms color transitions, a single focus ring, and every
// color a theme token so the same component reads right on all four tenant palettes.
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-solid";
type Size = "sm" | "md";

const BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-md font-medium " +
  "transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 whitespace-nowrap";

const SIZES: Record<Size, string> = {
  sm: "px-2.5 py-1.5 text-[12.5px]",
  md: "px-3.5 py-2 text-[13px]",
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover",
  secondary: "border border-line bg-surface text-ink hover:border-line-strong hover:bg-surface-2",
  ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
  danger: "border border-line bg-surface text-danger hover:border-danger hover:bg-danger/5",
  // The one loud destructive treatment, reserved for the final confirm step.
  "danger-solid": "bg-danger text-bg hover:bg-danger/90",
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
  return (
    <button type={type} className={`${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}
