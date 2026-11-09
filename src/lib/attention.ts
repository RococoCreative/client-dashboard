// What the Home Attention card lists, built only from signals the hub already holds: people
// who have not signed in yet, open cycles whose period has ended, live campaigns with no budget,
// and connections reporting an error. Pure, so the card is a view and the rules are tested here.
// There are no thresholds of its own: each item is a plain fact about a row.
import { CONNECTION_PROVIDER_LABELS, type CompanyConnection, type MarketingCampaign, type Profile, type ReviewCycle } from "../types/database.ts";
import { formatDate } from "./format.ts";
import { cyclePath } from "./gsr/cycles.ts";
import { hasAccount } from "./people.ts";

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

// Danger first, then warnings; within each, people, cycles, campaigns, connections, each in
// the order it arrived.
export function attentionItems(input: AttentionInput): AttentionItem[] {
  const all = [
    ...notSignedIn(input.people),
    ...overdueCycles(input.cycles, input.today),
    ...unbudgetedCampaigns(input.campaigns),
    ...brokenConnections(input.connections),
  ];
  return [...all.filter((item) => item.severity === "danger"), ...all.filter((item) => item.severity === "warning")];
}
