// What a card on the Connections catalog opens. For a tool the company signs in to, it is the
// detail of the company's one connection: the stored error first when there is one, then the
// account, who connected it, since when, when the hub last read it, that it is read only, and what
// it feeds, with the reminder that a leaver's account breaks it for everyone. Disconnect is always
// here for a connection that is on or in error, and asks once more before it goes. Reconnect shows
// only when it can run; otherwise the line saying why takes its place, from the same rule the
// cards use (cardView). For a links tool (Monday), it is the links editor from Resources, limited
// to that tool.
import { useId, useState, type ReactNode } from "react";
import Button from "../ui/Button.tsx";
import Modal from "../ui/Modal.tsx";
import Notice from "../ui/Notice.tsx";
import Skeleton from "../ui/Skeleton.tsx";
import { eyebrowLabelClass, metaClass, metaSizeClass, secondaryClass, sectionTitleClass } from "../ui/type.ts";
import ConnectPanel from "./ConnectPanel.tsx";
import ExternalLinksPanel from "../links/ExternalLinksPanel.tsx";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { disconnectConnection } from "../../services/connections.ts";
import { listDirectory } from "../../services/directory.ts";
import { cardView, type CardView, type Connector } from "../../lib/connectors.ts";
import { errorMessage } from "../../lib/errors.ts";
import { displayName, formatDate } from "../../lib/format.ts";
import { hasModule } from "../../lib/modules.ts";
import type { Company, CompanyConnection } from "../../types/database.ts";

const NOT_ON_PEOPLE = "someone not on the People list";
const NOT_KNOWN = "Not known right now";

// The meta line in the danger colour: the size and leading come from the type scale, the colour is named here.
const DANGER_LINE = `${metaSizeClass} text-danger`;

// One label and its value in the panel's list of facts.
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-3 py-2">
      <dt className={eyebrowLabelClass}>{label}</dt>
      <dd className="min-w-0 text-[13px] leading-relaxed text-ink [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

// Who connected the account. The signed-in person is named from their own profile, by the app's
// display name (their email when the name is blank): a Rococo admin who connected it for the
// company is not in the company directory, which leaves Rococo staff out. Anyone else is named from
// the directory, and a person who is not in it, or a connection with no one recorded, reads
// "someone not on the People list". When the directory could not be read, nobody can tell, so it
// says "Not known right now" rather than claim the person is not listed.
function useConnectedBy(companyId: string, profileId: string | null): { name: string | null; loading: boolean; unknown: boolean } {
  const { profile } = useHub();
  const ownName = profileId !== null && profileId === profile.id ? displayName(profile) : null;
  const directory = useAsync(() => (profileId && !ownName ? listDirectory(companyId) : Promise.resolve([])), [companyId, profileId, ownName]);
  if (ownName) return { name: ownName, loading: false, unknown: false };
  if (!profileId) return { name: null, loading: false, unknown: false };
  if (!directory.data) return { name: null, loading: !directory.error, unknown: Boolean(directory.error) };
  const entry = directory.data.find((d) => d.id === profileId);
  return { name: entry?.full_name?.trim() || null, loading: false, unknown: false };
}

