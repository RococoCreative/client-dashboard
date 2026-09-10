// People helpers shared by the review header, the people table, and the person page:
// tenure from a hire date and the annual total of a compensation table.
import { formatDate, parseDate } from "./format.ts";

// "3 years, 2 months", "7 months", "Less than a month", or "Starts Oct 1, 2026".
export function formatTenure(hireDate: string | null | undefined, today = new Date()): string | null {
  const start = parseDate(hireDate);
  if (!start) return null;
  let months = (today.getFullYear() - start.getFullYear()) * 12 + (today.getMonth() - start.getMonth());
  if (today.getDate() < start.getDate()) months -= 1;
  if (months < 0) return `Starts ${formatDate(hireDate)}`;
  if (months === 0) return "Less than a month";
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const y = years === 0 ? "" : `${years} ${years === 1 ? "year" : "years"}`;
  const m = rest === 0 ? "" : `${rest} ${rest === 1 ? "month" : "months"}`;
  return [y, m].filter(Boolean).join(", ");
}

export function totalAnnual(items: Array<{ annual_amount: number }>): number {
  return items.reduce((sum, item) => sum + (Number.isFinite(item.annual_amount) ? item.annual_amount : 0), 0);
}
