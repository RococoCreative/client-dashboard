// What the Home Attention card lists, built only from signals the hub already holds: people
// who have not signed in yet, open cycles whose period has ended, live campaigns with no budget,
// connections reporting an error, and enabled data sources whose sync failed or went stale. Pure, so the card is a view and the rules are tested here.
// There are no thresholds of its own: each item is a plain fact about a row, and staleness is the
// source's own threshold, read through syncState.
import { CONNECTION_PROVIDER_LABELS, type CompanyConnection, type MarketingCampaign, type Profile, type ReviewCycle, type SyncSource } from "../types/database.ts";
import { formatDate, formatDateTime } from "./format.ts";
import { cyclePath } from "./gsr/cycles.ts";
import { hasAccount } from "./people.ts";
import { syncState } from "./sync/state.ts";

export type AttentionKind = "not_signed_in" | "cycle_overdue" | "campaign_no_budget" | "connection_error" | "sync_failed" | "sync_stale";

export interface AttentionItem {
  kind: AttentionKind;
  title: string;
  detail: string;
  to: string;
  severity: "warning" | "danger";
}

export interface AttentionInput {
  people: Profile[];
  cycles: ReviewCycle[];
  campaigns: MarketingCampaign[];
  connections: CompanyConnection[];
  today: string; // YYYY-MM-DD
  sources?: SyncSource[];
  now?: Date;
}

function notSignedIn(people: Profile[]): AttentionItem[] {
  const count = people.filter((person) => person.is_active && !hasAccount(person)).length;
  if (count === 0) return [];
  return [
    {
      kind: "not_signed_in",
      title: "People not signed in",
      detail: count === 1 ? "1 person has not signed in yet." : `${count} people have not signed in yet.`,
      to: "/people",
      severity: "warning",
    },
  ];
}

function overdueCycles(cycles: ReviewCycle[], today: string): AttentionItem[] {
  return cycles
    .filter((cycle) => cycle.status === "open" && cycle.period_end < today)
    .map((cycle) => ({
      kind: "cycle_overdue",
      title: `${cycle.name} is still open`,
      detail: `Its period ended ${formatDate(cycle.period_end)}. Close it when the reviews are done.`,
      to: cyclePath(cycle),
      severity: "warning",
    }));
}

function unbudgetedCampaigns(campaigns: MarketingCampaign[]): AttentionItem[] {
  return campaigns
    .filter((campaign) => (campaign.status === "active" || campaign.status === "paused") && campaign.budget === null)
    .map((campaign) => ({
      kind: "campaign_no_budget",
      title: `${campaign.name} has no budget`,
      detail: "Set a budget so spend can be read against it.",
      to: "/marketing",
      severity: "warning",
    }));
}

function brokenConnections(connections: CompanyConnection[]): AttentionItem[] {
  return connections
    .filter((connection) => connection.status === "error")
    .map((connection) => ({
      kind: "connection_error",
      title: `${CONNECTION_PROVIDER_LABELS[connection.provider]} needs reconnecting`,
      detail: connection.last_error || "The connection reported an error. Reconnect it in Settings.",
      to: "/settings",
      severity: "danger",
    }));
}

// An enabled source whose last sync failed, or whose data is older than its own threshold.
function troubledSources(sources: SyncSource[], connections: CompanyConnection[], now: Date): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const source of sources) {
    if (!source.enabled) continue;
    const state = syncState(source, connections.find((c) => c.id === source.connection_id) ?? null, now);
    if (state === "failed") {
      items.push({ kind: "sync_failed", title: `${source.name}: sync failed`, detail: source.last_error ?? "The last attempt did not finish.", to: "/settings", severity: "danger" });
    } else if (state === "stale") {
      items.push({ kind: "sync_stale", title: `${source.name}: stale data`, detail: `Last synced ${formatDateTime(source.last_success_at)}.`, to: "/settings", severity: "warning" });
    }
  }
  return items;
}

// Danger first, then warnings; within each, people, cycles, campaigns, connections, sources,
// each in the order it arrived.
export function attentionItems(input: AttentionInput): AttentionItem[] {
  const all = [
    ...notSignedIn(input.people),
    ...overdueCycles(input.cycles, input.today),
    ...unbudgetedCampaigns(input.campaigns),
    ...brokenConnections(input.connections),
    ...troubledSources(input.sources ?? [], input.connections, input.now ?? new Date()),
  ];
  return [...all.filter((item) => item.severity === "danger"), ...all.filter((item) => item.severity === "warning")];
}
