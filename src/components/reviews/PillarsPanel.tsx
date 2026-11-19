// How this company scores people, for Reviews, Setup: pillars, their weights and scoring type, the
// criteria a rating pillar rates, and on a Monthly GSRs pillar how many goals each GSR requires,
// shown as text with a link to where it is set (GSRs, Setup). The pillars are a short list, one
// line each (number, name, scoring type, weight); one opens at a time and shows its fields as
// text until a pencil opens them. Name, weight and the rest still save on blur. Weights should
// total 100; the panel shows the running total and the scoring engine normalizes either way. The
// monthly focus topics are planned in GSRs, Setup, which is where the GSR pillar's note points.
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus } from "lucide-react";
import Badge from "../ui/Badge.tsx";
import BlurInput from "../ui/BlurInput.tsx";
import Button from "../ui/Button.tsx";
import ConfirmDialog from "../ui/ConfirmDialog.tsx";
import EditRow from "../ui/EditRow.tsx";
import Notice from "../ui/Notice.tsx";
import PanelHeader from "../ui/PanelHeader.tsx";
import SkeletonRows from "../ui/SkeletonRows.tsx";
import { checkboxClass, inputClass, labelClass, selectClass } from "../ui/forms.ts";
import { bodyClass, eyebrowLabelClass, itemTitleClass, metaClass, secondaryClass } from "../ui/type.ts";
import PillarCriteria from "./PillarCriteria.tsx";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import {
  createCriterion,
  createPillar,
  deleteCriterion,
  deletePillar,
  listCriteria,
  listPillars,
  updateCriterion,
  updatePillar,
} from "../../services/gsr.ts";
import { weightTotal } from "../../lib/gsr/scoring.ts";
import { errorMessage } from "../../lib/errors.ts";
import { formatNumber, pluralize } from "../../lib/format.ts";
import { SCORING_TYPE_LABELS, keysOf, type GsrCriterion, type GsrPillar, type ScoringType } from "../../types/database.ts";

type PillarPatch = Parameters<typeof updatePillar>[1];
type PillarField = "name" | "weight" | "scoring" | "scale" | "description" | "status";

// A small labelled value, the read side of a setup row.
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <p className={eyebrowLabelClass}>{label}</p>
      <div className={`${bodyClass} mt-0.5 break-words`}>{children}</div>
    </>
  );
}

