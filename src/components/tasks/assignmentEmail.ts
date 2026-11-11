// The one place a saved task asks for its assignment email, shared by every screen that saves a
// task (the Tasks list, a task's page, a campaign on Marketing). The rule is shouldNotifyAssignee;
// the send never undoes the save, so a failure comes back as the warning line the page shows,
// and "" means there is nothing to say.
import { EMAIL_NOT_SENT, shouldNotifyAssignee } from "../../lib/tasks.ts";
import { notifyAssignment } from "../../services/tasks.ts";
import type { Task } from "../../types/database.ts";

// previousAssigneeId is undefined for a new task, and the assignee before the edit otherwise.
export async function sendAssignmentEmail(
  previousAssigneeId: string | null | undefined,
  saved: Pick<Task, "id" | "assignee_id">,
  viewerProfileId: string | null,
): Promise<string> {
  if (!shouldNotifyAssignee(previousAssigneeId, saved.assignee_id, viewerProfileId)) return "";
  try {
    await notifyAssignment(saved.id);
    return "";
  } catch {
    return EMAIL_NOT_SENT;
  }
}
