// Magic-link sign-in with tenant detection. As the person types, the domain is looked up
// (anonymously) against company_domains: a known domain names the company and switches the
// whole screen to its theme before any email is sent; an unknown domain (a personal
// address) shows a company picker. The pick is a courtesy for theming and messaging only:
// the profile an invitation created decides where the person actually lands. Account
// creation is allowed here because the server-side signup gate is the real door.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check } from "lucide-react";
import Button from "./ui/Button.tsx";
import Field from "./ui/Field.tsx";
import Notice from "./ui/Notice.tsx";
import CenteredCard from "./CenteredCard.tsx";
import { inputClass, selectClass } from "./ui/forms.ts";
import { listPublicCompanies, lookupCompanyForEmail, sendMagicLink } from "../services/auth.ts";
import { friendlyAuthError } from "../lib/authErrors.ts";
import { emailDomain, isRococoEmail, isValidEmail, normalizeEmail } from "../lib/email.ts";
import { applyTheme } from "../lib/theme.ts";
import { storeLoginHint } from "../lib/loginHint.ts";
import type { PublicCompany } from "../types/database.ts";

type Phase = "idle" | "sending" | "sent" | "error";

export default function Login() {
  const params = new URLSearchParams(window.location.search);
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [company, setCompany] = useState<PublicCompany | null>(null);
  const [needsPick, setNeedsPick] = useState(false);
  const [companies, setCompanies] = useState<PublicCompany[] | null>(null);
  const [picked, setPicked] = useState(params.get("company") ?? "");
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const lookupTick = useRef(0);

  const rococo = isRococoEmail(email);

  // Recognize the company from the domain as the person types, debounced so a lookup never
  // fires per keystroke. A stale response is dropped by the tick check.
  useEffect(() => {
    const domain = emailDomain(email);
    if (!domain || rococo) {
      setCompany(null);
      setNeedsPick(false);
      return;
    }
    const tick = ++lookupTick.current;
    const timer = setTimeout(() => {
      lookupCompanyForEmail(email)
        .then((found) => {
          if (tick !== lookupTick.current) return;
          setCompany(found);
          setNeedsPick(!found);
        })
        .catch(() => {
          if (tick !== lookupTick.current) return;
          setCompany(null);
          setNeedsPick(true);
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [email, rococo]);

  // The picker list loads once it is first needed.
  useEffect(() => {
    if (!needsPick || companies) return;
    listPublicCompanies()
      .then(setCompanies)
      .catch(() => setCompanies([]));
  }, [needsPick, companies]);

  const pickedCompany = needsPick ? (companies?.find((c) => c.slug === picked) ?? null) : null;
  const activeCompany = company ?? pickedCompany;

  // The screen wears the recognized company's colors the moment it knows them.
  useEffect(() => {
    applyTheme(activeCompany?.theme_key ?? "rococo");
  }, [activeCompany?.theme_key]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const address = normalizeEmail(email);
    if (phase === "sending") return;
    if (!isValidEmail(address)) {
      setPhase("error");
      setMessage("Enter your work email address.");
      return;
    }
    if (needsPick && !pickedCompany) {
      setPhase("error");
      setMessage("Pick your company so we can sign you in to the right hub.");
      return;
    }
    setPhase("sending");
    setMessage("");
    try {
      if (pickedCompany) storeLoginHint(pickedCompany.slug);
      await sendMagicLink(address);
      setPhase("sent");
    } catch (err) {
      setPhase("error");
      setMessage(friendlyAuthError(err));
    }
  }

  const heading = activeCompany ? activeCompany.name : rococo ? "Rococo Creative" : "Company Hub";

  return (
    <CenteredCard footer={<p className="eyebrow">Company Hub by Rococo Creative</p>}>
      {activeCompany?.logo_url ? (
        <img src={activeCompany.logo_url} alt="" className="mb-4 h-8 w-auto max-w-[180px] object-contain object-left" />
      ) : null}
      <p className="eyebrow">{heading}</p>
      <h1 className="mt-3 font-display text-3xl tracking-display text-heading">Sign in</h1>
      <p className="mt-1.5 text-sm text-ink-2">
        Enter your work email and we will send a one-time sign-in link. No password to remember.
      </p>

      {phase === "sent" ? (
        <div className="mt-6">
          <Notice tone="success">
            Check <b>{normalizeEmail(email)}</b> for your sign-in link. Open it on this device to continue. You will
            stay signed in here.
          </Notice>
          <button
            type="button"
            onClick={() => {
              setPhase("idle");
              setMessage("");
            }}
            className="mt-4 text-[12px] text-ink-2 underline transition-colors duration-150 hover:text-ink"
          >
            Use a different email
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
          <Field label="Work email" htmlFor="login-email">
            <input
              id="login-email"
              type="email"
              required
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (phase === "error") setPhase("idle");
              }}
              placeholder="you@company.com"
              className={inputClass}
            />
          </Field>

          {company ? (
            <p className="flex items-center gap-1.5 text-[13px] text-success" role="status">
              <Check size={14} aria-hidden /> Signing in to {company.name}
            </p>
          ) : null}

          {needsPick ? (
            <Field
              label="Your company"
              htmlFor="login-company"
              hint="We did not recognize that email domain. Choose the company you work with."
            >
              <select
                id="login-company"
                value={picked}
                onChange={(e) => {
                  setPicked(e.target.value);
                  if (phase === "error") setPhase("idle");
                }}
                className={selectClass}
              >
                <option value="">Choose a company</option>
                {(companies ?? []).map((c) => (
                  <option key={c.id} value={c.slug}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          {phase === "error" ? <Notice tone="error">{message}</Notice> : null}

          <Button type="submit" disabled={phase === "sending"} className="w-full">
            {phase === "sending" ? "Sending link..." : "Send sign-in link"}
          </Button>
        </form>
      )}
    </CenteredCard>
  );
}
