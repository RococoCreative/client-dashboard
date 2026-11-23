This file exists to drive the Connections catalog build task by task.

# Connections Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Settings > Connections as one catalog of tool cards for every company, grouped by purpose, with a status and one action per card, a detail panel, a connect panel, Monday's links on its card, tool requests, and Rococo's setup line.

**Architecture:** A pure registry and state function in `src/lib/connectors.ts` decide every card from the company's connection rows, modules, links, requests and Rococo's key status. A new table `connector_requests` (0050) records asks. A new read-only `POST /status` route on the `connections` function reports which providers have their app keys. The page replaces `ConnectionsPanel` inside the existing Connections tab.

**Tech Stack:** Vite, React 19, TypeScript, Tailwind v4, Supabase (Postgres, RLS), Deno Edge Function, Vitest and Testing Library, the SQL harness in `supabase/tests`.

**Spec:** `docs/superpowers/specs/2026-11-23-connections-catalog-design.md` (read it with this plan; the mockup it links shows the look).

## Global Constraints

- CLAUDE.md binds every task: theme tokens and `src/components/ui/*` only; services throw, pages message (`lib/errors.ts`); the company wall is RLS; no branch on a company name, slug or theme key; every file opens with a comment saying why it exists; components are PascalCase with `export default function Name()`; copy calm, plain, industry neutral, no em dashes, no AI model identifiers.
- Migration is `0050`, append-only and idempotent; `src/types/database.ts` stays in step. 0040 to 0049 are applied live; do not edit them.
- Every service function has a same-named mock (`src/test/mocks/parity.test.ts`); a new service file goes in the alias list in `demo/vite.config.ts`.
- No provider secret value, token or key reaches the browser. Secret names may appear in the registry and on screen for a Rococo admin only.
- Nothing offers an action that will fail: no Connect or Reconnect while Rococo's keys are missing or the needed module is off.
- A company's own connection row wins over module and key status when deciding Connected or Needs attention.
- Gates before every commit: `npm run lint`, `npx vitest run`, `npm run build`; plus `npm run test:sql` for any task touching `supabase/`.

## Review Focus

1. **The provider sends the browser back with `?connected=` or `?connect_error=`.** The new page still shows the outcome banner once, only when the row agrees, and clears the address, as `ConnectionsPanel` does today. Pinned in Task 4.
2. **The live `connections` function has no `/status` route yet (404) or the call fails.** Every live tool is treated as available, nothing errors on the page, and a Rococo admin's line reads "Setup status unavailable." Pinned in Task 3 (service) and Task 4 (page).
3. **Two admins press "Ask for this" at once, or one presses twice.** The second is treated as already requested, not an error, and the button reads Requested. Pinned in Task 2 (SQL) and Task 4 (page).
4. **A connection row whose `connected_by` person was deleted (set null) or a request whose `requested_by` was.** The panel and the portfolio list read "someone no longer listed", never an id or a blank. Pinned in Tasks 5 and 6.
5. **A Rococo admin stepped into a company switches company in the sidebar with a panel open.** The panel closes or shows the new company's row, never the old company's account. Pinned in Task 5.

---

### Task 1: The registry and the card state

**Files:**
- Create: `src/lib/connectors.ts`, `src/lib/connectors.test.ts`

