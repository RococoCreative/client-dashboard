// Moving SOP text between its forms: outside HTML (an import, a paste, an older Markdown version)
// into the editor's document, and a document into plain lines for comparing two versions. Pure
// apart from the DOM parser the editor's own schema uses.
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import type { Nodes as HastNodes } from "hast";
import { generateJSON, type JSONContent } from "@tiptap/core";
import { sopExtensions } from "./schema.ts";
import type { SopDocJson, SopVersion } from "../../types/database.ts";

export function emptyDoc(): SopDocJson {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

// Through the editor's schema, so only what an SOP may hold survives.
export function htmlToDoc(html: string): SopDocJson {
  return generateJSON(html, sopExtensions()) as SopDocJson;
}

const VOID = new Set(["br", "hr", "img"]);
const KEEP_ATTRS = new Set(["href", "start"]);

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// HTML from the Markdown syntax tree. Raw HTML in the Markdown never reaches the tree (remark-rehype
// drops it), and only a link's address and a list's start number are kept as attributes.
function hastToHtml(node: HastNodes): string {
  if (node.type === "text") return escapeHtml(node.value);
  if (node.type === "root") return node.children.map(hastToHtml).join("");
  if (node.type !== "element") return "";
  const attrs = Object.entries(node.properties ?? {})
    .filter(([key, value]) => KEEP_ATTRS.has(key) && (typeof value === "string" || typeof value === "number"))
    .map(([key, value]) => ` ${key}="${escapeHtml(String(value))}"`)
    .join("");
  if (VOID.has(node.tagName)) return `<${node.tagName}${attrs}>`;
  return `<${node.tagName}${attrs}>${node.children.map(hastToHtml).join("")}</${node.tagName}>`;
}

// An older version was Markdown.
export function markdownToHtml(md: string): string {
  const processor = unified().use(remarkParse).use(remarkRehype);
  const tree = processor.runSync(processor.parse(md)) as HastNodes;
  return hastToHtml(tree);
}

function textOf(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return " ";
  return (node.content ?? []).map(textOf).join("");
}

const CONTAINERS = new Set(["doc", "bulletList", "orderedList", "listItem", "blockquote", "table"]);

// One line per block, in reading order. A table row reads as its cells joined with " | ".
export function docToLines(doc: SopDocJson): string[] {
  const lines: string[] = [];
  const walk = (node: JSONContent) => {
    if (node.type === "tableRow") {
      lines.push((node.content ?? []).map((cell) => textOf(cell).trim()).join(" | "));
      return;
    }
    if (node.type && CONTAINERS.has(node.type)) {
      (node.content ?? []).forEach(walk);
      return;
    }
    if (node.type === "horizontalRule") return;
    const text = textOf(node).trim();
    if (text) lines.push(text);
  };
  walk(doc as JSONContent);
  return lines;
}

// A version's body as an editor document, converting Markdown from before the editor.
export function versionDoc(version: Pick<SopVersion, "body_json" | "body_md"> | null): SopDocJson {
  if (version?.body_json) return version.body_json;
  return htmlToDoc(markdownToHtml(version?.body_md ?? ""));
}
