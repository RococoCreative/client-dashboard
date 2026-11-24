# Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Company Hub fit to hold provider tokens and real books: sealed tokens and account ids, a connect flow only the starting admin can finish, an explicit Rococo admin list, and the cache, log and revocation hygiene Intuit checks for.

**Architecture:** Every decision with a rule in it (token sealing, state reading, error keys, pending verdicts, setup parsing, copy) lives in a pure module under `supabase/functions/_shared/` or `src/lib/` and is pinned by vitest; the database rules live in two new migrations (0051, 0052) pinned by `npm run test:sql`; the Deno glue in `supabase/functions/connections` and `notify` only wires those together. The app gains a confirm panel, a Rococo admins section, and stricter error text.

**Tech Stack:** Supabase (Postgres, RLS, Edge Functions on Deno, Web Crypto AES-256-GCM and HMAC-SHA256), Vite + React 19 + TypeScript, Tailwind v4, vitest, the local SQL harness, Vercel.

**Spec:** `docs/superpowers/specs/2026-11-24-security-hardening-design.md`

## Global Constraints

- Branch `claude/affectionate-turing-97kl0p`. Every commit message ends with this last paragraph, exactly:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_013YCDgnET92f6qbZcMPmsmW
  ```
- Gates before every commit that touches `src/` or `_shared/`: `npm run lint`, `npx vitest run`, `npm run build`. Before every commit that touches `supabase/migrations/` or `supabase/tests/`: `npm run test:sql`. The last task runs all four.
- Migrations 0001 to 0050 are applied live and are never edited. New ones are `0051_rococo_admins.sql` and `0052_connection_secrets.sql`, idempotent (the harness pastes 0024+ twice), with `src/types/database.ts` kept in step.
- Token format: `v1:` + base64url without padding of (12-byte random IV, then AES-256-GCM ciphertext and 16-byte tag). The prefix marks the format, never a key. Additional authenticated data binds each value to its owner and field.
- Secrets: `TOKEN_ENCRYPTION_KEY` (32 random bytes, base64) and optional `TOKEN_ENCRYPTION_KEY_PREVIOUS` live only in Supabase function secrets. No service-role key in the app or Vercel.
- A pending connection lives ten minutes (`PENDING_TTL_SECONDS = 600`).
- No token, OAuth code, realmId, account id, provider body, whole error object or `.message` of a database or fetch error in any response the browser sees, any URL the app renders, or any `console.*` line. Log a fixed context string plus ids, `err.name`, a database `error.code` or an HTTP status only.
- Copy is calm and plain with no em dashes; every quoted string in this plan is exact.
- CLAUDE.md binds: theme tokens and `components/ui/*` only; every file opens with a why comment; components are PascalCase with `export default function`; services throw and pages message through `lib/errors.ts`; every new service function gets a same-named mock in `src/test/mocks/` (the parity test enforces it); no branch on a company name, slug or theme key.
- There is no Deno locally. Files under `supabase/functions/connections/` and `notify/` are checked by lint and by the source scan in Task 7 only, so they carry wiring, never a rule. Any vitest file that touches Web Crypto starts, after its why comment, with the line `// @vitest-environment node` (jsdom's `ArrayBuffer` realm breaks `crypto.subtle`).
- Nothing deploys until Task 10: the function between tasks may be inconsistent with itself.

## Review Focus

- **The same pending link opened twice** (a reload, a second tab, Back after Connect): the second Connect must read "This connection request has expired. Start the connection again." and attach nothing twice. Pinned in Task 6 (`claimPending` is a delete-returning) and Task 8 (test `a pending link already finished reads the expired line, on opening or on a second Connect`).
- **A `TOKEN_ENCRYPTION_KEY` pasted with a trailing newline, or of the wrong length, or a malformed `_PREVIOUS`**: the newline is accepted; a wrong length makes the catalog read Not available yet with the Rococo line naming the secret, never a Connect that fails. Pinned in Task 1 (`tokenKeyProblem` tests) and Task 4 (`flowSecretsReady` test).
- **A Rococo address typed in mixed case or with spaces** ("  Sam@RococoCreative.io "): stored lowercased, and adding or removing it finds the profile stored as `sam@rocococreative.io`. Pinned in Task 2 (case `mixed_case_address_matches_profile`).
- **A Rococo admin who switched company between Connect and confirming**: the panel names the company the pending connection is for, from `/pending`, not the active one. Pinned in Task 8 (test `the confirm line names the pending connection's company`).
- **A key rotation mid-life**: a refresh token sealed under the previous key still opens, and the next save seals under the current key only. Pinned in Task 1 (test `re-seals a value opened with the previous key under the current key`).

---

### Task 1: Token sealing helper

**Files:**
- Create: `supabase/functions/_shared/tokenCrypto.ts`
- Test: `src/lib/sync/tokenCrypto.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (all from `supabase/functions/_shared/tokenCrypto.ts`):
  - `export const TOKEN_FORMAT = "v1:"`
  - `export const TOKENS_NOT_SET_UP = "Connections are not set up yet. Ask Rococo Creative to finish the setup."`
  - `export type TokenField = "access_token" | "refresh_token" | "account_id"`
  - `export type TokenOwner = { connectionId: string } | { pendingId: string }`
  - `export interface TokenKeys { current: CryptoKey; previous: CryptoKey | null }`
  - `export class TokenKeyError extends Error {}` and `export class TokenSealError extends Error {}`
  - `export function tokenKeyProblem(read: (name: string) => string | undefined): "TOKEN_ENCRYPTION_KEY" | "TOKEN_ENCRYPTION_KEY_PREVIOUS" | null`
  - `export async function loadTokenKeys(read: (name: string) => string | undefined): Promise<TokenKeys>`
  - `export function tokenAad(owner: TokenOwner, field: TokenField): string`
  - `export async function encryptToken(plain: string, aad: string, keys: TokenKeys): Promise<string>`
  - `export async function decryptToken(sealed: string, aad: string, keys: TokenKeys): Promise<string>`
  - `export interface SealedTokens { access_token: string; refresh_token: string | null; account_id?: string | null }`
  - `export async function sealTokens(owner: TokenOwner, tokens: { accessToken: string; refreshToken: string | null; accountId?: string | null }, keys: TokenKeys): Promise<SealedTokens>`
  - `export async function openTokens(owner: TokenOwner, row: { access_token: string; refresh_token: string | null; account_id: string | null }, keys: TokenKeys): Promise<{ accessToken: string; refreshToken: string | null; accountId: string | null }>`

- [ ] **Step 1: Write the failing tests** in `src/lib/sync/tokenCrypto.test.ts` (why comment, then `// @vitest-environment node`). Keys are built in the test as `btoa(String.fromCharCode(...new Uint8Array(32).fill(n)))` for `n = 1` (A) and `n = 2` (B); `read` is a function over a plain record.

```ts
it("round-trips a value under the same owner and field", async () => {
  const keys = await loadTokenKeys(read({ TOKEN_ENCRYPTION_KEY: A }));
  const aad = tokenAad({ connectionId: "c1" }, "refresh_token");
  const sealed = await encryptToken("sample-refresh", aad, keys);
  expect(sealed.startsWith("v1:")).toBe(true);
  expect(sealed).not.toContain("sample-refresh");
  expect(await decryptToken(sealed, aad, keys)).toBe("sample-refresh");
});
it("lays out v1: then base64url of a 12-byte IV, the ciphertext and a 16-byte tag", async () => {
  // decode sealed.slice(3) as base64url: length === 12 + utf8("sample").length + 16; no "=", "+" or "/"
});
it("seals the same value differently each time", /* two encryptToken calls differ, both decrypt */);
it("refuses a value under another owner or field (AAD mismatch)", async () => {
  // sealed for { connectionId: "c1" }/"access_token" rejects with TokenSealError when opened as
  // { connectionId: "c2" }/"access_token", as { connectionId: "c1" }/"refresh_token", and as { pendingId: "c1" }/"access_token"
});
it("refuses a value sealed with another key", /* sealed under A, keys {current B} -> TokenSealError */);
it("opens a value sealed with the previous key", /* sealed under A; keys from { TOKEN_ENCRYPTION_KEY: B, TOKEN_ENCRYPTION_KEY_PREVIOUS: A } decrypts */);
it("re-seals a value opened with the previous key under the current key", /* open with {B, prev A}, encrypt again, decrypt with { TOKEN_ENCRYPTION_KEY: B } only */);
it("throws TokenKeyError naming TOKEN_ENCRYPTION_KEY when it is missing or empty", async () => {
  await expect(loadTokenKeys(read({}))).rejects.toThrow(TokenKeyError);
  await expect(loadTokenKeys(read({}))).rejects.toThrow("TOKEN_ENCRYPTION_KEY");
});
it("refuses anything without the v1: prefix or too short to hold an IV and a tag", /* "plain", "v2:AAAA", "v1:", "v1:AAAA" -> TokenSealError */);
it("tokenKeyProblem accepts a key with surrounding whitespace and names the secret at fault", () => {
  expect(tokenKeyProblem(read({ TOKEN_ENCRYPTION_KEY: `${A}\n` }))).toBeNull();
  expect(tokenKeyProblem(read({}))).toBe("TOKEN_ENCRYPTION_KEY");
  expect(tokenKeyProblem(read({ TOKEN_ENCRYPTION_KEY: btoa("sixteen-bytes!!!") }))).toBe("TOKEN_ENCRYPTION_KEY");
  expect(tokenKeyProblem(read({ TOKEN_ENCRYPTION_KEY: A, TOKEN_ENCRYPTION_KEY_PREVIOUS: "not base64 at all" }))).toBe("TOKEN_ENCRYPTION_KEY_PREVIOUS");
});
it("tokenAad is connection:<id>:<field> or pending:<id>:<field>", () => {
  expect(tokenAad({ connectionId: "c1" }, "account_id")).toBe("connection:c1:account_id");
  expect(tokenAad({ pendingId: "p1" }, "access_token")).toBe("pending:p1:access_token");
});
it("sealTokens leaves account_id out when accountId is undefined, so a refresh save never overwrites it", async () => {
  // Object.keys(await sealTokens(owner, { accessToken: "a", refreshToken: null }, keys)) equals ["access_token", "refresh_token"]
  // refresh_token stays null; with accountId: "realm-1" the key is present and opens to "realm-1"
});
it("openTokens refuses an access token sealed as the refresh token (field swap)", /* row with the two sealed values swapped -> TokenSealError */);
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/sync/tokenCrypto.test.ts`
Expected: FAIL, cannot resolve `../../../supabase/functions/_shared/tokenCrypto.ts`.

- [ ] **Step 3: Implement `supabase/functions/_shared/tokenCrypto.ts`** with the signatures above. Key parsing: trim, decode standard base64 (also accept base64url), require exactly 32 bytes, import raw as non-extractable `AES-GCM` with `["encrypt", "decrypt"]`. `TOKEN_ENCRYPTION_KEY_PREVIOUS` unset or empty means `previous: null`; set but malformed is a `TokenKeyError`. `decryptToken` tries `current`, then `previous`, and throws `TokenSealError("The stored sign-in could not be read.")` when every key fails or the format is wrong. The layout, which the tests check but do not fully determine:

```
encrypt: iv = crypto.getRandomValues(new Uint8Array(12))
         ct = subtle.encrypt({ name: "AES-GCM", iv, additionalData: utf8(aad), tagLength: 128 }, key, utf8(plain))  // ciphertext || 16-byte tag
         return "v1:" + base64urlNoPad(concat(iv, ct))
