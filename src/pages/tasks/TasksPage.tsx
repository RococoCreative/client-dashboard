// Tasks, the list view. Mine is the signed-in person's own tasks, earliest due first, with their
// finished ones on request; anyone may add a task for themselves here. The second tab is Everyone
// for admins (every task in the company) and Team for managers (the tasks of the people they may
// see, as the database returns them), narrowed by person, priority, campaign and status. From it an
// admin adds a task for anyone on the roster and a manager for anyone they lead or themselves. Each
// tab is its own route (/tasks and /tasks/everyone). Saving a task never waits on the assignment
// email: when someone else is the assignee the page asks for it after the save, and the line it
// shows says when no email went (a failed send, or someone who has not signed in yet) without
// undoing the task.
import { useState } from "react";
import { Plus } from "lucide-react";
import TaskForm from "../../components/tasks/TaskForm.tsx";
import TaskRow from "../../components/tasks/TaskRow.tsx";
import { sendAssignmentEmail } from "../../components/tasks/assignmentEmail.ts";
import Button from "../../components/ui/Button.tsx";
import EmptyState from "../../components/ui/EmptyState.tsx";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import Section from "../../components/ui/Section.tsx";
import SkeletonRows from "../../components/ui/SkeletonRows.tsx";
import Tabs from "../../components/ui/Tabs.tsx";
import { checkboxClass, selectClass } from "../../components/ui/forms.ts";
import { secondaryClass } from "../../components/ui/type.ts";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { displayName, todayIso } from "../../lib/format.ts";
import { ledBy } from "../../lib/people.ts";
import { PRIORITY_LABELS, isDone, readingOrder } from "../../lib/tasks.ts";
import { listCampaigns } from "../../services/marketing.ts";
import { listCompanyProfiles } from "../../services/profiles.ts";
import { listTasks } from "../../services/tasks.ts";
import type { MarketingCampaign, Profile, TaskPriority, TaskWithSteps } from "../../types/database.ts";
import { tasksTabsFor, type TasksTab } from "./tasksTabs.ts";

type Status = "open" | "done" | "all";

const PRIORITIES = Object.keys(PRIORITY_LABELS) as TaskPriority[];
const STATUS_LABELS: Record<Status, string> = { open: "Open", done: "Done", all: "Open and done" };
// The shared select is full width; a filter sizes to its choice so the row reads as one line.
const filterClass = `${selectClass} mt-0 !w-auto max-w-full`;

function matchesStatus(task: TaskWithSteps, status: Status): boolean {
  return status === "all" || (status === "done") === isDone(task);
}

// "" is everyone or every campaign, "none" is unassigned or no campaign, anything else an id.
function matchesChoice(value: string | null, choice: string): boolean {
  if (choice === "") return true;
  if (choice === "none") return value === null;
  return value === choice;
}

function Filters({
  people,
  showUnassigned,
  campaigns,
  person,
  priority,
  campaign,
  status,
  onPerson,
  onPriority,
  onCampaign,
  onStatus,
}: {
  people: Profile[];
  // Unassigned tasks are an admin's to read, so only an admin filters to them.
  showUnassigned: boolean;
  campaigns: MarketingCampaign[];
  person: string;
  priority: TaskPriority | "";
  campaign: string;
  status: Status;
  onPerson: (next: string) => void;
  onPriority: (next: TaskPriority | "") => void;
  onCampaign: (next: string) => void;
  onStatus: (next: Status) => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <select value={person} onChange={(e) => onPerson(e.target.value)} aria-label="Filter by person" className={filterClass}>
        <option value="">All people</option>
        {showUnassigned ? <option value="none">Unassigned</option> : null}
        {people.map((p) => (
          <option key={p.id} value={p.id}>{displayName(p)}</option>
        ))}
      </select>
      <select value={priority} onChange={(e) => onPriority(e.target.value as TaskPriority | "")} aria-label="Filter by priority" className={filterClass}>
        <option value="">Any priority</option>
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
        ))}
      </select>
      {campaigns.length > 0 ? (
        <select value={campaign} onChange={(e) => onCampaign(e.target.value)} aria-label="Filter by campaign" className={filterClass}>
          <option value="">Any campaign</option>
          <option value="none">No campaign</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      ) : null}
      <select value={status} onChange={(e) => onStatus(e.target.value as Status)} aria-label="Filter by status" className={filterClass}>
        {(Object.keys(STATUS_LABELS) as Status[]).map((s) => (
          <option key={s} value={s}>{STATUS_LABELS[s]}</option>
        ))}
      </select>
    </div>
  );
}

