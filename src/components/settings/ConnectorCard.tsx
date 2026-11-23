// One tool on the Connections catalog: its monogram, name and line, its state for this company as
// a pill, and the one action that makes sense next, or the line saying why there is none. The
// state itself comes from cardView (lib/connectors.ts); this card only shows it. A card that needs
// attention also offers Manage, so the detail panel and its Disconnect are always in reach, even
// when Reconnect cannot run. Rococo's setup line sits underneath when the catalog passes one, which
// it does for a Rococo admin only.
import { useId } from "react";
import Badge, { type BadgeTone } from "../ui/Badge.tsx";
import Button from "../ui/Button.tsx";
import { eyebrowLabelClass, itemTitleClass, metaClass, metaSizeClass, secondaryClass } from "../ui/type.ts";
import { formatDate } from "../../lib/format.ts";
import type { CardState, CardView, Connector, ConnectorHow } from "../../lib/connectors.ts";
import type { CompanyConnection } from "../../types/database.ts";

export type CardAction = NonNullable<CardView["action"]>;

const STATE_BADGES: Record<CardState, { label: string; tone: BadgeTone }> = {
  connected: { label: "Connected", tone: "success" },
  needs_attention: { label: "Needs attention", tone: "danger" },
  linked: { label: "Linked", tone: "accent" },
  not_set_up: { label: "Not set up", tone: "neutral" },
  not_connected: { label: "Not connected", tone: "neutral" },
  not_available: { label: "Not available yet", tone: "warning" },
  not_on: { label: "Not on for this company", tone: "neutral" },
  coming_next: { label: "Coming next", tone: "info" },
  coming_soon: { label: "Coming soon", tone: "neutral" },
};

const HOW_LABELS: Record<ConnectorHow, string> = { sign_in: "Sign in", access_key: "Access key", links: "Links" };

// The meta line in the danger colour: the size and leading come from the type scale, the colour is named here.
const DANGER_META = `${metaSizeClass} text-danger`;

// What the card says under its name, beyond the pill: the account a connection reads, the stored
// error, the line in place of an action that cannot run, or how many boards are linked.
function Detail({ view, row, linkCount }: { view: CardView; row: CompanyConnection | null; linkCount: number }) {
  const lines: Array<{ text: string; className: string }> = [];
  if ((view.state === "connected" || view.state === "needs_attention") && row) {
    const account = row.external_account_name ?? row.external_account_id ?? "Account";
    lines.push({ text: `${account}${row.connected_at ? ` · since ${formatDate(row.connected_at)}` : ""}`, className: metaClass });
  }
  if (view.state === "needs_attention" && row?.last_error) lines.push({ text: row.last_error, className: DANGER_META });
  if (view.state === "linked") lines.push({ text: linkCount === 1 ? "1 board linked" : `${linkCount} boards linked`, className: metaClass });
  if (view.state === "coming_next") lines.push({ text: "The next connector Rococo is building.", className: metaClass });
  if (view.blocked) lines.push({ text: view.blocked, className: metaClass });
  if (lines.length === 0) return null;
  return (
    <div className="space-y-0.5">
      {lines.map((line) => <p key={line.text} className={line.className}>{line.text}</p>)}
    </div>
  );
}

// The one button a card offers. Its accessible name carries the tool, so a reader moving through
// the buttons alone still knows which card each one belongs to.
function Action({ connector, view, requested, disabled, onAction }: { connector: Connector; view: CardView; requested: boolean; disabled: boolean; onAction: (action: CardAction) => void }) {
  const { action } = view;
  if (!action) return null;
  const { name } = connector;
  const press = () => onAction(action);
  switch (action) {
    case "connect":
      return <Button size="sm" aria-label={`Connect ${name}`} disabled={disabled} onClick={press}>Connect</Button>;
    case "reconnect":
      return <Button size="sm" aria-label={`Reconnect ${name}`} disabled={disabled} onClick={press}>Reconnect</Button>;
    case "manage":
      return <Button variant="secondary" size="sm" aria-label={`Manage ${name}`} disabled={disabled} onClick={press}>Manage</Button>;
    case "manage_links":
      return <Button variant="secondary" size="sm" aria-label={`Manage links for ${name}`} disabled={disabled} onClick={press}>Manage links</Button>;
    case "add_link":
      return <Button variant="secondary" size="sm" aria-label={`Add a board link for ${name}`} disabled={disabled} onClick={press}>Add a board link</Button>;
    case "ask":
      return requested ? (
        <Button variant="ghost" size="sm" aria-label={`Requested: ${name}`} title="Withdraw the request" disabled={disabled} onClick={press}>Requested</Button>
      ) : (
        <Button variant="secondary" size="sm" aria-label={`Ask for this: ${name}`} disabled={disabled} onClick={press}>Ask for this</Button>
      );
  }
}

export default function ConnectorCard({
  connector,
  view,
  row,
  requested,
  rococoLine,
  onAction,
  linkCount = 0,
  disabled = false,
}: {
  connector: Connector;
  view: CardView;
  row: CompanyConnection | null;
  requested: boolean;
  /** Rococo's setup line, or null for anyone but a Rococo admin. */
  rococoLine: string | null;
  onAction: (action: CardAction) => void;
  linkCount?: number;
  /** True while any action on the catalog is running, this card's included. */
  disabled?: boolean;
}) {
  const titleId = useId();
  const badge = STATE_BADGES[view.state];
  const coming = view.state === "coming_next" || view.state === "coming_soon";
  return (
    <article
      aria-labelledby={titleId}
      className={`flex min-w-0 flex-col gap-3 rounded-lg border p-4 transition-colors duration-150 ${coming ? "border-dashed border-line-strong" : "border-line bg-surface shadow-xs hover:border-line-strong"}`}
    >
      <div className="flex items-start gap-3">
        <div aria-hidden className={`grid h-9 w-9 shrink-0 place-items-center rounded-md border border-line bg-surface-2 text-[13px] font-semibold text-accent ${coming ? "opacity-70" : ""}`}>
          {connector.monogram}
        </div>
        <div className="min-w-0">
          <h4 id={titleId} className={itemTitleClass}>{connector.name}</h4>
          <p className={`mt-0.5 ${secondaryClass}`}>{connector.description}</p>
        </div>
      </div>
      <Detail view={view} row={row} linkCount={linkCount} />
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={badge.tone}>{badge.label}</Badge>
          <span className={eyebrowLabelClass}>{HOW_LABELS[connector.how]}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {view.state === "needs_attention" ? (
            <Button variant="secondary" size="sm" aria-label={`Manage ${connector.name}`} disabled={disabled} onClick={() => onAction("manage")}>Manage</Button>
          ) : null}
          <Action connector={connector} view={view} requested={requested} disabled={disabled} onAction={onAction} />
        </div>
      </div>
      {rococoLine ? <p className="border-t border-dashed border-line pt-2 font-mono text-[11px] leading-relaxed text-info">{rococoLine}</p> : null}
    </article>
  );
}