decrypt: require prefix "v1:"; bytes = base64urlDecode(rest); require bytes.length >= 12 + 16
         iv = bytes[0..12), ct = bytes[12..); plaintext = utf8decode(subtle.decrypt(same params, key, ct))
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/sync/tokenCrypto.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Gates and commit**

Run `npm run lint && npx vitest run && npm run build`, then `git add supabase/functions/_shared/tokenCrypto.ts src/lib/sync/tokenCrypto.test.ts` and commit "Seal provider tokens with AES-256-GCM in one shared helper" with the trailer.

---

### Task 2: Rococo admin list (migration 0051)

**Files:**
- Create: `supabase/migrations/0051_rococo_admins.sql`
- Create: `supabase/tests/0051_rococo_admins.test.sql`
- Modify: `supabase/tests/stubs.sql` (`auth.users` gains `email_confirmed_at timestamptz`)
- Modify: `supabase/tests/helpers.sql` (`tests.create_person`)
- Modify: `supabase/tests/0033_role_hierarchy.test.sql:509-514` (case `signup_still_creates_profiles`)
- Modify: `src/types/database.ts` (new types)

**Interfaces:**
- Consumes: `private.auth_profile_id()` (0013), `private.audit_change()` (0025), the 0049 body of `public.restrict_signups`.
- Produces:
  - Table `public.rococo_admins (id uuid pk default gen_random_uuid(), email text not null unique, added_by uuid references public.profiles(id) on delete set null, added_at timestamptz not null default now())`, constraint `rococo_admins_email_check check (email ~ '^[^@\s]+@rocococreative\.io$')`.
  - `private.is_rococo_admin()` (same signature) now reads the list.
  - Guard text: `'Rococo admins are added and removed on the Permissions page.'`, `'The last Rococo admin cannot be removed.'`, gate message `'This Rococo address is not on the Rococo admin list. Ask a Rococo admin to add you.'`
  - In `src/types/database.ts`: `export interface RococoAdmin { id: string; email: string; added_by: string | null; added_at: string }` and `export interface RococoAdminEntry extends RococoAdmin { name: string | null; profile_id: string | null }`.

- [ ] **Step 1: Prepare the harness.** In `stubs.sql` add `email_confirmed_at timestamptz` to `auth.users`. In `helpers.sql`, `tests.create_person` inserts `email_confirmed_at = now()` on the `auth.users` row, and when `p_rococo` first runs `insert into public.rococo_admins (email) values (v_email) on conflict (email) do nothing`; it no longer sets `is_rococo_admin` in its update. In `0033_role_hierarchy.test.sql`, case `signup_still_creates_profiles`, insert `'sample.staff@rocococreative.io'` into `public.rococo_admins` before the `auth.users` insert.

- [ ] **Step 2: Write the failing SQL tests** in `0051_rococo_admins.test.sql` (header comment as the 0050 test has; `tests.rows_of` defined as there). People: `rococo` and `rococo2` via `create_person(..., true)`, `kingdom_admin`, `kingdom_employee`. Cases, each a `tests.assert` or `tests.assert_raises`:
  - `listed_and_flagged`: both Rococo profiles have `is_rococo_admin` and their addresses are on the list.
  - `helper_needs_list_and_confirmation`: acting as `rococo`, `private.is_rococo_admin()` is true; after `update auth.users set email_confirmed_at = null` (as system) it is false; after confirming again and `is_active = false` it is false.
  - `domain_alone_is_not_enough`: an `auth.users` insert of `sample.unlisted@rocococreative.io` makes a profile with `is_rococo_admin = false`, and acting as it `private.is_rococo_admin()` is false.
  - `flag_cannot_be_written`: as system, and again acting as `rococo`, `update public.profiles set is_rococo_admin = true where id = <kingdom_admin>` raises `'Rococo admins are added and removed on the Permissions page.'`; setting it to its current value does not raise.
  - `only_rococo_reads_and_writes`: acting as `kingdom_admin`, `select count(*) from public.rococo_admins` is 0, an insert raises `'%row-level security%'`, a delete touches 0 rows.
  - `added_by_is_stamped`: acting as `rococo`, an insert naming `added_by = <kingdom_admin>` stores `added_by = <rococo>`.
  - `email_shape`: an insert of `'someone@example.com'` raises `'%rococo_admins_email_check%'`; an insert of `'sam@rocococreative.io.evil.test'` raises the same.
  - `mixed_case_address_matches_profile`: with an unlisted signed-up `sam@rocococreative.io`, acting as `rococo` insert `'  Sam@RococoCreative.io '`; the stored email is `'sam@rocococreative.io'` and that profile now has `is_rococo_admin` and `is_active`.
  - `remove_turns_the_person_off`: acting as `rococo`, deleting `rococo2`'s entry leaves `rococo2`'s profile with `is_rococo_admin = false` and `is_active = false`; acting as `rococo2`, `private.is_rococo_admin()` is false.
  - `re_add_turns_them_back_on`: acting as `rococo`, re-inserting `rococo2`'s address sets both flags true again.
  - `last_entry_stays`: with only `rococo` left, deleting it raises `'The last Rococo admin cannot be removed.'`; `delete from public.rococo_admins` (all rows, as system) raises the same.
  - `every_change_is_audited`: the inserts and deletes above wrote `audit_events` rows with `table_name = 'rococo_admins'`, `action` in (`insert`, `delete`) and `changed ? 'email'`.
  - `gate_admits_only_listed_rococo`: `public.restrict_signups(jsonb_build_object('user', jsonb_build_object('email', <listed>)))` is `'{}'`; for `'sample.unlisted2@rocococreative.io'` it returns an error whose message is the gate message above; a Kingdom domain address still returns `'{}'`.

