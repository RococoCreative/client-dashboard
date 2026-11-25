// Pins the SOP document helpers: which links are allowed, how outside HTML enters the editor's
// schema (and what it may never bring with it), how Markdown from older versions converts, and
// the plain lines a version reads as when two are compared.
import { describe, expect, it } from "vitest";
import { docToLines, emptyDoc, htmlToDoc, markdownToHtml } from "./doc.ts";
import { isSafeHref } from "./schema.ts";

describe("isSafeHref", () => {
  it("allows web, mail and phone links", () => {
    expect(isSafeHref("https://example.com/a")).toBe(true);
    expect(isSafeHref("http://example.com")).toBe(true);
    expect(isSafeHref("mailto:office@example.com")).toBe(true);
    expect(isSafeHref("tel:+15555550100")).toBe(true);
  });
  it("refuses script, data and relative links", () => {
    expect(isSafeHref("javascript:alert(1)")).toBe(false);
    expect(isSafeHref(" JavaScript:alert(1)")).toBe(false);
    expect(isSafeHref("data:text/html,<b>x</b>")).toBe(false);
    expect(isSafeHref("/settings")).toBe(false);
    expect(isSafeHref("")).toBe(false);
  });
});

describe("htmlToDoc", () => {
  it("keeps headings and lists and drops what the schema does not know", () => {
    const doc = htmlToDoc('<h2>Purpose</h2><ul><li>One</li></ul><script>alert(1)</script><img src="x">');
    const types = (doc.content ?? []).map((n) => n.type);
    expect(types).toEqual(["heading", "bulletList"]);
    expect(JSON.stringify(doc)).not.toContain("alert");
  });
  it("drops a link to a script", () => {
    const doc = htmlToDoc('<p><a href="javascript:alert(1)">Click</a> and <a href="https://example.com">site</a></p>');
    const json = JSON.stringify(doc);
    expect(json).not.toContain("javascript:");
    expect(json).toContain("https://example.com");
  });
  it("keeps a table", () => {
    const doc = htmlToDoc("<table><tr><th>Tool</th><th>Check</th></tr><tr><td>Ladder</td><td>Feet</td></tr></table>");
    expect(doc.content?.[0]?.type).toBe("table");
  });
});

describe("markdownToHtml", () => {
  it("turns Markdown into headings and numbered lists", () => {
    const html = markdownToHtml("## Steps\n\n1. First\n2. Second");
    expect(html).toContain("<h2>Steps</h2>");
    expect(html).toContain("<ol>");
  });
  it("keeps a picture as a link to it, named for the picture", () => {
    expect(markdownToHtml("![Ladder angle](https://example.com/angle.png)")).toContain('<a href="https://example.com/angle.png">Ladder angle</a>');
    expect(markdownToHtml("![](https://example.com/b.png)")).toContain('<a href="https://example.com/b.png">Picture</a>');
  });
  it("never passes raw HTML through", () => {
    expect(markdownToHtml("<script>alert(1)</script>")).not.toContain("<script>");
  });
});

describe("docToLines", () => {
  it("reads one line per block, list items and table cells included", () => {
    const doc = htmlToDoc("<h2>Purpose</h2><ul><li>One</li><li>Two</li></ul><table><tr><td>A</td><td>B</td></tr></table>");
    expect(docToLines(doc)).toEqual(["Purpose", "One", "Two", "A | B"]);
  });
  it("reads an empty document as no lines", () => {
    expect(docToLines(emptyDoc())).toEqual([]);
  });
});
