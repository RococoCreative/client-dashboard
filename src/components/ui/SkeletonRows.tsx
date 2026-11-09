// The loading stand-in for a list or table: a stack of row-height blocks announced once to
// screen readers as loading.
import Skeleton from "./Skeleton.tsx";

export default function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2.5" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}
