// Moving SOP text between its forms: outside HTML (an import, a paste, an older Markdown version)
// into the editor's document, and a document into plain lines for comparing two versions. Pure
// apart from the DOM parser the editor's own schema uses.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import { generateJSON, type JSONContent } from "@tiptap/core";
import { sopExtensions } from "./schema.ts";
import type { SopDocJson } from "../../types/database.ts";

export function emptyDoc(): SopDocJson {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

// Through the editor's schema, so only what an SOP may hold survives.
export function htmlToDoc(html: string): SopDocJson {
  return generateJSON(html, sopExtensions()) as SopDocJson;
}

// An older version was Markdown. react-markdown never renders raw HTML, so nothing unsafe gets
// through on the way in.
export function markdownToHtml(md: string): string {
  return renderToStaticMarkup(createElement(Markdown, null, md));
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
