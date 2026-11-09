// The company's own connections to outside systems, for an admin in Company Settings. Each
// provider is a row: connected or not, which account, since when. Connect sends the admin to
// the provider's own sign-in page and back; Disconnect drops the tokens on the server. Nothing
// here reads a token or calls a provider: that is the connections Edge Function's job.
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Badge from "../ui/Badge.tsx";
import Button from "../ui/Button.tsx";
import Notice from "../ui/Notice.tsx";
import Section from "../ui/Section.tsx";
import SkeletonRows from "../ui/SkeletonRows.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { disconnectConnection, listConnections, startConnection } from "../../services/connections.ts";
import { errorMessage } from "../../lib/errors.ts";
import { formatDate } from "../../lib/format.ts";
import { CONNECTION_PROVIDER_LABELS, keysOf, type CompanyConnection, type ConnectionProvider } from "../../types/database.ts";

// What each provider feeds, in the company's terms. Industry neutral; the figures themselves
// are the company's own rows.
const PROVIDER_BLURBS: Record<ConnectionProvider, string> = {
  gohighlevel: "Closed sales, for the company and for each person, from won opportunities.",
  quickbooks: "Revenue, costs, profit and cash for the company; revenue per person where the books tag it.",
};

// The fixed lines the connections Edge Function puts on connect_error, word for word, kept in step
// with supabase/functions/connections/index.ts. Anything else on the address was written by
// someone other than that function, a hand-made link for instance, so it is never shown in the
// app's own voice.
const KNOWN_CONNECT_ERRORS = new Set([
  "The sign-in was cancelled or refused. Nothing changed.",
  "This sign-in link was already used or has expired. Start the connection again.",
  "GoHighLevel is not set up yet. Ask Rococo Creative to add the app keys.",
  "QuickBooks Online is not set up yet. Ask Rococo Creative to add the app keys.",
  "The GoHighLevel sign-in was refused by the provider.",
  "The GoHighLevel sign-in returned something unexpected.",
  "The QuickBooks sign-in was refused by the provider.",
  "The QuickBooks sign-in returned something unexpected.",
  "Choose one sub-account when installing; an agency-wide install is not supported.",
  "QuickBooks did not say which company was connected.",
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

export default function ConnectionsPanel({ companyId }: { companyId: string }) {
  const state = useAsync(() => listConnections(companyId), [companyId]);
  const [params, setParams] = useSearchParams();
  const [busy, setBusy] = useState<ConnectionProvider | null>(null);
  const [error, setError] = useState("");
  // The provider sends the browser back here with the outcome on the address. It is read once, on
  // arrival, and then taken off the address, so a reload does not report it again and a later
  // Disconnect is not contradicted by "is connected" above a row that says otherwise.
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

  const rowFor = (provider: ConnectionProvider): CompanyConnection | null => state.data?.find((c) => c.provider === provider) ?? null;
  // Anyone can put ?connected= on a link, so "is connected" is said only once the loaded row for
  // that provider reads connected too. Until the rows load, and over a row that says otherwise, it
  // says nothing: the row itself is the truth.
  const shown = outcome && (outcome.tone === "error" || rowFor(outcome.provider)?.status === "connected") ? outcome : null;

  async function connect(provider: ConnectionProvider) {
    if (busy) return;
    setBusy(provider);
    setError("");
    setOutcome(null);
    try {
      // The trip to the provider is a full page load, and the company a Rococo admin stepped into
      // lives only in this session's memory, so the way back names the company (App.tsx).
      const url = await startConnection(companyId, provider, `${window.location.origin}/settings/connections/${companyId}`);
      window.location.assign(url);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  }

  async function disconnect(provider: ConnectionProvider) {
    if (busy) return;
    setBusy(provider);
    setError("");
    setOutcome(null);
    try {
      await disconnectConnection(companyId, provider);
      await state.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section eyebrow="Integrations" title="Connections" description="This company signs in to its own accounts. Tokens stay on the server, and nothing is shared between companies.">
      {shown ? <Notice tone={shown.tone} className="mb-4">{shown.text}</Notice> : null}
      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
      {state.error && !state.data ? <Notice tone="error">{state.error}</Notice> : null}
      {!state.data && !state.error ? <SkeletonRows rows={2} /> : null}
      {state.data ? (
        <ul className="divide-y divide-line">
          {keysOf(CONNECTION_PROVIDER_LABELS).map((provider) => {
            const row = rowFor(provider);
            const connected = row?.status === "connected";
            const label = CONNECTION_PROVIDER_LABELS[provider];
            return (
              <li key={provider} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-ink">{label}</p>
                    <Badge tone={connected ? "success" : row?.status === "error" ? "danger" : "neutral"}>
                      {connected ? "Connected" : row?.status === "error" ? "Needs attention" : "Not connected"}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-[12.5px] text-ink-2">{PROVIDER_BLURBS[provider]}</p>
                  {connected ? (
                    <p className="mt-1 text-[12px] text-ink-3">
                      {row?.external_account_name ?? row?.external_account_id ?? "Account"}
                      {row?.connected_at ? ` · since ${formatDate(row.connected_at)}` : ""}
                      {row?.last_synced_at ? ` · last sync ${formatDate(row.last_synced_at)}` : " · no sync yet"}
                    </p>
                  ) : null}
                  {row?.status === "error" && row.last_error ? <p className="mt-1 text-[12px] text-danger">{row.last_error}</p> : null}
                </div>
                {connected ? (
                  <Button variant="ghost" size="sm" aria-label={`Disconnect ${label}`} disabled={busy !== null} onClick={() => void disconnect(provider)}>
                    {busy === provider ? "Disconnecting..." : "Disconnect"}
                  </Button>
                ) : (
                  <Button variant="secondary" size="sm" aria-label={`Connect ${label}`} disabled={busy !== null} onClick={() => void connect(provider)}>
                    {busy === provider ? "Opening..." : "Connect"}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </Section>
  );
}
