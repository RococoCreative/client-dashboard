// First sign-in: the one thing we do not know about an invited person is their name. Title
// is optional here because an invitation may already carry it.
import { useState, type FormEvent } from "react";
import Button from "./ui/Button.tsx";
import Field from "./ui/Field.tsx";
import Notice from "./ui/Notice.tsx";
import CenteredCard from "./CenteredCard.tsx";
import { inputClass } from "./ui/forms.ts";
import { updateMyProfile } from "../services/profiles.ts";
import { errorMessage } from "../lib/errors.ts";
import type { Profile } from "../types/database.ts";

export default function Onboarding({
  profile,
  companyName,
  onDone,
}: {
  profile: Profile;
  companyName: string | null;
  onDone: () => Promise<void>;
}) {
  const [name, setName] = useState(profile.full_name ?? "");
  const [title, setTitle] = useState(profile.title ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const fullName = name.trim();
    if (!fullName || busy) return;
    setBusy(true);
    setError("");
    try {
      await updateMyProfile({ full_name: fullName, title: title.trim() || profile.title || null });
      await onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <CenteredCard>
      <p className="eyebrow">{companyName ?? "Company Hub"}</p>
      <h1 className="mt-3 font-display text-3xl tracking-display text-heading">Welcome</h1>
      <p className="mt-1.5 text-sm text-ink-2">
        You are signed in as {profile.email}. Tell us what to call you and you are set.
      </p>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <Field label="Your name" htmlFor="onboarding-name">
          <input
            id="onboarding-name"
            type="text"
            required
            autoFocus
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="First and last name"
            className={inputClass}
          />
        </Field>
        <Field label="Title (optional)" htmlFor="onboarding-title">
          <input
            id="onboarding-title"
            type="text"
            autoComplete="organization-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Project Manager"
            className={inputClass}
          />
        </Field>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button type="submit" disabled={busy || !name.trim()} className="w-full">
          {busy ? "Saving..." : "Continue"}
        </Button>
      </form>
    </CenteredCard>
  );
}
