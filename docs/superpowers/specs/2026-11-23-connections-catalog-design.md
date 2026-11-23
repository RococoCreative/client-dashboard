This file exists to record the agreed design for the Connections catalog: Settings > Connections rebuilt as a modern integrations page, the same for every company.

# Connections catalog design

Mockup the owner approved: https://claude.ai/artifact/9hCBnBU2P7dVkFS6BTmPEx (sample data, Kingdom theme).

## Intent

Today Settings > Connections is a plain list of three rows (GoHighLevel, QuickBooks, and Google Sheets
for companies with data sources), and the links to tools like Monday live separately in Resources.
The owner wants it to look and work like a modern SaaS integrations page: every tool a company might
use in one place, grouped by what it is for, so that he and each company's admins can see at a glance
what is connected, what needs attention, and what is coming.

It also answers a question the owner had about setup: which tools need something from Rococo, and
which a company sets up on its own. The page shows that on each card.

## Goals

- One catalog page, the same for all three companies, grouped as Financials, Production, Marketing &
  Sales and Productivity.
- Every card shows the tool's live state for this company in one word, with the one action that makes
  sense next.
- A connected card shows which account, who connected it and since when, and what it feeds.
- A company can tell Rococo which coming tools it wants, and Rococo can see that demand.
- A Rococo admin stepped into a company sees, on each card, whether Rococo's side of the setup is done.

## Non-goals

- Building any new connector. JobTread, Asana and the rest arrive later, one at a time, each as its
  own project. This page is the catalog they slot into.
- Changing how an existing connector works (sign-in, tokens, syncing, data sources).
- A database-edited catalog. The list of tools lives in code.

## Anti-goals

- A card that offers Connect and then fails. If Rococo has not added a tool's keys, the card says so
  before anyone clicks.
- One company's setup showing on another's screen (rule 12). Every company sees the same catalog; only
  each company's own connection rows, requests and links differ.
- Any provider secret value, token or key reaching the browser, including in the new setup-status check.
  The names of the secrets (`GHL_CLIENT_ID` and the like) are not secret: they are in the README and
  may sit in the registry; only a Rococo admin sees them on screen.

## Constraints

- CLAUDE.md binds: theme tokens and `components/ui/*` only; services throw, pages message; the company
  wall is RLS; no branch on a company name, slug or theme key; migrations append-only and idempotent
  with `src/types/database.ts` in step; copy calm and plain, no em dashes.
- One connection per company per tool already holds in the database
  (`company_connections_company_provider_key`). Any owner or admin connects it, and it serves the whole
  company.
- Settings is admin-only today. The page stays that way.
- The `connections` Edge Function is the only thing that holds provider secrets and tokens (rule 6).

## Approaches considered

1. **The list lives in code (chosen).** One registry file names every tool, its group, how it connects
   (sign in, access key, or links) and whether it is built. Live status comes from the company's own
   rows. Smallest build, and it matches how tools arrive: a new connector is a code change anyway.
   Adding a "coming soon" card needs a deploy.
2. **The list lives in the database, edited from a Rococo screen.** About twice the build; a card added
   this way still cannot connect until its connector is written.
3. **Each company chooses which tools to show.** Works against a global catalog. Dropped.

The owner picked 1.

## What the owner decided

- The four groups and the tools named: Google and QuickBooks under Financials, JobTread under
  Production, GoHighLevel under Marketing & Sales, Monday.com and Asana under Productivity.
- Every tool in one place, the same on all three companies.
- A catalog now, real connectors one at a time (option C), JobTread likely first.
- The mockup's look and behaviour: cards with status, a detail panel, a connect panel, search and
  group filters, a summary strip, and a Rococo-only setup line on each card.

## The design

### The catalog (code)

A registry in `src/lib/connectors.ts` (pure, tested), each entry:

- `key` (stable slug, also what a request records), `name`, `group` (`financials`, `production`,
  `marketing_sales`, `productivity`), a one-line description in the company's terms, and a short
  monogram for the tile.
- `how`: `sign_in`, `access_key` or `links`.
- `availability`: `live` (connects today), `next` (the connector being built next), `soon` (planned),
  or `links` (the hub links to it but does not read it).
- For a live tool: its `ConnectionProvider` key, what it feeds (a short list for the detail panel),
  and an optional module it needs to be useful (`requiresModule`).

Starting entries:

| Group | Tool | How | Availability |
|---|---|---|---|
| Financials | QuickBooks Online | sign in | live |
| Financials | Google Sheets | sign in | live, needs `data_sources` |
| Financials | Xero | sign in | soon |
| Production | JobTread | access key | next |
| Production | Buildertrend | sign in | soon |
| Production | CompanyCam | sign in | soon |
| Marketing & Sales | GoHighLevel | sign in | live |
| Marketing & Sales | HubSpot | sign in | soon |
| Productivity | Monday.com | links | links, needs `external_links` |
| Productivity | Asana | sign in | soon |
| Productivity | Google Calendar | sign in | soon |

