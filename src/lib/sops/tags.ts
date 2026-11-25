// SOP tags as the screen keeps them before saving: trimmed, no repeats in any case, at most 20
// of 40 characters each, the same rule the database holds (0053). Pure.
export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 40;

export function addTag(tags: string[], raw: string): string[] {
  const tag = raw.trim().slice(0, MAX_TAG_LENGTH);
  if (!tag || tags.length >= MAX_TAGS || tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return tags;
  return [...tags, tag];
}

// Every tag the company's SOPs use, once each, in alphabetical order.
export function tagsInUse(sops: Array<{ tags: string[] }>): string[] {
  const seen = new Map<string, string>();
  for (const sop of sops) for (const tag of sop.tags) if (!seen.has(tag.toLowerCase())) seen.set(tag.toLowerCase(), tag);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