**Interfaces:**
- Produces:
  - `type ConnectorGroup = "financials" | "production" | "marketing_sales" | "productivity"`; `CONNECTOR_GROUPS: Array<{ key: ConnectorGroup; label: string; note: string }>` in order Financials ("Books, invoices and the spreadsheets behind the numbers."), Production ("Jobs, schedules and job costs."), Marketing & Sales ("Leads, pipelines and closed sales."), Productivity ("Boards and task lists the team works from.").
  - `type ConnectorHow = "sign_in" | "access_key" | "links"`; `type ConnectorAvailability = "live" | "next" | "soon" | "links"`.
  - `interface Connector { key: string; name: string; group: ConnectorGroup; description: string; monogram: string; how: ConnectorHow; availability: ConnectorAvailability; provider?: ConnectionProvider; linkProvider?: LinkProvider; feeds?: string[]; requiresModule?: ModuleKey; secretNames?: [string, string] }`.
  - `CONNECTORS: readonly Connector[]`: the eleven entries in the spec's table, keys `quickbooks`, `google_sheets`, `xero`, `jobtread`, `buildertrend`, `companycam`, `gohighlevel`, `hubspot`, `monday`, `asana`, `google_calendar`. Live entries carry `provider` equal to their key and `secretNames`: QuickBooks `["QBO_CLIENT_ID","QBO_CLIENT_SECRET"]`, Google Sheets `["GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET"]`, GoHighLevel `["GHL_CLIENT_ID","GHL_CLIENT_SECRET"]`. Google Sheets has `requiresModule: "data_sources"`; Monday has `how: "links"`, `availability: "links"`, `linkProvider: "monday"`, `requiresModule: "external_links"`. Descriptions and feeds: copy the mockup's.
  - `type CardState = "connected" | "needs_attention" | "not_connected" | "not_available" | "not_on" | "linked" | "not_set_up" | "coming_next" | "coming_soon"`.
  - `interface CardInputs { row: CompanyConnection | null; hasModule: (m: ModuleKey) => boolean; keysIn: boolean | null; linkCount: number }` (`keysIn` null means the status check was unavailable).
  - `interface CardView { state: CardState; action: "manage" | "reconnect" | "connect" | "manage_links" | "add_link" | "ask" | null; blocked: string | null }` (`blocked` is the line shown in place of an action that cannot run).
  - `cardView(c: Connector, i: CardInputs): CardView`.
  - `CARD_STATE_ORDER: Record<CardState, number>` (needs_attention 0, connected 1, linked 2, not_set_up 3, not_connected 4, not_available 5, not_on 6, coming_next 7, coming_soon 8).
  - `summaryCounts(views: CardView[]): { connected: number; attention: number; available: number }` (connected counts connected and linked; available counts not_connected).

- [ ] **Step 1: Write the failing tests**

```ts
it("has eleven connectors with unique keys in the four groups", ...);
it("lists exactly the live providers PROVIDER_KEYS names", () => {
  expect(CONNECTORS.filter((c) => c.availability === "live").map((c) => c.provider).sort()).toEqual([...PROVIDER_KEYS].sort());
});
// live tool
it("reads Connected when the row is connected, even with the module off and keys missing", () =>
  expect(cardView(sheets, { row: connected, hasModule: () => false, keysIn: false, linkCount: 0 })).toEqual({ state: "connected", action: "manage", blocked: null }));
it("reads Needs attention with Reconnect when the row is in error and keys are in", ...);          // action "reconnect"
it("reads Needs attention with no Reconnect and 'Rococo is setting this up.' when keys are missing", ...);
it("reads Needs attention with 'Turn on Data sources to use this.' when its module is off", ...);
it("reads Not connected with Connect when keys are in and there is no row or a not_connected row", ...);
it("reads Not available yet with no action when keys are missing", ...);
it("treats unknown key status (null) as keys in", ...);
it("reads Not on for this company when its module is off and there is no live row", ...);
// links tool
it("reads Linked with Manage links when the module is on and there is at least one link", ...);
it("reads Not set up with Add a board link when the module is on and there are no links", ...);
it("reads Not on for this company when external_links is off", ...);
// coming
it("reads Coming next for JobTread and Coming soon for Asana, both with Ask", ...);
it("counts connected and linked as connected, needs attention, and not connected as available", ...);
```

- [ ] **Step 2: Run them to see them fail.** `npx vitest run src/lib/connectors.test.ts`; FAIL, module not found.
- [ ] **Step 3: Implement the registry and `cardView`, `summaryCounts`.** Module labels come from `MODULE_LABELS` in `src/lib/modules.ts` for the "Turn on {label} to use this." line.
- [ ] **Step 4: Run the tests and the gates.** All pass.
- [ ] **Step 5: Commit.** `git commit -m "Add the connector registry and the card state rule"`

---

### Task 2: Tool requests (0050)

