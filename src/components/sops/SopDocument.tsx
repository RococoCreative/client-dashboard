// An SOP version, read-only, in the same schema the editor writes, with Find in this SOP above
// it. A version from before the editor (Markdown) is converted on the way in. The parent keys this
// by version, so switching versions starts a fresh view.
import { useEffect, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import FindBar from "./FindBar.tsx";
import { sopExtensions } from "../../lib/sops/schema.ts";
import { SopFind, findState } from "../../lib/sops/findPlugin.ts";
import type { SopDocJson } from "../../types/database.ts";

export default function SopDocument({ doc, initialQuery = "" }: { doc: SopDocJson; initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [current, setCurrent] = useState(0);
  const editor = useEditor({
    extensions: [...sopExtensions(), SopFind],
    content: doc,
    editable: false,
    shouldRerenderOnTransaction: true,
    editorProps: { attributes: { class: "sop-doc prose prose-sm max-w-none focus:outline-none", "aria-label": "Procedure" } },
  });

  useEffect(() => {
    if (!editor) return;
    editor.commands.setSopFind(query, current);
    // The current match into view, where the browser can scroll (jsdom cannot).
    const el = editor.view.dom.querySelector(".sop-find-match.is-current");
    if (el && typeof (el as HTMLElement).scrollIntoView === "function") (el as HTMLElement).scrollIntoView({ block: "center", behavior: "smooth" });
  }, [editor, query, current]);

  const state = editor ? findState(editor.state) : undefined;
  const count = state?.matches.length ?? 0;

  return (
    <div>
      <FindBar
        query={query}
        count={count}
        current={state?.current ?? 0}
        onQuery={(q) => {
          setQuery(q);
          setCurrent(0);
        }}
        onStep={(delta) => count && setCurrent((c) => (c + delta + count) % count)}
      />
      <EditorContent editor={editor} />
    </div>
  );
}