- [ ] **Step 3: Run to verify it fails**

Run: `npm run test:sql`
Expected: FAIL in `0051_rococo_admins.test.sql` (relation `public.rococo_admins` does not exist) and in `0033_role_hierarchy.test.sql`.

- [ ] **Step 4: Write `0051_rococo_admins.sql`** (header comment saying why, idempotent throughout), in this order:
  1. Create the table and constraint; `alter table ... enable row level security`; `revoke all on public.rococo_admins from public, anon, authenticated`; `grant select, insert, delete on public.rococo_admins to authenticated`; policies for select, insert (`with check`) and delete, each `using (private.is_rococo_admin())`.
  2. Seed: `insert into public.rococo_admins (email) select lower(email) from public.profiles where is_rococo_admin and is_active on conflict (email) do nothing;` (before the sync triggers exist on a first paste, so no profile is touched; an inactive flagged profile is not reactivated). A flagged profile off the domain makes the check fail and the paste stop, loudly, rather than lock anyone out.
  3. `public.rococo_admins_stamp()` BEFORE INSERT: `new.email := lower(trim(new.email))`, `new.added_by := private.auth_profile_id()`, `new.added_at := now()`.
  4. `public.rococo_admins_sync_add()` AFTER INSERT and `public.rococo_admins_sync_remove()` AFTER DELETE, row level, security definer: set `hub.rococo_sync` to `'1'` (transaction-local), `update public.profiles set is_rococo_admin = <true|false>, is_active = <true|false> where lower(email) = <new|old>.email`, set it back to `''`.
  5. Last entry: `public.rococo_admins_hold()` BEFORE DELETE FOR EACH STATEMENT takes `pg_advisory_xact_lock(hashtext('public.rococo_admins'))`; `public.rococo_admins_keep_one()` AFTER DELETE FOR EACH STATEMENT raises `'The last Rococo admin cannot be removed.'` (errcode `check_violation`) when no row is left. The lock serializes two admins removing each other, and the after-check's fresh snapshot then sees the other's committed delete.
  6. `rococo_admins_audit` AFTER INSERT OR DELETE, `private.audit_change('email')`.
  7. `public.guard_rococo_flag()` and trigger `profiles_guard_rococo_flag` BEFORE INSERT OR UPDATE OF is_rococo_admin ON public.profiles, for everyone including system: on insert, `new.is_rococo_admin := exists (select 1 from public.rococo_admins r where r.email = lower(new.email))` (this is what makes sign-up read the list, so `handle_new_user` is left as 0049 wrote it); on update, a changed value without `hub.rococo_sync = '1'` raises the guard text.
  8. Bring the column in step: with `hub.rococo_sync` set, `update public.profiles set is_rococo_admin = false where is_rococo_admin and lower(email) not in (select email from public.rococo_admins)`.
  9. `create or replace function private.is_rococo_admin()`, `language sql stable security definer set search_path = ''`: true only when a row exists in `public.profiles p join auth.users u on u.id = p.user_id join public.rococo_admins r on r.email = lower(u.email)` with `p.user_id = (select auth.uid())`, `p.is_active` and `u.email_confirmed_at is not null`. Keep 0009's revoke and grant lines.
  10. `create or replace function public.restrict_signups(event jsonb)`: the 0049 body with one change, the Rococo branch: `v_domain = 'rocococreative.io'` admits only when `exists (select 1 from public.rococo_admins r where r.email = v_email)`, and otherwise returns the 403 with the gate message (an unlisted Rococo address with a pending invitation is still refused). Keep 0049's grant and revoke lines.
  Every new trigger function gets `revoke execute ... from public, anon, authenticated`.

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test:sql`
Expected: `SQL tests: ... 0 failed`, with 0051 applied and re-applied.

- [ ] **Step 6: Add the two types** to `src/types/database.ts` (next to `Profile`, with a one-line comment that the list is the source of truth and `profiles.is_rococo_admin` mirrors it), then run `npm run lint && npx vitest run && npm run build`.

- [ ] **Step 7: Commit** the six files: "Make Rococo admin an explicit list the database enforces" with the trailer.

---

### Task 3: Connection secrets off the browser (migration 0052)

**Files:**
- Create: `supabase/migrations/0052_connection_secrets.sql`
- Create: `supabase/tests/0052_connection_secrets.test.sql`
- Modify: `src/types/database.ts:867-882` (`CompanyConnection` loses `external_account_id`, with a comment that the column is always null since 0052 and the id lives sealed in `connection_tokens`)
- Modify: `src/services/connections.ts:9` (drop `external_account_id` from `COLUMNS`)
- Modify: `src/components/settings/ConnectorPanel.tsx:132`, `src/components/settings/ConnectorCard.tsx:40` (account reads `row.external_account_name ?? <existing fallback>`)
- Modify: `src/test/fixtures.ts:613,618,619`, `src/test/mocks/connections.ts:95`, `src/lib/attention.test.ts:94`, `src/lib/connectors.test.ts:19`, `src/pages/connections-catalog.test.tsx:366-370` (rename to `reads 'Not recorded' for the account when the row has no account name`)

**Interfaces:**
- Consumes: 0019, 0025, 0030 tables.
- Produces:
  - Table `public.connection_pending (id uuid primary key, company_id uuid not null references public.companies(id) on delete cascade, provider text not null, started_by uuid not null references public.profiles(id) on delete cascade, account_name text, access_token text not null, refresh_token text, account_id text, access_expires_at timestamptz, refresh_expires_at timestamptz, scopes text, expires_at timestamptz not null, created_at timestamptz not null default now())`, index on `expires_at`, constraint `connection_pending_sealed`.
  - `public.connection_tokens.account_id text`, constraint `connection_tokens_sealed`.
  - Constraint `company_connections_no_account_id check (external_account_id is null)`.
  - Sealed check, both tables: `access_token like 'v1:%' and (refresh_token is null or refresh_token like 'v1:%') and (account_id is null or account_id like 'v1:%')`.

- [ ] **Step 1: Write the failing SQL tests** (`0052_connection_secrets.test.sql`). Setup as system: a Kingdom `company_connections` row and `kingdom_admin`. Cases:
  - `pending_is_service_only`: acting as `kingdom_admin`, `select` from `public.connection_pending` raises `'%permission denied%'`; as `anon` the same; after `set local role service_role` an insert with sealed values succeeds and reads back (then `reset role`).
  - `tokens_must_be_sealed`: as system, a `connection_tokens` insert with `access_token = 'plain'` raises `'%connection_tokens_sealed%'`; `refresh_token = 'plain'` and `account_id = 'plain'` raise the same; all three `'v1:x'` succeeds.
  - `pending_must_be_sealed`: the same three against `connection_pending` raise `'%connection_pending_sealed%'`.
  - `no_account_id_on_the_connection_row`: `update public.company_connections set external_account_id = 'realm-1'` raises `'%company_connections_no_account_id%'`.
  - `audit_never_records_the_account_id`: after an insert and a status update of a connection, no `audit_events` row with `table_name = 'company_connections'` has `changed ? 'external_account_id'`, and the update's `changed` has `status`.
  - `pending_goes_with_its_starter`: deleting the starting profile (as system) deletes their pending row.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:sql`
Expected: FAIL in `0052_connection_secrets.test.sql` (relation `public.connection_pending` does not exist).

