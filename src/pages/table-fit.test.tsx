// A guard over the source for the 2026-11-25 responsiveness QA. A table cell has no width of its
// own, so `truncate` (one line, cut with an ellipsis) never cuts anything inside one: the longest
// name or title sets the whole column, the table grows past its card, and the controls at the end
// of each row slide out of view (a cycle's Omit, the roster's actions). Text in a table either wraps
// (cellTextClass) or truncates inside an explicit width cap (a max-w class, or a named *FitClass
// that holds one, as the GSR log's does).
import { describe, expect, it } from "vitest";

describe("table text fits its column", () => {
  const sources = import.meta.glob<string>(["../**/*.tsx", "!../**/*.test.tsx"], { query: "?raw", import: "default", eager: true });

  it("never truncates text in a table without a width cap", () => {
    const offenders: string[] = [];
    for (const [file, text] of Object.entries(sources)) {
      // Only the markup inside each table: a list beside one truncates within its own width.
      const tables = [...text.matchAll(/<table\b[\s\S]*?<\/table>/g)].map((m) => m[0]).join("\n");
      if (!tables) continue;
      // Every className value: a quoted string or a template literal.
      for (const match of tables.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        const value = match[1] ?? match[2] ?? "";
        if (!/(^|\s)truncate(\s|$)/.test(value)) continue;
        if (/max-w-|FitClass/.test(value)) continue;
        offenders.push(`${file}: ${value.slice(0, 90)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
