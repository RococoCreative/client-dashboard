This file exists to record the agreed design for the security hardening build that must land before any company connects real financial data.

# Security hardening design

Source: the consolidated audit of 2026-11-23 (four audits: database, Edge Functions, frontend, supply
chain and config). This build closes the code items in its "Fix before real books" bucket. The
dashboard items (redirect wildcard removed, sign-up settings, hook, APP_ORIGINS, state secret) were
checked and settled by the owner on 2026-11-24.

## Intent

Company Hub is about to hold provider tokens and read real books (QuickBooks first, then Google and
GoHighLevel, then JobTread and more). The audit found the company wall sound but the edges not
ready: tokens in plaintext, Rococo's cross-company power granted by email domain alone, a connect
flow that a forwarded link can hijack, and missing hygiene Intuit checks for. This build makes the
hub fit to hold financial data and pass Intuit's security requirements.

It is global. Every rule here applies to every company present and future, by construction, never
by company name, slug or setting (rule 12).

## Goals

- Provider tokens and provider account identifiers are encrypted at the application level, with the
  key held apart from the data, and never reach a browser or a log.
- A connection only completes when the admin who started it, signed in, confirms it in the hub after
  seeing which outside account they are attaching.
- Rococo admin is an explicit list of named people, managed from the Rococo Permissions page, and
  needs a confirmed email. An address on Rococo's domain is no longer enough.
- Every response carrying sensitive data says not to cache it; every return from a provider lands on
  a redirect; logs and on-screen errors carry plain messages only.
- Disconnect confirms whether the provider revoked access, and says so.
- The server function's dependencies are pinned.

## Non-goals

- New connectors, new sync features, or changes to what data a connector reads.
- The "fix soon" and backlog items (admins editing their own pay, change history on pay and
  ratings, link schemes, PKCE sign-in, full Content-Security-Policy, CI permissions, backups). They
  follow as separate work.
- A separate staging environment.
- The drift the audit found (pg_cron and pg_net missing live; the Rococo admin profile attached to
  RBA as an owner). Recorded, handled separately.

## Anti-goals

- A security step that breaks connecting on some browsers or devices.
- Anyone losing Rococo access during rollout.
- Any token, code, realmId or secret appearing in a browser response, a URL the app renders, or a log
  line.
