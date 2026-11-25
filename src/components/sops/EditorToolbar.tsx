// The SOP editor's toolbar: paragraph style, emphasis, lists, quote, divider, link, table and its
// rows and columns, undo and redo, clear formatting. Every control is a labeled icon button so it
// reads the same to a mouse, a finger and a screen reader.
import { useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import {
  BetweenHorizontalEnd,
  BetweenVerticalEnd,
  Bold,
  Columns3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  RemoveFormatting,
  Rows3,
  Strikethrough,
  Table,
  Trash2,
  Underline,
  Undo2,
  Unlink,
} from "lucide-react";
import Button from "../ui/Button.tsx";
import { compactInputClass, compactSelectClass } from "../ui/forms.ts";
import { iconButtonClass } from "../ui/iconButtonClass.ts";
import { isSafeHref } from "../../lib/sops/schema.ts";

function ToolButton({ label, active = false, disabled = false, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      // Keeps the editor's selection: a mousedown on a button would otherwise take focus from it.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`${iconButtonClass("md")} ${active ? "bg-accent/10 text-accent" : ""}`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span aria-hidden className="mx-1 h-5 w-px bg-line" />;
}

type Style = "paragraph" | "1" | "2" | "3";

function styleOf(editor: Editor): Style {
  for (const level of [1, 2, 3] as const) if (editor.isActive("heading", { level })) return String(level) as Style;
  return "paragraph";
}

function LinkForm({ editor, onDone }: { editor: Editor; onDone: () => void }) {
  const [href, setHref] = useState(() => (editor.getAttributes("link").href as string | undefined) ?? "https://");
  const [error, setError] = useState("");
  function apply(event?: { preventDefault: () => void }) {
    event?.preventDefault();
    const value = href.trim();
    if (!isSafeHref(value)) return setError("Use a web address starting with https://, or mailto: or tel:.");
    editor.chain().focus().extendMarkRange("link").setLink({ href: value }).run();
    onDone();
  }
  return (
    // A div, not a form: the editor sits inside the page's own form.
    <div className="flex w-full flex-wrap items-center gap-2 border-t border-line px-2 py-2" role="group" aria-label="Link">
      <input
        aria-label="Link address"
        value={href}
        onChange={(e) => setHref(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") apply(e);
          if (e.key === "Escape") onDone();
        }}
        className={`${compactInputClass} max-w-sm`}
        autoFocus
      />
      <Button size="sm" onClick={() => apply()}>Apply</Button>
      <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      {error ? <span className="text-[12px] text-danger" role="alert">{error}</span> : null}
    </div>
  );
}

export default function EditorToolbar({ editor }: { editor: Editor }) {
  const [linking, setLinking] = useState(false);
  const chain = () => editor.chain().focus();
  const inTable = editor.isActive("table");

  return (
    <div className="sticky top-0 z-10 rounded-t-md border-b border-line bg-surface">
      <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5 px-1.5 py-1">
        <select
          aria-label="Paragraph style"
          value={styleOf(editor)}
          onChange={(e) => {
            const value = e.target.value as Style;
            if (value === "paragraph") chain().setParagraph().run();
            else chain().setHeading({ level: Number(value) as 1 | 2 | 3 }).run();
          }}
          className={`${compactSelectClass} mr-1 w-auto`}
        >
          <option value="paragraph">Paragraph</option>
          <option value="1">Title</option>
          <option value="2">Heading</option>
          <option value="3">Subheading</option>
        </select>
        <ToolButton label="Bold" active={editor.isActive("bold")} onClick={() => chain().toggleBold().run()}><Bold size={15} aria-hidden /></ToolButton>
        <ToolButton label="Italic" active={editor.isActive("italic")} onClick={() => chain().toggleItalic().run()}><Italic size={15} aria-hidden /></ToolButton>
        <ToolButton label="Underline" active={editor.isActive("underline")} onClick={() => chain().toggleUnderline().run()}><Underline size={15} aria-hidden /></ToolButton>
        <ToolButton label="Strikethrough" active={editor.isActive("strike")} onClick={() => chain().toggleStrike().run()}><Strikethrough size={15} aria-hidden /></ToolButton>
        <Divider />
        <ToolButton label="Bulleted list" active={editor.isActive("bulletList")} onClick={() => chain().toggleBulletList().run()}><List size={15} aria-hidden /></ToolButton>
        <ToolButton label="Numbered list" active={editor.isActive("orderedList")} onClick={() => chain().toggleOrderedList().run()}><ListOrdered size={15} aria-hidden /></ToolButton>
        <ToolButton label="Quote" active={editor.isActive("blockquote")} onClick={() => chain().toggleBlockquote().run()}><Quote size={15} aria-hidden /></ToolButton>
        <ToolButton label="Divider line" onClick={() => chain().setHorizontalRule().run()}><Minus size={15} aria-hidden /></ToolButton>
        <Divider />
        <ToolButton label={editor.isActive("link") ? "Edit link" : "Add link"} active={editor.isActive("link")} onClick={() => setLinking((v) => !v)}><Link2 size={15} aria-hidden /></ToolButton>
        <ToolButton label="Remove link" disabled={!editor.isActive("link")} onClick={() => chain().extendMarkRange("link").unsetLink().run()}><Unlink size={15} aria-hidden /></ToolButton>
        <Divider />
        <ToolButton label="Insert table" disabled={inTable} onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table size={15} aria-hidden /></ToolButton>
        {inTable ? (
          <>
            <ToolButton label="Add row below" onClick={() => chain().addRowAfter().run()}><BetweenHorizontalEnd size={15} aria-hidden /></ToolButton>
            <ToolButton label="Add column right" onClick={() => chain().addColumnAfter().run()}><BetweenVerticalEnd size={15} aria-hidden /></ToolButton>
            <ToolButton label="Delete row" onClick={() => chain().deleteRow().run()}><Rows3 size={15} aria-hidden /></ToolButton>
            <ToolButton label="Delete column" onClick={() => chain().deleteColumn().run()}><Columns3 size={15} aria-hidden /></ToolButton>
            <ToolButton label="Delete table" onClick={() => chain().deleteTable().run()}><Trash2 size={15} aria-hidden /></ToolButton>
          </>
        ) : null}
        <Divider />
        <ToolButton label="Clear formatting" onClick={() => chain().unsetAllMarks().clearNodes().run()}><RemoveFormatting size={15} aria-hidden /></ToolButton>
        <ToolButton label="Undo" disabled={!editor.can().undo()} onClick={() => chain().undo().run()}><Undo2 size={15} aria-hidden /></ToolButton>
        <ToolButton label="Redo" disabled={!editor.can().redo()} onClick={() => chain().redo().run()}><Redo2 size={15} aria-hidden /></ToolButton>
      </div>
      {linking ? <LinkForm editor={editor} onDone={() => setLinking(false)} /> : null}
    </div>
  );
}
