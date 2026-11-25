// The one schema every SOP document is written, imported and read in. The editor, the read-only
// view and the file import all build from sopExtensions(), so anything outside it (scripts,
// images, unknown tags) simply cannot enter a document, and every link is checked by isSafeHref.
import type { AnyExtension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";

const SAFE_PROTOCOL = /^(https?:\/\/|mailto:|tel:)/i;

// Web, mail and phone links only. Relative links, scripts and data URLs are refused.
export function isSafeHref(href: string): boolean {
  const value = href.trim();
  return value.length > 0 && SAFE_PROTOCOL.test(value);
}

export function sopExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      code: false,
      codeBlock: false,
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: "https",
        protocols: ["http", "https", "mailto", "tel"],
        isAllowedUri: (url) => isSafeHref(url),
        shouldAutoLink: (url) => isSafeHref(url) || /^[\w.-]+\.[a-z]{2,}/i.test(url),
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
      },
    }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
  ];
}