- A screen offering an action that will fail (the catalog's rule) because a new secret is missing.

## Constraints

- CLAUDE.md binds: theme tokens and `components/ui/*` only; services throw, pages message; the
  company wall is RLS; no branch on a company name, slug or theme key; migrations append-only and
  idempotent with `src/types/database.ts` in step; every file opens with a why comment; copy calm,
  plain, no em dashes; every service function has a same-named mock; gates `npm run lint`,
  `npx vitest run`, `npm run build`, `npm run test:sql`.
- No service-role key in the app or Vercel. Provider secrets and the new encryption key live only in
  Supabase function secrets.
- Live state today: no tokens stored, no live connections, no synced records, one Rococo admin
  profile. So encryption starts clean, and the one Rococo admin is seeded into the allowlist.
- Next free migration number is 0051.

## Approaches considered

### Binding a connection to the person who started it (the one real choice)

1. **Confirm in the app (chosen).** The provider callback does not finish the connection. It
   exchanges the code, parks the encrypted result for ten minutes, and redirects to the app. The app
   shows which outside account is about to be attached and asks the admin to confirm. Only the
   signed-in admin who pressed Connect can confirm. A forwarded link ends on someone else's screen
   and cannot be confirmed. Costs one extra click; works in every browser because it uses the app's
   own sign-in, not cookies.
2. **A cookie on the function's domain.** Set at the start, checked on return. Safari and Chrome
   increasingly block such cookies in this setup, so Connect could fail on some devices.

The owner chose 1.

### Rococo admin list

1. **A section on the Rococo Permissions page (chosen).** Existing Rococo admins add and remove
   people; the database enforces it and logs every change.
2. Editing the list by hand in the database. Dropped: the owner prefers app-level control.

## The design

### 1. Token encryption

- A shared helper in `supabase/functions/_shared/` encrypts and decrypts with AES-256-GCM using the
  Web Crypto API. Format: `v1:` + base64url(12-byte random IV, then ciphertext and tag). The prefix
  marks the format only, not a key (my call: one secret to add, nothing to keep in step).
- The key is a new Supabase function secret, `TOKEN_ENCRYPTION_KEY` (32 random bytes, base64).
  An optional `TOKEN_ENCRYPTION_KEY_PREVIOUS` supports rotation: decryption tries the current key,
  then the previous one, and GCM's integrity check rejects the wrong key. New writes always use the
  current key; a rotation re-encrypts each value on its next token refresh.
- Additional authenticated data binds each value to its connection id and field name, so a value
  cannot be copied onto another connection or field and still decrypt.
- Encrypted: access token, refresh token, and the provider account identifier (QuickBooks realmId,
  GoHighLevel location id, Google account id). They live in `connection_tokens` (still readable only
  by the function). The account identifier moves there from `company_connections`.
- `company_connections.external_account_id` is no longer written and is cleared; the browser keeps
  only `external_account_name` for display. The audit trigger on `company_connections` (0025) stops
  watching `external_account_id`, so the id never lands in `audit_events`. Synced rows
  (`sync_records.source_ref`) stop carrying the realmId, and `recordLink` in
  `_shared/sync/links.ts` builds the "Open in QuickBooks" link without it, so that link keeps
  working.
- Missing key: the function refuses to store or read tokens and says the connection is not set up.

### 2. Connect, confirm, finish

1. `/start` is unchanged in what it checks (signed-in active owner or admin of the company, or a
   Rococo admin). The signed state still carries company, provider, starting profile, return address,
   nonce and expiry.
2. `/callback` verifies the state and redeems the nonce as today, exchanges the code, and stores the
   encrypted result in a new pending table (service role only): nonce, company, provider, starting
   profile, account name, encrypted tokens and account id, expiry ten minutes out. It then redirects
   to the app's Connections page with only `?pending=<id>`, where the id is freshly random and
   minted at the callback, never the state's nonce: the starting admin can read the nonce inside
   their own state, so a nonce key would let them finish a connection whose link they forwarded to
   someone else. Only the browser that completed the provider sign-in ever holds the id. No code,
   realmId or token in that URL.
3. The Connections page sees `pending`, calls `POST /pending` (signed in) to read the tool and account
   name, and shows a confirm panel: "Connect {Tool} account {account name} to {company}?" with
   Connect and Cancel. The account name is best effort (the provider lookup may fail). Without it the
   panel reads "Connect {Tool} to {company}? {Tool} did not give this account's name. Only continue
   if you just approved access in {Tool}." No account id is ever shown (my call).
4. `POST /finish` (signed in) requires the caller to be the same profile that started it, still an
   active owner or admin of that company (or a Rococo admin who started it), and the pending row
   unexpired. It then writes `company_connections` and `connection_tokens` and deletes the pending
   row. `POST /discard` deletes the pending row and revokes the tokens at the provider.
5. Someone else opening the page (the forwarded-link case) sees: "This connection was started by
   someone else, so it can't be finished here. Ask them to finish it, or start again." Nothing is
   attached. Expired pending rows are never applied. They are swept on the next start of any
   connection and by the sync tick, and each swept grant is revoked at the provider, best effort, so
   an abandoned Connect does not leave the hub authorised there (my call). GoHighLevel offers no
   revoke today, so its Discard, sweep and Disconnect say it may still list Company Hub.

### 3. Every provider return is a redirect

Every `/callback` outcome, including a missing, bad or expired state, is a bare 302 with no body.
With a verified state it returns to that state's return address with a known error key. Without one
it returns to `APP_URL` + `/settings/connections` with a generic error key. The app shows only known
messages for known keys (as the catalog banner already does).

### 4. Rococo admin list

- A new table `rococo_admins`: email (lowercased, must be on Rococo's domain), added by, added at.
  Seeded in the migration from the current Rococo admin profiles, so no one loses access.
- `private.is_rococo_admin()` becomes true only when the signed-in profile is active, its email is on
  the list, and the account's email is confirmed (`auth.users.email_confirmed_at`).
- `profiles.is_rococo_admin` stays as the column the app reads, kept in step by the database: set
  when an address is added to the list (and at sign-up from the list, not the domain), cleared when
  removed. Today every version of the profile guard returns early for a Rococo admin, so a Rococo
  admin can set this column on any profile (the Users page checkbox relies on it). The guard is
  tightened so only the list's own sync writes the column, for everyone.
- The sign-up gate admits a Rococo-domain address only if it is on the list. Company domains and
  invitations are unchanged.
- Only Rococo admins can read, add or remove list entries. The last entry cannot be removed. Every
  change is audited.
- Removing someone deactivates their profile (`is_active = false`) along with clearing the Rococo
  flag, so a removed person keeps no access anywhere, including any company role they also held
  (the owner decided). Re-adding the address reactivates that profile with Rococo access. Removal
  confirmation reads: "Remove {name} as a Rococo admin? Their hub account is turned off. You can add
  them back later." A signed-in person who is deactivated sees the app's existing no-access screen.
- App: a "Rococo admins" section on the Rococo Permissions page lists the people with Add (an email
  address) and Remove (asks once). The Rococo admin checkbox on the Users page is replaced by a
  read-only badge pointing to Permissions, so there is one place to manage it.

### 5. Hygiene

- **Cache:** every response from the `connections` and `notify` functions sends
  `Cache-Control: no-store`. `vercel.json` sends `no-store` for the app's HTML and routes; hashed
  assets keep normal caching.
- **Logs:** function logs carry a short message and ids only, never whole error objects, provider
  response bodies, codes, tokens or realmIds. On screen, an unknown error shows the friendly line
  from `lib/errors.ts`, never raw provider or database text.
- **Revocation:** Disconnect deletes the tokens either way and reports whether the provider confirmed
  revocation. If it did not: "Disconnected here. {Tool} may still list Company Hub; remove it there
  too."
- **Pinned imports:** the functions import exact versions, not a floating major.
- **Setup status:** `/status` also reports whether `CONNECTIONS_STATE_SECRET` and
  `TOKEN_ENCRYPTION_KEY` are present. If either is missing, every sign-in tool reads Not available
  yet, and a Rococo admin's line names the missing secret. (My call: keeps the catalog's rule that no
  card offers an action that will fail.)

## Rollout

1. Owner adds `TOKEN_ENCRYPTION_KEY` in Supabase function secrets (guided, value never shared).
2. Apply the new migrations, reload the schema. Rococo access is seeded, so nothing visible changes.
3. Deploy `connections` and `notify`.
4. Merge and deploy the app.
5. Record in the README and the Hub Feature Register.

The app must not ship before steps 2 and 3, because it calls `/pending` and `/finish`.

## Left to the builder

Migration split and table names beyond those named, helper and module names, exact copy beyond what
is quoted, test structure, and the exact pinned versions. Keep the pure parts (encryption format,
state handling, pending rules, error keys) in shared modules covered by vitest, the way the provider
registry is tested today, and the database rules covered by `npm run test:sql`.
