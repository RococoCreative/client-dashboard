// A goal's notes: a running log of dated entries, the reflection a person and their manager keep
// on a goal between meetings and work from in the review. Information only: nothing scores a
// note. One line to add, a pencil on your own entries to correct one, and a delete behind a
// confirm. Who reads which notes is the database's call (0021); this shows what it is given.
import { useState, type FormEvent } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import Button from "../ui/Button.tsx";
import ConfirmDialog from "../ui/ConfirmDialog.tsx";
import IconButton from "../ui/IconButton.tsx";
import { inputClass } from "../ui/forms.ts";
import { useHub } from "../../context/HubContext.tsx";
import { createGoalNote, deleteGoalNote, updateGoalNote } from "../../services/gsr.ts";
import { errorMessage } from "../../lib/errors.ts";
import { displayName, formatDate } from "../../lib/format.ts";
import type { Goal, GoalNote, Profile } from "../../types/database.ts";

const fieldClass = `${inputClass} mt-0 min-w-0 flex-1 py-1.5 text-[13px]`;

// One entry, read or being corrected.
function NoteEntry({
  note,
  author,
  canEdit,
  onSave,
  onDelete,
}: {
  note: GoalNote;
  author: string | null;
  canEdit: boolean;
  onSave: (body: string) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const [busy, setBusy] = useState(false);
  const stamp = formatDate(note.created_at);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    if (text === note.body) return setEditing(false);
    setBusy(true);
    const saved = await onSave(text);
    setBusy(false);
    if (saved) setEditing(false);
  }

  if (editing) {
    return (
      <li className="py-2">
        <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
          <input type="text" value={draft} autoFocus onChange={(e) => setDraft(e.target.value)} aria-label={`Edit note from ${stamp}`} className={fieldClass} />
          <Button type="submit" size="sm" disabled={!draft.trim() || busy}>Save</Button>
          <Button variant="ghost" size="sm" onClick={() => { setDraft(note.body); setEditing(false); }}>Cancel</Button>
          <IconButton label={`Delete note from ${stamp}`} onClick={onDelete}>
            <Trash2 size={13} aria-hidden />
          </IconButton>
        </form>
      </li>
    );
  }

  return (
    <li className="flex items-start gap-2 py-2">
      <div className="min-w-0 flex-1">
        <p className="tnum text-[11.5px] text-ink-3">{[stamp, author, note.updated_at !== note.created_at ? "edited" : null].filter(Boolean).join(" · ")}</p>
        <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{note.body}</p>
      </div>
      {canEdit ? (
        <IconButton label={`Edit note from ${stamp}`} onClick={() => { setDraft(note.body); setEditing(true); }} className="h-7 w-7">
          <Pencil size={13} aria-hidden />
        </IconButton>
      ) : null}
    </li>
  );
}

export default function GoalNotes({
  goal,
  notes,
  people,
  canWrite,
  onNotes,
  onError,
}: {
  goal: Pick<Goal, "id" | "title" | "company_id" | "employee_id">;
  // This goal's notes, oldest first, the order they were written in.
  notes: GoalNote[];
  // Names the authors. Left out where every note is the reader's own.
  people?: Profile[];
  canWrite: boolean;
  // Updates the caller's list of the person's notes, which holds every goal's.
  onNotes: (update: (notes: GoalNote[]) => GoalNote[]) => void;
  onError: (message: string) => void;
}) {
  const { profile } = useHub();
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<GoalNote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // The same rule the database keeps: the author edits, and a note carried over from the old
  // notes box, which has no author, is the person's own.
  const mine = (note: GoalNote) => note.author_id === profile.id || (note.author_id === null && note.employee_id === profile.id);
  const authorName = (note: GoalNote): string | null => {
    const author = note.author_id ? people?.find((p) => p.id === note.author_id) : undefined;
    return author ? displayName(author).split(" ")[0] : null;
  };

  // Adding is one click, so a double click would file the note twice without the guard.
  async function add(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || adding) return;
    setAdding(true);
    try {
      const created = await createGoalNote({ goal_id: goal.id, company_id: goal.company_id, employee_id: goal.employee_id, author_id: profile.id, body });
      onNotes((list) => [...list, created]);
      setDraft("");
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setAdding(false);
    }
  }

  async function save(note: GoalNote, body: string): Promise<boolean> {
    try {
      const saved = await updateGoalNote(note.id, body);
      onNotes((list) => list.map((n) => (n.id === saved.id ? saved : n)));
      return true;
    } catch (err) {
      onError(errorMessage(err));
      return false;
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    setError("");
    try {
      await deleteGoalNote(deleting.id);
      const id = deleting.id;
      onNotes((list) => list.filter((n) => n.id !== id));
      setDeleting(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!canWrite && notes.length === 0) return null;

  return (
    <div>
      {notes.length > 0 ? (
        <ul className="mt-0.5 divide-y divide-line">
          {notes.map((note) => (
            <NoteEntry key={note.id} note={note} author={authorName(note)} canEdit={canWrite && mine(note)} onSave={(body) => save(note, body)} onDelete={() => setDeleting(note)} />
          ))}
        </ul>
      ) : null}
      {canWrite ? (
        <form onSubmit={add} className="mt-2 flex gap-2">
          <input type="text" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a note" aria-label={`New note for ${goal.title}`} className={fieldClass} />
          <Button type="submit" variant="secondary" size="sm" disabled={!draft.trim() || adding}>
            <Plus size={13} aria-hidden /> Add
          </Button>
        </form>
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title="Delete this note?"
          body={`The note from ${formatDate(deleting.created_at)} comes off the goal for good. Notes are information only, so nothing on the goal's completion moves.`}
          confirmLabel="Delete note"
          busy={busy}
          error={error}
          onConfirm={() => void remove()}
          onCancel={() => { setDeleting(null); setError(""); }}
        />
      ) : null}
    </div>
  );
}
