// The Rococo admin list on the Permissions tab (0051), the one place a Rococo admin is added or
// removed. Add takes a rocococreative.io address; Remove asks once, because removing someone also
// turns their hub account off. Nobody is offered their own Remove, and the database refuses it and
// the last entry's removal regardless. Shown only to a Rococo admin; RLS gives anyone else nothing.
import { useState, type FormEvent } from "react";
import Button from "../ui/Button.tsx";
import Field from "../ui/Field.tsx";
import Notice from "../ui/Notice.tsx";
import Section from "../ui/Section.tsx";
import SkeletonRows from "../ui/SkeletonRows.tsx";
import { inputClass } from "../ui/forms.ts";
import { metaClass } from "../ui/type.ts";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { normalizeEmail } from "../../lib/email.ts";
import { errorMessage } from "../../lib/errors.ts";
import { addRococoAdmin, listRococoAdmins, removeRococoAdmin } from "../../services/rococoAdmins.ts";
import type { Profile, RococoAdminEntry } from "../../types/database.ts";

const nameOf = (entry: RococoAdminEntry) => entry.name || entry.email;

// One entry: the name over the address, or the address alone when nobody has that profile yet.
// Remove turns the row into its question, answered with Remove or Keep.
function AdminRow({
  entry,
  self,
  confirming,
  busy,
  onAsk,
  onKeep,
  onRemove,
}: {
  entry: RococoAdminEntry;
  self: boolean;
  confirming: boolean;
  busy: boolean;
  onAsk: () => void;
  onKeep: () => void;
  onRemove: () => void;
}) {
  const name = nameOf(entry);
  return (
    <li className="px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm text-ink">
            {name}
            {self ? " (you)" : ""}
          </p>
          {entry.name ? <p className={`truncate ${metaClass}`}>{entry.email}</p> : null}
        </div>
        {self || confirming ? null : (
          <Button variant="danger" size="sm" aria-label={`Remove ${name}`} disabled={busy} onClick={onAsk}>
            Remove
          </Button>
        )}
      </div>
      {confirming ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface-2 px-3 py-2.5">
          <p className="text-[13px] text-ink">
            Remove {name} as a Rococo admin? Their hub account is turned off. You can add them back later.
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="danger" size="sm" disabled={busy} onClick={onRemove}>
              {busy ? "Working..." : "Remove"}
            </Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={onKeep}>
              Keep
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function AdminList({ me }: { me: Profile }) {
  const state = useAsync(() => listRococoAdmins(), []);
  const [email, setEmail] = useState("");
  const [addError, setAddError] = useState("");
  const [adding, setAdding] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState("");
  const myEmail = normalizeEmail(me.email);

  async function add(event: FormEvent) {
    event.preventDefault();
    if (adding) return;
    setAddError("");
    setAdding(true);
    try {
      await addRococoAdmin(email);
      setEmail("");
      state.reload();
    } catch (err) {
      setAddError(errorMessage(err));
    }
    setAdding(false);
  }

  async function remove(entry: RococoAdminEntry) {
    if (removingId) return;
    setRemoveError("");
    setRemovingId(entry.id);
    try {
      await removeRococoAdmin(entry.id);
      setConfirmingId(null);
      state.reload();
    } catch (err) {
      setRemoveError(errorMessage(err));
    }
    setRemovingId(null);
  }

  return (
    <>
      {state.error ? (
        <div className="p-4 sm:p-6">
          <Notice tone="error">
            {state.error}
            <Button variant="secondary" className="ml-3" onClick={state.reload}>
              Reload
            </Button>
          </Notice>
        </div>
      ) : null}
      {!state.data && !state.error ? (
        <div className="p-4 sm:p-6">
          <SkeletonRows rows={2} />
        </div>
      ) : null}
      {state.data ? (
        <ul aria-label="Rococo admins" className="divide-y divide-line">
          {state.data.map((entry) => (
            <AdminRow
              key={entry.id}
              entry={entry}
              self={entry.profile_id === me.id || entry.email === myEmail}
              confirming={confirmingId === entry.id}
              busy={removingId !== null}
              onAsk={() => {
                setRemoveError("");
                setConfirmingId(entry.id);
              }}
              onKeep={() => {
                setRemoveError("");
                setConfirmingId(null);
              }}
              onRemove={() => void remove(entry)}
            />
          ))}
        </ul>
      ) : null}
      {removeError ? (
        <div className="px-4 pt-4 sm:px-6">
          <Notice tone="error">{removeError}</Notice>
        </div>
      ) : null}
      <form onSubmit={(e) => void add(e)} noValidate className="border-t border-line p-4 sm:p-6">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Email address" htmlFor="rococo-admin-email" className="min-w-[220px] max-w-sm flex-1">
            <input
              id="rococo-admin-email"
              type="email"
              autoComplete="off"
              value={email}
              aria-invalid={addError ? true : undefined}
              aria-describedby={addError ? "rococo-admin-email-error" : undefined}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Button type="submit" disabled={adding || !email.trim()}>
            {adding ? "Working..." : "Add"}
          </Button>
        </div>
        {addError ? (
          <p id="rococo-admin-email-error" role="alert" className="mt-1.5 text-[12px] text-danger">
            {addError}
          </p>
        ) : null}
      </form>
    </>
  );
}

export default function RococoAdminsSection() {
  const { profile, isRococo } = useHub();
  if (!isRococo) return null;
  return (
    <Section
      title="Rococo admins"
      description="The people who can open every company. Each one signs in with a confirmed rocococreative.io address."
      padded={false}
      className="mt-8"
    >
      <AdminList me={profile} />
    </Section>
  );
}
