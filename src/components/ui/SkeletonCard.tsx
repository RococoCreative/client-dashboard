// The loading stand-in for a stat or summary card: label, figure and caption lines in the
// card's own frame, so the page keeps its layout while data loads.
import Skeleton from "./Skeleton.tsx";

export default function SkeletonCard() {
  return (
    <div className="rounded-lg border border-line bg-surface p-5">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-4 h-6 w-2/3" />
      <Skeleton className="mt-2.5 h-3 w-1/2" />
    </div>
  );
}
