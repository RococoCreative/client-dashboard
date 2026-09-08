// Overlay dialog primitive: Escape and backdrop-click close, initial focus moves into the
// panel and returns to the opener on unmount. Surface, hairline border, one soft shadow.
import { useEffect, useRef, type ReactNode } from "react";

// Open-modal stack so Escape only closes the topmost dialog when modals stack.
const modalStack: symbol[] = [];

export default function Modal({
  onClose,
  labelledBy,
  size = "md",
  children,
}: {
  onClose: () => void;
  labelledBy?: string;
  size?: "md" | "lg" | "xl";
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Callers pass inline onClose closures, so the mount effect must NOT key on it: re-running
  // per parent render would steal focus back to the panel mid-typing.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const id = Symbol("modal");
    modalStack.push(id);
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && modalStack[modalStack.length - 1] === id) onCloseRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      modalStack.splice(modalStack.indexOf(id), 1);
      window.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, []);

  const width = size === "xl" ? "max-w-4xl" : size === "lg" ? "max-w-2xl" : "max-w-md";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`max-h-[90vh] w-full ${width} overflow-y-auto rounded-lg border border-line bg-surface shadow-md outline-none`}
      >
        {children}
      </div>
    </div>
  );
}
