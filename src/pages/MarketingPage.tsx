// Marketing campaign tracker: a board of what is planned, running, paused, and done, with
// budget vs actual spend and the key result for each. A tracking surface, not a marketing
// platform. Admin-only. With the tasks module on, each campaign also shows the work behind it
// (CampaignTasks), from one read of the company's tasks grouped here by campaign.
import { useState, type FormEvent, type ReactNode } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import CampaignTasks from "../components/tasks/CampaignTasks.tsx";
import Badge from "../components/ui/Badge.tsx";
import Button from "../components/ui/Button.tsx";
import ConfirmDialog from "../components/ui/ConfirmDialog.tsx";
import EmptyState from "../components/ui/EmptyState.tsx";
import Field from "../components/ui/Field.tsx";
import IconButton from "../components/ui/IconButton.tsx";
import Modal from "../components/ui/Modal.tsx";
import Notice from "../components/ui/Notice.tsx";
import PageHeader from "../components/ui/PageHeader.tsx";
import Stat from "../components/ui/Stat.tsx";
import SkeletonCard from "../components/ui/SkeletonCard.tsx";
import { inputClass, selectClass, textareaClass } from "../components/ui/forms.ts";
import { useHub } from "../context/HubContext.tsx";
import { useAsync } from "../hooks/useAsync.ts";
import { createCampaign, deleteCampaign, listCampaigns, updateCampaign } from "../services/marketing.ts";
import { listCompanyProfiles } from "../services/profiles.ts";
import { listTasks } from "../services/tasks.ts";
import { CAMPAIGN_STATUS_TONE } from "../components/status.ts";
import { errorMessage } from "../lib/errors.ts";
import { formatDate, formatMoney, formatNumber, formatPercent, moneyFieldError, parseMoney, pluralize, todayIso } from "../lib/format.ts";
import { liveCampaignTotals } from "../lib/marketing.ts";
import { hasModule } from "../lib/modules.ts";
import { CAMPAIGN_CHANNELS, CAMPAIGN_STATUS_LABELS, keysOf, type CampaignStatus, type MarketingCampaign, type TaskWithSteps } from "../types/database.ts";

type NumberField = "budget" | "spend" | "metricValue";

// How a field message names each number, and the example it offers to type.
const NUMBER_COPY: Record<NumberField, { label: string; example: string }> = {
  budget: { label: "the budget", example: "12000" },
  spend: { label: "the actual spend", example: "7400" },
  metricValue: { label: "the key metric value", example: "27" },
};