A test keeps the registry's live entries in step with `PROVIDER_KEYS` and `CONNECTION_PROVIDER_LABELS`,
the way `providers.test.ts` already does for the function.

### Card states

Worked out by one pure function from the entry, the company's connection row, the company's modules,
whether Rococo's keys are in, and whether the company has asked for it:

| State | When | Action |
|---|---|---|
| Connected | live, row connected | Manage (opens the detail panel) |
| Needs attention | live, row in error | Reconnect |
| Not connected | live, keys in, no row or disconnected | Connect |
| Not available yet | live, Rococo's keys not in | none; the card says Rococo is setting it up |
| Not on for this company | live, needs a module the company does not have | none; says which part of the hub it needs, which Rococo turns on |
| Linked | links, module on, at least one link for that tool | Manage links |
| Not set up | links, module on, no link for that tool yet | Add a board link |
| Coming next | next | Ask for this, or Requested |
| Coming soon | soon | Ask for this, or Requested |

Precedence (builder check; my calls):

- **The company's own row wins.** A live tool whose row is connected or in error shows Connected or
  Needs attention even if its module was later turned off or Rococo's keys went missing, so a working
  connection is never hidden. Disconnect always works.
- **Nothing offers an action that will fail.** On such a card, Reconnect is replaced by a line saying
  why it cannot run now: "Rococo is setting this up" when keys are missing, or "Turn on {module} to
  use this" when the module is off.
- **A links tool follows its module too.** With `external_links` off, Monday reads "Not on for this
  company", like a live tool.

Order within a group: needs attention, connected, linked, not set up, not connected, not available, not on,
coming next, coming soon. The summary strip counts connected (including linked), needing attention,
and available to connect now.

### The detail panel (connected or needing attention)

Account, connected by (the person's name from `connected_by`, or "someone no longer listed"), since,
last read, access (read only), and what it feeds. In error, the stored error line first. A note that
it is connected once for everyone at the company and that a leaver's account breaks it. Disconnect
asks once more, worded "Disconnect for everyone at {company}". Reconnect starts the same sign-in.

### The connect panel (sign in)

Before sending the admin to the provider: one line on what happens, what the hub will read, and the
shared-login advice. Continue calls the existing `startConnection`. The return trip and its outcome
banner work as today.

### Monday (links)

The card's panel lists the company's links whose provider is `monday` and lets an admin add, edit and
remove them, reusing the existing links editor from Resources limited to Monday. Links keep showing in
their sidebar section and on Home as today. The old "Links to outside tools" pointer on the
Connections tab goes away.

### Asking for a tool

A new table `connector_requests` (migration 0050): `company_id`, `connector_key`, `requested_by`
(profile), `requested_at`, one row per company per tool. Admins of the company add and withdraw;
members of the company and Rococo read. The key is checked for shape only (a lowercase slug), not
against the catalog, so adding a "coming soon" card never needs a migration. Audited like other
configuration.

A Rococo admin stepped into a company may ask or withdraw on its behalf (my call: Rococo often sets
things up for a company); the request then records the Rococo person, and the portfolio list marks
them as Rococo.

On a card: "Ask for this" records it and the button becomes "Requested" (withdraw on click). Rococo
sees each company's requests on its cards, and a short "Tool requests" list on the Rococo portfolio
(company, tool, who asked, when).

### Rococo's setup line

A new read-only route on the `connections` function, `POST /status` with `{ company_id }` like the
other routes (the company is only for the membership check; the keys are the same for every company),
for any signed-in member of that company or a Rococo admin: it answers which live providers have their app keys present, as booleans,
and nothing else. The page uses it for "Not available yet". A Rococo admin stepped into a company also
sees, under each card, a mono line: keys in, keys missing (naming the two secret names, which the
registry holds), nothing to set
up (access key and links tools), or not built yet. Company admins never see secret names.

Until the function is redeployed with this route, the page treats every live tool as available (as
today) and the Rococo line reads "setup status unavailable".

### Data sources

The data sources editor stays below the catalog for companies with `data_sources`, unchanged.

### Look

Hub chrome and tokens as the mockup: a card grid per group, hairline borders, the tenant accent as
punctuation, status as a pill. Tool tiles are monograms on the surface colour for now.

## Rollout

1. Apply 0050 (requests). Nothing visible changes.
2. Redeploy `connections`. This also ships the Phase 2 multi-day schedule code, which is intended:
   0045 is applied live (2026-11-19) and the live function still reads only `sync_weekday`. No source
   exists live and 0032 is not applied, so no scheduled sync is affected either way.
3. Merge and deploy the app.

The app must cope with steps 1 and 2 not having happened yet only where stated above (the status
route). It must not ship before 0050, since it reads `connector_requests`.

## Left to the builder

Component split, exact copy beyond what is quoted, test structure, and how the links editor is
narrowed to Monday.
