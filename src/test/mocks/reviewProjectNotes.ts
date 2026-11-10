// The review project notes service on the in-memory fixtures, for page tests and the demo. Same
// exports as src/services/reviewProjectNotes.ts: one note per project per review, the company taken
// from the review, and a signed-off review keeps its notes until it is reopened, as the database
// does (0035).
import type { ReviewProjectNote } from "../../types/database.ts";
import { fromAll } from "../fixtures.ts";
import { getReview } from "./gsr.ts";

const notes = fromAll((b) => b.reviewProjectNotes).map((x) => ({ ...x }));

let counter = 0;
const nextId = () => `review-note-new-${++counter}`;
const now = () => new Date().toISOString();

const SIGNED_OFF = "This review is signed off. Reopen it to change it.";

export async function listReviewProjectNotes(reviewId: string): Promise<ReviewProjectNote[]> {
  return notes
    .filter((n) => n.review_id === reviewId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((n) => ({ ...n }));
}

export async function upsertReviewProjectNote(input: { company_id: string; review_id: string; project_id: string; note: string | null }): Promise<ReviewProjectNote> {
  const review = await getReview(input.review_id);
  if (review.status === "complete") throw new Error(SIGNED_OFF);
  const note = input.note?.trim() || null;
  const existing = notes.find((n) => n.review_id === input.review_id && n.project_id === input.project_id);
  if (existing) {
    Object.assign(existing, { note, updated_at: now() });
    return { ...existing };
  }
  const created: ReviewProjectNote = { id: nextId(), company_id: review.company_id, review_id: review.id, project_id: input.project_id, note, created_at: now(), updated_at: now() };
  notes.push(created);
  return { ...created };
}

export async function deleteReviewProjectNote(id: string): Promise<void> {
  const note = notes.find((n) => n.id === id);
  if (!note) return;
  if ((await getReview(note.review_id)).status === "complete") throw new Error(SIGNED_OFF);
  notes.splice(notes.indexOf(note), 1);
}
