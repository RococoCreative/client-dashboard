// The registry of outside tools the Connections catalog lists, the one pure rule that turns a
// company's connection row, modules and Rococo's keys into what a card shows, the reader of what
// Rococo's setup check answers, and the lines the confirm step and a Disconnect say. Pages read
// this and never work a card's state, or those lines, out themselves.
import { CONNECTION_PROVIDER_LABELS, keysOf, type CompanyConnection, type ConnectionProvider, type LinkProvider } from "../types/database.ts";
import { FLOW_SECRETS, missingFlowSecrets, type FlowSecretName, type FlowSecretsStatus } from "../../supabase/functions/_shared/providerSecrets.ts";
import { MODULE_LABELS, type ModuleKey } from "./modules.ts";

export type ConnectorGroup = "financials" | "production" | "marketing_sales" | "productivity";

export const CONNECTOR_GROUPS: Array<{ key: ConnectorGroup; label: string; note: string }> = [
  { key: "financials", label: "Financials", note: "Books, invoices and the spreadsheets behind the numbers." },
  { key: "production", label: "Production", note: "Jobs, schedules and job costs." },
  { key: "marketing_sales", label: "Marketing & Sales", note: "Leads, pipelines and closed sales." },
  { key: "productivity", label: "Productivity", note: "Boards and task lists the team works from." },
];

export type ConnectorHow = "sign_in" | "access_key" | "links";
export type ConnectorAvailability = "live" | "next" | "soon" | "links";

export interface Connector {
  key: string;
  name: string;
  group: ConnectorGroup;
  description: string;
  monogram: string;
  how: ConnectorHow;
  availability: ConnectorAvailability;
  provider?: ConnectionProvider;
  linkProvider?: LinkProvider;
  feeds?: string[];
  requiresModule?: ModuleKey;
  secretNames?: [string, string];
}

export const CONNECTORS: readonly Connector[] = [
  {
    key: "quickbooks", name: "QuickBooks Online", group: "financials", monogram: "QB",
    description: "Revenue, costs, invoices, payments and balances.",
    how: "sign_in", availability: "live", provider: "quickbooks",
    feeds: ["Sales & Finance: invoices and balances", "Home: overdue invoice flags"],
    secretNames: ["QBO_CLIENT_ID", "QBO_CLIENT_SECRET"],
  },
  {
    key: "google_sheets", name: "Google Sheets", group: "financials", monogram: "GS",
    description: "Reporting tabs from the company's own spreadsheets.",
    how: "sign_in", availability: "live", provider: "google_sheets", requiresModule: "data_sources",
    feeds: ["Home: revenue, goal, plan, forecast", "Projects from the Project Map"],
    secretNames: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  },
  {
    key: "xero", name: "Xero", group: "financials", monogram: "X",
    description: "Books and invoices, for companies on Xero instead of QuickBooks.",
    how: "sign_in", availability: "soon",
  },
  {
    key: "jobtread", name: "JobTread", group: "production", monogram: "JT",
    description: "Jobs, schedules, budgets and job costs.",
    how: "access_key", availability: "next",
    feeds: ["Projects and their milestones", "Job margin and PM capacity"],
  },
  {
    key: "buildertrend", name: "Buildertrend", group: "production", monogram: "BT",
    description: "Jobs, schedules and selections.",
    how: "sign_in", availability: "soon",
  },
  {
    key: "companycam", name: "CompanyCam", group: "production", monogram: "CC",
    description: "Job photos, linked to each project.",
    how: "sign_in", availability: "soon",
  },
  {
    key: "gohighlevel", name: "GoHighLevel", group: "marketing_sales", monogram: "HL",
    description: "Leads, pipeline stages and won opportunities.",
    how: "sign_in", availability: "live", provider: "gohighlevel",
    feeds: ["Sales & Finance: closed sales", "Sales for each person"],
    secretNames: ["GHL_CLIENT_ID", "GHL_CLIENT_SECRET"],
  },
  {
    key: "hubspot", name: "HubSpot", group: "marketing_sales", monogram: "HS",
    description: "Contacts, deals and pipelines.",
    how: "sign_in", availability: "soon",
  },
  {
    key: "monday", name: "Monday.com", group: "productivity", monogram: "M",
    description: "Open the team's boards straight from the hub.",
    how: "links", availability: "links", linkProvider: "monday", requiresModule: "external_links",
  },
  {
    key: "asana", name: "Asana", group: "productivity", monogram: "A",
    description: "Projects and task lists.",
    how: "sign_in", availability: "soon",
  },
  {
    key: "google_calendar", name: "Google Calendar", group: "productivity", monogram: "GC",
    description: "Walkthroughs and site visits on Home.",
    how: "sign_in", availability: "soon",
  },
];

export type CardState =
  | "connected" | "needs_attention" | "not_connected" | "not_available" | "not_on"
  | "linked" | "not_set_up" | "coming_next" | "coming_soon";

