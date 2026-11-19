// Square icon button for toolbars and row actions: quiet until hovered, always labeled for screen
// readers and tooltips via the required label. It owns its size (iconButtonClass.ts): 36px with a
// mouse, 44px on a phone or under a finger, so callers never paste a size on top. The small size
// is for a control that sits inside a pill (removing a domain from its badge), where a full button
// would double the pill's height with a mouse; under a finger it is 44px like the rest. It keeps
// the label, tooltip and disabled styling all the same.
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { iconButtonClass, type IconButtonSize } from "./iconButtonClass.ts";

export default function IconButton({
  label,
  children,
  size = "md",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
  size?: IconButtonSize;
}) {
  return (
    <button type="button" aria-label={label} title={label} className={`${iconButtonClass(size)} ${className}`} {...rest}>
      {children}
    </button>
  );
}
