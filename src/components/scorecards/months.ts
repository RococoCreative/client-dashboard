// Month names for the scorecard screens, from the YYYY-MM-01 strings every scorecard month is.
// Read as written, never through a time zone, so September is September everywhere.
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function monthLabel(month: string, style: "short" | "long" = "long"): string {
  const index = Number(month.slice(5, 7)) - 1;
  const name = (style === "short" ? SHORT : LONG)[index] ?? month;
  return style === "short" ? name : `${name} ${month.slice(0, 4)}`;
}

// The years a scorecard screen offers: this one and the two before it.
export function scorecardYears(current: number): number[] {
  return [current, current - 1, current - 2];
}
