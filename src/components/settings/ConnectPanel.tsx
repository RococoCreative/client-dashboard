// The step before a provider's sign-in: what happens next, what the hub will read, and the advice
// to sign in with an account the company keeps, because one connection serves everyone and stops
// when the person who made it leaves. Continue asks the connections Edge Function for the sign-in
// address and sends the browser there; the provider sends it back to Settings with the outcome,
// which the catalog reads.
import { useEffect, useId, useState } from "react";
import Button from "../ui/Button.tsx";
import Modal from "../ui/Modal.tsx";
import Notice from "../ui/Notice.tsx";
import { eyebrowLabelClass, secondaryClass, sectionTitleClass } from "../ui/type.ts";
import { startConnection } from "../../services/connections.ts";
import { errorMessage } from "../../lib/errors.ts";
import type { Connector } from "../../lib/connectors.ts";
import type { Company } from "../../types/database.ts";

export default function ConnectPanel({ company, connector, onClose }: { company: Company; connector: Connector; onClose: () => void }) {
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Continue leaves busy set while the browser goes to the provider. Back from there can restore
  // this page from the back-forward cache with that state intact, so a restored page lets go.
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) setBusy(false);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  async function go() {
    const provider = connector.provider;
    if (busy || !provider) return;
    setBusy(true);
    setError("");
    try {
      // The trip to the provider is a full page load, and the company a Rococo admin stepped into
      // lives only in this session's memory, so the way back names the company (App.tsx).
      const url = await startConnection(company.id, provider, `${window.location.origin}/settings/connections/${company.id}`);
      window.location.assign(url);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const { name, feeds = [] } = connector;
  return (
    <Modal onClose={() => (busy ? undefined : onClose())} labelledBy={titleId}>
      <div className="p-6">
        <h2 id={titleId} className={sectionTitleClass}>{`Connect ${name}`}</h2>
        <p className={`mt-2 ${secondaryClass}`}>{`You'll go to ${name} to sign in and approve. Then you come straight back here.`}</p>
        {feeds.length > 0 ? (
          <div className="mt-4">
            <p className={eyebrowLabelClass}>The hub reads, and never changes</p>
            <ul className="mt-1 space-y-0.5">
              {feeds.map((feed) => <li key={feed} className={secondaryClass}>{feed}</li>)}
            </ul>
          </div>
        ) : null}
        <p className="mt-4 rounded-md border border-line bg-surface-2 px-3 py-2 text-[13px] leading-relaxed text-ink">
          Use an account the company keeps, like a shared office login. If the person who signs in leaves, the connection stops for everyone.
        </p>
        {error ? <Notice tone="error" className="mt-4">{error}</Notice> : null}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button aria-label={`Continue to ${name}`} onClick={() => void go()} disabled={busy}>
            {busy ? "Opening..." : `Continue to ${name}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
