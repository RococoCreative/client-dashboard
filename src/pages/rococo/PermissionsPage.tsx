// Permissions tab of the Rococo portfolio: for each company, the lowest role that holds each
// capability, set from the app instead of in SQL. Every cell is written, then the whole grid is read
// back from the database and drawn from that read, so the page never shows a level the database did
// not return. The database applies a stored level at once (0040, 0041); a person with the hub open
// picks it up when they next return to the tab.
import { useEffect, useRef, useState } from "react";
import Button from "../../components/ui/Button.tsx";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import SkeletonRows from "../../components/ui/SkeletonRows.tsx";
import Tabs from "../../components/ui/Tabs.tsx";
import { selectClass, tableClass, tdClass, thClass } from "../../components/ui/forms.ts";
import { useHub } from "../../context/HubContext.tsx";
import { CAPABILITY_LABELS, LEVEL_LABELS, allowedLevels } from "../../lib/capabilities.ts";
import { errorMessage } from "../../lib/errors.ts";
import {
  clearCompanyCapability,
  listAllCompanyCapabilities,
  listCapabilityCatalog,
  setCompanyCapability,
} from "../../services/capabilities.ts";
import type { Capability, CapabilityKey, CapabilityLevel, Company, CompanyCapability } from "../../types/database.ts";
import { PORTFOLIO_TABS } from "./portfolioTabs.ts";

type Status = { tone: "info" | "success" | "error" | "warning"; text: string; reload?: boolean };

const DEFAULT = "";