**Files:**
- Create: `supabase/migrations/0050_connector_requests.sql`, `supabase/tests/0050_connector_requests.test.sql`, `src/services/connectorRequests.ts`, `src/test/mocks/connectorRequests.ts`
- Modify: `src/types/database.ts`, `src/lib/audit.ts` (table and column labels), `demo/vite.config.ts`, the README ledger (written, not applied; next free `0051`)

**Interfaces:**
- Produces (SQL): `public.connector_requests (id uuid pk default gen_random_uuid(), company_id uuid not null references companies on delete cascade, connector_key text not null check (connector_key ~ '^[a-z][a-z0-9_]{1,40}$'), requested_by uuid references profiles on delete set null, requested_at timestamptz not null default now(), unique (company_id, connector_key))`.
- Produces (TS): `interface ConnectorRequest { id: string; company_id: string; connector_key: string; requested_by: string | null; requested_at: string }`; service `listConnectorRequests(companyId: string)`, `listAllConnectorRequests()` (Rococo, every company), `requestConnector(companyId: string, connectorKey: string): Promise<ConnectorRequest>` (upsert on `company_id,connector_key` ignoring duplicates, then returns the stored row), `withdrawConnectorRequest(companyId: string, connectorKey: string): Promise<void>`.

- [ ] **Step 1: Write the failing SQL test.** Cases, following the conventions in `supabase/tests/helpers.sql`:

```sql
-- case: admin_asks_and_withdraws      kingdom admin inserts; reads it; deletes it.
-- case: requested_by_is_stamped       the row's requested_by is the admin's profile, whatever the insert sent.
-- case: second_ask_is_one_row         a second insert for the same key by another admin, through the
--                                     service's upsert shape (on conflict do nothing), leaves one row.
-- case: members_read_own_company      a kingdom employee reads kingdom's rows and none of klasik's.
-- case: employee_and_manager_cannot_write   inserts and deletes refused or affecting 0 rows.
-- case: rococo_reads_all_and_may_ask  a Rococo admin reads every company's rows and may insert for kingdom.
-- case: company_is_pinned             an update cannot move a row to another company (no update grant).
-- case: bad_key_refused               'Asana!' and '' violate the check.
-- case: audited                       audit_events has an insert row for connector_requests carrying connector_key.
```

- [ ] **Step 2: Run to see it fail.** `npm run test:sql`; FAIL, relation does not exist.
- [ ] **Step 3: Write 0050.** RLS on; grant select, insert, delete to authenticated (no update). Select: `private.is_rococo_admin() or private.is_company_member(company_id)`. Insert and delete: `private.can_manage_company(company_id)`. A BEFORE INSERT trigger sets `requested_by := private.auth_profile_id()` when someone is signed in (security definer, `search_path = ''`, revoked from public, anon, authenticated). Audit trigger `connector_requests_audit` with `private.audit_change('connector_key')`.
- [ ] **Step 4: Types, service, mock, demo alias, audit labels ("Tool request", "tool"), README ledger.**
- [ ] **Step 5: Run the gates and commit.** `git commit -m "Record which tools a company asks for (0050)"`

---

### Task 3: Rococo's key status

**Files:**
- Create: `supabase/functions/_shared/providerSecrets.ts`, `src/lib/sync/providerSecrets.test.ts`
- Modify: `supabase/functions/connections/index.ts` (route, and `ProviderDef.env` read from the shared map), `supabase/functions/connections/http.ts` (a `requireMember`), `src/services/connections.ts`, `src/test/mocks/connections.ts`

**Interfaces:**
- Produces (shared): `PROVIDER_SECRETS: Record<ProviderKey, { id: string; secret: string }>` (the three pairs in Task 1); `keysPresent(read: (name: string) => string | undefined): Record<ProviderKey, boolean>` (true only when both values are non-empty).
- Produces (function): `POST /status` with `{ company_id }`, allowed for an active member of that company or a Rococo admin (`requireMember(req, companyId): Promise<string>` in `http.ts`, modelled on `requireAdmin` without the role test); answers `{ keys: Record<ProviderKey, boolean> }` and nothing else.
- Produces (app): `loadConnectorSetup(companyId: string): Promise<Record<ConnectionProvider, boolean> | null>` in `src/services/connections.ts`, returning null (never throwing) when the call fails for any reason, including a 404 from a function without the route.

