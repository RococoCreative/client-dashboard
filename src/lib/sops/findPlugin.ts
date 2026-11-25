// Find in this SOP: an editor extension that highlights every match of a query inside the
// document and marks the current one, without changing the document. Matches are found within
// each block's own text (a word split across bold and plain text still matches), case-insensitive.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PmNode } from "@tiptap/pm/model";

export type FindState = { query: string; current: number; matches: Array<{ from: number; to: number }>; decorations: DecorationSet };

export const sopFindKey = new PluginKey<FindState>("sopFind");

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    sopFind: {
      setSopFind: (query: string, current?: number) => ReturnType;
    };
  }
}

export function findMatches(doc: PmNode, query: string): Array<{ from: number; to: number }> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const out: Array<{ from: number; to: number }> = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // Every inline leaf reads as one character, so an offset in the text is an offset in the block.
    const text = node.textBetween(0, node.content.size, "\n", "\n").toLowerCase();
    let at = text.indexOf(needle);
    while (at !== -1) {
      out.push({ from: pos + 1 + at, to: pos + 1 + at + needle.length });
      at = text.indexOf(needle, at + needle.length);
    }
    return false;
  });
  return out;
}

function build(doc: PmNode, query: string, current: number): FindState {
  const matches = findMatches(doc, query);
  const index = matches.length ? Math.min(Math.max(current, 0), matches.length - 1) : 0;
  const decorations = DecorationSet.create(
    doc,
    matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === index ? "sop-find-match is-current" : "sop-find-match" })),
  );
  return { query, current: index, matches, decorations };
}

export function findState(state: EditorState): FindState | undefined {
  return sopFindKey.getState(state);
}

export const SopFind = Extension.create({
  name: "sopFind",
  addCommands() {
    return {
      setSopFind:
        (query: string, current = 0) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(sopFindKey, { query, current }));
          return true;
        },
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: sopFindKey,
        state: {
          init: (_, state) => build(state.doc, "", 0),
          apply: (tr, prev) => {
            const meta = tr.getMeta(sopFindKey) as { query: string; current: number } | undefined;
            if (meta) return build(tr.doc, meta.query, meta.current);
            return tr.docChanged ? build(tr.doc, prev.query, prev.current) : prev;
          },
        },
        props: {
          decorations: (state) => sopFindKey.getState(state)?.decorations,
        },
      }),
    ];
  },
});
