// The company's own connections to outside systems, for an admin in Company Settings. Each
// provider is a row: connected or not, which account, since when. Connect sends the admin to
// the provider's own sign-in page and back; Disconnect drops the tokens on the server. Nothing
// here reads a token or calls a provider: that is the connections Edge Function's job.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import Badge from "../ui/Badge.tsx";
import Button from "../ui/Button.tsx";
import Notice from "../ui/Notice.tsx";
import Section from "../ui/Section.tsx";
import { SkeletonRows } from "../ui/Skeleton.tsx";
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

export default function ConnectionsPanel({ companyId }: { companyId: string }) {
  const state = useAsync(() => listConnections(companyId), [companyId]);
  const [params] = useSearchParams();
  const [busy, setBusy] = useState<ConnectionProvider | null>(null);
  const [error, setError] = useState("");
  // The provider sends the browser back here with one of these on the URL.
  const justConnected = params.get("connected") as ConnectionProvider | null;
  const returnedError = params.get("connect_error");

  const rowFor = (provider: ConnectionProvider): CompanyConnection | null => state.data?.find((c) => c.provider === provider) ?? null;

  async function connect(provider: ConnectionProvider) {
    if (busy) return;
    setBusy(provider);
    setError("");
    try {
      const url = await startConnection(companyId, provider, `${window.location.origin}/settings`);
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
      {justConnected && CONNECTION_PROVIDER_LABELS[justConnected] ? <Notice tone="success" className="mb-4">{CONNECTION_PROVIDER_LABELS[justConnected]} is connected.</Notice> : null}
      {returnedError ? <Notice tone="error" className="mb-4">{returnedError}</Notice> : null}
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
