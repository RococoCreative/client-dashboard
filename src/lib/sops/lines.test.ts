// Pins how loose lines of text (from a PDF, or a plain text file) are rebuilt into an SOP: larger
// type reads as a heading, bullets and numbers as lists, close lines join into one paragraph, a
// wider gap starts a new one, and running headers, footers and page numbers are dropped.
import { describe, expect, it } from "vitest";
import { linesToHtml, type TextLine } from "./lines.ts";

const line = (text: string, extra: Partial<TextLine> = {}): TextLine => ({ text, size: 10, gapBefore: 12, page: 1, ...extra });

describe("linesToHtml", () => {
  it("reads larger type as a heading", () => {
    const html = linesToHtml([line("Purpose", { size: 16, gapBefore: null }), line("Why this exists.")], 1);
    expect(html).toBe("<h1>Purpose</h1><p>Why this exists.</p>");
  });

  it("grades headings by size against the body text", () => {
    const html = linesToHtml([line("Big", { size: 18 }), line("Medium", { size: 13.5 }), line("Small", { size: 12 }), line("Body text here.")], 1);
    expect(html).toBe("<h1>Big</h1><h2>Medium</h2><h3>Small</h3><p>Body text here.</p>");
  });

  it("makes bullets a bulleted list and numbers a numbered one", () => {
    const html = linesToHtml([line("• Hard hat"), line("- Gloves"), line("1. Walk the site"), line("2) Sign the sheet")], 1);
    expect(html).toBe("<ul><li><p>Hard hat</p></li><li><p>Gloves</p></li></ul><ol><li><p>Walk the site</p></li><li><p>Sign the sheet</p></li></ol>");
  });

  it("joins close lines into one paragraph and splits on a wider gap", () => {
    const html = linesToHtml([line("Every crew walks", { gapBefore: null }), line("the site first."), line("New paragraph.", { gapBefore: 30 })], 1);
    expect(html).toBe("<p>Every crew walks the site first.</p><p>New paragraph.</p>");
  });

  it("carries a wrapped list line on with its item", () => {
    const html = linesToHtml([line("1. Inspect the ladder feet"), line("and the rungs.")], 1);
    expect(html).toBe("<ol><li><p>Inspect the ladder feet and the rungs.</p></li></ol>");
  });

  it("drops page numbers and a line repeated on most pages", () => {
    const lines = [1, 2, 3].flatMap((page) => [
      line("Acme Field Manual", { page, gapBefore: null }),
      line(`Step on page ${page}.`, { page }),
      line(`Page ${page} of 3`, { page }),
    ]);
    expect(linesToHtml(lines, 3)).toBe("<p>Step on page 1.</p><p>Step on page 2.</p><p>Step on page 3.</p>");
  });

  it("escapes what it reads", () => {
    expect(linesToHtml([line("Use <b> & \"quotes\"")], 1)).toBe("<p>Use &lt;b&gt; &amp; &quot;quotes&quot;</p>");
  });

  it("reads nothing as nothing", () => {
    expect(linesToHtml([], 0)).toBe("");
  });
});
