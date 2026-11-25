// For admins on an SOP: who has signed it off (and which version), who it is assigned to and still
// open, and Assign, which gives each chosen person a task on the SOP (0053). Their sign-off closes
// the task in the database. Assigning needs the company's tasks module (rule 12: the module
// decides) and a published SOP; the sign-off record shows either way. People who have not signed in
// yet can be assigned and are marked, never left out (rule 5).
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Button from "../ui/Button.tsx";
import Field from "../ui/Field.tsx";
import Modal from "../ui/Modal.tsx";
import Notice from "../ui/Notice.tsx";
import Section from "../ui/Section.tsx";
import { checkboxClass, inputClass, selectClass } from "../ui/forms.ts";
import { eyebrowLabelClass, metaClass } from "../ui/type.ts";
import { sendAssignmentEmail } from "../tasks/assignmentEmail.ts";
import { errorMessage } from "../../lib/errors.ts";
import { displayName, formatDate, pluralize } from "../../lib/format.ts";
import { hasAccount } from "../../lib/people.ts";
import { PRIORITY_LABELS } from "../../lib/tasks.ts";
import { createTask } from "../../services/tasks.ts";
import type { Profile, Sop, SopSignoff, TaskPriority, TaskWithSteps } from "../../types/database.ts";

function AssignDialog({
  sop,
  people,
  viewerId,
  onAssigned,
  onClose,
}: {
  sop: Sop;
  people: Profile[];
  viewerId: string;
  onAssigned: (tasks: TaskWithSteps[], notes: string[]) => void;
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const titleId = "sop-assign-title";

  async function assign() {
    setBusy(true);
    setError("");
    const made: TaskWithSteps[] = [];
    const notes: string[] = [];
    for (const person of people.filter((p) => chosen.has(p.id))) {
      try {
        const task = await createTask({
          company_id: sop.company_id,
          title: `Complete SOP: ${sop.title}`,
          description: "Read the SOP and do what it asks, then sign it off on the SOP's page. Signing off finishes this task.",
          assignee_id: person.id,
          sop_id: sop.id,
          due_date: due || null,
          priority,
        });
        made.push(task);
        const line = await sendAssignmentEmail(undefined, task, viewerId, person);
        if (line) notes.push(`${displayName(person)}: ${line}`);
      } catch (err) {
        notes.push(`${displayName(person)}: ${errorMessage(err)}`);
      }
    }
    setBusy(false);
    if (!made.length) return setError(notes.join(" ") || "Nothing was assigned.");
    onAssigned(made, notes);
  }

  return (
    <Modal onClose={onClose} labelledBy={titleId} size="md">
      <div className="px-5 py-4 sm:px-6">
        <h2 id={titleId} className="text-base font-semibold text-heading">Assign this SOP</h2>
        <p className={`mt-1 ${metaClass}`}>Each person gets a task. It finishes when they sign the SOP off.</p>
        <fieldset className="mt-4">
          <legend className={eyebrowLabelClass}>People</legend>
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
            {people.map((p) => (
              <li key={p.id}>
                <label className="flex items-center gap-2 py-1 text-sm text-ink tap:min-h-11">
                  <input
                    type="checkbox"
                    checked={chosen.has(p.id)}
                    onChange={(e) => {
                      const next = new Set(chosen);
                      if (e.target.checked) next.add(p.id);
                      else next.delete(p.id);
                      setChosen(next);
                    }}
                    className={checkboxClass}
                  />
                  <span>{displayName(p)}{hasAccount(p) ? "" : " · not signed in yet"}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Due" htmlFor="sop-assign-due">
            <input id="sop-assign-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Priority" htmlFor="sop-assign-priority">
            <select id="sop-assign-priority" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className={selectClass}>
              {(Object.keys(PRIORITY_LABELS) as TaskPriority[]).map((k) => (
                <option key={k} value={k}>{PRIORITY_LABELS[k]}</option>
              ))}
            </select>
          </Field>
        </div>
        {error ? <Notice tone="error" className="mt-4">{error}</Notice> : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!chosen.size || busy} onClick={() => void assign()}>
            {busy ? "Assigning..." : `Assign to ${pluralize(chosen.size, "person", "people")}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default function SopAssignments({
  sop,
  canAssign,
  people,
  signoffs,
  tasks,
  viewerId,
  onAssigned,
}: {
  sop: Sop;
  canAssign: boolean;
  people: Profile[];
  signoffs: SopSignoff[];
  tasks: TaskWithSteps[];
  viewerId: string;
  onAssigned: (tasks: TaskWithSteps[]) => void;
}) {
  const [assigning, setAssigning] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const names = useMemo(() => new Map(people.map((p) => [p.id, displayName(p)])), [people]);
  const open = tasks.filter((t) => t.completed_at === null);
  // Each person's newest sign-off.
  const latest = useMemo(() => {
    const seen = new Map<string, SopSignoff>();
    for (const s of signoffs) if (!seen.has(s.profile_id)) seen.set(s.profile_id, s);
    return [...seen.values()];
  }, [signoffs]);
  const active = people.filter((p) => p.is_active);
  const published = sop.status === "published";

  return (
    <Section
      eyebrow="Sign-offs"
      title={latest.length ? `${pluralize(latest.length, "person", "people")} signed off` : "No sign-offs yet"}
      actions={canAssign ? <Button variant="secondary" size="sm" disabled={!published} title={published ? undefined : "Publish it first"} onClick={() => setAssigning(true)}>Assign</Button> : null}
    >
      {notes.length ? <Notice tone="warning" className="mb-3">{notes.join(" ")}</Notice> : null}
      {latest.length ? (
        <ul className="divide-y divide-line">
          {latest.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span className="truncate text-ink">{s.signer_name ?? names.get(s.profile_id) ?? "Someone no longer here"}</span>
              <span className={`shrink-0 ${metaClass} ${s.version < sop.current_version ? "text-warning" : ""}`}>
                v{s.version}{s.version < sop.current_version ? " (older)" : ""} · {formatDate(s.signed_at)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={metaClass}>{published ? "Nobody has signed this one off yet." : "Sign-off opens once it is published."}</p>
      )}
      {open.length ? (
        <div className="mt-4">
          <p className={eyebrowLabelClass}>Assigned, not signed yet</p>
          <ul className="mt-1 divide-y divide-line">
            {open.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <Link to={`/tasks/${t.id}`} className="truncate text-ink hover:text-link">{t.assignee_id ? (names.get(t.assignee_id) ?? "Not on the roster") : "Unassigned"}</Link>
                <span className={`shrink-0 ${metaClass}`}>{t.due_date ? `Due ${formatDate(t.due_date)}` : "No due date"}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {assigning ? (
        <AssignDialog
          sop={sop}
          people={active}
          viewerId={viewerId}
          onClose={() => setAssigning(false)}
          onAssigned={(made, lines) => {
            setAssigning(false);
            setNotes(lines);
            onAssigned(made);
          }}
        />
      ) : null}
    </Section>
  );
}