export default function TasksPage({ tab }: { tab: TasksTab }) {
  const { company, profile, isAdmin, isLead } = useHub();
  const companyId = company!.id;
  const profileId = profile.id;
  // Everyone (Team, for a manager) is for leads; anyone else who lands on it sees their own tasks.
  const view: TasksTab = isLead ? tab : "mine";
  const today = todayIso();
  const [showCompleted, setShowCompleted] = useState(false);
  const [status, setStatus] = useState<Status>("open");
  const [person, setPerson] = useState("");
  const [priority, setPriority] = useState<TaskPriority | "">("");
  const [campaign, setCampaign] = useState("");
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");

  // The roster is for a lead's picker, names and filters: the people the database lets the viewer
  // see. Campaigns are admin-only in the database too, so nobody else asks for them.
  const roster = useAsync(async () => {
    if (!isLead) return { people: [] as Profile[], campaigns: [] as MarketingCampaign[] };
    const [people, campaigns] = await Promise.all([listCompanyProfiles(companyId), isAdmin ? listCampaigns(companyId) : Promise.resolve([] as MarketingCampaign[])]);
    return { people, campaigns };
  }, [companyId, isAdmin, isLead]);

  const listStatus: Status = view === "mine" ? (showCompleted ? "all" : "open") : status;
  const state = useAsync(
    () => listTasks(companyId, view === "mine" ? { assigneeId: profileId, status: listStatus } : { status: listStatus }),
    [companyId, view, profileId, listStatus],
  );

  const people = roster.data?.people ?? [];
  const campaigns = roster.data?.campaigns ?? [];
  const names = new Map(people.map((p) => [p.id, displayName(p)]));
  const visibleIds = new Set(people.map((p) => p.id));
  // Whom the viewer may give a task: everyone they see for an admin; for a manager, the people
  // they lead and themselves.
  const assignable = isAdmin ? people : people.filter((p) => p.id === profileId || ledBy(profile, people).some((l) => l.id === p.id));
  const filtered = view === "everyone" && (person !== "" || priority !== "" || campaign !== "");
  const visible = readingOrder(
    (state.data ?? []).filter(
      (t) =>
        matchesStatus(t, listStatus) &&
        // A manager's Team is the people the database showed them; this only ever narrows.
        (view === "mine" || isAdmin || (t.assignee_id !== null && visibleIds.has(t.assignee_id))) &&
        (view === "mine" || (matchesChoice(t.assignee_id, person) && (priority === "" || t.priority === priority) && matchesChoice(t.campaign_id, campaign))),
    ),
  );
  // A company member adds to their own list from Mine. A Rococo admin stepped in has no place on
  // the roster to fix a task to, so they get the picker.
  const lockAssigneeTo = view === "mine" && profile.company_id === companyId ? profileId : undefined;
  const loading = (!state.data && !state.error) || (isLead && !roster.data && !roster.error);

  async function handleSaved(task: TaskWithSteps) {
    setCreating(false);
    if (view === "everyone" || task.assignee_id === profileId) {
      state.setData((prev) => (prev ? [...prev, task] : prev));
    }
    const line = await sendAssignmentEmail(undefined, task, profileId, people.find((p) => p.id === task.assignee_id) ?? null);
    if (line) setNotice(line);
  }

  const empty =
    view === "mine"
      ? { title: listStatus === "open" ? "No open tasks." : "No tasks yet.", body: "Tasks assigned to you show here. Add one for yourself any time." }
      : filtered || listStatus !== "open"
        ? { title: "No tasks match these filters.", body: "Change a filter to see more." }
        : { title: "No open tasks.", body: isAdmin ? "Add a task for anyone on the team." : "Tasks for the people you lead show here. Add one for any of them." };

  const addTask = (
    <Button
      size="sm"
      onClick={() => {
        setNotice("");
        setCreating(true);
      }}
    >
      <Plus size={14} aria-hidden /> Add a task
    </Button>
  );

  return (
    <>
      <PageHeader eyebrow={company!.name} title="Tasks" description="Tasks with due dates, steps, and repeats, earliest due first." actions={addTask} />
      {isLead ? <Tabs items={tasksTabsFor(isAdmin)} label="Tasks" /> : null}
      {notice ? <Notice tone="warning" className="mb-4">{notice}</Notice> : null}
      {state.error ? <Notice tone="error" className="mb-4">{state.error}</Notice> : null}
      {roster.error ? <Notice tone="error" className="mb-4">{roster.error}</Notice> : null}

      {view === "mine" ? (
        <label className={`mb-4 inline-flex min-h-11 items-center gap-2 sm:min-h-0 ${secondaryClass}`}>
          <input type="checkbox" className={checkboxClass} checked={showCompleted} onChange={(e) => setShowCompleted(e.target.checked)} />
          Show completed
        </label>
      ) : (
        <Filters
          people={people}
          showUnassigned={isAdmin}
          campaigns={campaigns}
          person={person}
          priority={priority}
          campaign={campaign}
          status={status}
          onPerson={setPerson}
          onPriority={setPriority}
          onCampaign={setCampaign}
          onStatus={setStatus}
        />
      )}

      {loading ? (
        <SkeletonRows rows={6} />
      ) : !state.data ? null : visible.length === 0 ? (
        <EmptyState eyebrow="Tasks" title={empty.title} body={empty.body} />
      ) : (
        <Section padded={false}>
          <ul className="divide-y divide-line" aria-label="Tasks">
            {visible.map((task) => (
              <TaskRow key={task.id} task={task} assigneeName={task.assignee_id ? (names.get(task.assignee_id) ?? null) : null} today={today} showAssignee={view === "everyone"} />
            ))}
          </ul>
        </Section>
      )}

      {creating ? (
        <TaskForm
          companyId={companyId}
          people={assignable}
          campaigns={campaigns}
          lockAssigneeTo={lockAssigneeTo}
          allowUnassigned={isAdmin}
          canSetCampaign={isAdmin}
          onSaved={(task) => void handleSaved(task)}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </>
  );
}
