// SOP search, kept pure: what a person types becomes prefix terms for the database's full text
// search (sops.search, 0053), and a matched SOP's text is cut to a short line around the match.
// Only letters and digits ever reach the query, so no input can break it.

const MAX_TERMS = 8;

export function searchTerms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, MAX_TERMS);
}

// "ladder safe" reads as ladder:* & safe:*, every word required, each a prefix.
export function toPrefixQuery(text: string): string | null {
  const terms = searchTerms(text);
  return terms.length ? terms.map((t) => `${t}:*`).join(" & ") : null;
}

// A line of the SOP's text around the first word that starts with a search term, or null.
export function snippetFor(text: string | null | undefined, query: string, radius = 80): string | null {
  if (!text) return null;
  const terms = searchTerms(query);
  if (!terms.length) return null;
  const lower = text.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u");
    const match = re.exec(lower);
    if (match && (at === -1 || match.index < at)) at = match.index + match[1].length;
  }
  if (at === -1) return null;
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + radius);
  return `${start > 0 ? "..." : ""}${text.slice(start, end).trim()}${end < text.length ? "..." : ""}`;
}
