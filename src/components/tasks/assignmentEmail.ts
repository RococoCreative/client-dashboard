// The one place a saved task asks for its assignment email, shared by every screen that saves a
// task (the Tasks list, a task's page, a person's page, a campaign on Marketing). The rule is
// shouldNotifyAssignee; the send never undoes the save, so what happened comes back as the line
// the page shows, and "" means there is nothing to say. Someone who has not signed in yet has no
// inbox the hub knows, so no email is asked for and the line says so plainly. When the email
// service decides not to send, the line says no email went rather than staying silent.
import { hasAccount } from "../../lib/people.ts";
import { EMAIL_NOT_SENT, EMAIL_NO_ACCOUNT, EMAIL_SKIPPED, shouldNotifyAssignee } from "../../lib/tasks.ts";
import { notifyAssignment } from "../../services/tasks.ts";
import type { Profile, Task } from "../../types/database.ts";

// previousAssigneeId is undefined for a new task, and the assignee before the edit otherwise.
// assignee is the saved assignee's profile when the page has it; without it the send is asked for
// and the email service decides.
export async function sendAssignmentEmail(
  previousAssigneeId: string | null | undefined,
  saved: Pick<Task, "id" | "assignee_id">,
  viewerProfileId: string | null,
  assignee?: Pick<Profile, "id" | "user_id"> | null,
): Promise<string> {
  if (!shouldNotifyAssignee(previousAssigneeId, saved.assignee_id, viewerProfileId)) return "";
  const known = assignee && assignee.id === saved.assignee_id ? assignee : null;
  if (known && !hasAccount(known)) return EMAIL_NO_ACCOUNT;
  try {
    const result = await notifyAssignment(saved.id);
    return result?.sent === false ? EMAIL_SKIPPED : "";
  } catch {
    return EMAIL_NOT_SENT;
  }
}
