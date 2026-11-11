// The work behind one marketing campaign, at the foot of its card on the Marketing board: how many
// of its tasks are done, and, opened, the tasks themselves and "Add a task" with the campaign
// already chosen. The page loads every task once and hands each card its own; a task added here
// goes back to the page, so the count moves without a reload. The assignment email follows the
// same rule as everywhere else a task is saved (assignmentEmail.ts).
import { useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import Button from "../ui/Button.tsx";
import Notice from "../ui/Notice.tsx";
import TaskForm from "./TaskForm.tsx";
import TaskRow from "./TaskRow.tsx";
import { sendAssignmentEmail } from "./assignmentEmail.ts";
import { displayName } from "../../lib/format.ts";
import { campaignProgress, readingOrder } from "../../lib/tasks.ts";
import type { MarketingCampaign, Profile, TaskWithSteps } from "../../types/database.ts";

export default function CampaignTasks({
  companyId,
  campaign,
  campaigns,
  tasks,
  people,
  viewerProfileId,
  today,
  onCreated,
}: {
  companyId: string;
  campaign: MarketingCampaign;
  // Every campaign, for the form's campaign picker.
  campaigns: MarketingCampaign[];
  // This campaign's tasks, open and done.
  tasks: TaskWithSteps[];
  people: Profile[];
  viewerProfileId: string;
  today: string;
  onCreated: (task: TaskWithSteps) => void;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState("");
  const { done, total } = campaignProgress(tasks);
  const names = new Map(people.map((p) => [p.id, displayName(p)]));

  async function handleSaved(task: TaskWithSteps) {
    setAdding(false);
    onCreated(task);
    setNotice(await sendAssignmentEmail(undefined, task, viewerProfileId));
  }

  return (
    <div className="mt-3 border-t border-line pt-3">
      <Button variant="row" size="sm" aria-expanded={open} onClick={() => setOpen((was) => !was)}>
        <ChevronRight size={13} aria-hidden className={`shrink-0 text-ink-3 transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
        <span className="tnum">{done} of {total} tasks done</span>
      </Button>
      {open ? (
        <div className="mt-2">
          {tasks.length > 0 ? (
            <ul aria-label={`Tasks for ${campaign.name}`} className="-mx-4 divide-y divide-line border-y border-line">
              {readingOrder(tasks).map((task) => (
                <TaskRow key={task.id} task={task} assigneeName={task.assignee_id ? (names.get(task.assignee_id) ?? null) : null} today={today} showAssignee />
              ))}
            </ul>
          ) : null}
          <Button
            variant="link"
            size="sm"
            className="mt-2"
            onClick={() => {
              setNotice("");
              setAdding(true);
            }}
          >
            <Plus size={13} aria-hidden /> Add a task
          </Button>
        </div>
      ) : null}
      {notice ? <Notice tone="warning" className="mt-2">{notice}</Notice> : null}
      {adding ? (
        <TaskForm
          companyId={companyId}
          people={people}
          campaigns={campaigns}
          initial={{ campaign_id: campaign.id }}
          canSetCampaign
          onSaved={(task) => void handleSaved(task)}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </div>
  );
}
