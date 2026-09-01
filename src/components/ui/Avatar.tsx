// Initials disc for people lists and headers.
import { initials } from "../../lib/format.ts";

export default function Avatar({
  person,
  size = 32,
}: {
  person: { full_name: string | null; email: string };
  size?: number;
}) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-accent/15 font-medium text-accent"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      aria-hidden
    >
      {initials(person)}
    </span>
  );
}
