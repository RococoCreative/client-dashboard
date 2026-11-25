// Pins how a file becomes a draft SOP: which kinds are read and what is said about the rest, how
// the title is found, what a Word file keeps (headings, lists, tables, bold) and what it leaves out
// (pictures, said so), and that a PDF with no text is reported rather than imported empty.
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { readSopFile } from "./importers.ts";
import { docToLines } from "./doc.ts";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

async function docx(body: string): Promise<File> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  zip.file("word/styles.xml", `<?xml version="1.0" encoding="UTF-8"?><w:styles ${W}><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}</w:body></w:document>`);
  const data = await zip.generateAsync({ type: "arraybuffer" });
  return new File([data], "Ladder_safety-v3.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

const para = (text: string, style?: string, bold = false) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

describe("readSopFile", () => {
  it("keeps a Word file's title, headings, paragraphs and bold text", async () => {
    const file = await docx(para("Ladder safety", "Title") + para("Purpose", "Heading1") + para("Inspect the feet first.", undefined, true));
    const read = await readSopFile(file);
    expect(read.error).toBeUndefined();
    expect(read.title).toBe("Ladder safety");
    const json = JSON.stringify(read.doc);
    expect(json).toContain('"heading"');
    expect(json).toContain('"bold"');
    expect(docToLines(read.doc!)).toEqual(["Purpose", "Inspect the feet first."]);
  });

  it("takes the title from the file name when the document has none", async () => {
    const read = await readSopFile(await docx(para("Inspect the feet first.")));
    expect(read.title).toBe("Ladder safety v3");
  });

  it("rebuilds a PDF from its lines, and attaches nothing it cannot keep", async () => {
    const file = new File(["%PDF"], "crane.pdf", { type: "application/pdf" });
    const read = await readSopFile(file, {
      pdfLines: async () => ({ pages: 1, lines: [{ text: "Crane checks", size: 18, gapBefore: null, page: 1 }, { text: "• Outriggers down", size: 10, gapBefore: 14, page: 1 }] }),
    });
    expect(read.title).toBe("Crane checks");
    expect(docToLines(read.doc!)).toEqual(["Outriggers down"]);
  });

  it("says when a long PDF was only read in part", async () => {
    const file = new File(["%PDF"], "manual.pdf", { type: "application/pdf" });
    const read = await readSopFile(file, {
      pdfLines: async () => ({ pages: 200, totalPages: 260, lines: [{ text: "Manual", size: 18, gapBefore: null, page: 1 }, { text: "Body text.", size: 10, gapBefore: 14, page: 1 }] }),
    });
    expect(read.notes).toContain("Only the first 200 of 260 pages were read. The rest is in the attached original.");
  });

  it("reports a PDF with no text instead of importing it empty", async () => {
    const file = new File(["%PDF"], "scan.pdf", { type: "application/pdf" });
    const read = await readSopFile(file, { pdfLines: async () => ({ pages: 2, lines: [] }) });
    expect(read.error).toBe("No text found. It may be a scanned image. Attach it to an SOP instead.");
    expect(read.doc).toBeNull();
  });

  it("reads a text file line by line, lists included", async () => {
    const file = new File(["Site walk\n\n1. Check the gate\n2. Check the fence\n"], "site-walk.txt", { type: "text/plain" });
    const read = await readSopFile(file);
    expect(read.title).toBe("Site walk");
    expect(JSON.stringify(read.doc)).toContain('"orderedList"');
  });

  it("reads Markdown", async () => {
    const read = await readSopFile(new File(["# Close out\n\n- Sweep\n- Lock up"], "close.md", { type: "text/markdown" }));
    expect(read.title).toBe("Close out");
    expect(docToLines(read.doc!)).toEqual(["Sweep", "Lock up"]);
  });

  it("says what to do with an old Word file and with anything else", async () => {
    expect((await readSopFile(new File(["x"], "old.doc"))).error).toBe("Old Word files (.doc) cannot be read. Open it in Word and save it as .docx or PDF.");
    expect((await readSopFile(new File(["x"], "deck.pptx"))).error).toBe("This kind of file cannot be imported. Save it as .docx or PDF first.");
  });

  it("refuses a file over 20 MB", async () => {
    const big = new File([new Uint8Array(20 * 1024 * 1024 + 1)], "huge.pdf", { type: "application/pdf" });
    expect((await readSopFile(big)).error).toBe("Files over 20 MB cannot be imported. Attach it to an SOP instead.");
  });
});
