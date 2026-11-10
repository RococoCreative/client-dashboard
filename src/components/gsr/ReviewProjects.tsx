// The project-by-project part of a review: each project the person is assigned to, with the note
// written about it in this review (review_project_notes, 0035). Admins write the notes while the
// review is open; the person reads the ones on their own review. Signing off keeps them as they
// were, and a project unassigned since still shows with the note it was given.
import { useState } from "react";
import BlurInput from "../ui/BlurInput.tsx";
import Notice from "../ui/Notice.tsx";
import Section from "../ui/Section.tsx";
import { textareaClass } from "../ui/forms.ts";
import { upsertReviewProjectNote } from "../../services/reviewProjectNotes.ts";
import { errorMessage } from "../../lib/errors.ts";
import type { Project, ProjectAssignment, Review, ReviewProjectNote } from "../../types/database.ts";

type NotesUpdate = (update: (notes: ReviewProjectNote[]) => ReviewProjectNote[]) => void;

export default function ReviewProjects({
  review,
  assignments,
  projects,
  notes,
  canWrite,
  isOwn,
  onNotes,
}: {
  review: Review;
  // The person's assignments in the review's company.
  assignments: ProjectAssignment[];
  // The company's projects, archived ones too, to name each one.
  projects: Project[];
  notes: ReviewProjectNote[];
  canWrite: boolean;
  isOwn: boolean;
  onNotes: NotesUpdate;
}) {
  const [error, setError] = useState("");
  const signedOff = review.status === "complete";
  // Assigned projects first, in the order they were assigned, then any project that carries a note
  // on this review but is no longer assigned.
  const ids = [...assignments.map((a) => a.project_id)];
  for (const n of notes) if (!ids.includes(n.project_id)) ids.push(n.project_id);
  if (ids.length === 0) return null;

  async function save(projectId: string, note: string | null) {
    setError("");
    try {
      const saved = await upsertReviewProjectNote({ company_id: review.company_id, review_id: review.id, project_id: projectId, note });
      onNotes((list) => (list.some((n) => n.id === saved.id) ? list.map((n) => (n.id === saved.id ? saved : n)) : [...list, saved]));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Section
      eyebrow="Project by project"
      title="Projects"
      description={
        signedOff
          ? "The note on each project, as it was when this review was signed off."
          : canWrite
            ? "A note on each project the person is assigned to, written in the review. The person reads them on their own review."
            : isOwn
              ? "Your manager's note on each of your projects from this review."
              : "The note on each project from this review."
      }
    >
      {error ? <Notice tone="error" className="mb-3">{error}</Notice> : null}
      <ul className="divide-y divide-line">
        {ids.map((projectId) => {
          const project = projects.find((p) => p.id === projectId);
          const assignment = assignments.find((a) => a.project_id === projectId);
          const note = notes.find((n) => n.project_id === projectId)?.note ?? null;
          const name = project?.name ?? "A project";
          return (
            <li key={projectId} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="text-sm font-medium text-ink">{name}</p>
                <p className="text-[12px] text-ink-3">
                  {[project?.reference, assignment ? assignment.role : "No longer assigned"].filter(Boolean).join(" · ")}
                </p>
              </div>
              {canWrite ? (
                <BlurInput
                  multiline
                  rows={2}
                  value={note ?? ""}
                  ariaLabel={`Note on ${name}`}
                  placeholder="How the project is going, what was agreed..."
                  onSave={(next) => void save(projectId, next.trim() || null)}
                  className={`${textareaClass} mt-2 min-h-[56px] text-[13px]`}
                />
              ) : note ? (
                <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">{note}</p>
              ) : (
                <p className="mt-1.5 text-[12.5px] text-ink-3">{signedOff ? "No note." : "No note yet."}</p>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
