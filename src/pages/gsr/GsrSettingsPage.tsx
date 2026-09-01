// How this company scores people: pillars, their weights and scoring type, and the criteria
// a rating pillar rates. Everything edits in place and saves on blur. Weights should total
// 100; the page shows the running total and the scoring engine normalizes either way.
import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import Badge from "../../components/ui/Badge.tsx";
import BlurInput from "../../components/ui/BlurInput.tsx";
import Button from "../../components/ui/Button.tsx";
import ConfirmDialog from "../../components/ui/ConfirmDialog.tsx";
import IconButton from "../../components/ui/IconButton.tsx";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import Section from "../../components/ui/Section.tsx";
import { SkeletonRows } from "../../components/ui/Skeleton.tsx";
import { checkboxClass, inputClass, labelClass, selectClass } from "../../components/ui/forms.ts";
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
import { formatNumber } from "../../lib/format.ts";
import { SCORING_TYPE_LABELS, keysOf, type GsrCriterion, type GsrPillar, type ScoringType } from "../../types/database.ts";

export default function GsrSettingsPage() {
  const { company } = useHub();
  const companyId = company!.id;
  const [error, setError] = useState("");
  const [deletingPillar, setDeletingPillar] = useState<GsrPillar | null>(null);
  const [busy, setBusy] = useState(false);
  const [newCriterion, setNewCriterion] = useState<Record<string, string>>({});

  const state = useAsync(async () => {
    const [pillars, criteria] = await Promise.all([listPillars(companyId, true), listCriteria(companyId, true)]);
    return { pillars, criteria };
  }, [companyId]);

  if (state.error) return <Notice tone="error">{state.error}</Notice>;
  if (!state.data) return <SkeletonRows rows={6} />;

  const { pillars, criteria } = state.data;
  const total = weightTotal(pillars);

  const setPillars = (fn: (list: GsrPillar[]) => GsrPillar[]) => state.setData((prev) => (prev ? { ...prev, pillars: fn(prev.pillars) } : prev));
  const setCriteria = (fn: (list: GsrCriterion[]) => GsrCriterion[]) => state.setData((prev) => (prev ? { ...prev, criteria: fn(prev.criteria) } : prev));

  async function run(action: () => Promise<void>) {
    setError("");
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function patchPillar(pillar: GsrPillar, patch: Parameters<typeof updatePillar>[1]) {
    await run(async () => {
      const next = await updatePillar(pillar.id, patch);
      setPillars((list) => list.map((p) => (p.id === next.id ? next : p)));
    });
  }

  async function addPillar() {
    await run(async () => {
      const created = await createPillar({
        company_id: companyId,
        name: "New pillar",
        weight: Math.max(0, 100 - total),
        scoring_type: "rating",
        sort_order: pillars.length + 1,
      });
      setPillars((list) => [...list, created]);
    });
  }

  async function move(pillar: GsrPillar, direction: -1 | 1) {
    const ordered = [...pillars].sort((a, b) => a.sort_order - b.sort_order);
    const index = ordered.findIndex((p) => p.id === pillar.id);
    const other = ordered[index + direction];
    if (!other) return;
    await run(async () => {
      const [a, b] = await Promise.all([
        updatePillar(pillar.id, { sort_order: index + direction + 1 }),
        updatePillar(other.id, { sort_order: index + 1 }),
      ]);
      setPillars((list) => list.map((p) => (p.id === a.id ? a : p.id === b.id ? b : p)));
    });
  }

  async function handleDeletePillar() {
    if (!deletingPillar) return;
    setBusy(true);
    await run(async () => {
      await deletePillar(deletingPillar.id);
      setPillars((list) => list.filter((p) => p.id !== deletingPillar.id));
      setCriteria((list) => list.filter((c) => c.pillar_id !== deletingPillar.id));
      setDeletingPillar(null);
    });
    setBusy(false);
  }

  async function addCriterion(pillar: GsrPillar) {
    const name = (newCriterion[pillar.id] ?? "").trim();
    if (!name) return;
    await run(async () => {
      const created = await createCriterion({
        pillar_id: pillar.id,
        company_id: companyId,
        name,
        sort_order: criteria.filter((c) => c.pillar_id === pillar.id).length + 1,
      });
      setCriteria((list) => [...list, created]);
      setNewCriterion((prev) => ({ ...prev, [pillar.id]: "" }));
    });
  }

  async function patchCriterion(criterion: GsrCriterion, patch: Parameters<typeof updateCriterion>[1]) {
    await run(async () => {
      const next = await updateCriterion(criterion.id, patch);
      setCriteria((list) => list.map((c) => (c.id === next.id ? next : c)));
    });
  }

  async function removeCriterion(criterion: GsrCriterion) {
    await run(async () => {
      await deleteCriterion(criterion.id);
      setCriteria((list) => list.filter((c) => c.id !== criterion.id));
    });
  }

  const sorted = [...pillars].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));

  return (
    <>
      <PageHeader
        backTo="/gsr"
        backLabel="Review cycles"
        eyebrow="GSR settings"
        title="Pillars and weights"
        description="Define what this company measures and how much each pillar counts. Rated pillars score their criteria 1 to N; target-vs-actual pillars score deliverables entered per review."
        actions={
          <>
            <Badge tone={total === 100 ? "success" : "warning"}>Weights total {formatNumber(total)}%</Badge>
            <Button size="sm" onClick={() => void addPillar()}><Plus size={14} aria-hidden /> Add pillar</Button>
          </>
        }
      />

      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
      {total !== 100 && pillars.length > 0 ? (
        <Notice tone="warning" className="mb-4">Active pillar weights should add up to 100%. Scores still compute (normalized to the total), but the percentages people see will not match the weights until they do.</Notice>
      ) : null}

      <div className="space-y-4">
        {sorted.map((pillar, index) => {
          const pillarCriteria = criteria.filter((c) => c.pillar_id === pillar.id).sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
          return (
            <Section
              key={pillar.id}
              className={pillar.is_active ? "" : "opacity-70"}
              eyebrow={`Pillar ${index + 1}${pillar.is_active ? "" : " · inactive"}`}
              title={pillar.name}
              actions={
                <>
                  <IconButton label="Move up" disabled={index === 0} onClick={() => void move(pillar, -1)}><ArrowUp size={14} aria-hidden /></IconButton>
                  <IconButton label="Move down" disabled={index === sorted.length - 1} onClick={() => void move(pillar, 1)}><ArrowDown size={14} aria-hidden /></IconButton>
                  <IconButton label="Delete pillar" onClick={() => setDeletingPillar(pillar)}><Trash2 size={14} aria-hidden /></IconButton>
                </>
              }
            >
              <div className="grid gap-4 md:grid-cols-12">
                <div className="md:col-span-5">
                  <label htmlFor={`pillar-name-${pillar.id}`} className={labelClass}>Name</label>
                  <BlurInput id={`pillar-name-${pillar.id}`} value={pillar.name} onSave={(next) => next.trim() && void patchPillar(pillar, { name: next.trim() })} />
                </div>
                <div className="md:col-span-2">
                  <label htmlFor={`pillar-weight-${pillar.id}`} className={labelClass}>Weight %</label>
                  <BlurInput id={`pillar-weight-${pillar.id}`} type="number" value={String(pillar.weight)} className={`${inputClass} tnum`} onSave={(next) => {
                    const value = Number(next);
                    if (Number.isFinite(value) && value >= 0 && value <= 100) void patchPillar(pillar, { weight: value });
                  }} />
                </div>
                <div className="md:col-span-3">
                  <label htmlFor={`pillar-type-${pillar.id}`} className={labelClass}>Scoring</label>
                  <select id={`pillar-type-${pillar.id}`} value={pillar.scoring_type} onChange={(e) => void patchPillar(pillar, { scoring_type: e.target.value as ScoringType })} className={selectClass}>
                    {keysOf(SCORING_TYPE_LABELS).map((k) => (
                      <option key={k} value={k}>{SCORING_TYPE_LABELS[k]}</option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label htmlFor={`pillar-scale-${pillar.id}`} className={labelClass}>Scale (1 to)</label>
                  <select id={`pillar-scale-${pillar.id}`} value={pillar.rating_scale_max} disabled={pillar.scoring_type !== "rating"} onChange={(e) => void patchPillar(pillar, { rating_scale_max: Number(e.target.value) })} className={selectClass}>
                    {[3, 4, 5, 6, 7, 10].map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-12">
                  <label htmlFor={`pillar-description-${pillar.id}`} className={labelClass}>Description</label>
                  <BlurInput id={`pillar-description-${pillar.id}`} value={pillar.description ?? ""} placeholder="What this pillar measures, in the company's words" onSave={(next) => void patchPillar(pillar, { description: next.trim() || null })} />
                </div>
                <div className="md:col-span-12">
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input type="checkbox" checked={pillar.is_active} onChange={(e) => void patchPillar(pillar, { is_active: e.target.checked })} className={checkboxClass} /> Active (counts toward the score)
                  </label>
                </div>
              </div>

              {pillar.scoring_type === "rating" ? (
                <div className="mt-5 border-t border-line pt-4">
                  <p className={labelClass}>Criteria rated 1 to {pillar.rating_scale_max}</p>
                  {pillarCriteria.length === 0 ? <p className="mt-2 text-[13px] text-ink-3">Add at least one criterion or reviewers will have nothing to rate.</p> : null}
                  <ul className="mt-2 space-y-2">
                    {pillarCriteria.map((criterion) => (
                      <li key={criterion.id} className="grid gap-2 rounded-md border border-line bg-surface-2/50 p-3 md:grid-cols-12">
                        <div className="md:col-span-4">
                          <BlurInput ariaLabel="Criterion name" value={criterion.name} className={`${inputClass} mt-0`} onSave={(next) => next.trim() && void patchCriterion(criterion, { name: next.trim() })} />
                        </div>
                        <div className="md:col-span-7">
                          <BlurInput ariaLabel="Criterion description" value={criterion.description ?? ""} placeholder="Description shown to the reviewer" className={`${inputClass} mt-0`} onSave={(next) => void patchCriterion(criterion, { description: next.trim() || null })} />
                        </div>
                        <div className="flex items-center justify-end md:col-span-1">
                          <IconButton label="Delete criterion" onClick={() => void removeCriterion(criterion)}><Trash2 size={14} aria-hidden /></IconButton>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void addCriterion(pillar);
                    }}
                    className="mt-3 flex gap-2"
                  >
                    <input type="text" value={newCriterion[pillar.id] ?? ""} onChange={(e) => setNewCriterion((prev) => ({ ...prev, [pillar.id]: e.target.value }))} placeholder="New criterion" aria-label={`New criterion for ${pillar.name}`} className={`${inputClass} mt-0 max-w-sm`} />
                    <Button type="submit" variant="secondary" size="sm" disabled={!(newCriterion[pillar.id] ?? "").trim()}><Plus size={13} aria-hidden /> Add criterion</Button>
                  </form>
                </div>
              ) : null}
            </Section>
          );
        })}
        {pillars.length === 0 ? (
          <Notice tone="info">No pillars yet. Add the first one; a typical setup is three or four pillars whose weights add up to 100%.</Notice>
        ) : null}
      </div>

      {deletingPillar ? (
        <ConfirmDialog
          title={`Delete "${deletingPillar.name}"?`}
          body="Every score ever recorded against this pillar is deleted with it. To retire a pillar without losing history, untick Active instead."
          confirmLabel="Delete pillar"
          busy={busy}
          onConfirm={() => void handleDeletePillar()}
          onCancel={() => setDeletingPillar(null)}
        />
      ) : null}
    </>
  );
}
