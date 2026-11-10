// The honest placeholder for a module whose definition is still pending. It says what it is
// waiting on and never shows a number, so nobody reads a fake score as a real one.
import type { ReactNode } from "react";
import Badge from "../ui/Badge.tsx";
import EmptyState from "../ui/EmptyState.tsx";

export default function ScaffoldCard({ eyebrow, title, pending, children }: { eyebrow: string; title: string; pending: string[]; children?: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col">
      {/* The grid wrapper stretches the card to its row, so cards side by side end level. */}
      <div className="grid flex-1">
        <EmptyState
          eyebrow={eyebrow}
          title={title}
          body="Not configured yet."
          action={
            <div className="flex flex-col items-center gap-3">
              <Badge tone="neutral">Not configured</Badge>
              <div className="space-y-2">
                <p className="eyebrow">Waiting on</p>
                <ul className="mx-auto max-w-sm space-y-1 text-left text-[12.5px] text-ink-2">
                  {pending.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          }
        />
      </div>
      {children}
    </section>
  );
}
