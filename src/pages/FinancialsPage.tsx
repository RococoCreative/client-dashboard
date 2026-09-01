// Financial snapshots: revenue, direct costs, overhead, margins, net, and cash by period.
// Manual entry per period or a CSV upload that maps a spreadsheet export loosely and
// overwrites the same periods on re-upload. Admin-only; employees never see this page.
import { useMemo, useRef, useState, type FormEvent } from "react";
import { Pencil, Plus, Trash2, Upload } from "lucide-react";
import Badge from "../components/ui/Badge.tsx";
import Button from "../components/ui/Button.tsx";
import ConfirmDialog from "../components/ui/ConfirmDialog.tsx";
import EmptyState from "../components/ui/EmptyState.tsx";
import Field from "../components/ui/Field.tsx";
import IconButton from "../components/ui/IconButton.tsx";
import Modal from "../components/ui/Modal.tsx";
import Notice from "../components/ui/Notice.tsx";
import PageHeader from "../components/ui/PageHeader.tsx";
import Section from "../components/ui/Section.tsx";
import Stat from "../components/ui/Stat.tsx";
import { SkeletonRows } from "../components/ui/Skeleton.tsx";
import { inputClass, selectClass, tableClass, tdClass, textareaClass, thClass } from "../components/ui/forms.ts";
import { useHub } from "../context/HubContext.tsx";
import { useAsync } from "../hooks/useAsync.ts";
import { createSnapshot, deleteSnapshot, listSnapshots, updateSnapshot, upsertSnapshots } from "../services/financials.ts";
import { CSV_HEADER_HELP, CSV_SAMPLE, deriveSnapshot, parseSnapshotsCsv, periodLabel, snapPeriodEnd, snapPeriodStart, type CsvImportResult } from "../lib/financials.ts";
import { errorMessage } from "../lib/errors.ts";
import { formatMoney, formatPercent, parseDate, todayIso } from "../lib/format.ts";
import { PERIOD_TYPE_LABELS, keysOf, type FinancialSnapshot, type PeriodType } from "../types/database.ts";

