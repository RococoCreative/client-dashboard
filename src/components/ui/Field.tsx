// Label + control + optional hint or error, so every form reads the same and every control
// has a real <label>. Pass the control as children with a matching id.
import type { ReactNode } from "react";
import { helpClass, labelClass } from "./forms.ts";

export default function Field({
  label,
  htmlFor,
  hint,
  error,
  className = "",
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className={labelClass}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 text-[12px] text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className={helpClass}>{hint}</p>
      ) : null}
    </div>
  );
}
