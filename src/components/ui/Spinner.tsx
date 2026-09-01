// Loading indicator for full-screen waits: an accent arc on a hairline track.
export default function Spinner({ size = 24, label }: { size?: number; label?: string }) {
  return (
    <span className="inline-flex items-center gap-3" role="status">
      <span
        className="inline-block animate-spin rounded-full border-2 border-line-strong border-t-accent"
        style={{ width: size, height: size }}
        aria-hidden
      />
      {label ? <span className="text-ink-2">{label}</span> : null}
      <span className="sr-only">Loading</span>
    </span>
  );
}