function CampaignDialog({ companyId, campaign, count, onClose, onSaved }: { companyId: string; campaign: MarketingCampaign | null; count: number; onClose: () => void; onSaved: (c: MarketingCampaign) => void }) {
  const [name, setName] = useState(campaign?.name ?? "");
  const [channel, setChannel] = useState(campaign?.channel ?? "");
  const [status, setStatus] = useState<CampaignStatus>(campaign?.status ?? "planned");
  const [start, setStart] = useState(campaign?.start_date ?? "");
  const [end, setEnd] = useState(campaign?.end_date ?? "");
  const [budget, setBudget] = useState(campaign?.budget === null || campaign?.budget === undefined ? "" : String(campaign.budget));
  const [spend, setSpend] = useState(campaign?.actual_spend === null || campaign?.actual_spend === undefined ? "" : String(campaign.actual_spend));
  const [goal, setGoal] = useState(campaign?.goal ?? "");
  const [metricLabel, setMetricLabel] = useState(campaign?.key_metric_label ?? "");
  const [metricValue, setMetricValue] = useState(campaign?.key_metric_value === null || campaign?.key_metric_value === undefined ? "" : String(campaign.key_metric_value));
  const [results, setResults] = useState(campaign?.results ?? "");
  const [notes, setNotes] = useState(campaign?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<NumberField, string>>>({});

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!name.trim()) return setError("Name the campaign.");
    if (start && end && end < start) return setError("The end date must be on or after the start date.");
    // A number that is filled in but will not save is named under its field. Saved as typed it
    // became a blank, and the campaign dropped out of the budget totals with nothing said.
    const values: Record<NumberField, string> = { budget, spend, metricValue };
    const problems: Partial<Record<NumberField, string>> = {};
    for (const key of keysOf(values)) {
      const message = moneyFieldError(NUMBER_COPY[key].label, values[key], NUMBER_COPY[key].example);
      if (message) problems[key] = message;
    }
    setFieldErrors(problems);
    if (Object.keys(problems).length > 0) {
      setError("");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payload = {
        name: name.trim(),
        channel: channel.trim() || null,
        status,
        start_date: start || null,
        end_date: end || null,
        budget: parseMoney(budget),
        actual_spend: parseMoney(spend),
        goal: goal.trim() || null,
        key_metric_label: metricLabel.trim() || null,
        key_metric_value: parseMoney(metricValue),
        results: results.trim() || null,
        notes: notes.trim() || null,
      };
      onSaved(campaign ? await updateCampaign(campaign.id, payload) : await createCampaign({ company_id: companyId, sort_order: count + 1, ...payload }));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} labelledBy="campaign-title" size="lg">
      <form onSubmit={handleSubmit} className="p-6">
        <h2 id="campaign-title" className="font-display text-lg text-heading">{campaign ? "Edit campaign" : "New campaign"}</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Campaign" htmlFor="mc-name" className="sm:col-span-2">
            <input id="mc-name" type="text" value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="Name the campaign" className={inputClass} />
          </Field>
          <Field label="Channel" htmlFor="mc-channel">
            <input id="mc-channel" type="text" list="mc-channels" value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="Google Ads" className={inputClass} />
            <datalist id="mc-channels">
              {CAMPAIGN_CHANNELS.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="Status" htmlFor="mc-status">
            <select id="mc-status" value={status} onChange={(e) => setStatus(e.target.value as CampaignStatus)} className={selectClass}>
              {keysOf(CAMPAIGN_STATUS_LABELS).map((k) => (
                <option key={k} value={k}>{CAMPAIGN_STATUS_LABELS[k]}</option>
              ))}
            </select>
          </Field>
          <Field label="Starts" htmlFor="mc-start">
            <input id="mc-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Ends" htmlFor="mc-end">
            <input id="mc-end" type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Budget" htmlFor="mc-budget" error={fieldErrors.budget}>
            <input id="mc-budget" type="text" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="12000" className={`${inputClass} tnum`} />
          </Field>
          <Field label="Actual spend" htmlFor="mc-spend" error={fieldErrors.spend}>
            <input id="mc-spend" type="text" inputMode="decimal" value={spend} onChange={(e) => setSpend(e.target.value)} placeholder="7400" className={`${inputClass} tnum`} />
          </Field>
          <Field label="Goal" htmlFor="mc-goal" className="sm:col-span-2">
            <input id="mc-goal" type="text" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="40 qualified leads" className={inputClass} />
          </Field>
          <Field label="Key metric" htmlFor="mc-metric-label">
            <input id="mc-metric-label" type="text" value={metricLabel} onChange={(e) => setMetricLabel(e.target.value)} placeholder="Qualified leads" className={inputClass} />
          </Field>
          <Field label="Key metric value" htmlFor="mc-metric-value" error={fieldErrors.metricValue}>
            <input id="mc-metric-value" type="text" inputMode="decimal" value={metricValue} onChange={(e) => setMetricValue(e.target.value)} placeholder="27" className={`${inputClass} tnum`} />
          </Field>
          <Field label="Results so far" htmlFor="mc-results" className="sm:col-span-2">
            <textarea id="mc-results" value={results} onChange={(e) => setResults(e.target.value)} className={`${textareaClass} min-h-[64px]`} rows={2} />
          </Field>
          <Field label="Notes" htmlFor="mc-notes" className="sm:col-span-2">
            <textarea id="mc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className={`${textareaClass} min-h-[56px]`} rows={2} />
          </Field>
        </div>
        {error ? <Notice tone="error" className="mt-4">{error}</Notice> : null}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving..." : campaign ? "Save" : "Add campaign"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function CampaignCard({ campaign, footer, onEdit, onDelete, onStatus }: { campaign: MarketingCampaign; footer: ReactNode; onEdit: () => void; onDelete: () => void; onStatus: (status: CampaignStatus) => void }) {
  const budget = campaign.budget ?? 0;
  const spend = campaign.actual_spend ?? 0;
  const ratio = budget > 0 ? spend / budget : null;
  const over = ratio !== null && ratio > 1;
  return (
    <li className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-ink">{campaign.name}</h3>
          <p className="mt-0.5 text-[12px] text-ink-3">
            {campaign.channel ?? "No channel"}
            {campaign.start_date ? ` · ${formatDate(campaign.start_date)}${campaign.end_date ? ` to ${formatDate(campaign.end_date)}` : " onward"}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center">
          <IconButton label="Edit campaign" onClick={onEdit}><Pencil size={13} aria-hidden /></IconButton>
          <IconButton label="Delete campaign" onClick={onDelete}><Trash2 size={13} aria-hidden /></IconButton>
        </div>
      </div>
      <div className="mt-3">
        <div className="flex items-baseline justify-between text-[12px]">
          <span className="text-ink-2">Spend</span>
          <span className={`tnum ${over ? "text-danger" : "text-ink"}`}>
            {formatMoney(spend)} {budget > 0 ? `of ${formatMoney(budget)}` : ""}
            {ratio !== null ? ` (${formatPercent(ratio)})` : ""}
          </span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className={`h-full rounded-full ${over ? "bg-danger" : "bg-accent"}`} style={{ width: `${Math.min((ratio ?? 0) * 100, 100)}%` }} />
        </div>
      </div>
      {campaign.goal ? <p className="mt-3 text-[13px] text-ink-2"><span className="text-ink-3">Goal:</span> {campaign.goal}</p> : null}
      {campaign.key_metric_label ? (
        <p className="mt-1 text-[13px] text-ink-2">
          <span className="text-ink-3">{campaign.key_metric_label}:</span>{" "}
          <span className="tnum font-medium text-ink">{campaign.key_metric_value === null ? "-" : formatNumber(campaign.key_metric_value)}</span>
        </p>
      ) : null}
      {campaign.results ? <p className="mt-2 text-[13px] leading-relaxed text-ink">{campaign.results}</p> : null}
      <div className="mt-3 flex items-center justify-between gap-2">
        <Badge tone={CAMPAIGN_STATUS_TONE[campaign.status]}>{CAMPAIGN_STATUS_LABELS[campaign.status]}</Badge>
        <select value={campaign.status} aria-label={`Move ${campaign.name}`} onChange={(e) => onStatus(e.target.value as CampaignStatus)} className={`${selectClass} mt-0 w-auto py-1 text-[12px]`}>
          {keysOf(CAMPAIGN_STATUS_LABELS).map((k) => (
            <option key={k} value={k}>{CAMPAIGN_STATUS_LABELS[k]}</option>
          ))}
        </select>
      </div>
      {footer}
    </li>
  );
}

export default function MarketingPage() {
  const { company, profile } = useHub();
  const companyId = company!.id;
  const tasksOn = hasModule(company, "tasks");
  const [dialog, setDialog] = useState<{ campaign: MarketingCampaign | null } | null>(null);
  const [deleting, setDeleting] = useState<MarketingCampaign | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const state = useAsync(() => listCampaigns(companyId), [companyId]);
  // Every task, open and done, read once for the whole board; nothing is asked without the module.
  const taskState = useAsync(async () => {
    if (!tasksOn) return null;
    const [tasks, people] = await Promise.all([listTasks(companyId, { status: "all" }), listCompanyProfiles(companyId)]);
    return { tasks, people };
  }, [companyId, tasksOn]);

  const campaigns = state.data ?? [];
  // Budget and spend over the same live campaigns, with the unbudgeted counted apart: the one
  // reading the dashboard and the Rococo portfolio share.
  const { live, unbudgeted, budget: totalBudget, spend: totalSpend } = liveCampaignTotals(campaigns);
  // Each campaign's tasks at the foot of its card, once the tasks are in.
  const tasksByCampaign = new Map<string, TaskWithSteps[]>();
  for (const task of taskState.data?.tasks ?? []) {
    if (task.campaign_id) tasksByCampaign.set(task.campaign_id, [...(tasksByCampaign.get(task.campaign_id) ?? []), task]);
  }
  const today = todayIso();
  const taskFooter = (campaign: MarketingCampaign) =>
    taskState.data ? (
      <CampaignTasks
        companyId={companyId}
        campaign={campaign}
        campaigns={campaigns}
        tasks={tasksByCampaign.get(campaign.id) ?? []}
        people={taskState.data.people}
        viewerProfileId={profile.id}
        today={today}
        onCreated={(task) => taskState.setData((prev) => (prev ? { ...prev, tasks: [...prev.tasks, task] } : prev))}
      />
    ) : null;

  function upsert(saved: MarketingCampaign) {
    state.setData((prev) => {
      const list = prev ?? [];
      return list.some((c) => c.id === saved.id) ? list.map((c) => (c.id === saved.id ? saved : c)) : [...list, saved];
    });
  }

  async function move(campaign: MarketingCampaign, status: CampaignStatus) {
    setError("");
    try {
      upsert(await updateCampaign(campaign.id, { status }));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteCampaign(deleting.id);
      state.setData((prev) => (prev ? prev.filter((c) => c.id !== deleting.id) : prev));
      setDeleting(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={company!.name}
        title="Marketing"
        description="What is running, what is planned, budget against spend, and the result that matters for each."
        actions={<Button size="sm" onClick={() => setDialog({ campaign: null })}><Plus size={14} aria-hidden /> New campaign</Button>}
      />
      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
      {state.error ? <Notice tone="error" className="mb-4">{state.error}</Notice> : null}
      {taskState.error ? <Notice tone="error" className="mb-4">{taskState.error}</Notice> : null}

      {!state.data && !state.error ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
      ) : !state.data ? null : campaigns.length === 0 ? (
        <EmptyState eyebrow="Marketing" title="No campaigns yet" body="Add what is running or planned so leadership sees the whole board at a glance." action={<Button onClick={() => setDialog({ campaign: null })}>New campaign</Button>} />
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <Stat label="Live campaigns" value={live.length} hint={`${campaigns.filter((c) => c.status === "planned").length} planned`} />
            <Stat
              label="Live budget"
              value={formatMoney(totalBudget)}
              hint={unbudgeted > 0 ? `${pluralize(unbudgeted, "campaign")} with no budget set` : "Active and paused campaigns"}
            />
            <Stat label="Live spend" value={<span className={totalBudget > 0 && totalSpend > totalBudget ? "text-danger" : ""}>{formatMoney(totalSpend)}</span>} hint={totalBudget > 0 ? `${formatPercent(totalSpend / totalBudget)} of budget` : "No budget set"} />
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {keysOf(CAMPAIGN_STATUS_LABELS).map((status) => {
              const column = campaigns.filter((c) => c.status === status).sort((a, b) => a.sort_order - b.sort_order);
              return (
                <section key={status} className="min-w-0 rounded-lg border border-line bg-bg/40 p-3">
                  <header className="mb-3 flex items-center justify-between px-1">
                    <h2 className="text-[11px] font-medium uppercase tracking-label text-ink-3">{CAMPAIGN_STATUS_LABELS[status]}</h2>
                    <span className="tnum text-[11px] text-ink-3">{column.length}</span>
                  </header>
                  {column.length === 0 ? (
                    <p className="px-1 text-[12px] text-ink-3">Nothing here.</p>
                  ) : (
                    <ul className="space-y-3">
                      {column.map((campaign) => (
                        <CampaignCard key={campaign.id} campaign={campaign} footer={taskFooter(campaign)} onEdit={() => setDialog({ campaign })} onDelete={() => setDeleting(campaign)} onStatus={(next) => void move(campaign, next)} />
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}

      {dialog ? (
        <CampaignDialog
          companyId={companyId}
          campaign={dialog.campaign}
          count={campaigns.length}
          onClose={() => setDialog(null)}
          onSaved={(saved) => {
            upsert(saved);
            setDialog(null);
          }}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog title={`Delete "${deleting.name}"?`} body="The campaign and its results are removed from the board. Mark it complete instead to keep the record." confirmLabel="Delete campaign" busy={busy} error={error} onConfirm={() => void handleDelete()} onCancel={() => setDeleting(null)} />
      ) : null}
    </>
  );
}