- [ ] **Step 3: Write `0052_connection_secrets.sql`** (why comment; every constraint added through `drop constraint if exists` then `add`), in this order, because the audit trigger must stop watching the column before the column is cleared:
  1. Recreate `company_connections_audit` with `private.audit_change('status', 'provider')`.
  2. `update public.company_connections set external_account_id = null where external_account_id is not null;` then add `company_connections_no_account_id`.
  3. `update public.audit_events set changed = changed - 'external_account_id' where table_name = 'company_connections' and changed ? 'external_account_id';`
  4. `update public.sync_records set source_ref = source_ref - 'realmId' where source_ref ? 'realmId';`
  5. `alter table public.connection_tokens add column if not exists account_id text;` then add `connection_tokens_sealed`. Live holds no tokens; a plaintext row would make the paste fail loudly, which is intended.
  6. Create `public.connection_pending` with `connection_pending_sealed`; enable RLS with no policies; `revoke all ... from public, anon, authenticated`; `grant select, insert, update, delete ... to service_role`.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:sql`
Expected: `0 failed`.

- [ ] **Step 5: Take `external_account_id` off the app** (the files listed above), then run `npm run lint && npx vitest run && npm run build`.
Expected: all pass, and `grep -rn external_account_id src --include=*.ts --include=*.tsx` lists only `src/lib/audit.ts` and `src/lib/audit.test.ts` (the label for historic events stays).

- [ ] **Step 6: Commit** "Keep provider account ids and plaintext tokens out of every readable row" with the trailer.

---

### Task 4: Sync reads sealed tokens; realmId off records and errors; setup status

**Files:**
- Modify: `supabase/functions/_shared/sync/types.ts:28-31`
- Modify: `supabase/functions/_shared/sync/quickbooks.ts`
- Modify: `supabase/functions/_shared/sync/googleSheets.ts` (`accessToken`, `sheetsGet`, `describeSheet` signature)
- Modify: `supabase/functions/_shared/sync/links.ts:37-41`
- Modify: `supabase/functions/_shared/providerSecrets.ts`
- Modify: `supabase/functions/connections/sync.ts` (token store, `CONNECTION_COLUMNS`, `ConnectionRow`, `runOne`, describe, key loading)
- Modify: `supabase/functions/connections/index.ts:348-353` (`handleStatus`)
- Test: `src/lib/sync/quickbooks.test.ts`, `googleSheets.test.ts`, `links.test.ts`, `runner.test.ts`, `providerSecrets.test.ts`; `src/pages/pages.test.tsx:1817` (drop `realmId` from the fixture ref)

**Interfaces:**
- Consumes: `loadTokenKeys`, `openTokens`, `sealTokens`, `tokenKeyProblem`, `TokenKeyError`, `TOKENS_NOT_SET_UP` (Task 1); `connection_tokens.account_id` (Task 3).
- Produces:
  - `types.ts`: `export interface ConnectionRef { id: string }`; `export interface StoredTokens extends ProviderTokens { accountId: string | null }`; `TokenStore.load(connectionId: string): Promise<StoredTokens>` (`save` unchanged, never touches the account id).
  - `quickbooks.ts`: `projectEntities(entities, fieldMap, entity, sandbox): RawTable` (no realmId; ref is `{ entity, Id, sandbox }`).
  - `googleSheets.ts`: `describeSheet(deps: GoogleDeps, connection: ConnectionRef, spreadsheetId: string, gid: number | null)`.
  - `providerSecrets.ts`: `export const FLOW_SECRETS = ["CONNECTIONS_STATE_SECRET", "TOKEN_ENCRYPTION_KEY"] as const; export type FlowSecret = (typeof FLOW_SECRETS)[number]; export function flowSecretsReady(read: (name: string) => string | undefined): Record<FlowSecret, boolean>`.
  - `sync.ts`: `export function createTokenStore(service: SupabaseClient, keys: TokenKeys): TokenStore`.
  - `/status` answers `{ keys: Record<ProviderKey, boolean>, secrets: Record<FlowSecret, boolean> }`.

- [ ] **Step 1: Write the failing tests**
  - `quickbooks.test.ts`: `connection` becomes `{ id: "sample-conn" }`; the harness `load` returns `{ ...tokens, accountId: "sample-realm" }`. Update every ref expectation to `{ entity: "Invoice", Id: "101", sandbox: true }` (and Payment alike). New: `reads the company from the stored sign-in` (the query URL contains `/v3/company/sample-realm/query`); `fails with 'QuickBooks did not say which company is connected. Connect QuickBooks again in Settings.' when the stored sign-in has no account id` (accountId `null`, then `"  "`); `a fetch that throws reads 'QuickBooks did not answer. Try again later.' and never the address` (fetch rejects with `new TypeError("error sending request for url (https://sandbox-quickbooks.api.intuit.com/v3/company/sample-realm/query)")`; the rejection message equals the line and does not contain `sample-realm`); the same for a refresh whose fetch throws.
  - `googleSheets.test.ts`: `connection` becomes `{ id: "connection-1" }`; new `a fetch that throws reads 'Google Sheets did not answer. Try again later.'` for a metadata fetch and for a refresh fetch.
  - `links.test.ts`: `recordLink({ entity: "Invoice", Id: "101", sandbox: true })` equals the sandbox link object of today; a legacy ref that still carries `realmId` gives the same href; the no-link cases drop `realmId`.
  - `runner.test.ts`: `connection` becomes `{ id: "connection-1" }`.
  - `providerSecrets.test.ts`: `FLOW_SECRETS` equals `["CONNECTIONS_STATE_SECRET", "TOKEN_ENCRYPTION_KEY"]`; `flowSecretsReady` is all true with a state secret and a valid key; `CONNECTIONS_STATE_SECRET: ""` reads false; a 16-byte key, a missing key, and a valid key with a malformed `TOKEN_ENCRYPTION_KEY_PREVIOUS` each read `TOKEN_ENCRYPTION_KEY: false`; a key with a trailing newline reads true.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/sync`
Expected: FAIL (refs still carry `realmId`; `flowSecretsReady` not exported; type errors on `ConnectionRef`).

- [ ] **Step 3: Implement the shared changes.** QuickBooks: `accessToken(deps, connectionId)` returns `{ token: string; realmId: string }`, checking `old.accountId` first (blank or null is the "did not say" line) and wrapping both `deps.fetch` calls so a thrown fetch becomes `NO_ANSWER`; `createQboClient` wraps its fetch the same way. Google: `sheetsGet` and the refresh wrap a thrown fetch as `"Google Sheets did not answer. Try again later."`. `recordLink`'s QuickBooks branch requires only `entity === "Invoice"` and a non-blank string `Id`. `flowSecretsReady` reads `TOKEN_ENCRYPTION_KEY` as `tokenKeyProblem(read) === null`.

