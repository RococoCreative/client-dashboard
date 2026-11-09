// The base loading placeholder: one pulsing block in the surface tone. SkeletonCard and
// SkeletonRows compose it into the page's real shape instead of a centered spinner.
export default function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-surface-2 ${className}`} aria-hidden />;
}
