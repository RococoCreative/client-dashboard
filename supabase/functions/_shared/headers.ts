// Response headers more than one edge function sends, so a rule like "never cache this" is written
// once. Every answer that may carry a person's or a company's data says not to keep it.
export const NO_STORE = { "Cache-Control": "no-store" } as const;