- [ ] **Step 4: Wire the function.** `createTokenStore(service, keys)`: `load` selects `access_token, refresh_token, account_id, access_expires_at, refresh_expires_at` and returns `openTokens({ connectionId }, row, keys)` plus the expiries; a `TokenSealError` becomes `"This connection has no sign-in on file. Connect it again in Settings."`; `save` writes `sealTokens({ connectionId }, { accessToken, refreshToken }, keys)` plus expiries. `CONNECTION_COLUMNS` is `"id, company_id, provider, status"`; `runOne` and describe pass `{ id }`. `handleSyncRun` and `handleSyncDescribe` load keys after their auth checks and turn a `TokenKeyError` into `HttpError(503, TOKENS_NOT_SET_UP)`; `handleSyncTick` does the same after its secret check. `handleStatus` returns `{ keys, secrets: flowSecretsReady(read) }`.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/lib/sync src/pages/pages.test.tsx`
Expected: PASS.

- [ ] **Step 6: Gates and commit.** `npm run lint && npx vitest run && npm run build`; commit "Read sealed tokens in sync and keep the realm id out of records and errors" with the trailer.

---

### Task 5: Connect state and flow rules (pure)

**Files:**
- Create: `supabase/functions/_shared/connectState.ts`
- Create: `supabase/functions/_shared/connectFlow.ts`
- Test: `src/lib/sync/connectState.test.ts`, `src/lib/sync/connectFlow.test.ts`

**Interfaces:**
- Consumes: `PROVIDER_KEYS`, `ProviderKey` (`_shared/providers.ts`).
- Produces, `connectState.ts` (the wire format is today's, so a state issued before deploy still reads):
  - `export interface StateClaims { c: string; p: ProviderKey; u: string; r: string; n: string; e: number }`
  - `export type StateReading = { kind: "valid"; claims: StateClaims } | { kind: "expired"; claims: StateClaims } | { kind: "invalid" }`
  - `export async function signState(claims: StateClaims, secret: string): Promise<string>` (throws on an empty secret)
  - `export async function readState(state: string | null, secret: string, nowSeconds: number): Promise<StateReading>` (never throws)
- Produces, `connectFlow.ts`:
  - `export const CONNECT_ERROR_TEXT` with exactly these keys and lines:
    - `cancelled`: "The sign-in was cancelled or refused. Nothing changed."
    - `expired`: "This sign-in link was already used or has expired. Start the connection again."
    - `not_set_up`: "This tool is not set up yet. Ask Rococo Creative to finish the setup."
    - `refused`: "The tool refused the sign-in. Try again from Settings."
    - `one_location`: "Choose one sub-account when installing; an agency-wide install is not supported."
    - `no_account`: "The tool did not say which account was connected. Try again from Settings."
    - `failed`: "The connection could not be finished. Try again from Settings."
    - `invalid`: "The connection did not finish. Start again from Settings."
  - `export type ConnectErrorKey = keyof typeof CONNECT_ERROR_TEXT`
  - `export function connectErrorText(value: string | null): string | null` (null for null; a known key's line; anything else the `invalid` line)
  - `export const PENDING_TTL_SECONDS = 600`
  - `export const PENDING_SOMEONE_ELSE = "This connection was started by someone else, so it can't be finished here. Ask them to finish it, or start again."`
  - `export const PENDING_GONE = "This connection request has expired. Start the connection again."`
  - `export type PendingVerdict = "ready" | "someone_else" | "gone"`
  - `export function pendingVerdict(row: { started_by: string; expires_at: string } | null, callerProfileId: string, now: Date): PendingVerdict`
  - `export type PendingAnswer = { status: "ready"; provider: ProviderKey; account_name: string | null; company_name: string } | { status: "someone_else" } | { status: "gone" }`
  - `export function parsePendingAnswer(value: unknown): PendingAnswer | null`
  - `export function isPendingId(value: unknown): value is string` (a lowercase or uppercase 8-4-4-4-12 hex uuid)
  - `export function withQuery(base: string, params: Record<string, string>): string`
  - `export function fallbackReturn(appUrl: string | undefined, appOrigins: readonly string[]): string | null` (origin of `APP_URL`, else the first `APP_ORIGINS` entry, plus `/settings/connections`; null when neither parses)
  - `export function failureLocation(reading: StateReading, fallback: string | null, key: ConnectErrorKey): string | null` (valid: `claims.r` with `connect_error=<key>`; expired: `claims.r` with `connect_error=expired`; invalid: `fallback` with `connect_error=invalid`, or null)

- [ ] **Step 1: Write the failing tests** (both files `// @vitest-environment node` after the why comment). Secret `"sample-state-secret"`, `now = 1_790_000_000`, claims `{ c: "co1", p: "quickbooks", u: "pr1", r: "https://app.example/settings/connections/co1", n: "n1", e: now + 600 }`.
  - `connectState.test.ts`: `reads back a state it signed` (`kind "valid"`, claims equal); `reads a signed state past its expiry as expired, with its return address`; `reads a changed payload, a changed signature, another secret, an empty secret, null, "", "no-dot", "%%%.%%%" and a signed non-JSON payload as invalid, without throwing`; `reads signed claims of the wrong shape as invalid` (an unknown provider `"xero"`, `e` as a string, a missing `u`); `signState refuses an empty secret`.
  - `connectFlow.test.ts`: `connectErrorText` maps every key to its line, `null` to null, and `"The sign-in was cancelled or refused. Nothing changed."` (an old full line) and `"unknown"` to the `invalid` line; every line has no em dash. `pendingVerdict`: `null` row is gone; `expires_at` one second before `now` is gone; another caller on an unexpired row is someone_else; the starter is ready; an expired row for another caller is gone. `parsePendingAnswer`: accepts the three shapes, and returns null for a ready answer with an unknown provider, a non-string `company_name`, a numeric `account_name`, or `{ status: "other" }`. `isPendingId` accepts `crypto.randomUUID()` output and rejects `"abc"`, `""`, `42`, a uuid with a trailing space. `withQuery("https://a.example/x", { pending: "p 1" })` is `"https://a.example/x?pending=p+1"`. `fallbackReturn("https://hub.example/anything", [])` is `"https://hub.example/settings/connections"`; `(undefined, ["https://b.example"])` uses `b`; `("not a url", [])` is null. `failureLocation` gives the three locations above and null for invalid with no fallback.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/sync/connectState.test.ts src/lib/sync/connectFlow.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement both modules.** `connectState.ts` keeps index.ts's format: `base64url(JSON(claims)) + "." + base64url(HMAC-SHA256(secret, payload))`, compared in constant time; any decode, parse or shape failure is `invalid`; the signature is checked before expiry.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/lib/sync/connectState.test.ts src/lib/sync/connectFlow.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates and commit.** `npm run lint && npx vitest run && npm run build`; commit "Put connect state, error keys and pending rules in shared tested modules" with the trailer.

---

### Task 6: Function: connect, confirm, finish, discard, sweep, disconnect

**Files:**
- Create: `supabase/functions/_shared/headers.ts`
- Create: `supabase/functions/connections/oauth.ts` (the provider registry moved out of index.ts)
- Create: `supabase/functions/connections/pending.ts`
- Modify: `supabase/functions/connections/index.ts` (routes header comment, start, callback, new routes, disconnect, router)
- Modify: `supabase/functions/connections/http.ts:45-80`
- Modify: `supabase/functions/connections/sync.ts` (tick sweeps)

**Interfaces:**
- Consumes: Task 1 (`loadTokenKeys`, `sealTokens`, `openTokens`, `tokenKeyProblem`, `TOKENS_NOT_SET_UP`), Task 5 (everything in `connectState.ts` and `connectFlow.ts`), Task 3 tables.
- Produces:
  - `_shared/headers.ts`: `export const NO_STORE = { "Cache-Control": "no-store" } as const;`
  - `oauth.ts`: `export class ConnectError extends Error { key: ConnectErrorKey; constructor(key: ConnectErrorKey) }`; `export interface Exchanged` (today's, unchanged); `export interface ProviderDef` (today's, with `revoke?(args): Promise<boolean>` answering `response.ok`); `export const REDIRECT_URI: string`; `export function providerFor(value: unknown): ProviderDef & { key: ProviderKey }`; `export function credentialsFor(def: ProviderDef): Credentials` (throws `HttpError(503)` as today); `export async function revokeGrant(def: ProviderDef & { key: ProviderKey }, tokens: { accessToken: string; refreshToken: string | null }): Promise<boolean>` (false with no `revoke`, on a throw, or on a non-ok answer; logs `"revoke failed"`, the provider key and the status only).
  - `pending.ts`: `export interface PendingRow` (the 0052 columns); `export async function parkPending(admin: SupabaseClient, input: { companyId: string; provider: ProviderKey; startedBy: string; exchanged: Exchanged }, keys: TokenKeys, now: Date): Promise<string>` (mints `crypto.randomUUID()` as the id, seals under `{ pendingId }`, `expires_at = now + PENDING_TTL_SECONDS`); `export async function loadPending(admin, id: string): Promise<PendingRow | null>`; `export async function claimPending(admin, id: string): Promise<PendingRow | null>` (a `delete ... returning`, so only one caller ever gets the row); `export async function sweepExpiredPending(admin, now: Date): Promise<number>` (deletes rows past `expires_at`, then for each, best effort: open under `{ pendingId }` and `revokeGrant`; keys or credentials missing only skip the revoke).
  - `http.ts`: `signedInUser` also returns `emailConfirmed: boolean` (from `user.email_confirmed_at`); `requireAdmin` and `requireMember` honour `is_rococo_admin` only with `emailConfirmed`; `export async function signedInProfileId(req: Request): Promise<string>` (401 `"Sign in first."` when no profile).
  - Routes (all POST, JSON, signed in): `/pending { pending_id }` -> `PendingAnswer`; `/finish { pending_id }` -> `{ ok: true, provider }`; `/discard { pending_id }` -> `{ ok: true, revoked: boolean }`; `/disconnect` -> `{ ok: true, revoked: boolean }`.

