// Rebuilds an SOP from loose lines of text, as a PDF or a plain text file gives them: larger type
// is a heading (graded against the body size), bullets and numbers are lists, close lines join into
// a paragraph, a wider gap or a new page starts the next one, a wrapped line stays with its list
// item, and running headers, footers and page numbers are dropped. Pure; the HTML it returns goes
// through the editor's schema (htmlToDoc) like any other import.

export type TextLine = {
  text: string;
  // Font size, in the source's own units.
  size: number;
  // Vertical distance from the line above on the same page; null for a page's first line.
  gapBefore: number | null;
  page: number;
};

const BULLET = /^[•●▪◦‣∙○■□➢►✓✔\-–—*]\s+/;
const NUMBERED = /^(?:\d{1,3}|[a-zA-Z])[.)]\s+/;
const PAGE_NUMBER = /^(?:page\s*)?\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?$/i;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// The size most of the text is set in, weighted by length.
function bodySize(lines: TextLine[]): number {
  const weight = new Map<number, number>();
  for (const l of lines) weight.set(Math.round(l.size * 2) / 2, (weight.get(Math.round(l.size * 2) / 2) ?? 0) + l.text.length);
  let best = 0;
  let bestWeight = -1;
  for (const [size, w] of weight) if (w > bestWeight) [best, bestWeight] = [size, w];
  return best || 1;
}

// A line that opens or closes most pages the same way (digits aside) is a running header or footer.
function runningLines(lines: TextLine[], pageCount: number): Set<string> {
  const key = (t: string) => t.trim().toLowerCase().replace(/\d+/g, "#");
  const edges = new Map<string, Set<number>>();
  const byPage = new Map<number, TextLine[]>();
  for (const l of lines) byPage.set(l.page, [...(byPage.get(l.page) ?? []), l]);
  for (const [page, pageLines] of byPage) {
    for (const l of [pageLines[0], pageLines[pageLines.length - 1]]) {
      if (!l) continue;
      const k = key(l.text);
      edges.set(k, (edges.get(k) ?? new Set()).add(page));
    }
  }
  const out = new Set<string>();
  if (pageCount < 2) return out;
  for (const [k, pages] of edges) if (pages.size >= Math.max(2, Math.ceil(pageCount / 2))) out.add(k);
  return out;
}

type TextBlock = { kind: "h1" | "h2" | "h3" | "p"; text: string };
type ListBlock = { kind: "ul" | "ol"; items: string[] };
type Block = TextBlock | ListBlock;
const isList = (b: Block): b is ListBlock => b.kind === "ul" || b.kind === "ol";

export function linesToHtml(input: TextLine[], pageCount: number): string {
  const running = runningLines(input, pageCount);
  const lines = input.filter((l) => {
    const text = l.text.trim();
    return text && !PAGE_NUMBER.test(text) && !running.has(text.toLowerCase().replace(/\d+/g, "#"));
  });
  if (!lines.length) return "";
  const body = bodySize(lines);
  const blocks: Block[] = [];
  let prev: TextLine | null = null;

  for (const l of lines) {
    const text = l.text.trim().replace(/\s+/g, " ");
    const ratio = l.size / body;
    const freshPage = !prev || prev.page !== l.page;
    const close = !freshPage && l.gapBefore !== null && l.gapBefore <= l.size * 1.6;
    const last = blocks[blocks.length - 1];

    if (ratio >= 1.15 && text.length <= 120) {
      blocks.push({ kind: ratio >= 1.6 ? "h1" : ratio >= 1.3 ? "h2" : "h3", text });
    } else if (BULLET.test(text) || NUMBERED.test(text)) {
      const kind = BULLET.test(text) ? "ul" : "ol";
      const item = text.replace(kind === "ul" ? BULLET : NUMBERED, "");
      if (last && last.kind === kind) last.items.push(item);
      else blocks.push({ kind, items: [item] });
    } else if (close && last && (last.kind === "ul" || last.kind === "ol")) {
      last.items[last.items.length - 1] += ` ${text}`;
    } else if (close && last && last.kind === "p") {
      last.text += ` ${text}`;
    } else {
      blocks.push({ kind: "p", text });
    }
    prev = l;
  }

  return blocks
    .map((b) =>
      isList(b)
        ? `<${b.kind}>${b.items.map((i) => `<li><p>${escapeHtml(i)}</p></li>`).join("")}</${b.kind}>`
        : `<${b.kind}>${escapeHtml(b.text)}</${b.kind}>`,
    )
    .join("");
}
