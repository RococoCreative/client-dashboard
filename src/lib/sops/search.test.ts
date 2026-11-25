// Pins how typed search becomes a database query (prefix terms, and nothing a user types can break
// it) and how a matched SOP's line is cut for the library list.
import { describe, expect, it } from "vitest";
import { searchTerms, snippetFor, toPrefixQuery } from "./search.ts";

describe("toPrefixQuery", () => {
  it("makes every word a prefix and requires all of them", () => {
    expect(toPrefixQuery("ladder safe")).toBe("ladder:* & safe:*");
  });
  it("keeps only letters and digits, so quotes and operators never reach the query", () => {
    expect(toPrefixQuery(`O'Brien's "ladder" & | ! ( ) :*`)).toBe("o:* & brien:* & s:* & ladder:*");
  });
  it("keeps accented letters and numbers", () => {
    expect(toPrefixQuery("Café 24V")).toBe("café:* & 24v:*");
  });
  it("reads blank or punctuation-only input as no query", () => {
    expect(toPrefixQuery("   ")).toBeNull();
    expect(toPrefixQuery("&&!")).toBeNull();
  });
  it("caps a long search at eight words", () => {
    expect(toPrefixQuery("a b c d e f g h i j")?.split(" & ")).toHaveLength(8);
  });
});

describe("searchTerms", () => {
  it("lowercases and splits on anything that is not a letter or digit", () => {
    expect(searchTerms("Fall-Arrest  KIT")).toEqual(["fall", "arrest", "kit"]);
  });
});

describe("snippetFor", () => {
  const text = "Purpose Every crew walks the site before starting. Steps Inspect the ladder feet and the rungs before any climb. Checks Photo log.";
  it("cuts a window around the first word that matches, marked as cut", () => {
    const snippet = snippetFor(text, "rung", 20);
    expect(snippet).toContain("rungs");
    expect(snippet?.startsWith("...")).toBe(true);
    expect(snippet?.endsWith("...")).toBe(true);
  });
  it("finds a word typed in another case", () => {
    expect(snippetFor(text, "LADDER", 20)).toContain("ladder");
  });
  it("is null when nothing in the text matches", () => {
    expect(snippetFor(text, "forklift")).toBeNull();
    expect(snippetFor(null, "ladder")).toBeNull();
  });
});