// An open pillar: its fields as text until their pencil, its criteria or its scoring note, and
// its own actions (Move up, Move down, Delete pillar) at the foot, away from the fields.
function OpenPillar({
  pillar,
  index,
  count,
  criteria,
  addingCriterion,
  onPatch,
  onMove,
  onDelete,
  onAddCriterion,
  onPatchCriterion,
  onDeleteCriterion,
}: {
  pillar: GsrPillar;
  index: number;
  count: number;
  criteria: GsrCriterion[];
  addingCriterion: boolean;
  onPatch: (patch: PillarPatch) => Promise<boolean>;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
  onAddCriterion: (name: string) => Promise<boolean>;
  onPatchCriterion: (criterion: GsrCriterion, patch: Partial<Pick<GsrCriterion, "name" | "description" | "is_active">>) => Promise<boolean>;
  onDeleteCriterion: (criterion: GsrCriterion) => void;
}) {
  const [editing, setEditing] = useState<PillarField | null>(null);
  // A defensive guard for a state the current UI does not reach: opening the Scoring row already
  // replaces an open scale row. If the scoring type ever changes while the scale is open, the
  // scale closes, so switching back to Rating shows it as text rather than mid-edit. Adjusted
  // while rendering, on the change itself, rather than in an effect.
  const [seenScoring, setSeenScoring] = useState(pillar.scoring_type);
  if (seenScoring !== pillar.scoring_type) {
    setSeenScoring(pillar.scoring_type);
    if (pillar.scoring_type !== "rating" && editing === "scale") setEditing(null);
  }
  // A weight outside 0 to 100 is refused where it was typed, and the box shows the stored weight.
  // The message stays until that box is used again, and focus clears it. Without that it sat under
  // a valid number: a box left at the stored weight never saves (BlurInput), so nothing else did.
  const [weightError, setWeightError] = useState("");

  const row = (field: PillarField, editLabel: string, display: ReactNode, form: ReactNode) => (
    <EditRow
      editLabel={editLabel}
      editing={editing === field}
      onEdit={() => setEditing(field)}
      onDone={() => {
        if (field === "weight") setWeightError("");
        setEditing(null);
      }}
      display={display}
    >
      {form}
    </EditRow>
  );

  // Returns false to decline the draft, which puts the stored weight back in the box.
  function saveWeight(next: string): false | Promise<boolean> {
    const text = next.trim();
    const value = Number(text);
    if (!text || !Number.isFinite(value) || value < 0 || value > 100) {
      setWeightError("Enter a weight from 0 to 100.");
      return false;
    }
    setWeightError("");
    return onPatch({ weight: value });
  }

  const footNeedsRule = pillar.scoring_type === "gsr_goals" || (pillar.scoring_type === "rating" && criteria.length === 0);

  return (
    <div className="border-t border-line px-4 pb-5 pt-1 sm:px-6">
      {row(
        "name",
        "Edit name",
        <Fact label="Name">{pillar.name}</Fact>,
        <>
          <label htmlFor={`pillar-name-${pillar.id}`} className={labelClass}>Name</label>
          <BlurInput id={`pillar-name-${pillar.id}`} value={pillar.name} required onSave={(next) => onPatch({ name: next.trim() })} />
        </>,
      )}
      {row(
        "weight",
        "Edit weight",
        <Fact label="Weight"><span className="tnum">{formatNumber(pillar.weight)}%</span></Fact>,
        <div onFocus={() => setWeightError("")}>
          <label htmlFor={`pillar-weight-${pillar.id}`} className={labelClass}>Weight %</label>
          <BlurInput id={`pillar-weight-${pillar.id}`} type="number" value={String(pillar.weight)} className={`${inputClass} tnum`} onSave={saveWeight} />
          {weightError ? <p className="mt-1.5 text-[12px] text-danger" role="alert">{weightError}</p> : null}
        </div>,
      )}
      {row(
        "scoring",
        "Edit scoring",
        <Fact label="Scoring">{SCORING_TYPE_LABELS[pillar.scoring_type]}</Fact>,
        <>
          <label htmlFor={`pillar-type-${pillar.id}`} className={labelClass}>Scoring</label>
          <select id={`pillar-type-${pillar.id}`} value={pillar.scoring_type} onChange={(e) => void onPatch({ scoring_type: e.target.value as ScoringType })} className={selectClass}>
            {keysOf(SCORING_TYPE_LABELS).map((k) => (
              <option key={k} value={k}>{SCORING_TYPE_LABELS[k]}</option>
            ))}
          </select>
        </>,
      )}
      {/* The one setting each scoring type carries of its own: a rating pillar's scale below, or for a
          Monthly GSRs pillar how many goals each GSR requires, which is set on GSRs, Setup. */}
      {pillar.scoring_type === "gsr_goals" ? (
        <div className="border-b border-line py-3">
          <Fact label="Goals each GSR requires">
            <span className="tnum">{pluralize(pillar.required_goals, "goal")} each</span>{" "}
            <Link to="/gsr/setup" className="text-link hover:underline">Change on GSRs, Setup</Link>
          </Fact>
        </div>
      ) : null}
      {pillar.scoring_type === "rating"
        ? row(
            "scale",
            "Edit scale",
            <Fact label="Scale">1 to {pillar.rating_scale_max}</Fact>,
            <>
              <label htmlFor={`pillar-scale-${pillar.id}`} className={labelClass}>Scale (1 to)</label>
              <select id={`pillar-scale-${pillar.id}`} value={pillar.rating_scale_max} onChange={(e) => void onPatch({ rating_scale_max: Number(e.target.value) })} className={selectClass}>
                {[3, 4, 5, 6, 7, 10].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </>,
          )
        : null}
      {row(
        "description",
        "Edit description",
        <Fact label="Description">{pillar.description ? pillar.description : <span className="text-ink-3">None yet.</span>}</Fact>,
        <>
          <label htmlFor={`pillar-description-${pillar.id}`} className={labelClass}>Description</label>
          <BlurInput id={`pillar-description-${pillar.id}`} value={pillar.description ?? ""} placeholder="What this pillar measures, in the company's words" onSave={(next) => onPatch({ description: next.trim() || null })} />
        </>,
      )}
      {row(
        "status",
        "Edit status",
        <Fact label="Status">{pillar.is_active ? "Active, counts toward the score" : "Inactive, left out of the score"}</Fact>,
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={pillar.is_active} onChange={(e) => void onPatch({ is_active: e.target.checked })} className={checkboxClass} /> Active (counts toward the score)
        </label>,
      )}

      {pillar.scoring_type === "gsr_goals" ? (
        <p className={`${secondaryClass} mt-5`}>
          Scored from the Goal Setting Reviews inside each review's period. A month carries {pluralize(pillar.required_goals, "mandatory GSR")}, the focus topic's GSR first and then role and professional goals, and adds up the completion of all its goals up to {pillar.required_goals * 100}%: a stretch goal adds to the total and never lowers it. A month counts once an admin marks its GSR complete, which locks its score in. The months are written into the review as one line item when it is marked complete. Each month's focus topic is planned in{" "}
          <Link to="/gsr/setup" className="text-link hover:underline">GSRs, Setup</Link>.
        </p>
      ) : null}
      {pillar.scoring_type === "rating" ? (
        <PillarCriteria pillar={pillar} criteria={criteria} adding={addingCriterion} onAdd={onAddCriterion} onPatch={onPatchCriterion} onDelete={onDeleteCriterion} />
      ) : null}

      {/* The foot draws its own hairline only after text that has none (the GSR note, or the empty
          criteria line). After a field row or the criteria list the row's own bottom border is the line. */}
      <div className={`flex flex-wrap items-center gap-2 ${footNeedsRule ? "mt-6 border-t border-line pt-4" : "pt-4"}`}>
        <Button variant="secondary" size="sm" disabled={index === 0} onClick={() => onMove(-1)}>
          <ArrowUp size={14} aria-hidden /> Move up
        </Button>
        <Button variant="secondary" size="sm" disabled={index === count - 1} onClick={() => onMove(1)}>
          <ArrowDown size={14} aria-hidden /> Move down
        </Button>
        <Button variant="danger" size="sm" onClick={onDelete}>
          Delete pillar
        </Button>
      </div>
    </div>
  );
}

// The closed row: number, name, scoring type and weight on one line, the chevron at the end. On a
// phone the scoring type and weight stack under the name rather than squeezing it.
function PillarRowHeader({ pillar, index, open, panelId, onToggle }: { pillar: GsrPillar; index: number; open: boolean; panelId: string; onToggle: () => void }) {
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <h3>
      <button
        type="button"
        id={`${panelId}-title`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className="grid min-h-11 w-full grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-4 py-3 text-left transition-colors duration-150 hover:bg-surface-2/60 sm:min-h-9 sm:grid-cols-[1.5rem_minmax(0,1fr)_auto_auto] sm:px-6"
      >
        <span className={`${metaClass} tnum`}>{index + 1}</span>
        <span className={`${itemTitleClass} break-words`}>{pillar.name}</span>
        <span className="col-start-2 row-start-2 flex flex-wrap items-center gap-x-3 gap-y-1 sm:col-start-3 sm:row-start-1">
          <span className={metaClass}>{SCORING_TYPE_LABELS[pillar.scoring_type]}</span>
          <span className={`${bodyClass} tnum`}>{formatNumber(pillar.weight)}%</span>
          {pillar.is_active ? null : <Badge>Inactive</Badge>}
        </span>
        <Chevron size={16} aria-hidden className="col-start-3 row-start-1 text-ink-3 sm:col-start-4" />
      </button>
    </h3>
  );
}

export default function PillarsPanel() {
  const { company } = useHub();
  const companyId = company!.id;
  const [error, setError] = useState("");
  // One pillar open at a time, held here: opening another closes it.
  const [openId, setOpenId] = useState<string | null>(null);
  const [deletingPillar, setDeletingPillar] = useState<GsrPillar | null>(null);
  // Deleting a pillar or criterion takes its open ratings with it, so it is confirmed, and the
  // database refuses one that is part of a signed-off review so a finished score never moves.
  // The copy points at the Active tickbox, which is the way to retire one. A refusal reports
  // inside the dialog, which has its own error, cleared whenever a dialog opens, so it never shows
  // an inline save's or another dialog's. A delete already sent cannot be called back, so the
  // dialog waits for the answer rather than closing on Cancel and reporting into the next one.
  const [deletingCriterion, setDeletingCriterion] = useState<GsrCriterion | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState("");
  // An add that is still waiting on the server takes no second click, or a double click files two.
  // Pillars and criteria each have their own flag: the two writes touch different rows and
  // different sort orders, so one being in flight never needs to hold the other.
  const [addingPillar, setAddingPillar] = useState(false);
  const [addingCriterion, setAddingCriterion] = useState(false);

  const state = useAsync(async () => {
    const [pillars, criteria] = await Promise.all([listPillars(companyId, true), listCriteria(companyId, true)]);
    return { pillars, criteria };
  }, [companyId]);

  if (state.error && !state.data) return <Notice tone="error">{state.error}</Notice>;
  if (!state.data) return <SkeletonRows rows={6} />;

  const { pillars, criteria } = state.data;
  const total = weightTotal(pillars);

  const setPillars = (fn: (list: GsrPillar[]) => GsrPillar[]) => state.setData((prev) => (prev ? { ...prev, pillars: fn(prev.pillars) } : prev));
  const setCriteria = (fn: (list: GsrCriterion[]) => GsrCriterion[]) => state.setData((prev) => (prev ? { ...prev, criteria: fn(prev.criteria) } : prev));

  // True when the action landed, false once the panel shows why not, so a field can say which.
  async function run(action: () => Promise<void>): Promise<boolean> {
    setError("");
    try {
      await action();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    }
  }

  async function patchPillar(pillar: GsrPillar, patch: PillarPatch): Promise<boolean> {
    return run(async () => {
      const next = await updatePillar(pillar.id, patch);
      setPillars((list) => list.map((p) => (p.id === next.id ? next : p)));
    });
  }

  async function addPillar() {
    if (addingPillar) return;
    setAddingPillar(true);
    const created = { current: null as GsrPillar | null };
    await run(async () => {
      created.current = await createPillar({
        company_id: companyId,
        name: "New pillar",
        weight: Math.max(0, 100 - total),
        scoring_type: "rating",
        sort_order: pillars.length + 1,
      });
      const made = created.current;
      setPillars((list) => [...list, made]);
    });
    // The new pillar opens, ready to be named.
    if (created.current) setOpenId(created.current.id);
    setAddingPillar(false);
  }

  async function move(pillar: GsrPillar, direction: -1 | 1) {
    const ordered = [...pillars].sort((a, b) => a.sort_order - b.sort_order);
    const index = ordered.findIndex((p) => p.id === pillar.id);
    const other = ordered[index + direction];
    if (!other) return;
    // Two writes: when one lands and the other is refused, what landed is shown and the list is
    // read again, so the screen never keeps an order the database no longer holds.
    const results = await Promise.allSettled([
      updatePillar(pillar.id, { sort_order: index + direction + 1 }),
      updatePillar(other.id, { sort_order: index + 1 }),
    ]);
    const landed = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    setPillars((list) => list.map((p) => landed.find((l) => l.id === p.id) ?? p));
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed) {
      setError(errorMessage(failed.reason));
      state.reload();
    } else {
      setError("");
    }
  }

  // One dialog at a time. Modal keeps Tab inside the dialog, but focus can still be put on a Delete
  // button under the scrim some other way; while a dialog is open, its delete running included, that
  // opens nothing, because the two dialogs share one error and a second would show the first's refusal.
  function openDeletePillar(pillar: GsrPillar) {
    if (busy || deletingPillar || deletingCriterion) return;
    setDialogError("");
    setDeletingPillar(pillar);
  }

  function openDeleteCriterion(criterion: GsrCriterion) {
    if (busy || deletingPillar || deletingCriterion) return;
    setDialogError("");
    setDeletingCriterion(criterion);
  }

  function closeDialogs() {
    if (busy) return;
    setDeletingPillar(null);
    setDeletingCriterion(null);
    setDialogError("");
  }

  async function confirmDelete(action: () => Promise<void>) {
    setBusy(true);
    setDialogError("");
    try {
      await action();
    } catch (err) {
      setDialogError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeletePillar() {
    if (!deletingPillar) return;
    const id = deletingPillar.id;
    await confirmDelete(async () => {
      await deletePillar(id);
      setPillars((list) => list.filter((p) => p.id !== id));
      setCriteria((list) => list.filter((c) => c.pillar_id !== id));
      setOpenId((current) => (current === id ? null : current));
      setDeletingPillar(null);
    });
  }

  // True when the criterion was filed, false once the panel shows why not.
  async function addCriterion(pillar: GsrPillar, name: string): Promise<boolean> {
    if (addingCriterion) return false;
    setAddingCriterion(true);
    const filed = await run(async () => {
      const created = await createCriterion({
        pillar_id: pillar.id,
        company_id: companyId,
        name,
        sort_order: criteria.filter((c) => c.pillar_id === pillar.id).length + 1,
      });
      setCriteria((list) => [...list, created]);
    });
    setAddingCriterion(false);
    return filed;
  }

  async function patchCriterion(criterion: GsrCriterion, patch: Parameters<typeof updateCriterion>[1]): Promise<boolean> {
    return run(async () => {
      const next = await updateCriterion(criterion.id, patch);
      setCriteria((list) => list.map((c) => (c.id === next.id ? next : c)));
    });
  }

  async function removeCriterion() {
    if (!deletingCriterion) return;
    const id = deletingCriterion.id;
    await confirmDelete(async () => {
      await deleteCriterion(id);
      setCriteria((list) => list.filter((c) => c.id !== id));
      setDeletingCriterion(null);
    });
  }

  const sorted = [...pillars].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));

  return (
    <>
      <PanelHeader
        eyebrow="Scoring"
        title="Pillars and weights"
        description="What this company measures in its reviews and how much each pillar counts. Rated pillars score their criteria 1 to N; target-vs-actual pillars score deliverables entered per review."
        actions={
          <>
            <Badge tone={total === 100 ? "success" : "warning"}>Weights total {formatNumber(total)}%</Badge>
            <Button size="sm" disabled={addingPillar} onClick={() => void addPillar()}><Plus size={14} aria-hidden /> Add pillar</Button>
          </>
        }
      />

      {state.error ? <Notice tone="error" className="mb-4">{state.error}</Notice> : null}
      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
      {total !== 100 && pillars.length > 0 ? (
        <Notice tone="warning" className="mb-4">Active pillar weights should add up to 100%. Scores still compute (normalized to the total), but the percentages people see will not match the weights until they do.</Notice>
      ) : null}

      {pillars.length === 0 ? (
        <Notice tone="info">No pillars yet. Add the first one; a typical setup is three or four pillars whose weights add up to 100%.</Notice>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface shadow-xs">
          {sorted.map((pillar, index) => {
            const open = openId === pillar.id;
            const panelId = `pillar-${pillar.id}`;
            return (
              <li key={pillar.id} className={pillar.is_active ? "" : "opacity-70"}>
                <PillarRowHeader pillar={pillar} index={index} open={open} panelId={panelId} onToggle={() => setOpenId(open ? null : pillar.id)} />
                {open ? (
                  <div id={panelId} role="region" aria-labelledby={`${panelId}-title`}>
                    <OpenPillar
                      pillar={pillar}
                      index={index}
                      count={sorted.length}
                      criteria={criteria.filter((c) => c.pillar_id === pillar.id).sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))}
                      addingCriterion={addingCriterion}
                      onPatch={(patch) => patchPillar(pillar, patch)}
                      onMove={(direction) => void move(pillar, direction)}
                      onDelete={() => openDeletePillar(pillar)}
                      onAddCriterion={(name) => addCriterion(pillar, name)}
                      onPatchCriterion={patchCriterion}
                      onDeleteCriterion={openDeleteCriterion}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {deletingPillar ? (
        <ConfirmDialog
          title={`Delete "${deletingPillar.name}"?`}
          body="Its criteria go with it, along with every rating and line item recorded against it on open reviews and people's profiles. A pillar that is part of a signed-off review cannot be deleted, so finished scores never move. To take it out of use, untick Active instead."
          confirmLabel="Delete pillar"
          busy={busy}
          error={dialogError}
          onConfirm={() => void handleDeletePillar()}
          onCancel={closeDialogs}
        />
      ) : null}
      {deletingCriterion ? (
        <ConfirmDialog
          title={`Delete "${deletingCriterion.name}"?`}
          body="Every rating recorded against it on open reviews and people's profiles goes with it. A criterion that is part of a signed-off review cannot be deleted, so finished scores never move. To take it out of use, untick Active instead."
          confirmLabel="Delete criterion"
          busy={busy}
          error={dialogError}
          onConfirm={() => void removeCriterion()}
          onCancel={closeDialogs}
        />
      ) : null}
    </>
  );
}
