# Integrations: QuickBooks Online and GoHighLevel

Status: the sign-in is built, the figures are not synced yet. Each company connects its own
GoHighLevel and QuickBooks Online accounts from Settings, Connections, through the app's own
OAuth flow (the `connections` Edge Function). Company Hub is a standalone app: no connection
runs through Rococo's own tools or accounts. Every figure in the hub is still entered by hand
(or by CSV for financial snapshots), and the rows already carry a `source` column so the sync
can write the same rows later without a schema change.

This note maps each hub figure to where it will come from, what has to be true in the source
system for the number to mean anything, and the decisions still open. API facts come from the
Intuit and HighLevel developer references read on 2026-09-29; plan tiers and pricing move often,
so confirm those in Perplexity before quoting them to a client.

## What the hub holds today

| Hub figure | Table and column | Entered today | Future source |
|---|---|---|---|
| Company revenue, job costs, overhead, net profit, cash | `financial_snapshots.revenue`, `.cogs`, `.opex`, `.net_profit`, `.cash_on_hand` (one row per month, quarter or year; `source` is manual, csv or quickbooks) | Financials page, by hand or CSV | QuickBooks reports |
| Company goals: closed sales, gross margin, reviews | `company_goals.current_numeric` and `.current_display` (by year) | Company goals page | GoHighLevel (closed sales), QuickBooks (gross margin), by hand (reviews) |
| A person's own figures: closed sales, revenue managed | `employee_financials.target`, `.current`, `.source` (manual, quickbooks or ghl; one row per person, year and metric) | Person page, by hand | GoHighLevel (closed sales per owner), QuickBooks (revenue per person) |
| Personal KPIs | `employee_kpis` (display strings plus optional numerics) | Person page | Stays by hand; these are whatever the company names |
| Marketing spend and results | `marketing_campaigns` | Marketing page | Out of scope here |

The rule for every synced row: the worker owns the rows it created (`source` is quickbooks or
ghl) and never touches a row whose `source` is manual. An admin who corrects a synced figure by
hand turns that row manual, and the worker leaves it alone until the row is deleted. That keeps
"the number on the screen" explainable: it is either the system's or a person's, never a mix.

## QuickBooks Online

### Access

- OAuth 2.0 with the `com.intuit.quickbooks.accounting` scope. The access token lives one hour.
  The refresh token is good for up to 100 days, but its value can change on any refresh, so the
  worker must store the newest refresh token after every token call.
- Sandbox base URL `https://sandbox-quickbooks.api.intuit.com`, production
  `https://quickbooks.api.intuit.com`. Every request carries the company's `realmId`.
- Production keys require Intuit's app assessment questionnaire, and Intuit says this applies to
  private, unlisted, single-company apps too. Plan for one Rococo-owned Intuit app, assessed once,
  that each client company connects to with their own QuickBooks login.
- The QuickBooks tokens never reach the browser or Vercel. The `connections` function stores
  them in `connection_tokens` when the company's admin signs in, and the sync worker (a
  scheduled Edge Function) will be the only thing that reads them and writes synced rows.
  Same posture as rule 6 in `CLAUDE.md`: no service-role key in the app.
- Pin a `minorversion` on every call. Intuit ships a new minor version most months and old ones
  get retired.

### Company figures: the ProfitAndLoss and BalanceSheet reports

One call per period, no transaction-level reads needed.

```
GET /v3/company/{realmId}/reports/ProfitAndLoss
    ?start_date=2026-01-01&end_date=2026-01-31
    &accounting_method=Accrual&summarize_column_by=Total
```

| Report row (by `group`) | Hub column |
|---|---|
| `Income` section summary ("Total Income") | `financial_snapshots.revenue` |
| Cost of goods sold section summary (present when the company uses COGS accounts) | `financial_snapshots.cogs` |
| `Expenses` section summary ("Total Expenses") | `financial_snapshots.opex` |
| `NetIncome` summary | `financial_snapshots.net_profit` (the hub derives revenue minus cogs minus opex when this is null; write it so the books win) |
| BalanceSheet: bank accounts total under current assets | `financial_snapshots.cash_on_hand` |

