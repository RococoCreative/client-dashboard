// The full-screen card every pre-app screen shares: setup notice, sign-in, onboarding,
// holding screens. One max width, one surface, one shadow.
import type { ReactNode } from "react";

export default function CenteredCard({ children, footer, wide = false }: { children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6">
      <div className={`w-full ${wide ? "max-w-lg" : "max-w-sm"}`}>
        <div className="rounded-lg border border-line bg-surface p-8 shadow-sm">{children}</div>
        {footer ? <div className="mt-4 text-center">{footer}</div> : null}
      </div>
    </div>
  );
}