export interface CardInputs {
  row: CompanyConnection | null;
  hasModule: (m: ModuleKey) => boolean;
  /** Whether Rococo's provider keys are in; null means the status check was unavailable. */
  keysIn: boolean | null;
  linkCount: number;
}

export interface CardView {
  state: CardState;
  action: "manage" | "reconnect" | "connect" | "manage_links" | "add_link" | "ask" | null;
  /** The line shown in place of an action that cannot run. */
  blocked: string | null;
}

const KEYS_MISSING = "Rococo is setting this up.";
// A company admin cannot turn a module on, so the line says who does.
const needsModule = (m: ModuleKey) => `Needs ${MODULE_LABELS[m]}, which Rococo turns on.`;

export function cardView(c: Connector, i: CardInputs): CardView {
  if (c.availability === "next") return { state: "coming_next", action: "ask", blocked: null };
  if (c.availability === "soon") return { state: "coming_soon", action: "ask", blocked: null };

  const moduleOff = c.requiresModule !== undefined && !i.hasModule(c.requiresModule);

  if (c.availability === "links") {
    if (moduleOff) return { state: "not_on", action: null, blocked: needsModule(c.requiresModule!) };
    return i.linkCount > 0
      ? { state: "linked", action: "manage_links", blocked: null }
      : { state: "not_set_up", action: "add_link", blocked: null };
  }

  // Live. The company's own row wins over module and key status, so a working connection is never hidden.
  const status = i.row?.status ?? "not_connected";
  const keysMissing = i.keysIn === false;
  if (status === "connected") return { state: "connected", action: "manage", blocked: null };
  if (status === "error") {
    if (moduleOff) return { state: "needs_attention", action: null, blocked: needsModule(c.requiresModule!) };
    if (keysMissing) return { state: "needs_attention", action: null, blocked: KEYS_MISSING };
    return { state: "needs_attention", action: "reconnect", blocked: null };
  }
  if (moduleOff) return { state: "not_on", action: null, blocked: needsModule(c.requiresModule!) };
  if (keysMissing) return { state: "not_available", action: null, blocked: KEYS_MISSING };
  return { state: "not_connected", action: "connect", blocked: null };
}

export const CARD_STATE_ORDER: Record<CardState, number> = {
  needs_attention: 0, connected: 1, linked: 2, not_set_up: 3, not_connected: 4,
  not_available: 5, not_on: 6, coming_next: 7, coming_soon: 8,
};

export function summaryCounts(views: CardView[]): { connected: number; attention: number; available: number } {
  let connected = 0, attention = 0, available = 0;
  for (const v of views) {
    if (v.state === "connected" || v.state === "linked") connected++;
    else if (v.state === "needs_attention") attention++;
    else if (v.state === "not_connected") available++;
  }
  return { connected, attention, available };
}

// What Rococo's setup check says: which providers have their app keys, and which of the connect
// flow's own secrets must be set (empty when the flow is ready). Any missing secret stops every
// sign-in tool, whatever its keys.
export interface ConnectorSetup {
  keys: Record<ConnectionProvider, boolean>;
  missingSecrets: FlowSecretName[];
}

const PREVIOUS_KEY = "TOKEN_ENCRYPTION_KEY_PREVIOUS";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

// The /status answer, or null when it cannot be told. Every provider needs its own key boolean and
// every flow secret its own: one left out would read as missing and hide a Connect that works, so a
// partial answer is "cannot tell". The previous key is reported only when it is the fault, and the
// secrets to set come from the same rule the function uses (missingFlowSecrets).
export function parseConnectorSetup(answer: unknown): ConnectorSetup | null {
  if (!isRecord(answer) || !isRecord(answer.keys) || !isRecord(answer.secrets)) return null;
  const { keys, secrets } = answer;
  const parsed = {} as Record<ConnectionProvider, boolean>;
  for (const provider of keysOf(CONNECTION_PROVIDER_LABELS)) {
    const value = keys[provider];
    if (typeof value !== "boolean") return null;
    parsed[provider] = value;
  }
  const status = {} as FlowSecretsStatus;
  for (const name of FLOW_SECRETS) {
    const value = secrets[name];
    if (typeof value !== "boolean") return null;
    status[name] = value;
  }
  const previous = secrets[PREVIOUS_KEY];
  if (previous !== undefined && typeof previous !== "boolean") return null;
  if (previous === false) status[PREVIOUS_KEY] = false;
  return { keys: parsed, missingSecrets: missingFlowSecrets(status) };
}

// What the confirm step asks before a sign-in is attached. The account name is best effort; without
// it the line says so and asks for a sign-in the admin has only just made.
export function confirmConnectLine(tool: string, accountName: string | null, companyName: string): string {
  if (accountName !== null) return `Connect ${tool} account ${accountName} to ${companyName}?`;
  return `Connect ${tool} to ${companyName}? ${tool} did not give this account's name. Only continue if you just approved access in ${tool}.`;
}

// Said when the tool did not confirm it let go of the hub's access (GoHighLevel offers no revoke).
export function stillListedLine(tool: string): string {
  return `${tool} may still list Company Hub; remove it there too.`;
}