Notes:

- `summarize_column_by=Month` returns a whole year in one call with one money column per
  month; that is the cheaper shape for a backfill. Other supported values: Total, Week, Days,
  Quarter, Year, Customers, Vendors, Classes, Departments, Employees, ProductsAndServices.
- `accounting_method` must match how the company reads its own books (Cash or Accrual). Make
  it a per-company setting, not a constant.
- Gross margin for the company goal is `(revenue - cogs) / revenue` from the same report.
- `financial_snapshots` is unique on `(company_id, period_type, period_start)`, so a re-sync is
  an upsert, not a duplicate.

### A person's figures: attributing revenue to a person

QuickBooks has no salesperson field. Three ways to tag a transaction with a person, in the
order worth considering:

1. **Class per person** (recommended). Class tracking is a Plus or Advanced feature: Plus allows
   40 classes and locations combined, Advanced is unlimited. Turn on
   `Preferences.AccountingInfoPrefs.ClassTrackingPerTxn`, create one class per person, and tag
   each estimate or invoice with `ClassRef`. Then one report gives everyone's number:
   `GET /v3/company/{realmId}/reports/ClassSales?start_date&end_date` (the SalesByClassSummary
   report), one row per class, with a "Not Specified" row for untagged sales that tells you how
   clean the books are. The ProfitAndLoss report also takes `class=` and
   `summarize_column_by=Classes`.
2. **A custom field on sales forms** ("Sales rep"). The API reads and writes only the first three
   string custom fields on sales forms (`DefinitionId` 1 to 3, listed under
   `Preferences.SalesFormsPrefs.CustomField`). The value is free text, so it has to match a hub
   person by name, and per-transaction limits are 1 (Simple Start), 4 (Essentials and Plus) or
   12 (Advanced). Use this only when classes are already spoken for.
3. **Location (Department) per person.** `DepartmentRef` on the transaction and the
   SalesByDepartment report. Usually reserved for branches; skip unless the company already
   thinks of people that way.

Whichever tag is used, the mapping from class or field value to `profiles.id` is a small table
the company keeps in the hub, not a naming convention.

### Closed sales from QuickBooks

If a company treats an accepted estimate as the sale, the Estimate entity carries what is
needed: `TxnStatus` (Accepted, Closed, Pending, Rejected, Converted), `AcceptedDate`,
`TotalAmt`, `ClassRef` or `CustomField`, and `LinkedTxn` to the invoices it became. The query
language is unreliable for filtering on `TxnStatus`, so pull estimates by `TxnDate` for the
period and filter status in the worker. Billed revenue instead of sold revenue is the Invoice
entity's `TotalAmt` over the same tag.

### Webhooks

Invoice, Estimate, Payment and Customer support Create, Update and Delete notifications, sent in
aggregated batches with the entity name, id, operation and timestamp. Treat a notification as a
reason to re-read the entity, never as the data itself. A nightly report pull is enough for the
figures the hub shows; webhooks only make them fresher.

## GoHighLevel

### How a company connects

From Settings, Connections, a company admin clicks Connect and signs in to HighLevel, choosing
the one sub-account to link. The `connections` function stores that sub-account's id on the
company's row and the tokens where only it can read them. The sample below was read during
research from RBA's sub-account (Toronto, Canadian dollars); Klasik connects its own the same
way, and the two never touch.

Pipelines and stages on the RBA sub-account:

- Project Sales (North): New Lead, Contacted, Proposal Sent, Closed
- Project Sales (South): New Lead (Homeowner), Qualification / Class D, Proposal,
  Pre-Construction, Sold, Lost, Warranty
- LinkedIn: Lead Gen, A+D Network, and Real Estate (lead generation, not sales)

