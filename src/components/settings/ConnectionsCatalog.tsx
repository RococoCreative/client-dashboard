// Settings > Connections: every outside tool a company might use, in one catalog that is the same
// for every company, grouped by what each tool is for. A card's state comes from the company's own
// connection rows, its modules, its links, its tool requests and whether Rococo's app keys are in,
// all worked out by cardView (lib/connectors.ts). Connect and Reconnect open the step before the
// provider's sign-in (ConnectPanel), which sends the admin there and back; the outcome comes back on
// the address, read here once. Manage opens the card's own panel (ConnectorPanel): the connection's
// detail and its Disconnect, or Monday's links. Nothing here reads a token or calls a provider: that
// is the connections Edge Function's job.
import { useEffect, useId, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import Chip from "../ui/Chip.tsx";
import Notice from "../ui/Notice.tsx";
import Section from "../ui/Section.tsx";
import SkeletonRows from "../ui/SkeletonRows.tsx";
import { inputClass } from "../ui/forms.ts";
import { eyebrowLabelClass, metaClass, sectionTitleClass } from "../ui/type.ts";
import ConnectorCard, { type CardAction } from "./ConnectorCard.tsx";
import ConnectorPanel from "./ConnectorPanel.tsx";
import ConnectPanel from "./ConnectPanel.tsx";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { listConnections, loadConnectorSetup } from "../../services/connections.ts";
import { listConnectorRequests, requestConnector, withdrawConnectorRequest } from "../../services/connectorRequests.ts";
import { listExternalLinks } from "../../services/externalLinks.ts";
import { CARD_STATE_ORDER, CONNECTOR_GROUPS, CONNECTORS, cardView, summaryCounts, type CardView, type Connector, type ConnectorGroup } from "../../lib/connectors.ts";
import { errorMessage } from "../../lib/errors.ts";
import { hasModule } from "../../lib/modules.ts";
import { CONNECTION_PROVIDER_LABELS, keysOf, type Company, type CompanyConnection, type ConnectionProvider, type ConnectorRequest, type ExternalLink, type LinkProvider } from "../../types/database.ts";

// The fixed lines the connections Edge Function puts on connect_error, word for word, kept in step
// with supabase/functions/connections/index.ts. Anything else on the address was written by
// someone other than that function, a hand-made link for instance, so it is never shown in the
// app's own voice.
const KNOWN_CONNECT_ERRORS = new Set([
  "The sign-in was cancelled or refused. Nothing changed.",
  "This sign-in link was already used or has expired. Start the connection again.",
  "GoHighLevel is not set up yet. Ask Rococo Creative to add the app keys.",
  "QuickBooks Online is not set up yet. Ask Rococo Creative to add the app keys.",
  "Google Sheets is not set up yet. Ask Rococo Creative to add the app keys.",
  "The GoHighLevel sign-in was refused by the provider.",
  "The GoHighLevel sign-in returned something unexpected.",
  "The QuickBooks sign-in was refused by the provider.",
  "The QuickBooks sign-in returned something unexpected.",
  "The Google sign-in was refused by the provider.",
  "The Google sign-in returned something unexpected.",
  "Choose one sub-account when installing; an agency-wide install is not supported.",
  "QuickBooks did not say which company was connected.",
  "Google did not say which account was connected. Try again from Settings.",
  "The connection could not be saved.",
  "The connection could not be finished. Try again from Settings.",
]);

// A success names the provider it is about, so it can be checked against that provider's row.
type Outcome = { tone: "success"; text: string; provider: ConnectionProvider } | { tone: "error"; text: string };

// What the provider round trip reported, read off the address it came back to.
function readOutcome(params: URLSearchParams): Outcome | null {
  const connected = params.get("connected");
  if (connected !== null) {
    const provider = keysOf(CONNECTION_PROVIDER_LABELS).find((key) => key === connected);
    return provider ? { tone: "success", text: `${CONNECTION_PROVIDER_LABELS[provider]} is connected.`, provider } : null;
  }
  const returned = params.get("connect_error");
  if (returned === null) return null;
  return { tone: "error", text: KNOWN_CONNECT_ERRORS.has(returned) ? returned : "The connection did not finish. Try again." };
}

// Rococo's side of a tool's setup, for a Rococo admin only. Secret names are not secret, but they
// are Rococo's business, so a company admin never sees this line.
function rococoLineFor(connector: Connector, setup: Record<ConnectionProvider, boolean> | null): string {
  if (connector.availability === "next" || connector.availability === "soon") return "Rococo: not built yet.";
  if (connector.how === "access_key" || connector.how === "links") return "Rococo: nothing to set up.";
  if (!connector.provider || !connector.secretNames) return "Rococo: nothing to set up.";
  if (setup === null) return "Setup status unavailable.";
  if (setup[connector.provider]) return "Rococo: app keys added.";
  const [id, secret] = connector.secretNames;
  return `Rococo: app keys missing. Add ${id} and ${secret}.`;
}

type Filter = "all" | ConnectorGroup | "connected";

const CONNECTED_STATES = new Set<CardView["state"]>(["connected", "needs_attention", "linked"]);

interface CatalogData {
  /** The company these rows are for, so a late answer for another company is never applied. */
  companyId: string;
  connections: CompanyConnection[];
  requests: ConnectorRequest[];
  /** How many of the company's links each link tool has. */
  links: Partial<Record<LinkProvider, number>>;
  setup: Record<ConnectionProvider, boolean> | null;
}

interface Card {
  connector: Connector;
  view: CardView;
  row: CompanyConnection | null;
  keysIn: boolean | null;
  linkCount: number;
  order: number;
}

// The panel a card has open: its detail (or links), or the step before the provider's sign-in.
type OpenPanel = { key: string; kind: "detail" | "connect" };

function countByProvider(links: ExternalLink[]): Partial<Record<LinkProvider, number>> {
  const counts: Partial<Record<LinkProvider, number>> = {};
  for (const link of links) counts[link.provider] = (counts[link.provider] ?? 0) + 1;
  return counts;
}

// The summary strip: three figures, read from the cards themselves.
function Summary({ connected, attention, available }: { connected: number; attention: number; available: number }) {
  const stats: Array<[number, string]> = [[connected, "Connected"], [attention, "Need attention"], [available, "Available"]];
  return (
    <div role="group" aria-label="Summary" className="flex gap-6">
      {stats.map(([value, label]) => (
        <div key={label} className="text-right">
          <p className="tnum font-numeric text-[22px] leading-none text-heading">{value}</p>
          <p className={`mt-1 ${eyebrowLabelClass}`}>{label}</p>
        </div>
      ))}
    </div>
  );
}

// Settings renders this keyed by the company, so a Rococo admin switching company starts it afresh:
// no banner, filter, search or open panel carries over from the company before.
export default function ConnectionsCatalog({ company }: { company: Company }) {
  const { isRococo } = useHub();
  const idPrefix = useId();
  const linksOn = hasModule(company, "external_links");
  // One load for the whole page. The setup check never throws: null means it could not tell, and
  // every live tool is then treated as available, as the page did before the check existed.
  const state = useAsync<CatalogData>(async () => {
    const [connections, requests, links, setup] = await Promise.all([
      listConnections(company.id),
      listConnectorRequests(company.id),
      linksOn ? listExternalLinks(company.id) : Promise.resolve([]),
      loadConnectorSetup(company.id),
    ]);
    return { companyId: company.id, connections, requests, links: countByProvider(links), setup };
  }, [company.id, linksOn]);

  const [params, setParams] = useSearchParams();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [panel, setPanel] = useState<OpenPanel | null>(null);

  // The provider sends the browser back here with the outcome on the address. It is read once, on
  // arrival, and then taken off the address, so a reload does not report it again and a later
  // Disconnect is not contradicted by "is connected" above a card that says otherwise.
  const [outcome, setOutcome] = useState(() => readOutcome(params));
  useEffect(() => {
    if (!params.has("connected") && !params.has("connect_error")) return;
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("connected");
        next.delete("connect_error");
        return next;
      },
      { replace: true },
    );
  }, [params, setParams]);

  const data = state.data;
  const cards = useMemo<Card[] | null>(() => {
    if (!data) return null;
    return CONNECTORS.map((connector, order) => {
      const row = connector.provider ? data.connections.find((c) => c.provider === connector.provider) ?? null : null;
      const keysIn = connector.provider && data.setup !== null ? data.setup[connector.provider] : null;
      const linkCount = connector.linkProvider ? data.links[connector.linkProvider] ?? 0 : 0;
      const view = cardView(connector, { row, hasModule: (m) => hasModule(company, m), keysIn, linkCount });
      return { connector, view, row, keysIn, linkCount, order };
    });
  }, [data, company]);

  const requested = useMemo(() => new Set((data?.requests ?? []).map((r) => r.connector_key)), [data]);

  const rowFor = (provider: ConnectionProvider) => data?.connections.find((c) => c.provider === provider) ?? null;
  // Anyone can put ?connected= on a link, so "is connected" is said only once the loaded row for
  // that provider reads connected too. Until the rows load, and over a row that says otherwise, it
  // says nothing: the row itself is the truth.
  const shown = outcome && (outcome.tone === "error" || rowFor(outcome.provider)?.status === "connected") ? outcome : null;

  // Asking twice keeps one request: the service hands back the stored row either way. A Rococo
  // admin can switch company while the answer is out, so it lands only on the company it is for.
  async function toggleRequest(key: string) {
    const companyId = company.id;
    const forThisCompany = (prev: CatalogData | null): prev is CatalogData => prev !== null && prev.companyId === companyId;
    if (requested.has(key)) {
      await withdrawConnectorRequest(companyId, key);
      state.setData((prev) => (forThisCompany(prev) ? { ...prev, requests: prev.requests.filter((r) => r.connector_key !== key) } : prev));
    } else {
      const row = await requestConnector(companyId, key);
      state.setData((prev) => (forThisCompany(prev) ? { ...prev, requests: [...prev.requests.filter((r) => r.connector_key !== key), row] } : prev));
    }
  }

  async function act(connector: Connector, action: CardAction) {
    if (busy) return;
    if (action === "connect" || action === "reconnect") {
      setPanel({ key: connector.key, kind: "connect" });
      return;
    }
    if (action !== "ask") {
      setPanel({ key: connector.key, kind: "detail" });
      return;
    }
    setBusy(connector.key);
    setError("");
    try {
      await toggleRequest(connector.key);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  // A Disconnect: the return trip's "is connected" no longer holds, and the rows load again.
  function changed() {
    setOutcome(null);
    state.reload();
  }

  // Links change inside Monday's panel, so its card's count is read again when it closes.
  function closePanel(card: Card) {
    setPanel(null);
    if (card.connector.how === "links") state.reload();
  }

  // A connection's detail is only for a row that is on or in error. Should the rows say otherwise
  // after a reload (disconnected from another tab), the panel goes rather than offer a Disconnect
  // of nothing.
  const found = panel && cards ? cards.find((c) => c.connector.key === panel.key) ?? null : null;
  const open = found && (found.connector.how === "links" || panel?.kind === "connect" || found.view.state === "connected" || found.view.state === "needs_attention") ? found : null;

  const needle = query.trim().toLowerCase();
  const visible = (card: Card) =>
    (filter === "all" || filter === "connected" || filter === card.connector.group) &&
    (filter !== "connected" || CONNECTED_STATES.has(card.view.state)) &&
    (!needle || `${card.connector.name} ${card.connector.description}`.toLowerCase().includes(needle));

  const groups = cards
    ? CONNECTOR_GROUPS.map((group) => ({
        group,
        cards: cards
          .filter((card) => card.connector.group === group.key && visible(card))
          .sort((a, b) => CARD_STATE_ORDER[a.view.state] - CARD_STATE_ORDER[b.view.state] || a.order - b.order),
      })).filter((g) => g.cards.length > 0)
    : [];
  const counts = cards ? summaryCounts(cards.map((c) => c.view)) : null;

  const chips: Array<[Filter, string]> = [["all", "All"], ...CONNECTOR_GROUPS.map((g): [Filter, string] => [g.key, g.label]), ["connected", "Connected"]];

  return (
    <Section
      eyebrow="Integrations"
      title="Connections"
      description={`Connect the tools the company already works in. Each tool is connected once for everyone at ${company.name}, and the hub only reads from it. Tokens stay on the server.`}
      actions={counts ? <Summary {...counts} /> : null}
    >
      {shown ? <Notice tone={shown.tone} className="mb-4">{shown.text}</Notice> : null}
      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
      {state.error && !data ? <Notice tone="error">{state.error}</Notice> : null}
      {!data && !state.error ? <SkeletonRows rows={4} /> : null}
      {cards ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] max-w-sm flex-1">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tools" aria-label="Search tools" className={`${inputClass} mt-0 pl-8`} />
            </div>
            <div role="group" aria-label="Filter" className="flex flex-wrap gap-1.5">
              {chips.map(([key, label]) => (
                <Chip key={key} active={filter === key} onClick={() => setFilter(key)}>{label}</Chip>
              ))}
            </div>
          </div>
          {groups.length === 0 ? (
            <p className={`mt-6 rounded-lg border border-dashed border-line-strong px-6 py-8 text-center ${metaClass}`}>
              No tools match. Ask Rococo for the one you use, and it goes on the list.
            </p>
          ) : null}
          {groups.map(({ group, cards: list }) => (
            <section key={group.key} aria-labelledby={`${idPrefix}-${group.key}`} className="mt-6">
              <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <h3 id={`${idPrefix}-${group.key}`} className={sectionTitleClass}>{group.label}</h3>
                <p className={metaClass}>{group.note}</p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {list.map(({ connector, view, row, linkCount }) => (
                  <ConnectorCard
                    key={connector.key}
                    connector={connector}
                    view={view}
                    row={row}
                    requested={requested.has(connector.key)}
                    rococoLine={isRococo ? rococoLineFor(connector, data!.setup) : null}
                    linkCount={linkCount}
                    disabled={busy !== null}
                    onAction={(action) => void act(connector, action)}
                  />
                ))}
              </div>
            </section>
          ))}
        </>
      ) : null}
      {open && panel?.kind === "connect" ? <ConnectPanel company={company} connector={open.connector} onClose={() => setPanel(null)} /> : null}
      {open && panel?.kind === "detail" ? (
        <ConnectorPanel company={company} connector={open.connector} row={open.row} view={open.view} keysIn={open.keysIn} onClose={() => closePanel(open)} onChanged={changed} />
      ) : null}
    </Section>
  );
}
