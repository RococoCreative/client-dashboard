// Square icon button for toolbars and row actions: 32px hit target, quiet until hovered,
// always labeled for screen readers and tooltips via the required label. The small size is for
// a control that sits inside a pill (removing a domain from its badge), where 32px would
// double the pill's height; it keeps the label, tooltip and disabled styling all the same.
import type { ButtonHTMLAttributes, ReactNode } from "react";

const SIZES = {
  md: "h-8 w-8 rounded-md",
  sm: "h-6 w-6 rounded-full",
} as const;

export default function IconButton({
  label,
  children,
  size = "md",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
  size?: keyof typeof SIZES;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex ${SIZES[size]} shrink-0 items-center justify-center text-ink-2 transition-colors duration-150 hover:bg-surface-2 hover:text-ink disabled:pointer-events-none disabled:opacity-40 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