- [ ] **Step 1: Move the registry.** Cut `ProviderDef`, the three providers, `PROVIDERS`, `providerFor`, `credentialsFor`, `REDIRECT_URI` and `secondsFromNow` from index.ts into `oauth.ts`. In each `exchange`, a token answer that is not ok or not JSON throws `new ConnectError("refused")`; GoHighLevel without `locationId` throws `"one_location"`; QuickBooks without `realmId` and Google without an email throw `"no_account"`. Each `revoke` returns `response.ok`. Key strings appear in these files only as `new ConnectError("<key>")` (Task 7's scan reads them that way).

- [ ] **Step 2: Rewrite `/callback` so every outcome is a bare 302.** One `redirect(location: string | null)` helper: status 302, `null` body, headers `{ ...NO_STORE, "Referrer-Policy": "no-referrer" }` plus `Location` when not null (null only when neither `APP_URL` nor `APP_ORIGINS` is set). The body of the handler, inside one try whose catch maps a `ConnectError` to its key and anything else to `"failed"`, logging `"callback failed"` and `err.name` only:
  1. `reading = readState(state, STATE_SECRET, now)`; not valid -> `failureLocation(reading, fallbackReturn(Deno.env.get("APP_URL"), APP_ORIGINS), "invalid")`.
  2. Redeem the nonce as today: a database error -> `failed`; no row -> `expired`.
  3. No `code`, or an `error` parameter -> `cancelled`.
  4. `tokenKeyProblem` or missing credentials -> `not_set_up`.
  5. `exchange`; then `parkPending(...)`; if parking fails, `revokeGrant` the fresh tokens and answer `failed`.
  6. Success -> `withQuery(claims.r, { pending: id })`. Nothing else goes on the address.
  The pending id is minted fresh here, never the state nonce: the nonce sits readable in the state payload the starting admin holds, so keying on it would let that admin finish a connection whose link they forwarded to someone else. Only the browser that came back from the provider learns the id.

- [ ] **Step 3: Add `/pending`, `/finish`, `/discard`.** Each reads `pending_id`; `!isPendingId` reads as gone. `/pending`: `signedInProfileId`, `loadPending`, `pendingVerdict`; ready answers with the row's provider and `account_name` and the company's name (service read); the other two answer their bare status. `/finish`, in this order: verdict (someone_else -> 403 `PENDING_SOMEONE_ELSE`, gone -> 410 `PENDING_GONE`); `requireAdmin(req, row.company_id)`; `loadTokenKeys` (-> 503 `TOKENS_NOT_SET_UP`); `claimPending` (null -> 410 `PENDING_GONE`); open under `{ pendingId }`; upsert `company_connections` on `company_id,provider` with `status: "connected"`, `external_account_name: row.account_name`, `scopes`, `connected_by: row.started_by`, `connected_at`, `last_error: null`; upsert `connection_tokens` with `sealTokens({ connectionId }, { accessToken, refreshToken, accountId }, keys)` and the expiries; a token write failure undoes the row to `not_connected` as today, revokes, and answers 500 `"The connection could not be saved."`. `/discard`: verdict as `/finish`; `claimPending`; open and `revokeGrant` (keys missing -> `revoked: false`).

- [ ] **Step 4: Start, tick and disconnect.** `/start` answers 503 `TOKENS_NOT_SET_UP` when `tokenKeyProblem` names a secret, and after the state sweep runs `sweepExpiredPending` best effort. `handleSyncTick` runs `sweepExpiredPending` best effort after its secret check and logs `"pending swept"` with the count. `/disconnect` reads `access_token, refresh_token, account_id`, opens them, `revokeGrant`s, deletes the tokens, sets the row `not_connected` (its update no longer names `external_account_id`), and answers `{ ok: true, revoked }`: no row is `revoked: true`; no tokens, unreadable tokens or missing keys is `revoked: false`. Update the routes comment at the top of index.ts to list the three new routes and `APP_URL`, `TOKEN_ENCRYPTION_KEY`, `TOKEN_ENCRYPTION_KEY_PREVIOUS`.

- [ ] **Step 5: Verify**

Run: `npm run lint && npx vitest run && npm run build`
Expected: PASS. Then `grep -n "HttpError\|json(" supabase/functions/connections/index.ts` shows no `json(` and no thrown `HttpError` inside `handleCallback`.

- [ ] **Step 6: Commit** the six files: "Finish a connection only when the admin who started it confirms it" with the trailer.

---

### Task 7: Function hygiene: no-store, log lines, pinned imports

**Files:**
- Modify: `supabase/functions/connections/http.ts:5,84` (`json`), `index.ts` (OPTIONS, any remaining log lines), `sync.ts:9,44,65,234,309`
- Modify: `supabase/functions/notify/index.ts:30-31,62,327`
- Test: `src/lib/sync/functionHygiene.test.ts`

**Interfaces:**
- Consumes: `NO_STORE` (Task 6), `CONNECT_ERROR_TEXT` (Task 5).
- Produces: pinned specifiers `npm:@supabase/supabase-js@2.116.0` and `npm:@supabase/functions-js@2.116.0/src/edge-runtime.d.ts` (the version installed in `node_modules`, so it is known to exist on npm; the second replaces the unpinned `jsr:` types import).

- [ ] **Step 1: Write the failing source scan** `src/lib/sync/functionHygiene.test.ts`, reading files with the `node:fs` pattern `src/lib/sync/providers.test.ts` uses (a non-literal module name and a URL built through a variable), over every `.ts` under `supabase/functions/connections`, `supabase/functions/notify` and `supabase/functions/_shared`:
  - `every response the connections and notify functions build says no-store`: every line containing `new Response(` in `connections/http.ts`, `connections/index.ts` and `notify/index.ts` also contains `NO_STORE`, and each file contains at least one.
  - `every import names an exact version`: every `npm:` or `jsr:` specifier matches `/^(npm|jsr):(@[\w-]+\/)?[\w.-]+@\d+\.\d+\.\d+(\/|$)/`, and at least three were found.
  - `no log line carries an error object, an error message or a body`: no `console.(log|error|warn)(...)` call (taken to its closing parenthesis on the same line) matches `/\.message\b/` or `/[(,]\s*(err|error|e|body|text)\s*[,)]/`.
  - `every connect error the function sends is one the app can show`: every `new ConnectError("<key>")` in `connections/*.ts` names a key of `CONNECT_ERROR_TEXT`, and at least five distinct keys appear.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/sync/functionHygiene.test.ts`
Expected: FAIL on no-store (`json` and OPTIONS), on the floating imports, and on the log lines in `sync.ts` and `index.ts` that pass `.message`.

- [ ] **Step 3: Fix.** `json()` in both functions spreads `NO_STORE` into its headers; both OPTIONS answers use `{ ...CORS, ...NO_STORE }`. Pin the imports. Every log line keeps its context string and ids and logs `error.code` (database) or `err instanceof Error ? err.name : "unknown"` in place of any `.message`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/sync/functionHygiene.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates and commit.** `npm run lint && npx vitest run && npm run build`; commit "Say no-store on every function response, log ids only, and pin the function imports" with the trailer.

---

### Task 8: App: confirm panel, disconnect line, setup secrets, error keys

**Files:**
- Modify: `src/lib/connectors.ts` (+ `src/lib/connectors.test.ts`)
- Modify: `src/services/connections.ts`, `src/test/mocks/connections.ts`
- Create: `src/components/settings/PendingConnectPanel.tsx`
- Modify: `src/components/settings/ConnectionsCatalog.tsx` (remove `KNOWN_CONNECT_ERRORS` at 31-52; `readOutcome`; `rococoLineFor`; `keysIn`; the pending panel; the disconnect note)
- Modify: `src/components/settings/ConnectorPanel.tsx` (`onChanged(note: string | null)`)
- Test: `src/pages/connections-catalog.test.tsx`

**Interfaces:**
- Consumes: `connectErrorText`, `parsePendingAnswer`, `PendingAnswer`, `PENDING_SOMEONE_ELSE`, `PENDING_GONE` (Task 5); `FLOW_SECRETS`, `FlowSecret` (Task 4); the four routes (Task 6).
- Produces:
  - `lib/connectors.ts`: `export interface ConnectorSetup { keys: Record<ConnectionProvider, boolean>; missingSecrets: FlowSecret[] }`; `export function parseConnectorSetup(answer: unknown): ConnectorSetup | null` (null unless `keys` has a boolean for every provider and `secrets` a boolean for every `FLOW_SECRETS` name; `missingSecrets` in `FLOW_SECRETS` order); `export function confirmConnectLine(tool: string, accountName: string | null, companyName: string): string`; `export function stillListedLine(tool: string): string`.
  - `services/connections.ts`: `loadConnectorSetup(companyId: string): Promise<ConnectorSetup | null>`; `disconnectConnection(companyId: string, provider: ConnectionProvider): Promise<{ revoked: boolean }>` (a missing `revoked` reads false); `readPendingConnection(pendingId: string): Promise<PendingAnswer>` (an unparseable answer throws `"The connection service did not answer. Try again in a moment."`); `finishConnection(pendingId: string): Promise<ConnectionProvider>`; `discardConnection(pendingId: string): Promise<{ revoked: boolean }>`.
  - Mock: the same five, plus `setMockPending(id: string, answer: PendingAnswer): void` and `setMockMissingSecrets(names: FlowSecret[]): void`; `setMockConnectorSetup` and `holdMockConnectorSetup` keep taking a key map; `finishConnection` marks that company's row connected with the answer's `account_name` and forgets the id (a second call throws `PENDING_GONE`); `discardConnection` and `disconnectConnection` answer `revoked: provider !== "gohighlevel"`; `resetMockConnections` clears pending ids and `resetMockConnectorSetup` clears missing secrets.
  - `PendingConnectPanel` props: `{ company: Company; pendingId: string; onDone: (outcome: { tone: "success" | "info" | "warning"; text: string; provider?: ConnectionProvider } | null) => void }`.

Exact copy (via the helpers above):
- With a name: `Connect ${tool} account ${accountName} to ${companyName}?`
- Without: `Connect ${tool} to ${companyName}? ${tool} did not give this account's name. Only continue if you just approved access in ${tool}.`
- `stillListedLine`: `${tool} may still list Company Hub; remove it there too.`
- After Disconnect without revocation (warning): `Disconnected here. ${stillListedLine(tool)}`
- After Cancel: `Nothing was connected.` (info), or `Nothing was connected. ${stillListedLine(tool)}` (warning) without revocation.
- Rococo line when secrets are missing on a live sign-in card: `Rococo: connections are not set up. Set ${names.join(" and ")}.`
- Panel title `Confirm the connection`; buttons `Connect`, `Cancel`, and `Close` for the someone-else and gone states. `tool` is `CONNECTION_PROVIDER_LABELS[provider]`.

- [ ] **Step 1: Write the failing tests.**
  - `connectors.test.ts`: `parseConnectorSetup` accepts a full answer and lists `["TOKEN_ENCRYPTION_KEY"]` when that one is false; returns null with `secrets` absent, with a provider missing, or with a non-boolean. `confirmConnectLine` and `stillListedLine` give the lines above, with no em dash.
  - `connections-catalog.test.tsx` (path `/settings/connections?pending=<id>` with `setMockPending`):
    - `shows 'Connect QuickBooks Online account Sample Books LLC to Kingdom...?' and Connect attaches it, says 'QuickBooks Online is connected.' and clears the address`
    - `reads the no-name line when the tool gave no account name`
    - `the confirm line names the pending connection's company` (answer `company_name: "Klasik Sample"` while the active company is Kingdom)
    - `renders an odd account name as text` (`<b>Smith & "Sons"</b>` appears literally)
    - `Cancel says 'Nothing was connected.'; for GoHighLevel it adds 'GoHighLevel may still list Company Hub; remove it there too.'`
    - `someone else's pending reads the someone-else line with only Close`
    - `an expired or unknown pending reads 'This connection request has expired. Start the connection again.'`
    - `a pending link already finished reads the expired line, on opening or on a second Connect` (after `finishConnection(id)` has run once, rendering with that id shows the expired line; and with a ready answer and `vi.spyOn(connectionsService, "finishConnection").mockRejectedValueOnce(new Error(PENDING_GONE))`, pressing Connect shows the expired line and the card stays Not connected)
    - `Disconnect of GoHighLevel says 'Disconnected here. GoHighLevel may still list Company Hub; remove it there too.'; a QuickBooks Disconnect says nothing more`
    - `with TOKEN_ENCRYPTION_KEY missing, every live sign-in card reads Not available yet and a Rococo admin reads 'Rococo: connections are not set up. Set TOKEN_ENCRYPTION_KEY.'`
    - Replace the test at line 261 with `shows the line for a known ?connect_error= key and the generic line for an old full sentence or an unknown key` (`cancelled` shows its line; the old full sentence and `"x"` show `"The connection did not finish. Start again from Settings."`).

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/connectors.test.ts src/pages/connections-catalog.test.tsx`
Expected: FAIL (helpers and mock functions not defined; the catalog shows no panel).

- [ ] **Step 3: Implement.** Services and mock first (the parity test then passes). The catalog reads `pending` once into state and keeps it on the address until the panel calls `onDone`, then deletes `pending` with `replace` and reloads the rows; a success outcome goes through the existing "is connected" rule. `keysIn` is `false` for every card with a provider when `setup.missingSecrets.length > 0`, else as today from `setup.keys`. `rococoLineFor` checks missing secrets before app keys for live sign-in tools. `ConnectorPanel` passes `Disconnected here. ${stillListedLine(connector.name)}` to `onChanged` when `revoked` is false, and null otherwise, and the catalog shows it as a warning `Notice`. The panel uses `Modal`, `Button`, `Notice` and `Skeleton` only, and shows `errorMessage(err)` from a failed Connect or Cancel inside itself.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/lib/connectors.test.ts src/pages/connections-catalog.test.tsx src/test/mocks/parity.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates, demo check and commit.** `npm run lint && npx vitest run && npm run build`; `npm run demo` and open `/settings/connections` to see the cards unchanged. Commit "Confirm a connection in the hub and say when a tool may still list it" with the trailer.

---

### Task 9: App: Rococo admins, Users badge, error text, cache header

**Files:**
- Create: `src/services/rococoAdmins.ts`, `src/test/mocks/rococoAdmins.ts`
- Create: `src/components/rococo/RococoAdminsSection.tsx`
- Modify: `src/pages/rococo/PermissionsPage.tsx` (render the section after the table)
- Modify: `src/pages/rococo/UsersPage.tsx:96` and its header area
- Modify: `src/services/profiles.ts:69` (drop `is_rococo_admin` from `ProfilePatch`), `src/test/mocks/profiles.ts` (add `setMockRococoFlag`)
- Modify: `src/test/setup.ts` (reset the new mock)
- Modify: `src/lib/errors.ts`, `src/lib/errors.test.ts`
- Modify: `vercel.json`; Create: `src/test/vercelHeaders.test.ts`
- Test: `src/pages/rococo-permissions.test.tsx`; update `src/pages/clarity-library.test.tsx:147`, `src/test/mocks/profiles.test.ts:19-21`, `src/pages/qa-f3.test.tsx:115`, `src/pages/hub-clarity-person.test.tsx:214`; add `vi.mock("../services/rococoAdmins.ts", () => import("../test/mocks/rococoAdmins.ts"))` to every test file that renders `PermissionsPage` (`grep -ln PermissionsPage src/pages/*.test.tsx`)

**Interfaces:**
- Consumes: `RococoAdmin`, `RococoAdminEntry` (Task 2); `isRococoEmail`, `normalizeEmail` (`src/lib/email.ts`); `requireRows` (`src/lib/errors.ts`).
- Produces:
  - `services/rococoAdmins.ts`: `listRococoAdmins(): Promise<RococoAdminEntry[]>` (the list ordered by email, each joined in the service to the profile with that email for `name` and `profile_id`); `addRococoAdmin(email: string): Promise<RococoAdmin>` (normalizes; a non-Rococo address throws `"Use a rocococreative.io address."` before any call); `removeRococoAdmin(id: string): Promise<void>` (asks for the id back and passes it to `requireRows`).
  - Mock: the same three, seeded with `austin@rocococreative.io` (name `Austin Rococo`, `profile_id: "rococo-user-1"`) and `sample.staff@rocococreative.io` (no profile); a duplicate throws `"That already exists."`; removing the last entry throws `"The last Rococo admin cannot be removed."`; `resetMockRococoAdmins(): void`.
  - `mocks/profiles.ts`: `setMockRococoFlag(id: string, value: boolean): void` (test helper, not a service function).
  - `errors.ts`: `errorMessage` signature unchanged.

Exact copy: section title `Rococo admins`; description `The people who can open every company. Each one signs in with a confirmed rocococreative.io address.`; field label `Email address`; button `Add`; Remove asks once with `Remove ${name} as a Rococo admin? Their hub account is turned off. You can add them back later.` and buttons `Remove` (danger) and `Keep`; `name` is the entry's `name` or else its email; the signed-in person's own row has no Remove. Users page: the checkbox cell becomes `<Badge>Rococo admin</Badge>` for a flagged person and nothing otherwise, and under the tabs one line reads `Rococo admins are added and removed on the Permissions tab.` with `Permissions tab` a link to `/rococo/permissions`.

- [ ] **Step 1: Write the failing tests.**
  - `rococo-permissions.test.tsx`: `lists the Rococo admins by name, or by email when there is no profile`; `Add refuses 'someone@example.com' with 'Use a rocococreative.io address.' and adds 'Sam@RococoCreative.io' as 'sam@rocococreative.io'`; `Remove asks 'Remove sample.staff@rocococreative.io as a Rococo admin? Their hub account is turned off. You can add them back later.' and only Remove removes it; Keep leaves it`; `your own row offers no Remove`; `a refusal shows its line` (spy `removeRococoAdmin` to reject with `{ message: "The last Rococo admin cannot be removed.", code: "23514" }`, the line appears).
  - `clarity-library.test.tsx:147`: no `Rococo admin:` checkbox; a flagged person shows the `Rococo admin` badge; the Permissions line links to `/rococo/permissions`.
  - `errors.test.ts`, `describe("raw database and provider text")`: `{ message: 'relation "public.x" does not exist', code: "42P01" }`, `{ message: "permission denied for table connection_tokens", code: "42501" }`, `{ message: "Could not find the table 'public.rococo_admins' in the schema cache", code: "PGRST205" }`, `new Error("error sending request for url (https://quickbooks.api.intuit.com/v3/company/123/query)")` and `{ message: 'null value in column "email" violates not-null constraint' }` each give the fallback `"Something went wrong. Try again."`; `{ message: "The last Rococo admin cannot be removed.", code: "23514" }` and `{ message: "Rococo admins are added and removed on the Permissions page.", code: "P0001" }` pass through; the existing cases still pass.
  - `src/test/vercelHeaders.test.ts` (reads `vercel.json` through `node:fs` as above): for each path, collect `Cache-Control` from every header rule whose `new RegExp("^" + source + "$")` matches; `/`, `/settings/connections`, `/rococo/permissions` and `/index.html` give `"no-store"`; `/assets/index-abc123.js` and `/fonts/sample.woff2` give nothing.
  - Swap `updateProfile(x, { is_rococo_admin: ... })` for `setMockRococoFlag(x, ...)` in the three tests listed above.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/pages/rococo-permissions.test.tsx src/pages/clarity-library.test.tsx src/lib/errors.test.ts src/test/vercelHeaders.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** `errorMessage` keeps its order (the known phrasings first), then treats a message as raw, and gives the fallback, when its `code` (read from the thrown value when it has one) starts with `PGRST` other than `PGRST116`, or starts with `42` other than `42501`, or its text matches any of `/permission denied for /i`, `/\brelation "/i`, `/\bcolumn "/i`, `/schema cache/i`, `/syntax error/i`, `/invalid input syntax/i`, `/null value in column/i`, `/\bJWT\b/`, `/https?:\/\//i`; otherwise the message passes as today. `vercel.json` gains a header rule `{ "source": "/((?!assets/|fonts/).*)", "headers": [{ "key": "Cache-Control", "value": "no-store" }] }` and keeps the existing rule. The section follows the page's patterns: `Section`, `Button`, `Notice`, `SkeletonRows`, `inputClass`, `errorMessage`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run`
Expected: PASS, including `src/test/mocks/parity.test.ts` for `rococoAdmins`.

- [ ] **Step 5: Gates, demo check and commit.** `npm run lint && npm run build`; `npm run demo` and open `/rococo/permissions` and `/rococo/people`. Commit "Manage Rococo admins from Permissions, hide raw error text, and keep app pages out of caches" with the trailer.

---

### Task 10: README rollout, secrets and ledger; all gates

**Files:**
- Modify: `README.md:98` (sign-in line), `README.md:103-130` (What is applied live), `README.md:896-945` (The connections function), `README.md:947-997` (The notify function: no-store and pinned imports), and a new section `### Applying security hardening` after `### Applying the Connections catalog` (line 1207)

**Interfaces:**
- Consumes: everything above. Produces: none.

- [ ] **Step 1: Write the README changes.**
  - Line 98: an `@rocococreative.io` address is a Rococo admin only once it is on the Rococo admins list (Rococo > Permissions), and only with a confirmed email; the first one is seeded by 0051 from the existing Rococo admin.
  - The connections function: routes `POST /pending`, `/finish` and `/discard` (signed in; finish and discard only by the person who started the connection, still an active owner or admin, or the Rococo admin who started it); the callback now always answers a bare 302 and parks the connection for ten minutes; `/status` also reports `CONNECTIONS_STATE_SECRET` and `TOKEN_ENCRYPTION_KEY`; Disconnect reports whether the tool confirmed revocation; GoHighLevel has no revoke. Secrets gain `TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`; never shared, never in Vercel), `TOKEN_ENCRYPTION_KEY_PREVIOUS` (only during a rotation: move the old value there, put a new one in the main secret, and each value moves to the new key on its next token refresh) and `APP_URL` (already a project secret for notify; the callback's fallback return).
  - The new section, numbered: 1. Add `TOKEN_ENCRYPTION_KEY` in Supabase function secrets. 2. Paste `0051`, then `0052`, then `notify pgrst, 'reload schema';`; check `select r.email, u.email_confirmed_at from public.rococo_admins r join auth.users u on lower(u.email) = r.email;` lists the Rococo admin with a confirmation time (without one, Rococo access stops at this step). Nothing visible changes. 3. Deploy both functions: `supabase functions deploy connections --no-verify-jwt` and `supabase functions deploy notify`; a failed import pin fails the deploy here, before anything is live. 4. Merge and deploy the app; it must not ship before steps 2 and 3, because it calls `/pending` and `/finish`. 5. Record 0051, 0052 and both deploys in What is applied live, and in the Hub Feature Register. Note that between steps 2 and 3 the old function cannot store a connection (0052 refuses plaintext tokens and account ids), which is intended.
  - What is applied live: list `0051_rococo_admins` and `0052_connection_secrets` under Not applied yet.

- [ ] **Step 2: Check the copy**

Run: `git diff 92b530a..HEAD | grep '^+' | grep -c $'\xe2\x80\x94'` (the em dash, written as its UTF-8 bytes)
Expected: `0`.

- [ ] **Step 3: Run all four gates**

Run: `npm run lint && npx vitest run && npm run build && npm run test:sql`
Expected: lint clean, every vitest file passes, the build type-checks, and `SQL tests: ... 0 failed` with 0051 and 0052 applied and re-applied.

- [ ] **Step 4: Commit** "Record the security hardening rollout, secrets and migrations" with the trailer.
