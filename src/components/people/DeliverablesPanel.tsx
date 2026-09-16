// A person's deliverables for the year, grouped the way the client's workbook groups them: a
// category the company defines ("Sales & Mktg.", "Production"), headings under it, and the
// support tasks each heading is actually measured by. The rating sits on the task; the heading's
// figure and the category's are derived in lib/gsr/deliverables.ts.
//
// This is the second half of what a person is measured on. Personal KPIs, the numeric ones with
// a target and a current figure, are a separate module and stay as they are.
//
// The same panel serves the person page and the review, because the ratings are set in the
// meeting. `canEdit` is what separates an admin from the employee reading their own.
import { useRef, useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import Badge from "../ui/Badge.tsx";
import BlurInput from "../ui/BlurInput.tsx";
import Button from "../ui/Button.tsx";
import ConfirmDialog from "../ui/ConfirmDialog.tsx";
import EmptyState from "../ui/EmptyState.tsx";
import IconButton from "../ui/IconButton.tsx";
import Notice from "../ui/Notice.tsx";
import RatingChoice from "../ui/RatingChoice.tsx";
import { SkeletonRows } from "../ui/Skeleton.tsx";
import { inputClass } from "../ui/forms.ts";
import { useAsync } from "../../hooks/useAsync.ts";
import {
  createDeliverableCategory,
  createDeliverableTask,
  createEmployeeDeliverable,
  deleteDeliverableTask,
  deleteEmployeeDeliverable,
  listDeliverableCategories,
  listDeliverableTasks,
  listEmployeeDeliverables,
  updateDeliverableTask,
  updateEmployeeDeliverable,
} from "../../services/deliverables.ts";
import { groupByCategory, scoreCategory, scoreDeliverable } from "../../lib/gsr/deliverables.ts";
import { errorMessage } from "../../lib/errors.ts";
import type { DeliverableCategory, DeliverableTask, EmployeeDeliverable } from "../../types/database.ts";

const eyebrowClass = "text-[11px] font-medium uppercase tracking-label text-ink-3";

function Figure({ actual, target, hit }: { actual: number; target: number; hit: boolean }) {
  if (target === 0) return <span className="text-[12px] text-ink-3">No tasks yet</span>;
  return (
    <span className="flex shrink-0 items-center gap-2">
      <span className="tnum text-[13px] text-ink-2">
        {actual} of {target}
      </span>
      <Badge tone={hit ? "success" : "neutral"}>{hit ? "Hit" : "Open"}</Badge>
    </span>
  );
}

function TaskRow({
  task,
  canEdit,
  onSave,
  onRemove,
}: {
  task: DeliverableTask;
  canEdit: boolean;
  onSave: (patch: Partial<Pick<DeliverableTask, "name" | "note" | "rating">>) => void;
  onRemove: () => void;
}) {
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[220px] flex-1">
          {canEdit ? (
            <BlurInput
              value={task.name}
              required
              ariaLabel={`Task ${task.name}`}
              onSave={(next) => onSave({ name: next.trim() })}
              className={`${inputClass} mt-0 text-[13px]`}
            />
          ) : (
            <p className="text-sm text-ink">{task.name}</p>
          )}
          {canEdit ? (
            <BlurInput
              value={task.note ?? ""}
              placeholder="Note"
              ariaLabel={`Note for ${task.name}`}
              onSave={(next) => onSave({ note: next.trim() || null })}
              className={`${inputClass} mt-1.5 text-[12.5px]`}
            />
          ) : task.note ? (
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{task.note}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <RatingChoice
            value={task.rating}
            label={`Rating for ${task.name}`}
            onChange={canEdit ? (next) => onSave({ rating: next }) : undefined}
          />
          {canEdit ? (
            <IconButton label={`Remove task ${task.name}`} onClick={onRemove}>
              <Trash2 size={14} aria-hidden />
            </IconButton>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export default function DeliverablesPanel({
  companyId,
  employeeId,
  year,
  canEdit,
}: {
  companyId: string;
  employeeId: string;
  year: number;
  canEdit: boolean;
}) {
  const state = useAsync(async () => {
    const [categories, deliverables, tasks] = await Promise.all([
      listDeliverableCategories(companyId),
      listEmployeeDeliverables(employeeId, year),
      listDeliverableTasks(employeeId, year),
    ]);
    return { categories, deliverables, tasks };
  }, [companyId, employeeId, year]);

  const [error, setError] = useState("");
  // A delete dialog reports only its own failure. Sharing `error` with the inline saves meant a
  // dialog could open already showing a rating that failed a minute earlier, reading as though
  // the removal had gone wrong before it was confirmed.
  const [removeError, setRemoveError] = useState("");
  const [busy, setBusy] = useState(false);
  // An add form that is still waiting on the server must not accept a second submit: the draft is
  // only cleared after the round trip, so a double click would file the same row twice and, for a
  // task, quietly move the heading's target by two points.
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<EmployeeDeliverable | null>(null);
  const [removingTask, setRemovingTask] = useState<DeliverableTask | null>(null);
  const [newDeliverable, setNewDeliverable] = useState<Record<string, string>>({});
  const [newTask, setNewTask] = useState<Record<string, string>>({});
  const [newCategory, setNewCategory] = useState("");
  // Clicking a rating blurs the note beside it, so one task can have two saves in flight. Each
  // response carries that write's whole row, so out of order they undo each other on screen while
  // the database is correct. Saves for one task therefore queue behind each other.
  const saveChains = useRef(new Map<string, Promise<unknown>>());

  const categories: DeliverableCategory[] = state.data?.categories ?? [];
  const deliverables: EmployeeDeliverable[] = state.data?.deliverables ?? [];
  const tasks: DeliverableTask[] = state.data?.tasks ?? [];

  async function run(work: () => Promise<void>) {
    setError("");
    try {
      await work();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const tasksFor = (deliverableId: string) => tasks.filter((t) => t.deliverable_id === deliverableId);

  async function addCategory(event: FormEvent) {
    event.preventDefault();
    const name = newCategory.trim();
    if (!name || adding) return;
    setAdding(true);
    await run(async () => {
      const created = await createDeliverableCategory({ company_id: companyId, name, sort_order: categories.length + 1 });
      state.setData((prev) => (prev ? { ...prev, categories: [...prev.categories, created] } : prev));
      setNewCategory("");
    });
    setAdding(false);
  }

  async function addDeliverable(categoryId: string) {
    const name = (newDeliverable[categoryId] ?? "").trim();
    if (!name || adding) return;
    setAdding(true);
    await run(async () => {
      const created = await createEmployeeDeliverable({
        employee_id: employeeId,
        category_id: categoryId,
        year,
        name,
        sort_order: deliverables.length + 1,
      });
      state.setData((prev) => (prev ? { ...prev, deliverables: [...prev.deliverables, created] } : prev));
      setNewDeliverable((prev) => ({ ...prev, [categoryId]: "" }));
    });
    setAdding(false);
  }

  async function addTask(deliverableId: string) {
    const name = (newTask[deliverableId] ?? "").trim();
    if (!name || adding) return;
    setAdding(true);
    await run(async () => {
      const created = await createDeliverableTask({
        deliverable_id: deliverableId,
        name,
        sort_order: tasksFor(deliverableId).length + 1,
      });
      state.setData((prev) => (prev ? { ...prev, tasks: [...prev.tasks, created] } : prev));
      setNewTask((prev) => ({ ...prev, [deliverableId]: "" }));
    });
    setAdding(false);
  }

  async function saveTask(task: DeliverableTask, patch: Partial<Pick<DeliverableTask, "name" | "note" | "rating">>) {
    const chained = (saveChains.current.get(task.id) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      const next = await updateDeliverableTask(task.id, patch);
      state.setData((prev) => (prev ? { ...prev, tasks: prev.tasks.map((t) => (t.id === next.id ? next : t)) } : prev));
    });
    saveChains.current.set(task.id, chained);
    await run(() => chained);
  }

  async function saveDeliverable(deliverable: EmployeeDeliverable, patch: Partial<Pick<EmployeeDeliverable, "name" | "category_id">>) {
    await run(async () => {
      const next = await updateEmployeeDeliverable(deliverable.id, patch);
      state.setData((prev) => (prev ? { ...prev, deliverables: prev.deliverables.map((d) => (d.id === next.id ? next : d)) } : prev));
    });
  }

  async function handleRemoveDeliverable() {
    if (!removing) return;
    setBusy(true);
    setRemoveError("");
    try {
      const id = removing.id;
      await deleteEmployeeDeliverable(id);
      state.setData((prev) =>
        prev
          ? { ...prev, deliverables: prev.deliverables.filter((d) => d.id !== id), tasks: prev.tasks.filter((t) => t.deliverable_id !== id) }
          : prev,
      );
      setRemoving(null);
    } catch (err) {
      setRemoveError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveTask() {
    if (!removingTask) return;
    setBusy(true);
    setRemoveError("");
    try {
      const id = removingTask.id;
      await deleteDeliverableTask(id);
      state.setData((prev) => (prev ? { ...prev, tasks: prev.tasks.filter((t) => t.id !== id) } : prev));
      setRemovingTask(null);
    } catch (err) {
      setRemoveError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const groups = groupByCategory(deliverables, categories);
  // Categories with nothing filed yet still need somewhere to add the first heading.
  const emptyCategories = canEdit ? categories.filter((c) => !deliverables.some((d) => d.category_id === c.id)) : [];

  return (
    <div className="space-y-5">
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      {!state.data && !state.error ? (
        <SkeletonRows rows={4} />
      ) : !state.data ? null : groups.length === 0 && emptyCategories.length === 0 ? (
        <EmptyState
          eyebrow={`Deliverables ${year}`}
          title={canEdit ? "Set up the first category" : "Nothing set yet"}
          body={
            canEdit
              ? "Group deliverables the way the company thinks about them, then add the headings and the tasks underneath."
              : "Your manager sets these up with you."
          }
        />
      ) : (
        <>
          {groups.map((group) => {
            const score = scoreCategory(group.deliverables, tasks);
            return (
              <section key={group.categoryId ?? "uncategorized"} className="rounded-md border border-line">
                <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-2/50 px-4 py-2.5">
                  <p className={eyebrowClass}>{group.name}</p>
                  <Figure actual={score.actual} target={score.target} hit={score.hit} />
                </header>
                <div className="divide-y divide-line">
                  {group.deliverables.map((deliverable) => {
                    const own = tasksFor(deliverable.id);
                    const figure = scoreDeliverable(own);
                    return (
                      <div key={deliverable.id} className="px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-[220px] flex-1">
                            {canEdit ? (
                              <BlurInput
                                value={deliverable.name}
                                required
                                ariaLabel={`Deliverable ${deliverable.name}`}
                                onSave={(next) => void saveDeliverable(deliverable, { name: next.trim() })}
                                className={`${inputClass} mt-0 font-medium`}
                              />
                            ) : (
                              <p className="text-sm font-medium text-ink">{deliverable.name}</p>
                            )}
                          </div>
                          <Figure actual={figure.actual} target={figure.target} hit={figure.hit} />
                          {canEdit ? (
                            <IconButton label={`Remove ${deliverable.name}`} onClick={() => setRemoving(deliverable)}>
                              <Trash2 size={14} aria-hidden />
                            </IconButton>
                          ) : null}
                        </div>

                        {own.length === 0 && !canEdit ? (
                          <p className="mt-2 text-[12.5px] text-ink-3">No tasks yet.</p>
                        ) : (
                          <ul className="mt-2 divide-y divide-line border-t border-line pt-2">
                            {own.map((task) => (
                              <TaskRow
                                key={task.id}
                                task={task}
                                canEdit={canEdit}
                                onSave={(patch) => void saveTask(task, patch)}
                                onRemove={() => setRemovingTask(task)}
                              />
                            ))}
                          </ul>
                        )}

                        {canEdit ? (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              void addTask(deliverable.id);
                            }}
                            className="mt-2 flex flex-wrap gap-2"
                          >
                            <input
                              type="text"
                              value={newTask[deliverable.id] ?? ""}
                              onChange={(e) => setNewTask((prev) => ({ ...prev, [deliverable.id]: e.target.value }))}
                              placeholder="Add a task"
                              aria-label={`Add a task to ${deliverable.name}`}
                              className={`${inputClass} mt-0 max-w-md flex-1 text-[13px]`}
                            />
                            <Button type="submit" variant="secondary" size="sm" disabled={adding || !(newTask[deliverable.id] ?? "").trim()}>
                              <Plus size={13} aria-hidden /> Add task
                            </Button>
                          </form>
                        ) : null}
                      </div>
                    );
                  })}

                  {canEdit && group.categoryId ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void addDeliverable(group.categoryId!);
                      }}
                      className="flex flex-wrap gap-2 px-4 py-3"
                    >
                      <input
                        type="text"
                        value={newDeliverable[group.categoryId] ?? ""}
                        onChange={(e) => setNewDeliverable((prev) => ({ ...prev, [group.categoryId!]: e.target.value }))}
                        placeholder={`Add a deliverable to ${group.name}`}
                        aria-label={`Add a deliverable to ${group.name}`}
                        className={`${inputClass} mt-0 max-w-md flex-1`}
                      />
                      <Button type="submit" variant="secondary" size="sm" disabled={adding || !(newDeliverable[group.categoryId] ?? "").trim()}>
                        <Plus size={13} aria-hidden /> Add deliverable
                      </Button>
                    </form>
                  ) : null}
                </div>
              </section>
            );
          })}

          {emptyCategories.map((category) => (
            <section key={category.id} className="rounded-md border border-line">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-2/50 px-4 py-2.5">
                <p className={eyebrowClass}>{category.name}</p>
                <span className="text-[12px] text-ink-3">Nothing here yet</span>
              </header>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void addDeliverable(category.id);
                }}
                className="flex flex-wrap gap-2 px-4 py-3"
              >
                <input
                  type="text"
                  value={newDeliverable[category.id] ?? ""}
                  onChange={(e) => setNewDeliverable((prev) => ({ ...prev, [category.id]: e.target.value }))}
                  placeholder={`Add a deliverable to ${category.name}`}
                  aria-label={`Add a deliverable to ${category.name}`}
                  className={`${inputClass} mt-0 max-w-md flex-1`}
                />
                <Button type="submit" variant="secondary" size="sm" disabled={adding || !(newDeliverable[category.id] ?? "").trim()}>
                  <Plus size={13} aria-hidden /> Add deliverable
                </Button>
              </form>
            </section>
          ))}
        </>
      )}

      {canEdit && state.data ? (
        <form onSubmit={addCategory} className="flex flex-wrap gap-2">
          <input
            type="text"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            placeholder="Add a category (Sales & Mktg., Production)"
            aria-label="Add a deliverable category"
            className={`${inputClass} mt-0 max-w-sm flex-1`}
          />
          <Button type="submit" variant="secondary" size="sm" disabled={adding || !newCategory.trim()}>
            <Plus size={13} aria-hidden /> Add category
          </Button>
        </form>
      ) : null}

      {removing ? (
        <ConfirmDialog
          title={`Remove "${removing.name}"?`}
          body="Its tasks and their ratings go with it."
          confirmLabel="Remove deliverable"
          busy={busy}
          error={removeError}
          onConfirm={() => void handleRemoveDeliverable()}
          onCancel={() => { setRemoving(null); setRemoveError(""); }}
        />
      ) : null}
      {removingTask ? (
        <ConfirmDialog
          title={`Remove "${removingTask.name}"?`}
          body="Its rating and note go with it, and the deliverable's target drops by two points."
          confirmLabel="Remove task"
          busy={busy}
          error={removeError}
          onConfirm={() => void handleRemoveTask()}
          onCancel={() => { setRemovingTask(null); setRemoveError(""); }}
        />
      ) : null}
    </div>
  );
}
