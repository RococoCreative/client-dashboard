// Compares two versions of an SOP line by line (one line per block, from docToLines), for the
// version history's "Compare with current". A longest common subsequence keeps the shared lines in
// order; the rest read as removed (only in the older) or added (only in the newer). Pure.

export type DiffLine = { kind: "same" | "added" | "removed"; text: string };

// SOPs run to a few hundred lines; past this the table would be large, so the comparison falls
// back to showing the older version removed and the newer added.
const MAX_CELLS = 4_000_000;

export function diffLines(older: string[], newer: string[]): DiffLine[] {
  const n = older.length;
  const m = newer.length;
  if (n * m > MAX_CELLS) {
    return [...older.map((text) => ({ kind: "removed" as const, text })), ...newer.map((text) => ({ kind: "added" as const, text }))];
  }
  // lengths[i][j]: the longest shared run of older[i..] and newer[j..].
  const lengths: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lengths[i][j] = older[i] === newer[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (older[i] === newer[j]) {
      out.push({ kind: "same", text: older[i] });
      i++;
      j++;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      out.push({ kind: "removed", text: older[i++] });
    } else {
      out.push({ kind: "added", text: newer[j++] });
    }
  }
  while (i < n) out.push({ kind: "removed", text: older[i++] });
  while (j < m) out.push({ kind: "added", text: newer[j++] });
  return out;
}
