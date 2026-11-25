// Turns a file someone already has into a draft SOP, in the browser: nothing is sent anywhere to be
// read (approach A). Word (.docx) keeps its headings, lists, tables, bold and links; a PDF is
// rebuilt from its lines (lines.ts); text and Markdown files are read as they are. The title is the
// document's first heading, or the file's name. Pictures are left out and said so; the import page
// attaches the original file to the SOP, so nothing in it is lost. The readers load on demand.
import { docToLines, htmlToDoc, markdownToHtml } from "./doc.ts";
import { linesToHtml, type TextLine } from "./lines.ts";
import type { SopDocJson } from "../../types/database.ts";

export const MAX_IMPORT_FILES = 50;
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
export const IMPORT_ACCEPT = ".docx,.pdf,.txt,.md,.markdown";

export type ImportedSop = { fileName: string; title: string; doc: SopDocJson | null; notes: string[]; error?: string };

export type PdfReader = (data: ArrayBuffer) => Promise<{ lines: TextLine[]; pages: number }>;

const EMPTY = "The file has no text in it.";
const SCANNED = "No text found. It may be a scanned image. Attach it to an SOP instead.";

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

// "Ladder_safety-v3.docx" reads as "Ladder safety v3".
export function titleFromFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return base || "Untitled SOP";
}

// The document's first block, when it is a heading, is the title and leaves the body.
function splitTitle(doc: SopDocJson, fileName: string): { title: string; doc: SopDocJson } {
  const [first, ...rest] = doc.content ?? [];
  if (first?.type === "heading") {
    const title = docToLines({ type: "doc", content: [first] }).join(" ").trim();
    if (title) return { title: title.slice(0, 200), doc: { ...doc, content: rest.length ? rest : [{ type: "paragraph" }] } };
  }
  return { title: titleFromFileName(fileName), doc };
}

async function bufferOf(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
  return new Response(file).arrayBuffer();
}

async function textOf(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Response(file).text();
}

async function docxHtml(file: File): Promise<{ html: string; pictures: number }> {
  const mammoth = await import("mammoth");
  let pictures = 0;
  const data = await bufferOf(file);
  const convertImage = mammoth.images.imgElement(async () => {
    pictures += 1;
    return { src: "" };
  });
  // The browser build reads arrayBuffer, the Node build (tests) reads buffer.
  const input = { arrayBuffer: data, buffer: data } as unknown as Parameters<typeof mammoth.convertToHtml>[0];
  // Word's Title and Subtitle styles are headings too; mammoth's own map covers Heading 1 to 6.
  const styleMap = ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh"];
  const result = await mammoth.convertToHtml(input, { convertImage, styleMap });
  return { html: result.value, pictures };
}

// A text file: each line its own, the first one a title when a blank line follows it.
function textLines(text: string): TextLine[] {
  const raw = text.replace(/\r\n?/g, "\n").split("\n");
  const out: TextLine[] = [];
  let blank = false;
  raw.forEach((line, i) => {
    if (!line.trim()) {
      blank = true;
      return;
    }
    const titleLike = out.length === 0 && line.trim().length <= 80 && (raw[i + 1] ?? "").trim() === "";
    out.push({ text: line, size: titleLike ? 1.3 : 1, gapBefore: out.length === 0 ? null : blank ? 10 : 1, page: 1 });
    blank = false;
  });
  return out;
}

async function defaultPdfReader(data: ArrayBuffer) {
  const { readPdfLines } = await import("./pdfImport.ts");
  return readPdfLines(data);
}

export async function readSopFile(file: File, deps: { pdfLines?: PdfReader } = {}): Promise<ImportedSop> {
  const fileName = file.name;
  const fail = (error: string): ImportedSop => ({ fileName, title: titleFromFileName(fileName), doc: null, notes: [], error });
  const ext = extensionOf(fileName);

  if (ext === "doc") return fail("Old Word files (.doc) cannot be read. Open it in Word and save it as .docx or PDF.");
  if (!["docx", "pdf", "txt", "md", "markdown"].includes(ext)) return fail("This kind of file cannot be imported. Save it as .docx or PDF first.");
  if (file.size > MAX_IMPORT_BYTES) return fail("Files over 20 MB cannot be imported. Attach it to an SOP instead.");

  const notes: string[] = [];
  let html: string;
  try {
    if (ext === "docx") {
      const read = await docxHtml(file);
      html = read.html;
      if (read.pictures) notes.push(read.pictures === 1 ? "1 picture was left out." : `${read.pictures} pictures were left out.`);
    } else if (ext === "pdf") {
      const read = await (deps.pdfLines ?? defaultPdfReader)(await bufferOf(file));
      html = linesToHtml(read.lines, read.pages);
      if (!html) return fail(SCANNED);
      notes.push("Read from a PDF: check headings and lists before publishing.");
    } else if (ext === "txt") {
      html = linesToHtml(textLines(await textOf(file)), 1);
    } else {
      html = markdownToHtml(await textOf(file));
    }
  } catch {
    return fail("This file could not be read. It may be damaged or password protected.");
  }

  const whole = htmlToDoc(html);
  if (!docToLines(whole).length) return fail(ext === "pdf" ? SCANNED : EMPTY);
  const { title, doc } = splitTitle(whole, fileName);
  return { fileName, title, doc, notes };
}
