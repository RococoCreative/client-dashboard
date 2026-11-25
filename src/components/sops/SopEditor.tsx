// The SOP body editor: a word-processor style surface with a toolbar, writing the editor document
// a version stores (0053). It owns its document from the moment it mounts, seeded once from
// `initial`; the page reads changes through onChange. Pasted text from Word or a web page enters
// through the same schema an import does, so only what an SOP may hold gets in.
import { EditorContent, useEditor } from "@tiptap/react";
import EditorToolbar from "./EditorToolbar.tsx";
import { sopExtensions } from "../../lib/sops/schema.ts";
import type { SopDocJson } from "../../types/database.ts";

export default function SopEditor({ initial, onChange, label = "Body" }: { initial: SopDocJson; onChange: (doc: SopDocJson) => void; label?: string }) {
  const editor = useEditor({
    extensions: sopExtensions(),
    content: initial,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: {
        "aria-label": label,
        "aria-multiline": "true",
        role: "textbox",
        class: "sop-doc prose prose-sm max-w-none min-h-[420px] px-4 py-4 focus:outline-none sm:px-6",
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.getJSON() as SopDocJson),
  });

  return (
    <div className="rounded-md border border-line bg-surface focus-within:border-line-strong">
      {editor ? <EditorToolbar editor={editor} /> : null}
      <EditorContent editor={editor} />
    </div>
  );
}