// One company's cell: Default, then the levels this capability may take. A stored level outside that
// list is added so nothing the database holds is hidden. The value is always the stored one.
function LevelCell({
  capability,
  company,
  stored,
  busy,
  onChange,
}: {
  capability: CapabilityKey;
  company: Company;
  stored: CapabilityLevel | undefined;
  busy: boolean;
  onChange: (value: string) => void;
}) {
  const levels = allowedLevels(capability);
  if (stored && !levels.includes(stored)) levels.push(stored);
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${stored ? "bg-accent" : "bg-transparent"}`}
      />
      <select
        value={stored ?? DEFAULT}
        disabled={busy}
        data-differs={stored ? "true" : undefined}
        aria-label={`${CAPABILITY_LABELS[capability]} for ${company.name}`}
        onChange={(e) => onChange(e.target.value)}
        className={`${selectClass} mt-0 min-w-[10rem] ${stored ? "border-accent text-accent" : ""}`}
      >
        <option value={DEFAULT}>Default</option>
        {levels.map((level) => (
          <option key={level} value={level}>
            {LEVEL_LABELS[level]}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function PermissionsPage() {
  const { companies } = useHub();
  const [grid, setGrid] = useState<{ catalog: Capability[]; rows: CompanyCapability[] } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const [status, setStatus] = useState<Status | null>(null);
  const catalog = grid?.catalog ?? null;
  const rows = grid?.rows ?? [];
  // Every read, the first one, a focus refresh, Reload and the one after a write, is numbered in the
  // order it was asked for. An answer older than one already shown is dropped, so rows read before a
  // write can never replace rows read after it.
  const askedRef = useRef(0);
  const appliedRef = useRef(0);
  const rowsRef = useRef<CompanyCapability[]>([]);
  const savingRef = useRef(0);
  const mountedRef = useRef(true);

  // Resolves to the rows now on screen, which are the newest answer asked for so far. Throws.
  async function read(): Promise<CompanyCapability[]> {
    const mine = ++askedRef.current;
    const [nextCatalog, nextRows] = await Promise.all([listCapabilityCatalog(), listAllCompanyCapabilities()]);
    if (mountedRef.current && mine > appliedRef.current) {
      appliedRef.current = mine;
      rowsRef.current = nextRows;
      setGrid({ catalog: nextCatalog, rows: nextRows });
      setLoadError("");
    }
    return rowsRef.current;
  }
  const readRef = useRef(read);
  useEffect(() => {
    readRef.current = read;
  });

  useEffect(() => {
    mountedRef.current = true;
    const first = () => {
      readRef.current().catch((err: unknown) => {
        if (mountedRef.current) setLoadError(errorMessage(err));
      });
    };
    // Coming back to the tab reads again, unless a save is mid-flight (its own re-read follows it).
    const back = () => {
      if (document.visibilityState !== "visible" || savingRef.current > 0) return;
      readRef.current().catch(() => undefined);
    };
    void Promise.resolve().then(first);
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => {
      mountedRef.current = false;
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("focus", back);
    };
  }, []);

  function reload() {
    setStatus(null);
    setLoadError("");
    read().catch((err: unknown) => {
      if (mountedRef.current) setLoadError(errorMessage(err));
    });
  }

  function storedFor(source: CompanyCapability[], companyId: string, key: CapabilityKey) {
    return source.find((r) => r.company_id === companyId && r.capability === key)?.min_role;
  }

  async function change(company: Company, key: CapabilityKey, value: string) {
    const cellId = `${company.id}:${key}`;
    if (saving.has(cellId)) return;
    const label = CAPABILITY_LABELS[key];
    const mark = (on: boolean) =>
      setSaving((prev) => {
        const next = new Set(prev);
        if (on) next.add(cellId);
        else next.delete(cellId);
        return next;
      });
    mark(true);
    savingRef.current += 1;
    setStatus({ tone: "info", text: "Saving" });
    try {
      if (value === DEFAULT) await clearCompanyCapability(company.id, key);
      else await setCompanyCapability(company.id, key, value as CapabilityLevel);
    } catch (err) {
      if (!mountedRef.current) return;
      setStatus({ tone: "error", text: errorMessage(err) });
      savingRef.current -= 1;
      mark(false);
      return;
    }
    // The write call came back. What the page shows next, and whether it says Saved, is decided by
    // what the database returns on a fresh read, not by the call having resolved.
    try {
      const next = await read();
      if (!mountedRef.current) return;
      const level = storedFor(next, company.id, key);
      const shownLevel = level ? LEVEL_LABELS[level] : "Default";
      const wanted = value === DEFAULT ? undefined : value;
      setStatus(
        level === wanted
          ? { tone: "success", text: `Saved. ${label} for ${company.name}: ${shownLevel}.` }
          : { tone: "warning", text: `Not changed. ${label} for ${company.name} is still ${shownLevel}.` },
      );
    } catch {
      if (!mountedRef.current) return;
      setStatus({ tone: "warning", text: "The change was saved, but the page could not refresh.", reload: true });
    }
    savingRef.current -= 1;
    mark(false);
  }

  return (
    <>
      <PageHeader
        eyebrow="Rococo Creative"
        title="Permissions"
        description={
          <>
            <span className="block">Each permission is the lowest role that holds it. Default is what every company starts with.</span>
            <span className="mt-1 block">
              The database applies a change at once. A person who already has the hub open sees it when they next return to the tab.
            </span>
          </>
        }
      />
      <Tabs items={PORTFOLIO_TABS} />
      {status && (
        <Notice tone={status.tone} className="mb-4">
          {status.text}
          {status.reload && (
            <Button variant="secondary" className="ml-3" disabled={saving.size > 0} onClick={reload}>
              Reload
            </Button>
          )}
        </Notice>
      )}
      {loadError && (
        <Notice tone="error" className="mb-4">
          {loadError}
          <Button variant="secondary" className="ml-3" disabled={saving.size > 0} onClick={reload}>
            Reload
          </Button>
        </Notice>
      )}
      {!catalog && !loadError && <SkeletonRows rows={7} />}
      {catalog && catalog.length === 0 && <p className="text-sm text-ink-2">No permissions are defined yet.</p>}
      {catalog && catalog.length > 0 && (
        <div className="overflow-x-auto">
          <table className={tableClass}>
            <thead>
              <tr>
                <th scope="col" className={thClass}>Permission</th>
                <th scope="col" className={thClass}>Default</th>
                {companies.map((c) => (
                  <th key={c.id} scope="col" className={thClass}>{c.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {catalog.map((cap) => (
                <tr key={cap.key}>
                  <th scope="row" className={`${tdClass} text-left font-normal`}>{CAPABILITY_LABELS[cap.key]}</th>
                  <td className={`${tdClass} text-ink-2`}>{LEVEL_LABELS[cap.default_min_role]}</td>
                  {companies.map((c) => (
                    <td key={c.id} className={tdClass}>
                      <LevelCell
                        capability={cap.key}
                        company={c}
                        stored={storedFor(rows, c.id, cap.key)}
                        busy={saving.has(`${c.id}:${cap.key}`)}
                        onChange={(value) => void change(c, cap.key, value)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