### What a closed sale is

An opportunity is a closed sale when its `status` is `won`. The Sold or Closed stage on its own
is not enough: in the sample read today, every opportunity sitting in the Closed stage carried a
status of lost or abandoned, and the sub-account had no opportunity marked won at all. The
figures come from these fields:

| Opportunity field | Meaning for the hub |
|---|---|
| `status` | `won` counts; open, lost and abandoned do not |
| `monetaryValue` | Contract value, in the sub-account's currency |
| `lastStatusChangeAt` | The close date, which decides the year and the quarter |
| `assignedTo` | The HighLevel user id of the owner; this is the person the sale credits |
| `pipelineId` | Lets a company count only its sales pipelines and ignore lead-gen boards |

Finding from the sample: `assignedTo` was empty on every opportunity read, and `monetaryValue`
was often zero. Until the team marks sales as won, assigns an owner, and enters the value, a
per-person closed sales figure cannot be automatic. A HighLevel workflow that fires on the move
into Sold or Closed and requires status, owner and value is the cheapest fix, and it belongs to
the team's process, not to the hub.

### Reading it

- `GET /opportunities/search?location_id={id}&status=won&date=mm-dd-yyyy&endDate=mm-dd-yyyy&limit=100`,
  paginated with `startAfter` and `startAfterId` from the response's `meta`. Filter by
  `pipelineId` for the sales pipelines. Sum `monetaryValue` by `assignedTo` for each person's
  "Closed sales" row in `employee_financials` (source `ghl`), and the total for the company's
  "Closed sales" goal in `company_goals.current_numeric`.
- Owners map to hub people by email: `GET /users/search?companyId={agencyId}&locationId={id}`
  lists the sub-account's users with their email, matched case-insensitively against
  `profiles.email`. A won opportunity whose owner has no hub profile lands in an "Unassigned"
  line the admin can see, never in somebody else's total.
- Webhooks `OpportunityStatusUpdate` and `OpportunityMonetaryValueUpdate` carry the
  opportunity id, `assignedTo`, `monetaryValue`, `status`, pipeline and stage. Use them to
  re-read the one opportunity by id; a nightly pull stays the source of truth.

### Currency

The RBA sub-account runs in Canadian dollars. The hub formats every amount as US dollars today
(`formatMoney` in `src/lib/format.ts`). Before any RBA figure is synced, the company needs a
currency setting and the formatter needs to read it. This is a company row, not a code branch.

## Sync design, when it is built

- A worker outside the browser (Supabase Edge Function on a schedule) reads each company's
  tokens from `connection_tokens`, refreshes them, and is the only writer of synced rows. It
  runs nightly, and on a webhook when one arrives.
- Per-company settings, as rows: QuickBooks realm id and accounting method, HighLevel location
  id and the pipeline ids that count as sales, the attribution method in QuickBooks (class or
  custom field) with its value-to-person map, the closed sales definition (HighLevel won, or
  QuickBooks accepted estimate), and currency.
- Every write carries `source`. Manual rows are never overwritten. A synced row an admin edits
  becomes manual (the FinancialsTable already does this), and the worker stops updating it.
- Backfill once per company from January 1 of the current year, then only the current and
  previous period on each run.

## Decisions to settle before wiring

1. **Closed sales definition per company.** HighLevel won status, or QuickBooks accepted
   estimate. Klasik has said "closed sales" in HighLevel terms; RBA's data says the team is not
   marking won yet.
2. **Attribution in QuickBooks.** Class per person (recommended) or a sales rep custom field.
   Depends on the company's plan tier and whether classes are already in use.
3. **HighLevel hygiene on the RBA sub-account.** Mark won, assign an owner, enter the value, as
   a workflow rule.
4. **Currency per company.** Needed before RBA's figures go live.
5. **Who owns the QuickBooks app.** One Rococo app assessed by Intuit, each company connecting
   with its own login, is the recommendation.