function LinksBody({ company, connector, onClose }: { company: Company; connector: Connector; onClose: () => void }) {
  const titleId = useId();
  return (
    <Modal onClose={onClose} labelledBy={titleId} size="xl">
      <div className="p-6">
        <h2 id={titleId} className={sectionTitleClass}>{`${connector.name} links`}</h2>
        <p className={`mt-1 ${secondaryClass}`}>{`The company's ${connector.name} boards. Each shows on Home for whoever it is for; a category other than General also puts it on that section's page. People still sign in to ${connector.name} themselves.`}</p>
        <div className="mt-5">
          <ExternalLinksPanel companyId={company.id} onlyProvider={connector.linkProvider} />
        </div>
        <div className="mt-6 flex justify-end">
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}

function ConnectionBody({
  company,
  connector,
  row,
  view,
  keysIn,
  onClose,
  onChanged,
  onReconnect,
}: {
  company: Company;
  connector: Connector;
  row: CompanyConnection;
  view: CardView;
  keysIn: boolean | null;
  onClose: () => void;
  onChanged: () => void;
  onReconnect: () => void;
}) {
  const titleId = useId();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const connectedBy = useConnectedBy(company.id, row.connected_by);

  // Reconnect runs on the same terms as on a card in error: the module on and Rococo's keys not
  // known to be missing. cardView already says so for a card in error; for a connected card it is
  // asked as if the row were in error, so the rule stays in one place.
  const asError = view.state === "needs_attention" ? view : cardView(connector, { row: { ...row, status: "error" }, hasModule: (m) => hasModule(company, m), keysIn, linkCount: 0 });
  const canReconnect = asError.action === "reconnect";

  async function disconnect() {
    if (busy || !connector.provider) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await disconnectConnection(company.id, connector.provider);
      onChanged();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setArmed(false);
      setBusy(false);
    }
  }

  const close = () => {
    if (!busy) onClose();
  };
  const firstName = connectedBy.name?.split(/\s+/)[0] ?? null;
  const account = row.external_account_name ?? "Not recorded";
  const feeds = connector.feeds ?? [];

  return (
    <Modal onClose={close} labelledBy={titleId}>
      <div className="p-6">
        <h2 id={titleId} className={sectionTitleClass}>{connector.name}</h2>
        {row.status === "error" && row.last_error ? <p className={`mt-2 ${DANGER_LINE}`}>{row.last_error}</p> : null}
        <dl className="mt-3 divide-y divide-line border-y border-line">
          <Fact label="Account">{account}</Fact>
          <Fact label="Connected by">
            {connectedBy.loading ? <Skeleton className="h-4 w-32" /> : connectedBy.unknown ? NOT_KNOWN : connectedBy.name ?? NOT_ON_PEOPLE}
          </Fact>
          <Fact label="Since">{row.connected_at ? formatDate(row.connected_at) : "Not recorded"}</Fact>
          <Fact label="Last read">{row.last_synced_at ? formatDate(row.last_synced_at) : "Not read yet"}</Fact>
          <Fact label="Access">Read only</Fact>
          {feeds.length > 0 ? (
            <Fact label="Feeds">
              <ul className="space-y-0.5">
                {feeds.map((feed) => <li key={feed}>{feed}</li>)}
              </ul>
            </Fact>
          ) : null}
        </dl>
        <p className={`mt-4 ${secondaryClass}`}>
          {`Connected once for everyone at ${company.name}. If ${firstName ?? "the person who connected it"} leaves or loses access to this account, reconnect with an account the company keeps.`}
        </p>
        {!canReconnect && asError.blocked ? <p className={`mt-2 ${metaClass}`}>{asError.blocked}</p> : null}
        {error ? <Notice tone="error" className="mt-4">{error}</Notice> : null}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="danger" onClick={() => void disconnect()} disabled={busy}>
              {busy ? "Disconnecting..." : armed ? `Disconnect for everyone at ${company.name}` : "Disconnect"}
            </Button>
            {armed && !busy ? <Button variant="ghost" onClick={() => setArmed(false)}>Keep it</Button> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={close} disabled={busy}>Close</Button>
            {canReconnect ? <Button onClick={onReconnect} disabled={busy}>Reconnect</Button> : null}
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default function ConnectorPanel({
  company,
  connector,
  row,
  view,
  keysIn = null,
  onClose,
  onChanged,
}: {
  company: Company;
  connector: Connector;
  /** The company's connection row for a sign-in tool; null for a links tool. */
  row: CompanyConnection | null;
  view: CardView;
  /** Whether Rococo's keys for this tool are in; null when that could not be told. */
  keysIn?: boolean | null;
  onClose: () => void;
  /** After a change the catalog should reload for: a Disconnect. */
  onChanged: () => void;
}) {
  // Reconnect hands over to the step before the provider's sign-in; Cancel there comes back here.
  const [signingIn, setSigningIn] = useState(false);
  if (connector.how === "links") return <LinksBody company={company} connector={connector} onClose={onClose} />;
  if (!row) return null;
  if (signingIn) return <ConnectPanel company={company} connector={connector} onClose={() => setSigningIn(false)} />;
  return <ConnectionBody company={company} connector={connector} row={row} view={view} keysIn={keysIn} onClose={onClose} onChanged={onChanged} onReconnect={() => setSigningIn(true)} />;
}
