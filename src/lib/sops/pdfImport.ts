// Reads a PDF's text as lines, with each line's size and its gap from the line above, for
// lines.ts to rebuild into an SOP. Runs pdf.js in the browser with its worker; only text is read, so
// fonts are never loaded into the page (pdf.js 6 no longer evaluates font code at all). Loaded only
// when someone imports a PDF.
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { TextLine } from "./lines.ts";

GlobalWorkerOptions.workerSrc = workerUrl;

type Item = { str: string; transform: number[]; height: number; width: number };

const MAX_PAGES = 200;

export async function readPdfLines(data: ArrayBuffer): Promise<{ lines: TextLine[]; pages: number }> {
  const task = getDocument({ data: new Uint8Array(data), disableFontFace: true });
  const pdf = await task.promise;
  const pages = Math.min(pdf.numPages, MAX_PAGES);
  const lines: TextLine[] = [];
  try {
    for (let n = 1; n <= pages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      // Items on one baseline (within a couple of points) form a line, read left to right.
      const rows: Array<{ y: number; items: Item[] }> = [];
      for (const raw of content.items) {
        const item = raw as Item;
        if (!("str" in item) || !item.str.trim()) continue;
        const y = item.transform[5];
        const row = rows.find((r) => Math.abs(r.y - y) <= 2);
        if (row) row.items.push(item);
        else rows.push({ y, items: [item] });
      }
      rows.sort((a, b) => b.y - a.y);
      let prevY: number | null = null;
      for (const row of rows) {
        row.items.sort((a, b) => a.transform[4] - b.transform[4]);
        let text = "";
        let end: number | null = null;
        for (const item of row.items) {
          const x = item.transform[4];
          if (end !== null && x - end > 1 && !text.endsWith(" ") && !item.str.startsWith(" ")) text += " ";
          text += item.str;
          end = x + item.width;
        }
        const size = Math.max(...row.items.map((i) => i.height || Math.abs(i.transform[3]) || 0));
        lines.push({ text, size, gapBefore: prevY === null ? null : prevY - row.y, page: n });
        prevY = row.y;
      }
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return { lines, pages };
}
