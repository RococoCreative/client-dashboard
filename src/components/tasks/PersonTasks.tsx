// A person's open tasks on their person page, for the admin reading it: a compact list, earliest
// due first, each linking to the task. It loads its own rows, and the page renders it only when
// the company has the tasks module, so a company without it asks for nothing. Someone who has not
// signed in yet has their tasks here too: tasks attach to the person, never to an account.
import Notice from "../ui/Notice.tsx";
import Section from "../ui/Section.tsx";
import SkeletonRows from "../ui/SkeletonRows.tsx";
import TaskRow from "./TaskRow.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { displayName, todayIso } from "../../lib/format.ts";
import { sortTasks } from "../../lib/tasks.ts";
import { listTasks } from "../../services/tasks.ts";
import type { Profile } from "../../types/database.ts";

export default function PersonTasks({ companyId, person }: { companyId: string; person: Profile }) {
  const state = useAsync(() => listTasks(companyId, { assigneeId: person.id }), [companyId, person.id]);
  const today = todayIso();
  const name = displayName(person);
  return (
    <Section title="Tasks" description="Open tasks assigned to this person, earliest due first." padded={false}>
      {state.error && !state.data ? (
        <div className="p-5"><Notice tone="error">{state.error}</Notice></div>
      ) : !state.data ? (
        <div className="p-5"><SkeletonRows rows={2} /></div>
      ) : state.data.length === 0 ? (
        <p className="px-5 py-4 text-[13px] text-ink-3">No open tasks.</p>
      ) : (
        <ul aria-label={`Open tasks for ${name}`} className="divide-y divide-line">
          {sortTasks(state.data).map((task) => (
            <TaskRow key={task.id} task={task} assigneeName={name} today={today} showAssignee={false} />
          ))}
        </ul>
      )}
    </Section>
  );
}
