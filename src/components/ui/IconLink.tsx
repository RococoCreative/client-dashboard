// An icon button that goes somewhere (a pencil that opens an edit page, a back arrow): a router
// link with the icon button's exact look and size, labeled for screen readers and tooltips the
// same way, so no page dresses a link as an icon button by hand.
import type { ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";
import { iconButtonClass } from "./iconButtonClass.ts";

export default function IconLink({
  label,
  children,
  className = "",
  ...rest
}: Omit<LinkProps, "children" | "title" | "aria-label"> & { label: string; children: ReactNode }) {
  return (
    <Link aria-label={label} title={label} className={`${iconButtonClass()} ${className}`} {...rest}>
      {children}
    </Link>
  );
}