function numberOrNull(raw: string): number | null {
  const text = raw.trim().replace(/[$,\s]/g, "");
  if (text === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function SnapshotDialog({ companyId, snapshot, defaultType, onClose, onSaved }: { companyId: string; snapshot: FinancialSnapshot | null; defaultType: PeriodType; onClose: () => void; onSaved: (s: FinancialSnapshot) => void }) {
  const [type, setType] = useState<PeriodType>(snapshot?.period_type ?? defaultType);
  const [start, setStart] = useState(snapshot?.period_start ?? snapPeriodStart(defaultType, new Date()));
  const [revenue, setRevenue] = useState(snapshot ? String(snapshot.revenue) : "");
  const [cogs, setCogs] = useState(snapshot ? String(snapshot.cogs) : "");
  const [opex, setOpex] = useState(snapshot ? String(snapshot.opex) : "");
  const [net, setNet] = useState(snapshot?.net_profit === null || snapshot?.net_profit === undefined ? "" : String(snapshot.net_profit));
  const [cash, setCash] = useState(snapshot?.cash_on_hand === null || snapshot?.cash_on_hand === undefined ? "" : String(snapshot.cash_on_hand));
  const [notes, setNotes] = useState(snapshot?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const preview = deriveSnapshot({ revenue: numberOrNull(revenue) ?? 0, cogs: numberOrNull(cogs) ?? 0, opex: numberOrNull(opex) ?? 0, net_profit: numberOrNull(net) });

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const revenueValue = numberOrNull(revenue);
    if (revenueValue === null) return setError("Enter the revenue for the period.");
    const startDate = parseDate(start);
    if (!startDate) return setError("Pick the period.");
    const snapped = snapPeriodStart(type, startDate);
    setBusy(true);
    setError("");
    try {
      const payload = {
        period_type: type,
        period_start: snapped,
        period_end: snapPeriodEnd(type, snapped),
        revenue: revenueValue,
        cogs: numberOrNull(cogs) ?? 0,
        opex: numberOrNull(opex) ?? 0,
        net_profit: numberOrNull(net),
        cash_on_hand: numberOrNull(cash),
        notes: notes.trim() || null,
      };
      onSaved(snapshot ? await updateSnapshot(snapshot.id, payload) : await createSnapshot({ company_id: companyId, source: "manual", ...payload }));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} labelledBy="snapshot-title" size="lg">
      <form onSubmit={handleSubmit} className="p-6">
        <h2 id="snapshot-title" className="font-display text-lg text-heading">{snapshot ? `Edit ${periodLabel(snapshot.period_type, snapshot.period_start)}` : "Add a period"}</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Period type" htmlFor="fs-type">
            <select id="fs-type" value={type} disabled={Boolean(snapshot)} onChange={(e) => setType(e.target.value as PeriodType)} className={selectClass}>
              {keysOf(PERIOD_TYPE_LABELS).map((k) => (
                <option key={k} value={k}>{PERIOD_TYPE_LABELS[k]}</option>
              ))}
            </select>
          </Field>
          <Field label="Period" htmlFor="fs-start" hint="Any day in the period; it snaps to the period start.">
            <input id="fs-start" type="date" value={start} disabled={Boolean(snapshot)} max={todayIso()} onChange={(e) => setStart(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Revenue" htmlFor="fs-revenue">
            <input id="fs-revenue" type="text" inputMode="decimal" value={revenue} autoFocus onChange={(e) => setRevenue(e.target.value)} placeholder="412000" className={`${inputClass} tnum`} />
          </Field>
          <Field label="Direct costs (COGS)" htmlFor="fs-cogs">
            <input id="fs-cogs" type="text" inputMode="decimal" value={cogs} onChange={(e) => setCogs(e.target.value)} placeholder="268000" className={`${inputClass} tnum`} />
          </Field>
          <Field label="Overhead (operating expenses)" htmlFor="fs-opex">
            <input id="fs-opex" type="text" inputMode="decimal" value={opex} onChange={(e) => setOpex(e.target.value)} placeholder="96000" className={`${inputClass} tnum`} />
          </Field>
          <Field label="Net profit (optional override)" htmlFor="fs-net" hint={`Computed: ${formatMoney(preview.net)} (${formatPercent(preview.netMargin, 1)} net margin).`}>
            <input id="fs-net" type="text" inputMode="decimal" value={net} onChange={(e) => setNet(e.target.value)} placeholder="Leave blank to compute" className={`${inputClass} tnum`} />
          </Field>
          <Field label="Cash on hand (optional)" htmlFor="fs-cash">
            <input id="fs-cash" type="text" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} className={`${inputClass} tnum`} />
          </Field>
          <Field label="Notes" htmlFor="fs-notes" className="sm:col-span-2">
            <textarea id="fs-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className={`${textareaClass} min-h-[64px]`} rows={2} />
          </Field>
        </div>
        {error ? <Notice tone="error" className="mt-4">{error}</Notice> : null}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving..." : "Save period"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function ImportDialog({ companyId, onClose, onImported }: { companyId: string; onClose: () => void; onImported: () => void }) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<CsvImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  function update(next: string) {
    setText(next);
    setParsed(next.trim() ? parseSnapshotsCsv(next) : null);
  }

  async function handleFile(file: File) {
    update(await file.text());
  }

  async function handleImport() {
    if (!parsed || parsed.rows.length === 0 || busy) return;
    setBusy(true);
    setError("");
    try {
      await upsertSnapshots(parsed.rows.map((row) => ({ company_id: companyId, source: "csv" as const, ...row })));
      onImported();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} labelledBy="import-title" size="xl">
      <div className="p-6">
        <h2 id="import-title" className="font-display text-lg text-heading">Import from CSV</h2>
        <p className="mt-1 text-[13px] text-ink-2">{CSV_HEADER_HELP} Periods already in the hub are overwritten by the file.</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input ref={fileInput} type="file" accept=".csv,text/csv" className="hidden" aria-label="Choose CSV file" onChange={(e) => { const file = e.target.files?.[0]; if (file) void handleFile(file); }} />
          <Button variant="secondary" size="sm" onClick={() => fileInput.current?.click()}><Upload size={14} aria-hidden /> Choose file</Button>
          <Button variant="ghost" size="sm" onClick={() => update(CSV_SAMPLE)}>Load a sample</Button>
        </div>
        <textarea value={text} onChange={(e) => update(e.target.value)} aria-label="CSV text" placeholder="Or paste the rows here" className={`${textareaClass} mt-3 min-h-[120px] font-mono text-[12px]`} />
        {parsed ? (
          <div className="mt-4">
            {parsed.errors.length > 0 ? (
              <Notice tone="warning" className="mb-3">
                <ul className="list-disc pl-4">
                  {parsed.errors.slice(0, 8).map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </Notice>
            ) : null}
            {parsed.rows.length > 0 ? (
              <div className="overflow-x-auto rounded-md border border-line">
                <table className={tableClass}>
                  <thead>
                    <tr>
                      <th className={thClass}>Period</th>
                      <th className={`${thClass} text-right`}>Revenue</th>
                      <th className={`${thClass} text-right`}>Direct costs</th>
                      <th className={`${thClass} text-right`}>Overhead</th>
                      <th className={`${thClass} text-right`}>Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.map((row) => {
                      const d = deriveSnapshot(row);
                      return (
                        <tr key={`${row.period_type}-${row.period_start}`}>
                          <td className={tdClass}>{periodLabel(row.period_type, row.period_start)}</td>
                          <td className={`${tdClass} tnum text-right`}>{formatMoney(row.revenue)}</td>
                          <td className={`${tdClass} tnum text-right`}>{formatMoney(row.cogs)}</td>
                          <td className={`${tdClass} tnum text-right`}>{formatMoney(row.opex)}</td>
                          <td className={`${tdClass} tnum text-right`}>{formatMoney(d.net)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-ink-3">No usable rows yet.</p>
            )}
          </div>
        ) : null}
        {error ? <Notice tone="error" className="mt-4">{error}</Notice> : null}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void handleImport()} disabled={busy || !parsed || parsed.rows.length === 0}>
            {busy ? "Importing..." : `Import ${parsed?.rows.length ?? 0} ${parsed?.rows.length === 1 ? "period" : "periods"}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// Revenue as bars with net profit as a thinner bar inside, oldest to newest.
function TrendBars({ rows }: { rows: FinancialSnapshot[] }) {
  const max = Math.max(1, ...rows.map((r) => r.revenue));
  return (
    <div className="flex items-end gap-2" role="img" aria-label="Revenue and net profit by period">
      {rows.map((row) => {
        const d = deriveSnapshot(row);
        const revenueHeight = Math.max(2, (row.revenue / max) * 100);
        const netHeight = Math.max(0, (Math.max(d.net, 0) / max) * 100);
        return (
          <div key={row.id} className="flex flex-1 flex-col items-center gap-1" title={`${periodLabel(row.period_type, row.period_start)}: ${formatMoney(row.revenue)} revenue, ${formatMoney(d.net)} net`}>
            {/* Fixed height so the percentage bars have something definite to resolve against. */}
            <div className="relative flex h-28 w-full items-end justify-center">
              <div className="w-full rounded-t-sm bg-accent/25" style={{ height: `${revenueHeight}%` }} />
              <div className={`absolute bottom-0 w-1/2 rounded-t-sm ${d.net >= 0 ? "bg-success" : "bg-danger"}`} style={{ height: `${netHeight}%` }} />
            </div>
            <span className="text-[10px] text-ink-3">{periodLabel(row.period_type, row.period_start).replace(/ 20\d\d$/, "")}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function FinancialsPage() {
  const { company } = useHub();
  const companyId = company!.id;
  const [type, setType] = useState<PeriodType>("month");
  const [dialog, setDialog] = useState<{ snapshot: FinancialSnapshot | null } | null>(null);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState<FinancialSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const state = useAsync(() => listSnapshots(companyId), [companyId]);

  const all = state.data ?? [];
  const rows = useMemo(() => all.filter((s) => s.period_type === type).sort((a, b) => b.period_start.localeCompare(a.period_start)), [all, type]);
  const latest = rows[0] ?? null;
  const latestDerived = latest ? deriveSnapshot(latest) : null;
  const trend = [...rows].slice(0, 12).reverse();

  async function handleDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteSnapshot(deleting.id);
      state.setData((prev) => (prev ? prev.filter((s) => s.id !== deleting.id) : prev));
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
        title="Financials"
        description="Revenue, costs, margins, and net by period. Enter the numbers or upload the export; QuickBooks sync comes later."
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setImporting(true)}><Upload size={14} aria-hidden /> Import CSV</Button>
            <Button size="sm" onClick={() => setDialog({ snapshot: null })}><Plus size={14} aria-hidden /> Add period</Button>
          </>
        }
      />
      <div className="mb-5 flex flex-wrap gap-1.5">
        {keysOf(PERIOD_TYPE_LABELS).map((key) => {
          const count = all.filter((s) => s.period_type === key).length;
          return (
            <button key={key} type="button" onClick={() => setType(key)} className={`rounded-full border px-3 py-1 text-[12px] transition-colors duration-150 ${type === key ? "border-accent bg-accent/10 text-accent" : "border-line bg-surface text-ink-2 hover:border-line-strong"}`}>
              {PERIOD_TYPE_LABELS[key]} {count > 0 ? <span className="tnum text-ink-3">({count})</span> : null}
            </button>
          );
        })}
      </div>
      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
      {state.error ? <Notice tone="error" className="mb-4">{state.error}</Notice> : null}

      {!state.data && !state.error ? (
        <SkeletonRows rows={6} />
      ) : rows.length === 0 ? (
        <EmptyState
          eyebrow="Financials"
          title={`No ${PERIOD_TYPE_LABELS[type].toLowerCase()} snapshots yet`}
          body="Add the first period by hand or import a spreadsheet export. Revenue, direct costs, and overhead are enough to start."
          action={<Button onClick={() => setDialog({ snapshot: null })}>Add period</Button>}
        />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={`Revenue · ${periodLabel(latest!.period_type, latest!.period_start)}`} value={formatMoney(latest!.revenue)} hint={latest!.source === "csv" ? "From CSV import" : "Entered by hand"} />
            <Stat label="Gross margin" value={formatPercent(latestDerived!.grossMargin, 1)} hint={`${formatMoney(latestDerived!.grossProfit)} gross profit`} />
            <Stat label="Net profit" value={<span className={latestDerived!.net >= 0 ? "text-success" : "text-danger"}>{formatMoney(latestDerived!.net)}</span>} hint={`${formatPercent(latestDerived!.netMargin, 1)} net margin`} />
            <Stat label="Cash on hand" value={formatMoney(latest!.cash_on_hand)} hint={latest!.cash_on_hand === null ? "Not recorded" : "End of period"} />
          </div>

          {trend.length > 1 ? (
            <Section eyebrow="Trend" title={`Revenue and net, last ${trend.length} ${PERIOD_TYPE_LABELS[type].toLowerCase().replace("ly", "")} periods`}>
              <TrendBars rows={trend} />
              <p className="mt-3 text-[12px] text-ink-3">Wide bars are revenue; the narrow bar inside is net profit.</p>
            </Section>
          ) : null}

          <Section eyebrow="By period" title={PERIOD_TYPE_LABELS[type]} padded={false}>
            <div className="overflow-x-auto">
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th className={thClass}>Period</th>
                    <th className={`${thClass} text-right`}>Revenue</th>
                    <th className={`${thClass} text-right`}>Direct costs</th>
                    <th className={`${thClass} text-right`}>Overhead</th>
                    <th className={`${thClass} text-right`}>Gross margin</th>
                    <th className={`${thClass} text-right`}>Net profit</th>
                    <th className={`${thClass} text-right`}>Net margin</th>
                    <th className={`${thClass} text-right`}>Cash</th>
                    <th className={thClass}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const d = deriveSnapshot(row);
                    return (
                      <tr key={row.id} className="hover:bg-surface-2/60">
                        <td className={tdClass}>
                          <span className="font-medium">{periodLabel(row.period_type, row.period_start)}</span>
                          {row.notes ? <span className="block max-w-xs truncate text-[12px] text-ink-3">{row.notes}</span> : null}
                        </td>
                        <td className={`${tdClass} tnum text-right`}>{formatMoney(row.revenue)}</td>
                        <td className={`${tdClass} tnum text-right text-ink-2`}>{formatMoney(row.cogs)}</td>
                        <td className={`${tdClass} tnum text-right text-ink-2`}>{formatMoney(row.opex)}</td>
                        <td className={`${tdClass} tnum text-right`}>{formatPercent(d.grossMargin, 1)}</td>
                        <td className={`${tdClass} tnum text-right font-medium ${d.net >= 0 ? "text-success" : "text-danger"}`}>{formatMoney(d.net)}</td>
                        <td className={`${tdClass} tnum text-right`}>{formatPercent(d.netMargin, 1)}</td>
                        <td className={`${tdClass} tnum text-right text-ink-2`}>{formatMoney(row.cash_on_hand)}</td>
                        <td className={`${tdClass} text-right`}>
                          <span className="inline-flex items-center gap-1">
                            {row.source !== "manual" ? <Badge>{row.source === "csv" ? "CSV" : "QuickBooks"}</Badge> : null}
                            <IconButton label="Edit period" onClick={() => setDialog({ snapshot: row })}><Pencil size={13} aria-hidden /></IconButton>
                            <IconButton label="Delete period" onClick={() => setDeleting(row)}><Trash2 size={13} aria-hidden /></IconButton>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        </div>
      )}

      {dialog ? (
        <SnapshotDialog
          companyId={companyId}
          snapshot={dialog.snapshot}
          defaultType={type}
          onClose={() => setDialog(null)}
          onSaved={(saved) => {
            state.setData((prev) => {
              const list = prev ?? [];
              return list.some((s) => s.id === saved.id) ? list.map((s) => (s.id === saved.id ? saved : s)) : [saved, ...list];
            });
            setType(saved.period_type);
            setDialog(null);
          }}
        />
      ) : null}
      {importing ? (
        <ImportDialog
          companyId={companyId}
          onClose={() => setImporting(false)}
          onImported={() => {
            setImporting(false);
            state.reload();
          }}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog title={`Delete ${periodLabel(deleting.period_type, deleting.period_start)}?`} body="The period's figures are removed. Re-importing the CSV brings them back." confirmLabel="Delete period" busy={busy} onConfirm={() => void handleDelete()} onCancel={() => setDeleting(null)} />
      ) : null}
    </>
  );
}