- [ ] **Step 1: Write the failing tests.**

```ts
it("names a secret pair for every provider key", ...);
it("matches the secret names the registry shows", () => /* CONNECTORS live entries' secretNames equal PROVIDER_SECRETS */ ...);
it("reports a provider present only when both values are non-empty", () =>
  expect(keysPresent((n) => ({ QBO_CLIENT_ID: "a", QBO_CLIENT_SECRET: "b", GHL_CLIENT_ID: "a" } as Record<string, string>)[n]))
    .toEqual({ quickbooks: true, gohighlevel: false, google_sheets: false }));
// service, against a stubbed invoke that rejects
it("loadConnectorSetup returns null when the function answers 404", ...);
```

- [ ] **Step 2: Run to see them fail, implement, run.** The function file is Deno and cannot run here: keep the route small, route it before `/start` in the dispatcher, and reuse `json` and `HttpError`. The mock's `loadConnectorSetup` returns all true by default and is changeable through a `setMockConnectorSetup(value)` helper reset in `src/test/setup.ts`.
- [ ] **Step 3: Gates and commit.** `git commit -m "Report which tools have Rococo's keys, without the keys"`

---

### Task 4: The catalog page

**Files:**
- Create: `src/components/settings/ConnectionsCatalog.tsx`, `src/components/settings/ConnectorCard.tsx`, `src/pages/connections-catalog.test.tsx`
- Modify: `src/pages/settings/SettingsPage.tsx` (`ConnectionsTab`: the catalog replaces `ConnectionsPanel` and the "Links to outside tools" section; data sources stay below), and any existing test that pins the old list
- Delete: `src/components/settings/ConnectionsPanel.tsx` once nothing imports it (move its return-trip handling and `KNOWN_CONNECT_ERRORS` into the catalog)

**Interfaces:**
- Consumes: Task 1 (`CONNECTORS`, `CONNECTOR_GROUPS`, `cardView`, `CARD_STATE_ORDER`, `summaryCounts`), Task 2 (`listConnectorRequests`, `requestConnector`, `withdrawConnectorRequest`), Task 3 (`loadConnectorSetup`), `listConnections`, `listExternalLinks`, `hasModule`, `useHub()` (`company`, `isRococo`).
- Produces: `ConnectionsCatalog({ company }: { company: Company })`; `ConnectorCard({ connector, view, row, requested, rococoLine, onAction })`. Task 5 adds the panels behind `onAction`.

- [ ] **Step 1: Write the failing page tests** (company with all modules; then defaults):

```ts
it("shows the four groups in order with every connector card", ...);
it("shows the summary strip counts from the cards", ...);
it("filters by group chip and by the Connected chip, and searches by name or description", ...);
it("says 'No tools match. Ask Rococo for the one you use, and it goes on the list.' when nothing matches", ...);
it("shows Not available yet and no Connect when loadConnectorSetup says QuickBooks keys are missing", ...);
it("treats a null setup status as keys in, and a Rococo admin's line reads 'Setup status unavailable.'", ...);
it("shows Google Sheets as Not on for this company without data_sources", ...);
it("Ask for this records the request and the button reads Requested; pressing Requested withdraws it", ...);
it("a duplicate ask (the service resolving the existing row) still reads Requested and shows no error", ...);
it("a Rococo admin sees each card's setup line with the two secret names when keys are missing; a company admin never sees them", ...);
it("shows '{Tool} is connected.' once after the provider returns with ?connected= and the row agrees, then clears the address", ...);
it("shows the fixed error line for a known ?connect_error= and the generic line for an unknown one", ...);
```

