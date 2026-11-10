// The project-by-project discussion on a review (0035): one note per assigned project. Admins write
// them; the person reads the notes on their own review, by RLS. The review decides the company by
// trigger, the project has to be the same company's, and a signed-off review keeps its notes until
// it is reopened.
import type { ReviewProjectNote } from "../types/database.ts";
import { db } from "./supabase.ts";

const COLUMNS = "id, company_id, review_id, project_id, note, created_at, updated_at";

export async function listReviewProjectNotes(reviewId: string): Promise<ReviewProjectNote[]> {
  const { data, error } = await db().from("review_project_notes").select(COLUMNS).eq("review_id", reviewId).order("created_at");
  if (error) throw error;
  return (data as ReviewProjectNote[]) ?? [];
}

// Writes the note for one project on one review, replacing the one there.
export async function upsertReviewProjectNote(input: { company_id: string; review_id: string; project_id: string; note: string | null }): Promise<ReviewProjectNote> {
  const { data, error } = await db()
    .from("review_project_notes")
    .upsert({ ...input, note: input.note?.trim() || null }, { onConflict: "review_id,project_id" })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return data as ReviewProjectNote;
}

export async function deleteReviewProjectNote(id: string): Promise<void> {
  const { error } = await db().from("review_project_notes").delete().eq("id", id);
  if (error) throw error;
}