- [ ] **Step 2: Run to see them fail, implement, run.** Load connections, requests, links and setup in one `useAsync` keyed on the company id (setup's null is a value, not an error). Order cards in a group by `CARD_STATE_ORDER`, then registry order. Group sections and the card grid follow the mockup; the tile is the monogram on `bg-surface-2` with `text-accent`. Coming cards use a dashed border.
- [ ] **Step 3: Gates and commit.** `git commit -m "Show Settings > Connections as a catalog of tool cards"`

---

### Task 5: The panels

**Files:**
- Create: `src/components/settings/ConnectorPanel.tsx` (detail), `src/components/settings/ConnectPanel.tsx` (before sign-in)
- Modify: `src/components/settings/ConnectionsCatalog.tsx`, `src/components/links/ExternalLinksPanel.tsx` (optional `onlyProvider?: LinkProvider`: lists only those links and fixes the add form's provider), `src/pages/connections-catalog.test.tsx`

**Interfaces:**
- Consumes: Task 4's `onAction`; `startConnection`, `disconnectConnection`; `listDirectory(companyId)` for the connected-by name.
- Produces: `ConnectorPanel({ company, connector, row, view, onClose, onChanged })`, `ConnectPanel({ company, connector, onClose })`.

Use the existing dialog or drawer primitive in `src/components/ui` (find it; do not style a raw overlay).

- [ ] **Step 1: Write the failing tests.**

```ts
it("Manage opens the panel with account, connected by name, since, last read, Read only, and what it feeds", ...);
it("names a deleted connector of the account as 'someone no longer listed'", ...);
it("shows the stored error first for a card that needs attention", ...);
it("Disconnect asks again as 'Disconnect for everyone at {company name}' and only the second press disconnects", ...);
it("Connect opens the connect panel; Continue to {Tool} calls startConnection with the company's return address", ...);
it("Reconnect is absent and the blocked line shows when keys are missing on a connected card", ...);
it("Manage links on Monday lists only Monday links and adds new ones as Monday", ...);
it("Add a board link on a Monday card with no links opens the same panel", ...);
it("closes the panel when the active company changes", ...);
```

- [ ] **Step 2: Run to see them fail, implement, run.** Panel copy from the spec: "Connected once for everyone at {company}. If {first name} leaves or loses access to this account, reconnect with an account the company keeps." and, before sign-in, "You'll go to {Tool} to sign in and approve. Then you come straight back here." plus "Use an account the company keeps, like a shared office login. If the person who signs in leaves, the connection stops for everyone."
- [ ] **Step 3: Gates and commit.** `git commit -m "Add the connector detail and connect panels, and Monday's links on its card"`

---

### Task 6: Tool requests on the Rococo portfolio

**Files:**
- Modify: `src/pages/rococo/PortfolioPage.tsx`, its tests (or a new `src/pages/rococo-tool-requests.test.tsx`)

**Interfaces:**
- Consumes: `listAllConnectorRequests()`, `CONNECTORS` (tool name by key; an unknown key shows the key itself), `useHub().companies`, the directory or profiles a Rococo admin can read for names.

- [ ] **Step 1: Write the failing tests.**

```ts
it("lists each request as company, tool, who asked and when, newest first", ...);
it("marks a request made by a Rococo admin as Rococo", ...);
it("names a deleted requester as 'someone no longer listed'", ...);
it("shows 'No tool requests yet.' when there are none", ...);
it("a failed load shows a plain line and the rest of the portfolio still renders", ...);
```

- [ ] **Step 2: Run to see them fail, implement as one Section titled "Tool requests" below the company cards, run.**
- [ ] **Step 3: Gates and commit.** `git commit -m "List tool requests on the Rococo portfolio"`

---

### Task 7: Docs

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update.** "Connections to outside systems": the catalog, card states, one connection per company, the shared-login advice, requests, and the Rococo setup line. "The connections function": the `/status` route and who may call it. Applying: a short "Applying the Connections catalog" section with the order (apply 0050, redeploy `connections`, then merge the app; the app copes with a function that lacks `/status`, but must not ship before 0050). Ledger: 0050 written, not applied.
- [ ] **Step 2: Gates and commit.** `git commit -m "Document the Connections catalog and its rollout"`

## Rollout, by hand

1. Apply `0050` and reload the schema.
2. Redeploy `connections` (also ships the Phase 2 multi-day schedule).
3. Merge and deploy the app.
